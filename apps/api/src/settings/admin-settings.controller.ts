import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import { AuditService } from '../common/audit/audit.service';
import { ApiError } from '../common/errors/api.error';
import { ConfigValueType } from '@sasu/shared';

class UpdateConfigDto {
  @IsString() @MaxLength(64) key!: string;
  @IsString() @MaxLength(255) value!: string;
  @IsOptional() @IsIn(['INT', 'DECIMAL', 'JSON', 'STRING', 'ENUM']) valueType?: ConfigValueType;
}

@Controller('admin/settings')
@Roles('ADMIN')
export class AdminSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const items = await this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
    return { items };
  }

  @Patch()
  async update(@CurrentUser() user: RequestUser, @Body() dto: UpdateConfigDto) {
    const before = await this.prisma.systemConfig.findUnique({ where: { key: dto.key } });
    if (!before) throw ApiError.of('VALIDATION_FAILED', `未知配置项 ${dto.key}`);
    // 类型校验：非法值直接拒绝，避免脏配置进入业务
    try {
      if (before.valueType === 'INT') {
        if (!/^-?\d+$/.test(dto.value)) throw new Error('必须是整数');
      } else if (before.valueType === 'DECIMAL') {
        if (!/^-?\d+(\.\d+)?$/.test(dto.value)) throw new Error('必须是数字');
      } else if (before.valueType === 'JSON') {
        JSON.parse(dto.value);
      }
    } catch (error) {
      throw ApiError.of('VALIDATION_FAILED', `配置值不合法：${String(error instanceof Error ? error.message : error)}`);
    }
    await this.prisma.systemConfig.update({
      where: { key: dto.key },
      data: { value: dto.value, updatedBy: user.id },
    });
    this.config.invalidate();
    await this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'CONFIG_UPDATE',
      targetType: 'SYSTEM_CONFIG',
      targetId: before.id,
      before: { key: before.key, value: before.value },
      after: { key: before.key, value: dto.value },
    });
    return {};
  }
}
