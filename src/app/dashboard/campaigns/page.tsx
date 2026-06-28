import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Megaphone, Shield, BookOpen, CheckCircle2, Circle, Calendar } from 'lucide-react'
import { CampaignEnrollmentActions } from './campaign-enrollment-actions'
import { AEPEnrollModal } from './aep-enroll-modal'

type EnrollmentStatus = 'active' | 'completed' | 'cancelled' | 'failed'

const STATUS_CONFIG: Record<EnrollmentStatus, { label: string; cls: string }> = {
  active:    { label: 'Active',     cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  completed: { label: 'Completed',  cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  cancelled: { label: 'Cancelled',  cls: 'bg-muted text-muted-foreground border-border' },
  failed:    { label: 'Failed',     cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
}

const TRIGGER_LABELS: Record<string, string> = {
  manual:          'Manual',
  switch_alert:    'Switch Alert',
  VCC_deadline:  'VCC Deadline',
  aep_scheduler:   'AEP Scheduler',
  system:          'System',
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

export default async function CampaignsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agency } = await supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase.from('brokers').select('role').eq('user_id', user.id).maybeSingle()
  const isPrincipal = !!agency || ['agency_admin', 'agency_owner'].includes(brokerRow?.role ?? '')

  const [enrollmentsRes, aepRes, templatesRes] = await Promise.all([
    supabase
      .from('campaign_enrollments')
      .select('id, ghl_contact_id, template_id, triggered_by, status, enrolled_at, template:template_id (name, campaign_type)')
      .order('enrolled_at', { ascending: false })
      .limit(100),
    supabase
      .from('aep_schedule')
      .select('id, ghl_contact_id, aep_start, enrollment_anniversary, reminder_90_sent, reminder_60_sent, reminder_30_sent, reminder_7_sent, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('campaign_templates')
      .select('id, name, description, campaign_type, trigger_type, trigger_days_before, steps, active')
      .order('name'),
  ])

  const enrollments = enrollmentsRes.data ?? []
  const aepSchedules = aepRes.data ?? []
  const templates = templatesRes.data ?? []

  const activeCount = enrollments.filter(e => e.status === 'active').length
  const aepCount = aepSchedules.length

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">Campaigns</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {activeCount} active · {aepCount} AEP Shield
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full pb-32">
          <Tabs defaultValue="active">
            <TabsList className="rounded-2xl bg-muted/50 mb-6">
              <TabsTrigger value="active" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Megaphone className="w-3.5 h-3.5 mr-1.5" /> Active
              </TabsTrigger>
              <TabsTrigger value="aep" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Shield className="w-3.5 h-3.5 mr-1.5" /> AEP Shield
              </TabsTrigger>
              <TabsTrigger value="templates" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <BookOpen className="w-3.5 h-3.5 mr-1.5" /> Templates
              </TabsTrigger>
            </TabsList>

            {/* -- Active Enrollments -- */}
            <TabsContent value="active">
              {enrollments.length === 0 ? (
                <EmptyState icon={Megaphone} message="No campaign enrollments yet -- trigger a Reactive Save or AEP Shield to get started." />
              ) : (
                <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-sm font-black uppercase tracking-tight">All Campaign Enrollments</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent bg-transparent border-none">
                          {['Contact', 'Campaign', 'Triggered By', 'Status', 'Enrolled', 'Actions'].map(h => (
                            <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {enrollments.map(e => {
                          const status = (e.status ?? 'active') as EnrollmentStatus
                          const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active
                          const tmpl = e.template as unknown as { name: string; campaign_type: string } | null

                          return (
                            <TableRow key={e.id} className="border-border/50 hover:bg-muted/20">
                              <TableCell className="px-4 py-3 font-bold text-xs max-w-[160px] truncate font-mono">
                                {e.ghl_contact_id.startsWith('new:')
                                  ? <span className="text-muted-foreground">{e.ghl_contact_id.slice(0, 14)}...</span>
                                  : e.ghl_contact_id}
                              </TableCell>
                              <TableCell className="px-4 text-[11px] font-bold">{tmpl?.name ?? e.template_id}</TableCell>
                              <TableCell className="px-4 text-[10px] text-muted-foreground uppercase tracking-wide">
                                {TRIGGER_LABELS[e.triggered_by ?? ''] ?? e.triggered_by ?? '--'}
                              </TableCell>
                              <TableCell className="px-4">
                                <Badge className={`text-[8px] font-black uppercase px-2 border ${cfg.cls}`}>{cfg.label}</Badge>
                              </TableCell>
                              <TableCell className="px-4 text-[10px] text-muted-foreground">{fmt(e.enrolled_at)}</TableCell>
                              <TableCell className="px-4">
                                <CampaignEnrollmentActions enrollmentId={e.id} status={status} />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* -- AEP Shield -- */}
            <TabsContent value="aep">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    <span className="text-sm font-black uppercase tracking-tight">AEP Shield Enrollments</span>
                  </div>
                  <AEPEnrollModal />
                </div>

                {aepSchedules.length === 0 ? (
                  <EmptyState icon={Shield} message="No contacts enrolled in AEP Shield. Click 'Enroll Contact' to add your first." />
                ) : (
                  <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
                    <CardContent className="p-0 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent bg-transparent border-none">
                            {['Contact', 'AEP Start', 'Days Left', '90d', '60d', '30d', '7d'].map(h => (
                              <TableHead key={h} className="font-black uppercase text-[9px] tracking-widest text-muted-foreground py-4 px-4">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aepSchedules.map(s => {
                            const days = daysUntil(s.aep_start)
                            return (
                              <TableRow key={s.id} className="border-border/50 hover:bg-muted/20">
                                <TableCell className="px-4 py-3 font-mono text-xs max-w-[160px] truncate">{s.ghl_contact_id}</TableCell>
                                <TableCell className="px-4 text-[11px] font-bold">{fmt(s.aep_start)}</TableCell>
                                <TableCell className="px-4">
                                  {days !== null && (
                                    <span className={`text-[10px] font-black ${days < 30 ? 'text-red-500' : days < 60 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                      {days > 0 ? `${days}d` : 'Started'}
                                    </span>
                                  )}
                                </TableCell>
                                {([
                                  s.reminder_90_sent,
                                  s.reminder_60_sent,
                                  s.reminder_30_sent,
                                  s.reminder_7_sent,
                                ] as boolean[]).map((sent, i) => (
                                  <TableCell key={i} className="px-4">
                                    {sent
                                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                      : <Circle className="w-4 h-4 text-muted-foreground/30" />}
                                  </TableCell>
                                ))}
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* -- Templates -- */}
            <TabsContent value="templates">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.length === 0 ? (
                  <EmptyState icon={BookOpen} message="No templates yet -- they are seeded automatically when the first campaign is triggered." />
                ) : templates.map(t => {
                  const steps = Array.isArray(t.steps) ? t.steps as unknown[] : []
                  return (
                    <Card key={t.id} className="rounded-3xl border border-border shadow-sm">
                      <CardHeader className="border-b bg-muted/30 pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-sm font-black uppercase tracking-tight">{t.name}</CardTitle>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
                          </div>
                          <Badge className={`shrink-0 text-[8px] font-black uppercase px-2 border ${t.active ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : 'bg-muted text-muted-foreground border-border'}`}>
                            {t.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex gap-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                          <span>Type: <span className="text-foreground">{t.campaign_type.replace(/_/g, ' ')}</span></span>
                          <span>Trigger: <span className="text-foreground">{t.trigger_type.replace(/_/g, ' ')}</span></span>
                          {t.trigger_days_before && <span>Days before: <span className="text-foreground">{t.trigger_days_before}</span></span>}
                        </div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                          {steps.length} step{steps.length !== 1 ? 's' : ''}
                        </div>
                        <ol className="space-y-1 mt-2">
                          {steps.map((step: unknown, i: number) => {
                            const s = step as Record<string, unknown>
                            return (
                              <li key={i} className="flex items-start gap-2 text-[10px]">
                                <span className="text-[8px] font-black text-muted-foreground/60 w-8 shrink-0">D+{s.day as number}</span>
                                <span className="text-muted-foreground">
                                  <span className="font-black text-foreground uppercase mr-1">{s.type as string}</span>
                                  {(s.title ?? s.message) as string}
                                </span>
                              </li>
                            )
                          })}
                        </ol>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <Icon className="w-12 h-12 text-muted-foreground/30" />
      <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/50 text-center max-w-xs">{message}</p>
    </div>
  )
}
