import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TaskStatus } from '@sasu/shared';

type RequestX = Request & { requestId?: string };
import { TasksService } from './tasks.service';
import { LifecycleService } from './lifecycle.service';
import { AssignmentsService } from './assignments.service';
import { CancelTaskDto, CloseTaskDto, CreateTaskDto, UpdateTaskDto } from './dto';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { parsePage } from '../common/http/pagination';
import { ApiError } from '../common/errors/api.error';

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly lifecycle: LifecycleService,
    private readonly assignments: AssignmentsService,
  ) {}

  // ---------------- 任务大厅与学生侧 ----------------

  @Get('tasks')
  async hall(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    return this.tasks.hall({
      categoryId: query.categoryId ? BigInt(String(query.categoryId)) : undefined,
      status: query.status as TaskStatus | undefined,
      minReward: query.minReward ? Number(query.minReward) : undefined,
      maxReward: query.maxReward ? Number(query.maxReward) : undefined,
      keyword: query.keyword as string | undefined,
      orderBy: query.orderBy as 'latest' | 'deadline' | 'reward' | undefined,
      page: p.page,
      pageSize: p.pageSize,
      skip: p.skip,
      take: p.take,
    });
  }

  @Get('tasks/:id')
  async detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tasks.detail(BigInt(id), { id: user.id, role: user.role });
  }

  @Get('tasks/:id/assignments')
  async taskAssignments(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const task = await this.tasks.detail(BigInt(id), { id: user.id, role: user.role });
    if (task.teacherId !== user.id && user.role !== 'ADMIN') {
      throw ApiError.of('FORBIDDEN', '只有任务归属教师或管理员可以查看接单列表');
    }
    return this.assignments.listByTask(BigInt(id));
  }

  // ---------------- 接单/取消接单 ----------------

  @HttpCode(200)
  @Post('tasks/:id/claims')
  async claim(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: RequestX) {
    if (user.role !== 'STUDENT') throw ApiError.of('FORBIDDEN', '只有学生可以接单');
    return this.assignments.claim(user.id, BigInt(id), { requestId: req.requestId });
  }

  @HttpCode(200)
  @Delete('assignments/:id')
  async withdraw(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: RequestX) {
    return this.assignments.withdraw(user.id, BigInt(id), { requestId: req.requestId });
  }

  // ---------------- 教师侧 ----------------

  @Post('tasks')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTaskDto, @Req() req: RequestX) {
    return this.tasks.create({ id: user.id, role: user.role }, dto, { requestId: req.requestId });
  }

  @Get('teacher/tasks')
  async myTasks(@CurrentUser() user: RequestUser, @Query() query: Record<string, unknown>) {
    if (user.role === 'STUDENT') throw ApiError.of('FORBIDDEN');
    const p = parsePage(query);
    return this.tasks.myTasks(user.id, {
      status: query.status as TaskStatus | undefined,
      page: p.page,
      pageSize: p.pageSize,
      skip: p.skip,
      take: p.take,
    });
  }

  @Patch('tasks/:id')
  async edit(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: Request & { headers: Record<string, unknown>; requestId?: string },
  ) {
    const headerVersion = req.headers['if-match'];
    const version =
      dto.version ??
      (Array.isArray(headerVersion) ? Number(headerVersion[0]) : Number.parseInt(String(headerVersion ?? ''), 10));
    if (!Number.isFinite(version)) throw ApiError.of('VALIDATION_FAILED', '缺少版本号（If-Match 或 body.version）');
    return this.tasks.edit(
      { id: user.id, role: user.role },
      BigInt(id),
      { ...dto, version },
      { requestId: req.requestId },
    );
  }

  @HttpCode(200)
  @Post('tasks/:id/close')
  async close(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CloseTaskDto,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.lifecycle.close(
      BigInt(id),
      { operator: { id: user.id, role: user.role }, requestId: req.requestId },
      dto.reason,
    );
  }

  @HttpCode(200)
  @Post('tasks/:id/cancel')
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CancelTaskDto,
    @Req() req: Request & { requestId?: string },
  ) {
    const operator = { operator: { id: user.id, role: user.role }, requestId: req.requestId };
    const task = await this.tasks.detail(BigInt(id), { id: user.id, role: user.role });
    if (task.status === 'PENDING_REWARD') {
      return this.lifecycle.cancelPendingReward(BigInt(id), operator, dto.reason);
    }
    return this.lifecycle.cancel(BigInt(id), operator, dto.reason);
  }
}
