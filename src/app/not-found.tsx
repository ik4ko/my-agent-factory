import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '404 — Sector Not Found' };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      {/* Glitch number */}
      <div className="relative select-none mb-6">
        <span
          className="font-display text-[120px] font-black leading-none text-neon-green opacity-10 blur-sm absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          404
        </span>
        <span className="font-display text-[120px] font-black leading-none text-neon-green text-glow-green relative animate-glitch">
          404
        </span>
      </div>

      {/* Status line */}
      <p className="font-terminal text-xs uppercase tracking-[0.4em] text-neon-red/80 mb-2">
        ✗ Sector Not Found
      </p>
      <p className="font-terminal text-[11px] text-muted-foreground/50 max-w-xs mb-8">
        The requested route does not exist in the factory network. Signal lost.
      </p>

      {/* ASCII border box */}
      <pre className="font-terminal text-[10px] text-muted-foreground/20 mb-8 select-none">
        {`┌─────────────────────────┐\n│  ERR_ROUTE_NOT_FOUND    │\n│  CODE: 0x00000404       │\n└─────────────────────────┘`}
      </pre>

      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 font-terminal text-xs text-primary transition-colors hover:bg-primary/20 hover:border-primary/70 text-glow-green"
      >
        ⌂ Return to Control Room
      </Link>
    </div>
  );
}
