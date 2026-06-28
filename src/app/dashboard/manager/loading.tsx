/**
 * Streaming loading skeleton for /dashboard/manager.
 * Next.js renders this file automatically while the server component
 * data-fetches, so principals see a structured placeholder rather than
 * a blank screen or spinner during heavy DB queries.
 */
export default function ManagerLoading() {
  return (
    <div className="flex h-full w-full bg-background">
      {/* Sidebar placeholder */}
      <div className="w-64 shrink-0 border-r border-border hidden md:block" />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header skeleton */}
        <div className="h-16 border-b border-border px-8 flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-muted animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-4 w-36 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-48 rounded bg-muted/60 animate-pulse" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 max-w-6xl mx-auto w-full space-y-8">

          {/* Metric cards row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-muted animate-pulse shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-6 w-16 rounded bg-muted animate-pulse" />
                  <div className="h-2.5 w-32 rounded bg-muted/60 animate-pulse" />
                </div>
              </div>
            ))}
          </div>

          {/* Revenue at risk card */}
          <div className="rounded-3xl border border-border p-8 flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-muted animate-pulse shrink-0" />
            <div className="space-y-3 flex-1">
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
              <div className="h-10 w-48 rounded bg-muted animate-pulse" />
              <div className="h-3 w-64 rounded bg-muted/60 animate-pulse" />
            </div>
          </div>

          {/* Table skeleton — 3 placeholder rows */}
          <div className="rounded-3xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/30">
              <div className="h-4 w-52 rounded bg-muted animate-pulse" />
            </div>
            <div className="divide-y divide-border/50">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="px-6 py-4 flex items-center gap-4">
                  <div className="h-4 w-36 rounded bg-muted animate-pulse" />
                  <div className="h-4 w-20 rounded bg-muted/60 animate-pulse" />
                  <div className="ml-auto h-4 w-14 rounded bg-muted/60 animate-pulse" />
                  <div className="h-4 w-12 rounded bg-muted/60 animate-pulse" />
                  <div className="h-4 w-12 rounded bg-muted/60 animate-pulse" />
                  <div className="h-4 w-16 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
