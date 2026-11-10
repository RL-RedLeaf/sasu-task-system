import { request } from './http';
import type { PageData } from './tasks';

export interface WithdrawalRow {
  id: string;
  studentId: string;
  points: number;
  cashAmount: string;
  rate: string;
  periodKey: string;
  status: string;
  appliedAt: string;
  rejectReason?: string | null;
  student?: { name: string; username: string; className: string | null };
}

export const withdrawalsApi = {
  create(points: number, idempotencyKey: string): Promise<{ id: string; cashAmount: string }> {
    return request({
      method: 'POST',
      url: '/withdrawals',
      data: { points },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
  mine(params?: Record<string, unknown>): Promise<PageData<WithdrawalRow> & { withdrawEnabled: boolean }> {
    return request({ method: 'GET', url: '/withdrawals/me', params });
  },
  selfWithdraw(id: string): Promise<void> {
    return request({ method: 'POST', url: `/withdrawals/${id}/withdraw` });
  },
  adminList(params: Record<string, unknown>): Promise<PageData<WithdrawalRow>> {
    return request({ method: 'GET', url: '/admin/withdrawals', params });
  },
  approve(id: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/withdrawals/${id}/approve` });
  },
  reject(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/withdrawals/${id}/reject`, data: { reason } });
  },
  pay(id: string, payNote: string, idempotencyKey: string): Promise<void> {
    return request({
      method: 'POST',
      url: `/admin/withdrawals/${id}/pay`,
      data: { payNote },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
};

export interface DisputeRow {
  id: string;
  taskId: string | null;
  assignmentId: string | null;
  initiatorId: string;
  initiatorRole: string;
  respondentId: string;
  reason: string;
  status: string;
  decision: string | null;
  payPoints: number | null;
  resolutionNote: string | null;
  createdAt: string;
  initiator?: { name: string; role: string };
  respondent?: { name: string; role: string };
}

export const disputesApi = {
  create(data: { taskId?: number; assignmentId?: number; reason: string }): Promise<{ id: string }> {
    return request({ method: 'POST', url: '/disputes', data });
  },
  mine(params?: Record<string, unknown>): Promise<PageData<DisputeRow>> {
    return request({ method: 'GET', url: '/disputes/me', params });
  },
  adminList(params: Record<string, unknown>): Promise<PageData<DisputeRow>> {
    return request({ method: 'GET', url: '/admin/disputes', params });
  },
  resolve(
    id: string,
    data: { decision: 'PAY_FULL' | 'PAY_PARTIAL' | 'REJECT'; payPoints?: number; resolutionNote?: string },
  ): Promise<void> {
    return request({ method: 'POST', url: `/admin/disputes/${id}/resolve`, data });
  },
};
