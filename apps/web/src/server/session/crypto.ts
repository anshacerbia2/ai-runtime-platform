import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Tokens are sealed in the server store; the cookie contains only a random reference. */
export function sessionCrypto(secret: string, namespace: string) {
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid session encryption key.');
  }
  const mac = (id: string) =>
    createHmac('sha256', key)
      .update(namespace + ':' + id)
      .digest('base64url');
  return {
    reference() {
      const id = randomBytes(32).toString('base64url');
      return id + '.' + mac(id);
    },
    verify(reference: string): boolean {
      if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(reference)) {
        return false;
      }
      const [id, signature] = reference.split('.');
      return timingSafeEqual(Buffer.from(signature), Buffer.from(mac(id)));
    },
    seal(value: unknown): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(namespace));
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), data]
        .map((part) => part.toString('base64url'))
        .join('.');
    },
    open<T>(value: string): T {
      const parts = value
        .split('.')
        .map((part) => Buffer.from(part, 'base64url'));
      if (parts.length !== 3) {
        throw new Error('Invalid sealed session.');
      }
      const [iv, tag, data] = parts;
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(namespace));
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([decipher.update(data), decipher.final()]).toString(
          'utf8',
        ),
      ) as T;
    },
  };
}
