import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, type RequestUser } from '../common/guards/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';

class RunJobDto {
  @IsIn(['close', 'settle', 'reminders', 'cleanup']) job!: string;
  /** close 作业支持：把指定任务的 deadline 强制设为过去（验收/演练用，写审计） */
  @IsOptional() @IsInt() forceDeadlineTaskId?: number;
}

/**
 * 管理端手动触发定时任务（验收脚本 §15 / 运维兜底用；与 cron 同一实现，幂等）。
 * 另提供「强制到期」调试能力：仅测试/演练，写审计 DEV_FORCE_DEADLINE。
 */
@Controller('admin/jobs')
@Roles('ADMIN')
export class AdminJobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @HttpCode(200)
  @Post('run')
  async run(@CurrentUser() user: RequestUser, @Body() dto: RunJobDto) {
    if (dto.forceDeadlineTaskId) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE tasks SET deadline_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ${dto.forceDeadlineTaskId}`,
      );
      await this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'DEV_FORCE_DEADLINE',
        targetType: 'TASK',
        targetId: BigInt(dto.forceDeadlineTaskId),
        reason: '验收脚本：强制任务到期',
      });
    }
    switch (dto.job) {
      case 'close':
        await this.jobs.closeExpiredTasks();
        return { job: 'close' };
      case 'settle':
        await this.jobs.settleReadyTasks();
        return { job: 'settle' };
      case 'reminders':
        await this.jobs.dailyReminders();
        return { job: 'reminders' };
      default:
        await this.jobs.cleanupNotifications();
        return { job: 'cleanup' };
    }
  }
}
