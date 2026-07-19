# Operator runbook

## Trading Room: paper simulation only

The Trading Room retains staging, analysis, expectancy/Kelly sizing, autonomous loops, risk caps, and the paper order ledger. This repository has no live-broker adapter, Robinhood sidecar, broker credentials, or runtime flag capable of submitting a real order.

1. Start the app with `npm run dev`.
2. Start autonomous loop processing with `npm run loop-worker` when desired.
3. Open `/dashboard/rooms/trading` for analysis and staging.
4. Open `/dashboard/golive` for simulation preflight, self-test, simulation arm/disarm, and the simulation stop switch.
5. Inspect paper results in `orders` (`status='dry_run'`) and loop decisions in `loop_runs`.

`risk_state.trading_enabled` now means “paper simulation enabled.” The operator PIN remains a defense-in-depth gate for control commands; it cannot unlock live trading because no live execution implementation exists.

## Communications: Telegram only

Telegram is implemented independently under `omnigent/wrapper/`:

- `TELEGRAM_BOT_TOKEN` configures the Bot API client.
- `TELEGRAM_OPERATOR_CHAT_ID` is the allowlisted operator chat.
- Telegram update IDs are durably deduplicated before consequential actions.
- Staged-order approve/deny records a decision only; it never dispatches an order.

The dashboard command simulator at `/api/comms/simulate` remains session-authenticated and uses the shared deterministic command/PIN core. It is not a phone endpoint.

There are no SMS or phone/voice routes, Twilio transport, Vapi/Retell bindings, or corresponding secrets. Email delivery remains available through `GMAIL_USER` and `GMAIL_APP_PASSWORD`.

## Emergency controls

- The global emergency stop halts agent/task orchestration.
- Trading simulation arm/disarm, halt, and stop controls mutate `risk_state` and are audited.
- The simulation stop switch blocks new paper orders and closes any legacy `submitted` ledger rows locally. It cannot contact a broker.

## Verification

Run:

```powershell
npm run typecheck
npm test -- --runInBand
npm run build
```

The production route table must not contain `/api/phone/sms` or `/api/phone/voice`.
