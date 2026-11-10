import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../common/audit/audit.service';
import { LedgerService, type TxClient } from '../ledger/ledger.service';
import type { PriceDto, RepriceDto } from './dto';

export interface RequestMeta {
  operator: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' };
  requestId?: string;
}

/** 定价与改价（PRD §3.1 / §3.2，账务必须逐行对齐） */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /** 管理员定价：POOL → TASK_ESCROW，PENDING_REWARD → RECRUITING */
  async price(taskId: bigint, dto: PriceDto, meta: RequestMeta) {
    const rMin = await this.config.getInt('TASK_REWARD_MIN', 1);
    const rMax = await this.config.getInt('TASK_REWARD_MAX', 500);
    const totalMax = await this.config.getInt('TASK_TOTAL_MAX', 10000);
    const nMax = await this.config.getInt('TASK_HEADCOUNT_MAX', 50);
    if (dto.rewardPerPerson < rMin || dto.rewardPerPerson > rMax) {
      throw ApiError.of('REWARD_LIMIT_EXCEEDED', `单人赏金必须在 ${rMin}-${rMax} 之间`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) 锁任务行，复查状态（定价 vs 取消互斥）
      const locked = await this.lockTask(tx, taskId);
      if (locked.status !== TaskStatus.PENDING_REWARD) {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不是待定价状态');
      }
      // 2) 已过截止时间的任务定价被拒绝（3007），需先延期
      const expired = await tx.$queryRawUnsafe<{ ok: number }[]>(
        'SELECT (deadline_at > NOW(3)) AS ok FROM tasks WHERE id = ' + taskId.toString(),
      );
      if (!expired[0]?.ok) throw ApiError.of('TASK_DEADLINE_PASSED', '任务已过截止时间，请先延期再定价');

      const headcount = locked.headcount;
      if (headcount < 1 || headcount > nMax) throw ApiError.of('REWARD_LIMIT_EXCEEDED', `名额必须在 1-${nMax} 之间`);
      const budget = dto.rewardPerPerson * headcount;
      if (budget > totalMax) {
        throw ApiError.of(
          'REWARD_LIMIT_EXCEEDED',
          `任务总额 ${budget} 超过上限 ${totalMax}（${dto.rewardPerPerson} 分时最多 ${Math.floor(totalMax / dto.rewardPerPerson)} 个名额）`,
        );
      }

      // 3) 池余额充足（3001）
      const pool = await this.ledger.getOrCreateAccount(tx, LedgerService.POOL, 'POOL');
      if (pool.balance < budget) {
        throw ApiError.of('POOL_INSUFFICIENT', '积分池余额不足，请先充值');
      }

      // 4) 创建托管账户并划转
      const escrowKey = LedgerService.taskKey(taskId);
      await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);
      await this.ledger.post(tx, {
        type: 'TASK_FREEZE',
        bizKey: `TASK_FREEZE:${taskId}`,
        legs: [
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: -budget },
          { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: budget },
        ],
        taskId,
        operatorId: meta.operator.id,
        reason: '任务定价',
        requestId: meta.requestId,
      });

      // 5) 更新任务
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          rewardPerPerson: dto.rewardPerPerson,
          totalAmount: budget,
          status: TaskStatus.RECRUITING,
          pricedAt: new Date(),
          pricedBy: meta.operator.id,
          version: { increment: 1 },
        },
      });

      await tx.taskEvent.create({
        data: { taskId, fromStatus: TaskStatus.PENDING_REWARD, toStatus: TaskStatus.RECRUITING, actorId: meta.operator.id, requestId: meta.requestId },
      });
      return updated;
    });

    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: 'TASK_PRICE',
      targetType: 'TASK',
      targetId: taskId,
      after: { rewardPerPerson: dto.rewardPerPerson, total: dto.rewardPerPerson * result.headcount },
    });
    await this.notify.notify(result.teacherId, {
      type: 'TASK_PRICED',
      title: '任务已定价上架',
      body: `你的任务「${result.title}」已定价 ${dto.rewardPerPerson} 积分/人，现在学生可以看到并接单了`,
      payload: { taskId: taskId.toString() },
      dedupeKey: `task:priced:${taskId}`,
    });
    return {
      status: result.status,
      totalAmount: dto.rewardPerPerson * result.headcount,
    };
  }

  /**
   * 改价（PRD §3.2）：结算完成前任意阶段；
   * 调高对已通过者补差（TASK_REPRICE_TOPUP），有人通过后不得调低（3014）。
   */
  async reprice(taskId: bigint, dto: RepriceDto, meta: RequestMeta) {
    const totalMax = await this.config.getInt('TASK_TOTAL_MAX', 10000);

    const result = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId);
      if (task.settlementStatus === 'SETTLING') throw ApiError.of('SETTLING_IN_PROGRESS');
      if (task.settlementStatus === 'DONE' || task.status === 'SETTLED' || task.status === 'CANCELLED') {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已结算或取消，不能改价；确需补偿请走仲裁');
      }
      if (task.rewardPerPerson === null) throw ApiError.of('TASK_PENDING_REWARD', '任务尚未定价');

      const newR = dto.rewardPerPerson;
      const N = task.headcount;
      const newBudget = newR * N;
      const oldPaid = task.paidBaseAmount + task.paidBonusAmount;
      const escrowKey = LedgerService.taskKey(taskId);
      const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);

      const passed = await tx.taskAssignment.findMany({
        where: { taskId, passed: true, status: { in: ['ACCEPTED', 'SETTLED'] } },
        orderBy: { id: 'asc' },
      });

      if (newBudget > totalMax) {
        throw ApiError.of('REWARD_LIMIT_EXCEEDED', `任务总额 ${newBudget} 超过上限 ${totalMax}`);
      }
      // 保守校验：已发放 + 剩余名额按新价不得超过新预算（有人按旧价拿过高赏金后禁止把预算降穿）
      if (newBudget < oldPaid + newR * (N - passed.length)) {
        throw ApiError.of('REWARD_BELOW_PAID', '新赏金低于已发放额度，只能维持或调高');
      }

      // 1) 补/退托管差额：funding = newBudget - oldPaid - escrow.balance
      const funding = newBudget - oldPaid - escrow.balance;
      if (funding > 0) {
        const pool = await this.ledger.getOrCreateAccount(tx, LedgerService.POOL, 'POOL');
        if (pool.balance < funding) throw ApiError.of('POOL_INSUFFICIENT', '积分池余额不足，无法调高');
        await this.ledger.post(tx, {
          type: 'TASK_FREEZE',
          bizKey: `TASK_REPRICE_FUND:${taskId}:${task.version}`,
          legs: [
            { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: -funding },
            { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: funding },
          ],
          taskId,
          operatorId: meta.operator.id,
          reason: `改价补入托管：${dto.reason}`,
          requestId: meta.requestId,
        });
      } else if (funding < 0) {
        const refund = -funding;
        await this.ledger.post(tx, {
          type: 'TASK_REFUND',
          bizKey: `TASK_REPRICE_REFUND:${taskId}:${task.version}`,
          legs: [
            { accountKey: escrowKey, ownerType: 'TASK_ESCROW', ownerId: taskId, bucket: 'AVAILABLE', delta: -refund },
            { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: refund },
          ],
          taskId,
          operatorId: meta.operator.id,
          reason: `改价退回差额：${dto.reason}`,
          requestId: meta.requestId,
        });
      }

      // 2) 对已通过者补差：max(0, newR - reward_paid_rate)，逐人幂等
      let topupTotal = 0;
      for (const a of passed) {
        const topup = Math.max(0, newR - (a.rewardPaidRate ?? task.rewardPerPerson));
        if (topup <= 0) continue;
        const credited = await this.ledger.creditUser(tx, {
          userId: a.studentId,
          amount: topup,
          txType: 'TASK_REPRICE_TOPUP',
          bizKey: `TASK_REPRICE_TOPUP:${taskId}:${a.id}:${task.version}`,
          sourceKey: escrowKey,
          sourceOwnerType: 'TASK_ESCROW',
          sourceOwnerId: taskId,
          taskId,
          assignmentId: a.id,
          reason: `赏金上调补差：${dto.reason}`,
          operatorId: meta.operator.id,
          requestId: meta.requestId,
        });
        if (!credited.duplicate) {
          await tx.taskAssignment.update({
            where: { id: a.id },
            data: {
              basePaid: { increment: topup },
              rewardPaidRate: newR,
            },
          });
          topupTotal += topup;
        }
      }

      // 3) 更新任务（total_amount 只增不减；refunded_amount 记录降价退款）
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          rewardPerPerson: newR,
          totalAmount: { increment: funding > 0 ? funding : 0 },
          refundedAmount: { increment: funding < 0 ? -funding : 0 },
          paidBaseAmount: { increment: topupTotal },
          version: { increment: 1 },
        },
      });

      await tx.taskEditHistory.createMany({
        data: [
          {
            taskId,
            editorId: meta.operator.id,
            field: 'rewardPerPerson',
            before: task.rewardPerPerson as never,
            after: newR as never,
          },
        ],
      });

      const escrowAfter = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', taskId);
      // 断言（PRD §3.2）：total - refunded = newBudget；paid+escrow 守恒
      if (
        updated.totalAmount - updated.refundedAmount !== newBudget ||
        updated.paidBaseAmount + updated.paidBonusAmount + escrowAfter.balance + updated.refundedAmount !== updated.totalAmount
      ) {
        throw new Error(`改价断言失败 task=${taskId}`);
      }

      return { updated, topupTotal, passedCount: passed.length };
    });

    await this.audit.log({
      actorId: meta.operator.id,
      actorRole: meta.operator.role,
      action: 'TASK_REPRICE',
      targetType: 'TASK',
      targetId: taskId,
      reason: dto.reason,
      after: { rewardPerPerson: dto.rewardPerPerson, topupTotal: result.topupTotal },
    });

    // 通知归属教师 + 所有活跃接单学生（§6.7）
    await this.notify.notify(result.updated.teacherId, {
      type: 'TASK_REPRICED',
      title: '任务赏金已调整',
      body: `任务「${result.updated.title}」赏金调整为 ${dto.rewardPerPerson} 积分/人`,
      payload: { taskId: taskId.toString() },
      dedupeKey: `task:reprice:${taskId}:${result.updated.version}`,
    });
    const activeStudents = await this.prisma.taskAssignment.findMany({
      where: { taskId, status: { in: ['CLAIMED', 'SUBMITTED', 'REJECTED'] } },
      select: { studentId: true },
    });
    await this.notify.notifyMany(
      activeStudents.map((s) => s.studentId),
      {
        type: 'TASK_REPRICED',
        title: '任务赏金已调整',
        body: `你参与的任务「${result.updated.title}」赏金调整为 ${dto.rewardPerPerson} 积分/人`,
        payload: { taskId: taskId.toString() },
        dedupeKey: `task:reprice:${taskId}:${result.updated.version}:s`,
      },
    );

    return {
      rewardPerPerson: dto.rewardPerPerson,
      topupPaid: result.topupTotal,
      budget: dto.rewardPerPerson * result.updated.headcount,
    };
  }

  /** 锁任务行（PRD §9.4 统一锁顺序第一步） */
  async lockTask(tx: TxClient, taskId: bigint) {
    const rows = await tx.$queryRawUnsafe<
      { id: bigint; status: string; settlement_status: string; version: number; headcount: number; reward_per_person: number | null; total_amount: number; paid_base_amount: number; paid_bonus_amount: number; refunded_amount: number; filled_count: number; teacher_id: bigint; title: string }[]
    >(`SELECT * FROM tasks WHERE id = ${taskId.toString()} FOR UPDATE`);
    const row = rows[0];
    if (!row) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    return task;
  }
}
