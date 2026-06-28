
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Activity, Globe, Zap, Search, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function MARxMonitoringLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            CMS MARx Bridge
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            Direct-to-CMS <span className="text-primary">Monitoring</span>. No Lag. No Churn.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Wait for carrier commission reports and it's already too late. AegisSage uses a direct bridge to poll MARx enrollment snapshots, catching member moves before the disenrollment is finalized.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8 text-left">
            <div className="p-8 rounded-[2.5rem] bg-muted/30 border border-border space-y-4">
              <Search className="w-8 h-8 text-primary" />
              <h3 className="text-xl font-black uppercase tracking-tighter">Nightly Snapshots</h3>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed uppercase">We compare current enrollments against the previous night's file to detect any changes in MBI status or carrier ID.</p>
            </div>
            <div className="p-8 rounded-[2.5rem] bg-muted/30 border border-border space-y-4">
              <Zap className="w-8 h-8 text-primary" />
              <h3 className="text-xl font-black uppercase tracking-tighter">Instant Diff Logic</h3>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed uppercase">AegisSage AI highlights the specific "Switch" event, identifying the new carrier so you can counter-market effectively.</p>
            </div>
          </div>

          <div className="pt-12">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-xl shadow-primary/20" asChild>
              <Link href="/dashboard">Launch Monitoring Agent <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
