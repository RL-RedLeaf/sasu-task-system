import { request } from './http';
import type { PageData } from './tasks';

export interface MyPoints {
  balance: number;
  frozen: number;
  penaltyDebt: number;
  totalEarned: number;
}

export interface TxRow {
  id: string;
  type: string;
  bizKey: string;
  reason: string | null;
  createdAt: string;
  taskId: string | null;
  legs: { delta: number; bucket: string; balanceAfter: number }[];
}

export const pointsApi = {
  me(): Promise<MyPoints> {
    return request({ method: 'GET', url: '/points/me' });
  },
  myTransactions(params: Record<string, unknown>): Promise<PageData<TxRow>> {
    return request({ method: 'GET', url: '/points/me/transactions', params });
  },
  pool(): Promise<{
    poolBalance: number;
    escrowTotal: number;
    userBalanceTotal: number;
    userFrozenTotal: number;
    issuedTotal: number;
    cashoutTotal: number;
  }> {
    return request({ method: 'GET', url: '/admin/points/pool' });
  },
  topup(amount: number, reason: string, idempotencyKey: string): Promise<void> {
    return request({
      method: 'POST',
      url: '/admin/points/pool/topup',
      data: { amount, reason },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
  adjust(amount: number, reason: string, idempotencyKey: string): Promise<void> {
    return request({
      method: 'POST',
      url: '/admin/points/pool/adjust',
      data: { amount, reason },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
  adjustUser(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<void> {
    return request({
      method: 'POST',
      url: `/admin/users/${userId}/points/adjust`,
      data: { amount, reason },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
  userPoints(userId: string, params?: Record<string, unknown>): Promise<PageData<TxRow> & { balance: number; frozen: number; penaltyDebt: number }> {
    return request({ method: 'GET', url: `/admin/users/${userId}/points`, params });
  },
  allTransactions(params: Record<string, unknown>): Promise<PageData<TxRow>> {
    return request({ method: 'GET', url: '/admin/points/transactions', params });
  },
  reconcile(): Promise<{ ok: boolean; violations: { invariant: number; detail: string }[] }> {
    return request({ method: 'GET', url: '/admin/points/reconcile' });
  },
};
