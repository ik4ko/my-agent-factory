'use server'

import crypto from 'crypto';

export async function decryptPhiFields(
  agencyId: string, 
  mbiCipherData: { cipher: string, iv: string } | null,
  phoneCipherData: { cipher: string, iv: string } | null
) {
  const masterSecret = process.env.PHI_MASTER_SECRET;
  if (!masterSecret) throw new Error('PHI_MASTER_SECRET environment variable is not set');
  const key = crypto.pbkdf2Sync(masterSecret, `fle:${agencyId}`, 100000, 32, 'sha256');
  
  const decrypt = (cipherData: { cipher: string, iv: string } | null) => {
    if (!cipherData || !cipherData.cipher || !cipherData.iv) return '';
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
      return 'DECRYPTION_FAILED';
    }
  };

  return {
    mbi: decrypt(mbiCipherData),
    phone: decrypt(phoneCipherData)
  };
}
