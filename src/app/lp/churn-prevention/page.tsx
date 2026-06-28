
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ShieldAlert, Activity, ArrowRight, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export default function ChurnPreventionLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Module 1: Switch Detection
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            Stop the Bleed: Detect <span className="text-primary">Carrier Switches</span> Before They Finalize.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Losing members to "Switcher Agents" is a $600 problem. AegisSage polls MARx snapshots nightly to give you a 24-hour window to save your commissions.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left pt-8">
            {[
              { title: "Real-Time Alerts", desc: "SMS alerts when a disenrollment is pending on the CMS bridge." },
              { title: "24h Window", desc: "Act before the carrier update is locked into the enrollment file." },
              { title: "Commission Guard", desc: "Protect your annualized renewal revenue automatically." }
            ].map((feature, i) => (
              <div key={i} className="p-6 rounded-3xl bg-muted/30 border border-border space-y-3">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <h3 className="font-black uppercase tracking-tight text-sm">{feature.title}</h3>
                <p className="text-xs font-bold text-muted-foreground uppercase leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="lg" className="w-full sm:w-auto h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-2xl shadow-primary/20" asChild>
                  <Link href="/dashboard">
                    Start 14-Day Free Trial <ArrowRight className="w-5 h-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Full access to Module 1 included.</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
