import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService } from '../ledger/ledger.service';
import { PricingService } from './pricing.service';
import type { TxClient } from '../ledger/ledger.service';

/** 接单域：并发接单（§9.4）/取消/违约判定（§6.3）/名额释放 */
@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly pricing: PricingService,
    private readonly notify: NotificationService,
  ) {}

  /** 学生接单：单条条件 UPDATE 防超卖 + 并发上限 5 + attempt_no 递增 */
  async claim(studentId: bigint, taskId: bigint, meta: { requestId?: string }) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');
    if (task.status === TaskStatus.PENDING_REWARD) throw ApiError.of('TASK_PENDING_REWARD');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) 锁学生行，检查并发上限（CLAIMED+SUBMITTED+REJECTED）
      await tx.$queryRawUnsafe(`SELECT id FROM users WHERE id = ${studentId.toString()} FOR UPDATE`);
      const maxClaims = await this.config.getInt('TASK_CONCURRENT_CLAIMS_MAX', 5);
      const activeCount = await tx.taskAssignment.count({
        where: { studentId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED] } },
      });
      if (activeCount >= maxClaims) {
        throw ApiError.of('CONCURRENT_CLAIM_LIMIT', `同时进行的任务已达上限 ${maxClaims}`);
      }

      // 2) 占名额：单条条件 UPDATE（status 必须写在 filled_count 之前，PRD §9.4）
      const updated = await tx.$executeRawUnsafe(
        `UPDATE tasks SET status = IF(filled_count + 1 >= headcount, 'FULL', 'RECRUITING'), filled_count = filled_count + 1
         WHERE id = ${taskId.toString()} AND status IN ('RECRUITING','FULL') AND filled_count < headcount AND deadline_at > NOW(3)`,
      );
      if (updated !== 1) {
        // 区分：满 / 已截止 / 状态不允许
        const fresh = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, filledCount: true, headcount: true, deadlineAt: true } });
        if (fresh.deadlineAt.getTime() <= Date.now()) throw ApiError.of('TASK_DEADLINE_PASSED');
        if (fresh.status === TaskStatus.CLOSED || fresh.status === TaskStatus.OFFLINE || fresh.status === TaskStatus.CANCELLED || fresh.status === TaskStatus.SETTLED) {
          throw ApiError.of('TASK_STATE_NOT_ALLOWED');
        }
        throw ApiError.of('QUOTA_FULL');
      }

      // 3) attempt_no：同一任务历史尝试次数 + 1
      const lastAttempt = await tx.taskAssignment.findFirst({
        where: { taskId, studentId },
        orderBy: { attemptNo: 'desc' },
        select: { attemptNo: true },
      });
      const attemptNo = (lastAttempt?.attemptNo ?? 0) + 1;

      // 4) 写接单记录（uk_active 生成列保证同一学生只有一条活跃记录，冲突即 3006）
      try {
        const assignment = await tx.taskAssignment.create({
          data: {
            taskId,
            studentId,
            attemptNo,
            status: AssignmentStatus.CLAIMED,
            claimedAt: new Date(),
          },
        });
        return assignment;
      } catch (error) {
        const msg = String(error);
        if (msg.includes('uk_active') || msg.includes('Duplicate entry')) {
          throw ApiError.of('DUPLICATE_REQUEST', '你已接下这个任务，无需重复接单');
        }
        throw error;
      }
    });

    await this.notify.notify(task.teacherId, {
      type: 'TASK_CLAIMED',
      title: '任务有新同学接单',
      body: `任务「${task.title}」被接单，当前 ${task.filledCount + 1}/${task.headcount}`,
      payload: { taskId: taskId.toString(), assignmentId: result.id.toString() },
      dedupeKey: `task:claimed:${result.id}`,
    });
    if (task.filledCount + 1 >= task.headcount) {
      await this.notify.notify(task.teacherId, {
        type: 'TASK_FULL',
        title: '任务名额已满',
        body: `任务「${task.title}」名额已满`,
        payload: { taskId: taskId.toString() },
        dedupeKey: `task:full:${taskId}`,
      });
    }
    return { assignmentId: result.id.toString(), status: result.status };
  }

  /** 截止前主动取消接单：不计违约（PRD S-04） */
  async withdraw(studentId: bigint, assignmentId: bigint, meta: { requestId?: string }) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: { task: { select: { id: true, title: true, teacherId: true, deadlineAt: true, status: true } } },
    });
    if (!assignment) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '接单记录不存在');
    if (assignment.studentId !== studentId) throw ApiError.of('FORBIDDEN');

    if (!([AssignmentStatus.CLAIMED] as AssignmentStatus[]).includes(assignment.status)) {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仅进行中（未提交）的接单可以取消');
    }

    const released = await this.prisma.$transaction(async (tx) => {
      // 条件 UPDATE：截止前才允许（SQL 内校验 deadline_at > NOW(3)，PRD §9.4）
      const updated = await tx.$executeRawUnsafe(
        `UPDATE task_assignments SET status = 'WITHDRAWN', withdrawn_at = NOW(3)
         WHERE id = ${assignmentId.toString()} AND status = 'CLAIMED' AND (SELECT deadline_at FROM tasks WHERE id = task_id) > NOW(3)`,
      );
      if (updated !== 1) throw ApiError.of('TASK_DEADLINE_PASSED', '已过截止时间，不能取消接单');

      // 名额释放；FULL → RECRUITING
      await tx.$executeRawUnsafe(
        `UPDATE tasks SET filled_count = filled_count - 1,
           status = IF(status = 'FULL', 'RECRUITING', status)
         WHERE id = ${assignment.taskId.toString()} AND filled_count > 0`,
      );
      return true;
    });

    await this.notify.notify(assignment.task.teacherId, {
      type: 'CLAIM_WITHDRAWN',
      title: '有同学取消了接单',
      body: `任务「${assignment.task.title}」有同学在截止前取消接单，名额已释放`,
      payload: { taskId: assignment.taskId.toString() },
      dedupeKey: `claim:withdrawn:${assignmentId}`,
    });
    return { released };
  }

  /** 已通过验收的接单（结算与预览用，余数排序按 accepted_at ASC, id ASC） */
  async passedAssignments(taskId: bigint) {
    return this.prisma.taskAssignment.findMany({
      where: { taskId, passed: true, status: { in: ['ACCEPTED', 'SETTLED'] } },
      orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
      include: { student: { select: { id: true, name: true } } },
    });
  }

  /** 教师视角的接单列表（含学生姓名班级、提交概要） */
  async listByTask(taskId: bigint) {
    const items = await this.prisma.taskAssignment.findMany({
      where: { taskId },
      orderBy: [{ attemptNo: 'asc' }, { id: 'asc' }],
      include: {
        student: { select: { id: true, name: true, className: true } },
        submissions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, status: true, submittedAt: true } },
      },
    });
    return { items };
  }

  /** 截止/关闭时批量迁移（定时任务与关闭共用，PRD §6.5）：
   * CLAIMED → OVERDUE（违约）；超重交窗口的 REJECTED → FAILED（违约）；SUBMITTED 保留。
   * 违约金计算 floor(R × VIOLATION_RATE_BP / 10000)，无上下限。
   */
  async applyDeadlineTransitions(taskId: bigint, jobMeta: { requestId?: string }): Promise<{ overdue: number; failed: number }> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return { overdue: 0, failed: 0 };
    if (task.rewardPerPerson === null) return { overdue: 0, failed: 0 };

    const rateBp = await this.config.getInt('VIOLATION_RATE_BP', 2000);
    const penalty = Math.floor((task.rewardPerPerson * rateBp) / 10000);
    let overdue = 0;
    let failed = 0;

    await this.prisma.$transaction(async (tx) => {
      await this.pricing.lockTask(tx, taskId);

      // CLAIMED → OVERDUE（计违约）
      const claimedList = await tx.taskAssignment.findMany({
        where: { taskId, status: AssignmentStatus.CLAIMED },
        select: { id: true, studentId: true },
      });
      for (const a of claimedList) {
        await tx.taskAssignment.update({
          where: { id: a.id },
          data: {
            status: AssignmentStatus.OVERDUE,
            overdueAt: new Date(),
            isViolation: true,
            violationPenalty: penalty,
          },
        });
        overdue++;
      }

      // REJECTED 已过 resubmit_deadline → FAILED（计违约）
      const rejectedList = await tx.taskAssignment.findMany({
        where: {
          taskId,
          status: AssignmentStatus.REJECTED,
          resubmitDeadline: { lte: new Date() },
        },
        select: { id: true, studentId: true },
      });
      for (const a of rejectedList) {
        await tx.taskAssignment.update({
          where: { id: a.id },
          data: {
            status: AssignmentStatus.FAILED,
            failedAt: new Date(),
            isViolation: true,
            violationPenalty: penalty,
          },
        });
        failed++;
      }

      // 名额释放
      const released = overdue + failed;
      if (released > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE tasks SET filled_count = GREATEST(0, filled_count - ${released}),
             status = IF(status = 'FULL', 'RECRUITING', status)
           WHERE id = ${taskId.toString()}`,
        );
      }
    });

    // 违约扣分（独立事务逐人处理；失败不阻断迁移，欠分兜底在 deductViolation 内）
    const violators = await this.prisma.taskAssignment.findMany({
      where: { taskId, status: { in: [AssignmentStatus.OVERDUE, AssignmentStatus.FAILED] }, isViolation: true, violationDeducted: 0 },
      select: { id: true, studentId: true },
    });
    for (const v of violators) {
      if (penalty <= 0) {
        await this.prisma.taskAssignment.update({
          where: { id: v.id },
          data: { violationDeducted: 0 },
        });
        continue;
      }
      try {
        await this.prisma.$transaction(async (tx) => {
          const result = await this.ledger.deductViolation(tx, {
            studentId: v.studentId,
            amount: penalty,
            bizKey: `VIOLATION_DEDUCT:assignment:${v.id}`,
            reason: `任务「${task.title}」违约扣分`,
            requestId: jobMeta.requestId,
          });
          await tx.taskAssignment.update({
            where: { id: v.id },
            data: { violationDeducted: result.deducted },
          });
          await tx.user.update({
            where: { id: v.studentId },
            data: { violationCount: { increment: 1 } },
          });
        });
        await this.notify.notify(v.studentId, {
          type: 'VIOLATION',
          title: '违约扣分通知',
          body: `任务「${task.title}」违约，扣 ${penalty} 积分（余额不足部分记为欠分，将从后续收入优先抵扣）`,
          payload: { taskId: taskId.toString(), assignmentId: v.id.toString() },
          dedupeKey: `violation:${v.id}`,
        });
      } catch (error) {
        this.logger.error(`violation deduct failed assignment=${v.id}: ${String(error)}`);
      }
    }

    return { overdue, failed };
  }
}
