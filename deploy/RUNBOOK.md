# SASU 任务平台 · 服务器部署 Runbook

> 适用：单机 Docker Compose 部署（`web` / `api` / `mysql` / `backup`），仅暴露 `web`。
> 目标环境：阿里云轻量应用服务器 2核4G / Ubuntu 24.04 / 上海。
> 相关文档：`docs/PRD-sasu-task-system.md` §12、§15、§17；`docs/parameter-decisions.md`。

---

## 0. 先读：免费试用的边界

阿里云免费试用适合**演示和验证**，不要直接承载真实学生数据：

| 限制 | 说明 |
|---|---|
| 时长 | 轻量 2核4G 当前活动为免费 1 个月（以 `free.aliyun.com` 实时卡片为准） |
| 备案 | 试用实例不能 ICP 备案；轻量申请备案服务号要求购买时长 ≥3 个月 |
| 数据 | 到期后数据保留 1–15 天，逾期释放并清理 |
| 带宽 | 200Mbps 为峰值、共享带宽，不承诺持续跑满 |
| 可靠性 | 单机单点，无 SLA；不适合作为正式生产环境 |

正式上线建议：校方服务器（PRD 原方案）或付费 ≥3 个月的轻量/ECS + 域名 + ICP + HTTPS。

> HTTP 试用（`http://IP:8080`）的登录凭据是明文传输，只用于演示；不要导入真实学生数据，也不要用真实常用密码。

---

## 1. 选型与资源

### 1.1 为什么是轻量 2核4G

本项目是单机 Compose，MySQL 也在同一台机器上，单校并发不高：

- 轻量套餐把 CPU/内存/磁盘/带宽打包，控制台有防火墙、快照、Docker 镜像，运维简单。
- ECS 免费试用是 300 元额度制，2核4G 通常也只够约 1 个月；且试用 ECS 不支持备案。
- ECS 的优势（弹性升降配、安全组、VPC、挂 RDS/SLB）在当前阶段用不上。

### 1.2 最低配置

| 资源 | 建议 | 说明 |
|---|---|---|
| CPU/内存 | **2核4G** | 2核2G 构建阶段容易 OOM，不建议 |
| 磁盘 | 50G ESSD | 构建镜像 + MySQL + 备份足够，需定期 prune |
| 带宽 | 200M 峰值 | 演示够用；正式环境建议固定带宽 ECS |
| Swap | **4G** | 2核4G 构建防 OOM 的关键 |

运行期内存大致：MySQL 0.5–1G、API 0.3G、Nginx 20M、backup 空闲；构建期 `pnpm build` 峰值 1.5–2.5G。

---

## 2. 开通服务器

1. 完成阿里云**实名认证**。
2. 打开 `https://free.aliyun.com` → 弹性计算 → **轻量应用服务器** → 选 **2核4G / 1个月**。
3. 地域选**上海**；镜像选 **Ubuntu 24.04**（或 Docker 应用镜像）。
4. 设置 root 密码或 SSH 密钥；记录公网 IP。
5. 控制台 → 防火墙：放行 **22**、**8080**（正式 HTTPS 再放行 80/443）。
   - 不要放行 3306、3000；数据库和 API 只走 Compose 内网。
6. 到期前 3 天设提醒；确认是否自动续费/释放，避免意外扣费。

> 未备案时优先用 `IP:8080` 演示。直接用 `IP:80` 在部分地区/策略下可能被备案拦截；`8080` 更稳。

---

## 3. 初始化系统

SSH 登录：

```bash
ssh root@<公网IP>
```

### 3.1 基础设置

```bash
apt-get update && apt-get install -y ca-certificates curl git vim unzip
timedatectl set-timezone Asia/Shanghai
```

### 3.2 安装 Docker + Compose

```bash
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
systemctl enable --now docker
docker --version
docker compose version
```

如果拉取 `node:24-slim` / `mysql:8.0` / `nginx:alpine` 很慢，在阿里云 **容器镜像服务 ACR → 镜像工具 → 镜像加速器** 获取专属地址，写入 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": ["https://<你的ID>.mirror.aliyuncs.com"]
}
```

```bash
systemctl daemon-reload && systemctl restart docker
```

### 3.3 加 4G Swap（必做）

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

可选：

```bash
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p
```

---

## 4. 获取代码与配置

### 4.1 拉代码

```bash
cd /opt
git clone <仓库地址> sasu-task-system
cd sasu-task-system
```

私有仓库用 Deploy Key 或只读 PAT。没有 Git 权限时，可在本地打包后 `scp` 上传（排除 `node_modules`、`.git`、`dist`、`temp`）：

```bash
# 本地执行
tar --exclude=node_modules --exclude=.git --exclude=dist --exclude=temp \
  -czf sasu-task-system.tgz .
scp sasu-task-system.tgz root@<公网IP>:/opt/
```

### 4.2 生成 `.env`

```bash
cp .env.example .env
chmod 600 .env
```

生成密钥（MySQL 密码用 hex，避免 URL 特殊字符）：

```bash
openssl rand -hex 24     # MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD
openssl rand -base64 48  # JWT_SECRET
```

编辑 `.env`：

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://sasu:<MYSQL_PASSWORD>@mysql:3306/sasu
JWT_SECRET=<至少32字节随机串>
SESSION_DAYS=7
UPLOAD_DIR=/data/uploads
PUBLIC_ORIGIN=http://<公网IP>:8080
TZ=Asia/Shanghai
LOG_LEVEL=info

MYSQL_ROOT_PASSWORD=<强密码>
MYSQL_DATABASE=sasu
MYSQL_USER=sasu
MYSQL_PASSWORD=<强密码>
```

要点：

- `DATABASE_URL` 里的密码必须和 `MYSQL_PASSWORD` 一致；Compose 会用 `MYSQL_*` 覆盖 api 容器的 `DATABASE_URL`。
- `MYSQL_PASSWORD` 建议只用字母/数字/`-`/`_`。含 `@`、`:`、`/`、`#`、`?` 会破坏连接串。
- `PUBLIC_ORIGIN` 必须与浏览器地址**完全一致**：`http://IP:8080`、`http://IP`、`https://域名`，不要带尾部 `/`。
- 生产环境 `PUBLIC_ORIGIN=https://...` 时会话 Cookie 自动 `Secure`；`http://` 时仅用于临时试用，API 启动会打 warning。
- `JWT_SECRET` 改动会让所有已登录会话失效。
- 如果从 Windows 编辑后上传，先转 LF：`sed -i 's/\r$//' .env`。
- 改完 `.env` 后建议强制重建 api（`env_file` 内容变化不一定会自动触发重建）：

```bash
docker compose -f deploy/docker-compose.yml up -d --force-recreate api
```

### 4.3 试用端口改为 8080

编辑 `deploy/docker-compose.yml`：

```yaml
    ports:
      # 未备案试用：改为 '8080:80'，并同步 .env 的 PUBLIC_ORIGIN
      - '8080:80'
```

如果坚持用 80，把 `PUBLIC_ORIGIN` 改成 `http://<公网IP>`，并确认防火墙放行 80。

---

## 5. 构建与启动

在仓库根执行（不要在 `deploy/` 里执行）：

```bash
# 先校验 compose 配置
docker compose -f deploy/docker-compose.yml config >/dev/null

# 2核4G 建议分两次构建，避免 api/web 同时构建 OOM（共享 build 阶段，第二次会命中缓存）
docker compose -f deploy/docker-compose.yml build api
docker compose -f deploy/docker-compose.yml build web

# 启动
docker compose -f deploy/docker-compose.yml up -d
```

首次构建在 2核4G 上约 **15–40 分钟**。观察内存：

```bash
free -h
dmesg | tail -20   # 出现 "Killed process ... node" 就是 OOM
```

如果 OOM：

1. 确认 4G swap 已生效；
2. 分两次 `build api` / `build web`，不要 `up --build` 并行；
3. 仍不行就在本地/CI 构建镜像推到 ACR，服务器只 `pull`。

启动顺序：`mysql` healthy → `api` healthy → `web`；首次 MySQL 初始化约 30–60 秒。

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f --tail=100 api
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8080/healthz
# 期望：{"ok":true,"db":true,"version":"...","buildTime":...}
```

`db=false` 时返回 503，先看 MySQL：

```bash
docker compose -f deploy/docker-compose.yml logs --tail=100 mysql
```

---

## 6. 初始化数据（seed）

`api` 镜像启动时只自动跑 `prisma migrate deploy`，**不会自动 seed**。没有 seed 就没有管理员账号。

生产镜像不带 `tsx`，seed 已在构建阶段打成单文件 `prisma/seed.cjs`：

```bash
docker compose -f deploy/docker-compose.yml exec api node prisma/seed.cjs
```

期望输出：

```text
seed done: categories=6, system_configs=30, system_accounts=3
```

- seed 幂等，可重复执行；已有 ADMIN 时不会重建管理员。
- 初始管理员：`admin / Admin@2026`，首次登录强制改密。
- 如果提示 `Cannot find module 'prisma/seed.cjs'`，说明镜像太旧或构建失败：

```bash
docker compose -f deploy/docker-compose.yml exec api ls -l prisma/seed.cjs
docker compose -f deploy/docker-compose.yml build api
docker compose -f deploy/docker-compose.yml up -d
```

> 不要在正式库上跑 `apps/api/scripts/acceptance.ts`（§15 验收入口）。它会写入/清理数据，只应在干净测试库执行。

---

## 7. 首次冒烟

1. 浏览器打开 `http://<公网IP>:8080`。
2. 用 `admin / Admin@2026` 登录，立即改密码。
3. 检查浏览器 DevTools → Application → Cookies：
   - HTTP 试用：Cookie 不应带 `Secure`（带 `Secure` 会导致登录后立刻 401）。
   - HTTPS 正式：Cookie 应带 `Secure`。
4. 管理端创建/导入教师、学生账号（建议先用假数据）。
5. 走一遍：教师发任务 → 管理员定价 → 学生接单/提交 → 教师验收 → 积分到账。
6. 上传一个 <20MB 附件（Nginx 限制 25m；PRD 单文件 ≤20MB）。
7. 检查 `/healthz`、`docker compose ps`、`docker compose logs --tail=50 api`。

---

## 8. 日常运维

### 8.1 常用命令

```bash
cd /opt/sasu-task-system

# 状态 / 日志
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f --tail=100 api
docker compose -f deploy/docker-compose.yml logs --tail=100 mysql

# 重启
docker compose -f deploy/docker-compose.yml restart api
docker compose -f deploy/docker-compose.yml up -d

# 停止（保留数据卷）
docker compose -f deploy/docker-compose.yml down

# 查看卷
docker volume ls | grep sasu-task-system
```

**绝对不要**随便执行 `down -v`：会删除 `db-data`、`uploads`、`backup` 三个卷。

### 8.2 更新版本

```bash
cd /opt/sasu-task-system

# 1) 先做一次备份（见 §9）
# 2) 拉代码
git pull

# 3) 分两次构建（2核4G 防 OOM）
docker compose -f deploy/docker-compose.yml build api
docker compose -f deploy/docker-compose.yml build web

# 4) 重建容器；api 启动时会自动 migrate
docker compose -f deploy/docker-compose.yml up -d

# 5) 验证
curl -fsS http://127.0.0.1:8080/healthz
docker compose -f deploy/docker-compose.yml ps
```

迁移是向前的：如果新版本迁移失败，优先回滚代码并恢复备份，不要手工改账本表。

### 8.3 磁盘清理

```bash
docker system df
docker image prune -f
docker builder prune -f
```

不要清理 `sasu-task-system_*` 数据卷。

---

## 9. 备份与恢复

### 9.1 自动备份

`backup` 服务启动即执行一次，之后每 24 小时：

- 每日全量：`/backup/daily/sasu-YYYY-MM-DD.sql.gz`，保留 30 天；
- 每月 1 日追加月度归档：`/backup/monthly/YYYY-MM/`，保留 36 个月。

检查：

```bash
docker compose -f deploy/docker-compose.yml logs --tail=50 backup
```

### 9.2 把备份拷出服务器（必做）

备份卷在实例上，实例释放就一起没了。定期拷到本地/OSS：

```bash
mkdir -p ~/sasu-backups

# 数据库备份
docker run --rm \
  -v sasu-task-system_backup:/backup:ro \
  -v "$HOME/sasu-backups":/out \
  alpine sh -c 'cp -a /backup/. /out/'

# 上传附件（数据库备份不含 uploads）
docker run --rm \
  -v sasu-task-system_uploads:/data:ro \
  -v "$HOME/sasu-backups":/out \
  alpine sh -c 'tar czf /out/uploads-'"$(date +%F)"'.tgz -C /data .'

ls -lh ~/sasu-backups
```

再 `rsync`/`scp` 到另一台机器或 `ossutil cp` 到 OSS。建议每月做一次**恢复演练**。

### 9.3 恢复数据库

先在低峰期停止写入（可选：`docker compose ... stop api`），并先备份当前库：

```bash
gunzip -c ~/sasu-backups/daily/sasu-YYYY-MM-DD.sql.gz | \
  docker compose -f deploy/docker-compose.yml exec -T mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
```

恢复后：

```bash
docker compose -f deploy/docker-compose.yml start api
curl -fsS http://127.0.0.1:8080/healthz
```

### 9.4 恢复上传附件

```bash
docker run --rm \
  -v sasu-task-system_uploads:/data \
  -v "$HOME/sasu-backups":/in \
  alpine sh -c 'tar xzf /in/uploads-YYYY-MM-DD.tgz -C /data'
```

---

## 10. 故障排查

| 现象 | 常见原因 | 处理 |
|---|---|---|
| 构建报 `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` | pnpm 10+ 的 deploy 需要 `--legacy` | 确认 `deploy/Dockerfile` 是 `deploy --prod --legacy`；旧 checkout 请更新 |
| 构建报找不到 `tsconfig.base.json` | Dockerfile 没拷根 tsconfig | 确认 `COPY ... tsconfig.base.json ./`；旧 checkout 请更新 |
| 构建进程被杀 / exit 137 | 2核4G 构建 OOM | 加 4G swap；分两次 `build api` / `build web`；或本地构建推 ACR |
| `api` 一直 unhealthy，`/healthz` 503 | MySQL 未 healthy / 密码不一致 | 看 `mysql` 日志；确认 `.env` 的 `MYSQL_PASSWORD` 与 `DATABASE_URL` 一致 |
| `api` 启动即退出 | 缺 `JWT_SECRET` / `DATABASE_URL` | `docker compose logs api`；按 §4.2 补齐 |
| 登录 200 但随即 401 | HTTP 下 Cookie 带了 `Secure` | `PUBLIC_ORIGIN` 配成 `http://IP:8080`，再 `up -d --force-recreate api`；正式环境用 HTTPS |
| 浏览器打不开 / 502 | api 未启动、端口未放行、Nginx 上游失败 | `docker compose ps`；`curl 127.0.0.1:8080/healthz`；检查轻量防火墙 |
| 域名访问被拦截 | 大陆服务器未备案 | 试用先用 `IP:8080`；正式上线先 ICP；或改用香港/海外地域 |
| `seed.cjs` 不存在 | 旧镜像 / 构建未执行 seed:bundle | 重新 build；`ls -l prisma/seed.cjs` |
| MySQL 密码改了但连不上 | 初始化密码只在数据卷首次创建时生效 | 改回原密码，或备份后删除 `db-data` 卷重建（破坏性） |
| 磁盘满 | 镜像层、构建缓存、备份堆积 | `docker system df`；prune；把备份拷走 |
| 时间不对 | 宿主机/容器时区 | `timedatectl set-timezone Asia/Shanghai`；确认 `TZ=Asia/Shanghai` |
| 上传 413 | 文件超过 Nginx `client_max_body_size` | 保持单文件 ≤20MB；不要随意放大限制 |

---

## 11. 安全清单

- [ ] `.env` 权限 600，未提交到 Git；`.dockerignore` 已排除 `.env`。
- [ ] `MYSQL_*`、`JWT_SECRET` 均为随机强密码，未复用。
- [ ] 轻量防火墙只放行 22 + 应用端口；3306/3000 不对外。
- [ ] SSH 使用密钥；禁用密码登录（`PasswordAuthentication no`）；22 尽量限制来源 IP。
- [ ] 首次登录后修改 `admin` 密码；删除/禁用演示账号。
- [ ] 正式环境使用 HTTPS；`PUBLIC_ORIGIN=https://...`；Nginx 上 80 → 443。
- [ ] 备份拷出服务器并验证可恢复；备份文件加密/限权。
- [ ] 阿里云快照 + CloudMonitor 磁盘/内存告警。
- [ ] 提现功能按 PRD 默认关闭，确认汇率/现金规则后再开启。
- [ ] 当前 api 镜像未切非 root（Dockerfile 注释与实现不一致）；正式上线前建议加 `USER node` 并调整 `/data/uploads` 权限。

---

## 12. 正式上线：备案、域名、HTTPS

### 12.1 大陆地域

1. 购买 ≥3 个月的轻量/ECS（试用实例不能备案）。
2. 域名完成实名认证；在阿里云 ICP 代备案系统提交，通常 1–3 周。
3. 备案通过前不要用域名绑定 80/443；试用阶段继续用 `IP:8080`。
4. 备案通过后：
   - DNS A 记录指向公网 IP；
   - 轻量防火墙放行 80/443；
   - Nginx `server_name` 改为域名；
   - 申请阿里云免费证书或 Let's Encrypt，配置 443；
   - 80 重定向到 443；
   - `.env` 改 `PUBLIC_ORIGIN=https://域名`，执行 `docker compose -f deploy/docker-compose.yml up -d --force-recreate api`。
5. 验证 Cookie 带 `Secure`，`/healthz` 正常。

### 12.2 不想备案

- 选香港/海外地域（无需备案，但延迟更高，且一般没有免费试用）；
- 或按 PRD 原方案部署到校方内网服务器 + 校内域名 + 校内 CA。

> 不要用非标端口/海外 CDN 等方式绕过备案；大陆地域未备案域名会被拦截，且有合规风险。

---

## 13. 试用到期 / 迁移

到期前：

1. 导出数据库 + uploads 到本地/OSS（§9.2）；
2. 记录 `.env`（密码可重新生成，但数据库密码要对应）；
3. 决定续费/转正式实例/迁校方服务器；
4. 确认试用实例是否自动释放，避免残留计费。

迁移到新机器：

1. 新机器按 §2–§5 装好 Docker、代码、`.env`；
2. 先 `up -d` 让 MySQL 初始化，再恢复数据库 + uploads（§9.3/§9.4）；
3. 重新 `seed.cjs`（幂等，可跳过已有数据）；
4. 改 DNS/公网 IP，更新 `PUBLIC_ORIGIN`；
5. 验证登录、附件、账本对账接口。

---

## 14. 命令速查

```bash
cd /opt/sasu-task-system

# 构建 / 启动 / 状态
docker compose -f deploy/docker-compose.yml build api
docker compose -f deploy/docker-compose.yml build web
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps

# 健康
curl -fsS http://127.0.0.1:8080/healthz

# 日志
docker compose -f deploy/docker-compose.yml logs -f --tail=100 api

# 初始化数据
docker compose -f deploy/docker-compose.yml exec api node prisma/seed.cjs

# 数据库 shell
docker compose -f deploy/docker-compose.yml exec mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

# 备份拷出
docker run --rm -v sasu-task-system_backup:/backup:ro \
  -v "$HOME/sasu-backups":/out alpine sh -c 'cp -a /backup/. /out/'

# 磁盘
docker system df
docker image prune -f
docker builder prune -f

# 停止（保留卷）
docker compose -f deploy/docker-compose.yml down
```
