import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let config: { apiPort: number; webPort: number; applications: { token: string }[] } | undefined;
try { config = JSON.parse(readFileSync(resolve(root, '.local/config.json'), 'utf8')); }
catch { /* Static builds do not need development credentials. */ }
export default defineConfig({
  root: resolve(root, 'apps/web'),
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: config?.webPort ?? 4310, strictPort: true,
    allowedHosts: ['localhost', '127.0.0.1'], cors: false,
    fs: { strict: true, deny: ['**/.local/**', '**/.env*', '**/*.pem', '**/.git/**'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${config?.apiPort ?? 4311}`, changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (out) => {
            if (config?.applications[0]) out.setHeader('Authorization', 'Bearer ' + config.applications[0].token);
          });
        },
      },
    },
  },
});
