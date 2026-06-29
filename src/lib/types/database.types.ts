export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';
export type AgentType = 'generic' | 'coder' | 'researcher' | 'browser' | 'planner';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  current_task: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  agent_id: string | null;
  description: string;
  status: TaskStatus;
  created_at: string;
}

export interface Log {
  id: string;
  agent_id: string | null;
  message: string;
  level: LogLevel;
  timestamp: string;
}

export interface Memory {
  id: string;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export interface Database {
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
        Insert: Omit<Log, 'id'> & { id?: string };
        Update: Partial<Omit<Log, 'id'>>;
        Relationships: [];
      };
      memory: {
        Row: Memory;
        Insert: Omit<Memory, 'id' | 'updated_at'> & { id?: string; updated_at?: string };
        Update: Partial<Omit<Memory, 'id'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
