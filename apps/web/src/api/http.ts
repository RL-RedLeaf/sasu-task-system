import axios, { type AxiosRequestConfig } from 'axios';
import { HttpStatusByCode, MessageByCode, type ApiResponse } from '@sasu/shared';

/** 归一化后的业务错误：调用方 catch 后可直接展示 friendlyMessage */
export interface NormalizedError extends Error {
  code?: number;
  httpStatus?: number;
  friendlyMessage: string;
}

/**
 * 统一请求封装（PRD §12.1）：baseURL /api/v1，错误码集中处理。
 * 幂等头 Idempotency-Key、If-Match 乐观锁在 M2 各命令类接口接入。
 */
export const http = axios.create({
  baseURL: '/api/v1',
  timeout: 15_000,
  withCredentials: true,
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error?.response?.data?.code as number | undefined;
    const serverMessage = error?.response?.data?.message as string | undefined;
    const known = code !== undefined && code in MessageByCode;
    const friendly =
      serverMessage ??
      (known ? MessageByCode[code as keyof typeof MessageByCode] : '网络异常，请稍后重试');
    const normalized: NormalizedError = Object.assign(new Error(friendly), {
      code,
      httpStatus: known ? HttpStatusByCode[code as keyof typeof HttpStatusByCode] : undefined,
      friendlyMessage: friendly,
    });
    return Promise.reject(normalized);
  },
);

/** 解开统一信封 { code, message, data }（PRD §12.1），直接返回 data */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<ApiResponse<T>>(config);
  return response.data.data as T;
}
