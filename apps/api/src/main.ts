import { createApplication } from './bootstrap.js';
import { loadConfig } from './infrastructure/config/environment-config.js';

const config = loadConfig();
const application = await createApplication(config, true);

application.enableShutdownHooks();

await application.listen(config.apiPort, config.apiHost);

console.log(
  `M0 NestJS/Fastify API listening on http://${config.apiHost}:${config.apiPort}`,
);
