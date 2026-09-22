import { fileURLToPath } from 'node:url';

const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  outputFileTracingIncludes: { '/*': ['../../docs/**/*.md'] },
  serverExternalPackages: ['openid-client', 'redis', 'marked', 'sanitize-html'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default config;
