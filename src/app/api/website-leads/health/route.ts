import { NextRequest, NextResponse } from 'next/server';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bridge health proxy.
 *
 * The outbox and notification audit tables live in the WEBSITE Supabase
 * project, which this application has no credentials for and should not have
 * credentials for. So this route does not query a database at all — it calls
 * the website's own operator endpoint server-to-server and passes the answer
 * through.
 *
 * ── Why a proxy rather than a direct browser fetch ────────────────────────
 * `WEBSITE_LEAD_HEALTH_TOKEN` is server-only. If the dashboard called the
 * website endpoint directly, that token would have to reach the browser,
 * where anyone could read it out of the bundle. The token stays here; the
 * browser talks only to this route, and this route is behind the same
 * operator-session gate as the rest of the Medicare room.
 *
 * Env:
 *   WEBSITE_LEAD_HEALTH_URL    the website's /api/internal/lead-health
 *   WEBSITE_LEAD_HEALTH_TOKEN  bearer secret, must equal the website's
 *                              LEAD_HEALTH_TOKEN
 */

const TIMEOUT_MS = 10_000;

function config() {
  const url = process.env.WEBSITE_LEAD_HEALTH_URL?.trim();
  const token = process.env.WEBSITE_LEAD_HEALTH_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/**
 * Absent credentials are "not configured", not an error. The room still
 * renders and says so, rather than showing the operator a red failure for
 * something that is merely unwired.
 */
const NOT_CONFIGURED = {
  configured: false as const,
  note: 'Bridge health is not configured. Set WEBSITE_LEAD_HEALTH_URL and WEBSITE_LEAD_HEALTH_TOKEN.',
};

async function callWebsite(init: RequestInit): Promise<Response> {
  const cfg = config();
  if (!cfg) throw new Error('not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(cfg.url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
      // Never follow a redirect: a protection gate answering with an HTML
      // login page must surface as a failure, not be parsed as data.
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  if (!config()) return NextResponse.json(NOT_CONFIGURED);

  try {
    const res = await callWebsite({ method: 'GET' });
    if (!res.ok) {
      return NextResponse.json(
        { configured: true, error: `Website health endpoint returned ${res.status}.` },
        { status: 502 },
      );
    }
    return NextResponse.json({ configured: true, ...(await res.json()) });
  } catch (error) {
    const reason = error instanceof Error && error.message === 'not_configured' ? 'not configured' : 'unreachable';
    return NextResponse.json(
      { configured: true, error: `Could not read bridge health (${reason}).` },
      { status: 502 },
    );
  }
}

/**
 * Operator-triggered retry of one stuck delivery.
 *
 * Forwarded to the website, which owns the outbox. Idempotent on that side:
 * the idempotency key is untouched, so a delivery that already landed returns
 * 409 from the CRM and is marked delivered rather than creating a second lead.
 * This route cannot create or modify a lead, a client, or a policy.
 */
export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  if (!config()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Expected { id }' }, { status: 400 });
  }

  try {
    const res = await callWebsite({
      method: 'POST',
      body: JSON.stringify({ action: 'retry', id: body.id }),
    });
    const payload = await res.json().catch(() => ({}));
    return NextResponse.json(payload, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'Retry could not reach the website.' }, { status: 502 });
  }
}
