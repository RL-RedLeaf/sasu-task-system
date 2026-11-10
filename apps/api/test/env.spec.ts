import { EnvValidationError, loadEnv } from '../src/config/env';

const VALID = {
  DATABASE_URL: 'mysql://user:pass@localhost:3306/sasu',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv（启动期校验，PRD §11.5）', () => {
  it('缺少 DATABASE_URL 时直接失败', () => {
    expect(() => loadEnv({ JWT_SECRET: VALID.JWT_SECRET })).toThrow(EnvValidationError);
    try {
      loadEnv({ JWT_SECRET: VALID.JWT_SECRET });
    } catch (error) {
      expect((error as EnvValidationError).problems).toEqual(['缺少 DATABASE_URL']);
    }
  });

  it('缺少 JWT_SECRET 时直接失败', () => {
    expect(() => loadEnv({ DATABASE_URL: VALID.DATABASE_URL })).toThrow(EnvValidationError);
  });

  it('JWT_SECRET 不足 32 字节时失败', () => {
    expect(() => loadEnv({ ...VALID, JWT_SECRET: 'short-secret' })).toThrow(EnvValidationError);
  });

  it('合法配置返回带默认值的 Env', () => {
    const env = loadEnv({ ...VALID });
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_DAYS).toBe(7);
    expect(env.UPLOAD_DIR).toBe('/data/uploads');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
  });

  it('PORT/SESSION_DAYS 覆盖默认值，非整数报错', () => {
    expect(loadEnv({ ...VALID, PORT: '8080' }).PORT).toBe(8080);
    expect(() => loadEnv({ ...VALID, PORT: 'not-a-number' })).toThrow(EnvValidationError);
  });
});
