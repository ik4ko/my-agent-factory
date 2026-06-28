
"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Users2, Briefcase, Globe, ShieldAlert, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function AgencyScaleLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Enterprise Solutions
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            From 100 to 10,000 Members: <span className="text-primary">Retention</span> that Scales.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Managing a large book of business shouldn't be a manual nightmare. AegisSage's agency management tools provide automated commission splits, NPN tracking, and hierarchy-based compliance.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8">
            <div className="p-8 rounded-[2.5rem] bg-card border border-border text-left space-y-4 hover:border-primary/30 transition-all group">
              <Users2 className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-black uppercase tracking-tighter">Broker Hierarchy</h3>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed uppercase">Assign members to specific brokers and track retention scores by individual producer or regional team.</p>
            </div>
            <div className="p-8 rounded-[2.5rem] bg-card border border-border text-left space-y-4 hover:border-primary/30 transition-all group">
              <Briefcase className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-black uppercase tracking-tighter">Split Tracking</h3>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed uppercase">Automated accounting for agency/broker commission splits based on customized retention logic.</p>
            </div>
          </div>

          <div className="pt-12">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-xl shadow-primary/20" asChild>
              <Link href="/dashboard">Scale your Agency <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
