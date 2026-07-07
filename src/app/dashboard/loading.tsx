import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 p-4', className)}>
      {/* Panel header */}
      <div className="flex items-center gap-2 shrink-0">
        <Skeleton className="size-3.5 rounded-sm" />
        <Skeleton className="h-2 w-20" />
        <Skeleton className="ml-auto h-2 w-8" />
      </div>
      {/* Rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-border/50 bg-surface-1/40 px-3 py-2.5">
          <Skeleton className="size-6 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2 w-2/3" />
            <Skeleton className="h-2 w-1/2" />
          </div>
          <Skeleton className="h-4 w-12 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      {/* TopBar skeleton */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-3 w-28" />
        <div className="ml-auto flex items-center gap-3">
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-6 w-6 rounded" />
        </div>
      </div>

      {/* Stats bar skeleton */}
      <div className="flex shrink-0 items-center gap-6 border-b border-border px-4 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-2 w-10" />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
        <div className="ml-auto">
          <Skeleton className="h-1 w-40 rounded-full" />
        </div>
      </div>

      {/* Panel grid */}
      <div className="flex-1 grid grid-rows-2 overflow-hidden">
        {/* Top row */}
        <div className="grid grid-cols-2 border-b border-border overflow-hidden">
          <PanelSkeleton className="border-r border-border" />
          <PanelSkeleton />
        </div>
        {/* Bottom row */}
        <div className="grid grid-cols-2 overflow-hidden">
          <PanelSkeleton className="border-r border-border" />
          <PanelSkeleton />
        </div>
      </div>

      {/* Hermes input skeleton */}
      <div className="shrink-0 border-t border-border px-4 py-3">
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    </div>
  );
}
