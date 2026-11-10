import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

interface RequestWithId extends Request {
  requestId?: string;
}

/** 每个请求分配 requestId，用于日志串联与审计（PRD §7.4/§11.5） */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.requestId =
    typeof incoming === 'string' && incoming.length >= 8 && incoming.length <= 64
      ? incoming
      : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
