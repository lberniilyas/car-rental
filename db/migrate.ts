/**
 * Application des migrations Drizzle.
 *
 * L'extension pgvector est creee AVANT les migrations : la table du corpus
 * RAG declare une colonne de type `vector`, inexistante sans l'extension.
 */

import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

config({ path: '.env.local' });
config({ path: '.env' });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL est absente.');

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('[migrate] extension pgvector prete');

    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log('[migrate] migrations appliquees');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[migrate] echec :', e.message);
  process.exit(1);
});
