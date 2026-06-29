import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
  {
    variants: {
      variant: {
        default:    'bg-primary/15 text-primary border border-primary/20',
        secondary:  'bg-surface-2 text-muted-foreground border border-border',
        destructive:'bg-destructive/15 text-destructive border border-destructive/20',
        outline:    'border border-border text-foreground',
        success:    'bg-neon-green/10 text-neon-green border border-neon-green/20',
        warning:    'bg-warning/15 text-warning border border-warning/20',
        cyan:       'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20',
        purple:     'bg-neon-purple/10 text-neon-purple border border-neon-purple/20',
        error:      'bg-neon-red/10 text-neon-red border border-neon-red/20',
        muted:      'bg-surface-2 text-muted-foreground border border-border/50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
