import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Role } from '@sasu/shared';

export interface AuditInput {
  actorId: bigint;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId?: bigint | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * 审计服务（PRD §7.4）：所有敏感操作必须调用。
 * 审计失败不阻断业务（记日志告警），但调用方应保证传参真实。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          before: toJsonObject(input.before) ?? Prisma.JsonNull,
          after: toJsonObject(input.after) ?? Prisma.JsonNull,
          reason: input.reason,
          ip: input.ip,
          userAgent: input.userAgent?.slice(0, 255),
          requestId: input.requestId,
        },
      });
    } catch (error) {
      this.logger.error(`audit log failed for ${input.action}: ${String(error)}`);
    }
  }
}

function toJsonObject(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
