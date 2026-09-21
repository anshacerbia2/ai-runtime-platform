import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { AuthenticatePrincipal } from './application/authenticate-principal.js';
import {
  PRINCIPAL_VERIFIER,
  type PrincipalVerifier,
} from './application/principal-verifier.port.js';
import { LocalPrincipalVerifier } from './infrastructure/local-principal-verifier.js';
import { PrismaCredentialVerifier } from './infrastructure/prisma-credential-verifier.js';
import { OidcVerifier } from './infrastructure/oidc-verifier.js';
import { RUNTIME_CONFIG } from '../../infrastructure/config/runtime-config.module.js';
import type { RuntimeConfig } from '../../infrastructure/config/environment-config.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: PRINCIPAL_VERIFIER,
      inject: [DatabaseService, RUNTIME_CONFIG],
      useFactory: (database: DatabaseService, config: RuntimeConfig) =>
        config.oidc
          ? new OidcVerifier(config.oidc, {
              resolveClient: async (clientId) => {
                const app = await database.controlApplication.findUnique({
                  where: { keycloakClientId: clientId },
                });
                return app?.status === 'ENABLED' ? app.id : null;
              },
            })
          : new LocalPrincipalVerifier(
              new PrismaCredentialVerifier(database),
              config.localOperatorToken,
              config.localRunnerToken,
            ),
    },
    {
      provide: AuthenticatePrincipal,
      inject: [PRINCIPAL_VERIFIER],
      useFactory: (verifier: PrincipalVerifier) =>
        new AuthenticatePrincipal(verifier),
    },
  ],
  exports: [AuthenticatePrincipal],
})
export class IdentityModule {}
