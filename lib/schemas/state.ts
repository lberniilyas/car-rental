/**
 * État partagé du graphe LangGraph.js (`KiraaState`) et taxonomie des intentions.
 *
 * Port du `KiraaState` TypedDict du notebook (Module 4), étendu aux 7 intentions
 * et aux contrôles Zero-Trust exigés par le cahier des charges §3 et §4.
 */

import { z } from 'zod';

/** Les 7 intentions reconnues par le graphe (cahier des charges §4). */
export const INTENTS = [
  'check_availability',
  'calculate_total_cost',
  'validate_eligibility',
  'make_reservation',
  'policy_query',
  'human_escalation',
  'out_of_scope',
] as const;

export const intentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof intentSchema>;

/** Statuts de réservation. */
export const BOOKING_STATUSES = [
  'NONE',
  'CONFIRMED',
  'PENDING_REVIEW',
  'REJECTED',
  'CLARIFICATION_REQUIRED',
] as const;

export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** Résultat d'ingestion d'un fichier — un enregistrement par fichier (§8). */
export const ingestedFileSchema = z.object({
  filename: z.string(),
  fileType: z.enum(['JPG', 'JPEG', 'PNG', 'PDF', 'JSON', 'TXT', 'UNKNOWN']),
  sizeBytes: z.number().int().nonnegative(),
  validationStatus: z.enum(['PASS', 'FAIL', 'CLARIFICATION_REQUIRED']),
  processingEngine: z.enum(['native_pdf', 'ocr', 'json_parser', 'plain_text', 'not_used']),
  extractedText: z.string(),
  structuredContent: z.record(z.unknown()).nullable(),
  confidence: z.number().min(0).max(1),
  errors: z.array(z.string()),
  humanReviewStatus: z.enum(['PASS', 'REQUIRED']),
});

export type IngestedFile = z.infer<typeof ingestedFileSchema>;

export const ragPassageSchema = z.object({
  content: z.string(),
  similarity: z.number(),
  sourceSection: z.string().nullable(),
});

export type RagPassage = z.infer<typeof ragPassageSchema>;

export const validationSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.string()),
});

/**
 * État complet partagé entre les 7 nœuds.
 * Chaque nœud lit l'état, écrit ses propres champs et ne modifie jamais
 * les montants produits par le moteur déterministe.
 */
export const kiraaStateSchema = z.object({
  requestId: z.string(),
  rawInput: z.string(),
  intent: intentSchema.or(z.literal('')),
  intentConfidence: z.number().min(0).max(1),
  params: z.record(z.unknown()),
  extractedContent: z.record(z.unknown()),
  ingestedFiles: z.array(ingestedFileSchema),
  ocrConfidence: z.number().min(0).max(1),
  eligibilityResult: z.record(z.unknown()).nullable(),
  priceResult: z.record(z.unknown()).nullable(),
  availabilityResult: z.record(z.unknown()).nullable(),
  bookingStatus: bookingStatusSchema,
  ragPassages: z.array(ragPassageSchema),
  validation: validationSchema,
  needsHumanReview: z.boolean(),
  escalationReasons: z.array(z.string()),
  errors: z.array(z.string()),
  explanation: z.string(),
  report: z.record(z.unknown()).nullable(),
  graphTrace: z.array(z.string()),
  /**
   * Forçage d'intention réservé AUX TESTS E2E Vitest déterministes.
   * La route de production ne doit jamais renseigner ce champ.
   */
  intentOverride: intentSchema.nullable(),
});

export type KiraaState = z.infer<typeof kiraaStateSchema>;

export function makeInitialState(
  requestId: string,
  rawInput: string,
  params: Record<string, unknown> = {},
  intentOverride: Intent | null = null,
): KiraaState {
  return {
    requestId,
    rawInput,
    intent: '',
    intentConfidence: 0,
    params,
    extractedContent: {},
    ingestedFiles: [],
    ocrConfidence: 0,
    eligibilityResult: null,
    priceResult: null,
    availabilityResult: null,
    bookingStatus: 'NONE',
    ragPassages: [],
    validation: { isValid: false, errors: [] },
    needsHumanReview: false,
    escalationReasons: [],
    errors: [],
    explanation: '',
    report: null,
    graphTrace: [],
    intentOverride,
  };
}
