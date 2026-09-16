/**
 * Constantes métier — portées VERBATIM depuis le notebook Python de référence
 * (`kiraa_tutorial_executed.ipynb`, Module 1 §1.3 et Module 2 §4.1–§4.4).
 *
 * Toute divergence de valeur ici casse la parité avec les 14 assertions
 * déterministes du notebook. Ne pas « arrondir » ni « améliorer » ces chiffres.
 */

export const VEHICLE_CATEGORIES = [
  'Economy',
  'Compact',
  'SUV',
  'Premium',
  'Utility',
] as const;

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

/** Date de référence de tous les calculs du notebook (Module 1). */
export const REFERENCE_DATE = '2026-07-15';

// ─── Éligibilité (§4.1) ────────────────────────────────────────────────────
export const MIN_DRIVER_AGE = 21;
export const MIN_LICENSE_SENIORITY_YEARS = 2.0;
/** En dessous de cet âge : risk_category = "jeune_conducteur" → caution +50%. */
export const YOUNG_DRIVER_AGE_LIMIT = 25;

// ─── Assurance (§4.3) ──────────────────────────────────────────────────────
export interface InsuranceOption {
  label: string;
  dailyRate: number;
  flatFee: number;
}

export const INSURANCE_OPTIONS: Record<string, InsuranceOption> = {
  basic: { label: 'Assurance de base (incluse)', dailyRate: 0, flatFee: 0 },
  all_risk: { label: 'Tous risques', dailyRate: 80, flatFee: 0 },
  franchise_buyback: { label: 'Rachat de franchise', dailyRate: 0, flatFee: 500 },
};

// ─── Caution par catégorie, en MAD (§4.3) ──────────────────────────────────
export const DEPOSIT_BY_CATEGORY: Record<string, number> = {
  Economy: 2000,
  Compact: 3000,
  SUV: 5000,
  Premium: 15000,
  Utility: 7000,
};

/** Caution retenue lorsque la catégorie est inconnue (parité notebook). */
export const DEFAULT_DEPOSIT = 3000;

/** Majoration de caution pour les conducteurs de moins de 25 ans. */
export const YOUNG_DRIVER_DEPOSIT_MULTIPLIER = 1.5;

// ─── Codes de remise (§4.3) ────────────────────────────────────────────────
export interface DiscountCode {
  rate: number;
  label: string;
  validUntil: string;
}

export const DISCOUNT_CODES: Record<string, DiscountCode> = {
  LOYAL10: { rate: 0.1, label: 'Fidélité 10%', validUntil: '2026-12-31' },
  WELCOME5: { rate: 0.05, label: 'Bienvenue 5%', validUntil: '2026-12-31' },
  SUMMER20: { rate: 0.2, label: 'Été 20% (plafonné à 15%)', validUntil: '2026-08-31' },
  FLASH25: { rate: 0.25, label: 'Flash 25% (plafonné à 15%)', validUntil: '2026-07-31' },
};

/** Plafond strict de remise, quel que soit le taux nominal du code (§4.3). */
export const MAX_DISCOUNT_RATE = 0.15;

// ─── Kilométrage (§4.4) ────────────────────────────────────────────────────
/** Tarif du kilomètre supplémentaire, en MAD. */
export const EXTRA_KM_RATE = 2.5;
/**
 * Forfait kilométrique journalier inclus.
 * Source : `data/rental_policies.md` (corpus RAG, source de vérité contractuelle).
 */
export const KM_ALLOWED_PER_DAY = 300;

// ─── Seuils d'escalade humaine (HITL) — cahier des charges §4 ──────────────
export const OCR_CONFIDENCE_THRESHOLD = 0.85;
export const DEPOSIT_HITL_THRESHOLD = 20000;
export const YOUNG_DRIVER_HITL_MIN_AGE = 21;
export const YOUNG_DRIVER_HITL_MAX_AGE = 24;
export const HITL_VEHICLE_CATEGORY: VehicleCategory = 'Premium';
