import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../errors/api.error';

interface ErrorBody {
  code: number;
  message: string;
  requestId?: string;
  details?: unknown;
}

/** 统一错误信封（PRD §12.1：{ code, message, requestId, details? }） */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ requestId?: string; url?: string }>();

    let body: ErrorBody;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof ApiError) {
      status = exception.httpStatus ?? HttpStatus.CONFLICT;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: 2001,
        message: Array.isArray(message) ? message.join('；') : message,
      };
    } else {
      this.logger.error(
        `unhandled error on ${req?.url}: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
      body = { code: 5000, message: '服务器开小差了，请稍后重试' };
    }

    if (req?.requestId) body.requestId = req.requestId;
    res.status(status).json(body);
  }
}
