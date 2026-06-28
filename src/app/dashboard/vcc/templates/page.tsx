import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { FileText, Plus, CheckCircle, XCircle, Eye, Upload } from 'lucide-react'
import { TestFillButton } from './test-fill-button'

interface FieldDef {
  page: number
  x: number
  y: number
  size: number
}

interface Template {
  id: string
  carrier: string
  carrier_display_name: string | null
  year: number
  form_name: string
  storage_path: string
  version: number
  field_map: Record<string, FieldDef> | null
  active: boolean
  created_at: string
}

export default async function VCCTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Only agency owners and admins can manage templates
  const { data: agencyRow } = await supabase
    .from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase
    .from('brokers').select('role, agency_id').eq('user_id', user.id).maybeSingle()

  const isPrincipal = agencyRow != null ||
    brokerRow?.role === 'agency_admin' ||
    brokerRow?.role === 'agency_owner'
  if (!isPrincipal) redirect('/dashboard/vcc')

  const agencyId = agencyRow?.id ?? brokerRow?.agency_id ?? null
  const supabaseAdmin = createServiceClient()

  const { data: templates } = await supabaseAdmin
    .from('vcc_form_templates')
    .select('*')
    .order('carrier')
    .order('year', { ascending: false })

  const { data: brokerForNpn } = await supabaseAdmin
    .from('brokers')
    .select('npn, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()

  const list = (templates ?? []) as Template[]

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">VCC Form Templates</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {list.filter(t => t.active).length} active / {list.length} total
              </p>
            </div>
          </div>
          <Button asChild className="h-9 rounded-xl bg-primary text-white font-black uppercase text-[10px] tracking-widest gap-2">
            <Link href="/dashboard/vcc/templates/upload">
              <Plus className="w-4 h-4" /> Upload New Template
            </Link>
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
                <Upload className="w-10 h-10 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-black uppercase tracking-tight">No Templates Yet</p>
                <p className="text-sm text-muted-foreground mt-1">Upload a carrier PDF form to get started.</p>
              </div>
              <Button asChild className="h-12 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-[10px]">
                <Link href="/dashboard/vcc/templates/upload">
                  <Plus className="w-4 h-4 mr-2" /> Upload First Template
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {list.map(t => {
                const fieldCount = t.field_map ? Object.keys(t.field_map).length : 0
                return (
                  <Card key={t.id} className="rounded-2xl border-border">
                    <CardContent className="p-5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black uppercase tracking-tight">{t.form_name}</span>
                            <Badge variant="outline" className="font-black uppercase text-[9px] px-2 h-5">
                              {t.carrier_display_name ?? t.carrier}
                            </Badge>
                            <Badge variant="outline" className="font-black uppercase text-[9px] px-2 h-5">
                              {t.year}
                            </Badge>
                            <Badge variant="outline" className="font-black uppercase text-[9px] px-2 h-5">
                              v{t.version}
                            </Badge>
                            {t.active ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black uppercase text-[9px] px-2 h-5 gap-1">
                                <CheckCircle className="w-2.5 h-2.5" /> Active
                              </Badge>
                            ) : (
                              <Badge className="bg-muted text-muted-foreground font-black uppercase text-[9px] px-2 h-5 gap-1">
                                <XCircle className="w-2.5 h-2.5" /> Inactive
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-bold mt-0.5">
                            {fieldCount} fields mapped * {t.storage_path.split('/').pop()}
                          </p>
                          {t.field_map && (
                            <p className="text-[9px] font-mono text-muted-foreground/60 mt-0.5 truncate max-w-sm">
                              {Object.keys(t.field_map).join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {brokerForNpn?.npn && (
                          <TestFillButton
                            templateId={t.id}
                            storagePath={t.storage_path}
                            fieldMap={t.field_map ?? {}}
                            brokerNpn={brokerForNpn.npn}
                            brokerName={`${brokerForNpn.first_name} ${brokerForNpn.last_name}`}
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
