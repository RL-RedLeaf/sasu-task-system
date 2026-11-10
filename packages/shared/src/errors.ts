/**
 * 统一错误码与 HTTP 状态映射（PRD §10.8）。
 * 后端抛 ApiError；前端按 code 映射文案，禁止展示裸错误码。
 */
export const ErrorCode = {
  UNAUTHORIZED: 1001,
  FORBIDDEN: 1002,
  VALIDATION_FAILED: 2001,
  POOL_INSUFFICIENT: 3001,
  QUOTA_FULL: 3002,
  CONCURRENT_CLAIM_LIMIT: 3003,
  BALANCE_INSUFFICIENT: 3004,
  TASK_STATE_NOT_ALLOWED: 3005,
  DUPLICATE_REQUEST: 3006,
  TASK_DEADLINE_PASSED: 3007,
  SETTLING_IN_PROGRESS: 3008,
  IDEMPOTENT_REPLAY: 3009,
  WITHDRAWAL_FREQUENCY_LIMIT: 3010,
  FROZEN_INSUFFICIENT: 3011,
  WITHDRAWAL_DISABLED: 3012,
  TASK_PENDING_REWARD: 3013,
  REWARD_BELOW_PAID: 3014,
  REWARD_LIMIT_EXCEEDED: 3015,
  ACCOUNT_DISABLED: 4001,
  MUST_CHANGE_PASSWORD: 4002,
  FILE_NOT_ACCEPTABLE: 5001,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const HttpStatusByCode: Record<ErrorCodeValue, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.POOL_INSUFFICIENT]: 409,
  [ErrorCode.QUOTA_FULL]: 409,
  [ErrorCode.CONCURRENT_CLAIM_LIMIT]: 409,
  [ErrorCode.BALANCE_INSUFFICIENT]: 409,
  [ErrorCode.TASK_STATE_NOT_ALLOWED]: 409,
  [ErrorCode.DUPLICATE_REQUEST]: 409,
  [ErrorCode.TASK_DEADLINE_PASSED]: 409,
  [ErrorCode.SETTLING_IN_PROGRESS]: 409,
  [ErrorCode.IDEMPOTENT_REPLAY]: 200,
  [ErrorCode.WITHDRAWAL_FREQUENCY_LIMIT]: 409,
  [ErrorCode.FROZEN_INSUFFICIENT]: 409,
  [ErrorCode.WITHDRAWAL_DISABLED]: 409,
  [ErrorCode.TASK_PENDING_REWARD]: 409,
  [ErrorCode.REWARD_BELOW_PAID]: 409,
  [ErrorCode.REWARD_LIMIT_EXCEEDED]: 409,
  [ErrorCode.ACCOUNT_DISABLED]: 403,
  [ErrorCode.MUST_CHANGE_PASSWORD]: 428,
  [ErrorCode.FILE_NOT_ACCEPTABLE]: 413,
};

/** 面向用户的默认文案（§13.5：说人话）。细节文案由前端按场景覆盖。 */
export const MessageByCode: Record<ErrorCodeValue, string> = {
  [ErrorCode.UNAUTHORIZED]: '登录已过期，请重新登录',
  [ErrorCode.FORBIDDEN]: '没有权限执行该操作',
  [ErrorCode.VALIDATION_FAILED]: '填写的内容有误，请检查后重试',
  [ErrorCode.POOL_INSUFFICIENT]: '积分池余额不足，请先充值',
  [ErrorCode.QUOTA_FULL]: '名额刚被抢完了，看看其他任务吧',
  [ErrorCode.CONCURRENT_CLAIM_LIMIT]: '同时进行的任务已达上限',
  [ErrorCode.BALANCE_INSUFFICIENT]: '积分余额不足',
  [ErrorCode.TASK_STATE_NOT_ALLOWED]: '当前任务状态不允许该操作',
  [ErrorCode.DUPLICATE_REQUEST]: '请勿重复提交',
  [ErrorCode.TASK_DEADLINE_PASSED]: '任务已截止',
  [ErrorCode.SETTLING_IN_PROGRESS]: '任务正在结算中，请稍后',
  [ErrorCode.IDEMPOTENT_REPLAY]: '重复请求，已返回首次结果',
  [ErrorCode.WITHDRAWAL_FREQUENCY_LIMIT]: '本月提现额度已使用，下月再试',
  [ErrorCode.FROZEN_INSUFFICIENT]: '冻结积分不足',
  [ErrorCode.WITHDRAWAL_DISABLED]: '提现功能未开放',
  [ErrorCode.TASK_PENDING_REWARD]: '任务尚未定价上架',
  [ErrorCode.REWARD_BELOW_PAID]: '已有学生按当前赏金通过验收，赏金只能维持或调高',
  [ErrorCode.REWARD_LIMIT_EXCEEDED]: '超出单人赏金上限或单任务总额上限',
  [ErrorCode.ACCOUNT_DISABLED]: '账号已被禁用，请联系管理员',
  [ErrorCode.MUST_CHANGE_PASSWORD]: '请先修改初始密码',
  [ErrorCode.FILE_NOT_ACCEPTABLE]: '文件类型或大小不符合要求',
};

/** 统一错误响应体（PRD §12.1：{ code, message, requestId, details? }） */
export interface ApiErrorBody {
  code: ErrorCodeValue | number;
  message: string;
  requestId?: string;
  details?: unknown;
}
