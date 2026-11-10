# sasu-task-system · SASU 校园任务平台

> 老师发任务，学生接任务，学校用积分结算。
> 面向上海科技大学附属学校（sasu）的校园任务派发与积分激励系统。

## 系统概览

| 端 | 说明 |
|---|---|
| 学生（STUDENT） | 任务大厅接单、提交交付物、积分与提现、发起仲裁 |
| 教师（TEACHER） | 发布任务（赏金由管理员定价）、验收/驳回、任务管理、留言 |
| 管理员（ADMIN） | 账号与 Excel 导入、任务定价/改价、积分池与对账、提现审批、仲裁、系统配置 |

核心链路：教师提交任务 → `PENDING_REWARD` 待定价 → 管理员定价（积分划入任务托管）→ 学生接单/提交 → 教师验收即发分 → 任务截止后结算（剩余托管平分给通过者）→ 违约扣分/欠分抵扣 → 全链路双分记账 + 13 条账务不变式对账。

产品需求与业务规则详见 `docs/PRD-sasu-task-system.md`（v0.5）与 `docs/parameter-decisions.md`（v1.1）。

## 技术栈

- **monorepo**：pnpm workspace（`apps/web` / `apps/api` / `packages/shared` / `deploy`）
- **前端**：Vue 3.5 + TypeScript 5.9 + Vite 8 + Element Plus 2.14（按需引入）+ Pinia 4 + Vue Router 5
- **后端**：NestJS 12 + Prisma 7.10（driver adapter `@prisma/adapter-mariadb`）+ MySQL 8 + node-cron
- **账本**：双分录（`point_transactions` + `point_legs`），`biz_key` 幂等，账户行按 id 升序加锁
- **部署**：三段式 Dockerfile + docker compose（web/api/mysql/backup），仅暴露 web:80

三条硬约束（PRD §12）：Node 24 LTS（`engines >=24 <25`）；依赖全部精确版本，流水线禁 `pnpm add/update`；统一 `pnpm install --frozen-lockfile`。

## 快速开始（本地开发）

```bash
# 前置：Node 24、pnpm 11、MySQL 8
pnpm install

# 准备数据库（apps/api/.env 或仓库根 .env 提供 DATABASE_URL / JWT_SECRET，见 .env.example）
pnpm db:migrate     # prisma migrate deploy
pnpm db:seed        # 6 分类 + 30 系统配置 + 系统账户 + 引导管理员（admin / Admin@2026，首登需改密）

pnpm dev            # 同时启动 web(5173) 与 api(3000)
```

登录后请立即修改初始密码。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` / `build` | 并行启动 / 构建全部 |
| `pnpm lint` / `typecheck` | ESLint / vue-tsc + tsc |
| `pnpm test` | Vitest（web）+ Jest（api） |
| `pnpm db:migrate` / `db:seed` | 迁移 / 幂等初始化数据 |
| `pnpm --filter @sasu/api exec tsx scripts/acceptance.ts` | §15.1/§15.2 验收脚本（53 项断言，需 api 运行中 + 干净库） |

## 验收与质量

- `apps/api/scripts/acceptance.ts`：PRD §15.1 P0 核心链路 + §15.2 提现/仲裁 + §15.3 边界用例，**53/53 全部通过**（真实 MySQL 执行）。
- 对账接口 `GET /api/v1/admin/points/reconcile`：§9.3 全部 13 条不变式，返回具体违规行。
- CI（GitHub Actions）：`install --frozen-lockfile → lint → typecheck → test` + MySQL 服务容器跑 `migrate deploy` + `seed` 两遍验证幂等。

## 目录结构

```
sasu-task-system/
├─ apps/web/          # Vue 前端（student/teacher/admin 页面、路由守卫、Pinia）
├─ apps/api/          # NestJS 后端（auth/users/tasks/points/withdrawals/disputes/jobs…）
│  └─ prisma/         # schema（33 表）/ migrations / seed / acceptance 脚本
├─ packages/shared/   # 前后端共享：错误码、状态机枚举、DTO（ESM 产物）
├─ deploy/            # Dockerfile / docker-compose / nginx / backup.sh
└─ docs/              # PRD 与参数决策记录（本地保留，不入库）
```
