import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 配置：
 * - 不再自动加载 .env：这里手动加载一次（apps/api/.env 优先，其次仓库根 .env）。
 *   生产环境由 docker compose 直接注入环境变量，不走本文件。
 * - 连接串移到 datasource.url（schema 文件不再持有 url）。
 *   migrate / introspect 需要 url；generate 等命令不需要，缺省时跳过以免误伤。
 */
for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
