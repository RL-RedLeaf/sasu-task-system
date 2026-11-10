import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../common/audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import type { TxClient } from '../ledger/ledger.service';
import { PricingService } from './pricing.service';

export interface OperatorMeta {
  operator: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' };
  requestId?: string;
}

/**
 * 任务关闭/取消/下架（PRD §6.5 + §3.5）。
 * 关闭（REFUND_ONLY）：不判违约，SUBMITTED 保留待验收，剩余在结算时退回。
 * 取消（即时退款）：无 SUBMITTED 才允许（教师）；管理员强制取消自动通过 SUBMITTED。
 * 下架：同强制取消，先 CLOSED 语义处理（REFUND_ONLY）。
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /** 待定价取消（教师或管理员）：无资金变动，直接终态 */
  async cancelPendingReward(taskId: bigint, meta: OperatorMeta, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const task = await this.pricing.lockTask(tx, taskId);
      if (task.status !== TaskStatus.PENDING_REWARD) {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仅待定价任务可用此操作');
      }
      if (task.teacherId !== meta.operator.id && meta.operator.role !== 'ADMIN') {
        throw ApiError.of('FORBIDDEN');
      }
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CANCELLED,
          settlementStatus: 'DONE',
          cancelType: meta.operator.role === 'ADMIN' ? 'ADMIN' : 'TEACHER',
          cancelReason: reason,
          closedAt: new Date(),
        },
      });
      await tx.taskEvent.create({
        data: { taskId, fromStatus: TaskStatus.PENDING_REWARD, toStatus: TaskStatus.CANCELLED, actorId: meta.operator.id, reason, requestId: meta.requestId },
      });
    });
    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: 'TASK_CANCEL',
      targetType: 'TASK',
      targetId: taskId,
      reason,
    });
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    await this.notify.notify(task.teacherId, {
      type: 'TASK_PENDING_CANCELLED',
      title: '待定价任务已取消',
      body: `任务「${task.title}」已取消：${reason}`,
      payload: { taskId: taskId.toString() },
      dedupeKey: `task:pending-cancelled:${taskId}`,
    });
    if (meta.operator.role === 'ADMIN') {
      await this.notify.notify(task.teacherId, {
        type: 'TASK_ADMIN_CANCELLED',
        title: '管理员取消了你的待定价任务',
        body: reason,
        payload: { taskId: taskId.toString() },
        dedupeKey: `task:admin-cancel:${taskId}`,
      });
    }
    return { status: TaskStatus.CANCELLED };
  }

  /** 教师手动关闭 / 管理员强制关闭：停止招募，SUBMITTED 保留，REFUND_ONLY */
  async close(taskId: bigint, meta: OperatorMeta, reason: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');
    if (meta.operator.role === 'TEACHER' && task.teacherId !== meta.operator.id) {
      throw ApiError.of('FORBIDDEN', '只能关闭自己发布的任务');
    }
    if (!([TaskStatus.RECRUITING, TaskStatus.FULL] as TaskStatus[]).includes(task.status)) {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不在招募中，无法关闭');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.pricing.lockTask(tx, taskId);
      // CLAIMED/REJECTED → CANCELLED_BY_TEACHER（不计违约）
      const cancelled = await tx.taskAssignment.updateMany({
        where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.REJECTED] } },
        data: { status: AssignmentStatus.CANCELLED_BY_TEACHER, withdrawnAt: new Date() },
      });
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: new Date(),
          settlementMode: 'REFUND_ONLY',
          filledCount: 0,
        },
      });
      await tx.taskEvent.create({
        data: { taskId, fromStatus: task.status, toStatus: TaskStatus.CLOSED, actorId: meta.operator.id, reason, requestId: meta.requestId },
      });
      return cancelled.count;
    });

    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: 'TASK_CLOSE',
      targetType: 'TASK',
      targetId: taskId,
      reason,
    });
    await this.notifyClaimants(taskId, {
      type: 'TASK_CLOSED',
      title: '任务已关闭',
      body: `任务「${task.title}」已提前关闭：${reason}。已提交的交付仍会正常验收，未开始的同学名额已释放。`,
      dedupeKey: `task:closed:${taskId}`,
    });
    return { status: TaskStatus.CLOSED };
  }

  /** 教师取消（截止前，仅无 SUBMITTED）：即时退款，终态 */
  async cancel(taskId: bigint, meta: OperatorMeta, reason: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');
    if (task.teacherId !== meta.operator.id && meta.operator.role !== 'ADMIN') {
      throw ApiError.of('FORBIDDEN', '只能取消自己发布的任务');
    }
    if (task.status !== TaskStatus.RECRUITING && task.status !== TaskStatus.FULL) {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务当前状态不可取消');
    }
    const submittedCount = await this.prisma.taskAssignment.count({
      where: { taskId, status: AssignmentStatus.SUBMITTED },
    });
    if (submittedCount > 0) {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '已有学生提交待验收，不能取消；请先验收或联系管理员强制处理');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.pricing.lockTask(tx, taskId);
      const escrowKey = LedgerService.taskKey(taskId);
      const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);
      // CLAIMED/REJECTED → CANCELLED_BY_TEACHER；ACCEPTED → SETTLED（保留已发分）
      await tx.taskAssignment.updateMany({
        where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.REJECTED] } },
        data: { status: AssignmentStatus.CANCELLED_BY_TEACHER, withdrawnAt: new Date() },
      });
      await tx.taskAssignment.updateMany({
        where: { taskId, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.SETTLED },
      });
      // 托管剩余全额退回（即时退款，同一事务）
      if (escrow.balance > 0) {
        await this.ledger.post(tx, {
          type: 'TASK_REFUND',
          bizKey: `TASK_CANCEL_REFUND:${taskId}`,
          legs: [
            { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: -escrow.balance },
            { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: escrow.balance },
          ],
          taskId,
          operatorId: meta.operator.id,
          reason: `任务取消退款：${reason}`,
          requestId: meta.requestId,
        });
      }
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CANCELLED,
          settlementStatus: 'DONE',
          settlementMode: 'REFUND_ONLY',
          refundedAmount: { increment: escrow.balance },
          cancelType: meta.operator.role === 'ADMIN' ? 'ADMIN' : 'TEACHER',
          cancelReason: reason,
          closedAt: new Date(),
          filledCount: 0,
        },
      });
      await tx.taskEvent.create({
        data: { taskId, fromStatus: task.status, toStatus: TaskStatus.CANCELLED, actorId: meta.operator.id, reason, requestId: meta.requestId },
      });
    });

    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: 'TASK_CANCEL',
      targetType: 'TASK',
      targetId: taskId,
      reason,
    });
    await this.notifyClaimants(taskId, {
      type: 'TASK_CANCELLED',
      title: '任务已取消',
      body: `任务「${task.title}」已取消：${reason}`,
      dedupeKey: `task:cancelled:${taskId}`,
    });
    return { status: TaskStatus.CANCELLED };
  }

  /**
   * 管理员强制取消：允许存在 SUBMITTED —— 已提交者按通过发放基础分（不让学生白干），
   * 其余 CANCELLED_BY_TEACHER；托管剩余即时退回；任务 → CANCELLED。
   */
  async forceCancel(taskId: bigint, meta: OperatorMeta, reason: string) {
    const refund = await this.forceHandle(taskId, meta, reason, TaskStatus.CANCELLED, 'ADMIN');
    return { status: TaskStatus.CANCELLED, refund };
  }

  /** 管理员强制下架（内容违规）：处理完接单学生后 → CLOSED（REFUND_ONLY，结算时退回） */
  async forceOffline(taskId: bigint, meta: OperatorMeta, reason: string) {
    const refund = await this.forceHandle(taskId, meta, reason, TaskStatus.CLOSED, 'ADMIN');
    return { status: TaskStatus.CLOSED, refund };
  }

  /** 强制取消/下架共用：SUBMITTED 自动按通过发放，其余取消；区别只在终态与退款时机 */
  private async forceHandle(
    taskId: bigint,
    meta: OperatorMeta,
    reason: string,
    finalStatus: TaskStatus,
    cancelType: 'ADMIN',
  ): Promise<number> {
    let refunded = 0;
    await this.prisma.$transaction(async (tx) => {
      const task = await this.pricing.lockTask(tx, taskId);
      if (
        ([TaskStatus.RECRUITING, TaskStatus.FULL, TaskStatus.OFFLINE] as TaskStatus[]).includes(
          task.status,
        )
      ) {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务当前状态不可强制处理');
      }
      if (task.settlementStatus === 'DONE') {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已结算');
      }
      const escrowKey = LedgerService.taskKey(taskId);
      const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);

      // 1) SUBMITTED 自动按通过发放基础分
      const submitted = await tx.taskAssignment.findMany({
        where: { taskId, status: AssignmentStatus.SUBMITTED },
        orderBy: { id: 'asc' },
      });
      for (const a of submitted) {
        if (task.rewardPerPerson === null) continue;
        const credited = await this.ledger.creditUser(tx, {
          userId: a.studentId,
          amount: task.rewardPerPerson,
          txType: 'TASK_PAYOUT',
          bizKey: `TASK_PAYOUT:assignment:${a.id}`,
          sourceKey: escrowKey,
          sourceOwnerType: 'TASK_ESCROW',
          sourceOwnerId: taskId,
          taskId,
          assignmentId: a.id,
          reason: `管理员强制处理，按通过发放：${reason}`,
          operatorId: meta.operator.id,
          requestId: meta.requestId,
        });
        if (!credited.duplicate) {
          await tx.taskAssignment.update({
            where: { id: a.id },
            data: {
              status: finalStatus === TaskStatus.CANCELLED ? AssignmentStatus.SETTLED : AssignmentStatus.ACCEPTED,
              passed: true,
              acceptedAt: new Date(),
              basePaid: { increment: task.rewardPerPerson },
              rewardPaidRate: task.rewardPerPerson,
            },
          });
          await tx.review.create({
            data: {
              submissionId: (
                await tx.submission.findFirstOrThrow({ where: { assignmentId: a.id, status: 'PENDING' }, orderBy: { version: 'desc' } })
              ).id,
              assignmentId: a.id,
              reviewerId: meta.operator.id,
              decision: 'ACCEPT',
              reason: `强制处理自动通过：${reason}`,
              isProxy: true,
            },
          });
        }
      }

      // 2) 其余活跃接单 → CANCELLED_BY_TEACHER（不计违约）
      await tx.taskAssignment.updateMany({
        where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.REJECTED] } },
        data: { status: AssignmentStatus.CANCELLED_BY_TEACHER, withdrawnAt: new Date() },
      });
      await tx.taskAssignment.updateMany({
        where: { taskId, status: AssignmentStatus.ACCEPTED },
        data: { status: AssignmentStatus.SETTLED },
      });

      // 3) 托管剩余处理：CANCELLED 即时退款；CLOSED（下架）留给结算
      if (finalStatus === TaskStatus.CANCELLED && escrow.balance > 0) {
        await this.ledger.post(tx, {
          type: 'TASK_REFUND',
          bizKey: `TASK_FORCE_REFUND:${taskId}`,
          legs: [
            { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: -escrow.balance },
            { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: escrow.balance },
          ],
          taskId,
          operatorId: meta.operator.id,
          reason: `强制取消退款：${reason}`,
          requestId: meta.requestId,
        });
      }

      const basePaidDelta = submitted.length * (task.rewardPerPerson ?? 0);
      const settledAccepted = finalStatus === TaskStatus.CANCELLED;
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: finalStatus,
          settlementStatus: settledAccepted ? 'DONE' : 'OPEN',
          settlementMode: 'REFUND_ONLY',
          refundedAmount: { increment: finalStatus === TaskStatus.CANCELLED ? escrow.balance : 0 },
          paidBaseAmount: { increment: basePaidDelta },
          acceptedCount: { increment: submitted.length },
          cancelType,
          cancelReason: reason,
          closedAt: new Date(),
          filledCount: 0,
        },
      });
      await tx.taskEvent.create({
        data: { taskId, fromStatus: task.status, toStatus: finalStatus, actorId: meta.operator.id, reason, requestId: meta.requestId },
      });
      refunded = finalStatus === TaskStatus.CANCELLED ? escrow.balance : 0;
    });

    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: finalStatus === TaskStatus.CANCELLED ? 'TASK_FORCE_CANCEL' : 'TASK_OFFLINE',
      targetType: 'TASK',
      targetId: taskId,
      reason,
      after: { refunded },
    });
    await this.notifyClaimants(taskId, {
      type: finalStatus === TaskStatus.CANCELLED ? 'TASK_CANCELLED' : 'TASK_OFFLINED',
      title: finalStatus === TaskStatus.CANCELLED ? '任务已被管理员取消' : '任务已被管理员下架',
      body: `任务「${(await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).title}」被管理员处理：${reason}`,
      dedupeKey: `task:force:${taskId}:${finalStatus}`,
    });
    return refunded;
  }

  private async notifyClaimants(taskId: bigint, input: { type: string; title: string; body: string; dedupeKey: string }) {
    const students = await this.prisma.taskAssignment.findMany({
      where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED, AssignmentStatus.CANCELLED_BY_TEACHER, AssignmentStatus.SETTLED] } },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    await this.notify.notifyMany(
      students.map((s) => s.studentId),
      { ...input, payload: { taskId: taskId.toString() } },
    );
  }
}
