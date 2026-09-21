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
import type { LocalConfig } from './infrastructure/config/local-config.js';

export async function createApplication(config: LocalConfig, logging = false) {
  const adapter = new FastifyAdapter({
    bodyLimit: 65536,
    requestTimeout: 15000,
    genReqId: () => randomUUID(),
    logger: logging
      ? {
          level: 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie'],
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
