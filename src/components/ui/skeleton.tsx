import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-2 overflow-hidden relative',
        'before:absolute before:inset-0 before:bg-gradient-to-r',
        'before:from-transparent before:via-surface-3/60 before:to-transparent',
        'before:animate-shimmer before:bg-[length:200%_100%]',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
