import { request } from './http';

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  requirement: string | null;
  location: string | null;
  contactInfo: string | null;
  rewardPerPerson: number | null;
  headcount: number;
  filledCount: number;
  acceptedCount: number;
  totalAmount: number;
  paidBaseAmount: number;
  paidBonusAmount: number;
  refundedAmount: number;
  status: string;
  settlementStatus: string;
  settlementMode: string;
  deadlineAt: string;
  createdAt: string;
  version: number;
  category?: { name: string };
  teacher?: { name: string; className?: string };
  remaining?: number;
  myAssignment?: { id: string; status: string } | null;
  attachments?: { file: { id: string; originalName: string; mime: string } }[];
}

export interface AssignmentRow {
  id: string;
  studentId: string;
  attemptNo: number;
  status: string;
  claimedAt: string;
  acceptedAt: string | null;
  resubmitDeadline: string | null;
  rejectCount: number;
  basePaid: number;
  bonusPaid: number;
  isViolation: boolean;
  violationPenalty: number;
  student: { id: string; name: string; className: string | null };
  submissions: { id: string; version: number; status: string; submittedAt: string }[];
}

export interface PageData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const tasksApi = {
  hall(params: Record<string, unknown>): Promise<PageData<TaskSummary>> {
    return request({ method: 'GET', url: '/tasks', params });
  },
  detail(id: string): Promise<TaskSummary> {
    return request({ method: 'GET', url: `/tasks/${id}` });
  },
  create(data: Record<string, unknown>): Promise<{ id: string; status: string }> {
    return request({ method: 'POST', url: '/tasks', data });
  },
  edit(id: string, data: Record<string, unknown>): Promise<{ changed: number; version: number }> {
    return request({ method: 'PATCH', url: `/tasks/${id}`, data });
  },
  myTasks(params: Record<string, unknown>): Promise<PageData<TaskSummary>> {
    return request({ method: 'GET', url: '/teacher/tasks', params });
  },
  taskAssignments(id: string): Promise<{ items: AssignmentRow[] }> {
    return request({ method: 'GET', url: `/tasks/${id}/assignments` });
  },
  claim(id: string): Promise<{ assignmentId: string }> {
    return request({ method: 'POST', url: `/tasks/${id}/claims` });
  },
  myAssignments(params?: Record<string, unknown>): Promise<PageData<AssignmentRow & { task: TaskSummary }>> {
    return request({ method: 'GET', url: '/assignments/me', params });
  },
  withdrawClaim(assignmentId: string): Promise<void> {
    return request({ method: 'DELETE', url: `/assignments/${assignmentId}` });
  },
  close(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/tasks/${id}/close`, data: { reason } });
  },
  cancel(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/tasks/${id}/cancel`, data: { reason } });
  },
  // 管理端
  adminList(params: Record<string, unknown>): Promise<PageData<TaskSummary>> {
    return request({ method: 'GET', url: '/admin/tasks', params });
  },
  price(id: string, rewardPerPerson: number): Promise<{ totalAmount: number }> {
    return request({ method: 'POST', url: `/admin/tasks/${id}/price`, data: { rewardPerPerson } });
  },
  reprice(id: string, rewardPerPerson: number, reason: string): Promise<{ topupPaid: number; budget: number }> {
    return request({ method: 'PATCH', url: `/admin/tasks/${id}/reward`, data: { rewardPerPerson, reason } });
  },
  forceClose(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/tasks/${id}/close`, data: { reason } });
  },
  forceCancel(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/tasks/${id}/cancel`, data: { reason } });
  },
  forceOffline(id: string, reason: string): Promise<void> {
    return request({ method: 'POST', url: `/admin/tasks/${id}/offline`, data: { reason } });
  },
  settlementPreview(id: string): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: `/admin/tasks/${id}/settlement-preview` });
  },
  runJob(job: string, forceDeadlineTaskId?: number): Promise<void> {
    return request({ method: 'POST', url: '/admin/jobs/run', data: { job, forceDeadlineTaskId } });
  },
};

export const submissionsApi = {
  submit(assignmentId: string, content: string, files: File[]): Promise<{ submissionId: string; version: number }> {
    const form = new FormData();
    form.append('content', content);
    for (const f of files) form.append('files', f);
    return request({
      method: 'POST',
      url: `/assignments/${assignmentId}/submissions`,
      data: form,
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  history(assignmentId: string): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: `/assignments/${assignmentId}/submissions` });
  },
  review(
    assignmentId: string,
    decision: 'ACCEPT' | 'REJECT',
    reason?: string,
    isProxy?: boolean,
  ): Promise<void> {
    return request({
      method: 'POST',
      url: `/assignments/${assignmentId}/review`,
      data: { decision, reason, isProxy },
    });
  },
  downloadFile(fileId: string): Promise<{ meta: { originalName: string; mime: string }; contentBase64: string }> {
    return request({ method: 'GET', url: `/files/${fileId}` });
  },
};
