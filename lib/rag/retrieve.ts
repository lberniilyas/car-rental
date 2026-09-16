/**
 * EX-05 — Recherche vectorielle pgvector par similarite cosinus.
 *
 * Perimetre strict (cahier des charges §7) : ce module ne repond QU'AUX
 * questions de politique commerciale (annulation, franchise, assurance,
 * kilometrage). La disponibilite et les prix relevent de PostgreSQL
 * relationnel et des fonctions deterministes, jamais du RAG.
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { embedText, toVectorLiteral } from './embeddings';
import type { RagPassage } from '@/lib/schemas/state';

export const DEFAULT_TOP_K = 3;
/** En deca de ce score, aucun passage n'est juge pertinent. */
export const MIN_SIMILARITY = 0.2;

export interface RetrieveOptions {
  topK?: number;
  minSimilarity?: number;
}

/**
 * Retourne les passages les plus proches de la question.
 * `1 - (embedding <=> query)` convertit la distance cosinus de pgvector en
 * score de similarite dans [0,1].
 */
export async function retrievePolicyPassages(
  query: string,
  options: RetrieveOptions = {},
): Promise<RagPassage[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;

  const queryVector = toVectorLiteral(await embedText(query));
  const db = getDb();

  const rows = await db.execute<{
    content: string;
    source_section: string | null;
    similarity: number;
  }>(sql`
    SELECT content,
           source_section,
           1 - (embedding <=> ${queryVector}::vector) AS similarity
    FROM rental_policies_vectors
    ORDER BY embedding <=> ${queryVector}::vector
    LIMIT ${topK}
  `);

  return rows.rows
    .map((r) => ({
      content: r.content,
      similarity: Number(r.similarity),
      sourceSection: r.source_section,
    }))
    .filter((p) => p.similarity >= minSimilarity);
}
