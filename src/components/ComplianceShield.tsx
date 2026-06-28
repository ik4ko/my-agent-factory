"use client"

import { Shield, Lock, FileCheck } from "lucide-react"

const badges = [
  { icon: Shield,    text: "HIPAA Compliant"     },
  { icon: Lock,      text: "AES-256 Encryption"  },
  { icon: FileCheck, text: "BAA Available"        },
]

export function ComplianceShield() {
  return (
    <section className="py-10 px-8 border-y border-border/50 bg-muted/20">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-10 md:gap-20">
        {badges.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
              {text}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
