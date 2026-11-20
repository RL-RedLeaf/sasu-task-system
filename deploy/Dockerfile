# syntax=docker/dockerfile:1
# 三段式镜像（PRD §12.1）：build → api / web
# 构建：docker build -f deploy/Dockerfile --target api -t sasu-api .
#       docker build -f deploy/Dockerfile --target web -t sasu-web .
# 构建上下文必须是仓库根目录。

ARG NODE_IMAGE=node:24-slim

# ---------- stage 1: build ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
# 先拷依赖清单与根 tsconfig（子包 tsconfig 均 extends ../../tsconfig.base.json）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm build
# 生产镜像不装 tsx：把 prisma/seed.ts 打成单文件，容器内用 node prisma/seed.cjs 执行
RUN pnpm --filter @sasu/api seed:bundle
# 物化 api 运行时：包文件（含 dist/、prisma/、seed.cjs）+ 生产依赖（含生成的 Prisma 客户端）
# pnpm 10+ 对未启用 inject-workspace-packages 的 workspace 需要 --legacy 才能 deploy
RUN pnpm --filter @sasu/api deploy --prod --legacy /out/api

# ---------- stage 2: api ----------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build /out/api /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# 启动前应用迁移（幂等）；迁移失败则拒绝启动（fail-fast）
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]

# ---------- stage 3: web ----------
FROM nginx:alpine AS web
ENV TZ=Asia/Shanghai
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
