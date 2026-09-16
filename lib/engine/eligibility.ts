/**
 * §4.1 — Éligibilité du conducteur.
 * Port direct de `verify_driver_eligibility()` (notebook Module 2).
 *
 * AXIOME ZÉRO-HALLUCINATION : fonction pure, aucun appel LLM, aucune E/S.
 */

import {
  MIN_DRIVER_AGE,
  MIN_LICENSE_SENIORITY_YEARS,
  YOUNG_DRIVER_AGE_LIMIT,
  HITL_VEHICLE_CATEGORY,
  REFERENCE_DATE,
} from './constants';
import { calculateAge, calculateYearsBetween, formatDate, parseDate, type PlainDate } from './dates';
import type { EligibilityResult, RiskCategory } from './types';

export interface EligibilityInput {
  birthDate: string | PlainDate;
  licenseIssueDate: string | PlainDate;
  licenseExpDate: string | PlainDate;
  referenceDate?: string | PlainDate;
  vehicleCategory?: string | null;
}

export function verifyDriverEligibility(input: EligibilityInput): EligibilityResult {
  const birthDate = parseDate(input.birthDate);
  const licenseIssueDate = parseDate(input.licenseIssueDate);
  const licenseExpDate = parseDate(input.licenseExpDate);
  const referenceDate = parseDate(input.referenceDate ?? REFERENCE_DATE);
  const vehicleCategory = input.vehicleCategory ?? null;

  const age = calculateAge(birthDate, referenceDate);
  const seniority = calculateYearsBetween(licenseIssueDate, referenceDate);
  const expired = licenseExpDate.getTime() < referenceDate.getTime();

  let eligible = true;
  const reasons: string[] = [];

  if (age < MIN_DRIVER_AGE) {
    eligible = false;
    reasons.push(`Âge insuffisant : ${age} ans (minimum requis : ${MIN_DRIVER_AGE} ans)`);
  }

  if (seniority < MIN_LICENSE_SENIORITY_YEARS) {
    eligible = false;
    reasons.push(
      `Ancienneté du permis insuffisante : ${seniority} ans ` +
        `(minimum requis : ${MIN_LICENSE_SENIORITY_YEARS} ans)`,
    );
  }

  if (expired) {
    eligible = false;
    reasons.push(`Permis expiré depuis le ${formatDate(licenseExpDate)}`);
  }

  let riskCategory: RiskCategory;
  if (eligible && age < YOUNG_DRIVER_AGE_LIMIT) {
    riskCategory = 'jeune_conducteur';
  } else if (eligible) {
    riskCategory = 'standard';
  } else {
    riskCategory = 'ineligible';
  }

  // L'escalade humaine ne se déclenche que pour un jeune conducteur
  // sur un véhicule Premium (seuils HITL du cahier des charges §4).
  const needsHumanReview =
    eligible && riskCategory === 'jeune_conducteur' && vehicleCategory === HITL_VEHICLE_CATEGORY;

  return {
    eligible,
    age,
    licenseSeniorityYears: seniority,
    licenseExpired: expired,
    riskCategory,
    rejectionReasons: reasons,
    needsHumanReview,
    vehicleCategory,
  };
}
