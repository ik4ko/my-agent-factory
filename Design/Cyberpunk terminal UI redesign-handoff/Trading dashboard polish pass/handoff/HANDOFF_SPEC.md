# HANDOFF SPEC — Trading Dashboard polish (Phase 1 + 2)

Port target: `src/app/globals.css`, `tailwind.config.ts`, and the dashboard
components (`src/components/dashboard/*`, `src/components/deck/*`).
Reference implementation: `Trading Dashboard.dc.html` in this folder (open in a
browser next to `support.js`) — it is the source of truth for every value below.

## 1. Token table

| Token | Value | Use |
|---|---|---|
| bg-base | `#0b0c0e` | app background (matte charcoal, no blue cast) |
| bg-surface | `#101115` | safety strip, palette body |
| bg-panel | `linear-gradient(180deg, #131418, #0e0f12)` | standard panels |
| bg-terminal | `#0d0e11` | ledger/terminal panel, 3D scene bg |
| bg-chrome | `#0e0f12` | nav rail, top bar |
| hairline | `rgba(158,164,178,0.08)` | panel borders, dividers |
| hairline-soft | `rgba(158,164,178,0.05–0.06)` | row borders, in-panel dividers |
| text-hi | `#e8eaef` | primary values, headings |
| text-mid | `#a2a8b4` | body/data |
| text-label | `#7a8290` | small-caps panel labels |
| text-dim | `#565c68` | metadata, hints |
| text-faint | `#4f5563` | ledger timestamps, DBG level |
| accent | `#a3b1f7` | ice-violet primary (replaces cyan `#06b6d4`/`#38bdf8`) |
| accent-hover | `#c3cdfa` | link/button hover |
| accent-deep | `#8494f0` | secondary accent (fills, lights) |
| accent-tint(α) | `rgba(163,177,247, α)` | borders .2–.35 · bg .04–.14 |

**Do NOT change (highest-contrast trio + P&L):**
price green `#34d399` · price red `#f87171` · NOVA amber `#fbbf24` · E-STOP red `#ef4444`.

## 2. Typography

Load variable axes (not fixed weights):
`https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&family=Space+Grotesk:wght@300..700&display=swap`

- **JetBrains Mono** — all data: tickers, prices, timestamps, ledger, badges,
  small-caps panel labels. Labels: 9px, uppercase, `letter-spacing: 0.14em`
  (tightened from 0.2em), color text-label.
- **Space Grotesk** — chat dialogue only (CEO + agent bubbles, chat input):
  13px, `line-height: 1.6`.

## 3. Grid & components

- 8px scale everywhere: grid gap 8px, grid padding 8px, panel body padding 8px,
  card padding 8–16px.
- Panel header: fixed **32px** height, 0 12px padding, hairline-soft bottom
  border, mono label per §2.
- Corner brackets: every panel gets exactly two — top-left + top-right, 12×12px,
  1px `rgba(163,177,247,0.35)`.
- Chat bubbles (both CEO and agent, identical): padding `10px 14px`,
  `max-width: 78%`, radius 9px. CEO right-aligned, bg `accent-tint(.08)`,
  border `accent-tint(.25)`; agent left, bg `rgba(255,255,255,0.02)`, border hairline.

## 4. Micro-interactions (all gated by a `motion` flag AND `prefers-reduced-motion`)

```css
@keyframes msgIn    { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }  /* chat msgs, 180ms ease-out */
@keyframes ledgerNew{ 0% { background: rgba(163,177,247,0.14); } 100% { background: transparent; } }          /* new ledger rows, 1.4s ease-out */
@keyframes digitIn  { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } } /* price digits, 150ms */
```
- Digit roll: render price as per-char spans with React `key={index + '-' + char}`
  so only changed digits remount and animate.
- Row hover (watchlist + staged intents): background lift to
  `rgba(255,255,255,0.035)`, `transition: background 0.15s`. **No glow/shadow.**

## 5. Phase 2 layer

- **Grain**: one fixed full-viewport div, top z-index, `pointer-events: none`,
  `opacity: 0.03`, tiled 160px SVG:
  `feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"` as data-URI background. Single layer, static.
- **Weight tween** on interactive text (E-STOP, APPROVE/REJECT, ticker symbols,
  active nav): base `font-variation-settings: 'wght' 700`, hover/focus `'wght' 800`
  (regular-weight text: 400→500), `transition: font-variation-settings 0.15s`.
  No new color/scale hover states.
- **⌘K / Ctrl+K palette**: 480px, bg `#101115`, border `accent-tint(.25)`,
  centered ~160px from top over `rgba(11,12,14,0.6)` scrim. Fuzzy subsequence
  filter on labels. Item kinds: `ACTION` (kind label amber `#fbbf24`) — trigger/
  reset E-STOP, switch sim↔live, toggle motion; `PANEL` — jump = flash target
  panel `outline: 2px solid #a3b1f7` for 900ms; `TICKER` — flash watchlist.
  Keys: ↑↓ navigate, ↵ run, Esc dismiss; selected row bg `accent-tint(.10)`.
  Remove the keydown listener on unmount.
- **Tones** (only two events, nothing else): WebAudio sine, gain envelope
  `0.0001 → 0.03 → 0.0001` over ~140ms. E-STOP arm = 220Hz; staged-intent
  approve = 660Hz. Gate behind the motion/still flag; wrap in try/catch;
  resume a suspended AudioContext before playing.

## 6. Scope guards

- **SpatialWorkspace / 3D orbit: logic untouched** — node placement, drag orbit,
  scroll zoom, camera easing stay exactly as-is. Color-only re-token: scene bg +
  fog `0x0d0e11`, grid `0x24262e` / `0x16181d`, ambient `0x3a3f55`, key light
  `0xa3b1f7`, fill `0x8494f0`; node hexes hermes `0xa3b1f7`, codex `0xb7a8f7`,
  grok `0x8ec5ff`, idle `0x64748b`.
- Native vibrancy: skipped (browser app, no shell compositor access).
- Scroll-driven animations: N/A — no JS scroll-listener reveals exist.
