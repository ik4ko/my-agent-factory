// Text → 1024-dim vector for the gated matrix memory rows.
// Provider: Voyage AI (Anthropic's recommended embeddings partner), voyage-3-lite.
// MUST stay in sync with the memory.embedding vector(1024) column dimension.
const EMBED_DIM = 1024;
const EMBED_MODEL = 'voyage-3-lite';

/**
 * Vectorize `text` via Voyage. Throws on any failure so the caller can decide
 * whether to swallow it (commitMatrixToLongTermMemory treats embeddings as
 * best-effort and never lets a provider hiccup block the consensus write).
 */
export async function generateMatrixEmbedding(text: string): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY; // add to .env.local + Vercel env
  if (!key) throw new Error('[embedding] VOYAGE_API_KEY not set');

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 32000), input_type: 'document' }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[embedding] ${res.status} ${detail.slice(0, 160)}`);
  }

  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!vec || vec.length !== EMBED_DIM) {
    throw new Error(`[embedding] expected ${EMBED_DIM} dims, got ${vec?.length ?? 0}`);
  }
  return vec;
}

/** pgvector-over-PostgREST wants the bracketed-string form, not a raw JS array. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
