import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Prisma } from '../generated/prisma/client';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { ApiError } from '../common/errors/api.error';
import { AuditService } from '../common/audit/audit.service';
import { parsePage, pageResult } from '../common/http/pagination';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

export class CreateDisputeDto {
  @IsOptional() @IsInt() taskId?: number;
  @IsOptional() @IsInt() assignmentId?: number;
  @IsNotEmpty({ message: '必须填写仲裁理由' }) @IsString() @MaxLength(2000) reason!: string;
}

export class ResolveDisputeDto {
  @IsIn(['PAY_FULL', 'PAY_PARTIAL', 'REJECT']) decision!: 'PAY_FULL' | 'PAY_PARTIAL' | 'REJECT';
  @IsOptional() @IsInt() @Min(0) payPoints?: number;
  @IsOptional() @IsString() @MaxLength(2000) resolutionNote?: string;
}

/** 仲裁（PRD §10.5）：结算前从托管出账 TASK_ARBITRATION；结算后从池出账 ARBITRATION_PAY */
@Controller()
export class DisputesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
  ) {}

  @Post('disputes')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateDisputeDto) {
    if (user.role === 'ADMIN') throw ApiError.of('FORBIDDEN', '管理员只负责裁定');
    if (!dto.taskId && !dto.assignmentId) {
      throw ApiError.of('VALIDATION_FAILED', '必须关联任务或接单');
    }
    const task = dto.taskId
      ? await this.prisma.task.findUnique({ where: { id: BigInt(dto.taskId) } })
      : dto.assignmentId
        ? (await this.prisma.taskAssignment.findUnique({ where: { id: BigInt(dto.assignmentId) }, include: { task: true } }))?.task
        : null;
    if (!task) throw ApiError.of('VALIDATION_FAILED', '关联的任务不存在');

    const respondentId =
      user.role === 'STUDENT' ? task.teacherId : dto.assignmentId
        ? (await this.prisma.taskAssignment.findUniqueOrThrow({ where: { id: BigInt(dto.assignmentId!) }, select: { studentId: true } })).studentId
        : task.createdBy;

    const dispute = await this.prisma.dispute.create({
      data: {
        taskId: task.id,
        assignmentId: dto.assignmentId ? BigInt(dto.assignmentId) : null,
        initiatorId: user.id,
        initiatorRole: user.role === 'STUDENT' ? 'STUDENT' : 'TEACHER',
        respondentId,
        reason: dto.reason,
      },
    });
    await this.notify.notifyAdmins({
      type: 'DISPUTE_CREATED',
      title: '有新的仲裁申请',
      body: `${user.role === 'STUDENT' ? '学生' : '教师'}对任务「${task.title}」发起仲裁：${dto.reason.slice(0, 50)}`,
      payload: { disputeId: dispute.id.toString() },
      dedupeKey: `dispute:created:${dispute.id}`,
    });
    await this.notify.notify(respondentId, {
      type: 'DISPUTE_CREATED',
      title: '你被发起仲裁',
      body: `任务「${task.title}」的仲裁已提交管理员处理`,
      payload: { disputeId: dispute.id.toString() },
      dedupeKey: `dispute:respondent:${dispute.id}`,
    });
    return { id: dispute.id.toString(), status: dispute.status };
  }

  @Get('disputes/me')
  async mine(@CurrentUser() user: RequestUser, @Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const where = { OR: [{ initiatorId: user.id }, { respondentId: user.id }] };
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, orderBy: { id: 'desc' }, skip: p.skip, take: p.take }),
      this.prisma.dispute.count({ where }),
    ]);
    return pageResult(items, total, p);
  }

  @Get('admin/disputes')
  @Roles('ADMIN')
  async list(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const where = {
      ...(query.status ? { status: query.status as Prisma.EnumDisputeStatusFilter['equals'] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          initiator: { select: { id: true, name: true, role: true } },
          respondent: { select: { id: true, name: true, role: true } },
        },
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return pageResult(items, total, p);
  }

  /** 裁定（PRD §10.5）：结算前 TASK_ESCROW 出账并回写 assignment；结算后仅池→学生补偿 */
  @HttpCode(200)
  @Post('admin/disputes/:id/resolve')
  @Roles('ADMIN')
  async resolve(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: BigInt(id) } });
    if (!dispute) throw ApiError.of('VALIDATION_FAILED', '仲裁单不存在');
    if (dispute.status !== 'OPEN') throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仲裁单已处理');

    if (dto.decision === 'PAY_PARTIAL' && (!dto.payPoints || dto.payPoints <= 0)) {
      throw ApiError.of('VALIDATION_FAILED', '部分发放必须指定积分');
    }

    let txId: bigint | null = null;
    if (dto.decision !== 'REJECT') {
      const payPoints = dto.decision === 'PAY_FULL' ? undefined : dto.payPoints!;
      const assignment = dispute.assignmentId
        ? await this.prisma.taskAssignment.findUnique({ where: { id: dispute.assignmentId } })
        : null;
      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: dispute.taskId! } });

      if (task.settlementStatus !== 'DONE') {
        // 结算前：从 TASK_ESCROW 出账（TASK_ARBITRATION）
        const amount = payPoints ?? assignment?.basePaid ?? task.rewardPerPerson ?? 0;
        if (amount <= 0) throw ApiError.of('VALIDATION_FAILED', '无法确定发放金额');
        const result = await this.prisma.$transaction(async (tx) => {
          const escrowKey = LedgerService.taskKey(task.id);
          const escrow = await this.ledger.getOrCreateAccount(tx, escrowKey, 'TASK_ESCROW', task.id);
          if (escrow.balance < amount) throw ApiError.of('POOL_INSUFFICIENT', '托管余额不足');
          const targetUser = assignment?.studentId ?? dispute.initiatorId;
          const r = await this.ledger.creditUser(tx, {
            userId: targetUser,
            amount,
            txType: 'TASK_ARBITRATION',
            bizKey: `TASK_ARBITRATION:dispute:${dispute.id}`,
            sourceKey: escrowKey,
            sourceOwnerType: 'TASK_ESCROW',
            sourceOwnerId: task.id,
            taskId: task.id,
            assignmentId: dispute.assignmentId,
            reason: `仲裁裁定 ${dto.decision}`,
            operatorId: user.id,
          });
          if (assignment && !r.duplicate) {
            await tx.taskAssignment.update({
              where: { id: assignment.id },
              data:
                dto.decision === 'PAY_FULL'
                  ? {
                      passed: true,
                      status: 'ACCEPTED',
                      acceptedAt: new Date(),
                      basePaid: { increment: amount },
                      rewardPaidRate: task.rewardPerPerson,
                    }
                  : {
                      status: 'SETTLED', // 部分发放不参与再分配（PRD §10.5）
                      basePaid: { increment: amount },
                      rewardPaidRate: task.rewardPerPerson,
                    },
            });
            if (dto.decision === 'PAY_FULL') {
              await tx.task.update({
                where: { id: task.id },
                data: { paidBaseAmount: { increment: amount }, acceptedCount: { increment: assignment.passed ? 0 : 1 } },
              });
            } else {
              await tx.task.update({
                where: { id: task.id },
                data: { paidBaseAmount: { increment: amount } },
              });
            }
          }
          return r;
        });
        txId = result.transactionId;
      } else {
        // 结算后：只能 POOL → 学生（ARBITRATION_PAY），不动任务账（PRD §10.5）
        const amount = payPoints ?? 0;
        if (amount <= 0) throw ApiError.of('VALIDATION_FAILED', '结算后补偿必须指定积分');
        const result = await this.prisma.$transaction(async (tx) => {
          return this.ledger.creditUser(tx, {
            userId: dispute.initiatorRole === 'STUDENT' ? dispute.initiatorId : dispute.respondentId,
            amount,
            txType: 'ARBITRATION_PAY',
            bizKey: `ARBITRATION_PAY:dispute:${dispute.id}`,
            sourceKey: LedgerService.POOL,
            sourceOwnerType: 'POOL',
            reason: `结算后仲裁补偿：${dto.resolutionNote ?? ''}`,
            operatorId: user.id,
          });
        });
        txId = result.transactionId;
      }
    }

    await this.prisma.dispute.update({
      where: { id: BigInt(id) },
      data: {
        status: dto.decision === 'REJECT' ? 'REJECTED' : 'RESOLVED',
        decision: dto.decision,
        payPoints: dto.decision === 'PAY_PARTIAL' ? dto.payPoints! : null,
        resolutionNote: dto.resolutionNote,
        resolutionTxId: txId,
        resolvedBy: user.id,
        resolvedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'DISPUTE_RESOLVE',
      targetType: 'DISPUTE',
      targetId: BigInt(id),
      after: { decision: dto.decision, payPoints: dto.payPoints },
    });
    await this.notify.notify(dispute.initiatorId, {
      type: 'DISPUTE_RESOLVED',
      title: '仲裁已裁定',
      body: `你的仲裁申请已裁定：${dto.decision}${dto.payPoints ? `（${dto.payPoints} 积分）` : ''}`,
      payload: { disputeId: id },
      dedupeKey: `dispute:resolved:${id}`,
    });
    await this.notify.notify(dispute.respondentId, {
      type: 'DISPUTE_RESOLVED',
      title: '仲裁已裁定',
      body: `与你相关的仲裁已裁定：${dto.decision}`,
      payload: { disputeId: id },
      dedupeKey: `dispute:resolved:r:${id}`,
    });
    return { decision: dto.decision };
  }
}
