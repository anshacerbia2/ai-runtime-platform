import { Module } from '@nestjs/common';
import { CoreHealthController } from './presentation/http/core-health.controller.js';

@Module({
  controllers: [CoreHealthController],
})
export class CoreHealthModule {}
