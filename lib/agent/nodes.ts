/**
 * Les 7 couches agentiques (cahier des charges §4).
 *
 *   1 Ingestor     — normalise message, images, PDF, JSON, TXT
 *   2 Extractor    — extrait les champs via Zod, produit un état typé
 *   3 Orchestrator — (graph.ts) route, partage l'état, déclenche l'escalade
 *   4 Calculator   — formules déterministes, aucun appel LLM
 *   5 Validator    — règles booléennes, résultat validé par Zod
 *   6 Explainer    — explique sans modifier montants, dates ni décisions
 *   7 Reporter     — assemble le devis / rapport final
 */

import { z } from 'zod';
import {
  DEPOSIT_HITL_THRESHOLD,
  OCR_CONFIDENCE_THRESHOLD,
  REFERENCE_DATE,
  calculateMileagePenalty,
  calculateTotalPrice,
  checkVehicleAvailability,
  kmAllowedForDays,
  verifyDriverEligibility,
} from '@/lib/engine';
import { chat, chatStructured } from '@/lib/llm/client';
import { retrievePolicyPassages } from '@/lib/rag/retrieve';
import { ingestFiles } from '@/lib/ingestor';
import { INTENTS, type Intent, type KiraaState } from '@/lib/schemas/state';
import { missingLicenseFields, partialDriverLicenseSchema } from '@/lib/schemas/extraction';
import { loadBookings, loadFleet, loadSeasonalRates } from './repository';

export type NodeResult = Partial<KiraaState>;

const trace = (state: KiraaState, node: string): string[] => [...(state.graphTrace ?? []), node];

// ─── Couche 1 — Ingestor ───────────────────────────────────────────────────

export async function ingestorNode(state: KiraaState): Promise<NodeResult> {
  const files = (state.params?.files ?? []) as { buffer: Buffer; filename: string }[];
  const errors = [...state.errors];

  let ingested = state.ingestedFiles;
  if (Array.isArray(files) && files.length > 0) {
    ingested = await ingestFiles(files);
    for (const f of ingested) {
      if (f.validationStatus !== 'PASS') {
        errors.push(`${f.filename} : ${f.errors.join(' ') || f.validationStatus}`);
      }
    }
  }

  // Confiance retenue = la plus faible du lot (principe du maillon faible).
  const confidences = ingested
    .filter((f) => f.validationStatus === 'PASS')
    .map((f) => f.confidence);
  const ocrConfidence = confidences.length > 0 ? Math.min(...confidences) : 1;

  return {
    ingestedFiles: ingested,
    ocrConfidence,
    errors,
    graphTrace: trace(state, 'ingestor_node'),
  };
}

// ─── Couche 2 — Extractor ──────────────────────────────────────────────────

const EXTRACT_SYSTEM = [
  "Tu es un extracteur de données de documents d'identité et de permis de conduire.",
  'Tu retournes UNIQUEMENT un objet JSON avec les clés suivantes :',
  'firstName, lastName, birthDate, licenseIssueDate, licenseExpDate.',
  'Les dates sont au format YYYY-MM-DD.',
  'REGLE ABSOLUE : si une information est absente ou illisible, mets null.',
  "Tu n'inventes JAMAIS une valeur. Tu ne devines JAMAIS une date.",
].join('\n');

export async function extractorNode(state: KiraaState): Promise<NodeResult> {
  const textBlocks = state.ingestedFiles
    .filter((f) => f.validationStatus === 'PASS')
    .map((f) => f.extractedText)
    .filter((t) => t.trim().length > 0);

  const errors = [...state.errors];
  const escalationReasons = [...state.escalationReasons];
  let extracted: Record<string, unknown> = { ...state.extractedContent };

  if (textBlocks.length > 0) {
    try {
      const parsed = await chatStructured(
        [
          { role: 'system', content: EXTRACT_SYSTEM },
          { role: 'user', content: textBlocks.join('\n\n---\n\n').slice(0, 6000) },
        ],
        partialDriverLicenseSchema,
      );
      extracted = { ...extracted, ...parsed };

      const missing = missingLicenseFields(parsed);
      if (missing.length > 0) {
        errors.push(`Champs absents du document : ${missing.join(', ')}`);
      }
    } catch (e) {
      errors.push(`Extraction structurée impossible : ${(e as Error).message}`);
    }
  }

  // Seuil HITL sur la confiance d'extraction (§4).
  if (state.ingestedFiles.length > 0 && state.ocrConfidence < OCR_CONFIDENCE_THRESHOLD) {
    escalationReasons.push(
      `Confiance d'extraction ${state.ocrConfidence.toFixed(2)} < ${OCR_CONFIDENCE_THRESHOLD}`,
    );
  }

  return {
    extractedContent: extracted,
    errors,
    escalationReasons,
    graphTrace: trace(state, 'extractor_node'),
  };
}

// ─── Couche 3 (partielle) — Détection d'intention ──────────────────────────

const intentResponseSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
});

const INTENT_SYSTEM = [
  "Tu classes la demande d'un client d'une agence de location de véhicules.",
  'Réponds UNIQUEMENT en JSON : {"intent": "<intention>", "confidence": <0..1>}.',
  'Intentions possibles :',
  '- check_availability : disponibilité d\'un véhicule à des dates données',
  '- calculate_total_cost : prix, devis, coût total',
  '- validate_eligibility : vérifier permis, âge, éligibilité du conducteur',
  '- make_reservation : réserver, confirmer une location',
  '- policy_query : question sur annulation, franchise, assurance, kilométrage',
  '- human_escalation : litige, réclamation, demande de contact humain',
  '- out_of_scope : sans rapport avec la location de véhicules',
].join('\n');

export async function intentNode(state: KiraaState): Promise<NodeResult> {
  // Le forçage d'intention est réservé aux tests E2E déterministes.
  if (state.intentOverride) {
    return {
      intent: state.intentOverride,
      intentConfidence: 1,
      graphTrace: trace(state, 'intent_node'),
    };
  }

  const errors = [...state.errors];
  let intent: Intent = 'out_of_scope';
  let confidence = 0;

  try {
    const result = await chatStructured(
      [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: state.rawInput.slice(0, 3000) },
      ],
      intentResponseSchema,
      { maxTokens: 200 },
    );
    intent = result.intent;
    confidence = result.confidence;
  } catch (e) {
    errors.push(`Classification d'intention impossible : ${(e as Error).message}`);
  }

  return {
    intent,
    intentConfidence: confidence,
    errors,
    graphTrace: trace(state, 'intent_node'),
  };
}

// ─── Couche 5 — Validator ──────────────────────────────────────────────────

export async function validatorNode(state: KiraaState): Promise<NodeResult> {
  const escalationReasons = [...state.escalationReasons];
  const validationErrors: string[] = [];
  const params = state.params ?? {};
  const extracted = state.extractedContent ?? {};

  // Les données du document priment, le formulaire sert de repli.
  const birthDate = (extracted.birthDate ?? params.birthDate) as string | undefined;
  const licenseIssueDate = (extracted.licenseIssueDate ?? params.licenseIssueDate) as
    | string
    | undefined;
  const licenseExpDate = (extracted.licenseExpDate ?? params.licenseExpDate) as string | undefined;
  const vehicleCategory = (params.vehicleCategory ?? null) as string | null;
  const referenceDate = (params.referenceDate ?? REFERENCE_DATE) as string;

  // Zero-Trust : conflit entre formulaire et document -> confirmation humaine.
  for (const field of ['birthDate', 'licenseIssueDate', 'licenseExpDate'] as const) {
    const fromDoc = extracted[field];
    const fromForm = params[field];
    if (fromDoc && fromForm && fromDoc !== fromForm) {
      escalationReasons.push(
        `Conflit sur ${field} : document "${String(fromDoc)}" vs formulaire "${String(fromForm)}"`,
      );
    }
  }

  // Zero-Trust : champ requis absent -> CLARIFICATION_REQUIRED, aucune invention.
  if (!birthDate || !licenseIssueDate || !licenseExpDate) {
    const missing = [
      !birthDate ? 'date de naissance' : null,
      !licenseIssueDate ? 'date de délivrance du permis' : null,
      !licenseExpDate ? "date d'expiration du permis" : null,
    ].filter((v): v is string => v !== null);

    validationErrors.push(`Informations manquantes : ${missing.join(', ')}`);
    return {
      eligibilityResult: null,
      bookingStatus: 'CLARIFICATION_REQUIRED',
      validation: { isValid: false, errors: validationErrors },
      needsHumanReview: state.needsHumanReview || escalationReasons.length > 0,
      escalationReasons,
      graphTrace: trace(state, 'validator_node'),
    };
  }

  const eligibility = verifyDriverEligibility({
    birthDate,
    licenseIssueDate,
    licenseExpDate,
    referenceDate,
    vehicleCategory,
  });

  if (eligibility.needsHumanReview) {
    escalationReasons.push('Jeune conducteur sur Premium');
  }

  const bookingStatus = eligibility.eligible ? state.bookingStatus : 'REJECTED';

  return {
    eligibilityResult: eligibility as unknown as Record<string, unknown>,
    bookingStatus,
    validation: { isValid: eligibility.eligible, errors: eligibility.rejectionReasons },
    needsHumanReview: state.needsHumanReview || escalationReasons.length > 0,
    escalationReasons,
    graphTrace: trace(state, 'validator_node'),
  };
}

// ─── Couche 4 — Calculator ─────────────────────────────────────────────────

export async function calculatorNode(state: KiraaState): Promise<NodeResult> {
  const escalationReasons = [...state.escalationReasons];
  const errors = [...state.errors];
  const params = state.params ?? {};

  // Question de politique : RAG uniquement, AUCUN calcul financier (§7).
  if (state.intent === 'policy_query') {
    let passages = state.ragPassages;
    try {
      passages = await retrievePolicyPassages(state.rawInput);
    } catch (e) {
      errors.push(`Recherche RAG impossible : ${(e as Error).message}`);
    }
    return {
      ragPassages: passages,
      priceResult: null,
      availabilityResult: null,
      errors,
      graphTrace: trace(state, 'calculator_node'),
    };
  }

  const vehicleId = params.vehicleId as string | undefined;
  if (!vehicleId) {
    errors.push('Aucun véhicule indiqué : calcul impossible.');
    return {
      errors,
      bookingStatus: 'CLARIFICATION_REQUIRED',
      graphTrace: trace(state, 'calculator_node'),
    };
  }

  const [fleet, bookings, seasonalRates] = await Promise.all([
    loadFleet(),
    loadBookings(),
    loadSeasonalRates(),
  ]);

  let availabilityResult = state.availabilityResult;
  if (params.startDate && params.endDate) {
    availabilityResult = checkVehicleAvailability({
      vehicleId,
      startDate: params.startDate as string,
      endDate: params.endDate as string,
      bookings,
      fleet,
    }) as unknown as Record<string, unknown>;
  }

  let priceResult = state.priceResult;
  const wantsPrice = state.intent === 'calculate_total_cost' || state.intent === 'make_reservation';

  if (wantsPrice) {
    const eligibility = state.eligibilityResult as { riskCategory?: string } | null;
    const days = Number(params.days ?? 1);
    const month = Number(params.month ?? Number(REFERENCE_DATE.slice(5, 7)));
    try {
      const price = calculateTotalPrice({
        vehicleId,
        days,
        month,
        insuranceOption: (params.insuranceOption as string) ?? 'basic',
        discountCode: (params.discountCode as string) ?? '',
        riskCategory: eligibility?.riskCategory ?? 'standard',
        fleet,
        seasonalRates,
      });
      priceResult = price as unknown as Record<string, unknown>;

      if (price.deposit > DEPOSIT_HITL_THRESHOLD) {
        escalationReasons.push(`Caution requise ${price.deposit} MAD > ${DEPOSIT_HITL_THRESHOLD}`);
      }

      // Pénalité kilométrique, si un kilométrage est fourni.
      if (params.kmDriven != null) {
        const mileage = calculateMileagePenalty(
          Number(params.kmDriven),
          Number(params.kmAllowed ?? kmAllowedForDays(days)),
        );
        priceResult = { ...priceResult, mileage } as Record<string, unknown>;
      }
    } catch (e) {
      errors.push(`Calcul tarifaire impossible : ${(e as Error).message}`);
    }
  }

  return {
    availabilityResult,
    priceResult,
    errors,
    escalationReasons,
    needsHumanReview: state.needsHumanReview || escalationReasons.length > 0,
    graphTrace: trace(state, 'calculator_node'),
  };
}

// ─── Couche 6 — Explainer ──────────────────────────────────────────────────

const EXPLAINER_SYSTEM = [
  "Tu es l'agent explicatif d'une agence de location de véhicules marocaine.",
  'On te fournit un état de décision DÉJÀ CALCULÉ. Tu rédiges une explication claire en français.',
  '',
  'RÈGLES ABSOLUES :',
  '- Tu ne recalcules RIEN. Tu ne modifies aucun montant, aucune date, aucune décision.',
  "- Tu ne cites que des chiffres présents dans l'état fourni.",
  "- Si un montant n'est pas dans l'état, tu ne l'inventes pas.",
  '- Tu restes concis : 2 à 5 phrases.',
  '- Pour une question de politique, tu réponds UNIQUEMENT à partir des passages fournis.',
].join('\n');

export async function explainerNode(state: KiraaState): Promise<NodeResult> {
  // Sous-ensemble STRICTEMENT en lecture seule transmis au LLM.
  const readonly = {
    intent: state.intent,
    eligibility_result: state.eligibilityResult,
    price_result: state.priceResult,
    availability_result: state.availabilityResult,
    rag_passages: state.ragPassages.map((p) => p.content),
    validation: state.validation,
    needs_human_review: state.needsHumanReview,
    escalation_reasons: state.escalationReasons,
    booking_status: state.bookingStatus,
    errors: state.errors,
  };

  const errors = [...state.errors];
  let explanation = '';
  try {
    explanation = await chat(
      [
        { role: 'system', content: EXPLAINER_SYSTEM },
        {
          role: 'user',
          content:
            `Demande du client : ${state.rawInput}\n\n` +
            `État de décision (lecture seule) :\n${JSON.stringify(readonly, null, 2)}`,
        },
      ],
      { maxTokens: 700 },
    );
  } catch (e) {
    errors.push(`Génération de l'explication impossible : ${(e as Error).message}`);
    explanation =
      'Explication indisponible. Les résultats déterministes ci-dessus restent valides.';
  }

  return {
    explanation: explanation.trim(),
    errors,
    graphTrace: trace(state, 'explainer_node'),
  };
}

// ─── Couche 7 — Reporter ───────────────────────────────────────────────────

export async function reporterNode(state: KiraaState): Promise<NodeResult> {
  let bookingStatus: KiraaState['bookingStatus'] = state.bookingStatus;

  if (state.intent === 'make_reservation' && state.bookingStatus === 'NONE') {
    if (state.needsHumanReview) {
      bookingStatus = 'PENDING_REVIEW';
    } else if (state.validation.isValid) {
      bookingStatus = 'CONFIRMED';
    } else {
      bookingStatus = 'REJECTED';
    }
  } else if (
    state.intent === 'make_reservation' &&
    state.bookingStatus !== 'REJECTED' &&
    state.bookingStatus !== 'CLARIFICATION_REQUIRED' &&
    state.needsHumanReview
  ) {
    bookingStatus = 'PENDING_REVIEW';
  }

  const report = {
    requestId: state.requestId,
    intent: state.intent,
    bookingStatus,
    eligibility: state.eligibilityResult,
    price: state.priceResult,
    availability: state.availabilityResult,
    policySources: state.ragPassages.map((p) => ({
      section: p.sourceSection,
      similarity: p.similarity,
    })),
    needsHumanReview: state.needsHumanReview,
    escalationReasons: state.escalationReasons,
    explanation: state.explanation,
    files: state.ingestedFiles.map((f) => ({
      filename: f.filename,
      type: f.fileType,
      status: f.validationStatus,
      engine: f.processingEngine,
      confidence: f.confidence,
      humanReview: f.humanReviewStatus,
    })),
    errors: state.errors,
    generatedAt: new Date().toISOString(),
  };

  return {
    bookingStatus,
    report,
    graphTrace: trace(state, 'reporter_node'),
  };
}
