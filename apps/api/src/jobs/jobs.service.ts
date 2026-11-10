import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as cron from 'node-cron';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { NotificationService } from '../notifications/notification.service';
import { AssignmentsService } from '../tasks/assignments.service';
import { SettlementService } from '../tasks/settlement.service';

/**
 * 定时任务（PRD §18.3）：GET_LOCK 防并发；任务级幂等由业务键保证。
 * 频率对齐 §18.3：关闭到期任务 5min、结算 10min、提醒每日 09:00、通知清理每日 03:00。
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly tasks: cron.ScheduledTask[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notify: NotificationService,
    private readonly assignments: AssignmentsService,
    private readonly settlement: SettlementService,
  ) {}

  onApplicationBootstrap(): void {
    this.tasks.push(cron.schedule('*/5 * * * *', () => void this.withLock('close', () => this.closeExpiredTasks())));
    this.tasks.push(cron.schedule('*/10 * * * *', () => void this.withLock('settle', () => this.settleReadyTasks())));
    this.tasks.push(cron.schedule('0 9 * * *', () => void this.withLock('remind', () => this.dailyReminders())));
    this.tasks.push(cron.schedule('0 3 * * *', () => void this.withLock('cleanup', () => this.cleanupNotifications())));
    this.logger.log('scheduled jobs registered');
  }

  onModuleDestroy(): void {
    for (const t of this.tasks) t.stop();
  }

  private async withLock(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      const locked = await this.prisma.$queryRawUnsafe<{ lock: number }[]>(
        `SELECT GET_LOCK('job:${name}', 0) AS lock`,
      );
      if (!locked[0]?.lock) return;
      try {
        await fn();
      } finally {
        await this.prisma.$queryRawUnsafe(`SELECT RELEASE_LOCK('job:${name}')`);
      }
    } catch (error) {
      this.logger.error(`job ${name} failed: ${String(error)}`);
    }
  }

  /** 关闭到期任务：CLAIMED→OVERDUE（违约）、超窗 REJECTED→FAILED（违约）、SUBMITTED 保留、任务→CLOSED */
  async closeExpiredTasks(): Promise<void> {
    const expired = await this.prisma.task.findMany({
      where: { status: { in: [TaskStatus.RECRUITING, TaskStatus.FULL] }, deadlineAt: { lte: new Date() } },
      select: { id: true },
    });
    // 超重交窗口的 REJECTED 也可能出现在已关闭任务上（§18.3 驳回收敛）
    const staleRejected = await this.prisma.taskAssignment.findMany({
      where: { status: AssignmentStatus.REJECTED, resubmitDeadline: { lte: new Date() } },
      select: { taskId: true },
      distinct: ['taskId'],
    });
    const taskIds = new Set([...expired.map((t) => t.id.toString()), ...staleRejected.map((t) => t.taskId.toString())]);

    for (const idStr of taskIds) {
      const taskId = BigInt(idStr);
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!task) continue;
      try {
        const isExpiredRecruiting =
          (task.status === TaskStatus.RECRUITING || task.status === TaskStatus.FULL) &&
          task.deadlineAt.getTime() <= Date.now();
        if (isExpiredRecruiting) {
          // 先迁移接单，再关闭任务
          await this.assignments.applyDeadlineTransitions(taskId, { requestId: `job:close:${idStr}` });
          await this.prisma.$transaction(async (tx) => {
            const fresh = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
            if (!([TaskStatus.RECRUITING, TaskStatus.FULL] as TaskStatus[]).includes(fresh.status)) return;
            await tx.task.update({
              where: { id: taskId },
              data: { status: TaskStatus.CLOSED, closedAt: new Date(), settlementMode: 'NORMAL' },
            });
            await tx.taskEvent.create({
              data: { taskId, fromStatus: fresh.status, toStatus: TaskStatus.CLOSED, reason: '到达截止时间', requestId: `job:close:${idStr}` },
            });
          });
          await this.notify.notify(task.teacherId, {
            type: 'TASK_CLOSED',
            title: '任务已到期关闭',
            body: `任务「${task.title}」已到截止时间并关闭，待处理完提交后结算`,
            payload: { taskId: idStr },
            dedupeKey: `job:close:${idStr}`,
          });
        } else {
          // 已关闭任务上的超窗 REJECTED 收敛
          await this.assignments.applyDeadlineTransitions(taskId, { requestId: `job:close:${idStr}` });
        }
      } catch (error) {
        this.logger.error(`close task ${idStr} failed: ${String(error)}`);
      }
    }
  }

  /** 结算：无活跃接单的 CLOSED/OFFLINE 任务（排除 CANCELLED 与 PENDING_REWARD） */
  async settleReadyTasks(): Promise<void> {
    const candidates = await this.prisma.task.findMany({
      where: { status: { in: [TaskStatus.CLOSED, TaskStatus.OFFLINE] }, settlementStatus: 'OPEN' },
      select: { id: true },
    });
    for (const t of candidates) {
      const active = await this.prisma.taskAssignment.count({
        where: { taskId: t.id, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED] } },
      });
      if (active > 0) continue;
      try {
        await this.settlement.settle(t.id, { requestId: `job:settle:${t.id.toString()}` });
      } catch (error) {
        this.logger.error(`settle task ${t.id} failed: ${String(error)}`);
      }
    }
  }

  /** 每日 09:00 提醒（§18.3） */
  async dailyReminders(): Promise<void> {
    const now = Date.now();

    // 待定价提醒（24h/72h，不自动取消）
    const pricingRemindHours = await this.config.getJson<number[]>('TASK_PRICING_REMIND_HOURS', [24, 72]);
    const pendingTasks = await this.prisma.task.findMany({
      where: { status: TaskStatus.PENDING_REWARD },
      select: { id: true, title: true, createdAt: true },
    });
    for (const t of pendingTasks) {
      const ageHours = (now - t.createdAt.getTime()) / 3600_000;
      for (const h of pricingRemindHours) {
        if (ageHours >= h && ageHours < h + 24) {
          await this.notify.notifyAdmins({
            type: 'TASK_PENDING_REMIND',
            title: '待定价任务提醒',
            body: `任务「${t.title}」已提交超过 ${h} 小时未定价`,
            payload: { taskId: t.id.toString() },
            dedupeKey: `remind:price:${t.id}:${new Date().toISOString().slice(0, 10)}`,
          });
        }
      }
    }

    // 截止前提醒（24h 内截止且有名额）
    const deadlineHours = await this.config.getInt('DEADLINE_REMIND_HOURS', 24);
    const closingTasks = await this.prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.RECRUITING, TaskStatus.FULL] },
        deadlineAt: { gte: new Date(), lte: new Date(now + deadlineHours * 3600_000) },
      },
      select: { id: true, title: true, teacherId: true, headcount: true, filledCount: true },
    });
    for (const t of closingTasks) {
      if (t.filledCount >= t.headcount) continue;
      await this.notify.notify(t.teacherId, {
        type: 'TASK_DEADLINE_REMIND',
        title: '任务即将截止',
        body: `任务「${t.title}」将在 24 小时内截止，目前还有名额`,
        payload: { taskId: t.id.toString() },
        dedupeKey: `remind:deadline:${t.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    // 验收超时：3 天提醒教师，7 天通知管理员（REVIEW_REMIND_DAYS=[3,7]）
    const reviewRemindDays = await this.config.getJson<number[]>('REVIEW_REMIND_DAYS', [3, 7]);
    const submittedAssignments = await this.prisma.taskAssignment.findMany({
      where: { status: AssignmentStatus.SUBMITTED },
      select: {
        id: true,
        taskId: true,
        task: { select: { id: true, title: true, teacherId: true } },
        submissions: { orderBy: { version: 'desc' }, take: 1, select: { submittedAt: true } },
      },
    });
    for (const a of submittedAssignments) {
      const submittedAt = a.submissions[0]?.submittedAt;
      if (!submittedAt) continue;
      const days = (now - submittedAt.getTime()) / 86_400_000;
      if (days >= (reviewRemindDays[1] ?? 7)) {
        await this.notify.notifyAdmins({
          type: 'REVIEW_OVERDUE_ADMIN',
          title: '验收超时（7 天）',
          body: `任务「${a.task.title}」的提交超过 7 天未验收，可代验收或强制关闭`,
          payload: { taskId: a.task.id.toString(), assignmentId: a.id.toString() },
          dedupeKey: `remind:review:${a.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      } else if (days >= (reviewRemindDays[0] ?? 3)) {
        await this.notify.notify(a.task.teacherId, {
          type: 'REVIEW_REMIND',
          title: '有提交待验收',
          body: `任务「${a.task.title}」的提交已超过 3 天未验收，请及时处理`,
          payload: { taskId: a.task.id.toString() },
          dedupeKey: `remind:review:${a.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
    }

    // 截止后 14 天未处理完的 SUBMITTED → 通知管理员（驳回收敛）
    const postDays = await this.config.getInt('TASK_POST_DEADLINE_REVIEW_DAYS', 14);
    const staleSubmitted = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.SUBMITTED,
        task: { deadlineAt: { lte: new Date(now - postDays * 86_400_000) } },
      },
      select: { id: true, task: { select: { id: true, title: true } } },
    });
    for (const a of staleSubmitted) {
      await this.notify.notifyAdmins({
        type: 'POST_DEADLINE_OVERDUE',
        title: '截止后超 14 天未处理',
        body: `任务「${a.task.title}」截止后超过 ${postDays} 天仍有提交未验收，教师已不能再驳回，请代验收或仲裁`,
        payload: { taskId: a.task.id.toString(), assignmentId: a.id.toString() },
        dedupeKey: `remind:post-deadline:${a.id}`,
      });
    }

    // 提现长期未发放提醒（APPROVED 超 3 天，汇率 > 0 才有意义）
    const rate = await this.config.getDecimal('POINT_TO_CASH_RATE', 0);
    if (rate > 0) {
      const staleApproved = await this.prisma.withdrawal.findMany({
        where: { status: 'APPROVED', reviewedAt: { lte: new Date(now - 3 * 86_400_000) } },
        select: { id: true },
      });
      for (const w of staleApproved) {
        await this.notify.notifyAdmins({
          type: 'WITHDRAWAL_STALE',
          title: '提现长期未发放',
          body: `提现申请 #${w.id} 已通过审批超过 3 天，请尽快线下发放`,
          payload: { withdrawalId: w.id.toString() },
          dedupeKey: `remind:withdraw:${w.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
    }
  }

  /** 通知清理：删除 180 天前已读通知（未读不删，§11.3） */
  async cleanupNotifications(): Promise<void> {
    const days = await this.config.getInt('NOTIFICATION_READ_RETENTION_DAYS', 180);
    const result = await this.prisma.notification.deleteMany({
      where: { readAt: { not: null, lte: new Date(Date.now() - days * 86_400_000) } },
    });
    if (result.count > 0) this.logger.log(`cleaned ${result.count} read notifications`);
  }
}
