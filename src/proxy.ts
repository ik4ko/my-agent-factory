import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, timingSafeEqualStr } from '@/lib/auth/session';

// Auth gate for the control room. Every API route executes service-role
// Supabase writes (and model routes can spend paid tokens), so nothing is
// reachable without a valid session cookie unless the route self-authorizes.
// /api/orchestrator/cron and /api/loops/tick self-authorize via CRON_SECRET.
// /api/website-leads/ingest self-authorizes via an HMAC signature over
// "${timestamp}.${rawBody}" using WEBSITE_LEAD_INGEST_SECRET, with a 300s
// replay window and constant-time comparison. It is write-only into
// ag_website_leads and cannot read ag_clients or any other CRM table, so
// exempting it does not widen the operator-session boundary that
// /api/medicare-crm deliberately enforces.
//
// NOTE: only the /ingest child is exempt. /api/website-leads itself is the
// operator-facing read/update route and stays behind the session gate.
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/orchestrator/cron',
  '/api/loops/tick',
  '/api/website-leads/ingest',
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  const isApi = pathname.startsWith('/api/');

  // Machine-token lane for headless API callers. This never grants HTML
  // dashboard access, and privileged routes keep their own domain gates
  // such as operator PINs, rate limits, and route-local shared secrets.
  if (isApi) {
    const machineToken = process.env.MACHINE_API_TOKEN?.trim();
    const auth = req.headers.get('authorization') ?? '';
    if (machineToken && auth.startsWith('Bearer ') && timingSafeEqualStr(auth.slice(7), machineToken)) {
      return NextResponse.next();
    }
  }

  if (!password) {
    // Fail open in local dev, fail closed everywhere else.
    if (process.env.NODE_ENV === 'development') return NextResponse.next();
    return isApi
      ? NextResponse.json({ error: 'DASHBOARD_PASSWORD not configured' }, { status: 503 })
      : new NextResponse('DASHBOARD_PASSWORD not configured', { status: 503 });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, password)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/api/:path*', '/login'],
};
