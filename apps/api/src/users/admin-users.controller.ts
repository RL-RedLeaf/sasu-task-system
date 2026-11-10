import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@sasu/shared';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit/audit.service';
import { Roles } from '../common/guards/auth.guard';
import { CurrentUser, requestMeta, type RequestUser } from '../common/guards/current-user.decorator';
import { parsePage } from '../common/http/pagination';
import { PrismaService } from '../common/prisma/prisma.service';

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(32) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) name!: string;
  @IsIn(['STUDENT', 'TEACHER', 'ADMIN']) role!: Role;
  @IsOptional() @IsString() @MaxLength(64) className?: string;
  @IsOptional() @IsEmail() @MaxLength(128) email?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(32) name?: string;
  @IsOptional() @IsString() @MaxLength(64) className?: string;
  @IsOptional() @IsEmail() @MaxLength(128) email?: string;
  @IsOptional() @IsIn(['STUDENT', 'TEACHER', 'ADMIN']) role?: Role;
}

export class SetStatusDto {
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

interface UploadedExcel {
  buffer: Buffer;
  originalname: string;
}

@Controller('admin/users')
@Roles('ADMIN')
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const p = parsePage(query);
    const { items, total } = await this.users.list({
      keyword: query.keyword as string | undefined,
      role: query.role as Role | undefined,
      status: query.status as 'ACTIVE' | 'DISABLED' | undefined,
      page: p.page,
      pageSize: p.pageSize,
      skip: p.skip,
      take: p.take,
    });
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  @Post()
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    return this.users.create({ id: user.id, role: user.role }, dto, requestMeta(req));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.users.update({ id: user.id, role: user.role }, BigInt(id), dto, requestMeta(req));
  }

  @HttpCode(200)
  @Post(':id/disable')
  async disable(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetStatusDto,
    @Req() req: Request,
  ) {
    return this.users.setStatus({ id: user.id, role: user.role }, BigInt(id), true, dto.reason, {
      ...requestMeta(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @HttpCode(200)
  @Post(':id/enable')
  async enable(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.users.setStatus({ id: user.id, role: user.role }, BigInt(id), false, undefined, {
      ...requestMeta(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @HttpCode(200)
  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser() operator: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const initial = await this.auth.adminResetPassword(
      { id: operator.id, role: operator.role },
      BigInt(id),
    );
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'USER_RESET_PASSWORD',
      targetType: 'USER',
      targetId: BigInt(id),
      ...requestMeta(req),
    });
    return { initialPassword: initial };
  }

  @HttpCode(200)
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: UploadedExcel | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new Error('请上传 Excel 文件');
    return this.users.import({ id: user.id, role: user.role }, file.buffer, requestMeta(req));
  }

  @Get('import/:batchId/errors')
  async importErrors(@Param('batchId') batchId: string) {
    const items = await this.prisma.importError.findMany({
      where: { batchId: BigInt(batchId) },
      orderBy: { rowNum: 'asc' },
    });
    return { items };
  }

  @Get('export')
  async export(@Res() res: Response) {
    const buffer = await this.users.export();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="users.xlsx"');
    res.end(buffer);
  }

  /** Excel 导入模板下载 */
  @Get('import-template')
  async template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="users-template.xlsx"');
    res.end(this.users.templateBuffer());
  }
}
