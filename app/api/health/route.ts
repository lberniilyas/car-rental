/**
 * Route de healthcheck applicative (cahier des charges §9).
 *
 * Vérifie l'application ET la connectivité PostgreSQL : c'est cette route que
 * consomment le healthcheck Docker et la supervision distante.
 * Elle ne révèle jamais d'identifiants ni de clé API.
 */

import { NextResponse } from 'next/server';
import { pingDatabase } from '@/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  const database = await pingDatabase();

  const body = {
    status: database.ok ? 'healthy' : 'degraded',
    app: 'ok',
    database: database.ok ? 'ok' : 'unreachable',
    // Le message d'erreur brut peut contenir un hôte : on ne renvoie qu'un motif.
    databaseError: database.ok ? undefined : 'connexion PostgreSQL impossible',
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: database.ok ? 200 : 503 });
}
