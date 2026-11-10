import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { SysConfigModule } from './common/config/sys-config.module';
import { AuditModule } from './common/audit/audit.module';
import { AuthGuard } from './common/guards/auth.guard';
import { EnvelopeInterceptor } from './common/http/envelope.interceptor';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { SettingsModule } from './settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PointsModule } from './points/points.module';
import { TasksModule } from './tasks/tasks.module';

/**
 * M0 脚手架 + M1 账号/认证/分类/配置。
 * 业务模块（tasks/assignments/points/withdrawals/disputes/admin/jobs）按里程碑 M2–M5 加入。
 */
@Module({
  imports: [
    PrismaModule,
    SysConfigModule,
    AuditModule,
    HealthModule,
    LedgerModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    SettingsModule,
    NotificationsModule,
    PointsModule,
    TasksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
