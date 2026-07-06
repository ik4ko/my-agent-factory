import { NextResponse } from 'next/server';
import { runPreflight } from '@/lib/golive/preflight';

export async function GET() {
  const result = await runPreflight();
  return NextResponse.json(result);
}
