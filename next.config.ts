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
  // api.fontshare.com serves the General Sans @font-face stylesheet (display/body face).
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws://localhost:8765 https://*.supabase.co wss://*.supabase.co https://api.resend.com https://hooks.slack.com",
  // cdn.fontshare.com serves the General Sans woff2 files referenced by that stylesheet.
  "font-src 'self' https://cdn.fontshare.com",
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
  // Allow an isolated build dir (e.g. a parallel preview server) via env, so
  // two `next dev` instances don't corrupt each other's `.next`. Defaults to
  // the standard `.next` for normal dev/build/CI.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
