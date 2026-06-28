
import { supabaseAdmin } from './supabase';

/**
 * Persists GHL OAuth tokens for a given agency.
 * @param agencyId The internal agency UUID (from the 'state' parameter).
 * @param access_token The access token from GHL.
 * @param refresh_token The refresh token from GHL.
 * @param expiresAt The ISO string for when the token expires.
 */
export async function saveGhlTokens(
  agencyId: string,
  access_token: string,
  refresh_token: string,
  expiresAt: string
) {
  const { error } = await supabaseAdmin
    .from('agency_credentials')
    .upsert({
      agency_id: agencyId,
      access_token,
      refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agency_id' });

  if (error) {
    console.error('Error saving GHL tokens:', error);
    throw error;
  }
}
