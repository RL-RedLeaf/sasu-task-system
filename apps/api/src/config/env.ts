/**
 * 启动期环境变量校验（PRD §11.5 / §12.1）：
 * 缺失 JWT_SECRET 或 DATABASE_URL 时启动失败而非降级运行；JWT_SECRET 至少 32 字节。
 */

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  SESSION_DAYS: number;
  UPLOAD_DIR: string;
  PUBLIC_ORIGIN: string | null;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  BUILD_TIME: string | null;
}

export class EnvValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`环境变量校验失败: ${problems.join('; ')}`);
    this.name = 'EnvValidationError';
  }
}

function required(source: NodeJS.ProcessEnv, key: string, problems: string[]): string {
  const value = source[key]?.trim();
  if (!value) problems.push(`缺少 ${key}`);
  return value ?? '';
}

function int(source: NodeJS.ProcessEnv, key: string, fallback: number, problems: string[]): number {
  const raw = source[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    problems.push(`${key} 不是整数: ${raw}`);
    return fallback;
  }
  return parsed;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const problems: string[] = [];

  const databaseUrl = required(source, 'DATABASE_URL', problems);
  const jwtSecret = required(source, 'JWT_SECRET', problems);
  if (jwtSecret && jwtSecret.length < 32) {
    problems.push(`JWT_SECRET 长度不足 32 字节（当前 ${jwtSecret.length}）`);
  }

  const port = int(source, 'PORT', 3000, problems);
  const sessionDays = int(source, 'SESSION_DAYS', 7, problems);

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }

  const nodeEnv = source.NODE_ENV ?? 'development';
  const logLevel = source.LOG_LEVEL ?? 'info';

  return {
    NODE_ENV: (['development', 'test', 'production'] as const).includes(nodeEnv as Env['NODE_ENV'])
      ? (nodeEnv as Env['NODE_ENV'])
      : 'development',
    PORT: port,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    SESSION_DAYS: sessionDays,
    UPLOAD_DIR: source.UPLOAD_DIR?.trim() || '/data/uploads',
    PUBLIC_ORIGIN: source.PUBLIC_ORIGIN?.trim() || null,
    LOG_LEVEL: (['debug', 'info', 'warn', 'error'] as const).includes(logLevel as Env['LOG_LEVEL'])
      ? (logLevel as Env['LOG_LEVEL'])
      : 'info',
    BUILD_TIME: source.BUILD_TIME?.trim() || null,
  };
}
