import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { Roles } from '../common/guards/auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';

/** 统计报表（AD-11/AD-04） */
@Controller('admin/stats')
@Roles('ADMIN')
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview() {
    const [tasksByStatus, usersByRole, settledAgg, violations, withdrawalsPending, disputesOpen, reportsOpen] =
      await Promise.all([
        this.prisma.task.groupBy({ by: ['status'], _count: true }),
        this.prisma.user.groupBy({ by: ['role'], _count: true }),
        this.prisma.task.aggregate({
          where: { status: 'SETTLED' },
          _sum: { paidBaseAmount: true, paidBonusAmount: true, refundedAmount: true },
        }),
        this.prisma.user.aggregate({ _sum: { violationCount: true } }),
        this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
        this.prisma.dispute.count({ where: { status: 'OPEN' } }),
        this.prisma.report.count({ where: { status: 'OPEN' } }),
      ]);
    const pendingReward = tasksByStatus.find((t) => t.status === 'PENDING_REWARD')?._count ?? 0;
    const completed = await this.prisma.task.count({
      where: { status: 'SETTLED', acceptedCount: { gt: 0 } },
    });
    const closedCount = await this.prisma.task.count({
      where: { status: { in: ['SETTLED', 'CANCELLED'] } },
    });
    return {
      tasksByStatus: Object.fromEntries(tasksByStatus.map((t) => [t.status, t._count])),
      usersByRole: Object.fromEntries(usersByRole.map((u) => [u.role, u._count])),
      pendingReward,
      paidBaseTotal: settledAgg._sum.paidBaseAmount ?? 0,
      paidBonusTotal: settledAgg._sum.paidBonusAmount ?? 0,
      refundedTotal: settledAgg._sum.refundedAmount ?? 0,
      violationTotal: violations._sum.violationCount ?? 0,
      withdrawalsPending,
      disputesOpen,
      reportsOpen,
      completionRate: closedCount > 0 ? Math.round((completed / closedCount) * 100) : 0,
    };
  }

  @Get('export')
  async export(@Res() res: Response) {
    // 四张表导出（PRD §15.2-8）：用户/任务/积分流水/提现
    const [users, tasks, txs, withdrawals] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.task.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.pointTransaction.findMany({ orderBy: { id: 'asc' }, include: { legs: { include: { account: true } } } }),
      this.prisma.withdrawal.findMany({ orderBy: { id: 'asc' } }),
    ]);

    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('users');
    ws1.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: '学号/工号', key: 'username', width: 16 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '角色', key: 'role', width: 10 },
      { header: '状态', key: 'status', width: 10 },
    ];
    users.forEach((u) => ws1.addRow({ ...u, id: u.id.toString() }));

    const ws2 = wb.addWorksheet('tasks');
    ws2.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: '标题', key: 'title', width: 30 },
      { header: '状态', key: 'status', width: 14 },
      { header: '单人赏金', key: 'rewardPerPerson', width: 10 },
      { header: '名额', key: 'headcount', width: 8 },
      { header: '已发基础分', key: 'paidBaseAmount', width: 12 },
      { header: '已发再分配', key: 'paidBonusAmount', width: 12 },
      { header: '已退回', key: 'refundedAmount', width: 10 },
    ];
    tasks.forEach((t) => ws2.addRow({ ...t, id: t.id.toString() }));

    const ws3 = wb.addWorksheet('point_transactions');
    ws3.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: '类型', key: 'type', width: 20 },
      { header: '业务键', key: 'bizKey', width: 40 },
      { header: '分录', key: 'legs', width: 60 },
      { header: '时间', key: 'createdAt', width: 20 },
    ];
    txs.forEach((t) =>
      ws3.addRow({
        id: t.id.toString(),
        type: t.type,
        bizKey: t.bizKey,
        legs: t.legs.map((l) => `${l.account.accountKey}:${l.bucket}:${l.delta}`).join(' | '),
        createdAt: t.createdAt,
      }),
    );

    const ws4 = wb.addWorksheet('withdrawals');
    ws4.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: '学生ID', key: 'studentId', width: 10 },
      { header: '积分', key: 'points', width: 10 },
      { header: '现金', key: 'cashAmount', width: 10 },
      { header: '汇率', key: 'rate', width: 10 },
      { header: '状态', key: 'status', width: 10 },
      { header: '月份', key: 'periodKey', width: 10 },
    ];
    withdrawals.forEach((w) => ws4.addRow({ ...w, id: w.id.toString(), studentId: w.studentId.toString() }));

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sasu-stats-export.xlsx"');
    res.end(Buffer.from(buffer as ArrayBuffer));
  }
}
