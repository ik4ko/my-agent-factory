import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { generateMatrixEmbedding, toVectorLiteral } from '@/lib/pipeline/matrix-embedding';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface MatrixMemoryRecord {
  key: string;
  matrixId: string;
  markdown: string;
  roles: string[];
  committedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanPreview(result: any): string {
  const preview = (result?.preview ?? '').toString();
  // Strip streaming cursor artifacts + collapse the redundant token whitespace
  // the incremental flushes leave behind, then cap length.
  return preview.replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * Serialize the reconciled matrix consensus (lanes + cross-debate) into a
 * tight Markdown block, upsert one gated memory row, then (best-effort)
 * attach a 1024-dim Voyage embedding for true cosine similarity recall.
 *
 * The gate flag (semantic_context_gated=true) + tags make the row
 * keyword-queryable immediately; the embedding column (pgvector HNSW,
 * vector_cosine_ops) unlocks `order by embedding <=> $q`. Embedding generation
 * is guarded — a missing VOYAGE_API_KEY or provider error logs a warning and
 * leaves the row committed with embedding=NULL (backfillable later).
 */
export async function commitMatrixToLongTermMemory(
  matrixId: string,
): Promise<MatrixMemoryRecord | null> {
  const { data, error } = await db()
    .from('tasks')
    .select('id, description, result, created_at')
    .filter('result->matrix->>id', 'eq', matrixId)
    .order('created_at', { ascending: true });

  if (error) {
    await hermesLog('error', `[MATRIX:MEMORY] read failed — ${String(error.message).slice(0, 160)}`);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as Array<{ id: string; result: any }>;
  if (rows.length === 0) {
    await hermesLog('warn', `[MATRIX:MEMORY] no rows for matrix ${matrixId.slice(0, 8)} — nothing to commit`);
    return null;
  }

  const roles: string[] = [];
  const sections = rows.map((r) => {
    const role = String(r.result?.matrix?.role ?? 'UNKNOWN');
    roles.push(role);
    return `### ${role}\n${cleanPreview(r.result) || '(no output captured)'}`;
  });

  const committedAt = new Date().toISOString();
  const markdown = `# Matrix ${matrixId.slice(0, 8)} — reconciled consensus\n\n${sections.join('\n\n')}`;
  const key = `matrix:${matrixId}`;
  const value = { matrixId, markdown, roles, committedAt };

  const { data: existing } = await db().from('memory').select('id').eq('key', key).maybeSingle();
  const row = {
    value,
    tags: roles,
    source: 'parallel-matrix',
    importance: 8,
    semantic_context_gated: true,
    updated_at: committedAt,
  };
  let memoryId: string | null = existing?.id ?? null;
  if (existing) {
    await db().from('memory').update(row).eq('id', existing.id);
  } else {
    const { data: inserted } = await db().from('memory').insert({ key, ...row }).select('id').single();
    memoryId = inserted?.id ?? null;
  }

  // Best-effort embedding — never blocks the consensus write.
  try {
    const vec = await generateMatrixEmbedding(markdown);
    const target = memoryId
      ? db().from('memory').update({ embedding: toVectorLiteral(vec) }).eq('id', memoryId)
      : db().from('memory').update({ embedding: toVectorLiteral(vec) }).eq('key', key);
    await target;
    await hermesLog('success', `[MATRIX:MEMORY] embedded ${key} — 1024-dim vector attached`);
  } catch (e) {
    await hermesLog('warn', `[MATRIX:MEMORY] embedding skipped — ${String(e).replace(/\s+/g, ' ').slice(0, 140)}`);
  }

  await hermesLog(
    'success',
    `[MATRIX:MEMORY] committed ${key} — ${roles.length} perspectives gated (semantic_context_gated=true)`,
  );
  return { key, matrixId, markdown, roles, committedAt };
}
