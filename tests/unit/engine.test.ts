/**
 * Tests de parité du moteur déterministe.
 *
 * Ces 14 assertions reproduisent UNE POUR UNE `run_deterministic_tests()`
 * du notebook Python (Module 2, `DETERMINISTIC_TESTS=14/14 PASS`).
 * Les entrées, les dates et les attendus sont identiques à la référence :
 * toute divergence signale une régression du portage TypeScript.
 */

import { describe, expect, it } from 'vitest';
import {
  calculateMileagePenalty,
  calculateTotalPrice,
  checkVehicleAvailability,
  verifyDriverEligibility,
} from '@/lib/engine';
import { loadBookings, loadFleet, loadSeasonalRates } from '../fixtures/load-csv';

const REF = '2026-07-15';

const fleet = loadFleet();
const bookings = loadBookings();
const seasonalRates = loadSeasonalRates();

/** Le notebook utilise `fleet_df.iloc[0]` : premier véhicule du catalogue. */
const vid = fleet[0].vehicleId;

describe('Moteur déterministe — parité avec le notebook (14 assertions)', () => {
  it('T1 — conducteur mineur rejeté', () => {
    const r = verifyDriverEligibility({
      birthDate: '2007-03-10',
      licenseIssueDate: '2025-06-15',
      licenseExpDate: '2035-06-15',
      referenceDate: REF,
    });
    expect(r.eligible).toBe(false);
  });

  it("T2 — ancienneté de permis insuffisante", () => {
    const r = verifyDriverEligibility({
      birthDate: '2000-01-01',
      licenseIssueDate: '2025-01-15',
      licenseExpDate: '2035-01-15',
      referenceDate: REF,
    });
    expect(r.eligible).toBe(false);
  });

  it('T3 — permis expiré', () => {
    const r = verifyDriverEligibility({
      birthDate: '1985-11-22',
      licenseIssueDate: '2010-01-10',
      licenseExpDate: '2026-01-10',
      referenceDate: REF,
    });
    expect(r.eligible).toBe(false);
    expect(r.licenseExpired).toBe(true);
  });

  it('T4 — conducteur standard éligible', () => {
    const r = verifyDriverEligibility({
      birthDate: '1991-05-20',
      licenseIssueDate: '2012-08-01',
      licenseExpDate: '2032-08-01',
      referenceDate: REF,
    });
    expect(r.eligible).toBe(true);
    expect(r.riskCategory).toBe('standard');
    expect(r.needsHumanReview).toBe(false);
  });

  it('T5 — jeune conducteur + Premium déclenche la revue humaine', () => {
    const r = verifyDriverEligibility({
      birthDate: '2004-02-18',
      licenseIssueDate: '2023-09-01',
      licenseExpDate: '2033-09-01',
      referenceDate: REF,
      vehicleCategory: 'Premium',
    });
    expect(r.eligible).toBe(true);
    expect(r.riskCategory).toBe('jeune_conducteur');
    expect(r.needsHumanReview).toBe(true);
  });

  it('T6 — jeune conducteur + Economy ne déclenche pas la revue humaine', () => {
    const r = verifyDriverEligibility({
      birthDate: '2004-02-18',
      licenseIssueDate: '2023-09-01',
      licenseExpDate: '2033-09-01',
      referenceDate: REF,
      vehicleCategory: 'Economy',
    });
    expect(r.eligible).toBe(true);
    expect(r.needsHumanReview).toBe(false);
  });

  it('T7 — remise au-dessus de 15% plafonnée', () => {
    const r = calculateTotalPrice({
      vehicleId: vid,
      days: 5,
      month: 7,
      insuranceOption: 'basic',
      discountCode: 'SUMMER20',
      riskCategory: 'standard',
      fleet,
      seasonalRates,
    });
    expect(r.discountCapped).toBe(true);
  });

  it('T8 — remise à 10% non plafonnée', () => {
    const r = calculateTotalPrice({
      vehicleId: vid,
      days: 5,
      month: 7,
      insuranceOption: 'basic',
      discountCode: 'LOYAL10',
      riskCategory: 'standard',
      fleet,
      seasonalRates,
    });
    expect(r.discountCapped).toBe(false);
  });

  it('T9 — caution du jeune conducteur × 1,5', () => {
    const standard = calculateTotalPrice({
      vehicleId: vid,
      days: 5,
      month: 7,
      insuranceOption: 'basic',
      discountCode: '',
      riskCategory: 'standard',
      fleet,
      seasonalRates,
    });
    const young = calculateTotalPrice({
      vehicleId: vid,
      days: 5,
      month: 7,
      insuranceOption: 'basic',
      discountCode: '',
      riskCategory: 'jeune_conducteur',
      fleet,
      seasonalRates,
    });
    expect(young.deposit).toBe(Math.trunc(standard.deposit * 1.5));
  });

  it('T10 — pénalité de dépassement kilométrique', () => {
    const r = calculateMileagePenalty(1800, 1500, 2.5);
    expect(r.kmOverage).toBe(300);
    expect(r.penalty).toBe(750.0);
  });

  it('T11 — aucune pénalité sous le forfait', () => {
    const r = calculateMileagePenalty(1200, 1500, 2.5);
    expect(r.kmOverage).toBe(0);
    expect(r.penalty).toBe(0.0);
  });

  it('T12 — chevauchement détecté', () => {
    const r = checkVehicleAvailability({
      vehicleId: vid,
      startDate: '2026-07-12',
      endDate: '2026-07-18',
      bookings,
      fleet,
    });
    expect(r.available).toBe(false);
  });

  it('T13 — période disponible', () => {
    const r = checkVehicleAvailability({
      vehicleId: vid,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      bookings,
      fleet,
    });
    expect(r.available).toBe(true);
  });

  it('T14 — jeune conducteur sans catégorie ne déclenche pas la revue Premium', () => {
    const r = verifyDriverEligibility({
      birthDate: '2004-02-18',
      licenseIssueDate: '2023-09-01',
      licenseExpDate: '2033-09-01',
      referenceDate: REF,
      vehicleCategory: null,
    });
    expect(r.eligible).toBe(true);
    expect(r.needsHumanReview).toBe(false);
  });
});
