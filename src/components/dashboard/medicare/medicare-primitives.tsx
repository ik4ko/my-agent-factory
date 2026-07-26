import { cn } from '@/lib/utils';

export function MedicareMetric({ label, value, detail, tone = 'default' }: { label: string; value: string; detail: string; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <div className="rounded-md border border-border/60 bg-surface-2/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tracking-tight', tone === 'warning' && 'text-amber-300', tone === 'success' && 'text-emerald-300', tone === 'default' && 'text-foreground')}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground/80">{detail}</div>
    </div>
  );
}

export function MedicareStatus({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', tone === 'success' && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', tone === 'warning' && 'border-amber-400/30 bg-amber-400/10 text-amber-200', tone === 'danger' && 'border-rose-400/30 bg-rose-400/10 text-rose-200', tone === 'neutral' && 'border-border bg-surface-2 text-muted-foreground')}>{children}</span>;
}

export function MedicareEmpty({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">{message}</div>;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export function maskMbi(mbi: string | null) {
  if (!mbi) return 'Not recorded';
  const compact = mbi.replace(/\s+/g, '');
  return `••••••${compact.slice(-4)}`;
}
