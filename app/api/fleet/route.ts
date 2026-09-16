/**
 * Catalogue de la flotte, en lecture seule.
 *
 * Alimente le sélecteur de véhicule de l'interface cliente : le client choisit
 * une voiture dans une liste lisible au lieu de saisir un identifiant technique.
 * La catégorie est renvoyée avec chaque véhicule car elle conditionne la caution
 * et l'escalade « jeune conducteur sur Premium » (§4.1).
 *
 * Aucune donnée client, aucun tarif calculé : uniquement le catalogue public.
 */

import { NextResponse } from 'next/server';
import { loadFleet } from '@/lib/agent/repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const fleet = await loadFleet();

    const vehicles = fleet
      .map((v) => ({
        vehicleId: v.vehicleId,
        label: `${v.make} ${v.model} (${v.year})`,
        category: v.category,
        baseDailyRate: v.baseDailyRate,
        transmission: v.transmission,
        location: v.location,
        vehiclesAvailable: v.vehiclesAvailable,
      }))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.baseDailyRate - b.baseDailyRate,
      );

    return NextResponse.json({ vehicles });
  } catch (e) {
    console.error('[fleet] lecture impossible :', (e as Error).message);
    return NextResponse.json({ error: 'Catalogue indisponible.' }, { status: 503 });
  }
}
