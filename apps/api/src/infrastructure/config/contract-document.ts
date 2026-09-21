import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../../../../config/environment.mjs';
import type { ContractDocument } from '../../modules/contract-lab/application/ports/catalog-document.port.js';

export function loadContractDocument(): ContractDocument {
  const path = resolve(projectRoot, 'contracts/m0.openapi.json');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid generated M0 OpenAPI document.');
  }
  return value as ContractDocument;
}
