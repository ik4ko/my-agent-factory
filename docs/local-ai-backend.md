# Local AI backend

How to point the app's LLM traffic at a local OpenAI-compatible server
(LM Studio, Ollama, vLLM, llama.cpp-server) instead of hosted providers.

## Where model calls happen

| Call site | Path | Backend selection |
|---|---|---|
| `AgentRegistry` (CLAUDE lane) | `src/lib/agents/registry.ts` | Anthropic SDK direct — honors `ANTHROPIC_BASE_URL` |
| `AgentRegistry` (CODEX + fallback lanes) | `src/lib/agents/registry.ts` | `resolveChatBackend()` |
| Brain-matrix dispatcher (OpenRouter lanes: HERMES, GEMINI, GROK, SCOUT, mentors, LEGAL, DESIGN, SOCIAL, MARKETING, …) | `src/app/actions/agent-dispatcher.ts` | `resolveChatBackend()` |
| Brain-matrix `anthropic-direct` lane (CLAUDE) | `src/app/actions/agent-dispatcher.ts` | Anthropic SDK — honors `ANTHROPIC_BASE_URL` |
| Brain-matrix `openai-direct` lane (CODEX) | `src/app/actions/agent-dispatcher.ts` | OpenAI SDK (Responses API) — honors `OPENAI_BASE_URL` |
| Brain-matrix `nvidia-direct` lane (NEMOTRON) | `src/app/actions/agent-dispatcher.ts` | Hardcoded NVIDIA endpoint (experimental free tier; not abstracted) |
| `/api/converse` | `src/app/api/converse/route.ts` | Goes through `AgentRegistry.think()` — inherits the abstraction |

`resolveChatBackend()` lives in `src/lib/agents/backend-config.ts` and is
resolved at **call time**, so an env change takes effect on the next request.

## Switching to a local server

```bash
# .env.local
AI_LOCAL_BASE_URL=http://127.0.0.1:1234/v1   # LM Studio default
# AI_LOCAL_BASE_URL=http://127.0.0.1:11434/v1  # Ollama
AI_LOCAL_MODEL=qwen2.5-coder-14b             # optional: force one served model
# AI_LOCAL_API_KEY=...                        # optional: most local servers ignore auth
```

With `AI_LOCAL_BASE_URL` set, every OpenRouter-lane call is rerouted to the
local server; the OpenRouter monthly budget gate is skipped (local inference
is free) and telemetry rows are tagged `provider=local` with `est_usd=0`.

Without `AI_LOCAL_MODEL`, the lane's configured OpenRouter slug (e.g.
`anthropic/claude-sonnet-4.6`) is sent verbatim — set the override unless your
local server aliases those names.

## What the local server must implement

Non-streaming chat completions only (the app never requests `stream: true`
on this path):

```
POST {AI_LOCAL_BASE_URL}/chat/completions
Authorization: Bearer <AI_LOCAL_API_KEY or "local-no-key">
Content-Type: application/json

{ "model": "...", "max_tokens": 2048, "temperature": 0.4,
  "messages": [{ "role": "system"|"user"|"assistant", "content": "..." }] }
```

Expected response:

```
{ "choices": [{ "message": { "content": "..." } }],
  "usage": { "prompt_tokens": n, "completion_tokens": n } }   // usage optional
```

Timeouts: 120 s (registry) / 60 s (dispatcher). An empty `content` is treated
as a failure.

## Verification

`src/lib/agents/__tests__/backend-config.test.ts` runs the real
`AgentRegistry.CODEX.think()` against an in-process stub server and asserts
the wire shape above — run `npm test` after touching any of this.
