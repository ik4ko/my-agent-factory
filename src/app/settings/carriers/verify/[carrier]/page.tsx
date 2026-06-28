import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Card, CardContent } from '@/components/ui/card'
import { Shield, AlertTriangle } from 'lucide-react'
import { MfaVerifyForm } from './mfa-verify-form'

const CARRIER_LABELS: Record<string, string> = {
  humana: 'Humana', uhc: 'UHC', aetna: 'Aetna',
  wellcare: 'Wellcare', bcbs: 'BCBS',
}

export default async function MfaVerifyPage({
  params,
}: {
  params: Promise<{ carrier: string }>
}) {
  const { carrier } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])
  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) redirect('/login')

  const supabaseAdmin = createServiceClient()
  const { data: cred } = await supabaseAdmin
    .from('carrier_logins')
    .select('id, carrier, username, status, mfa_type, last_mfa_required_at')
    .eq('agency_id', agencyId)
    .eq('carrier', carrier)
    .maybeSingle()

  const baseCarrier = carrier.split('_')[0]
  const label = CARRIER_LABELS[baseCarrier] ?? carrier.toUpperCase()

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <header className="h-16 border-b border-border px-8 flex items-center gap-3 bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="w-9 h-9 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <Shield className="w-4 h-4 text-amber-500" />
        </div>
        <div>
          <h1 className="text-lg font-black text-foreground uppercase tracking-tight">{label} Verification</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Multi-factor authentication required
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-xl mx-auto w-full space-y-6">
        {!cred || cred.status !== 'mfa_required' ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <AlertTriangle className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-sm font-black uppercase tracking-tight text-muted-foreground">
              No MFA verification pending for {label}
            </p>
            <a href="/settings/carriers" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">
              ← Back to Carrier Portals
            </a>
          </div>
        ) : (
          <Card className="rounded-3xl border border-border shadow-sm">
            <CardContent className="p-8 space-y-6">
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20">
                <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
                  <span className="font-black text-amber-500">
                    {label} requires verification.
                  </span>{' '}
                  AegisSage detected an MFA prompt when attempting to access your roster.
                  {cred.mfa_type === 'sms' && ' A code was sent to your registered phone number.'}
                  {cred.mfa_type === 'email' && ' A code was sent to your registered email address.'}
                  {cred.mfa_type === 'totp' && ' Enter the code from your authenticator app.'}
                </p>
              </div>
              <MfaVerifyForm credId={cred.id} carrier={carrier} username={cred.username} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
