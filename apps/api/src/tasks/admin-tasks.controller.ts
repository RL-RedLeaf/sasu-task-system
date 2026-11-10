import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TaskStatus } from '@sasu/shared';
import { PricingService } from './pricing.service';
import { LifecycleService } from './lifecycle.service';
import { AssignmentsService } from './assignments.service';
import { TasksService } from './tasks.service';
import { CancelTaskDto, CloseTaskDto, PriceDto, RepriceDto } from './dto';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { parsePage } from '../common/http/pagination';

/** 管理端任务接口（§10.6） */
@Controller('admin/tasks')
@Roles('ADMIN')
export class AdminTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly pricing: PricingService,
    private readonly lifecycle: LifecycleService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    return this.tasks.adminList({
      status: query.status as TaskStatus | undefined,
      keyword: query.keyword as string | undefined,
      page: p.page,
      pageSize: p.pageSize,
      skip: p.skip,
      take: p.take,
    });
  }

  @HttpCode(200)
  @Post(':id/price')
  async price(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PriceDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.pricing.price(BigInt(id), dto, {
      operator: { id: user.id, role: user.role },
      requestId: req.requestId,
    });
  }

  @HttpCode(200)
  @Patch(':id/reward')
  async reprice(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RepriceDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.pricing.reprice(BigInt(id), dto, {
      operator: { id: user.id, role: user.role },
      requestId: req.requestId,
    });
  }

  @HttpCode(200)
  @Post(':id/close')
  async forceClose(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CloseTaskDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.lifecycle.close(BigInt(id), { operator: { id: user.id, role: user.role }, requestId: req.requestId }, dto.reason);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async forceCancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelTaskDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.lifecycle.forceCancel(BigInt(id), { operator: { id: user.id, role: user.role }, requestId: req.requestId }, dto.reason);
  }

  @HttpCode(200)
  @Post(':id/offline')
  async forceOffline(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelTaskDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.lifecycle.forceOffline(BigInt(id), { operator: { id: user.id, role: user.role }, requestId: req.requestId }, dto.reason);
  }

  /** 结算预览（不写库，§10.6） */
  @Get(':id/settlement-preview')
  async settlementPreview(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const task = await this.tasks.detail(BigInt(id), { id: user.id, role: user.role });
    const passed = await this.assignments.passedAssignments(BigInt(id));
    const escrowBalance = task.totalAmount - task.paidBaseAmount - task.paidBonusAmount - task.refundedAmount;
    const acceptedCount = passed.length;
    const refundOnly = task.settlementMode === 'REFUND_ONLY';
    const share = refundOnly || acceptedCount === 0 ? 0 : Math.floor(escrowBalance / acceptedCount);
    const remainder = refundOnly || acceptedCount === 0 ? 0 : escrowBalance % acceptedCount;
    return {
      escrowBalance,
      acceptedCount,
      settlementMode: task.settlementMode,
      perPerson: share,
      remainderRecipients: remainder,
      refundToPool: refundOnly || acceptedCount === 0 ? escrowBalance : 0,
      passed: passed.map((a) => ({
        assignmentId: a.id.toString(),
        student: a.student.name,
        basePaid: a.basePaid,
        acceptedAt: a.acceptedAt,
      })),
    };
  }
}
