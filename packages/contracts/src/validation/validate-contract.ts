import {
  ChatRequest,
  GenerateRequest,
  ExecutionRequest,
} from '../schemas/requests.js';
import type { ProfileType } from '../schemas/profiles.js';
import { profiles } from '../fixtures/profiles.js';
import { CONTRACT_VERSION } from '../version.js';
import type { ContractKind, Issue, CheckResult } from './types.js';
import { schemaIssues } from './schema-policy.js';

export function validateContract(
  kind: ContractKind,
  payload: unknown,
  available: ProfileType[] = profiles,
): CheckResult {
  const schema =
    kind === 'chat'
      ? ChatRequest
      : kind === 'generate'
        ? GenerateRequest
        : ExecutionRequest;
  const parsed = schema.safeParse(payload);
  const base = {
    profile: null,
    capability: null,
    warnings: [],
    contract_version: CONTRACT_VERSION,
  };
  if (!parsed.success) {
    return {
      ...base,
      valid: false,
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        path: '/' + i.path.join('/'),
        code: i.code,
        message:
          i.code === 'unrecognized_keys'
            ? 'Field tambahan tidak diizinkan; identitas dan izin ditentukan server.'
            : i.message,
      })),
    };
  }
  const request = parsed.data;
  const capability =
    kind === 'chat'
      ? 'chat'
      : 'capability' in request
        ? request.capability
        : null;
  const profile = available.find((x) => x.profile === request.profile) ?? null;
  const issues: Issue[] = [];
  if (!profile) {
    issues.push({
      path: '/profile',
      code: 'PROFILE_NOT_FOUND',
      message: 'Profile tidak tersedia untuk aplikasi ini.',
    });
  }
  if (profile && profile.capability !== capability) {
    issues.push({
      path: '/capability',
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'Capability tidak cocok dengan profile.',
    });
  }
  if (request.session_ref) {
    issues.push({
      path: '/session_ref',
      code: 'UNSUPPORTED_CAPABILITY',
      message:
        'Session hanya diperiksa pada fase runtime; belum tersedia di M0.',
    });
  }
  if (request.context?.parent_execution_id) {
    issues.push({
      path: '/context/parent_execution_id',
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'Otorisasi parent execution belum tersedia di M0.',
    });
  }
  if (Object.keys(request.context?.labels ?? {}).length > 16) {
    issues.push({
      path: '/context/labels',
      code: 'LIMIT_EXCEEDED',
      message: 'Maksimal 16 labels.',
    });
  }
  if (profile) {
    if ('stream' in request && request.stream && !profile.streaming) {
      issues.push({
        path: '/stream',
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Profile ini tidak mengizinkan streaming.',
      });
    }
    for (const k of ['max_output_tokens', 'timeout_ms'] as const) {
      const n = request.constraints?.[k];
      if (n !== undefined && n > profile.limits[k]) {
        issues.push({
          path: '/constraints/' + k,
          code: 'POLICY_DENIED',
          message: 'Caller hanya boleh menurunkan batas profile.',
        });
      }
    }
  }
  if ('response_schema' in request.input) {
    issues.push(...schemaIssues(request.input.response_schema));
  }
  const warnings = [
    'CONTRACT_ONLY: tidak ada AI call, tool, budget reservation, atau execution yang dibuat.',
  ];
  if (
    ('artifact_refs' in request.input && request.input.artifact_refs?.length) ||
    ('messages' in request.input &&
      request.input.messages.some((m) =>
        m.content.some((c) => c.type === 'artifact'),
      ))
  ) {
    warnings.push(
      'Artifact reference hanya diperiksa bentuknya; existence/authorization membutuhkan service artifact pada fase berikutnya.',
    );
  }
  return {
    valid: issues.length === 0,
    issues,
    profile,
    capability,
    warnings,
    contract_version: CONTRACT_VERSION,
  };
}
