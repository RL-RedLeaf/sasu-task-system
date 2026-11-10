import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashSync, compareSync, genSaltSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../common/errors/api.error';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConfigService } from '../common/config/config.service';
import type { Role } from '@sasu/shared';

export interface LoginResult {
  token: string;
  expiresInDays: number;
  user: { id: string; username: string; name: string; role: Role; mustChangePassword: boolean };
}

const LOCK_CHECK_WINDOW_MS = 15 * 60 * 1000;
/** 登录限流：10 次/分钟/IP（PRD §4.2） */
const IP_RATE_LIMIT = 10;
const IP_RATE_WINDOW_MS = 60_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private ipHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  hashPassword(plain: string): string {
    return hashSync(plain, genSaltSync(12));
  }

  /** 初始密码：10 位随机（PRD AUTH-05） */
  generateInitialPassword(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(10);
    let out = '';
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }

  validatePasswordStrength(password: string): void {
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      throw ApiError.of('VALIDATION_FAILED', '新密码至少 8 位，且需同时包含字母和数字');
    }
  }

  private async checkIpRateLimit(ip: string): Promise<void> {
    const now = Date.now();
    const hits = (this.ipHits.get(ip) ?? []).filter((t) => now - t < IP_RATE_WINDOW_MS);
    if (hits.length >= IP_RATE_LIMIT) {
      throw ApiError.of('VALIDATION_FAILED', '尝试过于频繁，请稍后再试');
    }
    hits.push(now);
    this.ipHits.set(ip, hits);
  }

  async login(username: string, password: string, ip: string): Promise<LoginResult> {
    await this.checkIpRateLimit(ip);

    const maxFails = await this.config.getInt('LOGIN_MAX_FAILS', 5);
    const lockMinutes = await this.config.getInt('LOGIN_LOCK_MINUTES', 15);
    const since = new Date(Date.now() - LOCK_CHECK_WINDOW_MS);
    const [failsByUser, failsByIp] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: { username, success: false, createdAt: { gte: since } },
      }),
      this.prisma.loginAttempt.count({
        where: { ip, success: false, createdAt: { gte: since } },
      }),
    ]);
    if (failsByUser >= maxFails || failsByIp >= maxFails) {
      throw ApiError.of(
        'VALIDATION_FAILED',
        `失败次数过多，账号已锁定 ${lockMinutes} 分钟`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    const ok = user ? compareSync(password, user.passwordHash) : false;
    await this.prisma.loginAttempt.create({
      data: { username, ip, success: ok },
    });
    // 统一提示，不暴露账号是否存在（PRD AUTH-01）
    if (!user || !ok) throw ApiError.of('VALIDATION_FAILED', '账号或密码错误');
    if (user.status !== 'ACTIVE') throw ApiError.of('ACCOUNT_DISABLED');

    const sessionDays = await this.config.getInt('SESSION_DAYS', 7);
    const token = await this.jwt.signAsync({
      sub: user.id.toString(),
      role: user.role,
      tv: user.tokenVersion,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      token,
      expiresInDays: sessionDays,
      user: {
        id: user.id.toString(),
        username: user.username,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async logout(userId: bigint): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async changePassword(
    userId: bigint,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    this.validatePasswordStrength(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.of('UNAUTHORIZED');
    if (!compareSync(oldPassword, user.passwordHash)) {
      throw ApiError.of('VALIDATION_FAILED', '旧密码不正确');
    }
    if (compareSync(newPassword, user.passwordHash)) {
      throw ApiError.of('VALIDATION_FAILED', '新密码不能与旧密码相同');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: this.hashPassword(newPassword),
        tokenVersion: { increment: 1 },
        mustChangePassword: false,
      },
    });
  }

  /** 管理员重置密码：生成新初始密码，只展示一次（PRD AUTH-05） */
  async adminResetPassword(
    operator: { id: bigint; role: Role },
    targetUserId: bigint,
  ): Promise<string> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw ApiError.of('VALIDATION_FAILED', '用户不存在');
    const initial = this.generateInitialPassword();
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        passwordHash: this.hashPassword(initial),
        tokenVersion: { increment: 1 },
        mustChangePassword: true,
      },
    });
    return initial;
  }
}
