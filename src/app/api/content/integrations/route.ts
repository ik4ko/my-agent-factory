import { NextResponse } from 'next/server';
import { contentIntegrationStatus, isPipelineFullyWired } from '@/lib/content/integrations';

/**
 * GET /api/content/integrations — per-stage readiness for the room's status
 * panel. Server-only because it reads process.env; the response carries env
 * var NAMES only, never values.
 */
export async function GET() {
  return NextResponse.json({
    stages: contentIntegrationStatus(),
    fullyWired: isPipelineFullyWired(),
  });
}
