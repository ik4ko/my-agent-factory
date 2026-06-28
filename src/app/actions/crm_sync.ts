'use server'

import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

interface CrmConfig {
  ghlApiKey?: string;
  webhookUrl?: string;
}

// ---------------------------------------------------------------------------
// Credential Encryption Helpers
// ---------------------------------------------------------------------------
function deriveConfigEncKey(agencyId: string): Buffer {
  const masterSecret = process.env.PHI_MASTER_SECRET;
  if (!masterSecret) throw new Error('PHI_MASTER_SECRET environment variable is not set');
  return crypto.pbkdf2Sync(masterSecret, `crm:${agencyId}`, 100_000, 32, 'sha256');
}

function encryptCredential(plaintext: string, key: Buffer) {
  if (!plaintext) return null;
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

function decryptCredential(cipherData: any, key: Buffer) {
  if (!cipherData?.cipher || !cipherData?.iv) return '';
  try {
    const encryptedBuffer = Buffer.from(cipherData.cipher, 'base64');
    const iv = Buffer.from(cipherData.iv, 'base64');
    const authTag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
    const ciphertext = encryptedBuffer.subarray(0, encryptedBuffer.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption error', e);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function saveCrmConfig(agencyId: string, config: CrmConfig) {
  if (!agencyId) throw new Error('Unauthorized');

  const encKey = deriveConfigEncKey(agencyId);
  const patch: Record<string, any> = {
    agency_id: agencyId,
    updated_at: new Date().toISOString(),
  };

  if (config.ghlApiKey !== undefined) {
    patch.ghl_api_key_enc = encryptCredential(config.ghlApiKey, encKey);
  }
  if (config.webhookUrl !== undefined) {
    patch.webhook_url_enc = encryptCredential(config.webhookUrl, encKey);
  }

  await supabaseAdmin
    .from('agency_credentials')
    .upsert(patch, { onConflict: 'agency_id' });

  return { success: true };
}

export async function getCrmConfig(agencyId: string): Promise<CrmConfig> {
  if (!agencyId) return {};

  const { data } = await supabaseAdmin
    .from('agency_credentials')
    .select('ghl_api_key_enc, webhook_url_enc')
    .eq('agency_id', agencyId)
    .maybeSingle();

  if (!data) return {};

  const encKey = deriveConfigEncKey(agencyId);

  return {
    ghlApiKey: data.ghl_api_key_enc
      ? decryptCredential(data.ghl_api_key_enc, encKey)
      : '',
    webhookUrl: data.webhook_url_enc
      ? decryptCredential(data.webhook_url_enc, encKey)
      : '',
  };
}

export async function syncToCrm(
  agencyId: string,
  contactId: string,
  scriptText: string,
  riskLevel: string
) {
  if (!agencyId || !contactId) throw new Error('Unauthorized');

  const config = await getCrmConfig(agencyId);
  if (!config.ghlApiKey && !config.webhookUrl) {
    throw new Error('No CRM configuration found. Please setup in Settings.');
  }

  const { data: contact } = await supabaseAdmin
    .from('ghl_contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();

  if (!contact) throw new Error('Member not found');

  const phiMasterSecret = process.env.PHI_MASTER_SECRET;
  if (!phiMasterSecret) throw new Error('PHI_MASTER_SECRET environment variable is not set');

  const phiEncKey = crypto.pbkdf2Sync(phiMasterSecret, `fle:${agencyId}`, 100_000, 32, 'sha256');
  const phone = decryptCredential(contact.phone_enc, phiEncKey);
  const mbi = decryptCredential(contact.mbi_enc, phiEncKey);

  const payload = {
    mbi,
    phone,
    riskLevel,
    currentPlanId: contact.current_plan_id,
    talkingPoints: scriptText,
    source: 'AegisSage-Intelligence',
  };

  const results: string[] = [];

  if (config.ghlApiKey) {
    results.push('GHL');
  }

  if (config.webhookUrl) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`Webhook failed with status ${resp.status}`);
    results.push('Webhook');
  }

  await supabaseAdmin.from('audit_log').insert({
    agency_id: agencyId,
    action: 'CRM_SYNC',
    resource_type: 'ghl_contacts',
    resource_id: contactId,
    metadata: { destinations: results, riskLevel, hasScript: !!scriptText },
  });

  return { success: true, destinations: results };
}
