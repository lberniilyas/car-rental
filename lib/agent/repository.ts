/**
 * Acces aux donnees operationnelles pour le moteur deterministe.
 *
 * Le moteur reste pur : c'est ce module qui lit PostgreSQL et lui transmet des
 * tableaux typés. La disponibilite et les prix proviennent donc de la base,
 * jamais du RAG ni du LLM (cahier des charges §7).
 */

import { getDb } from '@/db/client';
import { bookingLogs, customerProfiles, fleetCatalog, seasonalPricingMatrix } from '@/db/schema';
import type {
  BookingRecord,
  CustomerProfile,
  FleetVehicle,
  SeasonalRate,
} from '@/lib/engine/types';

export async function loadFleet(): Promise<FleetVehicle[]> {
  const rows = await getDb().select().from(fleetCatalog);
  return rows.map((r) => ({
    vehicleId: r.vehicleId,
    make: r.make,
    model: r.model,
    year: r.year,
    category: r.category,
    transmission: r.transmission,
    fuelType: r.fuelType,
    baseDailyRate: Number(r.baseDailyRate),
    vehiclesAvailable: r.vehiclesAvailable,
    location: r.location,
  }));
}

export async function loadBookings(): Promise<BookingRecord[]> {
  const rows = await getDb().select().from(bookingLogs);
  return rows.map((r) => ({
    bookingId: r.bookingId,
    customerId: r.customerId,
    vehicleId: r.vehicleId,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
    insuranceOption: r.insuranceOption,
    depositAmount: Number(r.depositAmount),
    discountCode: r.discountCode,
    seasonalMultiplier: r.seasonalMultiplier,
  }));
}

export async function loadSeasonalRates(): Promise<SeasonalRate[]> {
  const rows = await getDb().select().from(seasonalPricingMatrix);
  return rows.map((r) => ({
    month: r.month,
    category: r.category,
    multiplier: r.multiplier,
  }));
}

export async function loadCustomers(): Promise<CustomerProfile[]> {
  const rows = await getDb().select().from(customerProfiles);
  return rows.map((r) => ({
    customerId: r.customerId,
    fullName: r.fullName,
    birthDate: r.birthDate,
    licenseNumber: r.licenseNumber,
    licenseIssueDate: r.licenseIssueDate,
    licenseExpDate: r.licenseExpDate,
    riskCategory: r.riskCategory,
  }));
}
