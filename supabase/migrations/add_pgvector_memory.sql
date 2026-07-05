-- Applied to sxqdjilabbmjobjpwwst on 2026-07-03 (pgvector_memory_embedding).
create extension if not exists vector with schema extensions;
alter table public.memory add column if not exists embedding extensions.vector(1024);
create index if not exists memory_embedding_hnsw
  on public.memory using hnsw (embedding extensions.vector_cosine_ops);
