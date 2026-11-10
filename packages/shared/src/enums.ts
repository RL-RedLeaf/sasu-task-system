/**
 * 全部状态机枚举（PRD §5.4 / §5.5 / §9.2）。
 * 枚举值即数据库 ENUM 值，改动必须同步 prisma/schema.prisma 与 migration。
 */

export const Role = {
  STUDENT: 'STUDENT',
  TEACHER: 'TEACHER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** 任务状态机（PRD §5.4） */
export const TaskStatus = {
  PENDING_REWARD: 'PENDING_REWARD',
  RECRUITING: 'RECRUITING',
  FULL: 'FULL',
  OFFLINE: 'OFFLINE',
  CLOSED: 'CLOSED',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** 结算子状态：只存在于 tasks.settlement_status，任务状态不再有 SETTLING */
export const SettlementStatus = {
  OPEN: 'OPEN',
  SETTLING: 'SETTLING',
  DONE: 'DONE',
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const SettlementMode = {
  NORMAL: 'NORMAL',
  REFUND_ONLY: 'REFUND_ONLY',
} as const;
export type SettlementMode = (typeof SettlementMode)[keyof typeof SettlementMode];

export const CancelType = {
  TEACHER: 'TEACHER',
  ADMIN: 'ADMIN',
} as const;
export type CancelType = (typeof CancelType)[keyof typeof CancelType];

/** 接单状态机（PRD §5.5）：SUBMITTED 永不因截止变 OVERDUE；OVERDUE 只能来自 CLAIMED */
export const AssignmentStatus = {
  CLAIMED: 'CLAIMED',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  OVERDUE: 'OVERDUE',
  WITHDRAWN: 'WITHDRAWN',
  CANCELLED_BY_TEACHER: 'CANCELLED_BY_TEACHER',
  SETTLED: 'SETTLED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

/** 活跃接单：占用名额、计入并发上限（PRD §6.3） */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  AssignmentStatus.CLAIMED,
  AssignmentStatus.SUBMITTED,
  AssignmentStatus.REJECTED,
];

export const SubmissionStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export const ReviewDecision = {
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
} as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

/** 账户类型（PRD §9.2 point_accounts） */
export const AccountOwnerType = {
  POOL: 'POOL',
  TASK_ESCROW: 'TASK_ESCROW',
  USER: 'USER',
  SYS_ISSUE: 'SYS_ISSUE',
  SYS_CASHOUT: 'SYS_CASHOUT',
} as const;
export type AccountOwnerType = (typeof AccountOwnerType)[keyof typeof AccountOwnerType];

export const LedgerBucket = {
  AVAILABLE: 'AVAILABLE',
  FROZEN: 'FROZEN',
} as const;
export type LedgerBucket = (typeof LedgerBucket)[keyof typeof LedgerBucket];

/** 交易类型与分录模板（PRD §9.2.1） */
export const TransactionType = {
  POOL_TOPUP: 'POOL_TOPUP',
  POOL_ADJUST_DOWN: 'POOL_ADJUST_DOWN',
  ADMIN_GRANT: 'ADMIN_GRANT',
  ADMIN_DEDUCT: 'ADMIN_DEDUCT',
  TASK_FREEZE: 'TASK_FREEZE',
  TASK_PAYOUT: 'TASK_PAYOUT',
  TASK_REPRICE_TOPUP: 'TASK_REPRICE_TOPUP',
  TASK_ARBITRATION: 'TASK_ARBITRATION',
  TASK_BONUS: 'TASK_BONUS',
  TASK_REFUND: 'TASK_REFUND',
  VIOLATION_DEDUCT: 'VIOLATION_DEDUCT',
  DEBT_OFFSET: 'DEBT_OFFSET',
  WITHDRAW_FREEZE: 'WITHDRAW_FREEZE',
  WITHDRAW_REFUND: 'WITHDRAW_REFUND',
  WITHDRAW_PAID: 'WITHDRAW_PAID',
  ARBITRATION_PAY: 'ARBITRATION_PAY',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const WithdrawalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type WithdrawalStatus = (typeof WithdrawalStatus)[keyof typeof WithdrawalStatus];

/** PENDING/APPROVED/PAID 均占当月提现额度（PRD §6.6） */
export const WITHDRAWAL_QUOTA_OCCUPYING: readonly WithdrawalStatus[] = [
  WithdrawalStatus.PENDING,
  WithdrawalStatus.APPROVED,
  WithdrawalStatus.PAID,
];

export const DisputeStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const DisputeDecision = {
  PAY_FULL: 'PAY_FULL',
  PAY_PARTIAL: 'PAY_PARTIAL',
  REJECT: 'REJECT',
} as const;
export type DisputeDecision = (typeof DisputeDecision)[keyof typeof DisputeDecision];

export const SettlementKind = {
  BASE: 'BASE',
  BONUS: 'BONUS',
  REFUND: 'REFUND',
} as const;
export type SettlementKind = (typeof SettlementKind)[keyof typeof SettlementKind];

export const FileVisibility = {
  TASK_PUBLIC: 'TASK_PUBLIC',
  TASK_PARTICIPANT: 'TASK_PARTICIPANT',
  SUBMISSION_OWNER: 'SUBMISSION_OWNER',
  DISPUTE_PARTY: 'DISPUTE_PARTY',
  ADMIN_ONLY: 'ADMIN_ONLY',
} as const;
export type FileVisibility = (typeof FileVisibility)[keyof typeof FileVisibility];

export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  FAILED: 'FAILED',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const SettlementBatchStatus = {
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type SettlementBatchStatus =
  (typeof SettlementBatchStatus)[keyof typeof SettlementBatchStatus];

export const AnnouncementStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  OFFLINE: 'OFFLINE',
} as const;
export type AnnouncementStatus = (typeof AnnouncementStatus)[keyof typeof AnnouncementStatus];

export const ReportTargetType = {
  TASK: 'TASK',
  COMMENT: 'COMMENT',
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

export const ReportStatus = {
  OPEN: 'OPEN',
  HANDLED: 'HANDLED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const OutboxChannel = {
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
} as const;
export type OutboxChannel = (typeof OutboxChannel)[keyof typeof OutboxChannel];

export const OutboxStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export const JobRunStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type JobRunStatus = (typeof JobRunStatus)[keyof typeof JobRunStatus];

/** system_configs.value_type（docs/parameter-decisions.md §8） */
export const ConfigValueType = {
  INT: 'INT',
  DECIMAL: 'DECIMAL',
  JSON: 'JSON',
  STRING: 'STRING',
  ENUM: 'ENUM',
} as const;
export type ConfigValueType = (typeof ConfigValueType)[keyof typeof ConfigValueType];
