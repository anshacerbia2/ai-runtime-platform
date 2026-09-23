import {
  apiContract,
  type ServerInferResponseBody,
} from '@ai-runtime/contracts/http';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { Controller, Inject } from '@nestjs/common';
import {
  CONTRACT_VERSION,
  examples,
  schemaBundle,
} from '@ai-runtime/contracts';
import { CurrentApplication } from '../../../identity/presentation/http/current-application.decorator.js';
import type { ApplicationIdentity } from '../../../identity/domain/application-identity.js';
import {
  PROFILE_READER,
  type ProfileReader,
} from '../../application/ports/contract-policy.port.js';
import {
  CONTRACT_DOCUMENT,
  type ContractDocument,
} from '../../application/ports/catalog-document.port.js';

@Controller()
export class CatalogController {
  constructor(
    @Inject(PROFILE_READER) private readonly profiles: ProfileReader,
    @Inject(CONTRACT_DOCUMENT)
    private readonly contractDocument: ContractDocument,
  ) {}

  @ContractRoute(apiContract.lab.profiles)
  async listProfiles(
    @CurrentApplication() identity: ApplicationIdentity,
  ): Promise<ServerInferResponseBody<typeof apiContract.lab.profiles, 200>> {
    return { items: await this.profiles.listOwned(identity.applicationId) };
  }

  @ContractRoute(apiContract.lab.examples)
  examples(): ServerInferResponseBody<typeof apiContract.lab.examples, 200> {
    return { items: examples };
  }

  @ContractRoute(apiContract.lab.schemas)
  contracts(): ServerInferResponseBody<typeof apiContract.lab.schemas, 200> {
    return { version: CONTRACT_VERSION, schemas: schemaBundle };
  }

  @ContractRoute(apiContract.lab.openapi)
  openapi(): ServerInferResponseBody<typeof apiContract.lab.openapi, 200> {
    return apiContract.lab.openapi.responses[200].parse(this.contractDocument);
  }
}
