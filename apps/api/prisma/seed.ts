import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * M0 初始化数据（PRD §14 M0 交付清单）：
 * - 6 个任务分类（PRD §18.2）
 * - 30 项 system_configs（docs/parameter-decisions.md §8，逐字对齐默认值）
 * - 系统账户：SYS_ISSUE / SYS_CASHOUT / POOL（余额 0；不预建任何用户与提现数据）
 * 全部 upsert，可重复执行。
 */
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL ?? ''),
});

const CATEGORIES: { name: string; description: string; sortOrder: number }[] = [
  { name: '教学辅助', description: '会场布置、器材整理、实验协助、资料录入', sortOrder: 1 },
  { name: '校园服务', description: '搬运、引导、图书整理、迎新', sortOrder: 2 },
  { name: '学习辅导', description: '学科互助、竞赛陪练、经验分享', sortOrder: 3 },
  { name: '技能外包', description: '设计、剪辑、PPT、文案、摄影', sortOrder: 4 },
  { name: '信息征集', description: '问卷、作品征集、组队招募', sortOrder: 5 },
  { name: '其他', description: '兜底分类', sortOrder: 6 },
];

/** docs/parameter-decisions.md §8，共 30 项 */
const SYSTEM_CONFIGS: {
  key: string;
  valueType: 'INT' | 'DECIMAL' | 'JSON' | 'STRING' | 'ENUM';
  value: string;
  description: string;
}[] = [
  {
    key: 'POINT_TO_CASH_RATE',
    valueType: 'DECIMAL',
    value: '0.0000',
    description: '积分兑现金汇率；0 = 提现关闭',
  },
  { key: 'WITHDRAW_MIN_POINTS', valueType: 'INT', value: '50', description: '最低提现积分' },
  { key: 'WITHDRAW_MONTHLY_LIMIT', valueType: 'INT', value: '1', description: '每人每月提现次数' },
  {
    key: 'WITHDRAW_PERIOD_MODE',
    valueType: 'ENUM',
    value: 'APPLICATION_MONTH',
    description: '额度归属月：按申请月计',
  },
  {
    key: 'WITHDRAW_CASH_LIMIT_SINGLE',
    valueType: 'DECIMAL',
    value: '500.00',
    description: '单次现金上限（待校方）',
  },
  {
    key: 'WITHDRAW_CASH_LIMIT_MONTHLY',
    valueType: 'DECIMAL',
    value: '500.00',
    description: '每月现金上限（待校方）',
  },
  {
    key: 'VIOLATION_RATE_BP',
    valueType: 'INT',
    value: '2000',
    description: '违约金比例（万分比），20% 无下限无上限',
  },
  { key: 'TASK_REWARD_MIN', valueType: 'INT', value: '1', description: '单人赏金下限' },
  { key: 'TASK_REWARD_MAX', valueType: 'INT', value: '500', description: '单人赏金上限' },
  { key: 'TASK_TOTAL_MAX', valueType: 'INT', value: '10000', description: '单任务总额硬上限' },
  { key: 'TASK_HEADCOUNT_MAX', valueType: 'INT', value: '50', description: '名额上限' },
  {
    key: 'TASK_DEADLINE_MIN_HOURS',
    valueType: 'INT',
    value: '1',
    description: '截止时间最早距现在小时数',
  },
  { key: 'TASK_DEADLINE_MAX_DAYS', valueType: 'INT', value: '90', description: '截止时间最长天数' },
  {
    key: 'TASK_CONCURRENT_CLAIMS_MAX',
    valueType: 'INT',
    value: '5',
    description: '学生同时进行中任务上限',
  },
  {
    key: 'TASK_RESUBMIT_WINDOW_HOURS',
    valueType: 'INT',
    value: '24',
    description: '驳回后重交窗口小时数',
  },
  { key: 'TASK_REJECT_MAX', valueType: 'INT', value: '3', description: '每笔接单最多驳回次数' },
  {
    key: 'TASK_POST_DEADLINE_REVIEW_DAYS',
    valueType: 'INT',
    value: '14',
    description: '截止后必须处理完 SUBMITTED 的天数',
  },
  {
    key: 'TASK_PRICING_REMIND_HOURS',
    valueType: 'JSON',
    value: '[24,72]',
    description: '待定价提醒时点（小时）',
  },
  {
    key: 'REVIEW_REMIND_DAYS',
    valueType: 'JSON',
    value: '[3,7]',
    description: '未验收提醒/升级管理员时点（天）',
  },
  {
    key: 'DEADLINE_REMIND_HOURS',
    valueType: 'INT',
    value: '24',
    description: '任务截止前提醒教师的小时数',
  },
  {
    key: 'WITHDRAW_PENDING_REMIND_DAYS',
    valueType: 'INT',
    value: '3',
    description: '提现审批通过后超时提醒天数（汇率大于 0 时生效）',
  },
  { key: 'LOGIN_MAX_FAILS', valueType: 'INT', value: '5', description: '登录失败锁定阈值' },
  { key: 'LOGIN_LOCK_MINUTES', valueType: 'INT', value: '15', description: '登录锁定时长（分钟）' },
  { key: 'SESSION_DAYS', valueType: 'INT', value: '7', description: '会话保持天数' },
  {
    key: 'SENSITIVE_REAUTH_MINUTES',
    valueType: 'INT',
    value: '15',
    description: '敏感操作再验证有效期（分钟）',
  },
  { key: 'UPLOAD_MAX_MB', valueType: 'INT', value: '20', description: '单文件上传上限（MB）' },
  { key: 'UPLOAD_MAX_FILES', valueType: 'INT', value: '5', description: '单次上传文件数上限' },
  {
    key: 'NOTIFICATION_READ_RETENTION_DAYS',
    valueType: 'INT',
    value: '180',
    description: '已读通知保留天数（未读不删）',
  },
  { key: 'AUDIT_RETENTION_YEARS', valueType: 'INT', value: '3', description: '审计日志保留年数' },
  {
    key: 'TOTAL_ISSUE_WARN',
    valueType: 'INT',
    value: '100000',
    description: '累计发行预警线（仅提示）',
  },
];

async function main(): Promise<void> {
  for (const category of CATEGORIES) {
    await prisma.taskCategory.upsert({
      where: { name: category.name },
      update: { description: category.description, sortOrder: category.sortOrder },
      create: category,
    });
  }

  for (const config of SYSTEM_CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { valueType: config.valueType, value: config.value, description: config.description },
      create: config,
    });
  }

  // 系统账户：余额 0。SYS_ISSUE 之后恒为负（发行总量相反数），POOL/SYS_CASHOUT 恒非负。
  const systemAccounts = [
    { accountKey: 'POOL', ownerType: 'POOL' as const, ownerId: null },
    { accountKey: 'SYS_ISSUE', ownerType: 'SYS_ISSUE' as const, ownerId: null },
    { accountKey: 'SYS_CASHOUT', ownerType: 'SYS_CASHOUT' as const, ownerId: null },
  ];
  for (const account of systemAccounts) {
    await prisma.pointAccount.upsert({
      where: { accountKey: account.accountKey },
      update: {},
      create: account,
    });
  }

  // 引导管理员（仅不存在任何 ADMIN 时创建；初始密码见输出，首登强制改密）
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (adminCount === 0) {
    const { hashSync, genSaltSync } = await import('bcryptjs');
    await prisma.user.create({
      data: {
        username: 'admin',
        name: '系统管理员',
        role: 'ADMIN',
        passwordHash: hashSync('Admin@2026', genSaltSync(12)),
        mustChangePassword: true,
      },
    });
    console.log('seed: bootstrap admin created (username=admin, 初始密码 Admin@2026，首登需改密)');
  }

  const [categories, configs, accounts] = await Promise.all([
    prisma.taskCategory.count(),
    prisma.systemConfig.count(),
    prisma.pointAccount.count({ where: { ownerId: null } }),
  ]);
  console.log(
    `seed done: categories=${categories}, system_configs=${configs}, system_accounts=${accounts}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
