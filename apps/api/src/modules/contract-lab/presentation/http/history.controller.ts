import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { CurrentApplication } from '../../../identity/presentation/http/current-application.decorator.js';
import type { ApplicationIdentity } from '../../../identity/domain/application-identity.js';
import { ReadHistoryUseCase } from '../../application/read-history.use-case.js';
import { presentValidation } from './validation.presenter.js';
import {
  encodeHistoryCursor,
  parseHistoryQuery,
  parseRecordId,
} from './history-query.js';

@Controller('api/m0/history')
export class HistoryController {
  constructor(
    @Inject(ReadHistoryUseCase) private readonly history: ReadHistoryUseCase,
  ) {}

  @Get()
  async list(
    @CurrentApplication() identity: ApplicationIdentity,
    @Query() query: unknown,
  ) {
    const { limit, afterId } = parseHistoryQuery(query);
    const page = await this.history.list(identity, limit, afterId);
    return {
      items: page.items.map(presentValidation),
      next_cursor: encodeHistoryCursor(page.nextId),
    };
  }

  @Get(':id')
  async get(
    @CurrentApplication() identity: ApplicationIdentity,
    @Param('id') id: string,
  ) {
    return presentValidation(
      await this.history.get(identity, parseRecordId(id)),
    );
  }
}
