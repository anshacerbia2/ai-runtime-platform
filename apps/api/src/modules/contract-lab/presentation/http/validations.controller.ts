import {
  apiContract,
  type ServerInferResponseBody,
  type ServerInferRequest,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { Body, Controller, Headers, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ValidationInput } from '@ai-runtime/contracts';
import { ApplicationError } from '../../../../shared/domain/application-error.js';
import { CurrentApplication } from '../../../identity/presentation/http/current-application.decorator.js';
import type { ApplicationIdentity } from '../../../identity/domain/application-identity.js';
import { ValidateContractUseCase } from '../../application/validate-contract.use-case.js';
import { presentValidation } from './validation.presenter.js';

@Controller()
export class ValidationsController {
  constructor(
    @Inject(ValidateContractUseCase)
    private readonly validate: ValidateContractUseCase,
  ) {}

  @ContractRoute(apiContract.lab.validate)
  async create(
    @CurrentApplication() identity: ApplicationIdentity,
    @Body() body: ServerInferRequest<typeof apiContract.lab.validate>['body'],
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<
    ServerInferResponseBody<typeof apiContract.lab.validate, 200 | 201>
  > {
    const parsed = ValidationInput.safeParse(body);
    if (!parsed.success) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Use { kind: chat | generate | execution, payload: {...} }.',
      );
    }
    const result = await this.validate.execute({
      identity,
      ...parsed.data,
      idempotencyKey: typeof key === 'string' ? key : '',
    });
    response.code(result.replayed ? 200 : 201);
    return {
      ...presentValidation(result.record),
      replayed: result.replayed,
      mode: 'contract-only',
      execution_created: false,
    };
  }
}
