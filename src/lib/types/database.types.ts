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
  /** Lane assigned by the router engine (SEAT | UP | DOWN). */
  assigned_lane?: 'SEAT' | 'UP' | 'DOWN' | null;
  /** Factory-built system prompt the worker executes with. */
  system_prompt?: string | null;
};

export type Metric = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  model: string;
  event: ModelEvent;
  input_tokens: number;
  output_tokens: number;
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
};

export type Memory = {
  id: string;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
};

// Return shape of the public.agent_emergency_stop() RPC.
export type EmergencyStopResult = {
  tasks_halted: number;
  agents_halted: number;
  halted_at: string;
};

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
    };
    Views: Record<string, never>;
    Functions: {
      agent_emergency_stop: {
        Args: Record<string, never>;
        Returns: EmergencyStopResult;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
