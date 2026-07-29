'use client';

import { useCallback, useState } from 'react';
import { Check, CircleAlert, FileSpreadsheet, RefreshCcw, Upload, X } from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareStatus } from './medicare-primitives';
import { useOperatorFetch } from './use-operator-fetch';

/**
 * Staged imports.
 *
 * The screen makes the two-gate flow visible: upload produces a PREVIEW that
 * has changed nothing, and a separate Commit applies it. Even Commit does not
 * overwrite an existing client — changes to people already in the book become
 * proposals in Coverage Reviews.
 *
 * The file is uploaded and parsed server-side. Nothing here reads the file
 * contents in the browser, which is a deliberate departure from the retired
 * import that parsed workbooks client-side with a vulnerable library.
 */

type Batch = {
  id: string;
  source_kind: string;
  original_filename: string | null;
  row_count: number;
  entity: string;
  status: string;
  created_count: number;
  matched_count: number;
  changed_count: number;
  rejected_count: number;
  duplicate_count: number;
  error: string | null;
  created_at: string;
  committed_at: string | null;
};

type ImportRecord = {
  id: string;
  row_number: number;
  normalized: Record<string, string | number | null>;
  disposition: string;
  match_confidence: string | null;
  match_candidates: { id: string; reason: string }[];
  issues: { field: string; message: string }[];
};

const DISPOSITION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  change: 'warning',
  unchanged: 'neutral',
  match: 'neutral',
  ambiguous: 'danger',
  duplicate: 'warning',
  rejected: 'danger',
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function Imports() {
  const { data, loading, error, reload } = useOperatorFetch<{
    batches: Batch[];
    migrationApplied: boolean;
    note?: string;
  }>('/api/medicare-crm/imports', 'Could not load import batches');

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [entity, setEntity] = useState<'clients' | 'policies' | 'coverage'>('clients');

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setMessage(null);
      try {
        const body = new FormData();
        body.append('file', file);
        body.append('entity', entity);
        const res = await fetch('/api/medicare-crm/imports', { method: 'POST', body });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? 'Upload failed');
        setMessage(
          `Staged ${payload.rowCount} rows. Nothing has been applied — review the preview, then commit.`,
        );
        setOpenBatchId(payload.batchId);
        reload();
      } catch (uploadError) {
        setMessage(uploadError instanceof Error ? uploadError.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [entity, reload],
  );

  const batches = data?.batches ?? [];

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Imports</div>
          <div className="mt-1 text-sm text-foreground/80">
            Upload, preview against what is already on file, then commit. Existing records are never overwritten.
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60 disabled:opacity-50"
        >
          <RefreshCcw className="size-3.5" /> Refresh
        </button>
      </div>

      {(error || data?.note) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error ?? data?.note}</span>
        </div>
      )}

      <PanelChrome title="NEW IMPORT" headerRight={<span className="text-[10px] text-muted-foreground">CSV only</span>} bodyClassName="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary/60"
            value={entity}
            onChange={(event) => setEntity(event.target.value as typeof entity)}
            aria-label="What the rows describe"
          >
            <option value="clients">Client records</option>
            <option value="policies">Policies</option>
            <option value="coverage">Coverage / roster</option>
          </select>

          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60">
            <FileSpreadsheet className="size-3.5" />
            {uploading ? 'Uploading…' : 'Choose CSV file'}
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <span className="text-[11px] text-muted-foreground">Max 5MB · 10,000 rows</span>
        </div>

        {message && <div className="text-[11px] text-muted-foreground">{message}</div>}

        {/*
          XLSX is deliberately absent. The retired import used a package with
          unpatched advisories and parsed in the browser; it comes back only
          after a parser security review.
        */}
        <div className="rounded border border-border/50 bg-surface-2/20 p-2 text-[11px] text-muted-foreground">
          Excel files are not accepted yet — export as CSV. XLSX support returns after a parser
          security review, and Google Sheets after an authorised access flow is agreed.
        </div>
      </PanelChrome>

      <PanelChrome
        title="IMPORT HISTORY"
        headerRight={<span className="text-[10px] text-muted-foreground">{batches.length}</span>}
        bodyClassName="space-y-2"
      >
        {loading && batches.length === 0 ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : batches.length === 0 ? (
          <MedicareEmpty message="No imports yet. Every upload is kept here with its file fingerprint, so a value can be traced back to the file it came from." />
        ) : (
          batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              open={openBatchId === batch.id}
              onToggle={() => setOpenBatchId(openBatchId === batch.id ? null : batch.id)}
              onActioned={reload}
            />
          ))
        )}
      </PanelChrome>
    </div>
  );
}

function BatchRow({
  batch,
  open,
  onToggle,
  onActioned,
}: {
  batch: Batch;
  open: boolean;
  onToggle: () => void;
  onActioned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const { data, reload } = useOperatorFetch<{ batch: Batch; records: ImportRecord[] }>(
    open ? `/api/medicare-crm/imports/${batch.id}` : null,
    'Could not load this batch',
  );

  async function act(action: 'commit' | 'reject') {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/medicare-crm/imports/${batch.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Action failed');
      setResult(
        action === 'commit'
          ? `${payload.created} created · ${payload.snapshots} observations recorded · ${payload.diffs} changes proposed for approval`
          : 'Batch rejected. Nothing was applied.',
      );
      onActioned();
      reload();
    } catch (actionError) {
      setResult(actionError instanceof Error ? actionError.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const actionable = batch.status === 'previewed';

  return (
    <div className="rounded border border-border/60 bg-surface-2/30 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="truncate text-xs font-medium">{batch.original_filename ?? 'Upload'}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {batch.entity} · {batch.row_count} rows · {formatWhen(batch.created_at)}
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <MedicareStatus tone={batch.status === 'committed' ? 'success' : batch.status === 'previewed' ? 'warning' : 'neutral'}>
            {batch.status}
          </MedicareStatus>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{batch.created_count} to create</span>
        <span>{batch.changed_count} changed</span>
        <span>{batch.duplicate_count} duplicate</span>
        <span>{batch.rejected_count} rejected</span>
      </div>

      {actionable && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('commit')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-emerald-400/40 bg-emerald-400/10 px-2.5 text-xs text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            <Check className="size-3.5" /> {busy ? 'Committing…' : 'Commit batch'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('reject')}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-rose-400/50 disabled:opacity-50"
          >
            <X className="size-3.5" /> Reject
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60"
          >
            <Upload className="size-3.5" /> {open ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      )}

      {result && <div className="mt-2 text-[11px] text-muted-foreground">{result}</div>}
      {batch.error && <div className="mt-2 text-[11px] text-rose-200">{batch.error}</div>}

      {open && data && (
        <div className="mt-2 overflow-x-auto rounded border border-border/50">
          <table className="w-full min-w-[40rem] text-left text-[11px]">
            <thead className="bg-surface-2/50 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Row</th>
                <th className="px-2 py-1.5">Name</th>
                <th className="px-2 py-1.5">Outcome</th>
                <th className="px-2 py-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.records.slice(0, 100).map((record) => (
                <tr key={record.id} className="border-t border-border/40">
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{record.row_number}</td>
                  <td className="px-2 py-1.5">
                    {[record.normalized.first_name, record.normalized.last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <MedicareStatus tone={DISPOSITION_TONE[record.disposition] ?? 'neutral'}>
                      {record.disposition}
                    </MedicareStatus>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {record.issues.length > 0
                      ? record.issues.map((issue) => issue.message).join('; ')
                      : record.match_candidates.length > 0
                        ? `matched on ${record.match_candidates[0].reason}`
                        : record.match_confidence
                          ? `${record.match_confidence} confidence`
                          : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.records.length > 100 && (
            <div className="border-t border-border/40 px-2 py-1.5 text-[10px] text-muted-foreground">
              Showing the first 100 of {data.records.length} rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
