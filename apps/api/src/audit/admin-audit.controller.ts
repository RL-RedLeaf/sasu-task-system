import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/guards/auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { parsePage, pageResult } from '../common/http/pagination';

/** 审计日志查询（AD-15） */
@Controller('admin/audit-logs')
@Roles('ADMIN')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const where = {
      ...(query.action ? { action: String(query.action) } : {}),
      ...(query.actorId ? { actorId: BigInt(String(query.actorId)) } : {}),
      ...(query.targetType ? { targetType: String(query.targetType) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResult(items, total, p);
  }
}
