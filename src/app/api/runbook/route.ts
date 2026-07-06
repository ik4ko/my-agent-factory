import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Serves RUNBOOK.md's raw text. It lives at the repo root, not under
// public/, so it was never reachable as a static asset (hence the 404 on
// /RUNBOOK.md) — this reads it live off disk so it can never drift out of
// sync with a duplicated copy.
export async function GET() {
  try {
    const text = await readFile(join(process.cwd(), 'RUNBOOK.md'), 'utf8');
    return new NextResponse(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  } catch (err) {
    return NextResponse.json({ error: `RUNBOOK.md not readable: ${String(err).slice(0, 160)}` }, { status: 500 });
  }
}
