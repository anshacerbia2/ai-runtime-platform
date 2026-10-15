import { createHash } from 'node:crypto';
import type { ToolEffectDigester } from '../application/tool-effect.port.js';

export class Sha256ToolEffectDigester implements ToolEffectDigester {
  digest(input: Uint8Array): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
