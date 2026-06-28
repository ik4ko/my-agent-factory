// GHL client stubs — integration removed.
// These functions return safe defaults so callers compile and runtime
// does not perform any external GHL network calls.

export async function ghlFetch(
  _agencyId: string,
  _path: string,
  _options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return { ok: false, status: 501, data: { error: 'GHL integration removed' } }
}

export async function getGHLLocationId(_agencyId: string): Promise<string | null> {
  return null
}
