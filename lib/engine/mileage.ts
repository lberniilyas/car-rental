/**
 * §4.4 — Contrôle de kilométrage.
 * Port direct de `calculate_mileage_penalty()` (notebook Module 2).
 *
 *   dépassement = max(0, km_parcourus − km_inclus)
 *   pénalité    = dépassement × tarif_km_supplémentaire
 *
 * AXIOME ZÉRO-HALLUCINATION : fonction pure, aucun appel LLM.
 */

import { EXTRA_KM_RATE, KM_ALLOWED_PER_DAY } from './constants';
import { roundPy } from './dates';
import type { MileageResult } from './types';

export function calculateMileagePenalty(
  kmDriven: number,
  kmAllowed: number,
  extraKmRate: number = EXTRA_KM_RATE,
): MileageResult {
  const overage = Math.max(0, kmDriven - kmAllowed);
  const penalty = roundPy(overage * extraKmRate, 2);
  return {
    kmDriven,
    kmAllowed,
    kmOverage: overage,
    extraKmRate,
    penalty,
  };
}

/** Forfait kilométrique contractuel pour une durée donnée (300 km/jour). */
export function kmAllowedForDays(days: number): number {
  return days * KM_ALLOWED_PER_DAY;
}
