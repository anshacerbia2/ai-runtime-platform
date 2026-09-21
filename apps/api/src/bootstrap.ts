import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './app.module.js';
import { registerLocalRequestPolicy } from './infrastructure/http/local-request-policy.js';
import type { RuntimeConfig } from './infrastructure/config/environment-config.js';

export async function createApplication(
  config: RuntimeConfig,
  logging = false,
) {
  const adapter = new FastifyAdapter({
    bodyLimit: config.apiBodyLimitBytes,
    requestTimeout: config.apiRequestTimeoutMs,
    genReqId: () => randomUUID(),
    logger: logging
      ? {
          level: 'info',
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-ati-one-proxy',
          ],
        }
      : false,
  });
  registerLocalRequestPolicy(adapter.getInstance() as FastifyInstance, config);
  const application = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    adapter,
    { logger: logging ? ['error', 'warn', 'log'] : false, abortOnError: false },
  );
  try {
    await application.init();
    await adapter.getInstance().ready();
    return application;
  } catch (error) {
    await application.close();
    throw error;
  }
}
