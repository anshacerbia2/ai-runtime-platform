import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnvironment } from '../../config/environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = loadEnvironment();
const application = config.applications[0];

export default defineConfig({
  root: resolve(root, 'apps/web'),
  plugins: [react()],
  server: {
    host: config.webHost,
    port: config.webPort,
    strictPort: true,
    allowedHosts: [...config.allowedHosts],
    cors: false,
    fs: {
      strict: true,
      deny: ['**/.local/**', '**/.env*', '**/*.pem', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: `http://${config.apiHost}:${config.apiPort}`,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (out) => {
            out.setHeader('Authorization', `Bearer ${application!.token}`);
          });
        },
      },
    },
  },
});
