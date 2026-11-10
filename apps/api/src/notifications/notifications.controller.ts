import { Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { parsePage, pageResult } from '../common/http/pagination';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: Record<string, unknown>,
  ) {
    const p = parsePage(query);
    const where = {
      userId: user.id,
      ...(query.unreadOnly === '1' ? { readAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    const unread = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { ...pageResult(items, total, p), unread };
  }

  @HttpCode(200)
  @Post(':id/read')
  async read(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({
      where: { id: BigInt(id), userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return {};
  }

  @HttpCode(200)
  @Post('read-all')
  async readAll(@CurrentUser() user: RequestUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return {};
  }
}
