import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"

/**
 * Shared wrapper for all public marketing and legal pages.
 * Provides the sticky Logo header + back-to-home button. Any change to the
 * public nav (logo, branding, CTA) applies here and propagates automatically
 * to every page that renders this shell.
 *
 * Server component — no interactivity needed at the layout level.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-20 border-b border-border/50 px-8 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-50">
        <Link href="/" className="flex items-center gap-3">
          <Logo />
        </Link>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="rounded-xl font-black uppercase text-[10px] tracking-widest"
        >
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
        </Button>
      </header>
      {children}
    </div>
  )
}
