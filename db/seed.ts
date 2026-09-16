/**
 * Seed controle et NON DESTRUCTIF (cahier des charges §9.2).
 *
 * Regles :
 *   - aucune suppression, aucun TRUNCATE, aucun DROP ;
 *   - reexecutable a l'identique (idempotent) via upsert sur la cle primaire ;
 *   - refuse d'ecraser une base deja peuplee hors developpement, sauf
 *     SEED_ALLOW_UPDATE=true explicite.
 *
 * Source : les CSV du projet, identiques a ceux du notebook Python.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { parseCsv } from '../lib/csv';
import { closePool, getDb } from './client';
import {
  bookingLogs,
  customerProfiles,
  fleetCatalog,
  seasonalPricingMatrix,
} from './schema';

config({ path: '.env.local' });
config({ path: '.env' });

const DATA_DIR = path.resolve(process.cwd(), 'data');

function readCsv(filename: string): Record<string, string>[] {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) {
    throw new Error(`Fichier source introuvable : ${file}`);
  }
  return parseCsv(fs.readFileSync(file, 'utf-8'));
}

async function main() {
  const db = getDb();

  // ─── Garde-fou environnement distant ────────────────────────────────────
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(fleetCatalog);
  const alreadyPopulated = (existing[0]?.n ?? 0) > 0;
  const allowUpdate = process.env.SEED_ALLOW_UPDATE === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  if (alreadyPopulated && isProduction && !allowUpdate) {
    console.log(
      '[seed] base deja peuplee en production : aucune modification. ' +
        'Relancer avec SEED_ALLOW_UPDATE=true pour mettre a jour.',
    );
    await closePool();
    return;
  }
  if (alreadyPopulated) {
    console.log('[seed] base deja peuplee : mise a jour idempotente (aucune suppression).');
  }

  // ─── Flotte ─────────────────────────────────────────────────────────────
  const fleetRows = readCsv('fleet_catalog.csv').map((r) => ({
    vehicleId: r.vehicle_id,
    make: r.make,
    model: r.model,
    year: Number(r.year),
    category: r.category,
    transmission: r.transmission,
    fuelType: r.fuel_type,
    baseDailyRate: r.base_daily_rate,
    vehiclesAvailable: Number(r.vehicles_available),
    location: r.location,
  }));
  await db
    .insert(fleetCatalog)
    .values(fleetRows)
    .onConflictDoUpdate({
      target: fleetCatalog.vehicleId,
      set: {
        make: sql`excluded.make`,
        model: sql`excluded.model`,
        year: sql`excluded.year`,
        category: sql`excluded.category`,
        transmission: sql`excluded.transmission`,
        fuelType: sql`excluded.fuel_type`,
        baseDailyRate: sql`excluded.base_daily_rate`,
        vehiclesAvailable: sql`excluded.vehicles_available`,
        location: sql`excluded.location`,
      },
    });
  console.log(`[seed] fleet_catalog : ${fleetRows.length} vehicules`);

  // ─── Clients ────────────────────────────────────────────────────────────
  const customerRows = readCsv('customer_profiles.csv').map((r) => ({
    customerId: r.customer_id,
    fullName: r.full_name,
    birthDate: r.birth_date,
    licenseNumber: r.license_number,
    licenseIssueDate: r.license_issue_date,
    licenseExpDate: r.license_exp_date,
    riskCategory: r.risk_category,
  }));
  await db
    .insert(customerProfiles)
    .values(customerRows)
    .onConflictDoUpdate({
      target: customerProfiles.customerId,
      set: {
        fullName: sql`excluded.full_name`,
        birthDate: sql`excluded.birth_date`,
        licenseNumber: sql`excluded.license_number`,
        licenseIssueDate: sql`excluded.license_issue_date`,
        licenseExpDate: sql`excluded.license_exp_date`,
        riskCategory: sql`excluded.risk_category`,
      },
    });
  console.log(`[seed] customer_profiles : ${customerRows.length} clients`);

  // ─── Reservations ───────────────────────────────────────────────────────
  const bookingRows = readCsv('booking_logs.csv').map((r) => ({
    bookingId: r.booking_id,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id,
    startDate: r.start_date,
    endDate: r.end_date,
    days: Number(r.days),
    insuranceOption: r.insurance_option,
    depositAmount: r.deposit_amount,
    discountCode: r.discount_code ?? '',
    seasonalMultiplier: Number(r.seasonal_multiplier),
  }));
  await db
    .insert(bookingLogs)
    .values(bookingRows)
    .onConflictDoUpdate({
      target: bookingLogs.bookingId,
      set: {
        customerId: sql`excluded.customer_id`,
        vehicleId: sql`excluded.vehicle_id`,
        startDate: sql`excluded.start_date`,
        endDate: sql`excluded.end_date`,
        days: sql`excluded.days`,
        insuranceOption: sql`excluded.insurance_option`,
        depositAmount: sql`excluded.deposit_amount`,
        discountCode: sql`excluded.discount_code`,
        seasonalMultiplier: sql`excluded.seasonal_multiplier`,
      },
    });
  console.log(`[seed] booking_logs : ${bookingRows.length} reservations`);

  // ─── Grille saisonniere ─────────────────────────────────────────────────
  const seasonalRows = readCsv('seasonal_pricing_matrix.csv').map((r) => ({
    month: Number(r.month),
    category: r.category,
    multiplier: Number(r.multiplier),
  }));
  await db
    .insert(seasonalPricingMatrix)
    .values(seasonalRows)
    .onConflictDoUpdate({
      target: [seasonalPricingMatrix.month, seasonalPricingMatrix.category],
      set: { multiplier: sql`excluded.multiplier` },
    });
  console.log(`[seed] seasonal_pricing_matrix : ${seasonalRows.length} lignes`);

  console.log('[seed] termine — aucune donnee supprimee.');
  await closePool();
}

main().catch(async (e) => {
  console.error('[seed] echec :', e.message);
  await closePool();
  process.exit(1);
});
