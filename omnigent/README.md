# Omnigent runner notes (scaffold)

This directory holds config/notes for a future Omnigent integration. Nothing
here is wired into the app yet — see `docs/omnigent-integration-plan.md` for
the full plan.

## Why WSL2

Omnigent has no native Windows runner. On this machine, the runner must be
started inside a WSL2 distro; the Next.js app (running natively on Windows in
dev) talks to it over loopback, the same pattern already used for the local
trading tick bridge (`core/ipc_bridge.py` → `ws://localhost:8765`, see
`src/hooks/use-agent-socket.ts`).

## Scope: dev-only for now

Vercel (production) cannot run WSL2 or Omnigent's sandbox. Until Omnigent ships
a hosted/container-friendly runner, treat this integration as a local
developer-experience layer only — production cross-agent visibility keeps
coming from Supabase, unchanged.

## Networking [VERIFY before first real run]

Whether the Windows host can reach the WSL2-hosted runner via plain
`localhost:<port>` depends on the WSL2 networking mode:

- **Mirrored mode** (`.wslconfig` → `[wsl2] networkingMode=mirrored`, Windows
  11 23H2+): `localhost` from Windows reaches WSL2 services directly — no
  extra step.
- **NAT mode** (older default): needs either `wsl hostname -I` to get the
  WSL2 VM's IP and point the bridge client at that instead of `localhost`, or
  a `netsh interface portproxy` rule forwarding a Windows-side port into WSL2.

This has not been determined on this machine — confirm before wiring
`src/lib/omnigent/bridge.ts` up to a real runner.

## Files

- `bridge.config.example.json` — placeholder event-mapping config (which
  local agent/task events get mirrored out, and under what event names).
  Copy to `bridge.config.json` (gitignored) once real values exist; never
  commit real endpoints/tokens here.
