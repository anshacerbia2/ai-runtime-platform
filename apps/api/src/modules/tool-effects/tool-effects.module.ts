import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { ToolOperationStatusService } from './application/tool-operation-status.service.js';
import {
  TOOL_OPERATION_STATUS_READER,
  type ToolOperationStatusReader,
} from './application/tool-operation-status.port.js';
import { PrismaToolOperationStatusReader } from './infrastructure/prisma-tool-operation-status.reader.js';
import { ToolOperationStatusController } from './presentation/http/tool-operation-status.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ToolOperationStatusController],
  providers: [
    {
      provide: TOOL_OPERATION_STATUS_READER,
      inject: [DatabaseService],
      useFactory: (db: DatabaseService) =>
        new PrismaToolOperationStatusReader(db),
    },
    {
      provide: ToolOperationStatusService,
      inject: [TOOL_OPERATION_STATUS_READER],
      useFactory: (reader: ToolOperationStatusReader) =>
        new ToolOperationStatusService(reader),
    },
  ],
})
export class ToolEffectsModule {}
