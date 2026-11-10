import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { ApiError } from '../common/errors/api.error';
import { AuditService } from '../common/audit/audit.service';
import { parsePage, pageResult } from '../common/http/pagination';
import { PrismaService } from '../common/prisma/prisma.service';

export class AnnouncementDto {
  @IsString() @IsNotEmpty() @MaxLength(100) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(5000) content!: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'OFFLINE']) status?: 'DRAFT' | 'PUBLISHED' | 'OFFLINE';
}

export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) content!: string;
  @IsOptional() @IsInt() parentId?: number;
}

export class ReportDto {
  @IsIn(['TASK', 'COMMENT']) targetType!: 'TASK' | 'COMMENT';
  @IsInt() @IsNotEmpty() targetId!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/** 公告（AD-12）/ 留言（§6.8）/ 举报（§6.9） */
@Controller()
export class CommunityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- 公告 ----------------

  @Get('announcements')
  async announcements() {
    const items = await this.prisma.announcement.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    });
    return { items };
  }

  @Get('admin/announcements')
  @Roles('ADMIN')
  async adminAnnouncements(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ orderBy: { id: 'desc' }, skip: p.skip, take: p.take }),
      this.prisma.announcement.count(),
    ]);
    return pageResult(items, total, p);
  }

  @Post('admin/announcements')
  @Roles('ADMIN')
  async createAnnouncement(@CurrentUser() user: RequestUser, @Body() dto: AnnouncementDto) {
    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        content: dto.content,
        status: dto.status ?? 'DRAFT',
        createdBy: user.id,
        publishedAt: dto.status === 'PUBLISHED' ? new Date() : null,
      },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'ANNOUNCEMENT_CREATE',
      targetType: 'ANNOUNCEMENT',
      targetId: created.id,
      after: { title: dto.title, status: dto.status ?? 'DRAFT' },
    });
    return { id: created.id.toString() };
  }

  @Post('admin/announcements/:id/update')
  @Roles('ADMIN')
  async updateAnnouncement(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: Partial<AnnouncementDto>) {
    const before = await this.prisma.announcement.findUnique({ where: { id: BigInt(id) } });
    if (!before) throw ApiError.of('VALIDATION_FAILED', '公告不存在');
    await this.prisma.announcement.update({
      where: { id: BigInt(id) },
      data: {
        title: dto.title ?? before.title,
        content: dto.content ?? before.content,
        status: dto.status ?? before.status,
        publishedAt: dto.status === 'PUBLISHED' && !before.publishedAt ? new Date() : before.publishedAt,
      },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'ANNOUNCEMENT_UPDATE',
      targetType: 'ANNOUNCEMENT',
      targetId: BigInt(id),
      before: { status: before.status },
      after: { status: dto.status ?? before.status },
    });
    return {};
  }

  // ---------------- 留言（P1） ----------------

  @Get('tasks/:id/comments')
  async comments(@Param('id') id: string) {
    const items = await this.prisma.comment.findMany({
      where: { taskId: BigInt(id), deletedAt: null },
      orderBy: { id: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    return { items };
  }

  @Post('tasks/:id/comments')
  async comment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CommentDto) {
    const task = await this.prisma.task.findUnique({ where: { id: BigInt(id) } });
    if (!task) throw ApiError.of('VALIDATION_FAILED', '任务不存在');
    // 仅任务归属教师、已接单学生、管理员可发言（§6.8）
    if (user.role === 'STUDENT') {
      const mine = await this.prisma.taskAssignment.findFirst({
        where: { taskId: BigInt(id), studentId: user.id, status: { in: ['CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SETTLED'] } },
      });
      if (!mine) throw ApiError.of('FORBIDDEN', '仅参与任务的学生可以留言');
    } else if (user.role === 'TEACHER' && task.teacherId !== user.id) {
      throw ApiError.of('FORBIDDEN', '仅任务归属教师可以留言');
    }
    const created = await this.prisma.comment.create({
      data: {
        taskId: BigInt(id),
        authorId: user.id,
        content: dto.content,
        parentId: dto.parentId ? BigInt(dto.parentId) : null,
      },
    });
    return { id: created.id.toString() };
  }

  @HttpCode(200)
  @Post('admin/comments/:id/delete')
  @Roles('ADMIN')
  async deleteComment(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.prisma.comment.update({
      where: { id: BigInt(id) },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'COMMENT_DELETE',
      targetType: 'COMMENT',
      targetId: BigInt(id),
    });
    return {};
  }

  // ---------------- 举报（P1） ----------------

  @Post('reports')
  async report(@CurrentUser() user: RequestUser, @Body() dto: ReportDto) {
    const created = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        targetType: dto.targetType,
        targetId: BigInt(dto.targetId),
        reason: dto.reason,
      },
    });
    return { id: created.id.toString() };
  }

  @Get('admin/reports')
  @Roles('ADMIN')
  async reports(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where: query.status ? { status: query.status as 'OPEN' | 'HANDLED' | 'DISMISSED' } : {},
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { reporter: { select: { id: true, name: true, role: true } } },
      }),
      this.prisma.report.count(),
    ]);
    return pageResult(items, total, p);
  }

  @HttpCode(200)
  @Post('admin/reports/:id/handle')
  @Roles('ADMIN')
  async handleReport(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: { note?: string; dismiss?: boolean }) {
    const report = await this.prisma.report.findUnique({ where: { id: BigInt(id) } });
    if (!report) throw ApiError.of('VALIDATION_FAILED', '举报不存在');
    await this.prisma.report.update({
      where: { id: BigInt(id) },
      data: {
        status: dto.dismiss ? 'DISMISSED' : 'HANDLED',
        handledBy: user.id,
        handledAt: new Date(),
        handleNote: dto.note,
      },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'REPORT_HANDLE',
      targetType: 'REPORT',
      targetId: BigInt(id),
      reason: dto.note,
      after: { dismiss: dto.dismiss === true },
    });
    return {};
  }
}
