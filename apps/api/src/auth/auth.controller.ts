import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto';
import { COOKIE_NAME } from '../common/guards/auth.guard';
import { CurrentUser, requestMeta, type RequestUser } from '../common/guards/current-user.decorator';
import { Public } from '../common/guards/public.decorator';

/** 会话 Cookie：httpOnly + SameSite=Lax，生产环境 Secure（PRD §11.2） */
function sessionCookieOptions(days: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: days * 24 * 3600 * 1000,
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      dto.username,
      dto.password,
      requestMeta(req).ip ?? 'unknown',
    );
    res.cookie(COOKIE_NAME, result.token, sessionCookieOptions(result.expiresInDays));
    return { user: result.user };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.id);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return {};
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return {
      id: user.id.toString(),
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return {};
  }
}
