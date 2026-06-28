import { Resend } from 'resend'

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'alerts@aegissage.com'

let _instance: Resend | null = null

export function getResend(): Resend {
  if (!_instance) {
    const key = process.env.RESEND_API_KEY
    if (!key) {
      console.error('[email] RESEND_API_KEY is not set')
      throw new Error('RESEND_API_KEY is not configured')
    }
    _instance = new Resend(key)
  }
  return _instance
}
