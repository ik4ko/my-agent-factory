"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

/**
 * Dashboard segment error boundary.
 *
 * Catches uncaught errors from any server component within /dashboard/**
 * including unexpected database errors, RLS-related query failures, and
 * network timeouts. Renders a recoverable state instead of the Next.js
 * generic crash page.
 *
 * Next.js passes `error` (the thrown value) and `reset` (re-runs the
 * failed server render) as props. The component must be a Client Component
 * so it can call `reset()` interactively.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to server/monitoring — digest is the Next.js server-side error ID
    console.error("[dashboard] segment error:", error.message, error.digest)
  }, [error])

  return (
    <div className="flex flex-col h-full w-full items-center justify-center bg-background p-8">
      <div className="max-w-sm w-full space-y-6 text-center">

        <div className="w-14 h-14 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>

        <div className="space-y-2">
          <h2 className="text-[13px] font-black uppercase tracking-widest text-foreground">
            Something went wrong
          </h2>
          <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
            An unexpected error occurred loading this page. Your data is safe —
            this is a temporary rendering failure.
          </p>
          {error.digest && (
            <p className="text-[9px] font-mono text-muted-foreground/50 mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={reset}
            className="w-full rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </Button>
          <Button
            variant="ghost"
            onClick={() => { window.location.href = "/dashboard" }}
            className="w-full rounded-xl font-black uppercase text-[10px] tracking-widest text-muted-foreground hover:text-foreground"
          >
            Return to Dashboard
          </Button>
        </div>

      </div>
    </div>
  )
}
