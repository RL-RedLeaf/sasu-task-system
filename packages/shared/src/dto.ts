import type { ApiErrorBody } from './errors';

/** 统一响应信封：业务成功时 code = 0 */
export interface ApiResponse<T> extends ApiErrorBody {
  code: 0 | number;
  data?: T;
}

/** 分页（PRD §11.1：默认 20，最大 100） */
export const PAGE_DEFAULT_SIZE = 20;
export const PAGE_MAX_SIZE = 100;

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 幂等请求头（PRD §8.4/§12.1：金额/状态命令必须携带） */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** 乐观锁请求头（PRD §10.2：If-Match: version） */
export const IF_MATCH_HEADER = 'If-Match';

/** 健康检查（PRD §12.1：db=false 时返回 503） */
export interface HealthzResponse {
  ok: boolean;
  db: boolean;
  version: string;
  buildTime: string | null;
}
