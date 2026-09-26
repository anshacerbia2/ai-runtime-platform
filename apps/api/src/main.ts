import { createApplication } from './bootstrap.js';
import { loadConfig } from './infrastructure/config/environment-config.js';

const config = loadConfig();
const application = await createApplication(config, true);

application.enableShutdownHooks();

await application.listen(config.apiPort, config.apiHost);

console.log(
  `AI Runtime Platform API (M0-M2 local complete) listening on http://${config.apiHost}:${config.apiPort}`,
);
