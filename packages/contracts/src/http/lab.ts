import { z } from 'zod';
import { Profile } from '../schemas/profiles.js';
import { CheckReport } from '../validation/types.js';

// Wire readers tolerate additions at every owned object boundary. Command schemas
// remain strict; stripping avoids passing uncontracted fields (including secrets).
export const ProfileView = Profile.strip().extend({
  limits: Profile.shape.limits.strip(),
});
export const CheckReportView = CheckReport.strip().extend({
  issues: z.array(CheckReport.shape.issues.element.strip()),
  profile: ProfileView.nullable(),
});

export const LabHealth = z.object({
  backend: z.literal('ready'),
  database: z.string().min(1),
  mode: z.literal('contract-only'),
  application_id: z.string().min(1),
  saved_checks: z.number().int().nonnegative(),
  provider_calls: z.literal(0),
  contract_version: z.string().min(1),
  framework: z.string(),
  persistence: z.string(),
});

export const LabExample = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: z.enum(['chat', 'generate', 'execution']),
  payload: z.record(z.string(), z.unknown()),
});

export const SavedValidation = z.object({
  id: z.uuid(),
  application_id: z.string().min(1),
  kind: z.enum(['chat', 'generate', 'execution']),
  valid: z.boolean(),
  report: CheckReportView,
  created_at: z.iso.datetime({ offset: true }),
  request_summary: z.unknown(),
  request_digest: z.string().min(1),
  contract_version: z.string().min(1),
});

export const ValidationResult = SavedValidation.extend({
  replayed: z.boolean(),
  mode: z.literal('contract-only'),
  execution_created: z.literal(false),
});

export const LabHistory = z.object({
  items: z.array(SavedValidation),
  next_cursor: z.string().nullable(),
});

export const LabProfiles = z.object({ items: z.array(ProfileView) });
export const LabExamples = z.object({ items: z.array(LabExample) });
export const LabSchemas = z.object({
  version: z.string(),
  schemas: z.record(z.string(), z.unknown()),
});

export const LabCatalogue = z.object({
  version: z.string(),
  profiles: z.array(ProfileView),
  examples: z.array(LabExample),
  schemas: z.record(z.string(), z.unknown()),
});

export const OpenApiDocument = z
  .object({
    openapi: z.string(),
    info: z.object({ title: z.string(), version: z.string() }).loose(),
    paths: z.record(z.string(), z.unknown()),
  })
  .loose();

export type LabHealth = z.infer<typeof LabHealth>;
export type Example = z.infer<typeof LabExample>;
export type SavedValidation = z.infer<typeof SavedValidation> &
  Partial<z.infer<typeof ValidationResult>>;
export type HistoryResponse = z.infer<typeof LabHistory>;
export type LabCatalogue = z.infer<typeof LabCatalogue>;
