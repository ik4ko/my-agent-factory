/**
 * Staged import: parsing, normalisation, and identity matching.
 *
 * Pure and I/O-free, so every rule here is testable against fixtures. The
 * route wires these to the database; nothing in this file can write anything.
 *
 * The CSV reader is hand-written rather than delegated to a library, and that
 * is a deliberate security decision: the previous import used `xlsx@0.18.5`,
 * which carries unpatched prototype-pollution (CVE-2023-30533) and ReDoS
 * (CVE-2024-22363) advisories, and it parsed in the BROWSER, which put member
 * PII into the page before anything had authorised it. RFC 4180 is small
 * enough to implement correctly, has no macro or formula surface, and runs
 * server-side behind the operator gate.
 */

// ── Limits ─────────────────────────────────────────────────────────────────
// Bounded before parsing, not after: an unbounded reader is a denial-of-service
// surface regardless of what the content turns out to be.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 60;
export const MAX_CELL_CHARS = 2_000;

export type ImportEntity = 'clients' | 'policies' | 'coverage';

export type ParseResult =
  | { ok: true; headers: string[]; rows: Record<string, string>[] }
  | { ok: false; error: string };

/**
 * RFC 4180 CSV, plus the quirks real exports actually contain: BOM, CRLF,
 * quoted fields containing commas and newlines, and doubled quotes as escape.
 */
export function parseCsv(text: string): ParseResult {
  // Excel writes a UTF-8 BOM. Left in place it becomes part of the first
  // header name, so "first_name" silently stops matching.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  if (input.trim().length === 0) return { ok: false, error: 'The file is empty.' };

  // A NUL byte means this is not text — most often a .xlsx renamed to .csv,
  // which would otherwise parse into one row of binary garbage.
  if (input.includes('\x00')) {
    return { ok: false, error: 'This does not look like a text CSV. If it is an Excel file, export it as CSV first.' };
  }

  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Consume CRLF as one terminator.
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      rows.push(record);
      record = [];
      if (rows.length > MAX_ROWS + 1) {
        return { ok: false, error: `The file has more than ${MAX_ROWS.toLocaleString()} rows.` };
      }
    } else {
      field += char;
    }
  }

  // Trailing record with no newline at end of file.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }

  if (inQuotes) {
    return { ok: false, error: 'A quoted value is never closed — the file is malformed.' };
  }

  const headerRow = rows.shift();
  if (!headerRow) return { ok: false, error: 'The file has no header row.' };

  const headers = headerRow.map((header) => header.trim());
  if (headers.length > MAX_COLUMNS) {
    return { ok: false, error: `The file has more than ${MAX_COLUMNS} columns.` };
  }
  if (headers.every((header) => header === '')) {
    return { ok: false, error: 'The header row is blank.' };
  }

  const dataRows = rows
    // Trailing newline produces a final record of one empty field.
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (!header) return;
        record[header] = (row[index] ?? '').slice(0, MAX_CELL_CHARS).trim();
      });
      return record;
    });

  if (dataRows.length === 0) return { ok: false, error: 'The file has a header but no data rows.' };
  if (dataRows.length > MAX_ROWS) {
    return { ok: false, error: `The file has more than ${MAX_ROWS.toLocaleString()} rows.` };
  }

  return { ok: true, headers, rows: dataRows };
}

// ── Field definitions ──────────────────────────────────────────────────────

export const IMPORT_FIELDS: Record<ImportEntity, readonly string[]> = {
  clients: ['first_name', 'last_name', 'phone', 'email', 'date_of_birth', 'physical_address', 'city', 'state', 'zip', 'medicare_beneficiary_identifier'],
  policies: ['first_name', 'last_name', 'plan_name', 'contract_pbp', 'plan_id', 'effective_date', 'monthly_premium', 'status'],
  coverage: ['first_name', 'last_name', 'medicare_beneficiary_identifier', 'contract_pbp', 'plan_name', 'carrier_name', 'effective_date', 'end_date'],
} as const;

export const REQUIRED_FIELDS: Record<ImportEntity, readonly string[]> = {
  clients: ['first_name', 'last_name'],
  policies: ['last_name', 'plan_name'],
  coverage: ['last_name', 'contract_pbp'],
} as const;

/** Header aliases carriers actually use, normalised to our field names. */
const HEADER_ALIASES: Record<string, string> = {
  firstname: 'first_name', first: 'first_name', givenname: 'first_name', membrfirstname: 'first_name',
  lastname: 'last_name', last: 'last_name', surname: 'last_name', familyname: 'last_name',
  dob: 'date_of_birth', birthdate: 'date_of_birth', dateofbirth: 'date_of_birth',
  mbi: 'medicare_beneficiary_identifier', medicareid: 'medicare_beneficiary_identifier',
  medicarenumber: 'medicare_beneficiary_identifier', beneficiaryid: 'medicare_beneficiary_identifier',
  phonenumber: 'phone', telephone: 'phone', mobile: 'phone', homephone: 'phone',
  emailaddress: 'email', zipcode: 'zip', postalcode: 'zip', st: 'state',
  address: 'physical_address', street: 'physical_address', address1: 'physical_address',
  plan: 'plan_name', plandescription: 'plan_name', planname: 'plan_name',
  contractpbp: 'contract_pbp', contractid: 'contract_pbp', contractnumber: 'contract_pbp',
  pbp: 'contract_pbp', planid: 'plan_id',
  effectivedate: 'effective_date', effective: 'effective_date', startdate: 'effective_date',
  enddate: 'end_date', termdate: 'end_date',
  premium: 'monthly_premium', monthlypremium: 'monthly_premium',
  carrier: 'carrier_name', carriername: 'carrier_name', plancarrier: 'carrier_name',
};

function canonical(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Best-guess header → field mapping. Always shown to the operator to confirm. */
export function suggestMapping(headers: string[], entity: ImportEntity): Record<string, string> {
  const fields = IMPORT_FIELDS[entity];
  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const target = canonical(field);
    const direct = headers.find((header) => canonical(header) === target);
    if (direct) {
      mapping[field] = direct;
      continue;
    }
    const aliased = headers.find((header) => HEADER_ALIASES[canonical(header)] === field);
    if (aliased) mapping[field] = aliased;
  }

  return mapping;
}

// ── Normalisation ──────────────────────────────────────────────────────────

/** Digits only, and only when the result is a plausible US number. */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * ISO date from the formats exports actually use.
 *
 * Ambiguous forms are rejected rather than guessed: "03/04/2026" is March 4th
 * in a US export and April 3rd in a European one, and silently picking wrong
 * puts a member in the wrong enrolment period.
 */
export function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // US-style M/D/YYYY. Two-digit years are refused — "26" could be 1926.
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (us) return validDate(Number(us[3]), Number(us[1]), Number(us[2]));

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeMoney(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/** CMS MBI: 11 chars, and the letters S L O I B Z never appear. */
const MBI_RE = /^[1-9][ACDEFGHJKMNPQRTUVWXY][ACDEFGHJKMNPQRTUVWXY0-9]\d[ACDEFGHJKMNPQRTUVWXY][ACDEFGHJKMNPQRTUVWXY0-9]\d[ACDEFGHJKMNPQRTUVWXY]{2}\d{2}$/;

export function normalizeMbi(value: string): string | null {
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return MBI_RE.test(compact) ? compact : null;
}

export function normalizeState(value: string): string | null {
  const compact = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(compact) ? compact : null;
}

export function normalizeZip(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits.length === 5 ? digits : null;
}

export type NormalizedRow = Record<string, string | number | null>;
export type RowIssue = { field: string; message: string };

/** Apply the mapping, normalise each value, and collect per-field problems. */
export function normalizeRow(
  raw: Record<string, string>,
  mapping: Record<string, string>,
  entity: ImportEntity,
): { normalized: NormalizedRow; issues: RowIssue[] } {
  const normalized: NormalizedRow = {};
  const issues: RowIssue[] = [];

  const read = (field: string): string => {
    const header = mapping[field];
    return header ? (raw[header] ?? '').trim() : '';
  };

  /* A value that is present but unparseable is an issue. A value that is
     absent is not — an export that simply omits a column is not an error,
     it just cannot contribute that field. */
  const put = (field: string, parse: (value: string) => string | number | null, label: string) => {
    const value = read(field);
    if (!value) {
      normalized[field] = null;
      return;
    }
    const parsed = parse(value);
    if (parsed === null) issues.push({ field, message: `${label} is not valid: "${value.slice(0, 40)}"` });
    normalized[field] = parsed;
  };

  normalized.first_name = normalizeName(read('first_name')) || null;
  normalized.last_name = normalizeName(read('last_name')) || null;

  for (const required of REQUIRED_FIELDS[entity]) {
    if (!normalized[required] && !read(required)) {
      issues.push({ field: required, message: `${required.replace(/_/g, ' ')} is required` });
    }
  }

  const fields = IMPORT_FIELDS[entity];
  if (fields.includes('phone')) put('phone', normalizePhone, 'Phone');
  if (fields.includes('email')) {
    put('email', (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null), 'Email');
  }
  if (fields.includes('date_of_birth')) put('date_of_birth', normalizeDate, 'Date of birth');
  if (fields.includes('effective_date')) put('effective_date', normalizeDate, 'Effective date');
  if (fields.includes('end_date')) put('end_date', normalizeDate, 'End date');
  if (fields.includes('monthly_premium')) put('monthly_premium', normalizeMoney, 'Monthly premium');
  if (fields.includes('medicare_beneficiary_identifier')) {
    put('medicare_beneficiary_identifier', normalizeMbi, 'MBI');
  }
  if (fields.includes('state')) put('state', normalizeState, 'State');
  if (fields.includes('zip')) put('zip', normalizeZip, 'ZIP');
  if (fields.includes('contract_pbp')) {
    put('contract_pbp', (value) => value.replace(/[-\s_]/g, '').toUpperCase() || null, 'Contract-PBP');
  }
  for (const passthrough of ['physical_address', 'city', 'plan_name', 'plan_id', 'carrier_name', 'status'] as const) {
    if (fields.includes(passthrough)) normalized[passthrough] = read(passthrough) || null;
  }

  return { normalized, issues };
}

// ── Identity matching ──────────────────────────────────────────────────────

export type ClientCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  medicare_beneficiary_identifier: string | null;
  phone: string | null;
  email: string | null;
};

export type MatchResult = {
  disposition: 'create' | 'match' | 'ambiguous';
  clientId: string | null;
  confidence: 'low' | 'medium' | 'high' | 'exact' | null;
  candidates: { id: string; reason: string }[];
};

/**
 * Decide which existing client a row refers to.
 *
 * The ordering is by how much a signal actually identifies a person. An MBI is
 * assigned to exactly one beneficiary, so it is exact. A name plus date of
 * birth is strong. A name alone is not evidence at all — there are many
 * people called John Smith — so it produces `ambiguous` for a human to settle
 * rather than a guess.
 *
 * Nothing here decides anything on its own: `match` still only proposes, and
 * `ambiguous` always routes to Eric.
 */
export function matchClient(row: NormalizedRow, candidates: ClientCandidate[]): MatchResult {
  const mbi = row.medicare_beneficiary_identifier as string | null;
  const firstName = (row.first_name as string | null)?.toLowerCase() ?? null;
  const lastName = (row.last_name as string | null)?.toLowerCase() ?? null;
  const dob = row.date_of_birth as string | null;

  if (mbi) {
    const exact = candidates.filter((c) => c.medicare_beneficiary_identifier === mbi);
    if (exact.length === 1) {
      return { disposition: 'match', clientId: exact[0].id, confidence: 'exact', candidates: [{ id: exact[0].id, reason: 'MBI' }] };
    }
    if (exact.length > 1) {
      // Two clients holding one MBI is a data fault that must not be papered
      // over by picking either of them.
      return {
        disposition: 'ambiguous',
        clientId: null,
        confidence: null,
        candidates: exact.map((c) => ({ id: c.id, reason: 'duplicate MBI in CRM' })),
      };
    }
  }

  if (lastName && dob) {
    const byNameDob = candidates.filter(
      (c) => c.last_name?.toLowerCase() === lastName && c.date_of_birth === dob,
    );
    const narrowed = firstName
      ? byNameDob.filter((c) => c.first_name?.toLowerCase() === firstName)
      : byNameDob;
    const pool = narrowed.length > 0 ? narrowed : byNameDob;

    if (pool.length === 1) {
      return { disposition: 'match', clientId: pool[0].id, confidence: 'high', candidates: [{ id: pool[0].id, reason: 'name + date of birth' }] };
    }
    if (pool.length > 1) {
      return {
        disposition: 'ambiguous',
        clientId: null,
        confidence: null,
        candidates: pool.map((c) => ({ id: c.id, reason: 'name + date of birth' })),
      };
    }
  }

  if (lastName && firstName) {
    const byName = candidates.filter(
      (c) => c.last_name?.toLowerCase() === lastName && c.first_name?.toLowerCase() === firstName,
    );
    if (byName.length > 0) {
      // Deliberately NOT a match. A shared name is not identity, and creating
      // a duplicate is a recoverable mistake where merging two real people is
      // not.
      return {
        disposition: 'ambiguous',
        clientId: null,
        confidence: 'low',
        candidates: byName.map((c) => ({ id: c.id, reason: 'name only — no date of birth or MBI to confirm' })),
      };
    }
  }

  return { disposition: 'create', clientId: null, confidence: null, candidates: [] };
}

/** Within-file duplicate key. Two rows for the same person in one upload. */
export function rowDedupeKey(row: NormalizedRow): string | null {
  const mbi = row.medicare_beneficiary_identifier as string | null;
  if (mbi) return `mbi:${mbi}`;
  const last = (row.last_name as string | null)?.toLowerCase();
  const first = (row.first_name as string | null)?.toLowerCase();
  const dob = row.date_of_birth as string | null;
  if (last && dob) return `namedob:${last}|${first ?? ''}|${dob}`;
  return null;
}
