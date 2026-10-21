import type { NextConfig } from 'next';
const origin = process.env.API_PROXY_URL ?? 'http://127.0.0.1:4000';
const target = new URL(origin);
if (target.origin !== origin || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)))) throw new Error('INVALID_API_PROXY_URL');
const config: NextConfig = {
  distDir: process.env.WEB_DIST_DIR === '.next-e2e' ? '.next-e2e' : '.next',
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: ['@agentfit/contracts'],
  async rewrites() { return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }]; },
  async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] }]; },
};
export default config;
