import {
  MAX_ROWS,
  matchClient,
  normalizeDate,
  normalizeMbi,
  normalizeMoney,
  normalizePhone,
  normalizeRow,
  normalizeState,
  normalizeZip,
  parseCsv,
  rowDedupeKey,
  suggestMapping,
  type ClientCandidate,
  type NormalizedRow,
} from '@/lib/medicare-crm/import';

/**
 * Fixtures are shaped like real carrier exports — the header spellings, the
 * date formats, the quoted-name-with-comma case — but every person, MBI, and
 * plan below is invented.
 */

describe('parseCsv', () => {
  it('reads a plain export', () => {
    const result = parseCsv('first_name,last_name,zip\nAda,Sample,07001\nGrace,Fixture,07002\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(['first_name', 'last_name', 'zip']);
    expect(result.rows).toEqual([
      { first_name: 'Ada', last_name: 'Sample', zip: '07001' },
      { first_name: 'Grace', last_name: 'Fixture', zip: '07002' },
    ]);
  });

  it('strips the UTF-8 BOM Excel writes', () => {
    // Left in place the BOM becomes part of the first header, and every
    // mapping against first_name silently stops matching.
    const result = parseCsv('﻿first_name,last_name\nAda,Sample\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers[0]).toBe('first_name');
  });

  it('handles CRLF line endings', () => {
    const result = parseCsv('a,b\r\n1,2\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps a comma inside a quoted field', () => {
    const result = parseCsv('name,plan\n"Sample, Ada","Advantage Choice, PPO"\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ name: 'Sample, Ada', plan: 'Advantage Choice, PPO' });
  });

  it('unescapes doubled quotes', () => {
    const result = parseCsv('note\n"She said ""hello"""\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].note).toBe('She said "hello"');
  });

  it('keeps a newline inside a quoted field', () => {
    const result = parseCsv('addr\n"12 Example St\nSuite 4"\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].addr).toBe('12 Example St\nSuite 4');
  });

  it('reads a final row with no trailing newline', () => {
    const result = parseCsv('a\n1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ a: '1' }]);
  });

  it('ignores blank rows from a trailing newline', () => {
    const result = parseCsv('a,b\n1,2\n\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });

  it('rejects an unterminated quote rather than guessing', () => {
    const result = parseCsv('a\n"never closed\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/never closed/i);
  });

  it('rejects a binary file renamed to .csv', () => {
    const result = parseCsv(`PK\x03\x04${String.fromCharCode(0)}${String.fromCharCode(0)}binary`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Excel file/i);
  });

  it('rejects an empty file, a header-only file, and a blank header row', () => {
    expect(parseCsv('').ok).toBe(false);
    expect(parseCsv('a,b\n').ok).toBe(false);
    expect(parseCsv(',,\n1,2,3\n').ok).toBe(false);
  });

  it('refuses a file with more rows than the limit', () => {
    const huge = `a\n${Array.from({ length: MAX_ROWS + 5 }, (_, i) => i).join('\n')}\n`;
    const result = parseCsv(huge);
    expect(result.ok).toBe(false);
  });
});

describe('suggestMapping', () => {
  it('matches exact header names', () => {
    const mapping = suggestMapping(['first_name', 'last_name', 'zip'], 'clients');
    expect(mapping.first_name).toBe('first_name');
    expect(mapping.zip).toBe('zip');
  });

  it('resolves the header spellings carriers actually use', () => {
    const mapping = suggestMapping(
      ['First Name', 'Last Name', 'DOB', 'Medicare ID', 'Phone Number', 'Postal Code'],
      'clients',
    );
    expect(mapping).toMatchObject({
      first_name: 'First Name',
      last_name: 'Last Name',
      date_of_birth: 'DOB',
      medicare_beneficiary_identifier: 'Medicare ID',
      phone: 'Phone Number',
      zip: 'Postal Code',
    });
  });

  it('leaves a field unmapped rather than guessing wildly', () => {
    const mapping = suggestMapping(['completely', 'unrelated'], 'clients');
    expect(mapping.first_name).toBeUndefined();
  });
});

describe('normalizers', () => {
  it('reduces US phone formats to ten digits', () => {
    for (const input of ['(555) 123-4567', '555-123-4567', '5551234567', '+1 555 123 4567']) {
      expect(normalizePhone(input)).toBe('5551234567');
    }
    expect(normalizePhone('12345')).toBeNull();
  });

  it('accepts ISO and US dates', () => {
    expect(normalizeDate('2026-01-15')).toBe('2026-01-15');
    expect(normalizeDate('1/15/2026')).toBe('2026-01-15');
    expect(normalizeDate('01/15/2026')).toBe('2026-01-15');
  });

  it('refuses two-digit years and impossible dates', () => {
    // "26" could be 1926 or 2026, and for a date of birth that is a 100-year
    // error, so it is refused rather than guessed.
    expect(normalizeDate('1/15/26')).toBeNull();
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('13/01/2026')).toBeNull();
    expect(normalizeDate('not a date')).toBeNull();
  });

  it('validates an MBI against the CMS character rules', () => {
    expect(normalizeMbi('1EG4-TE5-MK72')).toBe('1EG4TE5MK72');
    expect(normalizeMbi('1eg4te5mk72')).toBe('1EG4TE5MK72');
    // S, L, O, I, B and Z never appear in an MBI.
    expect(normalizeMbi('1SG4TE5MK72')).toBeNull();
    expect(normalizeMbi('123456789')).toBeNull();
  });

  it('parses money and rejects nonsense', () => {
    expect(normalizeMoney('$1,234.50')).toBe(1234.5);
    expect(normalizeMoney('0')).toBe(0);
    expect(normalizeMoney('abc')).toBeNull();
    expect(normalizeMoney('-5')).toBeNull();
  });

  it('normalizes state and ZIP', () => {
    expect(normalizeState('nj')).toBe('NJ');
    expect(normalizeState('New Jersey')).toBeNull();
    expect(normalizeZip('07001')).toBe('07001');
    expect(normalizeZip('070011234')).toBe('07001-1234');
    expect(normalizeZip('7001')).toBeNull();
  });
});

describe('normalizeRow', () => {
  const mapping = {
    first_name: 'First Name',
    last_name: 'Last Name',
    date_of_birth: 'DOB',
    medicare_beneficiary_identifier: 'Medicare ID',
    phone: 'Phone',
  };

  it('normalizes a clean row with no issues', () => {
    const { normalized, issues } = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Sample', DOB: '3/2/1955', 'Medicare ID': '1EG4-TE5-MK72', Phone: '(555) 123-4567' },
      mapping,
      'clients',
    );
    expect(issues).toEqual([]);
    expect(normalized).toMatchObject({
      first_name: 'Ada',
      last_name: 'Sample',
      date_of_birth: '1955-03-02',
      medicare_beneficiary_identifier: '1EG4TE5MK72',
      phone: '5551234567',
    });
  });

  it('reports a present-but-unparseable value as an issue', () => {
    const { issues } = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Sample', DOB: 'sometime in 1955' },
      mapping,
      'clients',
    );
    expect(issues).toContainEqual(expect.objectContaining({ field: 'date_of_birth' }));
  });

  it('does not treat an absent optional value as an error', () => {
    // A carrier export that simply omits a column is not a malformed file.
    const { normalized, issues } = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Sample' },
      mapping,
      'clients',
    );
    expect(issues).toEqual([]);
    expect(normalized.date_of_birth).toBeNull();
  });

  it('flags a missing required field', () => {
    const { issues } = normalizeRow({ 'First Name': 'Ada' }, mapping, 'clients');
    expect(issues).toContainEqual(expect.objectContaining({ field: 'last_name' }));
  });
});

// ── Identity resolution ────────────────────────────────────────────────────

const CANDIDATES: ClientCandidate[] = [
  {
    id: 'client-1',
    first_name: 'Ada',
    last_name: 'Sample',
    date_of_birth: '1955-03-02',
    medicare_beneficiary_identifier: '1EG4TE5MK72',
    phone: null,
    email: null,
  },
  {
    id: 'client-2',
    first_name: 'Ada',
    last_name: 'Sample',
    date_of_birth: '1962-08-19',
    medicare_beneficiary_identifier: null,
    phone: null,
    email: null,
  },
];

describe('matchClient', () => {
  it('matches exactly on MBI', () => {
    const result = matchClient({ medicare_beneficiary_identifier: '1EG4TE5MK72' }, CANDIDATES);
    expect(result).toMatchObject({ disposition: 'match', clientId: 'client-1', confidence: 'exact' });
  });

  it('matches with high confidence on name plus date of birth', () => {
    const result = matchClient(
      { first_name: 'Ada', last_name: 'Sample', date_of_birth: '1962-08-19' },
      CANDIDATES,
    );
    expect(result).toMatchObject({ disposition: 'match', clientId: 'client-2', confidence: 'high' });
  });

  it('refuses to match on a shared name alone', () => {
    // Two people named Ada Sample exist in this book. Picking either would be
    // a coin flip, and merging two real members is not recoverable.
    const result = matchClient({ first_name: 'Ada', last_name: 'Sample' }, CANDIDATES);
    expect(result.disposition).toBe('ambiguous');
    expect(result.clientId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it('escalates a duplicate MBI in the CRM rather than picking one', () => {
    const duplicated: ClientCandidate[] = [
      { ...CANDIDATES[0], id: 'a' },
      { ...CANDIDATES[0], id: 'b' },
    ];
    const result = matchClient({ medicare_beneficiary_identifier: '1EG4TE5MK72' }, duplicated);
    expect(result.disposition).toBe('ambiguous');
    expect(result.candidates[0].reason).toMatch(/duplicate MBI/i);
  });

  it('creates when nobody matches', () => {
    const result = matchClient(
      { first_name: 'Grace', last_name: 'Unknown', date_of_birth: '1950-01-01' },
      CANDIDATES,
    );
    expect(result).toMatchObject({ disposition: 'create', clientId: null });
  });

  it('never returns a clientId alongside an ambiguous disposition', () => {
    const rows: NormalizedRow[] = [
      { first_name: 'Ada', last_name: 'Sample' },
      { medicare_beneficiary_identifier: '1EG4TE5MK72' },
      { first_name: 'Grace', last_name: 'Unknown' },
    ];
    for (const row of rows) {
      const result = matchClient(row, CANDIDATES);
      if (result.disposition === 'ambiguous') expect(result.clientId).toBeNull();
    }
  });
});

describe('rowDedupeKey', () => {
  it('keys on MBI when present', () => {
    expect(rowDedupeKey({ medicare_beneficiary_identifier: '1EG4TE5MK72' })).toBe('mbi:1EG4TE5MK72');
  });

  it('falls back to name plus date of birth', () => {
    const key = rowDedupeKey({ first_name: 'Ada', last_name: 'Sample', date_of_birth: '1955-03-02' });
    expect(key).toBe('namedob:sample|ada|1955-03-02');
  });

  it('returns null when a row cannot be identified at all', () => {
    // Two rows with only a surname are not evidence of duplication.
    expect(rowDedupeKey({ last_name: 'Sample' })).toBeNull();
  });
});
