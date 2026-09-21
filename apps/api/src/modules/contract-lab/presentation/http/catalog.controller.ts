import { Controller, Get, Inject } from '@nestjs/common';
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

@Controller('api/m0')
export class CatalogController {
  constructor(
    @Inject(PROFILE_READER) private readonly profiles: ProfileReader,
    @Inject(CONTRACT_DOCUMENT)
    private readonly contractDocument: ContractDocument,
  ) {}

  @Get('profiles')
  async listProfiles(@CurrentApplication() identity: ApplicationIdentity) {
    return { items: await this.profiles.listOwned(identity.applicationId) };
  }

  @Get('examples')
  examples() {
    return { items: examples };
  }

  @Get('contracts')
  contracts() {
    return { version: CONTRACT_VERSION, schemas: schemaBundle };
  }

  @Get('openapi.json')
  openapi() {
    return this.contractDocument;
  }
}
