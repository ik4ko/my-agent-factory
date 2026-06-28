'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Upload, Link2, RefreshCw, CheckCircle2, AlertCircle,
  FileSpreadsheet, X, ArrowRight, Database, Zap,
  FileText, ExternalLink, ChevronRight, Shield, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncState = 'idle' | 'uploading' | 'syncing' | 'success' | 'error';

type ImportResult = {
  imported:     number
  dropped:      number
  duplicates:   number
  mbiCount:     number
  planCount:    number
  carrierCount: number
  skipped?:     Array<{ name: string; reason: string; row: number }>
}

// ── Column detection — mirrors server-side ALIAS_MAP ─────────────────────────

const PREVIEW_ALIAS_MAP: Record<string, string[]> = {
  mbi: [
    'mbi', 'medicare id', 'medicare number', 'medicare beneficiary identifier',
    'medicare beneficiary id', 'claim no', 'claim number', 'member id',
    'subscriber id', 'beneficiary id', 'hic number', 'hicn',
    'medicare #', 'medicare no', 'medicaid id', 'insurance id',
    'id number', 'policy number', 'policy #', 'policy no',
    'beneficiary identifier', 'medicare identifier',
  ],
  full_name: [
    'name', 'full name', 'fullname', 'client name', 'beneficiary',
    'member name', 'patient name', 'insured name', 'policyholder',
    'member', 'insured', 'subscriber name', 'subscriber',
    'client', 'consumer name', 'participant name',
  ],
  first_name: [
    'first name', 'firstname', 'first', 'fname', 'given name',
    'given', 'first_name', 'f name', 'member first name',
    'beneficiary first name', 'patient first name',
  ],
  last_name: [
    'last name', 'lastname', 'last', 'lname', 'surname',
    'family name', 'last_name', 'l name', 'member last name',
    'beneficiary last name', 'patient last name',
  ],
  plan_code: [
    'plan', 'plan name', 'plan code', 'plan id', 'planid', 'plan_id',
    'contract', 'contract id', 'contract number', 'pbp',
    'benefit package', 'product', 'product code', 'coverage',
    'insurance plan', 'health plan', 'plan type', 'program',
    'sunfire', 'carrier plan', 'plan description', 'plan title',
    'current plan', 'enrolled plan', 'insurance product',
  ],
  carrier: [
    'carrier', 'insurance company', 'insurer', 'company',
    'insurance carrier', 'health plan', 'payer', 'payer name',
    'insurance', 'provider', 'insurance provider', 'plan sponsor',
  ],
};

const FIELD_LABELS: Record<string, string> = {
  mbi:        'MBI',
  full_name:  'Name',
  first_name: 'First Name',
  last_name:  'Last Name',
  plan_code:  'Plan',
  carrier:    'Carrier',
};

interface PreviewState {
  detectedColumns: Record<string, string>;
  sampleRows:      Array<{ name: string; mbi: string; plan: string }>;
  totalRows:       number;
  isXlsx:          boolean;
}

// ── CSV preview builder ───────────────────────────────────────────────────────

function resolvePreviewHeader(h: string): string | null {
  const normalized = h.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(PREVIEW_ALIAS_MAP)) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

async function buildPreview(f: File): Promise<PreviewState | null> {
  const isXlsx = /\.(xlsx|xls)$/i.test(f.name);
  if (isXlsx) {
    return { detectedColumns: {}, sampleRows: [], totalRows: 0, isXlsx: true };
  }

  let text: string;
  try { text = await f.text(); }
  catch { return null; }

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let inQuote = false;
    let cell = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cells.push(cell.trim()); cell = ''; }
      else { cell += ch; }
    }
    cells.push(cell.trim());
    return cells;
  }

  const headers  = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const dataRows = lines.slice(1, 4).map(parseLine);

  const colMap:          Record<string, number> = {};
  const detectedColumns: Record<string, string> = {};

  headers.forEach((h, i) => {
    const field = resolvePreviewHeader(h);
    if (field && !(field in colMap)) {
      colMap[field] = i;
      detectedColumns[field] = h;
    }
  });

  const sampleRows = dataRows.map(row => {
    let name = colMap['full_name'] !== undefined ? (row[colMap['full_name']] ?? '') : '';
    if (!name) {
      const first = colMap['first_name'] !== undefined ? (row[colMap['first_name']] ?? '') : '';
      const last  = colMap['last_name']  !== undefined ? (row[colMap['last_name']]  ?? '') : '';
      name = `${first} ${last}`.trim();
    }
    return {
      name,
      mbi:  colMap['mbi']       !== undefined ? (row[colMap['mbi']]       ?? '') : '',
      plan: colMap['plan_code'] !== undefined ? (row[colMap['plan_code']] ?? '') : '',
    };
  });

  return { detectedColumns, sampleRows, totalRows: lines.length - 1, isXlsx: false };
}

const MARX_PORTAL_URL =
  'https://portal.cms.gov/mma/servlet/mmcs.beneficiaries.eligibility.BeneEligibilityDisplayServlet';

// ── Stat pill used in the quality report ────────────────────────────────────

function StatPill({
  label, value, total,
}: {
  label: string; value: number; total: number;
}) {
  const pct     = total > 0 ? Math.round((value / total) * 100) : 0;
  const perfect = value === total;
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className={cn(
          'text-[10px] font-black tabular-nums',
          perfect ? 'text-emerald-400' : 'text-amber-400'
        )}>
          {value}/{total}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700',
            perfect ? 'bg-emerald-500' : 'bg-amber-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChurnUploadPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { toast }    = useToast();
  const supabase     = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file,          setFile]          = useState<File | null>(null);
  const [sheetsUrl,     setSheetsUrl]     = useState('');
  const [isDragging,    setIsDragging]    = useState(false);
  const [syncState,     setSyncState]     = useState<SyncState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [ghlConnected,  setGhlConnected]  = useState<boolean | null>(null);
  const [ghlSyncing,    setGhlSyncing]    = useState(false);
  const [ghlBanner,     setGhlBanner]     = useState<'success' | 'error' | null>(null);
  const [preview,       setPreview]       = useState<PreviewState | null>(null);
  const [importResult,  setImportResult]  = useState<ImportResult | null>(null);
  const [marxOpened,    setMarxOpened]    = useState(false);
  const [skippedOpen,   setSkippedOpen]   = useState(false);
  const [hipaaCertified, setHipaaCertified] = useState(false);
  const [showHipaaModal, setShowHipaaModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'ghl_sync' | 'csv_upload' | 'sheets_import' | null>(null);

  // ── Check GHL connection ──────────────────────────────────────────────────
  // Selects access_token AND expires_at so an expired-but-present token is
  // treated as disconnected, showing the Connect button rather than the
  // stale "Live" badge. RLS (credentials_owner_only) scopes to the caller's
  // agency automatically, so no explicit agency_id filter is needed.
  useEffect(() => {
    supabase
      .from('agency_credentials')
      .select('access_token, expires_at, location_id')
      .maybeSingle()
      .then(({ data }) => {
        const hasToken  = !!data?.access_token
        const notExpired = data?.expires_at
          ? new Date(data.expires_at) > new Date()
          : false
        const isLive = hasToken && notExpired
        console.log('[ghl] credential check:', {
          hasToken,
          notExpired,
          isLive,
          locationId: data?.location_id ?? null,
        })
        setGhlConnected(isLive)
      });
  }, []);

  // ── Handle OAuth callback return ──────────────────────────────────────────
  // Two paths:
  //   A. Popup flow — this page loaded inside the OAuth popup window.
  //      Notify the parent tab via postMessage then self-close. The parent's
  //      message handler (wired in handleGhlConnect) takes over from there.
  //   B. Direct-navigation fallback — no popup (e.g. popup was blocked).
  //      Handle the success/error state inline, same as before.
  useEffect(() => {
    const ghlParam = searchParams?.get('ghl');
    if (!ghlParam) return;

    const isPopup = typeof window !== 'undefined' && !!window.opener && !window.opener.closed;

    if (ghlParam === 'connected') {
      if (isPopup) {
        // Path A — relay to parent then close popup
        try { window.opener.postMessage({ type: 'GHL_OAUTH_SUCCESS' }, window.location.origin); } catch {}
        window.close();
        return;
      }
      // Path B — direct navigation
      setGhlConnected(true);
      setGhlBanner('success');
      setGhlSyncing(true);
      fetch('/api/ghl/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, maxPages: 20 }),
      })
        .then(r => r.json())
        .then(json => {
          setGhlSyncing(false);
          if (json.synced > 0) {
            setStatusMessage(
              `GHL import complete — ${json.synced.toLocaleString()} contacts added to your Book of Business.`
            );
          }
        })
        .catch(() => setGhlSyncing(false));
      router.replace('/dashboard/churn/upload', { scroll: false });

    } else if (ghlParam === 'error') {
      if (isPopup) {
        try { window.opener.postMessage({ type: 'GHL_OAUTH_ERROR' }, window.location.origin); } catch {}
        window.close();
        return;
      }
      setGhlBanner('error');
      router.replace('/dashboard/churn/upload', { scroll: false });
    }
  }, [searchParams]);

  // ── File handlers ─────────────────────────────────────────────────────────
  async function handleFileSelected(f: File) {
    setFile(f);
    setPreview(null);
    setSyncState('idle');
    setImportResult(null);
    const p = await buildPreview(f);
    setPreview(p);
  }

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true);  }, []);
  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelected(dropped);
  }, []);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelected(f);
  };

  // ── GHL handlers ──────────────────────────────────────────────────────────
  const handleGhlConnect = () => {
    // Pre-flight notice: GHL requires the user to already be logged in inside
    // the popup. Without this prompt, users are confused by the login screen
    // that appears instead of the OAuth consent page.
    toast({
      title:       'GoHighLevel Login Required',
      description: 'Sign into your GHL account in the popup, then select your sub-account location.',
      duration:    7000,
    });

    // Open the OAuth flow in a centred popup so the parent dashboard tab
    // stays fully undisturbed. After the OAuth dance completes the callback
    // route returns an inline HTML page that posts GHL_OAUTH_SUCCESS to the
    // parent and self-closes — no full Next.js page load required.
    const W    = 640;
    const H    = 720;
    const left = Math.round(window.screen.width  / 2 - W / 2);
    const top  = Math.round(window.screen.height / 2 - H / 2);
    const popup = window.open(
      '/api/ghl/connect',
      'ghl_oauth',
      `width=${W},height=${H},left=${left},top=${top},scrollbars=yes,resizable=yes,popup=1`
    );

    if (!popup) {
      // Popup was blocked by the browser — fall back to same-tab navigation
      window.location.href = '/api/ghl/connect';
      return;
    }

    // ── Closed-window detector ────────────────────────────────────────────────
    // Polls every 500 ms to detect manual popup closure. Without this, the
    // message listener persists indefinitely and the button never re-enables
    // after the user closes the OAuth window without completing the flow.
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleOAuthMessage);
        // Only reset to idle if the connection did not already succeed
        setGhlConnected(prev => {
          if (!prev) setGhlBanner('error');
          return prev;
        });
        setGhlSyncing(false);
      }
    }, 500);

    // ── OAuth message listener ────────────────────────────────────────────────
    function handleOAuthMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;

      if (e.data?.type === 'GHL_OAUTH_SUCCESS') {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleOAuthMessage);
        popup?.close();
        setGhlConnected(true);
        setGhlBanner('success');
        router.refresh(); // re-fetch server state so credential check reflects live DB
        setGhlSyncing(true);
        fetch('/api/ghl/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true, maxPages: 20 }),
        })
          .then(r => r.json())
          .then(json => {
            setGhlSyncing(false);
            if (json.synced > 0) {
              setStatusMessage(
                `GHL import complete — ${json.synced.toLocaleString()} contacts added to your Book of Business.`
              );
            }
          })
          .catch(() => setGhlSyncing(false));
      }

      if (e.data?.type === 'GHL_OAUTH_ERROR') {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleOAuthMessage);
        popup?.close();
        setGhlBanner('error');
      }
    }
    window.addEventListener('message', handleOAuthMessage);
  };

  const handleGhlSync = async () => {
    if (!ghlConnected) { handleGhlConnect(); return; }
    // Show HIPAA certification modal before sync
    setPendingAction('ghl_sync');
    setShowHipaaModal(true);
  };

  const executeGhlSync = async () => {
    setGhlSyncing(true);
    setStatusMessage('');
    try {
      const res  = await fetch('/api/ghl/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 20 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      setGhlSyncing(false);
      setStatusMessage(`GHL sync complete — ${json.synced ?? 0} contacts updated.`);
    } catch (err: unknown) {
      setGhlSyncing(false);
      setStatusMessage(err instanceof Error ? err.message : 'GHL sync failed.');
    }
  };

  // ── Form submit (CSV or Sheets) ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file && !sheetsUrl.trim()) {
      setStatusMessage('Please drop a file or paste a Google Sheets URL.');
      return;
    }
    // Show HIPAA certification modal before import
    setPendingAction(file ? 'csv_upload' : 'sheets_import');
    setShowHipaaModal(true);
  };

  const executeImport = async () => {
    setSyncState('uploading');
    setStatusMessage('');
    setPreview(null);
    setImportResult(null);
    setMarxOpened(false);

    try {
      if (sheetsUrl.trim()) {
        const res  = await fetch('/api/roster/sheets-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetsUrl: sheetsUrl.trim() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Sheets import failed');
        setSyncState('success');
        setSkippedOpen(false);
        setImportResult({
          imported: json.imported ?? 0, dropped: json.dropped ?? 0,
          duplicates: json.duplicates ?? 0,
          mbiCount: json.mbiCount ?? (json.imported ?? 0),
          planCount: json.planCount ?? 0, carrierCount: json.carrierCount ?? 0,
          skipped: json.skipped,
        });
      } else if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const res  = await fetch('/api/roster/upload', { method: 'POST', body: formData });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Upload failed');
        setSyncState('success');
        setSkippedOpen(false);
        setImportResult({
          imported: json.imported ?? 0, dropped: json.dropped ?? 0,
          duplicates: json.duplicates ?? 0,
          mbiCount: json.mbiCount ?? (json.imported ?? 0),
          planCount: json.planCount ?? 0, carrierCount: json.carrierCount ?? 0,
          skipped: json.skipped,
        });
      }
    } catch (err: unknown) {
      setSyncState('error');
      setStatusMessage(err instanceof Error ? err.message : 'An error occurred.');
    }
  };

  const handleHipaaConfirm = () => {
    setShowHipaaModal(false);
    if (pendingAction === 'ghl_sync') {
      executeGhlSync();
    } else if (pendingAction === 'csv_upload' || pendingAction === 'sheets_import') {
      executeImport();
    }
    setPendingAction(null);
  };

  const handleHipaaCancel = () => {
    setShowHipaaModal(false);
    setPendingAction(null);
  };

  const isLoading = syncState === 'uploading' || syncState === 'syncing';

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full bg-background">

      {/* ── HIPAA Certification Modal ─────────────────────────────────────── */}
      {showHipaaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background rounded-3xl border border-border shadow-2xl max-w-md w-full p-6 space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <Shield className="w-6 h-6 text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-black uppercase tracking-tight text-foreground">
                  HIPAA Compliance Certification
                </h3>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  Before importing member data, you must certify compliance with HIPAA regulations.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={hipaaCertified}
                  onChange={e => setHipaaCertified(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary focus:ring-offset-0"
                />
                <span className="text-[11px] text-foreground leading-relaxed">
                  I certify that this data source is HIPAA-compliant and that I possess the necessary authorization/BAAs to transmit this PHI to AegisSage.
                </span>
              </label>

              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-500/90 font-medium leading-relaxed">
                  Unauthorized transmission of PHI may violate HIPAA §164.312(e) and result in civil penalties up to $1.5 million per violation.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleHipaaCancel}
                className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest"
              >
                Cancel
              </Button>
              <Button
                onClick={handleHipaaConfirm}
                disabled={!hipaaCertified}
                className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-2"
              >
                <Shield className="w-3.5 h-3.5" />
                Confirm & Proceed
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky page header ─────────────────────────────────────────────── */}
      <header className="h-16 border-b border-border px-6 md:px-8 flex items-center justify-between bg-background/80 backdrop-blur-md sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-black uppercase tracking-tight text-foreground leading-none">
              Import Data
            </h1>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">
              GHL · Google Sheets · CSV roster
            </p>
          </div>
        </div>

        {/* Template download — always visible in header */}
        <a
          href="/api/roster/template"
          download
          className="hidden sm:flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
          Template CSV
        </a>
      </header>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 space-y-6 pb-32">

          {/* ── GHL OAuth callback banners ──────────────────────────────── */}
          {ghlBanner === 'success' && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                  GoHighLevel Connected
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ghlSyncing
                    ? 'Importing contacts in the background — this may take a moment…'
                    : 'Your contacts have been imported into your Book of Business.'}
                </p>
              </div>
              <button
                onClick={() => setGhlBanner(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {ghlBanner === 'error' && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-5 py-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest text-red-400">
                  Connection Failed
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Please try again and make sure you approve the AegisSage app in your GHL account.
                </p>
              </div>
              <button
                onClick={() => setGhlBanner(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Source 1: GoHighLevel CRM ──────────────────────────────── */}
          <div className={cn(
            'rounded-3xl border p-6 space-y-4 transition-colors',
            ghlConnected
              ? 'border-primary/20 bg-primary/[0.03]'
              : 'border-border bg-card'
          )}>
            {/* Header row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
                  ghlConnected ? 'bg-primary/10' : 'bg-muted/50'
                )}>
                  <Zap className={cn('w-5 h-5', ghlConnected ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black uppercase tracking-tight text-foreground">
                      GoHighLevel CRM
                    </p>
                    {ghlConnected && (
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border font-black text-[8px] uppercase tracking-widest px-2 h-4 gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse inline-block" />
                        Live
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {ghlConnected === null
                      ? 'Checking connection…'
                      : ghlConnected
                      ? 'Authorized · contacts import automatically on sync'
                      : 'Not connected · authorize via OAuth to import your CRM'}
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              {ghlConnected ? (
                <>
                  <Button
                    type="button"
                    onClick={handleGhlSync}
                    disabled={ghlSyncing}
                    className="flex-1 min-w-[140px] h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-2"
                  >
                    {ghlSyncing
                      ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                      : <><RefreshCw className="w-3.5 h-3.5" /> Sync Contacts Now</>
                    }
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGhlConnect}
                    className="h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1.5 border-border"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Reconnect
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={handleGhlConnect}
                  disabled={ghlConnected === null}
                  className="flex-1 h-10 rounded-xl font-black uppercase text-[9px] tracking-widest gap-2"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Connect GoHighLevel
                  <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                </Button>
              )}
            </div>

            {/* GHL sync success inline message */}
            {statusMessage && ghlConnected && !isLoading && (
              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 px-4 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <p className="text-[11px] text-emerald-400 font-bold">{statusMessage}</p>
              </div>
            )}
          </div>

          {/* ── Divider ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
              or upload directly
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* ── Source 2 + 3: CSV & Sheets in a two-column grid ────────── */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

              {/* ── CSV Drag-and-Drop Zone ── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                    CSV / XLSX Roster
                  </p>
                  <a
                    href="/api/roster/template"
                    download
                    className="sm:hidden text-[9px] font-black uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
                  >
                    Template ↓
                  </a>
                </div>

                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 min-h-[160px] px-6',
                    isDragging
                      ? 'border-primary bg-primary/5 scale-[1.01]'
                      : file
                      ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60'
                      : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-primary/5'
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {file ? (
                    <>
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-tight text-foreground truncate max-w-[180px]">
                          {file.name}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-medium">
                          {(file.size / 1024).toFixed(1)} KB · click to change
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={cn(
                        'w-10 h-10 rounded-2xl flex items-center justify-center transition-colors',
                        isDragging ? 'bg-primary/20' : 'bg-muted/50'
                      )}>
                        <Upload className={cn('w-5 h-5', isDragging ? 'text-primary' : 'text-muted-foreground')} />
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-tight text-foreground">
                          {isDragging ? 'Drop to import' : 'Drop file here'}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-medium">
                          CSV, XLSX, XLS · any carrier format
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Column detection preview */}
                {preview && (
                  <div className="rounded-2xl border border-border bg-muted/10 p-4 space-y-3">
                    {preview.isXlsx ? (
                      <p className="text-[10px] text-muted-foreground font-medium">
                        XLSX detected — columns auto-mapped on import.
                      </p>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                            {Object.keys(preview.detectedColumns).length > 0
                              ? `${Object.keys(preview.detectedColumns).length} columns detected`
                              : 'No standard columns found'}
                          </p>
                          {Object.keys(preview.detectedColumns).length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(preview.detectedColumns).map(([field, header]) => (
                                <span
                                  key={field}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 text-primary text-[9px] font-black uppercase tracking-wider"
                                >
                                  {header}
                                  <ArrowRight className="w-2.5 h-2.5 opacity-60" />
                                  {FIELD_LABELS[field] ?? field}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-amber-400 font-medium">
                              MBI will be auto-detected from cell content.
                            </p>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-[9px] text-muted-foreground font-medium">
                            {preview.totalRows.toLocaleString()} rows · preview
                          </p>
                          {preview.sampleRows.length > 0 && (
                            <div className="rounded-xl overflow-hidden border border-border">
                              <table className="w-full text-[10px]">
                                <thead>
                                  <tr className="bg-muted/30">
                                    <th className="text-left px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-muted-foreground">Name</th>
                                    <th className="text-left px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-muted-foreground">MBI</th>
                                    <th className="text-left px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-muted-foreground">Plan</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {preview.sampleRows.map((row, i) => (
                                    <tr key={i} className="bg-background hover:bg-muted/10 transition-colors">
                                      <td className="px-3 py-1.5 text-foreground font-medium">{row.name || '—'}</td>
                                      <td className="px-3 py-1.5 font-mono text-primary/80">{row.mbi || '—'}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{row.plan || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ── Google Sheets URL ── */}
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                  Google Sheets URL
                </p>

                <div
                  className={cn(
                    'rounded-2xl border-2 border-dashed transition-all duration-200 min-h-[160px] flex flex-col justify-center p-6 space-y-4',
                    sheetsUrl.trim()
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-primary/5'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
                      sheetsUrl.trim() ? 'bg-emerald-500/10' : 'bg-muted/50'
                    )}>
                      <FileSpreadsheet className={cn(
                        'w-5 h-5',
                        sheetsUrl.trim() ? 'text-emerald-400' : 'text-muted-foreground'
                      )} />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-tight text-foreground">
                        Paste Sheets link
                      </p>
                      <p className="text-[9px] text-muted-foreground font-medium mt-0.5">
                        Share → "Anyone with link" to view
                      </p>
                    </div>
                  </div>

                  <input
                    type="url"
                    value={sheetsUrl}
                    onChange={e => { setSheetsUrl(e.target.value); if (file) { setFile(null); setPreview(null); } }}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className={cn(
                      'w-full h-10 px-3 rounded-xl border text-[11px] font-medium bg-background text-foreground',
                      'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30',
                      'transition-colors',
                      sheetsUrl.trim() ? 'border-emerald-500/30' : 'border-border'
                    )}
                  />
                </div>
              </div>
            </div>

            {/* ── Status / error message ── */}
            {statusMessage && !ghlConnected && (
              <div className={cn(
                'rounded-2xl px-4 py-3 flex items-start gap-2.5',
                syncState === 'error'
                  ? 'bg-red-500/5 border border-red-500/20'
                  : 'bg-primary/5 border border-primary/20'
              )}>
                {syncState === 'error'
                  ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                }
                <p className={cn(
                  'text-[11px] font-bold leading-relaxed',
                  syncState === 'error' ? 'text-red-400' : 'text-primary'
                )}>
                  {statusMessage}
                </p>
              </div>
            )}

            {/* ── Submit button ── */}
            <Button
              type="submit"
              disabled={isLoading || (!file && !sheetsUrl.trim())}
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] gap-2 shadow-lg shadow-primary/10"
            >
              {isLoading
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</>
                : <><Upload className="w-4 h-4" /> Import Roster</>
              }
            </Button>
          </form>

          {/* ── Post-import quality report ──────────────────────────────── */}
          {syncState === 'success' && importResult && (
            <div className="space-y-4">

              {/* Success header */}
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-emerald-400">
                    Import Complete
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <span className="font-black text-foreground">
                      {(importResult.imported + importResult.duplicates + importResult.dropped).toLocaleString()}
                    </span> rows found
                    {' · '}
                    <span className="font-black text-foreground">{importResult.imported.toLocaleString()}</span> imported
                    {importResult.dropped > 0 && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => setSkippedOpen(o => !o)}
                          className="text-amber-400 hover:text-amber-300 font-black underline underline-offset-2 transition-colors"
                        >
                          {importResult.dropped} skipped {skippedOpen ? '▲' : '▼'}
                        </button>
                        {' '}(missing/invalid MBI)
                      </>
                    )}
                    {importResult.duplicates > 0 && (
                      <>{' · '}{importResult.duplicates} duplicate{importResult.duplicates !== 1 ? 's' : ''} merged</>
                    )}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm"
                  className="shrink-0 rounded-xl font-black uppercase text-[9px] tracking-widest h-8 gap-1.5">
                  {/* Full navigation (not client-side) ensures the server component
                      re-fetches from DB — newly imported records visible immediately */}
                  <a href="/dashboard/book">
                    View Book of Business
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              </div>

              {/* Skipped members detail */}
              {skippedOpen && importResult.dropped > 0 && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                  <div className="px-5 py-3 flex items-center justify-between border-b border-amber-500/10">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-400">
                      {importResult.dropped} Skipped — No Valid MBI
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const rows = importResult.skipped ?? []
                        const csv = ['Name,Reason,Row', ...rows.map(r =>
                          `"${r.name.replace(/"/g, '""')}","${r.reason.replace(/"/g, '""')}",${r.row}`
                        )].join('\n')
                        const blob = new Blob([csv], { type: 'text/csv' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = 'skipped-members.csv'; a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="text-[9px] font-black uppercase tracking-widest text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download CSV
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-amber-500/10">
                    {importResult.skipped && importResult.skipped.length > 0 ? (
                      importResult.skipped.map((s, i) => (
                        <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-4">
                          <span className="text-[11px] font-bold text-foreground truncate">{s.name}</span>
                          <span className="text-[10px] text-amber-400/70 font-medium shrink-0">{s.reason}</span>
                        </div>
                      ))
                    ) : (
                      <p className="px-5 py-3 text-[10px] text-muted-foreground">
                        Skipped row details are available for CSV uploads only.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Data quality grid */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-3">
                  Data Quality Report · of imported members
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <StatPill label="MBI"     value={importResult.mbiCount}     total={importResult.imported} />
                  <StatPill label="Plan"    value={importResult.planCount}    total={importResult.imported} />
                  <StatPill label="Carrier" value={importResult.carrierCount} total={importResult.imported} />
                </div>

                {(importResult.planCount < importResult.imported ||
                  importResult.carrierCount < importResult.imported) && (
                  <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-400/90 font-medium leading-relaxed">
                      Missing plan or carrier data?{' '}
                      <a href="/api/roster/template" download
                        className="font-black underline underline-offset-2 hover:text-amber-300 transition-colors">
                        Download our template
                      </a>
                      {' '}for best results, or run a MARx check to auto-fill plan data from CMS.
                    </p>
                  </div>
                )}
              </div>

              {/* MARx baseline prompt */}
              {!marxOpened ? (
                <div className="rounded-3xl border border-primary/20 bg-primary/[0.03] p-6 space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-black uppercase tracking-tight text-foreground">
                        Run MARx Baseline?
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        MARx pulls current plan data directly from CMS — filling in missing carrier
                        and plan info for all {importResult.imported.toLocaleString()} members automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => { window.open(MARX_PORTAL_URL, '_blank'); setMarxOpened(true); }}
                      className="rounded-xl h-10 font-black uppercase text-[9px] tracking-widest gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open CMS MARx Portal
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setMarxOpened(true)}
                      className="rounded-xl h-10 font-black uppercase text-[9px] tracking-widest text-muted-foreground hover:text-foreground"
                    >
                      Skip for now
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-4 flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                      CMS MARx Portal Opened
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      Log in, then click{' '}
                      <span className="font-black text-foreground">Run MARx Check</span>{' '}
                      in the AegisSage extension to verify all {importResult.imported.toLocaleString()} members.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
