# Prisma 约定（apps/api/prisma）

## 与 schema.prisma 不同步的数据库对象（重要）

以下对象**只存在于 migration SQL**，schema.prisma 中没有对应定义。这是刻意的：

1. **生成列** `task_assignments.active_flag`、`withdrawals.active_flag`
   （`GENERATED ALWAYS AS (...) STORED`，PRD §5.6 / §9.2）
   —— Prisma 不支持生成列；应用层不要读写该列，它的作用是支撑唯一键。
2. **依赖生成列的唯一键** `uk_active (task_id, student_id, active_flag)`、
   `uk_active_withdrawal (student_id, active_flag)`。
3. **CHECK 约束**（PRD §9.2：tasks 金额恒等、point_accounts 非负等）。

后果与规矩：

- 以后新增迁移用 `pnpm --filter @sasu/api exec prisma migrate dev --create-only`
  （需本地 MySQL），**手工检查 diff 出的 SQL**：确认它没有试图删除上述生成列/唯一键/CHECK；
  如有，手工剔除后再 `migrate dev` 应用。
- `prisma migrate diff` 的输出同样会缺这些对象，不要直接拿它当最终迁移。
- 需要按 active_flag 查询时用 `$queryRaw`。

## 命令

| 命令                                      | 用途                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm --filter @sasu/api prisma:generate` | 生成客户端到 `src/generated/prisma`（已 gitignore）                                     |
| `pnpm db:migrate`                         | `prisma migrate deploy`，应用到最新迁移（本地/CI/生产）                                 |
| `pnpm db:seed`                            | 幂等 seed：6 个分类 + 30 项 system_configs + 系统账户（SYS_ISSUE / SYS_CASHOUT / POOL） |

## 本地环境变量

Prisma 7 不自动读 `.env`；`prisma.config.ts` 会依次找 `apps/api/.env` 与仓库根 `.env`。
开发库连接串示例：`DATABASE_URL="mysql://root:root@localhost:3306/sasu_dev"`。
