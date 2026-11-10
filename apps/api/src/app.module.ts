import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';

/**
 * M0 脚手架：仅 healthz + 记账入口骨架。
 * 业务模块（auth/users/tasks/assignments/points/withdrawals/disputes/admin/jobs）按里程碑 M1–M5 加入。
 */
@Module({
  imports: [PrismaModule, HealthModule, LedgerModule],
})
export class AppModule {}
