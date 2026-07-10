import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, timingSafeEqualStr } from '@/lib/auth/session';

// Auth gate for the control room. Every API route executes service-role
// Supabase writes (and /api/hermes/command spends Anthropic tokens), so
// nothing is reachable without a valid session cookie.
// /api/orchestrator/cron self-authorizes via CRON_SECRET (Vercel Cron can't
// send the session cookie), so it's exempt from the cookie gate here.
// /api/phone/sms self-authorizes via Twilio's request signature + the
// OPERATOR_PHONE allowlist (Twilio can't send the session cookie either).
// /api/phone/voice is the same story for whichever voice provider is
// configured — it 501s until VAPI_API_KEY/RETELL_API_KEY is set.
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/orchestrator/cron', '/api/loops/tick', '/api/phone/sms', '/api/phone/voice']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  const isApi = pathname.startsWith('/api/');

  // Machine-token lane (CRON_SECRET-style) for the event-loop host: API
  // routes only — never the HTML dashboard — via `Authorization: Bearer
  // MACHINE_API_TOKEN`. Fails closed when the env is unset; timing-safe
  // compare. Privileged actions behind these routes keep their own gates
  // (operator PIN, rate limits) — this token only replaces the session
  // cookie a headless caller cannot hold.
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
