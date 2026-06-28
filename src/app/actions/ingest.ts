'use server'

import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

interface CrmPayload {
  mbi_number: string;
  plan_id: string;
  effective_date: string;
  date_of_birth?: string;
  phone_number?: string;
  source?: string;
}

// ---------------------------------------------------------------------------
// Field-Level Encryption Helpers
// ---------------------------------------------------------------------------
function deriveFieldEncKey(agencyId: string): Buffer {
  const masterSecret = process.env.PHI_MASTER_SECRET;
  if (!masterSecret) throw new Error('PHI_MASTER_SECRET environment variable is not set');
  return crypto.pbkdf2Sync(masterSecret, `fle:${agencyId}`, 100_000, 32, 'sha256');
}

function encryptField(plaintext: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    cipher: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

function mbiIndexHash(mbi: string, agencyId: string): string {
  const masterSecret = process.env.PHI_MASTER_SECRET;
  if (!masterSecret) throw new Error('PHI_MASTER_SECRET environment variable is not set');
  return crypto
    .createHmac('sha256', masterSecret)
    .update(`${agencyId}:${mbi.toUpperCase().trim()}`)
    .digest('hex');
}

function evaluateSwitchRisk(
  payload: Pick<CrmPayload, 'plan_id' | 'effective_date'>,
  existingPlanId: string
) {
  const planChanged = payload.plan_id !== existingPlanId;
  if (!planChanged) {
    return { riskLevel: 'LOW', status: 'ACTIVE', triggerReason: null, daysUntilEffective: null };
  }

  const effectiveMs = new Date(payload.effective_date).getTime();
  const daysUntilEffective = Math.ceil((effectiveMs - Date.now()) / 86_400_000);

  if (daysUntilEffective > 0) {
    return {
      riskLevel: 'HIGH',
      status: 'PROVISIONALLY_DISENROLLED',
      triggerReason: `Plan switch ${existingPlanId} -> ${payload.plan_id} takes effect in ${daysUntilEffective} day(s) (${payload.effective_date}). Call member now.`,
      daysUntilEffective,
    };
  }

  return {
    riskLevel: 'HIGH',
    status: 'PLAN_CHANGED',
    triggerReason: `Plan changed ${existingPlanId} -> ${payload.plan_id} effective ${payload.effective_date}.`,
    daysUntilEffective: 0,
  };
}

// ---------------------------------------------------------------------------
// Batch Ingestion Server Action
// ---------------------------------------------------------------------------
export async function processCsvIngestion(
  agencyId: string,
  brokerId: string,
  rows: CrmPayload[]
) {
  if (!agencyId || !brokerId) throw new Error('Unauthorized');

  const encKey = deriveFieldEncKey(agencyId);
  let updatedCount = 0;
  let highRiskCount = 0;

  for (const row of rows) {
    const mbiHash = mbiIndexHash(row.mbi_number, agencyId);

    // Look up contact by MBI hash
    const { data: existing } = await supabaseAdmin
      .from('ghl_contacts')
      .select('id, current_plan_id, ghl_contact_id')
      .eq('agency_id', agencyId)
      .eq('mbi_hash', mbiHash)
      .maybeSingle();

    if (!existing) {
      // New contact -- encrypt PHI and insert
      const mbiEnc = encryptField(row.mbi_number, encKey);
      const dobEnc = encryptField(row.date_of_birth || '', encKey);
      const phoneEnc = encryptField(row.phone_number || '', encKey);

      await supabaseAdmin.from('ghl_contacts').insert({
        agency_id: agencyId,
        broker_id: brokerId,
        ghl_contact_id: mbiHash, // placeholder until real GHL sync
        mbi_hash: mbiHash,
        mbi_enc: mbiEnc,
        dob_enc: dobEnc,
        phone_enc: phoneEnc,
        current_plan_id: row.plan_id,
        status: 'ACTIVE',
        source: row.source || 'csv_upload',
      });

      updatedCount++;
    } else if (existing.current_plan_id !== row.plan_id) {
      // Plan change detected -- evaluate risk
      const risk = evaluateSwitchRisk(row, existing.current_plan_id ?? '');
      if (risk.riskLevel === 'HIGH') highRiskCount++;

      await supabaseAdmin.from('retention_events').insert({
        agency_id: agencyId,
        broker_id: brokerId,
        ghl_contact_id: existing.ghl_contact_id,
        event_type: 'plan_switch',
        risk_level: risk.riskLevel,
        previous_value: existing.current_plan_id,
        new_value: row.plan_id,
        days_until_effective: risk.daysUntilEffective,
        trigger_reason: risk.triggerReason,
        source: row.source || 'csv_upload',
      });

      await supabaseAdmin
        .from('ghl_contacts')
        .update({
          current_plan_id: row.plan_id,
          status: risk.status,
          risk_level: risk.riskLevel.toLowerCase(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      updatedCount++;
    }
  }

  return { updated: updatedCount, highRisk: highRiskCount };
}
