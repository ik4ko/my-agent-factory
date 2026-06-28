import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { ai } from '@/ai/genkit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/extension/ai-extract
// Body: { carrier: string, html: string, url: string }
// Authorization: Bearer <supabase_access_token>
//
// When CSS selectors fail to find roster data, the content script sends the
// raw page HTML here. Gemini extracts the member rows and returns them in
// the same shape as a direct DOM scrape.
export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.carrier || !body?.html) {
    return NextResponse.json({ error: 'Missing carrier or html' }, { status: 400 })
  }

  const { carrier, html, url = '' } = body as { carrier: string; html: string; url: string }

  const prompt = `You are extracting Medicare member data from a carrier portal page HTML.

Carrier: ${carrier}
URL: ${url}

HTML (truncated to first 50KB):
${html}

Extract every member/policy row you can find. Look for a table or list of active members/policies.
Common column names: Name, Member ID, Plan Type, Effective Date, Status, Date of Birth.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "rows": [
    {
      "full_name": "John Smith",
      "member_id": "H1234567",
      "plan_name": "Humana Gold Plus",
      "effective_date": "01/01/2026",
      "status": "Active"
    }
  ],
  "total_found": 5,
  "confidence": "high"
}

Confidence values: "high" (clear table found), "medium" (partial data), "low" (guessed), "none" (no data found).
If you cannot find member data: {"rows": [], "total_found": 0, "confidence": "none"}`

  try {
    const response = await ai.generate({ prompt })
    const text = response.text.trim()

    // Strip markdown code fences if model wrapped the JSON
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: { rows: unknown[]; total_found: number; confidence: string }
    try {
      parsed = JSON.parse(clean)
    } catch {
      console.error('[ai-extract] JSON parse failed. Raw output:', text.slice(0, 500))
      return NextResponse.json({ rows: [], total_found: 0, confidence: 'none', error: 'JSON parse failed' })
    }

    console.log(`[ai-extract] ${carrier} — ${parsed.rows?.length ?? 0} rows (confidence: ${parsed.confidence})`)
    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('[ai-extract] Gemini error:', err?.message)
    return NextResponse.json({ rows: [], total_found: 0, confidence: 'none', error: 'AI extraction failed' }, { status: 500 })
  }
}

async function getUserFromBearer(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}
