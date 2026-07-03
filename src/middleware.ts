import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

// Auth gate for the control room. Every API route executes service-role
// Supabase writes (and /api/hermes/command spends Anthropic tokens), so
// nothing is reachable without a valid session cookie.
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login']);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  const isApi = pathname.startsWith('/api/');

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
