import { describe, expect, it, vi } from 'vitest';

import { UploadsController } from '../../src/uploads/uploads.controller.js';
import type { UploadsService } from '../../src/uploads/uploads.service.js';

function makeReq(opts: {
  file?: ReturnType<typeof vi.fn>;
} = {}) {
  return { file: opts.file ?? vi.fn(async () => undefined) } as never;
}

function makeUser() {
  return { id: 'u1' } as never;
}

function makeTenant() {
  return { cityId: 'c1', userId: 'u1', isSuperAdmin: false } as never;
}

function makeDeps() {
  return {
    uploads: {
      process: vi.fn(async (buf: Buffer) => ({
        objectKey: 'processed/2026-09-13/abc.jpg',
        bytes: buf,
        mime: 'image/jpeg',
      })),
    } as unknown as UploadsService,
    audit: { write: vi.fn(async () => undefined) } as never,
    db: { runInTenantTx: vi.fn(async (_t: unknown, fn: (trx: unknown) => unknown) => fn({})) } as never,
  };
}

describe('UploadsController.issuePhoto', () => {
  it('passes limits.fileSize=10MB to req.file() so busboy rejects mid-stream', async () => {
    const fileSpy = vi.fn(async () => ({
      file: (async function* () { /* empty stream */ })(),
      mimetype: 'image/jpeg',
      filename: 'a.jpg',
    }));
    const deps = makeDeps();
    const ctrl = new UploadsController(deps.uploads, deps.audit, deps.db);

    await ctrl.issuePhoto(makeReq({ file: fileSpy }), makeUser(), makeTenant());

    expect(fileSpy).toHaveBeenCalledOnce();
    const opts = fileSpy.mock.calls[0]?.[0] as { limits?: { fileSize?: number } } | undefined;
    expect(opts?.limits?.fileSize).toBe(10 * 1024 * 1024);
    expect(deps.db.runInTenantTx).toHaveBeenCalledOnce();
  });

  it('throws BadRequestException no_file when req.file() returns undefined', async () => {
    const deps = makeDeps();
    const ctrl = new UploadsController(deps.uploads, deps.audit, deps.db);

    await expect(
      ctrl.issuePhoto(makeReq(), makeUser(), makeTenant()),
    ).rejects.toMatchObject({
      response: { error: { code: 'upload.no_file' } },
    });
  });

  it('throws BadRequestException no_tenant when tenant context is missing', async () => {
    const deps = makeDeps();
    const ctrl = new UploadsController(deps.uploads, deps.audit, deps.db);

    await expect(
      ctrl.issuePhoto(makeReq(), makeUser(), null),
    ).rejects.toMatchObject({
      response: { error: { code: 'upload.no_tenant' } },
    });
  });
});