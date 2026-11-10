import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService } from '../ledger/ledger.service';
import type { TxClient } from '../ledger/ledger.service';
import { PricingService } from './pricing.service';

/**
 * 结算（PRD §5.2，唯一触发点）：
 * 剩余份额只在任务进入 SETTLED 的那一刻分配一次。
 * U = total_amount - paid_base - paid_bonus - refunded（= TASK_ESCROW.balance）
 * A = count(passed=1)；REFUND_ONLY 或 A=0 → 全额退池；
 * 否则前 r 人各拿 q+1（按 accepted_at ASC, id ASC），其余各拿 q。
 * 幂等：settlement_batches.task_id 唯一；单事务；逐人 TASK_BONUS 幂等键。
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
    private readonly notify: NotificationService,
  ) {}

  /** 结算一个任务（由定时任务或管理端触发）。返回是否实际结算。 */
  async settle(taskId: bigint, meta: { requestId?: string }): Promise<{ settled: boolean; reason?: string }> {
    // 幂等守卫：task_id 唯一批次；DONE → 已结算；RUNNING → 并发保护；FAILED → 复用重试
    const existing = await this.prisma.settlementBatch.findUnique({ where: { taskId } });
    let batch;
    if (existing) {
      if (existing.status === 'DONE') return { settled: false, reason: 'ALREADY_SETTLED' };
      if (existing.status === 'RUNNING') return { settled: false, reason: 'RUNNING' };
      batch = await this.prisma.settlementBatch.update({
        where: { id: existing.id },
        data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null },
      });
    } else {
      batch = await this.prisma.settlementBatch
        .create({ data: { taskId, status: 'RUNNING', startedAt: new Date() } })
        .catch((error: unknown) => {
          // 并发创建 = 已有批次
          this.logger.log(`settlement batch race for task ${taskId}: ${String(error)}`);
          return null;
        });
      if (!batch) return { settled: false, reason: 'BATCH_EXISTS' };
    }

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const task = await this.pricing.lockTask(tx, taskId);
        if (task.settlementStatus !== 'OPEN') {
          throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不在待结算状态');
        }
        if (!([TaskStatus.CLOSED, TaskStatus.OFFLINE] as TaskStatus[]).includes(task.status)) {
          throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仅 CLOSED/OFFLINE 任务可结算');
        }
        // 不存在活跃接单才可结算（PRD §5.4）
        const activeCount = await tx.taskAssignment.count({
          where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED] } },
        });
        if (activeCount > 0) {
          throw ApiError.of('TASK_STATE_NOT_ALLOWED', `仍有 ${activeCount} 条待处理接单，不能结算`);
        }

        const escrowKey = LedgerService.taskKey(taskId);
        const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);
        const U = escrow.balance;
        const accepted = await tx.taskAssignment.findMany({
          where: { taskId, passed: true, status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.SETTLED] } },
          orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
        });
        const A = accepted.length;

        let bonusTotal = 0;
        let refundAmount = 0;
        const remainderShares: { assignmentId: bigint; amount: number; rank: number }[] = [];

        if (task.settlementMode === 'REFUND_ONLY' || A === 0) {
          // 全额退回积分池
          if (U > 0) {
            await this.ledger.post(tx, {
              type: 'TASK_REFUND',
              bizKey: `TASK_SETTLE_REFUND:${taskId}`,
              legs: [
                { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: -U },
                { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: U },
              ],
              taskId,
              reason: task.settlementMode === 'REFUND_ONLY' ? '关闭/下架结算退回' : '无人通过，退回积分池',
              requestId: meta.requestId,
            });
            refundAmount = U;
            await tx.taskSettlement.create({
              data: { batchId: batch.id, taskId, assignmentId: null, kind: 'REFUND', amount: U },
            });
          }
        } else {
          // 平分：q = U div A；余数 r = U mod A 按验收时间先后 +1
          const q = Math.floor(U / A);
          const r = U % A;
          for (let i = 0; i < A; i++) {
            const a = accepted[i];
            const share = q + (i < r ? 1 : 0);
            if (share <= 0) continue;
            const credited = await this.ledger.creditUser(tx, {
              userId: a.studentId,
              amount: share,
              txType: 'TASK_BONUS',
              bizKey: `TASK_BONUS:${taskId}:${a.id}`,
              sourceKey: escrowKey,
              sourceOwnerType: 'TASK_ESCROW',
              sourceOwnerId: taskId,
              taskId,
              assignmentId: a.id,
              reason: '结算再分配',
              requestId: meta.requestId,
            });
            if (!credited.duplicate) {
              await tx.taskAssignment.update({
                where: { id: a.id },
                data: {
                  status: AssignmentStatus.SETTLED,
                  bonusPaid: { increment: share },
                },
              });
              bonusTotal += share;
            } else {
              await tx.taskAssignment.update({
                where: { id: a.id },
                data: { status: AssignmentStatus.SETTLED },
              });
            }
            remainderShares.push({ assignmentId: a.id, amount: share, rank: i < r ? i + 1 : 0 });
          }
          await tx.taskSettlement.createMany({
            data: remainderShares.map((s) => ({
              batchId: batch.id,
              taskId,
              assignmentId: s.assignmentId,
              kind: 'BONUS' as const,
              amount: s.amount,
              remainderRank: s.rank,
            })),
          });
        }

        // 任务终态
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.SETTLED,
            settlementStatus: 'DONE',
            settledAt: new Date(),
            paidBonusAmount: { increment: bonusTotal },
            refundedAmount: { increment: refundAmount },
          },
        });
        await tx.taskEvent.create({
          data: { taskId, fromStatus: task.status as TaskStatus, toStatus: TaskStatus.SETTLED, requestId: meta.requestId },
        });

        const escrowAfter = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);
        if (escrowAfter.balance !== 0) {
          throw new Error(`结算断言失败：任务 ${taskId} 结算后托管余额 ${escrowAfter.balance} ≠ 0`);
        }

        return { bonusTotal, refundAmount, participants: await this.participantIds(tx, taskId) };
      });

      await this.prisma.settlementBatch.update({
        where: { id: batch.id },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          bonusAmount: outcome.bonusTotal,
          refundAmount: outcome.refundAmount,
          baseAmount: await this.currentBaseAmount(taskId),
        },
      });

      // 结算完成通知（教师 + 所有参与学生，§6.7）
      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      await this.notify.notify(task.teacherId, {
        type: 'TASK_SETTLED',
        title: '任务已结算',
        body: `任务「${task.title}」已完成结算`,
        payload: { taskId: taskId.toString() },
        dedupeKey: `settled:teacher:${taskId}`,
      });
      await this.notify.notifyMany(outcome.participants, {
        type: 'TASK_SETTLED',
        title: '任务已结算',
        body: `你参与的任务「${task.title}」已完成结算，再分配积分已入账`,
        payload: { taskId: taskId.toString() },
        dedupeKey: `settled:students:${taskId}`,
      });

      return { settled: true };
    } catch (error) {
      await this.prisma.settlementBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: String(error instanceof Error ? error.message : error).slice(0, 500),
        },
      });
      if (error instanceof ApiError && error.code === 3005) {
        return { settled: false, reason: error.message };
      }
      throw error;
    }
  }

  private async currentBaseAmount(taskId: bigint): Promise<number> {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { paidBaseAmount: true } });
    return task.paidBaseAmount;
  }

  private async participantIds(tx: TxClient, taskId: bigint): Promise<bigint[]> {
    const rows = await tx.taskAssignment.findMany({
      where: { taskId },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    return rows.map((r) => r.studentId);
  }
}
