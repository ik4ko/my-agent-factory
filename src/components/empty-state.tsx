import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}

export function EmptyState({ icon: Icon, title, description, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5 text-center px-6">
      <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
        <Icon className="w-10 h-10 text-muted-foreground" />
      </div>
      <div>
        <p className="text-lg font-black uppercase tracking-tight">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      </div>
      {actionLabel && actionHref && (
        <Button asChild className="h-11 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-[10px]">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  )
}
