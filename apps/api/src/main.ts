import { createApplication } from './bootstrap.js';
import { loadConfig } from './infrastructure/config/local-config.js';

const config = loadConfig();
const application = await createApplication(config, true);
application.enableShutdownHooks();
await application.listen(config.apiPort, '127.0.0.1');
console.log(
  `M0 NestJS/Fastify API listening on http://127.0.0.1:${config.apiPort}`,
);
