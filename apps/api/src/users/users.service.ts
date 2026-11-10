import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../common/audit/audit.service';
import { ApiError } from '../common/errors/api.error';
import { Role } from '@sasu/shared';
import * as ExcelJS from 'exceljs';

export interface ImportRowResult {
  row: number;
  username?: string;
  error?: string;
}

export interface ImportSummary {
  batchId: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  /** 仅本次展示一次：username → 初始密码 */
  initialPasswords: { username: string; password: string }[];
  errors: ImportRowResult[];
}

/** Excel 导入（PRD AD-03）：模板列 姓名* / 学号工号* / 角色* / 班级部门 / 邮箱 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    keyword?: string;
    role?: Role;
    status?: 'ACTIVE' | 'DISABLED';
    page: number;
    pageSize: number;
    skip: number;
    take: number;
  }) {
    const where = {
      ...(query.keyword
        ? {
            OR: [
              { username: { contains: query.keyword } },
              { name: { contains: query.keyword } },
              { className: { contains: query.keyword } },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          className: true,
          email: true,
          status: true,
          mustChangePassword: true,
          lastLoginAt: true,
          violationCount: true,
          penaltyDebt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  async create(
    operator: { id: bigint; role: Role },
    input: { username: string; name: string; role: Role; className?: string; email?: string },
    meta: { ip?: string; requestId?: string },
  ) {
    const exists = await this.prisma.user.findUnique({ where: { username: input.username } });
    if (exists) throw ApiError.of('VALIDATION_FAILED', `学号/工号 ${input.username} 已存在`);
    const initial = this.auth.generateInitialPassword();
    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        name: input.name,
        role: input.role,
        className: input.className,
        email: input.email,
        passwordHash: this.auth.hashPassword(initial),
        mustChangePassword: true,
      },
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'USER_CREATE',
      targetType: 'USER',
      targetId: user.id,
      after: { username: user.username, role: user.role },
      ...meta,
    });
    return { id: user.id.toString(), initialPassword: initial };
  }

  async update(
    operator: { id: bigint; role: Role },
    targetId: bigint,
    input: { name?: string; className?: string; email?: string; role?: Role },
    meta: { ip?: string; requestId?: string },
  ) {
    const before = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!before) throw ApiError.of('VALIDATION_FAILED', '用户不存在');
    const after = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        name: input.name ?? before.name,
        className: input.className ?? before.className,
        email: input.email ?? before.email,
        role: input.role ?? before.role,
      },
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'USER_UPDATE',
      targetType: 'USER',
      targetId: targetId,
      before: { role: before.role, name: before.name },
      after: { role: after.role, name: after.name },
      ...meta,
    });
    return { id: after.id.toString() };
  }

  async setStatus(
    operator: { id: bigint; role: Role },
    targetId: bigint,
    disabled: boolean,
    reason: string | undefined,
    meta: { ip?: string; requestId?: string; userAgent?: string },
  ) {
    if (disabled && !reason) throw ApiError.of('VALIDATION_FAILED', '禁用账号必须填写原因');
    if (operator.id === targetId) throw ApiError.of('VALIDATION_FAILED', '不能禁用自己的账号');
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw ApiError.of('VALIDATION_FAILED', '用户不存在');
    await this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: disabled ? 'DISABLED' : 'ACTIVE',
        disabledReason: disabled ? reason : null,
        tokenVersion: { increment: 1 }, // 下一次请求即失效（PRD AUTH-06）
      },
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: disabled ? 'USER_DISABLE' : 'USER_ENABLE',
      targetType: 'USER',
      targetId,
      reason,
      before: { status: target.status },
      after: { status: disabled ? 'DISABLED' : 'ACTIVE' },
      ...meta,
    });
    return {};
  }

  async import(
    operator: { id: bigint; role: Role },
    fileBuffer: Buffer,
    meta: { ip?: string; requestId?: string },
  ): Promise<ImportSummary> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('无法解析 Excel 文件，请使用下载的模板');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 中没有工作表');

    const roleMap: Record<string, Role> = {
      学生: 'STUDENT',
      教师: 'TEACHER',
      管理员: 'ADMIN',
    };

    const batch = await this.prisma.importBatch.create({
      data: { fileName: 'users.xlsx', createdBy: operator.id },
    });

    const initialPasswords: { username: string; password: string }[] = [];
    const errors: ImportRowResult[] = [];
    let successRows = 0;
    let totalRows = 0;

    // 从第 2 行开始读（第 1 行为表头）
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = cellText(row.getCell(1));
      const username = cellText(row.getCell(2));
      const roleText = cellText(row.getCell(3));
      const className = cellText(row.getCell(4));
      const email = cellText(row.getCell(5));
      if (!name && !username && !roleText) continue; // 整行空跳过
      totalRows++;
      const rowNum = r;

      const role = roleMap[roleText];
      const rowError = !name
        ? '姓名为空'
        : !username
          ? '学号/工号为空'
          : !role
            ? `角色必须是：学生 / 教师 / 管理员`
            : null;

      if (rowError) {
        errors.push({ row: rowNum, username: username || undefined, error: rowError });
        await this.prisma.importError.create({
          data: {
            batchId: batch.id,
            rowNum,
            reason: rowError,
            rawData: { name, username, roleText, className, email } as never,
          },
        });
        continue;
      }

      const exists = await this.prisma.user.findUnique({ where: { username } });
      if (exists) {
        const reason = `学号/工号 ${username} 已存在，跳过`;
        errors.push({ row: rowNum, username, error: reason });
        await this.prisma.importError.create({
          data: { batchId: batch.id, rowNum, reason, rawData: { username } as never },
        });
        continue;
      }

      const password = this.auth.generateInitialPassword();
      await this.prisma.user.create({
        data: {
          username,
          name,
          role,
          className: className || null,
          email: email || null,
          passwordHash: this.auth.hashPassword(password),
          mustChangePassword: true,
        },
      });
      initialPasswords.push({ username, password });
      successRows++;
    }

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { totalRows, successRows, failedRows: errors.length, fileName: `users-${batch.id}.xlsx` },
    });
    await this.audit.log({
      actorId: operator.id,
      actorRole: operator.role,
      action: 'USER_IMPORT',
      targetType: 'IMPORT_BATCH',
      targetId: batch.id,
      after: { totalRows, successRows, failedRows: errors.length },
      ...meta,
    });

    return {
      batchId: batch.id.toString(),
      totalRows,
      successRows,
      failedRows: errors.length,
      initialPasswords,
      errors,
    };
  }

  async export(): Promise<Buffer> {
    const users = await this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: {
        username: true,
        name: true,
        role: true,
        className: true,
        email: true,
        status: true,
        violationCount: true,
        createdAt: true,
      },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('users');
    ws.columns = [
      { header: '学号/工号', key: 'username', width: 16 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '角色', key: 'role', width: 10 },
      { header: '班级/部门', key: 'className', width: 20 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '状态', key: 'status', width: 10 },
      { header: '违约次数', key: 'violationCount', width: 10 },
      { header: '创建时间', key: 'createdAt', width: 20 },
    ];
    for (const u of users) ws.addRow(u);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  /** 导入模板（AD-03：下载模板） */
  templateBuffer(): Buffer {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('users');
    ws.columns = [
      { header: '姓名*', key: 'name', width: 14 },
      { header: '学号/工号*', key: 'username', width: 16 },
      { header: '角色*', key: 'role', width: 10 },
      { header: '班级/部门', key: 'className', width: 20 },
      { header: '邮箱', key: 'email', width: 24 },
    ];
    ws.addRow({ name: '张三', username: '2025001', role: '学生', className: '五年级1班', email: '' });
    return Buffer.from(wb.xlsx.writeBuffer() as unknown as ArrayBuffer);
  }
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text).trim();
  if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result).trim();
  return String(v).trim();
}
