/**
 * Route d'administration — supervision des demandes traitées.
 *
 * Le cahier des charges §9.3 exige « une protection des routes
 * d'administration » et une capacité de « supervision ». Cette route donne au
 * responsable d'agence la vue des dernières demandes et de celles en attente de
 * revue humaine.
 *
 * Protection : jeton `ADMIN_TOKEN` exigé, comparé en temps constant. Si le
 * jeton n'est pas configuré, la route est DÉSACTIVÉE (503) plutôt qu'ouverte —
 * une variable absente ne doit jamais valoir autorisation.
 *
 * Confidentialité : ni `finalState`, ni `rawInput`, ni aucune donnée client ne
 * sont exposés ; seules les métadonnées de supervision le sont.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { agentRequests } from '@/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LIMIT = 100;

/** Comparaison à durée constante : ne fuit pas la longueur ni le contenu. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return request.headers.get('x-admin-token');
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.trim() === '') {
    return NextResponse.json(
      { error: "Routes d'administration désactivées : ADMIN_TOKEN n'est pas configuré." },
      { status: 503 },
    );
  }

  const provided = extractToken(request);
  if (!provided || !tokenMatches(provided, expected)) {
    // Motif générique : on ne distingue pas « jeton absent » de « jeton faux ».
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, MAX_LIMIT);
    const pendingOnly = url.searchParams.get('pendingReview') === 'true';

    const base = getDb()
      .select({
        requestId: agentRequests.requestId,
        intent: agentRequests.intent,
        bookingStatus: agentRequests.bookingStatus,
        needsHumanReview: agentRequests.needsHumanReview,
        graphTrace: agentRequests.graphTrace,
        createdAt: agentRequests.createdAt,
      })
      .from(agentRequests);

    const rows = await (pendingOnly
      ? base.where(eq(agentRequests.needsHumanReview, true))
      : base
    )
      .orderBy(desc(agentRequests.createdAt))
      .limit(limit);

    return NextResponse.json({ count: rows.length, requests: rows });
  } catch (e) {
    console.error('[admin] lecture impossible :', (e as Error).message);
    return NextResponse.json({ error: 'Supervision indisponible.' }, { status: 503 });
  }
}
