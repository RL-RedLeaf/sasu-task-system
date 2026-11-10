import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** BigInt 等 JSON 不支持的类型安全序列化；Decimal 已是字符串 */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** 成功响应信封 { code: 0, message: 'ok', data }；/healthz 保持原样（容器 HEALTHCHECK 依赖） */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ path?: string }>();
    const isHealthz = (req.path ?? '').includes('/healthz');
    return next.handle().pipe(
      map((data: unknown) => {
        if (isHealthz) return data;
        const serialized = data === undefined || data === null ? null : data;
        return {
          code: 0,
          message: 'ok',
          data: JSON.parse(JSON.stringify(serialized ?? null, jsonSafeReplacer)),
        } as unknown;
      }),
    );
  }
}
