import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createSessionToken,
  timingSafeEqualStr,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '@/lib/auth/session';

const Schema = z.object({ password: z.string().min(1).max(256) });

// Minimal in-memory throttle: 5 failures per IP per minute.
const failures = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILURES = 5;

function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt < now) {
    failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (throttled(ip)) {
    return NextResponse.json({ error: 'Too many attempts — retry in a minute' }, { status: 429 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: 'DASHBOARD_PASSWORD not configured' }, { status: 503 });
  }

  if (!timingSafeEqualStr(parsed.data.password, password)) {
    recordFailure(ip);
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
