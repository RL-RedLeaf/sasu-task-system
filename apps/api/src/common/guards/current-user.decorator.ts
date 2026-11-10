import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../guards/auth.guard';

export type { RequestUser };

/** 取当前登录用户（AuthGuard 之后可用） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    return req.user;
  },
);

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

interface RequestLike {
  ip?: string;
  headers: Record<string, unknown>;
  requestId?: string;
}

export function requestMeta(req: RequestLike): RequestMeta {
  return {
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    requestId: req.requestId,
  };
}
