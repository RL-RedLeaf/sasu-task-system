import type {
  AssignmentStatus,
  DisputeStatus,
  Role,
  TaskStatus,
  TransactionType,
  WithdrawalStatus,
} from './enums';

/**
 * 面向用户的中文文案映射（PRD §13.5：说人话，不暴露后端码）。
 * 与 enums.ts 同源维护；显示时查不到的值回退为原值。
 */

export const ROLE_LABELS: Record<Role, string> = {
  STUDENT: '学生',
  TEACHER: '教师',
  ADMIN: '管理员',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING_REWARD: '待定价',
  RECRUITING: '招募中',
  FULL: '已满',
  OFFLINE: '已下架',
  CLOSED: '已截止',
  SETTLED: '已完成',
  CANCELLED: '已取消',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  CLAIMED: '进行中',
  SUBMITTED: '待验收',
  ACCEPTED: '已通过',
  REJECTED: '被驳回',
  FAILED: '未完成',
  OVERDUE: '违约',
  WITHDRAWN: '已取消',
  CANCELLED_BY_TEACHER: '已取消',
  SETTLED: '已结算',
};

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  PENDING: '待审批',
  APPROVED: '待发放',
  PAID: '已发放',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: '待裁定',
  RESOLVED: '已裁定',
  REJECTED: '已驳回',
};

/** 积分流水类型 → 用户能看懂的短语（PRD §9.2.1） */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  POOL_TOPUP: '积分池充值',
  POOL_ADJUST_DOWN: '积分池调减',
  ADMIN_GRANT: '管理员发放',
  ADMIN_DEDUCT: '管理员扣减',
  TASK_FREEZE: '任务定价',
  TASK_PAYOUT: '验收发放',
  TASK_REPRICE_TOPUP: '赏金上调补差',
  TASK_ARBITRATION: '仲裁发放',
  TASK_BONUS: '结算再分配',
  TASK_REFUND: '退回积分池',
  VIOLATION_DEDUCT: '违约扣分',
  DEBT_OFFSET: '欠分抵扣',
  WITHDRAW_FREEZE: '提现冻结',
  WITHDRAW_REFUND: '提现解冻',
  WITHDRAW_PAID: '提现发放',
  ARBITRATION_PAY: '仲裁补偿',
};

/** 审计动作 → 中文（管理端审计页） */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  USER_CREATE: '创建账号',
  USER_UPDATE: '更新账号',
  USER_DISABLE: '禁用账号',
  USER_ENABLE: '启用账号',
  USER_RESET_PASSWORD: '重置密码',
  USER_IMPORT: 'Excel 导入',
  POOL_TOPUP: '积分池充值',
  POOL_ADJUST: '积分池调整',
  ADMIN_GRANT: '发放积分',
  ADMIN_DEDUCT: '扣减积分',
  TASK_CREATE: '发布任务',
  TASK_EDIT: '编辑任务',
  TASK_PRICE: '任务定价',
  TASK_REPRICE: '任务改价',
  TASK_CLOSE: '关闭任务',
  TASK_CANCEL: '取消任务',
  TASK_FORCE_CANCEL: '强制取消任务',
  TASK_OFFLINE: '强制下架任务',
  WITHDRAWAL_APPROVE: '提现审批通过',
  WITHDRAWAL_REJECT: '驳回提现',
  WITHDRAWAL_PAY: '提现发放',
  DISPUTE_RESOLVE: '仲裁裁定',
  ANNOUNCEMENT_CREATE: '发布公告',
  ANNOUNCEMENT_UPDATE: '更新公告',
  COMMENT_DELETE: '删除留言',
  REPORT_HANDLE: '处理举报',
  CONFIG_UPDATE: '修改系统配置',
  CATEGORY_CREATE: '新建分类',
  CATEGORY_UPDATE: '更新分类',
  CATEGORY_DELETE: '删除分类',
  DEV_FORCE_DEADLINE: '调试：强制任务到期',
};

type LabelMap = Record<string, string>;

function lookup(map: LabelMap, value: string | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? value;
}

export const labelOf = {
  role: (v: string | null | undefined) => lookup(ROLE_LABELS, v),
  taskStatus: (v: string | null | undefined) => lookup(TASK_STATUS_LABELS, v),
  assignmentStatus: (v: string | null | undefined) => lookup(ASSIGNMENT_STATUS_LABELS, v),
  withdrawalStatus: (v: string | null | undefined) => lookup(WITHDRAWAL_STATUS_LABELS, v),
  disputeStatus: (v: string | null | undefined) => lookup(DISPUTE_STATUS_LABELS, v),
  transactionType: (v: string | null | undefined) => lookup(TRANSACTION_TYPE_LABELS, v),
  auditAction: (v: string | null | undefined) => lookup(AUDIT_ACTION_LABELS, v),
};
