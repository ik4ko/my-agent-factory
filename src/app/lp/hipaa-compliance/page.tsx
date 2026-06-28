
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ShieldCheck, Lock, Fingerprint, History, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function HIPAAComplianceLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Enterprise Grade Security
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            The <span className="text-primary">Clinical Standard</span> for Medicare Data Security.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Don't risk your license on unsecured spreadsheets. AegisSage is built on a foundation of BAA-compliant infrastructure with immutable PHI audit trails.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8">
            <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white text-left space-y-4 shadow-xl">
              <Lock className="w-8 h-8 text-primary" />
              <h3 className="text-xl font-black uppercase tracking-tighter">AES-256 Encryption</h3>
              <p className="text-xs font-medium text-slate-400 leading-relaxed uppercase">Member PII is encrypted at rest and in transit. Your agency holds the keys to the vault.</p>
            </div>
            <div className="p-8 rounded-[2.5rem] bg-card border border-border text-left space-y-4">
              <History className="w-8 h-8 text-primary" />
              <h3 className="text-xl font-black uppercase tracking-tighter">10-Year Audit Trail</h3>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed uppercase">Automated logging of every PHI access, fulfilling federal retention requirements for Medicare agencies.</p>
            </div>
          </div>

          <div className="pt-12">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3" asChild>
              <Link href="/dashboard">Deploy Secure Workspace <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
