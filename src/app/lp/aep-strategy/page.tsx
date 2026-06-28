
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, Target, ShieldCheck, Zap, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function AEPStrategyLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            AEP Shield Active
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            AEP 2025: Your <span className="text-primary">Member Shield</span> Starts Now.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Don't let competitors harvest your book during the enrollment window. AegisSage's AEP Shield uses predictive churn models to identify and protect your most vulnerable members.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 text-left">
            <div className="p-6 rounded-3xl bg-card border border-border space-y-4">
              <Calendar className="w-6 h-6 text-primary" />
              <h3 className="text-sm font-black uppercase tracking-tight">September Prep</h3>
              <p className="text-[10px] font-bold text-muted-foreground leading-relaxed uppercase">Auto-generate LIS and Extra Help disclosures for dual-eligibles before the rush.</p>
            </div>
            <div className="p-6 rounded-3xl bg-card border border-border space-y-4">
              <Target className="w-6 h-6 text-primary" />
              <h3 className="text-sm font-black uppercase tracking-tight">Risk Isolation</h3>
              <p className="text-[10px] font-bold text-muted-foreground leading-relaxed uppercase">Isolate members in Zip Codes where competing carriers have dropped premiums.</p>
            </div>
            <div className="p-6 rounded-3xl bg-card border border-border space-y-4">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h3 className="text-sm font-black uppercase tracking-tight">POA Activation</h3>
              <p className="text-[10px] font-bold text-muted-foreground leading-relaxed uppercase">Invite family advocates to the member vault to deter third-party switchers.</p>
            </div>
          </div>

          <div className="pt-12">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-xl shadow-primary/20" asChild>
              <Link href="/dashboard">Secure your Book for AEP <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
