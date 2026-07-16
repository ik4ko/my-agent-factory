import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import {
  getTradingAutonomyStatus,
  prepareAutonomousTradePulse,
  runAutonomousTradePulse,
} from '@/lib/trading/autonomy';

const PulseSchema = z.object({
  action: z.literal('pulse'),
  reason: z.string().trim().min(1).max(500).optional().default('manual Trading Room pulse'),
});

export async function GET() {
  try {
    return NextResponse.json(await getTradingAutonomyStatus());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'trading autonomy status unavailable' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const parsed = PulseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'expected { action: "pulse", reason? }' }, { status: 400 });
  }

  try {
    const pulse = await prepareAutonomousTradePulse(parsed.data.reason);
    if (pulse.accepted) {
      after(async () => {
        await runAutonomousTradePulse(pulse.loops, parsed.data.reason);
      });
    }
    return NextResponse.json({ accepted: pulse.accepted, reply: pulse.reply, loops: pulse.loops });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'trading autonomy pulse failed' },
      { status: 500 },
    );
  }
}
