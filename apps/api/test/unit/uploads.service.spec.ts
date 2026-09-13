import { describe, expect, it, vi } from 'vitest';

import { UploadsService } from '../../src/uploads/uploads.service.js';

const JPEG_BYTES = Buffer.from('jpeg-bytes');

/**
 * Ponytail: the sharp chain is deeply fluent and brittle to mock; we only
 * assert the parts of the surface that matter (callability, jpeg output,
 * upload). Real EXIF behavior is verified in integration tests against a
 * known JPEG with EXIF metadata (Phase 12 task 48+).
 */
function makeSharpMock() {
  const toBuffer = vi.fn(async () => JPEG_BYTES);
  const jpeg = vi.fn(() => ({ toBuffer }));
  const withMetadata = vi.fn(() => ({ jpeg }));
  const resize = vi.fn(() => ({ withMetadata }));
  const rotate = vi.fn(() => ({ resize }));
  const sharpMock = vi.fn(() => ({ rotate }));
  return { sharpMock, toBuffer, jpeg, withMetadata, resize, rotate };
}

function makeConfig() {
  return { env: { MINIO_BUCKET_PRIVATE: 'quart-private' } } as never;
}

function makeMinio() {
  return { putObject: vi.fn(async () => ({ etag: 'fake' })) };
}

describe('UploadsService.process', () => {
  it('strips EXIF, resizes to 1024px, and uploads a jpeg buffer to the private bucket', async () => {
    const { sharpMock, rotate, resize, withMetadata, jpeg, toBuffer } = makeSharpMock();
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    const r = await svc.process(Buffer.from('orig'), 'image/jpeg');

    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes.length).toBeGreaterThan(0);
    expect(r.objectKey).toMatch(/^processed\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/);

    // Sharp pipeline was invoked in the documented order.
    expect(sharpMock).toHaveBeenCalledOnce();
    expect(rotate).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith({ width: 1024, withoutEnlargement: true });
    expect(withMetadata).toHaveBeenCalledWith({ exif: {} });
    expect(jpeg).toHaveBeenCalledWith({ quality: 82, mozjpeg: true });
    expect(toBuffer).toHaveBeenCalledOnce();

    // EXIF must be stripped — withMetadata({ exif: {} }) emits an empty
    // exif segment, which is what strips GPS/device metadata.
    const exifArg = withMetadata.mock.calls[0]?.[0] as { exif: unknown };
    expect(exifArg.exif).toEqual({});

    // MinIO got the processed bytes (not the original buffer).
    expect(minio.putObject).toHaveBeenCalledOnce();
    const [bucket, key, body] = minio.putObject.mock.calls[0] as [string, string, Buffer];
    expect(bucket).toBe('quart-private');
    expect(key).toBe(r.objectKey);
    expect(body).toBe(JPEG_BYTES);
  });

  it('accepts png, heic, and webp mime types', async () => {
    const { sharpMock } = makeSharpMock();
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    for (const mime of ['image/png', 'image/heic', 'image/webp']) {
      await expect(svc.process(Buffer.from('x'), mime)).resolves.toBeDefined();
    }
  });

  it('rejects non-image mime types with BadRequestException', async () => {
    const svc = new UploadsService(makeConfig(), makeMinio() as never, vi.fn() as never);

    await expect(svc.process(Buffer.from('x'), 'application/pdf')).rejects.toThrow();
    await expect(svc.process(Buffer.from('x'), 'text/plain')).rejects.toThrow();
  });

  it('rejects files larger than 10MB before invoking sharp', async () => {
    const { sharpMock } = makeSharpMock();
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    await expect(svc.process(Buffer.alloc(11 * 1024 * 1024), 'image/jpeg')).rejects.toThrow();
    expect(sharpMock).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });
});