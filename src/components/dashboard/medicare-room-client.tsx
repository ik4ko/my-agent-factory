'use client';

import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CircleAlert, Database, FileSpreadsheet, Mail, MessageSquare, RefreshCcw, Search, ShieldCheck, Smartphone, StickyNote, Upload } from 'lucide-react';
import { PanelChrome } from '@/components/deck';
import { MedicareEmpty, MedicareMetric, MedicareStatus, formatCurrency, maskMbi } from './medicare/medicare-primitives';
import { EMPTY_MEDICARE_ROOM_DATA, type AgCarrier, type AgClient, type MedicareRoomData } from '@/lib/medicare-crm/types';

type ImportEntity = 'clients' | 'carriers' | 'policies';
type ImportRow = Record<string, unknown>;
type ClientSort = 'name' | 'state' | 'created_at';

const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  clients: ['id', 'first_name', 'last_name', 'phone', 'email', 'date_of_birth', 'physical_address', 'city', 'state', 'zip', 'medicare_beneficiary_identifier', 'tags'],
  carriers: ['id', 'name', 'appointment_status', 'fmo_id', 'lines_of_business', 'active_states'],
  policies: ['id', 'client_id', 'plan_name', 'plan_id', 'carrier_id', 'fmo_id', 'effective_date', 'monthly_premium', 'commission_level', 'status'],
};

const DEFAULT_STATES = ['NJ', 'NY', 'PA'];
const inputClass = 'h-8 rounded border border-border bg-surface-2 px-2 text-xs text-foreground outline-none focus:border-primary/60';
const buttonClass = 'inline-flex h-8 items-center justify-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs text-foreground transition hover:border-primary/60 hover:bg-surface-2/80 disabled:cursor-not-allowed disabled:opacity-50';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  const normalized = status.toLowerCase();
  if (['active', 'appointed', 'approved', 'ready'].includes(normalized)) return 'success';
  if (['pending', 'in_review', 'not_started'].includes(normalized)) return 'warning';
  if (['expired', 'terminated', 'cancelled', 'lost'].includes(normalized)) return 'danger';
  return 'neutral';
}

function canonicalHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function looksLikeUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function looksLikeDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return !Number.isNaN(date.getTime());
}

function carrierLabel(carriers: AgCarrier[], id: string | null) {
  return carriers.find((carrier) => carrier.id === id)?.name ?? 'Unassigned';
}

export function MedicareRoomClient() {
  const [data, setData] = useState<MedicareRoomData>(EMPTY_MEDICARE_ROOM_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [carrierFilter, setCarrierFilter] = useState('all');
  const [policyStatusFilter, setPolicyStatusFilter] = useState('all');
  const [fmoFilter, setFmoFilter] = useState('all');
  const [sortBy, setSortBy] = useState<ClientSort>('name');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [importEntity, setImportEntity] = useState<ImportEntity>('clients');
  const [rawImportRows, setRawImportRows] = useState<ImportRow[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/medicare-crm', { cache: 'no-store' });
      const payload = (await response.json()) as MedicareRoomData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load Medicare CRM data');
      setData(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Medicare CRM data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const fmoById = useMemo(() => new Map(data.fmos.map((fmo) => [fmo.id, fmo])), [data.fmos]);
  const policiesByClient = useMemo(() => {
    const map = new Map<string, typeof data.policies>();
    for (const policy of data.policies) map.set(policy.client_id, [...(map.get(policy.client_id) ?? []), policy]);
    return map;
  }, [data.policies]);
  const licensedStates = data.agencySettings?.licensed_states?.length ? data.agencySettings.licensed_states : DEFAULT_STATES;
  const stateOptions = useMemo(() => Array.from(new Set([...DEFAULT_STATES, ...licensedStates, ...data.clients.map((client) => client.state).filter(Boolean) as string[]])).sort(), [data.clients, licensedStates]);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = data.clients.filter((client) => {
      const policies = policiesByClient.get(client.id) ?? [];
      const matchesQuery = !query || [client.first_name, client.last_name, client.email, client.phone, client.state].some((value) => value?.toLowerCase().includes(query));
      const matchesState = stateFilter === 'all' || client.state === stateFilter;
      const matchesCarrier = carrierFilter === 'all' || policies.some((policy) => policy.carrier_id === carrierFilter);
      const matchesPolicyStatus = policyStatusFilter === 'all' || policies.some((policy) => policy.status === policyStatusFilter);
      const matchesFmo = fmoFilter === 'all' || policies.some((policy) => policy.fmo_id === fmoFilter);
      return matchesQuery && matchesState && matchesCarrier && matchesPolicyStatus && matchesFmo;
    });
    return filtered.sort((left, right) => {
      if (sortBy === 'state') return (left.state ?? '').localeCompare(right.state ?? '');
      if (sortBy === 'created_at') return right.created_at.localeCompare(left.created_at);
      return `${left.last_name}, ${left.first_name}`.localeCompare(`${right.last_name}, ${right.first_name}`);
    });
  }, [carrierFilter, data.clients, fmoFilter, policiesByClient, policyStatusFilter, search, sortBy, stateFilter]);

  const selectedClient = data.clients.find((client) => client.id === selectedClientId) ?? filteredClients[0] ?? null;
  const selectedPolicies = selectedClient ? policiesByClient.get(selectedClient.id) ?? [] : [];
  const activePolicies = data.policies.filter((policy) => policy.status.toLowerCase() === 'active');
  const activeClients = new Set(activePolicies.map((policy) => policy.client_id)).size;
  const annualizedPremium = activePolicies.reduce((sum, policy) => sum + (Number(policy.monthly_premium) || 0) * 12, 0);
  const activeCarriers = data.carriers.filter((carrier) => ['active', 'appointed', 'approved'].includes(carrier.appointment_status.toLowerCase())).length;
  const pendingCarriers = data.carriers.filter((carrier) => carrier.appointment_status.toLowerCase() === 'pending').length;

  const complianceAlerts = useMemo(() => {
    const alerts: string[] = [];
    if (!data.agencySettings) alerts.push('Agency profile is not configured. Add NPN, state licenses, and certification dates.');
    const now = Date.now();
    const threshold = now + 45 * 24 * 60 * 60 * 1000;
    for (const [label, expiresAt] of [['AHIP', data.agencySettings?.ahip_expires_at], ['HIPAA', data.agencySettings?.hipaa_expires_at]] as const) {
      if (!expiresAt) continue;
      const timestamp = new Date(expiresAt).getTime();
      if (timestamp < now) alerts.push(`${label} certification expired ${formatDate(expiresAt)}.`);
      else if (timestamp <= threshold) alerts.push(`${label} certification expires ${formatDate(expiresAt)}.`);
    }
    for (const document of data.complianceDocuments) {
      if (document.expires_at && new Date(document.expires_at).getTime() <= threshold) alerts.push(`${document.title} expires ${formatDate(document.expires_at)}.`);
    }
    return alerts;
  }, [data.agencySettings, data.complianceDocuments]);

  async function addNote() {
    if (!selectedClient || !noteDraft.trim()) return;
    setNoteSaving(true); setNoteMessage(null);
    try {
      const response = await fetch('/api/medicare-crm/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: selectedClient.id, note: noteDraft }) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not save note');
      setNoteDraft(''); setNoteMessage('Note saved'); await loadData();
    } catch (saveError) {
      setNoteMessage(saveError instanceof Error ? saveError.message : 'Could not save note');
    } finally { setNoteSaving(false); }
  }

  async function handleFile(file: File) {
    setImportMessage(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('The workbook has no readable sheets.');
      const rows = XLSX.utils.sheet_to_json<ImportRow>(firstSheet, { defval: '' });
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const fields = IMPORT_FIELDS[importEntity];
      const nextMapping = Object.fromEntries(fields.map((field) => [field, headers.find((header) => canonicalHeader(header) === field) ?? '']));
      setRawImportRows(rows); setImportHeaders(headers); setMapping(nextMapping);
      if (!rows.length) setImportMessage('No rows found in the first sheet.');
    } catch (fileError) {
      setImportMessage(fileError instanceof Error ? fileError.message : 'Could not read that file.');
    }
  }

  const mappedImportRows = useMemo(() => rawImportRows.map((row) => Object.fromEntries(IMPORT_FIELDS[importEntity].map((field) => [field, mapping[field] ? row[mapping[field]] : '']))), [importEntity, mapping, rawImportRows]);
  const importErrors = useMemo(() => mappedImportRows.flatMap((row, index) => {
    const required = importEntity === 'clients' ? ['first_name', 'last_name'] : importEntity === 'carriers' ? ['name'] : ['client_id', 'plan_name'];
    const missing = required.filter((field) => !String(row[field] ?? '').trim());
    const issues = missing.length ? [`missing ${missing.join(' and ')}`] : [];
    const uuidFields = importEntity === 'clients' ? ['id'] : importEntity === 'carriers' ? ['id', 'fmo_id'] : ['id', 'client_id', 'carrier_id', 'fmo_id'];
    for (const field of uuidFields) if (String(row[field] ?? '').trim() && !looksLikeUuid(row[field])) issues.push(`${field} is not a UUID`);
    const dateFields = importEntity === 'clients' ? ['date_of_birth'] : importEntity === 'policies' ? ['effective_date'] : [];
    for (const field of dateFields) if (String(row[field] ?? '').trim() && !looksLikeDate(row[field])) issues.push(`${field} is not a date`);
    if (importEntity === 'clients' && String(row.email ?? '').trim() && !/^\S+@\S+\.\S+$/.test(String(row.email))) issues.push('email is invalid');
    if (importEntity === 'policies' && String(row.monthly_premium ?? '').trim() && !Number.isFinite(Number(String(row.monthly_premium).replace(/[$,]/g, '')))) issues.push('monthly_premium is not numeric');
    return issues.length ? [`Row ${index + 2}: ${issues.join('; ')}`] : [];
  }), [importEntity, mappedImportRows]);

  async function commitImport() {
    if (!mappedImportRows.length || importErrors.length) return;
    setImporting(true); setImportMessage(null);
    try {
      const response = await fetch('/api/medicare-crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: importEntity, rows: mappedImportRows }) });
      const payload = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Import failed');
      setImportMessage(`Imported ${payload.imported ?? mappedImportRows.length} ${importEntity}.`); setRawImportRows([]); setImportHeaders([]); await loadData();
    } catch (importError) {
      setImportMessage(importError instanceof Error ? importError.message : 'Import failed');
    } finally { setImporting(false); }
  }

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Operator workspace</div><div className="mt-1 text-sm text-foreground/80">Sensitive client data stays masked in list views.</div></div>
        <button type="button" className={buttonClass} onClick={() => void loadData()} disabled={loading}><RefreshCcw className="size-3.5" /> Refresh</button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{error}. Apply the Medicare CRM migration to activate live data; the room shell remains available.</span></div>}
      {complianceAlerts.length > 0 && <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100"><CircleAlert className="mt-0.5 size-4 shrink-0" /><div><div className="font-semibold uppercase tracking-wider">Compliance readiness</div><ul className="mt-1 space-y-0.5">{complianceAlerts.slice(0, 4).map((alert) => <li key={alert}>• {alert}</li>)}</ul></div></div>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MedicareMetric label="Active clients" value={loading ? '—' : activeClients.toLocaleString()} detail={`${data.clients.length.toLocaleString()} total records`} tone="success" />
        <MedicareMetric label="Annualized premium" value={loading ? '—' : formatCurrency(annualizedPremium)} detail="Active policies × 12" />
        <MedicareMetric label="Active carriers" value={loading ? '—' : activeCarriers.toString()} detail={`${pendingCarriers} pending appointment${pendingCarriers === 1 ? '' : 's'}`} tone="success" />
        <MedicareMetric label="Pending carriers" value={loading ? '—' : pendingCarriers.toString()} detail="Appointment follow-up queue" tone={pendingCarriers ? 'warning' : 'default'} />
        <MedicareMetric label="Licensed footprint" value={`${licensedStates.length} states`} detail={licensedStates.join(' · ')} />
      </div>

      <PanelChrome title="BOOK OF BUSINESS" headerRight={<span className="text-[10px] text-muted-foreground">{filteredClients.length} visible</span>} bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-border/50 p-2">
          <label className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass} w-full pl-7`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients" aria-label="Search clients" /></label>
          <select className={inputClass} value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter by state"><option value="all">All states</option>{stateOptions.map((state) => <option key={state}>{state}</option>)}</select>
          <select className={inputClass} value={carrierFilter} onChange={(event) => setCarrierFilter(event.target.value)} aria-label="Filter by carrier"><option value="all">All carriers</option>{data.carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}</select>
          <select className={inputClass} value={policyStatusFilter} onChange={(event) => setPolicyStatusFilter(event.target.value)} aria-label="Filter by policy status"><option value="all">All policy status</option><option value="active">Active</option><option value="pending">Pending</option><option value="cancelled">Cancelled</option></select>
          <select className={inputClass} value={fmoFilter} onChange={(event) => setFmoFilter(event.target.value)} aria-label="Filter by FMO"><option value="all">All FMOs</option>{data.fmos.map((fmo) => <option key={fmo.id} value={fmo.id}>{fmo.name}</option>)}</select>
        </div>
        <div className="grid min-h-[28rem] lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
          <div className="overflow-x-auto border-b border-border/50 lg:border-b-0 lg:border-r">
            {filteredClients.length === 0 ? <div className="p-3"><MedicareEmpty message="No clients match the current filters. Import a CSV/XLSX file or add records through the API boundary." /></div> : <table className="w-full min-w-[44rem] text-left text-xs"><thead className="bg-surface-2/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2"><button type="button" className="hover:text-foreground" onClick={() => setSortBy('name')} aria-sort={sortBy === 'name' ? 'ascending' : 'none'}>Client ↕</button></th><th className="px-3 py-2"><button type="button" className="hover:text-foreground" onClick={() => setSortBy('state')} aria-sort={sortBy === 'state' ? 'ascending' : 'none'}>State ↕</button></th><th className="px-3 py-2">Carrier / FMO</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2">MBI</th></tr></thead><tbody>{filteredClients.map((client) => { const policy = (policiesByClient.get(client.id) ?? [])[0]; return <tr key={client.id} className={`cursor-pointer border-t border-border/40 transition hover:bg-surface-2/50 ${selectedClient?.id === client.id ? 'bg-primary/10' : ''}`} onClick={() => setSelectedClientId(client.id)}><td className="px-3 py-3"><div className="font-medium text-foreground">{client.first_name} {client.last_name}</div><div className="text-[11px] text-muted-foreground">{client.email ?? client.phone ?? 'No contact detail'}</div></td><td className="px-3 py-3 text-muted-foreground">{client.state ?? '—'}</td><td className="px-3 py-3"><div>{policy ? carrierLabel(data.carriers, policy.carrier_id) : '—'}</div><div className="text-[11px] text-muted-foreground">{policy?.fmo_id ? fmoById.get(policy.fmo_id)?.name ?? 'Unknown FMO' : 'No FMO'}</div></td><td className="px-3 py-3">{policy ? <MedicareStatus tone={statusTone(policy.status)}>{policy.status}</MedicareStatus> : <span className="text-muted-foreground">None</span>}</td><td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">{client.masked_mbi ?? maskMbi(client.medicare_beneficiary_identifier)}</td></tr>; })}</tbody></table>}
          </div>
          <div className="min-w-0 p-3">{selectedClient ? <ClientDetail client={selectedClient} policies={selectedPolicies} notes={data.notes.filter((note) => note.client_id === selectedClient.id)} communications={data.communications.filter((item) => item.client_id === selectedClient.id)} carriers={data.carriers} fmoById={fmoById} noteDraft={noteDraft} onNoteDraftChange={setNoteDraft} onAddNote={() => void addNote()} noteSaving={noteSaving} noteMessage={noteMessage} /> : <MedicareEmpty message="Select a client to inspect policies, lineage, communication history, and notes." />}</div>
        </div>
      </PanelChrome>

      <div className="grid gap-3 xl:grid-cols-2">
        <PanelChrome title="CARRIER & STATE MATRIX" bodyClassName="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">{data.carriers.length ? data.carriers.map((carrier) => <div key={carrier.id} className="rounded border border-border/60 bg-surface-2/30 p-2.5"><div className="flex items-center justify-between gap-2"><span className="font-medium text-xs">{carrier.name}</span><MedicareStatus tone={statusTone(carrier.appointment_status)}>{carrier.appointment_status}</MedicareStatus></div><div className="mt-1 text-[11px] text-muted-foreground">{carrier.active_states.length ? carrier.active_states.join(' · ') : 'No states mapped'} · {carrier.lines_of_business.join(', ') || 'LOB not mapped'}</div></div>) : <MedicareEmpty message="Carrier appointments will appear here after setup or import." />}</div>
          <div className="rounded border border-border/60 bg-surface-2/20 p-2.5"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><ArrowRight className="size-3.5 text-primary" /> FMO transition tracker</div><div className="flex flex-wrap items-center gap-2 text-xs"><MedicareStatus tone="neutral">Applied General</MedicareStatus><ArrowRight className="size-3 text-muted-foreground" /><MedicareStatus tone="warning">Pinnacle Financials</MedicareStatus><span className="text-[11px] text-muted-foreground">Visibility tracker only · no live transition automation</span></div></div>
          <div className="grid grid-cols-3 gap-2">{licensedStates.map((state) => <div key={state} className="rounded border border-border/60 p-2 text-center"><div className="text-lg font-semibold">{state}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-emerald-300">License footprint</div></div>)}</div>
        </PanelChrome>

        <ImportPanel entity={importEntity} onEntityChange={(value) => { setImportEntity(value); setRawImportRows([]); setImportHeaders([]); setImportMessage(null); }} headers={importHeaders} mapping={mapping} onMappingChange={(field, value) => setMapping((current) => ({ ...current, [field]: value }))} rowCount={rawImportRows.length} previewRows={mappedImportRows.slice(0, 5)} errors={importErrors} message={importMessage} importing={importing} onFile={handleFile} onCommit={() => void commitImport()} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.3fr_0.7fr]">
        <PanelChrome title="COMPLIANCE VAULT" headerRight={<span className="text-[10px] text-muted-foreground">Metadata ready · Storage pending</span>}>
          <div className="mb-3 rounded border border-dashed border-border/70 bg-surface-2/20 p-3 text-xs text-muted-foreground"><div className="flex items-center gap-2 text-foreground"><Upload className="size-4 text-primary" /> Supabase Storage upload boundary</div><div className="mt-1">Document metadata is live-ready. File upload and signed URL handling remain intentionally unconfigured.</div></div>
          {data.complianceDocuments.length ? <div className="space-y-2">{data.complianceDocuments.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/60 p-2.5"><div><div className="text-xs font-medium">{document.title}</div><div className="text-[11px] text-muted-foreground">{document.document_type} · uploaded {formatDate(document.uploaded_at)}</div></div><MedicareStatus tone={document.expires_at && new Date(document.expires_at).getTime() < Date.now() ? 'danger' : 'warning'}>{document.expires_at ? `Expires ${formatDate(document.expires_at)}` : 'No expiry'}</MedicareStatus></div>)}</div> : <MedicareEmpty message="No compliance documents recorded yet." />}
        </PanelChrome>
        <PanelChrome title="AGENCY READINESS">
          <div className="space-y-2 text-xs">{[['Agency', data.agencySettings?.agency_name || 'Not configured'], ['NPN', data.agencySettings?.npn || 'Not recorded'], ['Resident state', data.agencySettings?.resident_state || 'Not recorded'], ['AHIP', data.agencySettings?.ahip_status || 'Not started'], ['HIPAA', data.agencySettings?.hipaa_status || 'Not started']].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>)}</div>
        </PanelChrome>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded border border-border/50 bg-surface-2/20 p-2 text-[11px] text-muted-foreground"><Database className="size-3.5" /> Integration boundaries: SunFire plan/client sync · Telegram webhook logging · Twilio SMS · SendGrid email. All are stubs until credentials and compliance review are complete.</div>
    </div>
  );
}

function ClientDetail({ client, policies, notes, communications, carriers, fmoById, noteDraft, onNoteDraftChange, onAddNote, noteSaving, noteMessage }: { client: AgClient; policies: MedicareRoomData['policies']; notes: MedicareRoomData['notes']; communications: MedicareRoomData['communications']; carriers: AgCarrier[]; fmoById: Map<string, MedicareRoomData['fmos'][number]>; noteDraft: string; onNoteDraftChange: (value: string) => void; onAddNote: () => void; noteSaving: boolean; noteMessage: string | null }) {
  return <div className="space-y-3"><div className="flex items-start justify-between gap-2"><div><div className="text-base font-semibold">{client.first_name} {client.last_name}</div><div className="mt-1 text-xs text-muted-foreground">{client.city || '—'}, {client.state || '—'} {client.zip || ''}</div></div><MedicareStatus tone="neutral">Client record</MedicareStatus></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded border border-border/50 p-2"><div className="text-muted-foreground">Phone</div><div className="mt-1">{client.phone || '—'}</div></div><div className="rounded border border-border/50 p-2"><div className="text-muted-foreground">Email</div><div className="mt-1 truncate">{client.email || '—'}</div></div><div className="col-span-2 rounded border border-border/50 p-2"><div className="text-muted-foreground">MBI (masked)</div><div className="mt-1 font-mono">{client.masked_mbi ?? maskMbi(client.medicare_beneficiary_identifier)}</div></div></div><div className="flex gap-2"><button type="button" disabled title="Stub: SendGrid boundary is not configured" className={buttonClass}><Mail className="size-3.5" /> Send Email · stub</button><button type="button" disabled title="Stub: Twilio boundary is not configured" className={buttonClass}><Smartphone className="size-3.5" /> Send SMS · stub</button></div><div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><ShieldCheck className="size-3.5 text-primary" /> Policies & lineage</div>{policies.length ? <div className="space-y-1.5">{policies.map((policy) => <div key={policy.id} className="rounded border border-border/50 p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium">{policy.plan_name}</span><MedicareStatus tone={statusTone(policy.status)}>{policy.status}</MedicareStatus></div><div className="mt-1 text-[11px] text-muted-foreground">{carrierLabel(carriers, policy.carrier_id)} · {policy.fmo_id ? fmoById.get(policy.fmo_id)?.name ?? 'Unknown FMO' : 'No FMO'} · {policy.monthly_premium ? formatCurrency(Number(policy.monthly_premium)) + '/mo' : 'Premium not recorded'}</div></div>)}</div> : <MedicareEmpty message="No policies attached to this client." />}</div><div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><MessageSquare className="size-3.5 text-primary" /> Communications</div>{communications.length ? <div className="space-y-1.5">{communications.slice(0, 4).map((communication) => <div key={communication.id} className="rounded border border-border/50 p-2 text-[11px]"><div className="flex justify-between gap-2"><MedicareStatus tone="neutral">{communication.type} · {communication.direction}</MedicareStatus><span className="text-muted-foreground">{formatDate(communication.timestamp)}</span></div><div className="mt-1 text-muted-foreground">{communication.content}</div></div>)}</div> : <div className="text-xs text-muted-foreground">No communication history recorded.</div>}</div><div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><StickyNote className="size-3.5 text-primary" /> Add note</div><textarea className="min-h-16 w-full rounded border border-border bg-surface-2 p-2 text-xs outline-none focus:border-primary/60" value={noteDraft} onChange={(event) => onNoteDraftChange(event.target.value)} placeholder="Add a timestamped client note…" /><div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{noteMessage ?? `${notes.length} notes on file`}</span><button type="button" className={buttonClass} onClick={onAddNote} disabled={noteSaving || !noteDraft.trim()}>{noteSaving ? 'Saving…' : 'Save note'}</button></div>{notes.length > 0 && <div className="mt-2 space-y-1.5">{notes.slice(0, 3).map((note) => <div key={note.id} className="rounded border border-border/50 p-2 text-[11px]"><div className="text-muted-foreground">{formatDate(note.created_at)}</div><div className="mt-1">{note.note}</div></div>)}</div>}</div></div>;
}

function ImportPanel({ entity, onEntityChange, headers, mapping, onMappingChange, rowCount, previewRows, errors, message, importing, onFile, onCommit }: { entity: ImportEntity; onEntityChange: (value: ImportEntity) => void; headers: string[]; mapping: Record<string, string>; onMappingChange: (field: string, value: string) => void; rowCount: number; previewRows: ImportRow[]; errors: string[]; message: string | null; importing: boolean; onFile: (file: File) => void; onCommit: () => void }) {
  const fields = IMPORT_FIELDS[entity];
  return <PanelChrome title="IMPORT & INGESTION HUB" headerRight={<span className="text-[10px] text-muted-foreground">CSV / XLSX</span>} bodyClassName="space-y-3"><div className="flex flex-wrap gap-2"><select className={inputClass} value={entity} onChange={(event) => onEntityChange(event.target.value as ImportEntity)} aria-label="Import entity"><option value="clients">Clients</option><option value="carriers">Carriers</option><option value="policies">Policies / commission records</option></select><label className={`${buttonClass} cursor-pointer`}><FileSpreadsheet className="size-3.5" /> Choose file<input className="sr-only" type="file" accept=".csv,.xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ''; }} /></label><span className="self-center text-[11px] text-muted-foreground">{rowCount ? `${rowCount} rows staged` : 'Preview before commit'}</span></div>{headers.length > 0 && <div className="space-y-2"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Field mapping</div><div className="grid gap-1.5 sm:grid-cols-2">{fields.map((field) => <label key={field} className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate text-muted-foreground">{field}</span><select className={`${inputClass} max-w-[10rem]`} value={mapping[field] ?? ''} onChange={(event) => onMappingChange(field, event.target.value)}><option value="">Unmapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="overflow-x-auto rounded border border-border/50"><table className="w-full min-w-[28rem] text-left text-[10px]"><thead className="bg-surface-2/50 text-muted-foreground"><tr>{fields.slice(0, 5).map((field) => <th className="px-2 py-1.5" key={field}>{field}</th>)}</tr></thead><tbody>{previewRows.map((row, index) => <tr key={index} className="border-t border-border/40">{fields.slice(0, 5).map((field) => <td className="max-w-32 truncate px-2 py-1.5" key={field}>{String(row[field] ?? '') || '—'}</td>)}</tr>)}</tbody></table></div>{errors.length > 0 && <div className="text-[11px] text-rose-200">{errors.slice(0, 3).map((item) => <div key={item}>{item}</div>)}</div>}<div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{message ?? 'Rows are validated in the browser and again at the API.'}</span><button type="button" className={buttonClass} onClick={onCommit} disabled={importing || !rowCount || errors.length > 0}><Upload className="size-3.5" /> {importing ? 'Committing…' : 'Commit import'}</button></div></div>}{!headers.length && <MedicareEmpty message="Upload a CSV or Excel workbook to preview rows and map fields." />}</PanelChrome>;
}
