/**
 * Chargement des CSV de référence pour les tests de parité.
 *
 * Les tests unitaires du moteur lisent les MÊMES fichiers que le notebook
 * Python, afin que la comparaison des résultats soit strictement équivalente.
 * En production, ces données proviennent de PostgreSQL via Drizzle : le moteur
 * reste identique, seule la source change.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BookingRecord, CustomerProfile, FleetVehicle, SeasonalRate } from '@/lib/engine/types';

const DATA_DIR = path.resolve(__dirname, '../../data');

/** Parseur CSV minimal gérant les champs entre guillemets et les guillemets doublés. */
export function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = (cells[idx] ?? '').trim();
    });
    return record;
  });
}

function readCsv(filename: string): Record<string, string>[] {
  return parseCsv(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8'));
}

export function loadFleet(): FleetVehicle[] {
  return readCsv('fleet_catalog.csv').map((r) => ({
    vehicleId: r.vehicle_id,
    make: r.make,
    model: r.model,
    year: Number(r.year),
    category: r.category,
    transmission: r.transmission,
    fuelType: r.fuel_type,
    baseDailyRate: Number(r.base_daily_rate),
    vehiclesAvailable: Number(r.vehicles_available),
    location: r.location,
  }));
}

export function loadBookings(): BookingRecord[] {
  return readCsv('booking_logs.csv').map((r) => ({
    bookingId: r.booking_id,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id,
    startDate: r.start_date,
    endDate: r.end_date,
    days: Number(r.days),
    insuranceOption: r.insurance_option,
    depositAmount: Number(r.deposit_amount),
    discountCode: r.discount_code,
    seasonalMultiplier: Number(r.seasonal_multiplier),
  }));
}

export function loadSeasonalRates(): SeasonalRate[] {
  return readCsv('seasonal_pricing_matrix.csv').map((r) => ({
    month: Number(r.month),
    category: r.category,
    multiplier: Number(r.multiplier),
  }));
}

export function loadCustomers(): CustomerProfile[] {
  return readCsv('customer_profiles.csv').map((r) => ({
    customerId: r.customer_id,
    fullName: r.full_name,
    birthDate: r.birth_date,
    licenseNumber: r.license_number,
    licenseIssueDate: r.license_issue_date,
    licenseExpDate: r.license_exp_date,
    riskCategory: r.risk_category,
  }));
}
