export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';
export type AgentType = 'generic' | 'coder' | 'researcher' | 'browser' | 'planner';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

// Phase C — human-in-the-loop intervention lifecycle (stored in tasks.intervention_state).
export type InterventionState = 'pending_approval' | 'approved' | 'denied';

// Orchestrator telemetry events (metrics.event).
// SEAT: routed to default worker · UP: escalated to Fable 5 · DOWN: forced
// Opus fallback · USAGE: post-completion token report · HALT: terminal failure
// · REAP: stale running-lock recycled to pending by the reaper.
export type ModelEvent = 'SEAT' | 'UP' | 'DOWN' | 'USAGE' | 'HALT' | 'REAP';

// Content channels — one row per content vertical (Faceless, Medicare,
// Personal, …). Channels are DATA: adding a vertical is an INSERT from the
// YouTube room, never a deploy. `slug` is written verbatim into
// tasks.assigned_lane, which is how src/lib/rooms/scope.ts scopes the room.
export type ContentChannel = {
  id: string;
  slug: string;
  label: string;
  niche: string;
  brand_voice: string;
  publish_targets: string[];
  active: boolean;
  created_at: string;
};

// A channel's actual presence on a platform. Its own table (not columns on
// content_channels) so one channel can hold a YouTube link and an Instagram
// link without a reshape. external_id is resolved ONCE at connect time and
// cached forever, so an expensive resolution is never repaid on refresh.
export type ContentChannelLink = {
  id: string;
  channel_id: string;
  platform: string;
  handle: string | null;
  external_id: string;
  connected_at: string;
  last_synced_at: string | null;
  /** Surfaced in the room instead of failing silently; cleared on next success. */
  last_error: string | null;
};

// INSERT-ONLY, never upserted — an immutable audit artifact, like tasks. Two
// rows are all a growth curve needs.
export type ContentChannelStatsSnapshot = {
  id: string;
  link_id: string;
  fetched_at: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  raw: Record<string, unknown>;
};

// Upserted per video — current state is the useful state here.
export type ContentChannelVideo = {
  id: string;
  link_id: string;
  external_video_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  last_synced_at: string;
};

// NOTE: these are `type` aliases (not interfaces) on purpose — supabase-js's
// GenericSchema requires Row/Insert/Update to satisfy Record<string, unknown>,
// which interfaces do not (they are open to declaration merging). Using type
// aliases is what makes typed .insert()/.update()/.rpc() resolve correctly.
export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  // NOTE: the DB column is current_task_id — a phantom `current_task` field
  // previously here caused silently-failing updates.
  current_task_id: string | null;
  created_at: string;
  // Additive fields (present in DB; optional here to avoid churn on existing call sites).
  type?: AgentType;
  last_heartbeat?: string | null;
  metadata?: Record<string, unknown>;
  // Phase C control-layer columns.
  paused?: boolean;
  halted_at?: string | null;
};

export type Task = {
  id: string;
  agent_id: string | null;
  description: string;
  status: TaskStatus;
  created_at: string;
  // Additive fields (present in DB).
  priority?: number;
  result?: Record<string, unknown> | null;
  updated_at?: string;
  // Phase C control-layer columns.
  intervention_state?: InterventionState | null;
  intervention_request?: string | null;
  intervention_feedback?: string | null;
  halted_at?: string | null;
  /** Model the orchestrator routed this task to (additive column). */
  model?: string | null;
  /**
   * Lane this task belongs to. TWO writers, disambiguated by value:
   *  - the orchestrator's route-lane hook writes a routing transition
   *    ('SEAT' | 'UP' | 'DOWN'), read back by triageTick;
   *  - the content pipeline writes a content_channels.slug, read back by
   *    src/lib/rooms/scope.ts (taskChannelSlug) to scope the YouTube room.
   * Typed as string because the column is free-form text and a channel slug
   * is operator-defined — narrowing it to the transitions would make the
   * type lie about what is actually stored.
   */
  assigned_lane?: string | null;
  /** Factory-built system prompt the worker executes with. */
  system_prompt?: string | null;
};

export type Metric = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  model: string;
  event: ModelEvent;
  /** UNCACHED prompt tokens only — see cache_* below for the rest. */
  input_tokens: number;
  output_tokens: number;
  /** Anthropic `cache_creation_input_tokens` — billed at 1.25x input. */
  cache_write_tokens?: number | null;
  /** Anthropic `cache_read_input_tokens` — billed at 0.1x input. */
  cache_read_tokens?: number | null;
  detail: string | null;
  created_at: string;
};

export type Log = {
  id: string;
  agent_id: string | null;
  message: string;
  level: LogLevel;
  timestamp: string;
  metadata?: Record<string, unknown>;
  // Present in DB; set by the sandbox runner so tool output ties to its task.
  task_id?: string | null;
};

export type Memory = {
  id: string;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
  // Additive fields (present in DB; optional here to avoid churn on existing call sites).
  source?: string | null;
  tags?: string[] | null;
};

// Return shape of the public.agent_emergency_stop() RPC.
export type EmergencyStopResult = {
  tasks_halted: number;
  agents_halted: number;
  halted_at: string;
};

// Phase 5/6 — staged (never executed) order proposals awaiting human review.
// Structurally identical to StagedOrder in trading.types.ts;
// redeclared as a type alias so Database Row typing stays supabase-js
// compatible (see NOTE on type aliases above).
export type StagedOrderIntentKind = 'legacy' | 'option_intent';
export type OptionIntentAction = 'buy_to_open' | 'sell_to_close' | 'sell_to_open' | 'buy_to_close';
export type OptionPriceEffect = 'debit' | 'credit';

export type StagedOrderRow = {
  id: string;
  underlying: string;
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiration: string;
  execution_type: 'LIMIT';
  limit_price: number;
  calculated_position_size_usd: number;
  human_approval_status: 'PENDING' | 'APPROVED' | 'DENIED';
  pipeline_id: string | null;
  kelly_fraction: number | null;
  expectancy: number | null;
  win_rate: number | null;
  r_multiple: number | null;
  source: 'SANDBOX' | 'LIVE';
  intent_kind: StagedOrderIntentKind;
  action: OptionIntentAction | null;
  contracts: number | null;
  price_effect: OptionPriceEffect | null;
  max_premium_usd: number | null;
  max_loss_usd: number | null;
  strategy_label: string | null;
  source_signal_id: string | null;
  created_at: string;
};

// Phase 9 — federated room event log. Dashboard reads; system writes.
export type SystemBusRow = {
  id: string;
  topic: 'pipeline.step.completed' | 'pipeline.completed' | 'agent.thought' | 'operator.telegram.update' | 'control.estop';
  agent: string | null;
  pipeline_id: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'consumed' | 'failed';
  created_at: string;
  consumed_at: string | null;
};

// Phase 8.2 — sweep-orchestrator watchlist (service-role access only).
export type TickerWatchlistRow = {
  symbol: string;
  is_active: boolean;
  updated_at: string;
};

// Phase 8 — singleton liquid-cash state (service-role access only).
export type PortfolioStateRow = {
  id: string;
  total_liquid_cash: number;
  updated_at: string;
};

// Phase Loops — standing objectives the system re-evaluates on a cadence
// and/or in reaction to events (news/price/manual).
// 'content_sync' refreshes connected YouTube channels on cadence. Unlike the
// research/build/personal kinds it spends NO tokens — it calls the read-only
// fetcher directly, so it must never fall through to the brain-decision branch.
export type LoopKind = 'trade' | 'research' | 'build' | 'personal' | 'monitor' | 'content_sync';
export type LoopStatus = 'armed' | 'paused' | 'stopped';
export type LoopTrigger = { type: 'news' | 'price' | 'earnings' | 'manual'; symbol?: string; minSeverity?: EventSeverity };

export type LoopRow = {
  id: string;
  name: string;
  kind: LoopKind;
  objective: string;
  status: LoopStatus;
  cadence_seconds: number | null;
  triggers: LoopTrigger[];
  config: Record<string, unknown>;
  brain: string;
  last_tick_at: string | null;
  next_tick_at: string | null;
  lock_owner: string | null;
  lock_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LoopRunStatus = 'running' | 'completed' | 'failed';
export type LoopRunRow = {
  id: string;
  loop_id: string | null;
  trigger: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  actions: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  status: LoopRunStatus;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

// Work-session indicator v0 — one row per agent work session; the header
// chip shows the newest active row whose heartbeat is fresh (<3 min).
export type WorkSessionStatus = 'active' | 'finished';
export type WorkSessionRow = {
  id: string;
  agent_name: string;
  task_summary: string;
  touched_files: string[];
  status: WorkSessionStatus;
  started_at: string;
  last_heartbeat_at: string;
  finished_at: string | null;
};

// Event bus — market/news signals that can trigger an immediate loop run.
export type EventType = 'news' | 'price' | 'earnings' | 'manual';
export type EventSeverity = 'low' | 'med' | 'high' | 'critical';
export type EventRow = {
  id: string;
  type: EventType;
  symbol: string | null;
  severity: EventSeverity | null;
  payload: Record<string, unknown>;
  consumed: boolean;
  created_at: string;
};

// Executed (or dry-run) orders placed by a loop, distinct from the
// human-approval staged_orders queue.
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'intent' | 'risk_blocked' | 'dry_run' | 'submitted' | 'filled' | 'rejected' | 'canceled';
export type OrderRow = {
  id: string;
  client_order_id: string | null;
  loop_id: string | null;
  symbol: string;
  side: OrderSide;
  qty: number | null;
  notional: number | null;
  type: OrderType;
  limit_price: number | null;
  status: OrderStatus;
  broker_id: string | null;
  fill_price: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

// Phase 3 — deterministic Regime Controller state (tighten-only, bounded by
// the operator's base caps; see src/lib/events/regime.ts).
export type Regime = 'NORMAL' | 'VOLATILE' | 'CRITICAL_HALT';
export type SymbolOverride = {
  blocked?: boolean;
  sizeMultiplier?: number;
  reason: string;
  since: string;
};

// Global risk/kill-switch singleton (id is always 1).
export type RiskStateRow = {
  id: number;
  day: string;
  realized_pnl: number;
  halted: boolean;
  halt_reason: string | null;
  trading_enabled: boolean;
  kill_switch: boolean;
  regime: Regime;
  symbol_overrides: Record<string, SymbolOverride>;
  feed_degraded: boolean;
  feed_degraded_reason: string | null;
  regime_updated_at: string | null;
  updated_at: string;
};

// Live-quote cache (one row per symbol) — populated by the loop-worker's
// Finnhub REST poll cycle, read by the dashboard and (via getMarketContext's
// own Yahoo-backed path) the risk gate. This table is a display/trigger
// cache, not the source of truth the risk gate sizes orders against.
export type QuoteRow = {
  symbol: string;
  price: number;
  change: number | null;
  change_pct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prev_close: number | null;
  source: string;
  updated_at: string;
};

// Medicare CRM (ag_*) — isolated room-owned tables. Keep these as aliases so
// Supabase's GenericSchema can infer insert/update payloads correctly.
export type AgAgencySettings = {
  id: string;
  agency_name: string;
  npn: string | null;
  resident_state: string | null;
  licensed_states: string[];
  ahip_status: string;
  ahip_expires_at: string | null;
  hipaa_status: string;
  hipaa_expires_at: string | null;
  compliance_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export type AgFmo = { id: string; name: string; status: string; start_date: string | null; notes: string; created_at: string; updated_at: string };
export type AgCarrier = { id: string; name: string; fmo_id: string | null; appointment_status: string; lines_of_business: string[]; active_states: string[]; created_at: string; updated_at: string };
export type AgClient = { id: string; first_name: string; last_name: string; phone: string | null; email: string | null; date_of_birth: string | null; physical_address: string | null; city: string | null; state: string | null; zip: string | null; medicare_beneficiary_identifier: string | null; tags: string[]; created_at: string; updated_at: string };
export type AgClientNote = { id: string; client_id: string; note: string; created_at: string; created_by: string | null };
export type AgPolicy = { id: string; client_id: string; carrier_id: string | null; fmo_id: string | null; plan_name: string; plan_id: string | null; effective_date: string | null; monthly_premium: number | null; commission_level: string | null; status: string; created_at: string; updated_at: string };
export type AgCommunication = { id: string; client_id: string; type: string; content: string; direction: string; timestamp: string; source_metadata: Record<string, unknown>; created_at: string };
export type AgComplianceDocument = { id: string; client_id: string | null; document_type: string; title: string; storage_path: string | null; expires_at: string | null; uploaded_at: string; notes: string };

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: Agent;
        Insert: Omit<Agent, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<Agent, 'id' | 'created_at'>>;
        Relationships: [];
      };
      tasks: {
        Row: Task;
        Insert: Omit<Task, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<Task, 'id' | 'created_at'>>;
        Relationships: [];
      };
      logs: {
        Row: Log;
        Insert: Omit<Log, 'id' | 'agent_id' | 'timestamp'> & {
          id?: string;
          agent_id?: string | null;
          timestamp?: string;
        };
        Update: Partial<Omit<Log, 'id'>>;
        Relationships: [];
      };
      memory: {
        Row: Memory;
        Insert: Omit<Memory, 'id' | 'updated_at'> & { id?: string; updated_at?: string };
        Update: Partial<Omit<Memory, 'id'>>;
        Relationships: [];
      };
      metrics: {
        Row: Metric;
        Insert: Omit<Metric, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<Metric, 'id'>>;
        Relationships: [];
      };
      system_bus: {
        Row: SystemBusRow;
        Insert: Omit<SystemBusRow, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Pick<SystemBusRow, 'status' | 'consumed_at'>>;
        Relationships: [];
      };
      ticker_watchlist: {
        Row: TickerWatchlistRow;
        Insert: Omit<TickerWatchlistRow, 'is_active' | 'updated_at'> & {
          is_active?: boolean;
          updated_at?: string;
        };
        Update: Partial<Omit<TickerWatchlistRow, 'symbol'>>;
        Relationships: [];
      };
      portfolio_state: {
        Row: PortfolioStateRow;
        Insert: Omit<PortfolioStateRow, 'id' | 'updated_at'> & { id?: string; updated_at?: string };
        Update: Partial<Omit<PortfolioStateRow, 'id'>>;
        Relationships: [];
      };
      staged_orders: {
        Row: StagedOrderRow;
        Insert: Omit<
          StagedOrderRow,
          | 'created_at'
          | 'intent_kind'
          | 'action'
          | 'contracts'
          | 'price_effect'
          | 'max_premium_usd'
          | 'max_loss_usd'
          | 'strategy_label'
          | 'source_signal_id'
        > & {
          created_at?: string;
          intent_kind?: StagedOrderIntentKind;
          action?: OptionIntentAction | null;
          contracts?: number | null;
          price_effect?: OptionPriceEffect | null;
          max_premium_usd?: number | null;
          max_loss_usd?: number | null;
          strategy_label?: string | null;
          source_signal_id?: string | null;
        };
        // Only the human decision is mutable — everything else is immutable.
        Update: Partial<Pick<StagedOrderRow, 'human_approval_status'>>;
        Relationships: [];
      };
      loops: {
        Row: LoopRow;
        Insert: Omit<LoopRow, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<LoopRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      loop_runs: {
        Row: LoopRunRow;
        Insert: Omit<LoopRunRow, 'id' | 'started_at'> & { id?: string; started_at?: string };
        Update: Partial<Omit<LoopRunRow, 'id' | 'loop_id'>>;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: Omit<EventRow, 'id' | 'created_at' | 'consumed'> & { id?: string; created_at?: string; consumed?: boolean };
        Update: Partial<Omit<EventRow, 'id'>>;
        Relationships: [];
      };
      orders: {
        Row: OrderRow;
        Insert: Omit<OrderRow, 'id' | 'created_at' | 'updated_at' | 'client_order_id'> & { id?: string; client_order_id?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Omit<OrderRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      risk_state: {
        Row: RiskStateRow;
        Insert: Partial<RiskStateRow> & { id?: number };
        Update: Partial<Omit<RiskStateRow, 'id'>>;
        Relationships: [];
      };
      quotes: {
        Row: QuoteRow;
        Insert: Omit<QuoteRow, 'updated_at'> & { updated_at?: string };
        Update: Partial<Omit<QuoteRow, 'symbol'>>;
        Relationships: [];
      };
      ag_agency_settings: {
        Row: AgAgencySettings;
        Insert: Omit<AgAgencySettings, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AgAgencySettings, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_fmos: {
        Row: AgFmo;
        Insert: Omit<AgFmo, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AgFmo, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_carriers: {
        Row: AgCarrier;
        Insert: Omit<AgCarrier, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AgCarrier, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_clients: {
        Row: AgClient;
        Insert: Omit<AgClient, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AgClient, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_client_notes: {
        Row: AgClientNote;
        Insert: Omit<AgClientNote, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<AgClientNote, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_policies: {
        Row: AgPolicy;
        Insert: Omit<AgPolicy, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string };
        Update: Partial<Omit<AgPolicy, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_communications_log: {
        Row: AgCommunication;
        Insert: Omit<AgCommunication, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<AgCommunication, 'id' | 'created_at'>>;
        Relationships: [];
      };
      ag_compliance_documents: {
        Row: AgComplianceDocument;
        Insert: Omit<AgComplianceDocument, 'id' | 'uploaded_at'> & { id?: string; uploaded_at?: string };
        Update: Partial<Omit<AgComplianceDocument, 'id' | 'uploaded_at'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      agent_emergency_stop: {
        Args: Record<string, never>;
        Returns: EmergencyStopResult;
      };
      decide_task_intervention: {
        Args: { p_task_id: string; p_decision: 'approve' | 'deny'; p_feedback?: string | null };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
