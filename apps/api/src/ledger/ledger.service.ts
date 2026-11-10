import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AccountOwnerType, LedgerBucket, TransactionType } from '@sasu/shared';
import { PrismaService } from '../common/prisma/prisma.service';

export type TxClient = Prisma.TransactionClient;

export interface LegInput {
  accountKey: string;
  ownerType: AccountOwnerType;
  ownerId?: bigint | null;
  bucket: LedgerBucket;
  delta: number;
}

export interface PostInput {
  type: TransactionType;
  bizKey: string;
  legs: LegInput[];
  taskId?: bigint | null;
  assignmentId?: bigint | null;
  withdrawalId?: bigint | null;
  disputeId?: bigint | null;
  operatorId?: bigint | null;
  reason?: string;
  requestId?: string;
}

export interface PostResult {
  transactionId: bigint;
  duplicate: boolean;
}

/**
 * 记账唯一入口（PRD §12.1 / §9.2.1）：
 * - 所有积分变动只能经由 post() 完成（业务模块禁止直改账表）；
 * - 每笔交易所有分录 delta 求和 = 0（不变式 3）；
 * - biz_key 全局唯一，重复写入视为幂等重放（不变式 11）；
 * - 账户行按 id 升序加锁（PRD §9.4 统一锁顺序）；
 * - 任何账户 balance/frozen 不得为负，SYS_ISSUE 例外（恒 ≤ 0，不变式 12）；
 * - 调用方负责在外层 $transaction 中先按 TASK → assignments 顺序锁定业务行。
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateAccount(
    tx: TxClient,
    accountKey: string,
    ownerType: AccountOwnerType,
    ownerId?: bigint | null,
  ) {
    const existing = await tx.pointAccount.findUnique({ where: { accountKey } });
    if (existing) return existing;
    try {
      return await tx.pointAccount.create({
        data: { accountKey, ownerType, ownerId: ownerId ?? null },
      });
    } catch {
      // 并发创建竞态：回读
      const account = await tx.pointAccount.findUnique({ where: { accountKey } });
      if (!account) throw new Error(`account create failed: ${accountKey}`);
      return account;
    }
  }

  /** 在当前事务内入账。bizKey 重复时返回 duplicate=true，不重复入账。 */
  async post(tx: TxClient, input: PostInput): Promise<PostResult> {
    const existing = await tx.pointTransaction.findUnique({ where: { bizKey: input.bizKey } });
    if (existing) return { transactionId: existing.id, duplicate: true };

    const sum = input.legs.reduce((acc, l) => acc + l.delta, 0);
    if (sum !== 0) {
      throw new Error(`分录不平衡：Σdelta = ${sum}（${input.type} / ${input.bizKey}）`);
    }

    // 1) 保证账户存在
    const accounts = new Map<
      string,
      { id: bigint; accountKey: string; balance: number; frozen: number; ownerType: AccountOwnerType }
    >();
    for (const leg of input.legs) {
      const account = await this.getOrCreateAccount(
        tx,
        leg.accountKey,
        leg.ownerType,
        leg.ownerId ?? null,
      );
      accounts.set(leg.accountKey, {
        id: account.id,
        accountKey: account.accountKey,
        balance: account.balance,
        frozen: account.frozen,
        ownerType: account.ownerType,
      });
    }

    // 2) 按 id 升序锁定所有涉及账户（统一锁顺序，PRD §9.4）
    const ids = [...accounts.values()].map((a) => a.id).sort((a, b) => (a < b ? -1 : 1));
    const idList = ids.map((id) => id.toString()).join(',');
    const locked = await tx.$queryRawUnsafe<{
      id: bigint;
      balance: number;
      frozen: number;
      owner_type: string;
    }[]>(`SELECT id, balance, frozen, owner_type FROM point_accounts WHERE id IN (${idList}) ORDER BY id FOR UPDATE`);
    for (const row of locked) {
      for (const account of accounts.values()) {
        if (account.id === row.id) {
          account.balance = row.balance;
          account.frozen = row.frozen;
          account.ownerType = row.owner_type as AccountOwnerType;
        }
      }
    }

    // 3) 逐分录更新余额并写快照
    const transaction = await tx.pointTransaction.create({
      data: {
        type: input.type,
        bizKey: input.bizKey,
        taskId: input.taskId ?? null,
        assignmentId: input.assignmentId ?? null,
        withdrawalId: input.withdrawalId ?? null,
        disputeId: input.disputeId ?? null,
        operatorId: input.operatorId ?? null,
        reason: input.reason,
        requestId: input.requestId,
      },
    });

    for (const leg of input.legs) {
      const account = accounts.get(leg.accountKey);
      if (!account) throw new Error(`account missing: ${leg.accountKey}`);
      let balanceAfter: number;
      if (leg.bucket === 'AVAILABLE') {
        balanceAfter = account.balance + leg.delta;
        account.balance = balanceAfter;
      } else {
        balanceAfter = account.frozen + leg.delta;
        account.frozen = balanceAfter;
      }
      this.assertBalanceInvariant(account.ownerType, account.balance, account.frozen);

      await tx.pointLeg.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          bucket: leg.bucket,
          delta: leg.delta,
          balanceAfter,
        },
      });
    }

    // 4) 汇总更新账户
    for (const account of accounts.values()) {
      const deltaIn = input.legs
        .filter((l) => l.accountKey === account.accountKey && l.delta > 0)
        .reduce((acc, l) => acc + l.delta, 0);
      const deltaOut = input.legs
        .filter((l) => l.accountKey === account.accountKey && l.delta < 0)
        .reduce((acc, l) => acc + l.delta, 0);
      await tx.pointAccount.update({
        where: { id: account.id },
        data: {
          balance: account.balance,
          frozen: account.frozen,
          totalIn: { increment: deltaIn },
          totalOut: { increment: -deltaOut },
        },
      });
    }

    return { transactionId: transaction.id, duplicate: false };
  }

  /** 不变式 12：SYS_ISSUE 恒 ≤ 0 且不冻结；其余账户非负 */
  assertBalanceInvariant(ownerType: AccountOwnerType, balance: number, frozen: number): void {
    if (ownerType === 'SYS_ISSUE') {
      if (balance > 0 || frozen !== 0) {
        throw new Error(`SYS_ISSUE 非法状态：balance=${balance}, frozen=${frozen}`);
      }
      return;
    }
    if (balance < 0 || frozen < 0) {
      throw new Error(`${ownerType} 余额不得为负：balance=${balance}, frozen=${frozen}`);
    }
  }

  // ------------------------------------------------------------------
  // 常用账户键
  // ------------------------------------------------------------------
  static readonly POOL = 'POOL';
  static readonly SYS_ISSUE = 'SYS_ISSUE';
  static readonly SYS_CASHOUT = 'SYS_CASHOUT';
  static userKey(userId: bigint): string {
    return `USER:${userId}`;
  }
  static taskKey(taskId: bigint): string {
    return `TASK:${taskId}`;
  }

  /**
   * 违约扣分（PRD §6.3 扣除顺序，防提现逃罚）：
   * 1. 先扣可用余额；2. 不足则自动驳回 PENDING/APPROVED 提现并解冻再扣；
   * 3. 仍不足记 penalty_debt（余额绝不为负）。
   * 返回实际扣额与新增欠分。调用方在外层事务内。
   */
  async deductViolation(
    tx: TxClient,
    input: {
      studentId: bigint;
      amount: number;
      bizKey: string;
      reason?: string;
      operatorId?: bigint | null;
      requestId?: string;
    },
  ): Promise<{ deducted: number; newDebt: number }> {
    if (input.amount <= 0) return { deducted: 0, newDebt: 0 };
    const userKey = LedgerService.userKey(input.studentId);

    // 1) 可用余额
    const account = await this.getOrCreateAccount(tx, userKey, 'USER', input.studentId);
    const fromAvailable = Math.min(account.balance, input.amount);
    if (fromAvailable > 0) {
      await this.post(tx, {
        type: 'VIOLATION_DEDUCT',
        bizKey: input.bizKey,
        legs: [
          {
            accountKey: userKey,
            ownerType: 'USER',
            ownerId: input.studentId,
            bucket: 'AVAILABLE',
            delta: -fromAvailable,
          },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: fromAvailable },
        ],
        reason: input.reason,
        operatorId: input.operatorId ?? null,
        requestId: input.requestId,
      });
    }
    let deducted = fromAvailable;
    let remaining = input.amount - fromAvailable;
    if (remaining <= 0) return { deducted, newDebt: 0 };

    // 2) 驳回待审批/已批准未发放提现并解冻（WITHDRAW_REFUND），再扣
    const withdrawals = await tx.withdrawal.findMany({
      where: { studentId: input.studentId, status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { id: 'asc' },
    });
    for (const w of withdrawals) {
      if (remaining <= 0) break;
      await tx.withdrawal.update({
        where: { id: w.id },
        data: { status: 'REJECTED', rejectReason: '违约扣分自动驳回', reviewedAt: new Date() },
      });
      await this.post(tx, {
        type: 'WITHDRAW_REFUND',
        bizKey: `WITHDRAW_REFUND:${w.id}:viol:${input.bizKey}`,
        legs: [
          {
            accountKey: userKey,
            ownerType: 'USER',
            ownerId: input.studentId,
            bucket: 'FROZEN',
            delta: -w.points,
          },
          {
            accountKey: userKey,
            ownerType: 'USER',
            ownerId: input.studentId,
            bucket: 'AVAILABLE',
            delta: w.points,
          },
        ],
        reason: '违约扣分自动驳回',
      });
      const take = Math.min(w.points, remaining);
      await this.post(tx, {
        type: 'VIOLATION_DEDUCT',
        bizKey: `${input.bizKey}:w${w.id}`,
        legs: [
          {
            accountKey: userKey,
            ownerType: 'USER',
            ownerId: input.studentId,
            bucket: 'AVAILABLE',
            delta: -take,
          },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: take },
        ],
        reason: input.reason,
      });
      deducted += take;
      remaining -= take;
    }
    if (remaining <= 0) return { deducted, newDebt: 0 };

    // 3) 记欠分（不入账，余额绝不为负）
    await tx.user.update({
      where: { id: input.studentId },
      data: { penaltyDebt: { increment: remaining } },
    });
    return { deducted, newDebt: remaining };
  }

  /**
   * 收入入账 + 欠分优先抵扣（PRD §6.3 第 6 条：DEBT_OFFSET 覆盖所有入账类型）。
   * income 落入学生可用余额；若 penalty_debt > 0，另记 DEBT_OFFSET 扣回。
   */
  async creditUser(
    tx: TxClient,
    input: {
      userId: bigint;
      amount: number;
      txType: TransactionType;
      bizKey: string;
      sourceKey: string;
      sourceOwnerType: AccountOwnerType;
      sourceOwnerId?: bigint | null;
      taskId?: bigint | null;
      assignmentId?: bigint | null;
      reason?: string;
      operatorId?: bigint | null;
      requestId?: string;
    },
  ): Promise<{ credited: number; debtOffset: number; transactionId: bigint; duplicate: boolean }> {
    if (input.amount <= 0) {
      return { credited: 0, debtOffset: 0, transactionId: 0n, duplicate: false };
    }
    const userKey = LedgerService.userKey(input.userId);
    const result = await this.post(tx, {
      type: input.txType,
      bizKey: input.bizKey,
      legs: [
        {
          accountKey: input.sourceKey,
          ownerType: input.sourceOwnerType,
          ownerId: input.sourceOwnerId ?? null,
          bucket: 'AVAILABLE',
          delta: -input.amount,
        },
        {
          accountKey: userKey,
          ownerType: 'USER',
          ownerId: input.userId,
          bucket: 'AVAILABLE',
          delta: input.amount,
        },
      ],
      taskId: input.taskId ?? null,
      assignmentId: input.assignmentId ?? null,
      reason: input.reason,
      operatorId: input.operatorId ?? null,
      requestId: input.requestId,
    });
    if (result.duplicate) return { credited: input.amount, debtOffset: 0, transactionId: result.transactionId, duplicate: true };

    const user = await tx.user.findUnique({ where: { id: input.userId } });
    const debt = user?.penaltyDebt ?? 0;
    if (debt > 0) {
      const offset = Math.min(debt, input.amount);
      await this.post(tx, {
        type: 'DEBT_OFFSET',
        bizKey: `DEBT_OFFSET:${result.transactionId}`,
        legs: [
          {
            accountKey: userKey,
            ownerType: 'USER',
            ownerId: input.userId,
            bucket: 'AVAILABLE',
            delta: -offset,
          },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: offset },
        ],
        reason: '欠分抵扣',
        requestId: input.requestId,
      });
      await tx.user.update({
        where: { id: input.userId },
        data: { penaltyDebt: { decrement: offset } },
      });
      return { credited: input.amount, debtOffset: offset, transactionId: result.transactionId, duplicate: false };
    }
    return { credited: input.amount, debtOffset: 0, transactionId: result.transactionId, duplicate: false };
  }
}
