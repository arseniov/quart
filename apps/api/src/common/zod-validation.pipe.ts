import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { type ZodError, type ZodSchema } from 'zod';

/**
 * Pipe that runs a zod schema (when provided) over the value and throws a
 * structured BadRequestException with field-level error details.
 *
 * When no schema is supplied, the value passes through unchanged — this lets
 * the same pipe be registered globally (no per-controller setup) while
 * individual handlers opt in by passing a schema to `new ZodValidationPipe(s)`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!this.schema) return value;
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException(this.format(r.error, metadata));
    return r.data;
  }

  private format(err: ZodError, metadata: ArgumentMetadata) {
    return {
      error: {
        code: 'validation.failed',
        message: `Invalid ${metadata.type}`,
        details: err.flatten(),
      },
    };
  }
}
