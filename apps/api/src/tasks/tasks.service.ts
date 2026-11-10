import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AssignmentStatus, TaskStatus } from '@sasu/shared';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../common/audit/audit.service';
import type { CreateTaskDto, UpdateTaskDto } from './dto';

export type TxClient = Prisma.TransactionClient;

/** 任务域：创建/编辑/详情/列表（定价与生命周期见 pricing/lifecycle 服务） */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async validateDeadline(deadlineAt: Date, base?: Date): Promise<void> {
    const minHours = await this.config.getInt('TASK_DEADLINE_MIN_HOURS', 1);
    const maxDays = await this.config.getInt('TASK_DEADLINE_MAX_DAYS', 90);
    const now = base ?? new Date();
    const min = new Date(now.getTime() + minHours * 3600 * 1000);
    const max = new Date(now.getTime() + maxDays * 24 * 3600 * 1000);
    if (deadlineAt.getTime() < min.getTime()) {
      throw ApiError.of('VALIDATION_FAILED', `截止时间至少晚于当前 ${minHours} 小时`);
    }
    if (deadlineAt.getTime() > max.getTime()) {
      throw ApiError.of('VALIDATION_FAILED', `截止时间最长 ${maxDays} 天`);
    }
  }

  async create(
    operator: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' },
    dto: CreateTaskDto,
    meta: { requestId?: string },
  ) {
    if (operator.role === 'STUDENT') throw ApiError.of('FORBIDDEN');
    const category = await this.prisma.taskCategory.findFirst({
      where: { id: BigInt(dto.categoryId), deletedAt: null },
    });
    if (!category) throw ApiError.of('VALIDATION_FAILED', '分类不存在或已下线，请联系管理员');

    const headcountMax = await this.config.getInt('TASK_HEADCOUNT_MAX', 50);
    if (dto.headcount < 1 || dto.headcount > headcountMax) {
      throw ApiError.of('VALIDATION_FAILED', `名额必须在 1-${headcountMax} 之间`);
    }
    const deadlineAt = new Date(dto.deadlineAt);
    await this.validateDeadline(deadlineAt);

    let teacherId = operator.id;
    let createdBy = operator.id;
    if (operator.role === 'ADMIN') {
      // 代发：必须指定真实教师作为业务归属（PRD §6.2）
      if (!dto.teacherId) throw ApiError.of('VALIDATION_FAILED', '代发任务必须指定归属教师');
      const teacher = await this.prisma.user.findFirst({
        where: { id: BigInt(dto.teacherId), role: 'TEACHER', status: 'ACTIVE' },
      });
      if (!teacher) throw ApiError.of('VALIDATION_FAILED', '归属教师不存在或未启用');
      teacherId = teacher.id;
      createdBy = operator.id;
    }

    const task = await this.prisma.task.create({
      data: {
        teacherId,
        createdBy,
        categoryId: BigInt(dto.categoryId),
        title: dto.title,
        description: dto.description,
        requirement: dto.requirement,
        location: dto.location,
        contactInfo: dto.contactInfo,
        headcount: dto.headcount,
        deadlineAt,
        status: TaskStatus.PENDING_REWARD,
      },
    });

    if (dto.attachmentFileIds?.length) {
      const files = await this.prisma.file.findMany({
        where: { id: { in: dto.attachmentFileIds.map((n) => BigInt(n)) } },
      });
      // 附件与任务关联（files.visibility=TASK_PUBLIC 由上传接口设置）
      await this.prisma.taskAttachment.createMany({
        data: files
          .filter((f) => f.visibility === 'TASK_PUBLIC' && f.refId === null)
          .map((f) => ({ taskId: task.id, fileId: f.id })),
      });
    }

    await this.notify.notifyAdmins({
      type: 'TASK_PENDING_REWARD',
      title: '有新任务待定价',
      body: `${operator.role === 'ADMIN' ? '管理员代发' : '教师'}提交了任务「${dto.title}」，请尽快定价`,
      payload: { taskId: task.id.toString() },
      dedupeKey: `task:pending-reward:${task.id}`,
    });

    return { id: task.id.toString(), status: task.status };
  }

  /** 编辑（PRD §6.2 编辑规则），写 task_edit_history；If-Match 乐观锁 */
  async edit(
    operator: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' },
    taskId: bigint,
    dto: UpdateTaskDto,
    meta: { requestId?: string },
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');
    if (operator.role === 'STUDENT') throw ApiError.of('FORBIDDEN');
    if (task.teacherId !== operator.id && operator.role !== 'ADMIN') {
      throw ApiError.of('FORBIDDEN', '只能编辑自己发布的任务');
    }
    if (task.status === 'CLOSED' || task.status === 'SETTLED' || task.status === 'CANCELLED' || task.status === 'OFFLINE') {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已结束，不可编辑');
    }
    if (dto.version !== task.version) {
      throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已被他人修改，请刷新后重试');
    }

    const hasClaims =
      task.filledCount > 0 ||
      (await this.prisma.taskAssignment.count({
        where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED] } },
      })) > 0;

    const data: Prisma.TaskUpdateInput = {};
    const changes: { field: string; before: unknown; after: unknown }[] = [];

    const apply = (field: keyof UpdateTaskDto, value: unknown) => {
      const before = (task as unknown as Record<string, unknown>)[field as string];
      if (value !== undefined && value !== before) {
        (data as Record<string, unknown>)[field] = value;
        changes.push({ field: field as string, before, after: value });
      }
    };

    // 可改字段集（§6.2）：已有人接单时内容字段 + 截止只能延后；无人接单时含名额
    const contentFields: (keyof UpdateTaskDto)[] = [
      'title',
      'categoryId',
      'description',
      'requirement',
      'location',
      'contactInfo',
    ];
    for (const f of contentFields) apply(f, dto[f]);
    if (dto.deadlineAt !== undefined) {
      const newDeadline = new Date(dto.deadlineAt);
      if (hasClaims && newDeadline.getTime() < task.deadlineAt.getTime()) {
        throw ApiError.of('VALIDATION_FAILED', '已有人接单，截止时间只能延后');
      }
      await this.validateDeadline(newDeadline);
      if (newDeadline.getTime() !== task.deadlineAt.getTime()) {
        (data as Record<string, unknown>).deadlineAt = newDeadline;
        changes.push({ field: 'deadlineAt', before: task.deadlineAt, after: newDeadline });
      }
    }
    if (dto.headcount !== undefined && dto.headcount !== task.headcount) {
      if (hasClaims) throw ApiError.of('VALIDATION_FAILED', '已有人接单，不能修改名额');
      const headcountMax = await this.config.getInt('TASK_HEADCOUNT_MAX', 50);
      if (dto.headcount < 1 || dto.headcount > headcountMax) {
        throw ApiError.of('VALIDATION_FAILED', `名额必须在 1-${headcountMax} 之间`);
      }
      if (dto.headcount < task.filledCount) {
        throw ApiError.of('VALIDATION_FAILED', '名额不能小于当前已接单人数');
      }
      (data as Record<string, unknown>).headcount = dto.headcount;
      changes.push({ field: 'headcount', before: task.headcount, after: dto.headcount });
    }

    if (changes.length === 0) return { changed: 0, version: task.version };

    const updated = await this.prisma.$transaction(async (tx) => {
      // 乐观锁：version 未变才允许更新
      const result = await tx.task.updateMany({
        where: { id: taskId, version: task.version },
        data: { ...(data as Prisma.TaskUncheckedUpdateInput), version: { increment: 1 } },
      });
      if (result.count !== 1) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务已被他人修改，请刷新后重试');
      await tx.taskEditHistory.createMany({
        data: changes.map((c) => ({
          taskId,
          editorId: operator.id,
          field: c.field,
          before: c.before === undefined || c.before === null ? Prisma.JsonNull : (c.before as Prisma.InputJsonValue),
          after: (c.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        })),
      });
      return tx.task.findUniqueOrThrow({ where: { id: taskId } });
    });

    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'TASK_EDIT',
      targetType: 'TASK',
      targetId: taskId,
      before: Object.fromEntries(changes.map((c) => [c.field, c.before])),
      after: Object.fromEntries(changes.map((c) => [c.field, c.after])),
      ...meta,
    });

    // 编辑后通知活跃接单学生（§17 参数 19）
    if (hasClaims) {
      const students = await this.prisma.taskAssignment.findMany({
        where: { taskId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.REJECTED] } },
        select: { studentId: true },
      });
      await this.notify.notifyMany(
        students.map((s) => s.studentId),
        {
          type: 'TASK_EDITED',
          title: '任务信息有更新',
          body: `你参与的任务「${task.title}」信息被修改，请查看最新要求`,
          payload: { taskId: taskId.toString() },
          dedupeKey: `task:edit:${taskId}:${updated.version}`,
        },
      );
    }
    return { changed: changes.length, version: updated.version };
  }

  /** 详情（§8.4-9：待定价仅教师本人与管理员可见；联系方式仅接单成功学生可见） */
  async detail(taskId: bigint, viewer?: { id: bigint; role: 'STUDENT' | 'TEACHER' | 'ADMIN' }) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: true,
        teacher: { select: { id: true, name: true, className: true } },
        attachments: { include: { file: true } },
      },
    });
    if (!task) throw ApiError.of('TASK_STATE_NOT_ALLOWED', '任务不存在');

    const isTeacher = viewer?.role === 'TEACHER' && task.teacherId === viewer.id;
    const isAdmin = viewer?.role === 'ADMIN';
    if (task.status === TaskStatus.PENDING_REWARD && !isTeacher && !isAdmin) {
      // 返回 3005，不暴露任务存在性（PRD §10.2）
      throw ApiError.of('TASK_STATE_NOT_ALLOWED');
    }

    let myAssignment: { id: string; status: string } | null = null;
    let contactInfo: string | null = null;
    if (viewer && viewer.role === 'STUDENT') {
      const mine = await this.prisma.taskAssignment.findFirst({
        where: {
          taskId,
          studentId: viewer.id,
          status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.SUBMITTED, AssignmentStatus.ACCEPTED, AssignmentStatus.REJECTED, AssignmentStatus.SETTLED] },
        },
        orderBy: { attemptNo: 'desc' },
      });
      myAssignment = mine ? { id: mine.id.toString(), status: mine.status } : null;
      // 联系方式仅接单成功的学生可见
      contactInfo = mine ? task.contactInfo : null;
    } else if (isTeacher || isAdmin) {
      contactInfo = task.contactInfo;
    }

    return {
      ...task,
      contactInfo,
      myAssignment,
      remaining: task.headcount - task.filledCount,
    };
  }

  /** 任务大厅：显式排除 PENDING_REWARD（§9.4） */
  async hall(query: {
    categoryId?: bigint;
    status?: TaskStatus;
    minReward?: number;
    maxReward?: number;
    keyword?: string;
    orderBy?: 'latest' | 'deadline' | 'reward';
    page: number;
    pageSize: number;
    skip: number;
    take: number;
  }) {
    const where: Prisma.TaskWhereInput = {
      status: { not: TaskStatus.PENDING_REWARD },
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.minReward !== undefined || query.maxReward !== undefined
        ? {
            rewardPerPerson: {
              ...(query.minReward !== undefined ? { gte: query.minReward } : {}),
              ...(query.maxReward !== undefined ? { lte: query.maxReward } : {}),
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword } },
              { description: { contains: query.keyword } },
            ],
          }
        : {}),
    };
    const orderBy =
      query.orderBy === 'deadline'
        ? { deadlineAt: 'asc' as const }
        : query.orderBy === 'reward'
          ? { rewardPerPerson: 'desc' as const }
          : { id: 'desc' as const };
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy,
        skip: query.skip,
        take: query.take,
        include: {
          category: { select: { name: true } },
          teacher: { select: { name: true, className: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 教师自己的任务列表（含待定价） */
  async myTasks(teacherId: bigint, query: { status?: TaskStatus; skip: number; take: number; page: number; pageSize: number }) {
    const where: Prisma.TaskWhereInput = {
      teacherId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { category: { select: { name: true } } },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** 管理端全量任务（含待定价） */
  async adminList(query: { status?: TaskStatus; keyword?: string; skip: number; take: number; page: number; pageSize: number }) {
    const where: Prisma.TaskWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword } },
              { teacher: { name: { contains: query.keyword } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          category: { select: { name: true } },
          teacher: { select: { name: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
