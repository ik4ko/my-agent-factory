# AegisSage Roster Sync — discovered extension contract

Status: **not integrated.** This document records what the existing extension
already expects. No Agent Factory route implements any of it yet, and nothing
should claim the extension works until a real job has been claimed, processed,
returned, stored, and displayed.

## Where the source is

`C:\Developer\New folder (2)\extension` — MV3, and the newest of three copies
(`background.js` / `popup.js` dated 2026-06-07). Two older copies exist under
`Desktop\Retention App\`; they differ and should be treated as stale.

| File | Lines | Role |
|---|---|---|
| `background.js` | 352 | Service worker. Token storage, all server calls. |
| `content.js` | 1420 | Per-carrier roster scrapers + the CMS MARx batch driver. |
| `popup.js` | 531 | Connect/disconnect, batch controls, progress. |
| `connect-bridge.js` | 46 | Relays a token from an aegissage.com page into the extension. |

## The problem

`background.js:1` sets `API_BASE = 'https://www.aegissage.com'`, and the
extension calls six endpoints there. **None of them exist.** The current
aegissage.com is the frozen marketing site; its API is `contact`,
`internal/lead-digest`, `internal/lead-health`, `internal/sync-leads`, `og`, and
`sms/webhook`. The extension was built against an earlier broker-dashboard
version of the site that is gone, so today it is pointed at a wall.

`manifest.json` also declares `externally_connectable` and a content script for
`aegissage.com` only, so the connect flow cannot reach Agent Factory either.

## Endpoints the extension expects

| Method | Path | Request | Response the extension reads |
|---|---|---|---|
| GET | `/api/extension/verify` | Bearer token | `{ valid, broker_id, agency_id, broker_name, agency_name }` |
| POST | `/api/extension/sync` | `{ carrier, rows }` | `{ total }` |
| POST | `/api/extension/ai-extract` | `{ carrier, html, url }` | `{ rows, total_found, confidence }` |
| GET | `/api/extension/sync-history` | Bearer token | sync list |
| GET | `/api/marx/members` | Bearer token | `{ members: [{ id, mbi, name, lastKnownPlanCode, state }] }` |
| POST | `/api/marx/verify` | see below | `{ changed: boolean }` |

Auth is a single opaque bearer token in `chrome.storage.local`, verified on
install, on startup, and before every store.

### `POST /api/marx/verify` payload

```
memberId, memberName, mbi, capturedName,
marxResult,              // the classification — see below
detectedPlanCode,        // contract-PBP read from the page
detectedCarrier, detectedFuturePlan, detectedFutureStart,
planCode, planName, effectiveDate, endDate, status,   // legacy duplicates
allEnrollments, hasActiveMA, onlyPartD, noResult
```

## The classification already implemented

`content.js:657` `classifyMarxResult()` compares the detected contract-PBP
against the `lastKnownPlanCode` the server supplied, and returns one of:

- `active_same` — plan matches the baseline
- `active_changed` — plan differs
- `pending_switch` — active now, future enrollment detected
- `no_ma_plan` — enrollment rows exist, no active MA contract
- `not_found` — no table on the page

`src/lib/medicare-crm/coverage.ts` uses these exact five strings as its
conclusive statuses, so the adapter is a transport concern rather than a
re-modelling one. `normalizeContractPbp()` deliberately mirrors the extension's
`normalizeMarxCode()` — **if those two ever diverge, unchanged plans start
alerting as changed.**

## What must change for Phase 4

1. Repoint `API_BASE` at the Agent Factory host, and update `manifest.json`
   `host_permissions` / `externally_connectable` to match. The extension is a
   local unpacked build, so this is not a website change.
2. Build the six routes on a **dedicated bearer-token lane** — never
   `requireMedicareOperator`, which is the human session gate.
3. `GET /api/marx/members` has to return **raw MBIs**; MARx lookup is
   impossible without them. Today `/api/medicare-crm` deliberately nulls MBI
   before anything leaves the server, and that boundary stays: the extension
   lane is a separate route with its own secret, its own audit trail, and no
   ability to read anything else.
4. Results write `ag_coverage_snapshots` and propose `ag_coverage_diffs`. They
   must never touch `ag_clients` or `ag_policies`.

## Things the extension already does right

- `background.js:270` refuses to persist member names to `chrome.storage.local`,
  noting they are HIPAA identifiers; the popup shows an index count instead.
- A 15-minute local rate-limit gate on MARx batches.
- Retry-with-backoff and a service-worker keepalive around page navigation.

## Not negotiable

No CAPTCHA, MFA, login, or access-control bypass. The extension runs inside
Eric's own authenticated browser session precisely so those controls stay
intact, and `coverageTaskCondition()` routes `mfa_required`,
`login_required`, and `captcha_encountered` to a human rather than to a retry.
