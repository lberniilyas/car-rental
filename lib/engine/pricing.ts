/**
 * §4.3 — Calcul financier exact.
 * Port direct de `calculate_total_price()` (notebook Module 2).
 *
 *   Total = (Prix_Base × Jours × Coefficient_Saisonnier)
 *           + Assurance + Caution − Remise_Plafonnée
 *   Total = max(Total, Caution)
 *
 * Règles invariantes :
 *   - remise strictement plafonnée à 15% quel que soit le taux nominal ;
 *   - caution majorée de 50% pour un jeune conducteur ;
 *   - plancher : le total ne peut jamais descendre sous la caution.
 *
 * AXIOME ZÉRO-HALLUCINATION : fonction pure, aucun appel LLM.
 */

import {
  DEFAULT_DEPOSIT,
  DEPOSIT_BY_CATEGORY,
  DEPOSIT_HITL_THRESHOLD,
  DISCOUNT_CODES,
  INSURANCE_OPTIONS,
  MAX_DISCOUNT_RATE,
  YOUNG_DRIVER_DEPOSIT_MULTIPLIER,
} from './constants';
import { roundPy } from './dates';
import type { FleetVehicle, PriceResult, RiskCategory, SeasonalRate } from './types';

export interface PriceInput {
  vehicleId: string;
  days: number;
  month: number;
  insuranceOption: string;
  discountCode: string;
  riskCategory: RiskCategory | string;
  fleet: FleetVehicle[];
  seasonalRates: SeasonalRate[];
}

/** Formate un taux en pourcentage entier, comme `f"{rate*100:.0f}%"` en Python. */
function formatRate(rate: number): string {
  return `${roundPy(rate * 100, 0)}`;
}

export function calculateTotalPrice(input: PriceInput): PriceResult {
  const vehicle = input.fleet.find((v) => v.vehicleId === input.vehicleId);
  if (!vehicle) {
    throw new Error(`Véhicule introuvable dans la flotte : ${input.vehicleId}`);
  }

  const basePrice = vehicle.baseDailyRate;
  const category = vehicle.category;

  // Coefficient saisonnier depuis la grille ; 1.0 si le couple est absent.
  const seasonal = input.seasonalRates.find(
    (r) => r.month === input.month && r.category === category,
  );
  const seasonalMultiplier = seasonal ? seasonal.multiplier : 1.0;

  // Coût d'assurance
  const insurance = INSURANCE_OPTIONS[input.insuranceOption] ?? INSURANCE_OPTIONS.basic;
  const insuranceCost = insurance.dailyRate * input.days + insurance.flatFee;

  // Caution — majorée de 50% pour les jeunes conducteurs
  const baseDeposit = DEPOSIT_BY_CATEGORY[category] ?? DEFAULT_DEPOSIT;
  let deposit: number;
  let depositNote: string;
  if (input.riskCategory === 'jeune_conducteur') {
    deposit = Math.trunc(baseDeposit * YOUNG_DRIVER_DEPOSIT_MULTIPLIER);
    depositNote = `Caution majorée +50% (jeune conducteur) : ${baseDeposit} → ${deposit} MAD`;
  } else {
    deposit = baseDeposit;
    depositNote = `Caution standard : ${deposit} MAD`;
  }

  const subtotal = basePrice * input.days * seasonalMultiplier + insuranceCost;

  // Remise — plafond strict à 15%
  let discountAmount = 0;
  let discountNote = 'Aucune remise appliquée';
  let discountCapped = false;

  const code = input.discountCode ? DISCOUNT_CODES[input.discountCode] : undefined;
  if (code) {
    const nominal = code.rate;
    const effective = Math.min(nominal, MAX_DISCOUNT_RATE);
    discountAmount = roundPy(subtotal * effective, 2);
    discountCapped = nominal > MAX_DISCOUNT_RATE;
    discountNote = discountCapped
      ? `Code '${input.discountCode}' : taux nominal ${formatRate(nominal)}% ` +
        `PLAFONNÉ à 15% (règle métier §4.3). ` +
        `Remise effective : ${discountAmount.toFixed(2)} MAD`
      : `Code '${input.discountCode}' : ${formatRate(nominal)}%. ` +
        `Remise : ${discountAmount.toFixed(2)} MAD`;
  }

  // Total avec plancher à hauteur de la caution
  let total = subtotal + deposit - discountAmount;
  let floorApplied = false;
  if (total < deposit) {
    total = deposit;
    floorApplied = true;
  }
  total = roundPy(total, 2);

  return {
    vehicleId: input.vehicleId,
    make: vehicle.make,
    model: vehicle.model,
    category,
    baseDailyRate: basePrice,
    days: input.days,
    month: input.month,
    seasonalMultiplier,
    insuranceOption: input.insuranceOption,
    insuranceCost: roundPy(insuranceCost, 2),
    deposit,
    depositNote,
    subtotal: roundPy(subtotal, 2),
    discountCode: input.discountCode,
    discountAmount: roundPy(discountAmount, 2),
    discountCapped,
    discountNote,
    floorApplied,
    totalPrice: total,
    needsHumanReview: deposit > DEPOSIT_HITL_THRESHOLD,
  };
}
