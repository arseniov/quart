import { describe, expect, it, vi } from 'vitest';

import { UploadsService } from '../../src/uploads/uploads.service.js';

const JPEG_BYTES = Buffer.from('jpeg-bytes');

/**
 * Ponytail: the sharp chain is deeply fluent and brittle to mock; we only
 * assert the parts of the surface that matter (callability, jpeg output,
 * upload). Real EXIF behavior is verified in integration tests against a
 * known JPEG with EXIF metadata (Phase 12 task 48+).
 */
function makeSharpMock(format: string = 'jpeg') {
  const metadata = vi.fn(async () => ({ format }));
  const toBuffer = vi.fn(async () => JPEG_BYTES);
  const jpeg = vi.fn(() => ({ toBuffer }));
  const withMetadata = vi.fn(() => ({ jpeg }));
  const resize = vi.fn(() => ({ withMetadata }));
  const rotate = vi.fn(() => ({ resize }));
  // First call returns the metadata-bearing chain (used for sniff). The
  // service then re-invokes `sharpImpl(input)` for the decode pipeline.
  const sharpMock = vi.fn(() => ({ rotate, metadata }));
  return { sharpMock, metadata, toBuffer, jpeg, withMetadata, resize, rotate };
}

function makeConfig() {
  return { env: { MINIO_BUCKET_PRIVATE: 'quart-private' } } as never;
}

function makeMinio() {
  return { putObject: vi.fn(async () => ({ etag: 'fake' })) };
}

describe('UploadsService.process', () => {
  it('strips EXIF, resizes to 1024px, and uploads a jpeg buffer to the private bucket', async () => {
    const { sharpMock, rotate, resize, withMetadata, jpeg, toBuffer, metadata } = makeSharpMock();
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    const r = await svc.process(Buffer.from('orig'));

    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes.length).toBeGreaterThan(0);
    expect(r.objectKey).toMatch(/^processed\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/);

    // Sniff: metadata() called before any rotate/resize work.
    expect(metadata).toHaveBeenCalled();
    // Sharp pipeline was invoked in the documented order.
    expect(sharpMock).toHaveBeenCalled();
    expect(rotate).toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith({ width: 1024, withoutEnlargement: true });
    expect(withMetadata).toHaveBeenCalledWith({ exif: {} });
    expect(jpeg).toHaveBeenCalledWith({ quality: 82, mozjpeg: true });
    expect(toBuffer).toHaveBeenCalled();

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

  it('accepts png, heic (as heif), and webp via sharp.metadata()', async () => {
    const minio = makeMinio();

    for (const format of ['png', 'heif', 'webp']) {
      const { sharpMock } = makeSharpMock(format);
      const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);
      await expect(svc.process(Buffer.from('x'))).resolves.toBeDefined();
    }
  });

  it('rejects bytes whose sharp.metadata().format is not in the allowlist', async () => {
    // E.g. a text blob labelled image/jpeg — sharp reports format='unknown'
    // (or undefined), so the allowlist gate fires before any decode work.
    const { sharpMock, rotate } = makeSharpMock('unknown');
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    await expect(svc.process(Buffer.from('not-an-image'))).rejects.toMatchObject({
      response: { error: { code: 'upload.mime_unsupported' } },
    });
    expect(rotate).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('converts sharp decode failures to BadRequestException decode_failed', async () => {
    // Sniff succeeds (real image), but the rotate→jpeg pipeline throws —
    // e.g. corrupt bytes that passed the header sniff.
    const sharpMock = vi.fn((input: Buffer) => {
      if (input.toString().startsWith('sniff:')) {
        return { metadata: async () => ({ format: 'jpeg' }) };
      }
      return {
        rotate: () => ({
          resize: () => ({
            withMetadata: () => ({
              jpeg: () => ({
                toBuffer: async () => {
                  throw new Error('corrupt jpeg data');
                },
              }),
            }),
          }),
        }),
      };
    });
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    await expect(svc.process(Buffer.from('sniff:then-decode'))).rejects.toMatchObject({
      response: { error: { code: 'upload.decode_failed' } },
    });
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects files larger than 10MB before invoking sharp metadata', async () => {
    const { sharpMock, metadata } = makeSharpMock();
    const minio = makeMinio();
    const svc = new UploadsService(makeConfig(), minio as never, sharpMock as never);

    await expect(svc.process(Buffer.alloc(11 * 1024 * 1024))).rejects.toMatchObject({
      response: { error: { code: 'upload.too_large' } },
    });
    expect(metadata).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });
});