import {
  apiContract,
  type ServerInferResponseBody,
  type ServerInferRequest,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { Controller, Inject, Param, Query } from '@nestjs/common';
import { CurrentApplication } from '../../../identity/presentation/http/current-application.decorator.js';
import type { ApplicationIdentity } from '../../../identity/domain/application-identity.js';
import { ReadHistoryUseCase } from '../../application/read-history.use-case.js';
import { presentValidation } from './validation.presenter.js';
import {
  encodeHistoryCursor,
  parseHistoryQuery,
  parseRecordId,
} from './history-query.js';

@Controller()
export class HistoryController {
  constructor(
    @Inject(ReadHistoryUseCase) private readonly history: ReadHistoryUseCase,
  ) {}

  @ContractRoute(apiContract.lab.history)
  async list(
    @CurrentApplication() identity: ApplicationIdentity,
    @Query() query: ServerInferRequest<typeof apiContract.lab.history>['query'],
  ): Promise<ServerInferResponseBody<typeof apiContract.lab.history, 200>> {
    const { limit, afterId } = parseHistoryQuery(query);
    const page = await this.history.list(identity, limit, afterId);
    return {
      items: page.items.map(presentValidation),
      next_cursor: encodeHistoryCursor(page.nextId),
    };
  }

  @ContractRoute(apiContract.lab.record)
  async get(
    @CurrentApplication() identity: ApplicationIdentity,
    @Param('id') id: string,
  ): Promise<ServerInferResponseBody<typeof apiContract.lab.record, 200>> {
    return presentValidation(
      await this.history.get(identity, parseRecordId(id)),
    );
  }
}
