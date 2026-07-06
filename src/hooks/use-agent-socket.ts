'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pushSystemFeed } from '@/lib/fx/system-feed';

export const AGENT_SOCKET_EVENTS_KEY = ['agent-socket', 'events'] as const;
export const AGENT_SOCKET_LATEST_KEY = ['agent-socket', 'latest'] as const;

export interface AgentSocketEvent {
  event: string;
  payload: Record<string, unknown>;
  ts: number;
}

const URL = process.env.NEXT_PUBLIC_AGENT_SOCKET_URL ?? 'ws://localhost:8765';
const CAP = 160;
const FLUSH_MS = 80;
const MIN_BACKOFF = 500;
const MAX_BACKOFF = 8000;

export function useAgentSocket(url: string = URL): void {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<AgentSocketEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(MIN_BACKOFF);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const flush = () => {
      flushTimerRef.current = null;
      const batch = bufferRef.current;
      if (batch.length === 0) return;
      bufferRef.current = [];

      qc.setQueryData<AgentSocketEvent[]>(AGENT_SOCKET_EVENTS_KEY, (prev = []) =>
        [...batch, ...prev].slice(0, CAP),
      );
      qc.setQueryData<Record<string, AgentSocketEvent>>(AGENT_SOCKET_LATEST_KEY, (prev = {}) => {
        const next = { ...prev };
        for (const event of batch) {
          const room = readRoom(event);
          if (room) next[room] = event;
        }
        return next;
      });
    };

    const scheduleFlush = () => {
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flush, FLUSH_MS);
      }
    };

    const connect = () => {
      if (!mountedRef.current) return;
      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        backoffRef.current = MIN_BACKOFF;
        pushSystemFeed('NETWORK', 'Local agent socket connected');
      };

      socket.onmessage = (message) => {
        const event = parseEvent(message.data);
        if (!event) return;
        bufferRef.current.push(event);
        scheduleFlush();
      };

      socket.onclose = () => {
        if (!mountedRef.current) return;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(MAX_BACKOFF, Math.floor(delay * 1.6));
        retryTimerRef.current = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [qc, url]);
}

function parseEvent(raw: unknown): AgentSocketEvent | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentSocketEvent>;
    if (typeof parsed.event !== 'string' || !parsed.payload || typeof parsed.payload !== 'object') {
      return null;
    }
    return {
      event: parsed.event,
      payload: parsed.payload as Record<string, unknown>,
      ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now() / 1000,
    };
  } catch {
    return null;
  }
}

function readRoom(event: AgentSocketEvent): string | null {
  const direct = event.payload.source_room ?? event.payload.sourceRoom ?? event.payload.room;
  if (typeof direct === 'string') return direct.toLowerCase();

  const nested = event.payload.payload;
  if (nested && typeof nested === 'object') {
    const value = (nested as Record<string, unknown>).room;
    if (typeof value === 'string') return value.toLowerCase();
  }

  return null;
}

