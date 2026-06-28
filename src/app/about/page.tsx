
"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ShieldCheck, Zap, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/logo"

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/10">
      <header className="h-20 border-b border-border/50 px-8 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-50">
        <Link href="/" className="flex items-center gap-3">
          <Logo />
        </Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Home</Link>
        </Button>
      </header>

      <main className="max-w-4xl mx-auto py-24 px-8 space-y-16">
        <div className="space-y-6">
          <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 font-black uppercase tracking-widest text-[10px]">The AegisSage Mission</Badge>
          <h1 className="text-5xl md:text-6xl font-black tracking-tighter uppercase leading-[0.9]">
            Protecting the <span className="text-primary">Relationship</span> Between Agent and Member.
          </h1>
          <p className="text-xl text-muted-foreground font-bold leading-relaxed uppercase tracking-tight opacity-80">
            Medicare retention is not just about data--it's about protecting the clinical integrity of a member's coverage and the hard-earned trust of an independent agency.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight">Enterprise Standard</h3>
            <p className="text-sm font-bold text-muted-foreground leading-relaxed uppercase opacity-70">
              We build tools that meet the rigorous security requirements of the Medicare market. Every line of code is written with HIPAA and BAA compliance at its core.
            </p>
          </div>
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight">Autonomous Ops</h3>
            <p className="text-sm font-bold text-muted-foreground leading-relaxed uppercase opacity-70">
              By automating switch detection and chronic care faxes, we free up brokers to do what they do best: provide human-centric healthcare advice.
            </p>
          </div>
        </div>

        <div className="p-12 rounded-[3rem] bg-muted/30 border border-border space-y-8">
          <h2 className="text-3xl font-black uppercase tracking-tighter text-center">Our Commitment</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-primary">100%</div>
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">BAA Compliant</p>
            </div>
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-primary">24/7</div>
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">MARx Monitoring</p>
            </div>
            <div className="text-center space-y-2">
              <div className="text-4xl font-black text-primary">99.9%</div>
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Uptime SLA</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-20 border-t border-border/50 text-center">
        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">© 2025 AegisSage Intelligence Inc.</p>
      </footer>
    </div>
  )
}
