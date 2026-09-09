import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js';

interface CapturedResponse {
  statusCode: number;
  body: { error: { code: string; message: string; details?: unknown; request_id?: string } };
}

function host(reqId = 'req-1'): { host: ArgumentsHost; response: CapturedResponse } {
  const response: CapturedResponse = {
    statusCode: 0,
    body: { error: { code: '', message: '' } },
  };
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getRequest: () => ({ id: reqId }),
      getResponse: () => ({
        status(code: number) {
          response.statusCode = code;
          return this;
        },
        send(body: CapturedResponse['body']) {
          response.body = body;
          return this;
        },
      }),
      getStatus: () => 500,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  it('maps an unknown error to a 500 with code internal.error and no stack leak', () => {
    const f = new AllExceptionsFilter();
    const { host: h, response } = host();
    f.catch(new Error('boom with secrets'), h);

    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body.error.code).toBe('internal.error');
    expect(response.body.error.message).not.toContain('secrets');
    expect(response.body.error.request_id).toBe('req-1');
  });

  it('preserves code/message/details from a BadRequestException with envelope', () => {
    const f = new AllExceptionsFilter();
    const { host: h, response } = host();
    const cause = new BadRequestException({
      error: {
        code: 'validation.failed',
        message: 'Invalid body',
        details: { fieldErrors: { email: ['Invalid'] } },
      },
    });
    f.catch(cause, h);

    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.error.code).toBe('validation.failed');
    expect(response.body.error.message).toBe('Invalid body');
    expect(response.body.error.details).toEqual({ fieldErrors: { email: ['Invalid'] } });
    expect(response.body.error.request_id).toBe('req-1');
  });

  it('derives a stable code from status when the HttpException has no envelope', () => {
    const f = new AllExceptionsFilter();
    const { host: h, response } = host();
    f.catch(new NotFoundException('user not found'), h);

    expect(response.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(response.body.error.code).toBe('http.404');
    expect(response.body.error.message).toBe('user not found');
  });

  it('falls back to http.<status> when the HttpException response is a bare string', () => {
    const f = new AllExceptionsFilter();
    const { host: h, response } = host();
    f.catch(new HttpException('teapot', 418), h);

    expect(response.statusCode).toBe(418);
    expect(response.body.error.code).toBe('http.418');
  });
});
