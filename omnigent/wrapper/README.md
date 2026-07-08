# Omnigent trigger wrapper

Resolves the Phase 2 production blocker in `docs/omnigent-integration-plan.md`
§4: Vercel can't hold the Omnigent runner's long-lived tunnel connection, and
there's no pure-REST way to trigger a turn on an already-registered runner.
This is a thin, dependency-free HTTP shim that runs on the same **persistent
host** the runner already needs (never on Vercel) — Vercel calls it over
plain HTTPS, exactly like any other external API it already calls; this
process is the only thing that shells out to the `omnigent` CLI.

**Verified live** (see the integration plan's Phase 2 update): a real HTTP
POST to `/trigger` produced a genuine new Omnigent session with the actual
model reply, confirmed independently via Omnigent's own `/v1/sessions` API.

## Run it

```bash
export OMNIGENT_SERVER_URL=http://127.0.0.1:6767   # or your deployed server's URL
export WRAPPER_AUTH_TOKEN_FILE=/path/to/token       # or WRAPPER_AUTH_TOKEN=<value>
node server.mjs
```

## API

`GET /health` → `{ "ok": true }`

`POST /trigger` (`Authorization: Bearer <token>`)
```json
{ "harness": "openai-agents", "prompt": "...", "model": "optional-override" }
```
→ `{ "ok": true, "output": "..." }` or `{ "ok": false, "error": "..." }`

`harness` must be one of `openai-agents` / `claude-sdk` (the SDK-based
harnesses — no separate CLI login needed, see the integration plan's Phase 1
for why). Not `codex`/`claude`/etc. — those need their own installed CLI and
credential, not wired here.

## Deploying

`Dockerfile` + `render.yaml` in this directory are a reviewed-but-not-applied
deploy config (Render, matching Omnigent's own documented easiest path). Set
`OMNIGENT_SERVER_URL` to your deployed Omnigent server before launching the
blueprint. Deploying is a separate, explicit decision — nothing here has been
applied to a paid host.
