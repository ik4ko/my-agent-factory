'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { AgencyProfile, GHLSettings, MayaSettings } from '@/lib/store';

// --- WebCrypto Logic ---
export async function deriveKey(passphrase: string, salt: string = 'AegisSage-v1') {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(data: any, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const cipherArray = new Uint8Array(cipher);
  const hashBuffer = await crypto.subtle.digest('SHA-256', cipherArray);

  return {
    cipher: btoa(String.fromCharCode(...cipherArray)),
    iv: btoa(String.fromCharCode(...iv)),
    hash: btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
  };
}

export async function decryptData(cipherB64: string, ivB64: string, key: CryptoKey) {
  const cipher = new Uint8Array(atob(cipherB64).split('').map(c => c.charCodeAt(0)));
  const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// --- Multi-Source Sync Engine ---
export interface VaultState {
  healthRecords: any[];
  blueButtonData: any;
  agencyProfile?: AgencyProfile;
  ghlSettings?: GHLSettings;
  mayaSettings?: MayaSettings;
  updatedAt: number;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function syncVaultToCloud(userId: string, blob: any): void {
  const payload = JSON.stringify({ ...blob, updatedAt: Date.now() });
  getSupabase()
    .storage
    .from('vault')
    .upload(`${userId}/vault.json`, payload, { contentType: 'application/json', upsert: true })
    .catch(err => console.error('Cloud Sync Failed', err));
}

export async function fetchVaultFromCloud(userId: string): Promise<any | null> {
  const { data, error } = await getSupabase()
    .storage
    .from('vault')
    .download(`${userId}/vault.json`);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

// --- Audit Chain ---
export async function createAuditHash(action: string, userId: string, prevHash: string = '0') {
  const data = `${action}-${userId}-${Date.now()}-${prevHash}`;
  const msgUint8 = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}
