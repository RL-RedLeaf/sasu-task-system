import { HttpStatusByCode, MessageByCode, ErrorCode } from '@sasu/shared';

type ErrorCodeName = keyof typeof ErrorCode;

/** 业务异常：携带 §10.8 错误码；message 为面向用户的文案 */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly details?: unknown,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static of(code: ErrorCodeName, message?: string, details?: unknown): ApiError {
    const codeValue = ErrorCode[code];
    return new ApiError(
      codeValue,
      message ?? MessageByCode[codeValue],
      details,
      HttpStatusByCode[codeValue],
    );
  }
}
