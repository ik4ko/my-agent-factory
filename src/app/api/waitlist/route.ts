import { NextRequest, NextResponse } from "next/server"

import { getSupabaseAdmin } from "@/lib/supabase"

export const dynamic = "force-dynamic"

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = cleanString(body.name)
    const email = cleanString(body.email).toLowerCase()
    const agencyName = cleanString(body.agency_name)

    if (!name || !email || !agencyName) {
      return NextResponse.json({ error: "Name, email, and agency are required." }, { status: 400 })
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
    }

    const { data, error } = await getSupabaseAdmin()
      .from("waitlist")
      .upsert(
        {
          name,
          email,
          agency_name: agencyName,
        },
        { onConflict: "email" }
      )
      .select("id")
      .single()

    if (error) {
      console.error("[waitlist] insert error:", error.message)
      return NextResponse.json({ error: "Unable to join the waitlist." }, { status: 500 })
    }

    return NextResponse.json({ id: data.id }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[waitlist] unexpected error:", message)
    return NextResponse.json({ error: "Unable to join the waitlist." }, { status: 500 })
  }
}
