/**
 * Schemas PostgreSQL (EX-08) — Drizzle ORM + drizzle-zod.
 *
 * Separation stricte imposee par le cahier des charges §7 :
 *   - donnees operationnelles (flotte, clients, reservations, tarifs) : tables
 *     relationnelles interrogees par le moteur deterministe ;
 *   - corpus de politiques : table vectorielle pgvector, utilisee UNIQUEMENT
 *     par le RAG pour les questions de politique commerciale.
 *
 * Les contrats Zod derives ici sont partages entre la base, l'API, l'etat de
 * l'agent et l'interface : un seul schema, aucune duplication.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

/** Dimension des embeddings locaux (Xenova/all-MiniLM-L6-v2). */
export const EMBEDDING_DIMENSION = 384;

// ─── Donnees operationnelles ───────────────────────────────────────────────

export const fleetCatalog = pgTable(
  'fleet_catalog',
  {
    vehicleId: text('vehicle_id').primaryKey(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: integer('year').notNull(),
    category: text('category').notNull(),
    transmission: text('transmission').notNull(),
    fuelType: text('fuel_type').notNull(),
    baseDailyRate: numeric('base_daily_rate', { precision: 10, scale: 2 }).notNull(),
    vehiclesAvailable: integer('vehicles_available').notNull(),
    location: text('location').notNull(),
  },
  (t) => ({
    categoryIdx: index('fleet_category_idx').on(t.category),
  }),
);

export const customerProfiles = pgTable('customer_profiles', {
  customerId: text('customer_id').primaryKey(),
  fullName: text('full_name').notNull(),
  birthDate: date('birth_date').notNull(),
  licenseNumber: text('license_number').notNull(),
  licenseIssueDate: date('license_issue_date').notNull(),
  licenseExpDate: date('license_exp_date').notNull(),
  riskCategory: text('risk_category').notNull(),
});

export const bookingLogs = pgTable(
  'booking_logs',
  {
    bookingId: text('booking_id').primaryKey(),
    customerId: text('customer_id').notNull(),
    vehicleId: text('vehicle_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    days: integer('days').notNull(),
    insuranceOption: text('insurance_option').notNull(),
    depositAmount: numeric('deposit_amount', { precision: 10, scale: 2 }).notNull(),
    discountCode: text('discount_code').notNull().default(''),
    seasonalMultiplier: real('seasonal_multiplier').notNull(),
    bookingStatus: text('booking_status').notNull().default('CONFIRMED'),
    needsHumanReview: boolean('needs_human_review').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Index servant la detection de chevauchement de dates (§4.2).
    vehicleDatesIdx: index('booking_vehicle_dates_idx').on(t.vehicleId, t.startDate, t.endDate),
  }),
);

export const seasonalPricingMatrix = pgTable(
  'seasonal_pricing_matrix',
  {
    id: serial('id').primaryKey(),
    month: integer('month').notNull(),
    category: text('category').notNull(),
    multiplier: real('multiplier').notNull(),
  },
  (t) => ({
    monthCategoryIdx: uniqueIndex('seasonal_month_category_idx').on(t.month, t.category),
  }),
);

// ─── Corpus RAG (pgvector) ─────────────────────────────────────────────────

export const rentalPoliciesVectors = pgTable(
  'rental_policies_vectors',
  {
    id: serial('id').primaryKey(),
    /** Identifiant stable du fragment : permet un reindexage idempotent. */
    chunkKey: text('chunk_key').notNull().unique(),
    sourceSection: text('source_section'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSION }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Index HNSW pour la recherche par similarite cosinus.
    embeddingIdx: index('policies_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  }),
);

// ─── Journal des requetes de l'agent ───────────────────────────────────────

export const agentRequests = pgTable('agent_requests', {
  requestId: text('request_id').primaryKey(),
  rawInput: text('raw_input').notNull(),
  intent: text('intent').notNull(),
  bookingStatus: text('booking_status').notNull(),
  needsHumanReview: boolean('needs_human_review').notNull().default(false),
  graphTrace: jsonb('graph_trace').notNull(),
  finalState: jsonb('final_state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Contrats Zod partages ─────────────────────────────────────────────────

export const fleetSelectSchema = createSelectSchema(fleetCatalog);
export const fleetInsertSchema = createInsertSchema(fleetCatalog);
export const customerSelectSchema = createSelectSchema(customerProfiles);
export const customerInsertSchema = createInsertSchema(customerProfiles);
export const bookingSelectSchema = createSelectSchema(bookingLogs);
export const bookingInsertSchema = createInsertSchema(bookingLogs);
export const seasonalSelectSchema = createSelectSchema(seasonalPricingMatrix);
export const seasonalInsertSchema = createInsertSchema(seasonalPricingMatrix);
