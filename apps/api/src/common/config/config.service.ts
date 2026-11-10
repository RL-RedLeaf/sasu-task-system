import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigValueType } from '@sasu/shared';

type Parsed =
  | { type: 'INT'; value: number }
  | { type: 'DECIMAL'; value: number }
  | { type: 'JSON'; value: unknown }
  | { type: 'STRING'; value: string }
  | { type: 'ENUM'; value: string };

/**
 * system_configs 读取缓存（30s TTL，管理端修改即失效）。
 * 默认值与 docs/parameter-decisions.md §8 对齐。
 */
@Injectable()
export class ConfigService implements OnModuleDestroy {
  private cache = new Map<string, Parsed>();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly ttlMs = 30_000;
  private readonly logger = new Logger(ConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<Parsed | undefined> {
    await this.ensureLoaded();
    return this.cache.get(key);
  }

  async getInt(key: string, fallback: number): Promise<number> {
    const v = await this.get(key);
    return v?.type === 'INT' ? v.value : fallback;
  }

  async getDecimal(key: string, fallback: number): Promise<number> {
    const v = await this.get(key);
    return v?.type === 'DECIMAL' ? v.value : fallback;
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const v = await this.get(key);
    return (v?.type === 'JSON' ? (v.value as T) : fallback) ?? fallback;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const v = await this.get(key);
    if (!v) return fallback;
    return v.type === 'JSON' ? JSON.stringify(v.value) : String(v.value);
  }

  invalidate(): void {
    this.loadedAt = 0;
  }

  private async ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < this.ttlMs && this.cache.size > 0) return;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.prisma.systemConfig.findMany();
      const next = new Map<string, Parsed>();
      for (const row of rows) {
        next.set(row.key, parseConfig(row.valueType as ConfigValueType, row.value));
      }
      this.cache = next;
      this.loadedAt = Date.now();
    } catch (error) {
      this.logger.error(`system_configs load failed: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.cache.clear();
  }
}

function parseConfig(type: ConfigValueType, raw: string): Parsed {
  switch (type) {
    case 'INT':
      return { type: 'INT', value: Number.parseInt(raw, 10) || 0 };
    case 'DECIMAL':
      return { type: 'DECIMAL', value: Number.parseFloat(raw) || 0 };
    case 'JSON':
      try {
        return { type: 'JSON', value: JSON.parse(raw) };
      } catch {
        return { type: 'JSON', value: null };
      }
    default:
      return { type: 'STRING', value: raw };
  }
}
