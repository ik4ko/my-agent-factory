import { createHmac } from 'crypto'
import { encryptCredential, decryptCredential } from '@/lib/crypto-server'

function getMasterSecret(): string {
  const s = process.env.PHI_MASTER_SECRET
  if (!s) throw new Error('PHI_MASTER_SECRET is not set')
  return s
}

/**
 * Deterministic HMAC-SHA256 of an MBI using the PHI_MASTER_SECRET.
 * Used for indexed equality lookups after the plaintext mbi column was deprecated.
 * Never stores or exposes the raw MBI — only the one-way hash.
 */
export function hashMbi(mbi: string): string {
  return createHmac('sha256', Buffer.from(getMasterSecret(), 'hex'))
    .update(mbi.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))
    .digest('hex')
}

/**
 * AES-256-GCM encrypt an MBI for storage in book_of_business.mbi_encrypted.
 * Returns the iv:authTag:ciphertext format from crypto-server.ts.
 */
export function encryptMbi(mbi: string): string {
  return encryptCredential(mbi.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))
}

/**
 * Decrypt an MBI stored in book_of_business.mbi_encrypted.
 * Returns null if the value is absent or decryption fails.
 */
export function decryptMbi(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null
  try {
    return decryptCredential(encrypted)
  } catch {
    return null
  }
}
