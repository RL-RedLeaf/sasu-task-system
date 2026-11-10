import { request } from './http';
import type { PageData } from './tasks';

export interface UserRow {
  id: string;
  username: string;
  name: string;
  role: string;
  className: string | null;
  email: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  violationCount: number;
  penaltyDebt: number;
  createdAt: string;
}

export const usersApi = {
  adminList(params: Record<string, unknown>): Promise<PageData<UserRow>> {
    return request({ method: 'GET', url: '/admin/users', params });
  },
  create(data: { username: string; name: string; role: string; className?: string; email?: string }): Promise<{ id: string; initialPassword: string }> {
    return request({ method: 'POST', url: '/admin/users', data });
  },
  update(id: string, data: Record<string, unknown>): Promise<void> {
    return request({ method: 'PATCH', url: `/admin/users/${id}`, data });
  },
  disable(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/users/${id}/disable`, data: { reason } });
  },
  enable(id: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/users/${id}/enable` });
  },
  resetPassword(id: string): Promise<{ initialPassword: string }> {
    return request({ method: 'POST', url: `/admin/users/${id}/reset-password` });
  },
  async import(file: File): Promise<{
    batchId: string;
    totalRows: number;
    successRows: number;
    failedRows: number;
    initialPasswords: { username: string; password: string }[];
    errors: { row: number; username?: string; error: string }[];
  }> {
    const form = new FormData();
    form.append('file', file);
    return request({
      method: 'POST',
      url: '/admin/users/import',
      data: form,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importErrors(batchId: string): Promise<{ items: { rowNum: number; reason: string }[] }> {
    return request({ method: 'GET', url: `/admin/users/import/${batchId}/errors` });
  },
};

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export const categoriesApi = {
  list(): Promise<{ items: CategoryRow[] }> {
    return request({ method: 'GET', url: '/categories' });
  },
  create(data: { name: string; description?: string; sortOrder?: number }): Promise<void> {
    return request({ method: 'POST', url: '/admin/categories', data });
  },
  update(id: string, data: Partial<{ name: string; description: string; sortOrder: number }>): Promise<void> {
    return request({ method: 'POST', url: `/admin/categories/${id}/update`, data });
  },
  remove(id: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/categories/${id}/delete` });
  },
};

export interface ConfigRow {
  id: string;
  key: string;
  valueType: string;
  value: string;
  description: string | null;
}

export const settingsApi = {
  list(): Promise<{ items: ConfigRow[] }> {
    return request({ method: 'GET', url: '/admin/settings' });
  },
  update(key: string, value: string): Promise<void> {
    return request({ method: 'PATCH', url: '/admin/settings', data: { key, value } });
  },
};

export interface AuditRow {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export const auditApi = {
  list(params: Record<string, unknown>): Promise<PageData<AuditRow>> {
    return request({ method: 'GET', url: '/admin/audit-logs', params });
  },
};

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

export const communityApi = {
  announcements(): Promise<{ items: AnnouncementRow[] }> {
    return request({ method: 'GET', url: '/announcements' });
  },
  adminAnnouncements(params?: Record<string, unknown>): Promise<PageData<AnnouncementRow>> {
    return request({ method: 'GET', url: '/admin/announcements', params });
  },
  createAnnouncement(data: { title: string; content: string; status?: string }): Promise<void> {
    return request({ method: 'POST', url: '/admin/announcements', data });
  },
  updateAnnouncement(id: string, data: Partial<{ title: string; content: string; status: string }>): Promise<void> {
    return request({ method: 'POST', url: `/admin/announcements/${id}/update`, data });
  },
  comments(taskId: string): Promise<{ items: { id: string; content: string; author: { name: string; role: string }; createdAt: string }[] }> {
    return request({ method: 'GET', url: `/tasks/${taskId}/comments` });
  },
  addComment(taskId: string, content: string, parentId?: number): Promise<void> {
    return request({ method: 'POST', url: `/tasks/${taskId}/comments`, data: { content, parentId } });
  },
  deleteComment(id: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/comments/${id}/delete` });
  },
  report(data: { targetType: 'TASK' | 'COMMENT'; targetId: number; reason: string }): Promise<void> {
    return request({ method: 'POST', url: '/reports', data });
  },
  adminReports(params?: Record<string, unknown>): Promise<PageData<{ id: string; targetType: string; targetId: string; reason: string; status: string; createdAt: string; reporter: { name: string } }>> {
    return request({ method: 'GET', url: '/admin/reports', params });
  },
  handleReport(id: string, data: { note?: string; dismiss?: boolean }): Promise<void> {
    return request({ method: 'POST', url: `/admin/reports/${id}/handle`, data });
  },
};

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: { taskId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list(params?: Record<string, unknown>): Promise<PageData<NotificationRow> & { unread: number }> {
    return request({ method: 'GET', url: '/notifications', params });
  },
  markRead(id: string): Promise<void> {
    return request({ method: 'POST', url: `/notifications/${id}/read` });
  },
  markAllRead(): Promise<void> {
    return request({ method: 'POST', url: '/notifications/read-all' });
  },
};

export const statsApi = {
  overview(): Promise<{
    tasksByStatus: Record<string, number>;
    usersByRole: Record<string, number>;
    pendingReward: number;
    paidBaseTotal: number;
    paidBonusTotal: number;
    refundedTotal: number;
    violationTotal: number;
    withdrawalsPending: number;
    disputesOpen: number;
    reportsOpen: number;
    completionRate: number;
  }> {
    return request({ method: 'GET', url: '/admin/stats/overview' });
  },
  exportUrl: '/api/v1/admin/stats/export',
  usersExportUrl: '/api/v1/admin/users/export',
  importTemplateUrl: '/api/v1/admin/users/import-template',
};
