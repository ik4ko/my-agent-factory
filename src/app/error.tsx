'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[FACTORY ERROR]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center font-sans antialiased">
        {/* Error header */}
        <p className="font-terminal text-[10px] uppercase tracking-[0.4em] text-neon-red/80 mb-4">
          ✗ System Failure
        </p>
        <h1 className="font-display text-3xl font-black text-foreground mb-2">
          Unhandled Exception
        </h1>
        <p className="font-terminal text-xs text-muted-foreground/50 max-w-sm mb-6">
          {error.message || 'An unexpected error occurred in the agent factory.'}
        </p>

        {error.digest && (
          <p className="font-terminal text-[10px] text-muted-foreground/25 mb-6">
            digest: {error.digest}
          </p>
        )}

        {/* ASCII-style error box */}
        <pre className="font-terminal text-[10px] text-neon-red/20 mb-8 select-none">
          {`┌──────────────────────────────┐\n│  STATUS: UNRECOVERABLE       │\n│  CORE: EXCEPTION_THROWN      │\n│  ACTION: RESTART_REQUIRED    │\n└──────────────────────────────┘`}
        </pre>

        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 font-terminal text-xs text-primary transition-colors hover:bg-primary/20 hover:border-primary/70"
        >
          ↺ Restart System
        </button>
      </body>
    </html>
  );
}
