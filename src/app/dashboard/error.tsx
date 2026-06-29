'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DASHBOARD ERROR]', error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex items-center gap-2 mb-2">
        <div className="size-2 rounded-full bg-neon-red animate-pulse" />
        <span className="font-terminal text-[10px] uppercase tracking-[0.4em] text-neon-red/80">
          Dashboard Error
        </span>
      </div>

      <p className="font-terminal text-xs text-muted-foreground/60 max-w-sm">
        {error.message || 'The control room encountered an unexpected error.'}
      </p>

      {error.digest && (
        <p className="font-terminal text-[9px] text-muted-foreground/20">
          ref: {error.digest}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 font-terminal text-xs text-primary transition-colors hover:bg-primary/20"
        >
          ↺ Retry
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 font-terminal text-xs text-muted-foreground transition-colors hover:border-muted-foreground/40"
        >
          ← Home
        </Link>
      </div>
    </div>
  );
}
