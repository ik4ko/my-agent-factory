"use client"

import { useAppStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, ArrowRight, X, CheckCircle2, ShieldCheck, Zap, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"

const TUTORIALS = {
  enrollment: [
    {
      title: "Welcome to Enrollment Academy",
      desc: "Medicare enrollment is about precision. One wrong MBI (Medicare ID) can break your commission cycle. Let's learn the AegisSage way.",
      icon: UserPlus,
    },
    {
      title: "Tip 1: Use Biometric OCR",
      desc: "Never type an MBI manually. Use the 'Biometric Capture' button to scan the member's card. It has a 99.9% accuracy rate compared to human entry.",
      icon: Sparkles,
    },
    {
      title: "Tip 2: HIPAA Compliance",
      desc: "Zero-knowledge encryption is active. Sensitive data is hashed locally before cloud sync. You are always in control of your member's PHI.",
      icon: ShieldCheck,
    },
    {
      title: "Final Step: Nightly Sync",
      desc: "Once enrolled, members are automatically placed in the MARx Nightly Poll. If they switch carriers, you'll know within 24 hours.",
      icon: Zap,
    }
  ],
  retention: [
    {
      title: "The Retention Playbook",
      desc: "Retention isn't a defensive task--it's offensive. We protect your $600/yr commission per member through autonomous monitoring.",
      icon: ShieldCheck,
    },
    {
      title: "Action 1: Switch Alerts",
      desc: "When Module 1 detects a switch, you have a 24-hour window. Immediately use the 'Emergency Outreach' button in the Member Intel panel.",
      icon: Zap,
    },
    {
      title: "Action 2: Chronic Care Benefits",
      desc: "Members with benefits stay 40% longer. Use Module 3 to fax PCP offices via SageStream and activate food/utility benefits instantly.",
      icon: CheckCircle2,
    },
    {
      title: "Action 3: GHL CRM Bridge",
      desc: "Sync your retention scores back to GoHighLevel to trigger automated 'Stay in Touch' campaigns via SMS and Email.",
      icon: ArrowRight,
    }
  ]
}

export function TutorialOverlay() {
  const { activeTutorial, tutorialStep, nextTutorialStep, closeTutorial } = useAppStore()

  if (activeTutorial === 'none') return null

  const steps = TUTORIALS[activeTutorial]
  const currentStep = steps[tutorialStep]
  const isLast = tutorialStep === steps.length - 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-6">
      <Card className="max-w-md w-full rounded-[2.5rem] shadow-2xl border-primary/20 overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="bg-primary p-8 text-white flex flex-col items-center justify-center space-y-4 text-center">
          <div className="w-16 h-16 rounded-3xl bg-white/20 flex items-center justify-center backdrop-blur-md">
            <currentStep.icon className="w-8 h-8" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Step {tutorialStep + 1} of {steps.length}</p>
            <h2 className="text-xl font-black uppercase tracking-tight">{currentStep.title}</h2>
          </div>
        </div>
        
        <CardContent className="p-8">
          <p className="text-sm font-medium text-muted-foreground leading-relaxed text-center">
            {currentStep.desc}
          </p>
        </CardContent>

        <CardFooter className="p-8 pt-0 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-2xl h-12 font-black uppercase text-[10px]" onClick={closeTutorial}>
            <X className="w-4 h-4 mr-2" /> Skip
          </Button>
          <Button className="flex-1 rounded-2xl h-12 bg-primary hover:bg-primary/90 text-white font-black uppercase text-[10px]" onClick={isLast ? closeTutorial : nextTutorialStep}>
            {isLast ? "Mastered" : "Next Step"} <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
