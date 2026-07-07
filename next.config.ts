import type {NextConfig} from 'next';

// CSP TRADEOFF NOTE:
// `script-src 'unsafe-inline'` is required for Next.js inline scripts (hydration, route prefetch).
// If you add a third-party analytics or CDN script in future, add its origin to `script-src`
// (e.g. https://cdn.segment.com) AND consider replacing 'unsafe-inline' with a nonce-based
// approach using Next.js middleware to inject a per-request nonce — see:
// https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-eval' added for dashboard components (charting/animation libs require eval).
  // TODO: identify the specific dependency and replace with a nonce-based approach.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // ws://localhost:8765 / ws://127.0.0.1:8765 — local agent socket (core/ipc_bridge.py)
  // feeding the Trading Room chart; loopback-only, unreachable from deployed origins.
  // ipc: / http://ipc.localhost — Tauri v2 webview IPC (window controls, drag region);
  // inert outside the desktop shell.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com https://hooks.slack.com ws://localhost:8765 ws://127.0.0.1:8765 ipc: http://ipc.localhost",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  {key: 'Content-Security-Policy', value: cspDirectives},
  {key: 'X-Frame-Options', value: 'DENY'},
  {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
  {key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()'},
  {key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload'},
];

const nextConfig: NextConfig = {
  // NO `output: 'export'` — this app is full-stack Next (API routes under
  // src/app/api/*, auth middleware/proxy, cookie-based force-dynamic SSR,
  // server actions). A static export fails the build and would strip auth,
  // dispatch, and trading endpoints. The Tauri shell therefore points at the
  // SERVED app (see src-tauri/tauri.conf.json) instead of a ../out dist.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    // Webview shell renders images directly; skip the optimizer pipeline.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
