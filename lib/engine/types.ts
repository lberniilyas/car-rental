/**
 * Types du moteur déterministe.
 *
 * Le moteur est volontairement agnostique de la source de données : il reçoit
 * des tableaux typés (issus de PostgreSQL via Drizzle, ou de CSV dans les
 * tests) et ne connaît ni la base, ni le réseau, ni le LLM.
 */

export type RiskCategory = 'standard' | 'jeune_conducteur' | 'ineligible';

export interface FleetVehicle {
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  category: string;
  transmission: string;
  fuelType: string;
  baseDailyRate: number;
  vehiclesAvailable: number;
  location: string;
}

export interface BookingRecord {
  bookingId: string;
  customerId: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  days: number;
  insuranceOption: string;
  depositAmount: number;
  discountCode: string;
  seasonalMultiplier: number;
}

export interface SeasonalRate {
  month: number;
  category: string;
  multiplier: number;
}

export interface CustomerProfile {
  customerId: string;
  fullName: string;
  birthDate: string;
  licenseNumber: string;
  licenseIssueDate: string;
  licenseExpDate: string;
  riskCategory: string;
}

// ─── Résultats ─────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  age: number;
  licenseSeniorityYears: number;
  licenseExpired: boolean;
  riskCategory: RiskCategory;
  rejectionReasons: string[];
  needsHumanReview: boolean;
  vehicleCategory: string | null;
}

export interface SubstituteVehicle {
  vehicleId: string;
  make: string;
  model: string;
  baseDailyRate: number;
}

export interface AvailabilityResult {
  available: boolean;
  vehicleId: string;
  requestedStart: string;
  requestedEnd: string;
  conflictingBookings: number;
  substitutes: SubstituteVehicle[];
}

export interface PriceResult {
  vehicleId: string;
  make: string;
  model: string;
  category: string;
  baseDailyRate: number;
  days: number;
  month: number;
  seasonalMultiplier: number;
  insuranceOption: string;
  insuranceCost: number;
  deposit: number;
  depositNote: string;
  subtotal: number;
  discountCode: string;
  discountAmount: number;
  discountCapped: boolean;
  discountNote: string;
  floorApplied: boolean;
  totalPrice: number;
  needsHumanReview: boolean;
}

export interface MileageResult {
  kmDriven: number;
  kmAllowed: number;
  kmOverage: number;
  extraKmRate: number;
  penalty: number;
}
