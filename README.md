# my-agent-factory · Agent Control Room

Real-time dashboard for orchestrating a fleet of AI agents (with **Hermes** as the
coordinating brain). The UI is a command-center: live agent fleet status, a task
feed, a streaming log terminal, and a memory viewer — all driven by Supabase
Realtime.

## Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack) · React 19
- **Styling**: Tailwind CSS + Radix UI primitives (shadcn-style components)
- **Data / server state**: TanStack Query, hydrated from SSR
- **Client state**: Zustand (realtime connection status)
- **Backend**: Supabase — Postgres, Row Level Security, and Realtime
  (`agents`, `tasks`, `logs`, `memory` tables are in the `supabase_realtime` publication)
- **AI**: Anthropic SDK + Genkit (Google Gemini)
- **Layout**: `react-resizable-panels` for the resizable command grid

## Realtime architecture

Each live surface subscribes through a hook (`useRealtimeAgents`,
`useRealtimeTasks`, `useRealtimeLogs`). Subscriptions go through
`subscribeWithReconnect` (`src/lib/supabase/realtime.ts`), which adds
channel-level auto-reconnect with exponential backoff on `CHANNEL_ERROR` /
`TIMED_OUT` / unexpected `CLOSED`, and reports lifecycle status into a Zustand
store (`src/lib/realtime/connection-store.ts`). The header
`ConnectionIndicator` reflects the true connection state (LIVE / CONNECTING /
RECONNECTING / OFFLINE) instead of a hardcoded badge.

Every dashboard widget is wrapped in a `WidgetErrorBoundary`, so a single
failing stream degrades to a recoverable panel rather than crashing the room.

## Getting started

```bash
npm install
npm run dev          # http://localhost:9002
```

Set the following in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
DASHBOARD_PASSWORD=...   # operator passphrase — gates the dashboard and every API route
```

## Auth

`src/middleware.ts` protects `/`, `/dashboard`, and all `/api/*` routes (every
route performs service-role writes; `/api/hermes/command` spends Anthropic
tokens). `/login` exchanges the `DASHBOARD_PASSWORD` passphrase for an
HMAC-signed, HTTP-only session cookie (7-day TTL, edge-verified via Web Crypto
— see `src/lib/auth/session.ts`). Login attempts are throttled (5/min/IP).
Unset password: fails open in dev, 503 in production. Existing client fetches
needed no changes — the cookie rides along automatically.

## Scripts

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Dev server (Turbopack) on port 9002  |
| `npm run build`    | Production build                     |
| `npm run typecheck`| `tsc --noEmit`                       |
| `npm run lint`     | Next.js lint                         |
| `npm test`         | Jest                                 |
