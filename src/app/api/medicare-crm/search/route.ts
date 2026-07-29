import { NextRequest, NextResponse } from 'next/server';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, isMissingTable, maskMbiValue } from '@/lib/medicare-crm/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Global operator search across the book of business and the lead inbox.
 *
 * Authorization is the same operator-session gate as the rest of the room —
 * there is no public, anon, or machine-token path to this data. A search
 * endpoint is the highest-value target in a CRM, so this one deliberately:
 *
 *   • requires a session on every request
 *   • selects explicit columns, never `*`
 *   • returns MBIs masked, always
 *   • refuses to substring-match an MBI (see MBI handling below)
 *   • caps results, so it cannot be used to walk the whole table
 */

/** Minimum query length. One character would return the entire book. */
const MIN_QUERY = 2;
const RESULT_LIMIT = 25;

/**
 * PostgREST's `or()` takes a filter *expression*, so raw user input would let a
 * search term inject additional filter clauses. Commas separate conditions,
 * parentheses group them, and dots separate column/operator/value — all three
 * are stripped, along with the wildcards that would turn a search into a full
 * scan.
 *
 * Stripping rather than escaping is the right trade here: none of these
 * characters appear in a name, phone number, or email that anyone would
 * usefully search for.
 */
function sanitizeForFilter(value: string): string {
  return value.replace(/[,().*\\%"']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Digits only — lets "(555) 123-4567" match a stored "5551234567". */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** CMS MBI: 11 characters, no letters S, L, O, I, B, Z. */
const MBI_RE = /^[1-9][ACDEFGHJKMNPQRTUVWXY][ACDEFGHJKMNPQRTUVWXY0-9]\d[ACDEFGHJKMNPQRTUVWXY][ACDEFGHJKMNPQRTUVWXY0-9]\d[ACDEFGHJKMNPQRTUVWXY]{2}\d{2}$/i;

export type SearchHit = {
  type: 'client' | 'lead';
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  href: string;
};

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const raw = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (raw.length < MIN_QUERY) {
    return NextResponse.json({ hits: [], query: raw, note: `Enter at least ${MIN_QUERY} characters.` });
  }
  // Bound the input before it reaches any query planner.
  const query = raw.slice(0, 120);
  const safe = sanitizeForFilter(query);
  const digits = digitsOnly(query);

  try {
    const hits: SearchHit[] = [];

    // ── Exact-identifier lookups ────────────────────────────────────────────
    // A UUID is unambiguous, so it short-circuits: an operator pasting an id
    // wants that record, not everything whose name happens to contain the hex.
    if (UUID_RE.test(query)) {
      const [byClientId, byLeadId, bySubmissionId] = await Promise.all([
        db().from('ag_clients').select('id, first_name, last_name, city, state').eq('id', query).maybeSingle(),
        db().from('ag_website_leads').select('id, first_name, last_name, status, submitted_at').eq('id', query).maybeSingle(),
        db()
          .from('ag_website_leads')
          .select('id, first_name, last_name, status, submitted_at')
          .eq('website_submission_id', query)
          .maybeSingle(),
      ]);

      if (byClientId.data) hits.push(clientHit(byClientId.data));
      for (const lead of [byLeadId.data, bySubmissionId.data]) {
        if (lead && !hits.some((h) => h.type === 'lead' && h.id === lead.id)) hits.push(leadHit(lead));
      }
      return NextResponse.json({ hits, query, matchedOn: 'identifier' });
    }

    // An MBI is matched only on an exact, fully-formed value. Substring search
    // would turn this endpoint into an oracle for confirming partial MBIs,
    // which is a disclosure risk that a convenience feature does not justify.
    if (MBI_RE.test(query.replace(/[\s-]/g, ''))) {
      const compact = query.replace(/[\s-]/g, '').toUpperCase();
      const { data } = await db()
        .from('ag_clients')
        .select('id, first_name, last_name, city, state, medicare_beneficiary_identifier')
        .eq('medicare_beneficiary_identifier', compact)
        .limit(1);

      for (const client of data ?? []) hits.push(clientHit(client));
      return NextResponse.json({ hits, query: '<mbi redacted>', matchedOn: 'member_id' });
    }

    // ── Free-text lookups ───────────────────────────────────────────────────
    if (safe.length < MIN_QUERY && digits.length < 4) {
      return NextResponse.json({ hits: [], query, note: 'No searchable characters in that query.' });
    }

    const clientFilters = [
      safe.length >= MIN_QUERY && `first_name.ilike.%${safe}%`,
      safe.length >= MIN_QUERY && `last_name.ilike.%${safe}%`,
      safe.length >= MIN_QUERY && `email.ilike.%${safe}%`,
      digits.length >= 4 && `phone.ilike.%${digits}%`,
    ].filter(Boolean) as string[];

    const leadFilters = [
      safe.length >= MIN_QUERY && `first_name.ilike.%${safe}%`,
      safe.length >= MIN_QUERY && `last_name.ilike.%${safe}%`,
      safe.length >= MIN_QUERY && `email.ilike.%${safe}%`,
      digits.length >= 4 && `phone.ilike.%${digits}%`,
    ].filter(Boolean) as string[];

    const [clients, leads] = await Promise.all([
      db()
        .from('ag_clients')
        .select('id, first_name, last_name, city, state')
        .or(clientFilters.join(','))
        .order('last_name', { ascending: true })
        .limit(RESULT_LIMIT),
      db()
        .from('ag_website_leads')
        .select('id, first_name, last_name, status, submitted_at')
        .or(leadFilters.join(','))
        .order('submitted_at', { ascending: false })
        .limit(RESULT_LIMIT),
    ]);

    for (const result of [clients, leads]) {
      if (result.error && !isMissingTable(result.error)) {
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
      }
    }

    for (const client of clients.data ?? []) hits.push(clientHit(client));
    for (const lead of leads.data ?? []) hits.push(leadHit(lead));

    return NextResponse.json({ hits: hits.slice(0, RESULT_LIMIT * 2), query, matchedOn: 'text' });
  } catch {
    // The query itself is never echoed into an error: it may be an MBI.
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

function clientHit(client: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  city?: string | null;
  state?: string | null;
  medicare_beneficiary_identifier?: string | null;
}): SearchHit {
  const location = [client.city, client.state].filter(Boolean).join(', ');
  return {
    type: 'client',
    id: client.id,
    title: `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || 'Unnamed client',
    subtitle: 'Client',
    // Masked even here. A search result list is exactly the surface where an
    // unmasked identifier would leak into a screenshot or a shoulder-surf.
    detail: [location, maskMbiValue(client.medicare_beneficiary_identifier)].filter(Boolean).join(' · '),
    href: `/dashboard/rooms/medicare/clients/${client.id}`,
  };
}

function leadHit(lead: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  submitted_at: string;
}): SearchHit {
  return {
    type: 'lead',
    id: lead.id,
    title: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unnamed lead',
    subtitle: 'Website lead',
    detail: `${lead.status} · ${new Date(lead.submitted_at).toISOString().slice(0, 10)}`,
    href: `/dashboard/rooms/medicare/leads#${lead.id}`,
  };
}
