import { Controller, Get, Res } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { HealthzResponse } from '@sasu/shared';
import { PrismaService } from '../common/prisma/prisma.service';

let cachedVersion: string | null = null;

function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // 运行时 __dirname = dist/src；apps/api/package.json 在其上一级
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      version?: string;
    };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/** GET /healthz（不在 /api/v1 前缀下）：{ ok, db, version, buildTime }，db=false 时 503（PRD §12.1） */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  async healthz(@Res() res: Response): Promise<void> {
    let db = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }

    const body: HealthzResponse = {
      ok: db,
      db,
      version: getAppVersion(),
      buildTime: process.env.BUILD_TIME ?? null,
    };
    res.status(db ? 200 : 503).json(body);
  }
}
