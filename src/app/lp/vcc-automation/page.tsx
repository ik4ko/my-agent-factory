
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Heart, Stethoscope, Printer, FileText, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function VCCAutomationLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-red-500/10 text-red-600 border-red-500/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Module 3: Chronic Care
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            Activate Chronic Benefits <span className="text-primary">Instantly</span>.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Members with supplemental benefits stay 40% longer. AegisSage automates the VCC verification process, ensuring your chronic care members get the food, utility, and pest control benefits they deserve.
          </p>

          <div className="p-10 rounded-[3rem] bg-card border border-border shadow-xl text-left space-y-8 relative overflow-hidden group">
            <div className="absolute bottom-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Stethoscope className="w-48 h-48 text-primary" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
              <div className="space-y-4">
                <Badge variant="outline" className="text-[9px] uppercase font-black tracking-widest border-primary/20 text-primary">Benefits Gap Scan</Badge>
                <h3 className="text-2xl font-black uppercase tracking-tighter">Detected vs. Activated</h3>
                <p className="text-xs font-bold text-muted-foreground uppercase leading-relaxed">We scan your roster for diabetes, hypertension, and heart conditions, matching them to available supplemental benefits.</p>
              </div>
              <div className="space-y-4">
                <Badge variant="outline" className="text-[9px] uppercase font-black tracking-widest border-primary/20 text-primary">Autonomous Faxing</Badge>
                <h3 className="text-2xl font-black uppercase tracking-tighter">PCP Bridge</h3>
                <p className="text-xs font-bold text-muted-foreground uppercase leading-relaxed">One-click faxing to physician offices via SageStream to confirm clinical status.</p>
              </div>
            </div>
          </div>

          <div className="pt-8">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-xl shadow-primary/20" asChild>
              <Link href="/dashboard">Scan for Supplemental Gaps <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
