'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptData, decryptData, createAuditHash } from './vault/core';

// HIPAA §164.514(b) — the 18 identifiers that make health data "individually identifiable"
export const PHI_FIELDS = [
  'fullName', 'medicareId', 'ssnLast4', 'address', 'phone', 'email', 'dob',
  'healthConditions', 'lastCallTranscript', 'pcpName', 'poaName', 'poaPhone',
  'pharmacyName', 'notes',
] as const;

export type PhiField = (typeof PHI_FIELDS)[number];

export interface PhiPayload {
  fullName?: string;
  medicareId?: string;
  ssnLast4?: string;
  address?: string;
  phone?: string;
  email?: string;
  dob?: string;
  healthConditions?: string[];
  lastCallTranscript?: string;
  pcpName?: string;
  poaName?: string;
  poaPhone?: string;
  pharmacyName?: string;
  notes?: string;
}

export interface PhiVaultRecord {
  memberId: string;
  agencyId: string;
  cipher: string;
  iv: string;
  hash: string;
  encryptedAt: number;
  encryptedBy: string;
}

export type AuditAction = 'PHI_READ' | 'PHI_WRITE' | 'PHI_DELETE' | 'PHI_DENIED';

export interface AuditEntry {
  action: AuditAction;
  memberId: string;
  userId: string;
  agencyId: string;
  timestamp: number;
  hash: string;
  prevHash: string;
}

/**
 * PhiGate is the single choke-point for all PHI access in the app.
 *
 * Encrypted records are stored in Supabase Storage bucket 'phi-vault'
 * at path {agencyId}/{memberId}.json. The raw PHI never leaves the
 * client unencrypted.
 */
export class PhiGate {
  private lastAuditHash = '0';

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly key: CryptoKey,
    private readonly userId: string,
    private readonly agencyId: string
  ) {}

  extractPhi(record: Record<string, any>): PhiPayload {
    const phi: PhiPayload = {};
    for (const field of PHI_FIELDS) {
      if (record[field] !== undefined) (phi as any)[field] = record[field];
    }
    return phi;
  }

  stripPhi<T extends Record<string, any>>(record: T): Omit<T, PhiField> {
    const safe = { ...record };
    for (const field of PHI_FIELDS) delete (safe as any)[field];
    return safe as Omit<T, PhiField>;
  }

  async writePhi(memberId: string, phi: PhiPayload): Promise<void> {
    const blob = await encryptData(phi, this.key);
    const record: PhiVaultRecord = {
      memberId,
      agencyId: this.agencyId,
      cipher: blob.cipher,
      iv: blob.iv,
      hash: blob.hash,
      encryptedAt: Date.now(),
      encryptedBy: this.userId,
    };
    const { error } = await this.supabase.storage
      .from('phi-vault')
      .upload(
        `${this.agencyId}/${memberId}.json`,
        JSON.stringify(record),
        { contentType: 'application/json', upsert: true }
      );
    if (error) throw error;
    this.appendAudit('PHI_WRITE', memberId);
  }

  async readPhi(memberId: string): Promise<PhiPayload | null> {
    const { data, error } = await this.supabase.storage
      .from('phi-vault')
      .download(`${this.agencyId}/${memberId}.json`);
    if (error || !data) return null;
    const record: PhiVaultRecord = JSON.parse(await data.text());
    const phi = await decryptData(record.cipher, record.iv, this.key);
    this.appendAudit('PHI_READ', memberId);
    return phi as PhiPayload;
  }

  // Non-blocking audit write — HIPAA §164.312(b) requires audit controls.
  private appendAudit(action: AuditAction, memberId: string): void {
    const prevHash = this.lastAuditHash;
    createAuditHash(action, this.userId, prevHash).then((hash) => {
      this.lastAuditHash = hash;
      this.supabase
        .from('audit_log')
        .insert({
          agency_id: this.agencyId,
          user_id: this.userId,
          action,
          resource_type: 'phi_vault',
          resource_id: memberId,
          metadata: { hash, prevHash },
        })
        .then(({ error }) => {
          if (error) console.error('[PhiGate] audit write failed', error);
        });
    });
  }
}
