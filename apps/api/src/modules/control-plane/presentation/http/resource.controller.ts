import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import {
  apiContract,
  type ServerInferRequest,
  type ServerInferResponseBody,
  type PageInput,
} from '@ai-runtime/contracts/http';
import { ManagementCommand } from '@ai-runtime/contracts';
import { ContractRoute } from '../../../../shared/presentation/contract-route.js';
import { CurrentPrincipal } from '../../../identity/presentation/http/current-principal.decorator.js';
import type { Principal } from '../../../identity/domain/principal.js';
import { ResourceService } from '../../application/resource.service.js';
@Controller()
export class ResourceController {
  constructor(private readonly service: ResourceService) {}
  @ContractRoute(apiContract.resources.overview)
  overview(@CurrentPrincipal() principal: Principal) {
    return this.service.overview(principal);
  }

  @ContractRoute(apiContract.resources.applications.list)
  listapplications(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'applications', query);
  }
  @ContractRoute(apiContract.resources.applications.replace)
  @HttpCode(200)
  async replaceapplications(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.applications.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<
      typeof apiContract.resources.applications.replace,
      200
    >
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'application', id }),
      key,
    );
    if (result.resource.kind !== 'application') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.connections.list)
  listconnections(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'connections', query);
  }
  @ContractRoute(apiContract.resources.connections.replace)
  @HttpCode(200)
  async replaceconnections(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.connections.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<
      typeof apiContract.resources.connections.replace,
      200
    >
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'connection', id }),
      key,
    );
    if (result.resource.kind !== 'connection') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.credentials.list)
  listcredentials(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'credentials', query);
  }
  @ContractRoute(apiContract.resources.credentials.replace)
  @HttpCode(200)
  async replacecredentials(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.credentials.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<
      typeof apiContract.resources.credentials.replace,
      200
    >
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'credential', id }),
      key,
    );
    if (result.resource.kind !== 'credential') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.bindings.list)
  listbindings(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'bindings', query);
  }
  @ContractRoute(apiContract.resources.bindings.replace)
  @HttpCode(200)
  async replacebindings(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.bindings.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.bindings.replace, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'binding', id }),
      key,
    );
    if (result.resource.kind !== 'binding') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.profiles.list)
  listprofiles(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'profiles', query);
  }
  @ContractRoute(apiContract.resources.profiles.publish)
  @HttpCode(200)
  async publishprofiles(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.profiles.publish
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.profiles.publish, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'profile', id, applicationId }),
      key,
    );
    if (result.resource.kind !== 'profile') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.aliases.list)
  listaliases(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'aliases', query);
  }
  @ContractRoute(apiContract.resources.aliases.replace)
  @HttpCode(200)
  async replacealiases(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.aliases.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.aliases.replace, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'alias', id, applicationId }),
      key,
    );
    if (result.resource.kind !== 'alias') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.budgets.list)
  listbudgets(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'budgets', query);
  }
  @ContractRoute(apiContract.resources.budgets.replace)
  @HttpCode(200)
  async replacebudgets(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.budgets.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.budgets.replace, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'budget', id }),
      key,
    );
    if (result.resource.kind !== 'budget') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.pools.list)
  listpools(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'pools', query);
  }
  @ContractRoute(apiContract.resources.pools.replace)
  @HttpCode(200)
  async replacepools(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.pools.replace
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.pools.replace, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'pool', id }),
      key,
    );
    if (result.resource.kind !== 'pool') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }

  @ContractRoute(apiContract.resources.runners.list)
  listrunners(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'runners', query);
  }
  @ContractRoute(apiContract.resources.runners.lifecycle)
  @HttpCode(200)
  async lifecyclerunners(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: ServerInferRequest<
      typeof apiContract.resources.runners.lifecycle
    >['body'],
  ): Promise<
    ServerInferResponseBody<typeof apiContract.resources.runners.lifecycle, 200>
  > {
    const result = await this.service.manage(
      principal,
      ManagementCommand.parse({ ...body, kind: 'runner', id }),
      key,
    );
    if (result.resource.kind !== 'runner') {
      throw new Error('Receipt resource does not match operation.');
    }
    return { ...result, resource: result.resource };
  }
  @ContractRoute(apiContract.resources.audit.list)
  listAudit(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'audit', query);
  }
  @ContractRoute(apiContract.resources.outbox.list)
  listOutbox(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageInput,
  ) {
    return this.service.list(principal, 'outbox', query);
  }
}
