import { createServiceClient } from '@/lib/supabase/service'

// Weighted baseline — most recent syncs carry the most weight.
export const FULL_WEIGHTS = [0.35, 0.25, 0.20, 0.10, 0.06, 0.04]

export interface BaselineResult {
  baseline: number
  thresholdCritical: number
  thresholdWarning: number
}

export interface EvaluationResult {
  status: SyncStatus
  deltaEngineAllowed: boolean
  retryScheduledAt?: string
  circuitBreakerActivated?: boolean
  notifyBroker?: boolean
  message?: string
}

export type SyncStatus =
  | 'SYNC_INITIATED'
  | 'SYNC_EXECUTING'
  | 'SYNC_HEALTHY'
  | 'SYNC_DEGRADED'
  | 'INCOMPLETE_RETRY_PENDING'
  | 'ANOMALY_FLAGGED'
  | 'SYNC_SUSPECT'
  | 'SYNC_BLOCKED'
  | 'RETRY_QUEUED'
  | 'SYNC_FAILED'
  | 'CARRIER_PORTAL_DEGRADED'
  | 'UNVERIFIED_BASELINE'
  | 'MULTI_CARRIER_DEGRADED'

type SyncResultRow = {
  id: string
  broker_id: string
  agency_id: string
  carrier: string
  retry_count: number
  parent_sync_id: string | null
}

type BaselineRow = {
  id: string
  broker_id: string
  agency_id: string
  carrier: string
  sync_count: number
  s_minus_1: number | null
  s_minus_2: number | null
  s_minus_3: number | null
  s_minus_4: number | null
  s_minus_5: number | null
  s_minus_6: number | null
  consecutive_degraded_count: number
  consecutive_suspect_count: number
  circuit_breaker_active: boolean
  circuit_breaker_set_at: string | null
}

// ── Standalone pure export — usable without class instantiation ───────────────
// This is the only function that needs to be tested in unit tests.
// It has zero side effects and requires no Supabase connection.

export type BaselineInput = {
  sync_count: number
  s_minus_1?: number | null
  s_minus_2?: number | null
  s_minus_3?: number | null
  s_minus_4?: number | null
  s_minus_5?: number | null
  s_minus_6?: number | null
}

export function computeBaseline(baseline: BaselineInput): BaselineResult | null {
  if (!baseline || baseline.sync_count < 3) return null

  const slots = [
    baseline.s_minus_1,
    baseline.s_minus_2,
    baseline.s_minus_3,
    baseline.s_minus_4,
    baseline.s_minus_5,
    baseline.s_minus_6,
  ]

  const available = slots.filter((v): v is number => v !== null && v !== undefined)
  if (available.length < 3) return null

  const rawWeights = FULL_WEIGHTS.slice(0, available.length)
  const weightSum = rawWeights.reduce((a, b) => a + b, 0)
  const scaledWeights = rawWeights.map(w => w / weightSum)

  const B = available.reduce((sum, val, i) => sum + scaledWeights[i] * val, 0)

  return {
    baseline: B,
    thresholdCritical: B * 0.50,
    thresholdWarning: B * 0.80,
  }
}

export class SyncBaselineEngine {
  private get db() {
    return createServiceClient()
  }

  // ── Public: create initial sync record ───────────────────────────────────

  async createSyncResult(params: {
    agencyId: string
    brokerId: string
    carrier: string
    syncType?: 'manual' | 'scheduled' | 'queued' | 'retry'
  }): Promise<{ id: string }> {
    const supabase = this.db
    const { data, error } = await supabase
      .from('sync_results')
      .insert({
        agency_id: params.agencyId,
        broker_id: params.brokerId,
        carrier: params.carrier,
        sync_type: params.syncType ?? 'manual',
        status: 'SYNC_INITIATED',
      })
      .select('id')
      .single()

    if (error || !data) throw new Error(`createSyncResult failed: ${error?.message}`)
    return { id: data.id }
  }

  // ── Public: evaluate a completed sync against the baseline ────────────────

  async evaluateSyncResult(syncId: string, rowsReturned: number): Promise<EvaluationResult> {
    const supabase = this.db

    // STEP 1: fetch sync record
    const { data: syncRow, error: syncErr } = await supabase
      .from('sync_results')
      .select('id, broker_id, agency_id, carrier, retry_count, parent_sync_id')
      .eq('id', syncId)
      .single()

    if (syncErr || !syncRow) throw new Error(`evaluateSyncResult: sync not found (${syncId})`)
    const sync = syncRow as SyncResultRow

    // STEP 2: fetch or upsert carrier_baselines record
    let baseline = await this.getOrCreateBaseline(sync.broker_id, sync.agency_id, sync.carrier)

    // BRANCH 0 — CIRCUIT BREAKER CHECK
    if (baseline.circuit_breaker_active) {
      const setAt = baseline.circuit_breaker_set_at ? new Date(baseline.circuit_breaker_set_at).getTime() : 0
      const hoursElapsed = (Date.now() - setAt) / 3_600_000

      if (hoursElapsed > 48) {
        // Auto-reset circuit breaker
        await supabase
          .from('carrier_baselines')
          .update({ circuit_breaker_active: false, circuit_breaker_set_at: null })
          .eq('broker_id', sync.broker_id)
          .eq('carrier', sync.carrier)
        baseline = { ...baseline, circuit_breaker_active: false }
        // Fall through to normal evaluation
      } else {
        await supabase
          .from('sync_results')
          .update({ status: 'CARRIER_PORTAL_DEGRADED', rows_returned: rowsReturned })
          .eq('id', syncId)
        return { status: 'CARRIER_PORTAL_DEGRADED', deltaEngineAllowed: false }
      }
    }

    // STEP 3: compute baseline
    const computed = this.computeBaseline(baseline)

    // STEP 4: snapshot baseline into sync record
    await supabase
      .from('sync_results')
      .update({
        rows_returned: rowsReturned,
        baseline_at_time: computed?.baseline ?? null,
        threshold_critical: computed?.thresholdCritical ?? null,
        threshold_warning: computed?.thresholdWarning ?? null,
      })
      .eq('id', syncId)

    // BRANCH 1 — BOOTSTRAP (no baseline yet)
    if (!computed) {
      await supabase
        .from('sync_results')
        .update({ status: 'UNVERIFIED_BASELINE' })
        .eq('id', syncId)
      await this.shiftBaseline(sync.broker_id, sync.agency_id, sync.carrier, rowsReturned, baseline)
      return { status: 'UNVERIFIED_BASELINE', deltaEngineAllowed: true }
    }

    const { baseline: B, thresholdCritical, thresholdWarning } = computed

    // BRANCH 2 — SYNC_HEALTHY
    if (rowsReturned >= thresholdWarning) {
      await supabase
        .from('sync_results')
        .update({ status: 'SYNC_HEALTHY' })
        .eq('id', syncId)
      await supabase
        .from('carrier_baselines')
        .update({ consecutive_degraded_count: 0, consecutive_suspect_count: 0 })
        .eq('broker_id', sync.broker_id)
        .eq('carrier', sync.carrier)
      await this.shiftBaseline(sync.broker_id, sync.agency_id, sync.carrier, rowsReturned, baseline)
      return { status: 'SYNC_HEALTHY', deltaEngineAllowed: true }
    }

    // BRANCH 3 — INCOMPLETE_RETRY_PENDING (50–79% of B)
    if (rowsReturned >= thresholdCritical) {
      const isRetry = sync.parent_sync_id !== null
      const retryCount = sync.retry_count

      await supabase
        .from('carrier_baselines')
        .update({ consecutive_degraded_count: (baseline.consecutive_degraded_count ?? 0) + 1 })
        .eq('broker_id', sync.broker_id)
        .eq('carrier', sync.carrier)

      if (isRetry && retryCount >= 2) {
        await supabase
          .from('sync_results')
          .update({ status: 'ANOMALY_FLAGGED' })
          .eq('id', syncId)
        return {
          status: 'ANOMALY_FLAGGED',
          deltaEngineAllowed: false,
          notifyBroker: true,
          message: 'Portal returning fewer members than expected',
        }
      }

      const retryAt = new Date(Date.now() + 4 * 3_600_000)
      await supabase
        .from('sync_results')
        .update({ status: 'INCOMPLETE_RETRY_PENDING' })
        .eq('id', syncId)
      await supabase.from('sync_results').insert({
        agency_id: sync.agency_id,
        broker_id: sync.broker_id,
        carrier: sync.carrier,
        sync_type: 'retry',
        status: 'RETRY_QUEUED',
        parent_sync_id: syncId,
        retry_count: retryCount + 1,
        next_retry_at: retryAt.toISOString(),
      })
      return {
        status: 'INCOMPLETE_RETRY_PENDING',
        deltaEngineAllowed: false,
        retryScheduledAt: retryAt.toISOString(),
      }
    }

    // BRANCH 4 — SYNC_SUSPECT (< 50% of B)
    const retryCount = sync.retry_count
    await supabase
      .from('carrier_baselines')
      .update({ consecutive_suspect_count: (baseline.consecutive_suspect_count ?? 0) + 1 })
      .eq('broker_id', sync.broker_id)
      .eq('carrier', sync.carrier)

    if (retryCount >= 2) {
      await supabase
        .from('carrier_baselines')
        .update({ circuit_breaker_active: true, circuit_breaker_set_at: new Date().toISOString() })
        .eq('broker_id', sync.broker_id)
        .eq('carrier', sync.carrier)
      await supabase
        .from('sync_results')
        .update({ status: 'CARRIER_PORTAL_DEGRADED' })
        .eq('id', syncId)
      return { status: 'CARRIER_PORTAL_DEGRADED', deltaEngineAllowed: false, circuitBreakerActivated: true }
    }

    if (retryCount === 1) {
      const retryAt = new Date(Date.now() + 6 * 3_600_000)
      await supabase
        .from('sync_results')
        .update({ status: 'SYNC_SUSPECT' })
        .eq('id', syncId)
      await supabase.from('sync_results').insert({
        agency_id: sync.agency_id,
        broker_id: sync.broker_id,
        carrier: sync.carrier,
        sync_type: 'retry',
        status: 'RETRY_QUEUED',
        parent_sync_id: syncId,
        retry_count: 2,
        next_retry_at: retryAt.toISOString(),
      })
      return { status: 'SYNC_SUSPECT', deltaEngineAllowed: false }
    }

    // Initial detection (retryCount === 0)
    const retryAt = new Date(Date.now() + 2 * 3_600_000)
    await supabase
      .from('sync_results')
      .update({ status: 'SYNC_BLOCKED' })
      .eq('id', syncId)
    await supabase.from('sync_results').insert({
      agency_id: sync.agency_id,
      broker_id: sync.broker_id,
      carrier: sync.carrier,
      sync_type: 'retry',
      status: 'RETRY_QUEUED',
      parent_sync_id: syncId,
      retry_count: 1,
      next_retry_at: retryAt.toISOString(),
    })
    return { status: 'SYNC_BLOCKED', deltaEngineAllowed: false }
  }

  // ── Public: cross-carrier degradation check ───────────────────────────────

  async checkCrossCarrierDegradation(agencyId: string): Promise<{
    multiCarrierDegraded: boolean
    affectedCarriers?: string[]
  }> {
    const supabase = this.db
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()

    const { data } = await supabase
      .from('sync_results')
      .select('carrier')
      .eq('agency_id', agencyId)
      .in('status', ['SYNC_SUSPECT', 'ANOMALY_FLAGGED'])
      .gte('created_at', twoHoursAgo)

    if (!data?.length) return { multiCarrierDegraded: false }

    const carriers = [...new Set(data.map(r => r.carrier))]
    if (carriers.length >= 2) {
      return { multiCarrierDegraded: true, affectedCarriers: carriers }
    }
    return { multiCarrierDegraded: false }
  }

  // ── Public: return pending retry jobs for the scheduler ───────────────────

  async processPendingRetries(): Promise<SyncResultRow[]> {
    const supabase = this.db
    const { data } = await supabase
      .from('sync_results')
      .select('id, broker_id, agency_id, carrier, retry_count, parent_sync_id')
      .eq('status', 'RETRY_QUEUED')
      .lte('next_retry_at', new Date().toISOString())

    return (data as SyncResultRow[]) ?? []
  }

  // ── Pure: thin wrapper over the exported standalone function ─────────────

  computeBaseline(baseline: Pick<BaselineRow, 'sync_count' | 's_minus_1' | 's_minus_2' | 's_minus_3' | 's_minus_4' | 's_minus_5' | 's_minus_6'>): BaselineResult | null {
    return computeBaseline(baseline)
  }

  // ── Private: shift the rolling baseline window ────────────────────────────

  private async shiftBaseline(
    brokerId: string,
    agencyId: string,
    carrier: string,
    newRowCount: number,
    current: BaselineRow,
  ): Promise<void> {
    const supabase = this.db
    await supabase
      .from('carrier_baselines')
      .update({
        s_minus_6: current.s_minus_5,
        s_minus_5: current.s_minus_4,
        s_minus_4: current.s_minus_3,
        s_minus_3: current.s_minus_2,
        s_minus_2: current.s_minus_1,
        s_minus_1: newRowCount,
        sync_count: (current.sync_count ?? 0) + 1,
        last_computed_at: new Date().toISOString(),
      })
      .eq('broker_id', brokerId)
      .eq('carrier', carrier)
  }

  // ── Private: fetch or create the baselines record ─────────────────────────

  private async getOrCreateBaseline(brokerId: string, agencyId: string, carrier: string): Promise<BaselineRow> {
    const supabase = this.db
    const { data: existing } = await supabase
      .from('carrier_baselines')
      .select('*')
      .eq('broker_id', brokerId)
      .eq('carrier', carrier)
      .maybeSingle()

    if (existing) return existing as BaselineRow

    const { data: created, error } = await supabase
      .from('carrier_baselines')
      .insert({ broker_id: brokerId, agency_id: agencyId, carrier, sync_count: 0 })
      .select('*')
      .single()

    if (error || !created) throw new Error(`getOrCreateBaseline insert failed: ${error?.message}`)
    return created as BaselineRow
  }
}
