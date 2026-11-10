import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface ReconcileViolation {
  invariant: number;
  detail: string;
}

export interface ReconcileReport {
  ok: boolean;
  checkedAt: string;
  violations: ReconcileViolation[];
}

/**
 * 对账（PRD §9.3）：在 REPEATABLE READ 一致性快照中执行 13 条不变式，
 * 返回具体违规行而不是布尔值。
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<ReconcileReport> {
    const violations = await this.prisma.$transaction(
      async (tx) => this.checkAll(tx as Prisma.TransactionClient),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { ok: violations.length === 0, checkedAt: new Date().toISOString(), violations };
  }

  private async checkAll(tx: Prisma.TransactionClient): Promise<ReconcileViolation[]> {
    const violations: ReconcileViolation[] = [];
    const push = (invariant: number, detail: string) => violations.push({ invariant, detail });

    // 不变式 1：总量守恒 Σ(balance+frozen) = 0
    const total = await tx.pointAccount.aggregate({
      _sum: { balance: true, frozen: true },
    });
    const totalSum = (total._sum.balance ?? 0) + (total._sum.frozen ?? 0);
    if (totalSum !== 0) push(1, `Σ(balance+frozen) = ${totalSum}，应为 0`);

    // 不变式 2：发行口径 issued = -SYS_ISSUE.balance
    const sysIssue = await tx.pointAccount.findUnique({ where: { accountKey: 'SYS_ISSUE' } });
    const issued = -(sysIssue?.balance ?? 0);
    const [pool, escrowAgg, userAgg, sysCash] = await Promise.all([
      tx.pointAccount.findUnique({ where: { accountKey: 'POOL' } }),
      tx.pointAccount.aggregate({ where: { ownerType: 'TASK_ESCROW' }, _sum: { balance: true } }),
      tx.pointAccount.aggregate({
        where: { ownerType: 'USER' },
        _sum: { balance: true, frozen: true },
      }),
      tx.pointAccount.findUnique({ where: { accountKey: 'SYS_CASHOUT' } }),
    ]);
    const issuedCheck =
      (pool?.balance ?? 0) +
      (escrowAgg._sum.balance ?? 0) +
      (userAgg._sum.balance ?? 0) +
      (userAgg._sum.frozen ?? 0) +
      (sysCash?.balance ?? 0);
    if (issued !== issuedCheck) {
      push(2, `issued=${issued} 与 POOL+托管+用户+兑付合计 ${issuedCheck} 不一致`);
    }

    // 不变式 3：每笔交易分录求和 = 0
    const unbalanced = await tx.$queryRawUnsafe<{ biz_key: string; s: number }[]>(
      `SELECT t.biz_key AS biz_key, SUM(l.delta) AS s FROM point_transactions t
       JOIN point_legs l ON l.transaction_id = t.id GROUP BY t.id HAVING s <> 0 LIMIT 20`,
    );
    for (const row of unbalanced) push(3, `交易 ${row.biz_key} 分录和 ${row.s} ≠ 0`);

    // 不变式 4：账户余额 = Σ(delta)（应用层逐账户校验，账户量级 ≤ 数千）
    const accounts = await tx.pointAccount.findMany();
    const legSums = await tx.$queryRawUnsafe<{ account_id: bigint; bucket: string; s: number; max_id: bigint }[]>(
      `SELECT account_id, bucket, SUM(delta) AS s, MAX(id) AS max_id
       FROM point_legs GROUP BY account_id, bucket`,
    );
    const sumMap = new Map<string, { s: number }>();
    for (const r of legSums) sumMap.set(`${r.account_id}:${r.bucket}`, { s: r.s });
    for (const a of accounts) {
      const avail = sumMap.get(`${a.id}:AVAILABLE`)?.s ?? 0;
      const froz = sumMap.get(`${a.id}:FROZEN`)?.s ?? 0;
      if (avail !== a.balance) push(4, `账户 ${a.accountKey} AVAILABLE 快照 ${a.balance} ≠ Σdelta ${avail}`);
      if (froz !== a.frozen) push(4, `账户 ${a.accountKey} FROZEN 快照 ${a.frozen} ≠ Σdelta ${froz}`);
    }

    // 不变式 5：任务守恒
    const tasks = await tx.task.findMany({
      include: { settlementBatch: true },
    });
    for (const t of tasks) {
      const escrow = await tx.pointAccount.findUnique({
        where: { accountKey: `TASK:${t.id}` },
      });
      const escrowBalance = escrow?.balance ?? 0;
      const lhs =
        t.paidBaseAmount + t.paidBonusAmount + t.refundedAmount + escrowBalance;
      if (lhs !== t.totalAmount) {
        push(5, `任务 ${t.id}：paid+bonus+refund+escrow(${lhs}) ≠ total_amount(${t.totalAmount})`);
      }
      if (t.status === 'PENDING_REWARD') {
        if (t.rewardPerPerson !== null || t.totalAmount !== 0 || t.refundedAmount !== 0) {
          push(5, `待定价任务 ${t.id} 不应有 reward/total/refund`);
        }
      } else if (t.rewardPerPerson !== null) {
        if (t.totalAmount < t.rewardPerPerson * t.headcount) {
          push(5, `任务 ${t.id}：total_amount ${t.totalAmount} < R×N ${t.rewardPerPerson * t.headcount}`);
        }
        if (t.settlementStatus !== 'DONE' && t.totalAmount - t.refundedAmount !== t.rewardPerPerson * t.headcount) {
          push(5, `任务 ${t.id}（未结算）：total-refund ${t.totalAmount - t.refundedAmount} ≠ R×N`);
        }
      }
      // 不变式 10：终态清理
      if (t.status === 'SETTLED' || t.status === 'CANCELLED') {
        if (escrowBalance !== 0) push(10, `终态任务 ${t.id} 托管余额 ${escrowBalance} ≠ 0`);
        const activeCount = await tx.taskAssignment.count({
          where: { taskId: t.id, status: { in: ['CLAIMED', 'SUBMITTED', 'REJECTED'] } },
        });
        if (activeCount > 0) push(10, `终态任务 ${t.id} 仍有 ${activeCount} 条活跃接单`);
      }
    }

    // 不变式 6：POOL 不冻结；托管归属
    if ((pool?.frozen ?? 0) !== 0) push(6, `POOL.frozen = ${pool?.frozen}，应为 0`);
    const openTasks = tasks.filter(
      (t) => t.status !== 'SETTLED' && t.status !== 'CANCELLED' && t.status !== 'PENDING_REWARD',
    );
    const expectedEscrow = openTasks.reduce(
      (acc, t) => acc + (t.totalAmount - t.paidBaseAmount - t.paidBonusAmount - t.refundedAmount),
      0,
    );
    if ((escrowAgg._sum.balance ?? 0) !== expectedEscrow) {
      push(6, `Σ TASK_ESCROW.balance ${escrowAgg._sum.balance ?? 0} ≠ 非终态任务应托管 ${expectedEscrow}`);
    }

    // 不变式 7：提现冻结
    const frozenWithdrawals = await tx.withdrawal.aggregate({
      where: { status: { in: ['PENDING', 'APPROVED'] } },
      _sum: { points: true },
    });
    if ((userAgg._sum.frozen ?? 0) !== (frozenWithdrawals._sum.points ?? 0)) {
      push(7, `Σ USER.frozen ${userAgg._sum.frozen ?? 0} ≠ 待处理提现合计 ${frozenWithdrawals._sum.points ?? 0}`);
    }

    // 不变式 8：违约金
    const deductSum = await tx.$queryRawUnsafe<{ s: number }[]>(
      `SELECT COALESCE(SUM(-l.delta),0) AS s FROM point_legs l
       JOIN point_transactions t ON t.id = l.transaction_id
       WHERE t.type IN ('VIOLATION_DEDUCT','DEBT_OFFSET') AND l.delta < 0 AND l.bucket='AVAILABLE'
         AND l.account_id IN (SELECT id FROM point_accounts WHERE owner_type='USER')`,
    );
    const deductedAgg = await tx.taskAssignment.aggregate({ _sum: { violationDeducted: true } });
    if ((deductSum[0]?.s ?? 0) !== (deductedAgg._sum.violationDeducted ?? 0)) {
      push(8, `违约扣款流水 ${deductSum[0]?.s ?? 0} ≠ Σ violation_deducted ${deductedAgg._sum.violationDeducted ?? 0}`);
    }

    // 不变式 9：发放对应
    const accepted = await tx.taskAssignment.findMany({
      where: { status: { in: ['ACCEPTED', 'SETTLED'] } },
      select: { id: true, basePaid: true },
    });
    const payoutTxs = await tx.pointTransaction.findMany({
      where: { type: { in: ['TASK_PAYOUT', 'TASK_ARBITRATION'] } },
      select: { assignmentId: true },
    });
    const payoutAssignmentIds = new Set(payoutTxs.map((t) => t.assignmentId?.toString()));
    for (const a of accepted) {
      if (a.basePaid > 0 && !payoutAssignmentIds.has(a.id.toString())) {
        push(9, `接单 ${a.id} 已发放 ${a.basePaid} 但无 TASK_PAYOUT/TASK_ARBITRATION 流水`);
      }
    }
    const orphanPayouts = payoutTxs.filter((tx) => tx.assignmentId === null);
    for (const _tx of orphanPayouts) push(9, `TASK_PAYOUT/TASK_ARBITRATION 缺少 assignment 关联`);

    // 不变式 11：biz_key 唯一（DB 约束兜底）；DEBT_OFFSET 键格式
    const badDebtKeys = await tx.pointTransaction.count({
      where: { type: 'DEBT_OFFSET', NOT: { bizKey: { startsWith: 'DEBT_OFFSET:' } } },
    });
    if (badDebtKeys > 0) push(11, `${badDebtKeys} 条 DEBT_OFFSET 的 biz_key 不按来源交易 id 生成`);

    // 不变式 12：非负（SYS_ISSUE 例外）
    for (const a of accounts) {
      if (a.ownerType === 'SYS_ISSUE') {
        if (a.balance > 0 || a.frozen !== 0) push(12, `SYS_ISSUE balance=${a.balance} frozen=${a.frozen}`);
      } else if (a.balance < 0 || a.frozen < 0) {
        push(12, `账户 ${a.accountKey} 出现负余额 balance=${a.balance} frozen=${a.frozen}`);
      }
    }

    // 不变式 13：欠分
    const debtAgg = await tx.user.aggregate({ _sum: { penaltyDebt: true } });
    const penaltyAgg = await tx.taskAssignment.aggregate({
      _sum: { violationPenalty: true, violationDeducted: true },
    });
    const expectedDebt = (penaltyAgg._sum.violationPenalty ?? 0) - (penaltyAgg._sum.violationDeducted ?? 0);
    if ((debtAgg._sum.penaltyDebt ?? 0) !== expectedDebt) {
      push(13, `Σ penalty_debt ${debtAgg._sum.penaltyDebt ?? 0} ≠ 应扣-实扣 ${expectedDebt}`);
    }

    return violations;
  }
}
