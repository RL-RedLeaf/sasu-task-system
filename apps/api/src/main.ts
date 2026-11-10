import './load-env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvValidationError, loadEnv } from './config/env';

// 缺失关键配置时启动直接失败，而非降级运行（PRD §11.5 / §12.1）
let env: ReturnType<typeof loadEnv>;
try {
  env = loadEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(
      JSON.stringify(
        { level: 'fatal', msg: 'env validation failed', problems: error.problems },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  throw error;
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // 业务接口统一前缀 /api/v1；/healthz 保持在根路径供容器 HEALTHCHECK（PRD §10/§12.1）
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.log(`api listening on :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
