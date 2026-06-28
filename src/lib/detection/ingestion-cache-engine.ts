import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// In a real implementation this would invoke the Gemini API.
async function callGeminiForMapping(headers: string[], carrier: string): Promise<Record<string, string>> {
  // Mocking the Gemini response for the exercise.
  // We'll fall back to fuzzy matching natively anyway.
  throw new Error('Gemini API not implemented/configured in this environment');
}

function fuzzyAliasFallback(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  
  headers.forEach(header => {
    const lower = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lower.includes('memberid') || lower.includes('subscriberid') || lower === 'id') {
      mapping[header] = 'member_id';
    } else if (lower.includes('name') && lower.includes('full')) {
      mapping[header] = 'full_name';
    } else if (lower.includes('name')) {
      mapping[header] = 'full_name';
    } else if (lower.includes('status')) {
      mapping[header] = 'status';
    } else if (lower.includes('plan')) {
      mapping[header] = 'plan_name';
    } else if (lower.includes('effective')) {
      mapping[header] = 'effective_date';
    }
  });

  return mapping;
}

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sxqdjilabbmjobjpwwst.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export class IngestionCacheEngine {
  private supabase = getSupabase();

  private calculateFingerprint(headers: string[]): string {
    const sorted = [...headers].map(h => h.toLowerCase().trim()).sort();
    const joined = sorted.join('|');
    return crypto.createHash('sha256').update(joined).digest('hex');
  }

  async mapHeaders(headers: string[], carrier: string): Promise<{ mapping: Record<string, string>, usedCache: boolean }> {
    const fingerprint = this.calculateFingerprint(headers);
    
    const { data: cacheHit } = await this.supabase
      .from('carrier_schema_maps')
      .select('*')
      .eq('carrier', carrier)
      .eq('dom_fingerprint', fingerprint)
      .maybeSingle();

    const now = new Date();

    if (cacheHit && cacheHit.is_active) {
      const lastUsed = new Date(cacheHit.last_used_at);
      const daysOld = (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);

      if (daysOld < 7) {
        // Fresh hit
        await this.supabase
          .from('carrier_schema_maps')
          .update({ last_used_at: now.toISOString() })
          .eq('id', cacheHit.id);
        
        return { mapping: cacheHit.schema_mapping, usedCache: true };
      } else {
        // Stale hit (> 7 days)
        await this.supabase
          .from('background_job_queue')
          .insert({
            job_type: 'refresh_schema_map',
            payload: { carrier, fingerprint, headers }
          });
        
        await this.supabase
          .from('carrier_schema_maps')
          .update({ last_used_at: now.toISOString() })
          .eq('id', cacheHit.id);

        return { mapping: cacheHit.schema_mapping, usedCache: true };
      }
    }

    // Cache Miss
    let mapping: Record<string, string>;
    try {
      mapping = await callGeminiForMapping(headers, carrier);
    } catch (e) {
      mapping = fuzzyAliasFallback(headers);
    }

    if (Object.keys(mapping).length > 0) {
      await this.supabase
        .from('carrier_schema_maps')
        .insert({
          carrier,
          dom_fingerprint: fingerprint,
          schema_mapping: mapping,
          last_used_at: now.toISOString()
        });
    }

    return { mapping, usedCache: false };
  }
}
