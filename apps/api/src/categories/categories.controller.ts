import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiError } from '../common/errors/api.error';
import { AuditService } from '../common/audit/audit.service';

class CategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(32) name!: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

@Controller()
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  async list() {
    const items = await this.prisma.taskCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items };
  }

  @Post('admin/categories')
  @Roles('ADMIN')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CategoryDto) {
    const exists = await this.prisma.taskCategory.findFirst({
      where: { name: dto.name, deletedAt: null },
    });
    if (exists) throw ApiError.of('VALIDATION_FAILED', '分类名已存在');
    const created = await this.prisma.taskCategory.create({
      data: { name: dto.name, description: dto.description, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'CATEGORY_CREATE',
      targetType: 'CATEGORY',
      targetId: created.id,
      after: dto,
    });
    return { id: created.id.toString() };
  }

  @Patch('admin/categories/:id')
  @Roles('ADMIN')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: Partial<CategoryDto>) {
    const before = await this.prisma.taskCategory.findUnique({ where: { id: BigInt(id) } });
    if (!before || before.deletedAt) throw ApiError.of('VALIDATION_FAILED', '分类不存在');
    const after = await this.prisma.taskCategory.update({
      where: { id: BigInt(id) },
      data: {
        name: dto.name ?? before.name,
        description: dto.description ?? before.description,
        sortOrder: dto.sortOrder ?? before.sortOrder,
      },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'CATEGORY_UPDATE',
      targetType: 'CATEGORY',
      targetId: BigInt(id),
      before: { name: before.name, sortOrder: before.sortOrder },
      after: { name: after.name, sortOrder: after.sortOrder },
    });
    return {};
  }

  @Post('admin/categories/:id/delete')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const target = await this.prisma.taskCategory.findUnique({
      where: { id: BigInt(id) },
      include: { _count: { select: { tasks: true } } },
    });
    if (!target || target.deletedAt) throw ApiError.of('VALIDATION_FAILED', '分类不存在');
    if (target._count.tasks > 0) throw ApiError.of('VALIDATION_FAILED', '该分类下已有任务，无法删除');
    await this.prisma.taskCategory.update({
      where: { id: BigInt(id) },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'CATEGORY_DELETE',
      targetType: 'CATEGORY',
      targetId: BigInt(id),
      before: { name: target.name },
    });
    return {};
  }
}
