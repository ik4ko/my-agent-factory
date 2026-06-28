
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Link2, RefreshCw, Database, ListFilter, ArrowRight } from "lucide-react"
import Link from "next/link"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

export default function GHLIntegrationLP() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
      <TooltipProvider delayDuration={0}>
        <div className="max-w-4xl w-full space-y-12 text-center">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px] rounded-full">
            CRM Synergy
          </Badge>
          
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            The Medicare Missing Piece for <span className="text-primary">GoHighLevel</span>.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground font-bold max-w-2xl mx-auto uppercase tracking-tight opacity-80 leading-snug">
            Stop manually updating spreadsheets. AegisSage maps Medicare MBIs, Carriers, and Plan Dates directly to your GHL Custom Fields with two-way sync.
          </p>

          <div className="rounded-[2.5rem] bg-card border border-border overflow-hidden shadow-2xl">
            <div className="bg-muted/30 p-6 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link2 className="w-5 h-5 text-primary" />
                <span className="text-xs font-black uppercase tracking-widest">Active GHL Bridge</span>
              </div>
              <Badge className="bg-emerald-50 text-emerald-700 border-none font-black text-[9px]">API v2.0</Badge>
            </div>
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <Database className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Field Mapping</span>
                </div>
                <p className="text-xs font-bold text-muted-foreground uppercase">Map MBIs to custom GHL keys instantly.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Auto-Workflows</span>
                </div>
                <p className="text-xs font-bold text-muted-foreground uppercase">Trigger GHL campaigns based on AegisSage retention scores.</p>
              </div>
            </div>
          </div>

          <div className="pt-8">
            <Button size="lg" className="h-16 px-10 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs gap-3 shadow-xl shadow-primary/20" asChild>
              <Link href="/dashboard">Connect your GHL Location <ArrowRight className="w-5 h-5" /></Link>
            </Button>
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}
