-- Applied to sxqdjilabbmjobjpwwst on 2026-07-03 (memory_semantic_context_gate).
alter table public.memory add column if not exists semantic_context_gated boolean not null default false;
create index if not exists memory_semantic_gate_idx on public.memory (semantic_context_gated) where semantic_context_gated;
