import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

/**
 * Medicare data is PHI-adjacent and must stay on the operator-session lane.
 * This intentionally rejects the global MACHINE_API_TOKEN lane, which is
 * broader than the Medicare CRM's authorization boundary.
 */
export async function requireMedicareOperator(request: NextRequest): Promise<NextResponse | null> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return process.env.NODE_ENV === 'development'
      ? null
      : NextResponse.json({ error: 'DASHBOARD_PASSWORD not configured' }, { status: 503 });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, password)) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
