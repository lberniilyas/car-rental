/**
 * Indexation du corpus RAG : `data/rental_policies.md` -> pgvector.
 *
 * Idempotent : la cle de fragment (`chunk_key`) sert de cible d'upsert, donc
 * une reindexation met a jour sans jamais supprimer le corpus existant.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { closePool, getDb } from '@/db/client';
import { rentalPoliciesVectors } from '@/db/schema';
import { chunkPolicies } from './chunk';
import { EMBEDDINGS_DIMENSION, EMBEDDINGS_MODEL, embedText, toVectorLiteral } from './embeddings';

config({ path: '.env.local' });
config({ path: '.env' });

export async function indexPolicies(markdownPath?: string): Promise<number> {
  const file = markdownPath ?? path.resolve(process.cwd(), 'data/rental_policies.md');
  if (!fs.existsSync(file)) {
    throw new Error(`Corpus RAG introuvable : ${file}`);
  }

  const chunks = chunkPolicies(fs.readFileSync(file, 'utf-8'));
  if (chunks.length === 0) {
    throw new Error('Aucun fragment exploitable dans le corpus de politiques.');
  }

  console.log(`[rag] modele : ${EMBEDDINGS_MODEL} (${EMBEDDINGS_DIMENSION} dimensions, cosinus)`);
  console.log(`[rag] ${chunks.length} fragments a indexer`);

  const db = getDb();
  for (const chunk of chunks) {
    const vector = toVectorLiteral(await embedText(chunk.content));
    await db
      .insert(rentalPoliciesVectors)
      .values({
        chunkKey: chunk.chunkKey,
        sourceSection: chunk.sourceSection,
        content: chunk.content,
        embedding: sql`${vector}::vector` as unknown as number[],
      })
      .onConflictDoUpdate({
        target: rentalPoliciesVectors.chunkKey,
        set: {
          sourceSection: sql`excluded.source_section`,
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
        },
      });
  }

  console.log(`[rag] indexation terminee : ${chunks.length} fragments`);
  return chunks.length;
}

// Execution directe : `npm run rag:index`
const isDirectRun = process.argv[1]?.includes('index-policies');
if (isDirectRun) {
  indexPolicies()
    .then(async () => {
      await closePool();
    })
    .catch(async (e) => {
      console.error('[rag] echec :', e.message);
      await closePool();
      process.exit(1);
    });
}
