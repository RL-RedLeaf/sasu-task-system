import { ApiError } from '../errors/api.error';
import { PAGE_DEFAULT_SIZE, PAGE_MAX_SIZE } from '@sasu/shared';

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePage(query: Record<string, unknown>, defaultSize = PAGE_DEFAULT_SIZE): PageParams {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const rawSize = Number.parseInt(String(query.pageSize ?? String(defaultSize)), 10) || defaultSize;
  const pageSize = Math.min(PAGE_MAX_SIZE, Math.max(1, rawSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult<T>(items: T[], total: number, params: PageParams) {
  return { items, total, page: params.page, pageSize: params.pageSize };
}

/** 金额/状态类命令的幂等键：缺失即拒绝（PRD §8.4） */
export function requireIdempotencyKey(headerValue: string | undefined): string {
  const key = headerValue?.trim();
  if (!key) throw ApiError.of('DUPLICATE_REQUEST', '缺少 Idempotency-Key 请求头');
  return key;
}
