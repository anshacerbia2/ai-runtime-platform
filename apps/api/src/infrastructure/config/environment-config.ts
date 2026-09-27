import { loadApiEnvironment } from '../../../../../config/environment.mjs';
import type { ApiEnvironment } from '../../../../../config/environment.mjs';

export type RuntimeConfig = ApiEnvironment;

export function loadConfig(): RuntimeConfig {
  return loadApiEnvironment();
}
