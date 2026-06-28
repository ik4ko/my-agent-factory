"use client"

import { useState, useEffect } from "react"
import { 
  Sparkles, TriangleAlert, ShieldCheck, UserPlus, Printer, 
  Phone, Info, Calendar, Handshake, BrainCircuit, RefreshCw, PhoneCall, ShieldAlert, Zap
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { type MemberRecord, useAppStore } from "@/lib/store"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface InsightsPanelProps {
  member?: MemberRecord | null;
}

export function InsightsPanel({ member }: InsightsPanelProps) {
  const [loading, setLoading] = useState(false);
  const updateMember = useAppStore(s => s.updateMember)

  useEffect(() => {
    if (member?.id) {
      setLoading(true);
      const timer = setTimeout(() => setLoading(false), 800);
      return () => clearTimeout(timer);
    }
  }, [member?.id]);

  const handleTriggerFax = () => {
    if (!member) return;
    toast({ title: "Module 3: VCC Fax Agent", description: "Generating HIPAA package & faxing physician via Spruce Health..." })
    updateMember(member.id, { VCCStatus: 'faxed' })
  }

  const handlePOASetup = () => {
    if (!member) return;
    toast({ title: "Module 4: POA Shield", description: "Initiating healthcare plan advocate invitation..." })
    updateMember(member.id, { poaStatus: 'pending-invite' })
  }

  const handleTriggerAICall = () => {
    if (!member) return;
    toast({ title: "Module 2: Maya AI Check-in", description: "Queuing soft check-in call (Maya AI)..." })
    updateMember(member.id, { checkInStatus: 'called' })
  }

  const handlePTCRenewal = () => {
    if (!member) return;
    toast({ title: "Compliance Action", description: "Sending electronic PTC renewal link via SMS..." })
  }

  if (!member) return (
    <aside className="w-80 border-l border-border bg-card p-6 hidden lg:flex flex-col gap-6 shadow-2xl relative z-20">
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center text-primary shadow-inner">
          <BrainCircuit className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-sm font-black uppercase text-foreground">AegisSage Intelligence</h3>
          <p className="text-[10px] font-bold text-muted-foreground mt-1 px-4 leading-relaxed uppercase opacity-60">Select a member to view retention modules and AI agent status.</p>
        </div>
      </div>
    </aside>
  );

  const isPTCExpiring = () => {
    const expiry = new Date(member.ptcExpiryDate);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expiry < thirtyDaysFromNow;
  }

  return (
    <aside className="w-80 border-l border-border bg-card p-6 hidden lg:flex flex-col gap-6 overflow-y-auto shadow-2xl relative z-20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-xs font-black uppercase tracking-tight text-foreground">Member Intel</h2>
        </div>
        <Badge className={`${member.retentionScore > 80 ? 'bg-emerald-50 text-emerald-700' : member.retentionScore > 50 ? 'bg-amber-50 text-amber-700' : 'bg-destructive/5 text-destructive'} border-none text-[10px] font-black uppercase tracking-widest px-2`}>
          SCORE: {member.retentionScore}
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl ai-shimmer" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          {member.status === 'churn-risk' && (
            <Card className="rounded-2xl border-destructive/20 bg-destructive/5 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-black text-destructive flex items-center gap-2 uppercase tracking-widest">
                  <TriangleAlert className="w-3.5 h-3.5" />
                  MOD 1: SWITCH DETECTED
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[10px] text-destructive leading-relaxed font-bold uppercase">
                  Disenrollment pending on Carrier Portal alert. New Plan identified. 24h window active.
                </p>
                <Button size="sm" className="w-full bg-destructive hover:bg-destructive/90 text-white rounded-xl text-[10px] h-9 font-black uppercase tracking-widest shadow-lg shadow-destructive/20">
                  <Phone className="w-3.5 h-3.5 mr-2" /> Emergency Outreach
                </Button>
              </CardContent>
            </Card>
          )}

          {isPTCExpiring() && (
            <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-black text-amber-700 flex items-center gap-2 uppercase tracking-widest">
                  <Calendar className="w-3.5 h-3.5" />
                  Compliance Alert
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[10px] text-amber-700 leading-relaxed font-bold uppercase">
                  PTC Consent expires on {member.ptcExpiryDate}. System check-ins will be blocked after this date.
                </p>
                <Button onClick={handlePTCRenewal} size="sm" variant="outline" className="w-full h-9 border-amber-200 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white">
                  Renew Permission (SMS)
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Module Orchestration</h3>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger><Info className="w-3 h-3 text-muted-foreground/50" /></TooltipTrigger>
                  <TooltipContent><p className="text-[10px] font-bold uppercase">Autonomous background tasks</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <Card className="rounded-2xl border-border bg-card shadow-sm hover:shadow-md transition-all group">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Printer className="w-3.5 h-3.5 text-primary" />
                    <span className="font-black text-[10px] text-foreground uppercase tracking-tight">VCC Fax Agent</span>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-black px-1.5">{member.VCCStatus}</Badge>
                </div>
                <p className="text-[9px] text-muted-foreground leading-relaxed uppercase font-bold opacity-70">
                  MOD 3: Automatic chronic care activation via clinical faxing.
                </p>
                {member.VCCStatus === 'pending-fax' && (
                  <Button onClick={handleTriggerFax} size="sm" className="w-full h-9 text-[10px] font-black uppercase tracking-widest rounded-xl bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
                    <Printer className="w-3.5 h-3.5 mr-2" /> Trigger Spruce Fax
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-border bg-card shadow-sm hover:shadow-md transition-all group">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-primary" />
                    <span className="font-black text-[10px] text-foreground uppercase tracking-tight">POA Shield</span>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-black px-1.5">{member.poaStatus}</Badge>
                </div>
                <p className="text-[9px] text-muted-foreground leading-relaxed uppercase font-bold opacity-70">
                  MOD 4: Designate healthcare advocate to deter competitor switches.
                </p>
                {member.poaStatus === 'unprotected' && (
                  <Button onClick={handlePOASetup} variant="outline" size="sm" className="w-full h-9 text-[10px] font-black uppercase tracking-widest rounded-xl border-primary/20 text-primary hover:bg-primary/5">
                    <ShieldCheck className="w-3.5 h-3.5 mr-2" /> Activate Shield
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-border bg-card shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="w-3.5 h-3.5 text-primary" />
                    <span className="font-black text-[10px] text-foreground uppercase tracking-tight">Maya AI Agent</span>
                  </div>
                  <Badge variant="outline" className="text-[8px] uppercase font-black px-1.5">{member.checkInStatus}</Badge>
                </div>
                <p className="text-[9px] text-muted-foreground leading-relaxed uppercase font-bold opacity-70">
                  MOD 2: Milestone voice calls at Day 7, 30, and 75.
                </p>
                <Button onClick={handleTriggerAICall} variant="outline" size="sm" className="w-full h-9 text-[10px] font-black uppercase tracking-widest rounded-xl border-border hover:bg-muted">
                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Queue Milestone Call
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="pt-4 mt-auto space-y-3">
             <Button variant="outline" className="w-full rounded-2xl border-primary text-primary bg-card/50 hover:bg-primary/5 text-[10px] font-black uppercase tracking-widest h-12 group shadow-sm">
                <Handshake className="w-4 h-4 mr-2 text-primary group-hover:animate-pulse" />
                Enroll in Medicaid / MSP
             </Button>
             <p className="text-[8px] text-center text-muted-foreground font-bold uppercase tracking-tighter opacity-50 px-2">
               MANAGED AUTONOMOUSLY BY AEGISSAGE AI. PHI REMAINS AGENT-SCOPED AND ENCRYPTED AT REST.
             </p>
          </div>
        </div>
      )}
    </aside>
  );
}
