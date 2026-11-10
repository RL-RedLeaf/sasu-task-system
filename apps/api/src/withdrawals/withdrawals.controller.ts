import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { ApiError } from '../common/errors/api.error';
import { AuditService } from '../common/audit/audit.service';
import { ConfigService } from '../common/config/config.service';
import { parsePage, pageResult, requireIdempotencyKey } from '../common/http/pagination';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';

export class CreateWithdrawalDto {
  @IsInt() @Min(1) points!: number;
}

export class ReviewWithdrawalDto {
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
  @IsOptional() @IsString() @MaxLength(255) payNote?: string;
}

/** 提现（PRD §6.6）：默认关闭（汇率 0），PENDING→APPROVED→PAID / REJECTED 状态机 */
@Controller()
export class WithdrawalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
  ) {}

  private async rateEnabled(): Promise<number> {
    const rate = await this.config.getDecimal('POINT_TO_CASH_RATE', 0);
    return rate;
  }

  @Post('withdrawals')
  @HttpCode(200)
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateWithdrawalDto, @Req() req: Request & { requestId?: string }) {
    if (user.role !== 'STUDENT') throw ApiError.of('FORBIDDEN', '只有学生可以申请提现');
    const rate = await this.rateEnabled();
    if (rate <= 0) throw ApiError.of('WITHDRAWAL_DISABLED');

    const minPoints = await this.config.getInt('WITHDRAW_MIN_POINTS', 50);
    const monthlyLimit = await this.config.getInt('WITHDRAW_MONTHLY_LIMIT', 1);
    if (dto.points < minPoints) {
      throw ApiError.of('VALIDATION_FAILED', `最低提现 ${minPoints} 积分`);
    }

    const periodKey = new Date().toISOString().slice(0, 7); // 申请月，Asia/Shanghai 与 UTC 月差 8h 内影响极小（MVP 口径）
    const result = await this.prisma.$transaction(async (tx) => {
      // 锁学生行 + 账户行（提现 vs 违约扣分互斥，PRD §9.4）
      await tx.$queryRawUnsafe(`SELECT id FROM users WHERE id = ${user.id.toString()} FOR UPDATE`);
      const userKey = LedgerService.userKey(user.id);
      const account = await this.ledger.getOrCreateAccount(tx, userKey, 'USER', user.id);
      if (account.balance < dto.points) throw ApiError.of('BALANCE_INSUFFICIENT', '可用余额不足');

      // 当月额度：PENDING/APPROVED/PAID 均占额（应用层校验，PRD §9.2）
      const used = await tx.withdrawal.count({
        where: { studentId: user.id, periodKey, status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
      });
      if (used >= monthlyLimit) {
        throw ApiError.of('WITHDRAWAL_FREQUENCY_LIMIT', `每月最多 ${monthlyLimit} 次提现`);
      }
      // 同时只有一条活跃申请（active_flag 生成列唯一键兜底）
      try {
        return await tx.withdrawal.create({
          data: {
            studentId: user.id,
            points: dto.points,
            cashAmount: (dto.points * rate).toFixed(2),
            rate: rate.toFixed(4),
            periodKey,
            status: 'PENDING',
          },
        });
      } catch (error) {
        if (String(error).includes('uk_active_withdrawal') || String(error).includes('Duplicate entry')) {
          throw ApiError.of('DUPLICATE_REQUEST', '已有待处理的提现申请');
        }
        throw error;
      }
    });

    // 冻结：可用 → FROZEN
    await this.prisma.$transaction(async (tx) => {
      const txResult = await this.ledger.post(tx, {
        type: 'WITHDRAW_FREEZE',
        bizKey: `WITHDRAW_FREEZE:${result.id}`,
        legs: [
          {
            accountKey: LedgerService.userKey(user.id),
            ownerType: 'USER',
            ownerId: user.id,
            bucket: 'AVAILABLE',
            delta: -dto.points,
          },
          {
            accountKey: LedgerService.userKey(user.id),
            ownerType: 'USER',
            ownerId: user.id,
            bucket: 'FROZEN',
            delta: dto.points,
          },
        ],
        withdrawalId: result.id,
        requestId: req.requestId,
      });
      await tx.withdrawal.update({
        where: { id: result.id },
        data: { freezeTxId: txResult.transactionId },
      });
    });

    await this.notify.notifyAdmins({
      type: 'WITHDRAWAL_REQUESTED',
      title: '有新的提现申请',
      body: `学生申请提现 ${dto.points} 积分（≈ ${(dto.points * rate).toFixed(2)} 元），请审批`,
      payload: { withdrawalId: result.id.toString() },
      dedupeKey: `withdraw:requested:${result.id}`,
    });
    return { id: result.id.toString(), status: result.status, cashAmount: (dto.points * rate).toFixed(2) };
  }

  @Get('withdrawals/me')
  async mine(@CurrentUser() user: RequestUser, @Query() query: Record<string, unknown>) {
    const rate = await this.rateEnabled();
    const p = parsePage(query);
    const [items, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { studentId: user.id },
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.withdrawal.count({ where: { studentId: user.id } }),
    ]);
    return { ...pageResult(items, total, p), withdrawEnabled: rate > 0 };
  }

  @HttpCode(200)
  @Post('withdrawals/:id/withdraw')
  async selfWithdraw(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request & { requestId?: string }) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id: BigInt(id) } });
    if (!w || w.studentId !== user.id) throw ApiError.of('FORBIDDEN');
    if (w.status !== 'PENDING') throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仅待审批的申请可以撤回');
    await this.rejectInternal(w.id, '学生主动撤回', user.id, 'STUDENT', req.requestId);
    return {};
  }

  private async rejectInternal(id: bigint, reason: string, operatorId: bigint, role: 'STUDENT' | 'TEACHER' | 'ADMIN', requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM withdrawals WHERE id = ${id.toString()} FOR UPDATE`);
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
      if (!['PENDING', 'APPROVED'].includes(w.status)) {
        throw ApiError.of('TASK_STATE_NOT_ALLOWED', '当前状态不能驳回/撤回');
      }
      // 冻结 → 可用（WITHDRAW_REFUND）
      await this.ledger.post(tx, {
        type: 'WITHDRAW_REFUND',
        bizKey: `WITHDRAW_REFUND:${id}:${w.status}`,
        legs: [
          { accountKey: LedgerService.userKey(w.studentId), ownerType: 'USER', ownerId: w.studentId, bucket: 'FROZEN', delta: -w.points },
          { accountKey: LedgerService.userKey(w.studentId), ownerType: 'USER', ownerId: w.studentId, bucket: 'AVAILABLE', delta: w.points },
        ],
        withdrawalId: id,
        operatorId: operatorId,
        reason,
        requestId,
      });
      await tx.withdrawal.update({
        where: { id },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: role === 'ADMIN' ? operatorId : null, rejectReason: reason },
      });
    });
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } });
    await this.notify.notify(w.studentId, {
      type: 'WITHDRAWAL_REJECTED',
      title: '提现申请被驳回',
      body: `你的提现申请（${w.points} 积分）已驳回：${reason}。积分已解冻回可用余额`,
      payload: { withdrawalId: id.toString() },
      dedupeKey: `withdraw:rejected:${id}`,
    });
  }

  // ---------------- 管理端 ----------------

  @Get('admin/withdrawals')
  @Roles('ADMIN')
  async list(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const where = {
      ...(query.status ? { status: query.status as Prisma.EnumWithdrawalStatusFilter['equals'] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { student: { select: { id: true, name: true, username: true, className: true } } },
      }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return pageResult(items, total, p);
  }

  @HttpCode(200)
  @Post('admin/withdrawals/:id/approve')
  @Roles('ADMIN')
  async approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request & { requestId?: string }) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.updateMany({
        where: { id: BigInt(id), status: 'PENDING' },
        data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: user.id },
      });
      if (updated.count !== 1) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '申请不在待审批状态');
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'WITHDRAWAL_APPROVE',
      targetType: 'WITHDRAWAL',
      targetId: BigInt(id),
      ...requestMetaLite(req),
    });
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: BigInt(id) } });
    await this.notify.notify(w.studentId, {
      type: 'WITHDRAWAL_APPROVED',
      title: '提现申请已通过',
      body: `你的提现申请（${w.points} 积分）已通过审批，等待线下发放`,
      payload: { withdrawalId: id },
      dedupeKey: `withdraw:approved:${id}`,
    });
    return {};
  }

  @HttpCode(200)
  @Post('admin/withdrawals/:id/reject')
  @Roles('ADMIN')
  async reject(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewWithdrawalDto,
    @Req() req: Request & { requestId?: string },
  ) {
    if (!dto.reason) throw ApiError.of('VALIDATION_FAILED', '驳回必须填写理由');
    await this.rejectInternal(BigInt(id), dto.reason, user.id, 'ADMIN', req.requestId);
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'WITHDRAWAL_REJECT',
      targetType: 'WITHDRAWAL',
      targetId: BigInt(id),
      reason: dto.reason,
      ...requestMetaLite(req),
    });
    return {};
  }

  @HttpCode(200)
  @Post('admin/withdrawals/:id/pay')
  @Roles('ADMIN')
  async pay(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewWithdrawalDto,
    @Req() req: Request & { requestId?: string },
  ) {
    const idem = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM withdrawals WHERE id = ${BigInt(id).toString()} FOR UPDATE`);
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id: BigInt(id) } });
      if (w.status !== 'APPROVED') throw ApiError.of('TASK_STATE_NOT_ALLOWED', '仅已审批的申请可以标记发放');
      // 冻结 → SYS_CASHOUT（线下已给现金，系统记录）
      const txResult = await this.ledger.post(tx, {
        type: 'WITHDRAW_PAID',
        bizKey: `WITHDRAW_PAID:${idem}`,
        legs: [
          { accountKey: LedgerService.userKey(w.studentId), ownerType: 'USER', ownerId: w.studentId, bucket: 'FROZEN', delta: -w.points },
          { accountKey: LedgerService.SYS_CASHOUT, ownerType: 'SYS_CASHOUT', bucket: 'AVAILABLE', delta: w.points },
        ],
        withdrawalId: w.id,
        operatorId: user.id,
        reason: dto.payNote ?? '线下发放',
        requestId: req.requestId,
      });
      await tx.withdrawal.update({
        where: { id: w.id },
        data: { status: 'PAID', paidAt: new Date(), paidBy: user.id, payNote: dto.payNote, payoutTxId: txResult.transactionId },
      });
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'WITHDRAWAL_PAY',
      targetType: 'WITHDRAWAL',
      targetId: BigInt(id),
      after: { payNote: dto.payNote },
      ...requestMetaLite(req),
    });
    const w = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: BigInt(id) } });
    await this.notify.notify(w.studentId, {
      type: 'WITHDRAWAL_PAID',
      title: '提现已发放',
      body: `你的提现（${w.points} 积分 = ${String(w.cashAmount)} 元）已完成线下发放`,
      payload: { withdrawalId: id },
      dedupeKey: `withdraw:paid:${id}`,
    });
    return {};
  }
}

function requestMetaLite(req: { requestId?: string; ip?: string; headers: Record<string, unknown> }) {
  return {
    requestId: req.requestId,
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}
