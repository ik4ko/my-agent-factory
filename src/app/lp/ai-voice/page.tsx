
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Sparkles, PhoneCall, BrainCircuit, Headphones, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function AIVoiceLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-accent/10 text-accent border-accent/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            Module 2: Maya AI
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            Scale Your Agency with <span className="text-accent">Maya</span>: 24/7 AI Member Check-ins.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Autonomous voice check-ins at Day 7, 30, and 75. Identify dissatisfaction early and escalate high-risk cases to your brokers in real-time.
          </p>

          <div className="p-10 rounded-[3rem] bg-card border border-border shadow-inner relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Headphones className="w-32 h-32 text-primary" />
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent animate-pulse">
                <PhoneCall className="w-6 h-6" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase text-accent tracking-widest leading-none">Live Script Preview</p>
                <p className="text-sm font-bold italic text-muted-foreground">"Hi Mr. Miller, this is Maya from the agency..."</p>
              </div>
            </div>
            <p className="text-xs font-bold text-muted-foreground text-left uppercase leading-relaxed opacity-70">
              Maya detects tone, sentiment, and specific churn keywords (e.g., "my doctor left", "premium is too high") and tags your GHL contact instantly.
            </p>
          </div>

          <div className="pt-8">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-accent hover:bg-accent/90 text-white font-black uppercase tracking-widest text-xs gap-3" asChild>
              <Link href="/dashboard">Launch AI Agent <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
