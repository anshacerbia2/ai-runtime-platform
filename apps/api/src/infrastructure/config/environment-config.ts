import { loadEnvironment } from '../../../../../config/environment.mjs';
import type { RuntimeEnvironment } from '../../../../../config/environment.mjs';

export type RuntimeConfig = RuntimeEnvironment;

export function loadConfig(): RuntimeConfig {
  return loadEnvironment();
}
