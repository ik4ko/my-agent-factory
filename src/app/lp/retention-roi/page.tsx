"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Banknote, TrendingUp, BarChart3, PieChart, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function RetentionROILP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Economic Analysis
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            A <span className="text-primary">$600 Problem</span>: The Real Cost of Member Churn.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Each disenrolled Medicare member represents a loss of $600 in annualized commission. For an agency with 1,000 members, a 10% churn rate costs $60,000 every single year.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-8">
            <div className="p-6 rounded-3xl bg-primary/5 border border-primary/10 text-center">
              <p className="text-[10px] font-black uppercase text-primary tracking-widest">Avg Commission</p>
              <div className="text-2xl font-black text-foreground">$600</div>
            </div>
            <div className="p-6 rounded-3xl bg-card border border-border text-center">
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Renewal Life</p>
              <div className="text-2xl font-black text-foreground">7+ Years</div>
            </div>
            <div className="p-6 rounded-3xl bg-card border border-border text-center">
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">LTV at Risk</p>
              <div className="text-2xl font-black text-foreground">$4,200</div>
            </div>
            <div className="p-6 rounded-3xl bg-destructive/5 border border-destructive/10 text-center">
              <p className="text-[10px] font-black uppercase text-destructive tracking-widest">Churn Impact</p>
              <div className="text-2xl font-black text-destructive">-15% / Yr</div>
            </div>
          </div>

          <div className="p-8 rounded-[2.5rem] bg-slate-900 text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl mt-8">
            <div className="text-left space-y-2">
              <h3 className="text-xl font-black uppercase tracking-tighter text-emerald-400 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" /> ROI: 1,200%
              </h3>
              <p className="text-xs font-medium text-slate-400 leading-relaxed uppercase">At $99/mo, preventing just TWO disenrollments pays for your entire year of AegisSage instantly.</p>
            </div>
            <Button size="lg" className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/20" asChild>
              <Link href="/dashboard">Maximize Agency ROI</Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
