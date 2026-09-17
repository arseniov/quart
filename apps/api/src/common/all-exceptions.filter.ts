import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string | undefined;
  };
}

interface FastifyLikeRequest {
  id?: string;
}
interface FastifyLikeReply {
  status(code: number): FastifyLikeReply;
  send(body: unknown): unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyLikeRequest>();
    const res = ctx.getResponse<FastifyLikeReply>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.buildBody(exception, req);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, req_id: req.id }, 'unhandled error');
    }
    res.status(status).send(body);
  }

  private buildBody(exception: unknown, req: FastifyLikeRequest): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      const respObj = typeof resp === 'object' && resp !== null ? resp : undefined;
      const innerError =
        respObj && 'error' in respObj && typeof respObj.error === 'object' && respObj.error !== null
          ? (respObj.error as { code?: unknown; message?: unknown; details?: unknown })
          : undefined;
      const code =
        innerError?.code !== undefined ? String(innerError.code) : `http.${exception.getStatus()}`;
      const message =
        innerError?.message !== undefined
          ? String(innerError.message)
          : respObj && 'message' in respObj
            ? String((respObj as { message: unknown }).message)
            : exception.message;
      const details = innerError?.details;
      return {
        error: {
          code,
          message,
          ...(details !== undefined ? { details } : {}),
          request_id: req.id,
        },
      };
    }
    return {
      error: {
        code: 'internal.error',
        message: 'An unexpected error occurred',
        request_id: req.id,
      },
    };
  }
}
