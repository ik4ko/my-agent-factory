import { NextResponse } from 'next/server';
import { runSafetySelftest } from '@/lib/golive/selftest';

export async function POST() {
  const result = await runSafetySelftest();
  return NextResponse.json(result);
}
