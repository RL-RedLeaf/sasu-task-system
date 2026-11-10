import { type CanActivate, type ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Role } from '@sasu/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';

export const ROLES_KEY = 'sasu:roles';
/** 路由角色白名单；不标注 = 仅要求登录 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface RequestUser {
  id: bigint;
  role: Role;
  name: string;
  mustChangePassword: boolean;
}

export type AuthedRequest = Request & { user?: RequestUser; requestId?: string };

export const COOKIE_NAME = 'sasu_token';

/** JWT(httpOnly Cookie) + DB 校验 token_version/status：禁用与改密后下一次请求即失效（PRD §7.1） */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(req, COOKIE_NAME) ?? readBearer(req);
    if (!token) throw new UnauthorizedException('未登录');

    let payload: { sub?: string; tv?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    const userId = BigInt(payload.sub ?? '0');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('账号已被禁用，请联系管理员');
    }
    if (user.tokenVersion !== (payload.tv ?? -1)) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    req.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
    };

    // 首登未改密：仅放行改密/登出/自身信息（PRD AUTH-02）
    const allowedWhileForced = ['/api/v1/auth/change-password', '/api/v1/auth/logout', '/api/v1/auth/me'];
    if (
      user.mustChangePassword &&
      !allowedWhileForced.some((p) => (req.originalUrl ?? req.url ?? '').split('?')[0] === p)
    ) {
      throw new ForbiddenException('请先修改初始密码');
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !required.includes(user.role)) {
      throw new ForbiddenException('没有权限执行该操作');
    }
    return true;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function readBearer(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}
