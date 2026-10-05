import type { FastifyReply } from 'fastify';
import { ApplicationError } from '../domain/application-error.js';

/** Take ownership of sensitive delivery bytes and erase both copies after send. */
export function sendBoundedBinary(
  reply: FastifyReply,
  bytes: Uint8Array,
  maxBytes: number,
): void {
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    bytes.fill(0);
    throw new ApplicationError(
      'DEPENDENCY_UNAVAILABLE',
      'Runner delivery is outside the supported byte bound.',
    );
  }
  let wire: Buffer;
  try {
    wire = Buffer.from(bytes);
  } finally {
    bytes.fill(0);
  }
  const erase = () => wire.fill(0);
  try {
    reply.raw.once('finish', erase);
    reply.raw.once('close', erase);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type('application/octet-stream');
    reply.send(wire);
  } catch (error) {
    erase();
    throw error;
  }
}
