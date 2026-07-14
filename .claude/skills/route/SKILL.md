---
name: route
description: Cross-model build loop — Fable plans and reviews, Codex builds via codex exec, with an adversarial plan critique before any code is written and a review-fix loop until approved. Trigger with /route <task description>.
---

# /route — Fable plans, Codex builds

Human-triggered, same-session, interactive. This is NOT unattended automation:
no Telegram gates, no sprint_loops, none of the Autonomous Loop Engine
infrastructure applies. The human is in the loop the whole time — the gate is
this conversation itself. (The engine on Render is the tool for unattended
multi-step sprints; do not conflate the two.)

## Verified CLI facts (do not re-derive from screenshots or memory)

Verified against installed codex-cli 0.144.3 (`codex --help`, `codex exec
--help`, 2026-07-13) and the codex config reference:

- Non-interactive build: `codex exec [OPTIONS] "<prompt>"`
- Sandbox: `-s read-only | workspace-write | danger-full-access`
- Working root: `-C <dir>` · final message to file: `-o <file>` · JSONL events: `--json`
- Continue the SAME session with follow-up instructions: `codex exec resume --last "<prompt>"`
- Model override: `-m <model>`. `gpt-5.6-sol` is a real, current model id
  (verified in the live OpenRouter catalog 2026-07-13), but availability
  depends on the user's ChatGPT plan — so DEFAULT TO OMITTING `-m` (the CLI's
  configured default model) and only pin a model if the user asks.
- Reasoning effort is a CONFIG KEY, not a flag: `-c model_reasoning_effort="minimal|low|medium|high|xhigh"`
  (default medium). Use `high` for the build step, `low` for the critique step.
- NEVER use `--dangerously-bypass-approvals-and-sandbox` or expand the sandbox
  beyond `workspace-write`.
- `codex login status` must say logged in; if not, STOP and tell the user to
  run `codex login` themselves — never authenticate on their behalf.

## Workflow

### 1. PLAN (Fable — you)
Understand the task (run `graphify query` first, per repo rules). Produce a
concrete plan: files to touch, exact changes, test/typecheck strategy, and a
checkable definition of done. Show it to the user compactly.

### 2. ADVERSARIAL CRITIQUE (Codex, read-only — before ANY code)
Cross-model disagreement is the point: have Codex attack the plan, not bless it.

```
codex exec -s read-only -C "<repo root>" -c model_reasoning_effort="low" \
  -o "<scratchpad>/route-critique.txt" \
  "Adversarially critique this implementation plan for this repo. Attack assumptions, find what breaks, name simpler alternatives. Do NOT write code. PLAN: <plan text>"
```

Fold real objections into the plan; note rejected objections with one-line
reasons. If the critique changes the plan materially, show the user the delta
before building.

### 3. BUILD (Codex, workspace-write)
```
codex exec -s workspace-write -C "<repo root>" -c model_reasoning_effort="high" \
  -o "<scratchpad>/route-build.txt" \
  "<the approved plan, phrased as build instructions, with the definition of done>"
```
Codex commits nothing itself; work lands in the working tree.

### 4. REVIEW (Fable — you)
Read the actual diff (`git diff` / `git status`), run typecheck and the
relevant tests yourself, and judge against the definition of done. Do not
trust the build summary — verify.

### 5. FIX LOOP (until approved)
For each review finding, continue the same Codex session so context carries:
```
codex exec resume --last -s workspace-write -c model_reasoning_effort="high" \
  "Fix these review findings: <numbered findings>"
```
Re-review after each round. Exit the loop only when the review passes and
typecheck/tests are green — then report to the user with the final diff stat,
what the critique changed, and any leftovers. The user decides whether to
commit; /route itself never commits or pushes.
