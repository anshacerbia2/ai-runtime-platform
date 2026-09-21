import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { AuthenticateApplication } from './application/authenticate-application.js';
import {
  CREDENTIAL_VERIFIER,
  type CredentialVerifier,
} from './application/credential-verifier.port.js';
import { PrismaCredentialVerifier } from './infrastructure/prisma-credential-verifier.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: CREDENTIAL_VERIFIER,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new PrismaCredentialVerifier(database),
    },
    {
      provide: AuthenticateApplication,
      inject: [CREDENTIAL_VERIFIER],
      useFactory: (credentials: CredentialVerifier) =>
        new AuthenticateApplication(credentials),
    },
  ],
  exports: [AuthenticateApplication],
})
export class IdentityModule {}
