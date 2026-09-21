import { z } from 'zod';
import { Profile, type ProfileType } from '../schemas/profiles.js';

export type ContractKind = 'chat' | 'generate' | 'execution';

export const ValidationInput = z.strictObject({
  kind: z.enum(['chat', 'generate', 'execution']),
  payload: z.record(z.string(), z.unknown()),
});

export type Issue = { path: string; code: string; message: string };

export type CheckResult = {
  valid: boolean;
  issues: Issue[];
  profile: ProfileType | null;
  capability: string | null;
  warnings: string[];
  contract_version: string;
};

export const CheckReport = z.strictObject({
  valid: z.boolean(),
  issues: z.array(
    z.strictObject({ path: z.string(), code: z.string(), message: z.string() }),
  ),
  profile: Profile.nullable(),
  capability: z.string().nullable(),
  warnings: z.array(z.string()),
  contract_version: z.string(),
});
