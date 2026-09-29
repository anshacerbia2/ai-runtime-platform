import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../dist/bootstrap.js';
import type { RuntimeConfig } from '../../src/infrastructure/config/environment-config.js';

interface StartMessage {
  type: 'start';
  config: RuntimeConfig;
}

interface CloseMessage {
  type: 'close';
}

let application: NestFastifyApplication | undefined;
let starting = false;

function send(message: Record<string, unknown>) {
  if (process.connected) {
    process.send?.(message);
  }
}

async function close() {
  await application?.close();
  application = undefined;
  process.disconnect();
}

process.on('message', (raw: StartMessage | CloseMessage) => {
  if (raw.type === 'close') {
    void close().catch(() => {
      process.exitCode = 1;
      process.disconnect();
    });
    return;
  }
  if (starting || application) {
    send({ type: 'error', message: 'Gateway instance already started.' });
    return;
  }
  starting = true;
  void (async () => {
    application = await createApplication(raw.config);
    await application.listen(0, '127.0.0.1');
    send({ type: 'ready', url: await application.getUrl() });
  })().catch((error: unknown) => {
    send({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Unknown startup error.',
    });
    process.exitCode = 1;
    process.disconnect();
  });
});
