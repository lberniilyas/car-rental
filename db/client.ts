/**
 * Client PostgreSQL partage (pool pg + Drizzle).
 *
 * Aucune valeur secrete n'est ecrite en dur : la chaine de connexion provient
 * exclusivement de l'environnement (cahier des charges §9.2).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL est absente. Copier .env.example vers .env.local et renseigner la valeur.',
    );
  }
  return url;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl(), max: 10 });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Sonde de sante utilisee par /api/health et le healthcheck Docker. */
export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await getPool().query('SELECT 1 AS ok');
    return { ok: result.rows[0]?.ok === 1 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
