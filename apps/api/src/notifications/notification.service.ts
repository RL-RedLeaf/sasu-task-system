import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
}

/**
 * 站内通知（PRD §6.7）：dedupe_key 防重复。
 * P1 邮件走 outbox；未配置 SMTP 时只发站内（M5 接 outbox worker）。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: bigint, input: NotifyInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: input.type,
          title: input.title.slice(0, 255),
          body: input.body,
          payload: (input.payload ?? null) as never,
          dedupeKey:
            input.dedupeKey ?? `ntf:${input.type}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        },
      });
    } catch (error) {
      // dedupe 冲突视为已通知，其余记录告警不阻断业务
      const msg = String(error);
      if (!msg.includes('Unique constraint')) {
        this.logger.error(`notify failed (${input.type}): ${msg}`);
      }
    }
  }

  async notifyMany(userIds: bigint[], input: NotifyInput): Promise<void> {
    const unique = [...new Set(userIds.map(String))].map((id) => BigInt(id));
    await Promise.all(unique.map((id) => this.notify(id, input)));
  }

  /** 全体管理员（待定价提醒等） */
  async notifyAdmins(input: NotifyInput): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    await this.notifyMany(admins.map((a) => a.id), input);
  }
}
