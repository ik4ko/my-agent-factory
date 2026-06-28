export interface FaxResult {
  success: boolean
  confirmationId?: string
  error?: string
}

export async function sendFax(
  pdfBytes: Uint8Array,
  toFaxNumber: string,
  subject: string
): Promise<FaxResult> {
  const apiKey = process.env.SRFAX_API_KEY
  const accountNumber = process.env.SRFAX_ACCOUNT_NUMBER

  if (!apiKey || !accountNumber) {
    console.warn('SRFax not configured — skipping fax dispatch')
    return { success: false, error: 'fax_not_configured' }
  }

  try {
    const base64PDF = Buffer.from(pdfBytes).toString('base64')

    const response = await fetch('https://www.srfax.com/SRF_SecWebSvc.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'Queue_Fax',
        access_id: accountNumber,
        access_pwd: apiKey,
        sCallerID: process.env.SRFAX_CALLER_ID ?? '8005551234',
        sSenderEmail: process.env.SRFAX_SENDER_EMAIL ?? 'noreply@aegissage.com',
        sFaxType: 'SINGLE',
        sToFaxNumber: toFaxNumber.replace(/\D/g, ''),
        sSubject: subject,
        sFileName_1: 'VCC_form.pdf',
        sFileContent_1: base64PDF,
      }),
    })

    const result = await response.json()

    if (result.Status === 'Success') {
      return { success: true, confirmationId: result.Result }
    }

    return { success: false, error: result.Result ?? 'fax_failed' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
