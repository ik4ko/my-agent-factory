'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Clock, PhoneCall } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRiskEvents, type RiskEvent } from '@/hooks/useRiskEvents';
import { useAppStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysFromNow(daysUntilEffective: number | null, createdAt: string): number {
  if (daysUntilEffective != null) return daysUntilEffective;
  // Fallback: treat as past if no days info
  return -1;
}

function effectiveDateLabel(daysUntilEffective: number | null, createdAt: string): string {
  if (daysUntilEffective == null) return '';
  const ms = new Date(createdAt).getTime() + daysUntilEffective * 86_400_000;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function nextAepDate(): string {
  const now = new Date();
  const year = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-01-01`;
}

// ---------------------------------------------------------------------------
// Single alert card
// ---------------------------------------------------------------------------

interface AlertCardProps {
  event: RiskEvent & { memberName?: string };
  isDemo?: boolean;
}

function AlertCard({ event, isDemo }: AlertCardProps) {
  const days = daysFromNow(event.days_until_effective, event.created_at);

  const urgency =
    days <= 0
      ? 'past'
      : days <= 14
      ? 'critical'
      : 'warning';

  const colorMap = {
    past:     { border: 'border-muted',           bg: 'bg-muted/30',           counter: 'text-muted-foreground', label: 'text-muted-foreground' },
    critical: { border: 'border-destructive/30',  bg: 'bg-destructive/5',      counter: 'text-destructive',      label: 'text-destructive'      },
    warning:  { border: 'border-amber-500/30',    bg: 'bg-amber-500/5',        counter: 'text-amber-500',        label: 'text-amber-600'        },
  }[urgency];

  const dateLabel = effectiveDateLabel(event.days_until_effective, event.created_at);

  return (
    <div className={`flex items-stretch rounded-3xl border ${colorMap.border} ${colorMap.bg} overflow-hidden`}>

      {/* Countdown column */}
      <div className={`flex flex-col items-center justify-center px-5 py-4 border-r ${colorMap.border} min-w-[90px] shrink-0`}>
        {days <= 0 ? (
          <>
            <span className={`text-[9px] font-black uppercase tracking-widest ${colorMap.label}`}>Effective</span>
            <AlertTriangle className={`w-8 h-8 mt-1 ${colorMap.counter}`} />
          </>
        ) : (
          <>
            <span className={`text-4xl font-black leading-none tracking-tighter tabular-nums ${colorMap.counter}`}>
              {days}
            </span>
            <span className={`text-[7px] font-black uppercase tracking-widest mt-1 text-center leading-tight ${colorMap.label}`}>
              Days<br />Until<br />Effective
            </span>
          </>
        )}
      </div>

      {/* Detail column */}
      <div className="flex-1 px-5 py-4 min-w-0 space-y-1.5">

        <div className="flex items-center gap-2 flex-wrap">
          {days > 0 && (
            <Badge className={`rounded-md text-[8px] font-black px-1.5 py-0 uppercase tracking-widest ${
              urgency === 'critical'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-amber-500 text-white'
            }`}>
              {urgency === 'critical' ? 'HIGH RISK' : 'WATCH'}
            </Badge>
          )}
          {isDemo && (
            <Badge variant="outline" className="rounded-md text-[7px] font-black px-1.5 py-0 uppercase tracking-widest opacity-50">
              Demo
            </Badge>
          )}
          {dateLabel && (
            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">
              {dateLabel}
            </span>
          )}
        </div>

        {/* Plan switch */}
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
          <span className="text-foreground">{event.previous_value ?? '--'}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className={urgency !== 'past' ? colorMap.counter : 'text-foreground'}>
            {event.new_value ?? '--'}
          </span>
        </div>

        {/* Member name or GHL contact ID */}
        {event.memberName ? (
          <p className="text-xs font-black uppercase tracking-tight text-foreground truncate">
            {event.memberName}
          </p>
        ) : (
          <p className="text-[9px] font-mono text-muted-foreground truncate opacity-60">
            ID: {event.ghl_contact_id}
          </p>
        )}

        {/* Trigger reason */}
        {event.trigger_reason && (
          <p className="text-[10px] text-muted-foreground leading-snug font-medium line-clamp-2">
            {event.trigger_reason}
          </p>
        )}
      </div>

      {/* CTA column */}
      <div className="flex flex-col items-center justify-center px-4 py-4 gap-2 shrink-0">
        <Button
          size="sm"
          className={`h-8 rounded-xl font-black uppercase text-[9px] tracking-widest shadow-sm ${
            urgency === 'critical'
              ? 'bg-destructive hover:bg-destructive/90 text-white shadow-destructive/20'
              : urgency === 'warning'
              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
              : ''
          }`}
          asChild
        >
          <Link href={`/clients/${event.ghl_contact_id}`}>
            <PhoneCall className="w-3 h-3 mr-1.5" />
            Contact
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-xl font-black uppercase text-[8px] tracking-widest text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link href={`/clients/${event.ghl_contact_id}`}>
            View
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AlertSkeleton() {
  return (
    <div className="flex items-stretch rounded-3xl border border-border bg-muted/10 overflow-hidden animate-pulse">
      <div className="w-[90px] shrink-0 border-r border-border bg-muted/20" />
      <div className="flex-1 px-5 py-4 space-y-2">
        <div className="h-3 w-24 bg-muted rounded-full" />
        <div className="h-4 w-40 bg-muted rounded-full" />
        <div className="h-3 w-56 bg-muted rounded-full" />
      </div>
      <div className="w-24 shrink-0 flex items-center justify-center px-4">
        <div className="h-8 w-16 bg-muted rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main feed
// ---------------------------------------------------------------------------

export function RiskAlertFeed() {
  const { agencyProfile, members } = useAppStore();
  const { events, loading } = useRiskEvents(agencyProfile.id ?? '');

  // Demo fallback: synthesise alerts from local Zustand members that have a
  // detected future contract, so the UI is populated without live data.
  const demoEvents = useMemo<(RiskEvent & { memberName?: string })[]>(() => {
    if (events.length > 0 || loading) return [];

    return members
      .filter((m) => !!m.futureContract)
      .slice(0, 3)
      .map((m) => ({
        id: `demo-${m.id}`,
        agency_id: 'demo',
        ghl_contact_id: m.id,
        memberName: m.fullName,
        event_type: 'plan_switch',
        risk_level: 'HIGH' as const,
        previous_value: m.carrier ?? 'Current Plan',
        new_value: m.futureContract!,
        days_until_effective: m.futureEffectiveDate
          ? Math.ceil((new Date(m.futureEffectiveDate).getTime() - Date.now()) / 86_400_000)
          : 90,
        trigger_reason:
          `Plan switch to ${m.futurePlanName ?? m.futureContract} detected. ` +
          `Call ${m.fullName} before the change takes effect.`,
        source: 'demo',
        created_at: new Date().toISOString(),
      }));
  }, [events.length, loading, members]);

  const alerts: (RiskEvent & { memberName?: string })[] =
    events.length > 0 ? events : demoEvents;

  const liveAlerts = alerts.filter((e) => daysFromNow(e.days_until_effective, e.created_at) > 0);
  const pastAlerts = alerts.filter((e) => daysFromNow(e.days_until_effective, e.created_at) <= 0);
  const isDemo     = events.length === 0 && demoEvents.length > 0;

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Loading Alerts...
          </span>
        </div>
        <AlertSkeleton />
        <AlertSkeleton />
      </section>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <section className="space-y-3">

      {/* Section header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-destructive" />
            Provisional Disenrollment Alerts
          </span>
        </div>
        {liveAlerts.length > 0 && (
          <Badge className="bg-destructive text-destructive-foreground rounded-md text-[8px] font-black px-1.5 py-0">
            {liveAlerts.length} Active
          </Badge>
        )}
        {isDemo && (
          <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground opacity-50 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Demo data
          </span>
        )}
      </div>

      {/* Live alerts */}
      {liveAlerts.length > 0 && (
        <div className="space-y-2.5">
          {liveAlerts.map((event) => (
            <AlertCard key={event.id} event={event} isDemo={isDemo} />
          ))}
        </div>
      )}

      {/* Past / already-effective alerts */}
      {pastAlerts.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none flex items-center gap-2 px-1 py-1 select-none">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              {pastAlerts.length} Already Effective &gt;
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            {pastAlerts.map((event) => (
              <AlertCard key={event.id} event={event} isDemo={isDemo} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
