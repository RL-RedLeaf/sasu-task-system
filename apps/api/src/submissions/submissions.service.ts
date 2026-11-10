import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService, type TxClient } from '../ledger/ledger.service';
import { FilesService } from '../files/files.service';

/** 交付与验收（PRD §6.4 / §5.5）：提交、验收、驳回、重交窗口、14 天收敛 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly notify: NotificationService,
    private readonly files: FilesService,
  ) {}

  /** 学生提交交付物（多版本，历史保留） */
  async submit(
    studentId: bigint,
    assignmentId: bigint,
    input: { content: string; files: { buffer: Buffer; originalname: string; mimeType: string }[] },
    meta: { requestId?: string },
  ) {
    if (input.content.trim().length < 10 || input.content.length > 1000) {
      throw ApiError.of('VALIDATION_FAILED', '文字说明需 10-1000 字');
    }
    await this.files.assertFileCount(input.files.length);

    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await this.lockAssignment(tx, assignmentId);
      if (assignment.studentId !== studentId) throw ApiError.of('FORBIDDEN');
      const task = await tx.task.findUniqueOrThrow({ where: { id: assignment.taskId } });

      // CLAIMED：截止前提交（SQL 校验 NOW(3)，PRD §9.4）
      if (assignment.status === AssignmentStatus.CLAIMED) {
        const ok = await tx.$queryRawUnsafe<{ ok: number }[]>(
          `SELECT (deadline_at > NOW(3)) AS ok FROM tasks WHERE id = ${assignment.taskId.toString()}`,
        );
        if (!ok[0]?.ok) throw ApiError.of('TASK_DEADLINE_PASSED', '任务已截止，无法提交');
      } else if (assignment.status === AssignmentStatus.REJECTED) {
        // 重交窗口内允许（任务可已 CLOSED，PRD §9.4）
        const ok = await tx.$queryRawUnsafe<{ ok: number }[]>(
          `SELECT (resubmit_deadline > NOW(3)) AS ok FROM task_assignments WHERE id = ${assignmentId.toString()}`,
        );
        if (!ok[0]?.ok) throw ApiError.of('TASK_DEADLINE_PASSED', '已超过重交截止时间');
      } else {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '当前状态不能提交');
      }

      const version = assignment.rejectCount + 1; // 每次驳回后重交 +1
      const submission = await tx.submission.create({
        data: {
          assignmentId,
          studentId,
          version,
          content: input.content,
          status: 'PENDING',
          submittedAt: new Date(),
        },
      });
      await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: { status: AssignmentStatus.SUBMITTED },
      });
      await tx.assignmentEvent.create({
        data: {
          assignmentId,
          fromStatus: assignment.status,
          toStatus: AssignmentStatus.SUBMITTED,
          actorId: studentId,
          requestId: meta.requestId,
        },
      });
      return { submission, task };
    });

    // 附件（事务外写盘；失败则保留元数据 scan/记录，任务侧以无附件降级）
    for (const f of input.files) {
      const saved = await this.files.save({
        buffer: f.buffer,
        originalname: f.originalname,
        mimeType: f.mimeType,
        uploaderId: studentId,
        visibility: 'SUBMISSION_OWNER',
        refType: 'SUBMISSION',
        refId: result.submission.id,
      });
      await this.prisma.submissionFile.create({
        data: { submissionId: result.submission.id, fileId: saved.id },
      });
    }

    await this.notify.notify(result.task.teacherId, {
      type: 'SUBMITTED',
      title: '有提交待验收',
      body: `任务「${result.task.title}」有学生提交了交付物，请及时验收`,
      payload: { taskId: result.task.id.toString(), assignmentId },
      dedupeKey: `submitted:${assignmentId}:${result.submission.version}`,
    });
    return { submissionId: result.submission.id.toString(), version: result.submission.version };
  }

  async history(studentId: bigint, assignmentId: bigint) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        task: { select: { teacherId: true } },
        submissions: {
          orderBy: { version: 'desc' },
          include: { files: { include: { file: true } } },
        },
      },
    });
    if (!assignment) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '接单记录不存在');
    const isOwner = assignment.studentId === studentId;
    const isTeacher = assignment.task.teacherId === studentId;
    // 归属教师/本人/管理员（管理员走 admin 路由）
    if (!isOwner && !isTeacher) throw ApiError.of('FORBIDDEN');
    return assignment;
  }

  /**
   * 验收/驳回（唯一事实来源 reviews，PRD §9.2）。单事务完成：
   * 校验 → reviews → submissions → assignment → 任务计数 → TASK_ESCROW→USER → 事件。
   */
  async review(
    reviewer: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' },
    assignmentId: bigint,
    input: { decision: 'ACCEPT' | 'REJECT'; reason?: string; isProxy?: boolean },
    meta: { requestId?: string },
  ) {
    if (input.decision === 'REJECT' && (!input.reason || input.reason.length < 5 || input.reason.length > 200)) {
      throw ApiError.of('VALIDATION_FAILED', '驳回必须填写理由（5-200 字）');
    }
    if (input.decision === 'ACCEPT' && input.isProxy && (!input.reason || input.reason.trim().length === 0)) {
      throw ApiError.of('VALIDATION_FAILED', '代验收必须填写理由');
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const assignment = await this.lockAssignment(tx, assignmentId);
      const task = await tx.task.findUniqueOrThrow({ where: { id: assignment.taskId } });

      // 权限：归属教师或管理员（代验收走同一端点 + isProxy）
      if (reviewer.role === 'TEACHER' && task.teacherId !== reviewer.id) {
        throw ApiError.of('FORBIDDEN', '只能验收自己发布的任务');
      }
      if (reviewer.role === 'STUDENT') throw ApiError.of('FORBIDDEN');
      const isProxy = reviewer.role === 'ADMIN' || input.isProxy === true;

      if (
        assignment.status !== AssignmentStatus.SUBMITTED ||
        task.status === TaskStatus.CANCELLED ||
        task.status === TaskStatus.SETTLED
      ) {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '当前状态不能验收');
      }
      if (task.settlementStatus === 'SETTLING') throw ApiError.of('SETTLING_IN_PROGRESS');

      const latest = await tx.submission.findFirstOrThrow({
        where: { assignmentId, status: 'PENDING' },
        orderBy: { version: 'desc' },
      });

      const rejectMax = await this.config.getInt('TASK_REJECT_MAX', 3);
      const postDeadlineDays = await this.config.getInt('TASK_POST_DEADLINE_REVIEW_DAYS', 14);
      const rejectLimitAt = new Date(task.deadlineAt.getTime() + postDeadlineDays * 24 * 3600 * 1000);

      if (input.decision === 'REJECT') {
        // 截止后 14 天不能再驳回（§6.4-7）
        const now = new Date();
        const deadlinePassed = await tx.$queryRawUnsafe<{ ok: number }[]>(
          'SELECT (deadline_at <= NOW(3)) AS ok FROM tasks WHERE id = ' + task.id.toString(),
        );
        if (deadlinePassed[0]?.ok && now.getTime() > rejectLimitAt.getTime()) {
          throw ApiError.of('VALIDATION_FAILED', '已超过截止后处理时限，不能再驳回，只能通过、代验收或仲裁');
        }
        if (assignment.rejectCount >= rejectMax) {
          throw ApiError.of('VALIDATION_FAILED', `最多驳回 ${rejectMax} 次，第 ${rejectMax + 1} 次只能通过或转管理员仲裁`);
        }

        const resubmitWindowHours = await this.config.getInt('TASK_RESUBMIT_WINDOW_HOURS', 24);
        const resubmitDeadline = new Date(
          Math.max(task.deadlineAt.getTime(), now.getTime() + resubmitWindowHours * 3600 * 1000),
        );

        await tx.review.create({
          data: {
            submissionId: latest.id,
            assignmentId,
            reviewerId: reviewer.id,
            decision: 'REJECT',
            reason: input.reason,
            isProxy,
          },
        });
        await tx.submission.update({ where: { id: latest.id }, data: { status: 'REJECTED', reviewedAt: now } });
        const updated = await tx.taskAssignment.update({
          where: { id: assignmentId },
          data: {
            status: AssignmentStatus.REJECTED,
            rejectCount: { increment: 1 },
            resubmitDeadline,
          },
        });
        await tx.assignmentEvent.create({
          data: { assignmentId, fromStatus: AssignmentStatus.SUBMITTED, toStatus: AssignmentStatus.REJECTED, actorId: reviewer.id, reason: input.reason, requestId: meta.requestId },
        });
        return { kind: 'REJECTED' as const, assignment: updated, task };
      }

      // ACCEPT：立即发放基础分（含改价补差语义：base_paid + reward_paid_rate）
      if (task.rewardPerPerson === null) throw ApiError.of('TASK_PENDING_REWARD');
      if (task.settlementStatus === 'DONE') throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已结算，只能走仲裁补偿');

      await tx.review.create({
        data: {
          submissionId: latest.id,
          assignmentId,
          reviewerId: reviewer.id,
          decision: 'ACCEPT',
          reason: input.reason,
          isProxy,
        },
      });
      await tx.submission.update({ where: { id: latest.id }, data: { status: 'ACCEPTED', reviewedAt: new Date() } });

      const escrowKey = LedgerService.taskKey(task.id);
      const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', task.id);
      if (escrow.balance < task.rewardPerPerson) {
        throw ApiError.of('BALANCE_INSUFFICIENT', '任务托管余额不足');
      }
      const credited = await this.ledger.creditUser(tx, {
        userId: assignment.studentId,
        amount: task.rewardPerPerson,
        txType: 'TASK_PAYOUT',
        bizKey: `TASK_PAYOUT:assignment:${assignmentId}`,
        sourceKey: escrowKey,
        sourceOwnerType: 'TASK_ESCROW',
        sourceOwnerId: task.id,
        taskId: task.id,
        assignmentId,
        reason: `验收通过发放`,
        operatorId: reviewer.id,
        requestId: meta.requestId,
      });
      if (credited.duplicate) {
        throw ApiError.of('DUPLICATE_REQUEST', '该交付已验收通过，请勿重复操作');
      }

      const updated = await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.ACCEPTED,
          passed: true,
          acceptedAt: new Date(),
          basePaid: { increment: task.rewardPerPerson },
          rewardPaidRate: task.rewardPerPerson,
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: {
          acceptedCount: { increment: 1 },
          paidBaseAmount: { increment: task.rewardPerPerson },
        },
      });
      await tx.assignmentEvent.create({
        data: { assignmentId, fromStatus: AssignmentStatus.SUBMITTED, toStatus: AssignmentStatus.ACCEPTED, actorId: reviewer.id, requestId: meta.requestId },
      });
      return { kind: 'ACCEPTED' as const, assignment: updated, task, debtOffset: credited.debtOffset };
    });

    if (outcome.kind === 'REJECTED') {
      await this.notify.notify(outcome.assignment.studentId, {
        type: 'REVIEW_REJECTED',
        title: '交付被驳回',
        body: `任务「${outcome.task.title}」的交付被驳回：${input.reason}。请在 ${outcome.assignment.resubmitDeadline?.toISOString() ?? ''} 前重新提交`,
        payload: { taskId: outcome.task.id.toString(), assignmentId },
        dedupeKey: `rejected:${assignmentId}:${outcome.assignment.rejectCount}`,
      });
    } else {
      await this.notify.notify(outcome.assignment.studentId, {
        type: 'REVIEW_ACCEPTED',
        title: '验收通过，积分已到账',
        body: `任务「${outcome.task.title}」验收通过${outcome.debtOffset > 0 ? `（其中 ${outcome.debtOffset} 分用于抵扣历史欠分）` : ''}`,
        payload: { taskId: outcome.task.id.toString(), assignmentId },
        dedupeKey: `accepted:${assignmentId}`,
      });
    }
    return { decision: input.decision, assignmentId: assignmentId.toString() };
  }

  async lockAssignment(tx: TxClient, assignmentId: bigint) {
    const rows = await tx.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM task_assignments WHERE id = ${assignmentId.toString()} FOR UPDATE`,
    );
    if (!rows[0]) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '接单记录不存在');
    return tx.taskAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  }
}
