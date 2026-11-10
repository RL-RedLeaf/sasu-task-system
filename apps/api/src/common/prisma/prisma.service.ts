import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * 全局唯一 PrismaClient 实例。
 * Prisma 7（Rust-free client）要求显式 driver adapter；DATABASE_URL 已由
 * main.ts 启动期校验（缺失即退出）。
 *
 * 连接失败不阻断启动（PRD §12.1）：/healthz 探测 DB 并在不可用时返回 503，
 * 由容器 HEALTHCHECK / 编排决定重启，进程自身保持存活。
 * 账本类表（point_transactions / point_legs / audit_logs）只追加、不修改、不删除（PRD §9）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaMariaDb(process.env.DATABASE_URL ?? ''),
      log: [
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('database connected');
    } catch (error) {
      this.logger.warn(
        `database unavailable at boot, /healthz will report db=false: ${String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
