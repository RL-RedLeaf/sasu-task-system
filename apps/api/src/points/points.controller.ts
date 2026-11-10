import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TransactionType } from '@sasu/shared';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, requestMeta, type RequestUser } from '../common/guards/current-user.decorator';
import { ApiError } from '../common/errors/api.error';
import { AuditService } from '../common/audit/audit.service';
import { parsePage, pageResult, requireIdempotencyKey } from '../common/http/pagination';
import { LedgerService } from '../ledger/ledger.service';
import { ReconcileService } from '../ledger/reconcile.service';
import { PrismaService } from '../common/prisma/prisma.service';

export class PoolTopupDto {
  @IsInt() @Min(1) amount!: number;
  @IsString() @IsNotEmpty({ message: '必须填写原因' }) @MaxLength(255) reason!: string;
}

export class PoolAdjustDto extends PoolTopupDto {
  @IsOptional() @IsInt() @Max(0) sign?: -1 | 1; // 负数表示调减
}

export class UserPointsAdjustDto {
  @IsInt() amount!: number; // 可正可负
  @IsString() @IsNotEmpty({ message: '必须填写原因' }) @MaxLength(255) reason!: string;
}

@Controller()
export class PointsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly reconcileSvc: ReconcileService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------- 学生端 ----------------

  @Get('points/me')
  async myPoints(@CurrentUser() user: RequestUser) {
    const account = await this.ledger.getOrCreateAccount(
      this.prisma as never,
      LedgerService.userKey(user.id),
      'USER',
      user.id,
    );
    const agg = await this.prisma.pointLeg.aggregate({
      where: { account: { accountKey: LedgerService.userKey(user.id) }, delta: { gt: 0 } },
      _sum: { delta: true },
    });
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { penaltyDebt: true },
    });
    return {
      balance: account.balance,
      frozen: account.frozen,
      penaltyDebt: me.penaltyDebt,
      totalEarned: agg._sum.delta ?? 0,
    };
  }

  @Get('points/me/transactions')
  async myTransactions(@CurrentUser() user: RequestUser, @Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const [items, total] = await Promise.all([
      this.prisma.pointTransaction.findMany({
        where: {
          legs: { some: { account: { accountKey: LedgerService.userKey(user.id) } } },
        },
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          legs: {
            where: { account: { accountKey: LedgerService.userKey(user.id) } },
            select: { delta: true, bucket: true, balanceAfter: true },
          },
        },
      }),
      this.prisma.pointTransaction.count({
        where: { legs: { some: { account: { accountKey: LedgerService.userKey(user.id) } } } },
      }),
    ]);
    return pageResult(items, total, p);
  }

  // ---------------- 管理端 ----------------

  @Get('admin/points/pool')
  @Roles('ADMIN')
  async pool() {
    const [pool, sysIssue, sysCash, escrow, paid] = await Promise.all([
      this.ledger.getOrCreateAccount(this.prisma as never, LedgerService.POOL, 'POOL'),
      this.ledger.getOrCreateAccount(this.prisma as never, LedgerService.SYS_ISSUE, 'SYS_ISSUE'),
      this.ledger.getOrCreateAccount(this.prisma as never, LedgerService.SYS_CASHOUT, 'SYS_CASHOUT'),
      this.prisma.pointAccount.aggregate({ where: { ownerType: 'TASK_ESCROW' }, _sum: { balance: true } }),
      this.prisma.pointAccount.aggregate({ where: { ownerType: 'USER' }, _sum: { balance: true, frozen: true } }),
    ]);
    return {
      poolBalance: pool.balance,
      escrowTotal: escrow._sum.balance ?? 0,
      userBalanceTotal: paid._sum.balance ?? 0,
      userFrozenTotal: paid._sum.frozen ?? 0,
      issuedTotal: -(sysIssue.balance ?? 0),
      cashoutTotal: sysCash.balance,
    };
  }

  @HttpCode(200)
  @Post('admin/points/pool/topup')
  @Roles('ADMIN')
  async topup(
    @CurrentUser() operator: RequestUser,
    @Body() dto: PoolTopupDto,
    @Req() req: Request & { requestId?: string },
  ) {
    const idem = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await this.ledger.post(tx, {
        type: 'POOL_TOPUP',
        bizKey: `POOL_TOPUP:${idem}`,
        legs: [
          { accountKey: LedgerService.SYS_ISSUE, ownerType: 'SYS_ISSUE', bucket: 'AVAILABLE', delta: -dto.amount },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: dto.amount },
        ],
        operatorId: operator.id,
        reason: dto.reason,
        requestId: req.requestId,
      });
      return r;
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'POOL_TOPUP',
      targetType: 'POINT_ACCOUNT',
      targetId: null,
      after: { amount: dto.amount, reason: dto.reason, duplicate: result.duplicate },
      ...requestMeta(req),
    });
    return { transactionId: result.transactionId.toString(), duplicate: result.duplicate };
  }

  @HttpCode(200)
  @Post('admin/points/pool/adjust')
  @Roles('ADMIN')
  async adjust(
    @CurrentUser() operator: RequestUser,
    @Body() dto: PoolAdjustDto,
    @Req() req: Request & { requestId?: string },
  ) {
    const idem = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const amount = Math.abs(dto.amount) * (dto.sign === -1 ? -1 : 1);
    const result = await this.prisma.$transaction(async (tx) => {
      const pool = await this.ledger.getOrCreateAccount(tx, LedgerService.POOL, 'POOL');
      if (amount < 0 && pool.balance + amount < 0) {
        throw ApiError.of('POOL_INSUFFICIENT', '积分池余额不足，无法调减');
      }
      return this.ledger.post(tx, {
        type: amount >= 0 ? 'POOL_TOPUP' : 'POOL_ADJUST_DOWN',
        bizKey: `POOL_ADJUST:${idem}`,
        legs: [
          {
            accountKey: LedgerService.SYS_ISSUE,
            ownerType: 'SYS_ISSUE',
            bucket: 'AVAILABLE',
            delta: -amount,
          },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: amount },
        ],
        operatorId: operator.id,
        reason: dto.reason,
        requestId: req.requestId,
      });
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'POOL_ADJUST',
      targetType: 'POINT_ACCOUNT',
      after: { amount, reason: dto.reason, duplicate: result.duplicate },
      ...requestMeta(req),
    });
    return { transactionId: result.transactionId.toString(), duplicate: result.duplicate };
  }

  @HttpCode(200)
  @Post('admin/users/:id/points/adjust')
  @Roles('ADMIN')
  async adjustUser(
    @CurrentUser() operator: RequestUser,
    @Param('id') id: string,
    @Body() dto: UserPointsAdjustDto,
    @Req() req: Request & { requestId?: string },
  ) {
    const idem = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const userId = BigInt(id);
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw ApiError.of('VALIDATION_FAILED', '用户不存在');
    if (dto.amount === 0) throw ApiError.of('VALIDATION_FAILED', '调整金额不能为 0');
    if (dto.amount < 0) {
      const account = await this.prisma.pointAccount.findUnique({
        where: { accountKey: LedgerService.userKey(userId) },
      });
      if (dto.amount < 0 && (account?.balance ?? 0) + dto.amount < 0) {
        throw ApiError.of('BALANCE_INSUFFICIENT', '扣减不得超过学生可用余额');
      }
    }
    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.amount > 0) {
        return this.ledger.creditUser(tx, {
          userId,
          amount: dto.amount,
          txType: 'ADMIN_GRANT',
          bizKey: `ADMIN_GRANT:${idem}`,
          sourceKey: LedgerService.POOL,
          sourceOwnerType: 'POOL',
          reason: dto.reason,
          operatorId: operator.id,
          requestId: req.requestId,
        });
      }
      const r = await this.ledger.post(tx, {
        type: 'ADMIN_DEDUCT',
        bizKey: `ADMIN_DEDUCT:${idem}`,
        legs: [
          {
            accountKey: LedgerService.userKey(userId),
            ownerType: 'USER',
            ownerId: userId,
            bucket: 'AVAILABLE',
            delta: dto.amount,
          },
          { accountKey: LedgerService.POOL, ownerType: 'POOL', bucket: 'AVAILABLE', delta: -dto.amount },
        ],
        reason: dto.reason,
        operatorId: operator.id,
        requestId: req.requestId,
      });
      return { credited: 0, debtOffset: 0, transactionId: r.transactionId, duplicate: r.duplicate };
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: dto.amount > 0 ? 'ADMIN_GRANT' : 'ADMIN_DEDUCT',
      targetType: 'USER',
      targetId: userId,
      after: { amount: dto.amount, reason: dto.reason },
      ...requestMeta(req),
    });
    return { transactionId: result.transactionId.toString(), duplicate: result.duplicate };
  }

  @Get('admin/users/:id/points')
  @Roles('ADMIN')
  async userPoints(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const userId = BigInt(id);
    const account = await this.prisma.pointAccount.findUnique({
      where: { accountKey: LedgerService.userKey(userId) },
    });
    const p = parsePage(query);
    const [items, total, user] = await Promise.all([
      this.prisma.pointTransaction.findMany({
        where: { legs: { some: { account: { accountKey: LedgerService.userKey(userId) } } } },
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          legs: {
            where: { account: { accountKey: LedgerService.userKey(userId) } },
            select: { delta: true, bucket: true, balanceAfter: true },
          },
        },
      }),
      this.prisma.pointTransaction.count({
        where: { legs: { some: { account: { accountKey: LedgerService.userKey(userId) } } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { penaltyDebt: true, name: true, username: true } }),
    ]);
    return {
      ...pageResult(items, total, p),
      balance: account?.balance ?? 0,
      frozen: account?.frozen ?? 0,
      penaltyDebt: user?.penaltyDebt ?? 0,
    };
  }

  @Get('admin/points/transactions')
  @Roles('ADMIN')
  async allTransactions(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const where = {
      ...(query.type ? { type: query.type as TransactionType } : {}),
      ...(query.taskId ? { taskId: BigInt(String(query.taskId)) } : {}),
      ...(query.userId ? { legs: { some: { account: { accountKey: LedgerService.userKey(BigInt(String(query.userId))) } } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.pointTransaction.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { legs: { include: { account: { select: { accountKey: true } } } } },
      }),
      this.prisma.pointTransaction.count({ where }),
    ]);
    return pageResult(items, total, p);
  }

  @Get('admin/points/reconcile')
  @Roles('ADMIN')
  async reconcile() {
    return this.reconcileSvc.run();
  }
}
