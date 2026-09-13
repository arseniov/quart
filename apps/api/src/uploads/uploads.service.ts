import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client as MinioClient } from 'minio';
import sharp from 'sharp';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the ConfigService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

export const MINIO_CLIENT = Symbol('MINIO_CLIENT');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
const OUTPUT_MIME = 'image/jpeg';
const MAX_WIDTH = 1024;

export interface ProcessedUpload {
  objectKey: string;
  bytes: Buffer;
  mime: string;
}

/**
 * Ponytail: `sharpImpl` is injected as a constructor arg (defaulting to the
 * real `sharp`) so unit tests can stub the chain without loading the native
 * lib. `MINIO_CLIENT` is a Symbol token so it never collides with a string
 * provider key by accident. Both swaps are deluxe-but-not-expensive for the
 * test surface area we get back.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly config: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
    @Optional() private readonly sharpImpl: typeof sharp = sharp,
  ) {}

  async process(input: Buffer, mime: string): Promise<ProcessedUpload> {
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException({
        error: { code: 'upload.mime_unsupported', message: 'Image required (jpeg, png, heic, webp)' },
      });
    }
    if (input.byteLength > MAX_BYTES) {
      throw new BadRequestException({
        error: { code: 'upload.too_large', message: 'Max 10MB' },
      });
    }

    const bytes = await this.sharpImpl(input)
      .rotate()                                  // honor EXIF orientation
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .withMetadata({ exif: {} })                // strip ALL EXIF (GPS, device, etc.)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    const objectKey = `processed/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
    await this.minio.putObject(
      this.config.env.MINIO_BUCKET_PRIVATE,
      objectKey,
      bytes,
      bytes.byteLength,
      { 'Content-Type': OUTPUT_MIME },
    );

    return { objectKey, bytes, mime: OUTPUT_MIME };
  }
}