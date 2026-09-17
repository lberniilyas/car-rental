/**
 * Schémas d'extraction structurée (EX-02).
 *
 * Équivalent TypeScript de `DriverLicenseSchema` (notebook Module 3).
 * Le LLM ne renvoie JAMAIS de données directement exploitables : sa sortie
 * traverse obligatoirement ces schémas Zod. Un champ manquant ou mal formé
 * déclenche `CLARIFICATION_REQUIRED`, jamais une valeur inventée.
 */

import { z } from 'zod';

/** `YYYY-MM-DD` valide au calendrier (rejette 2026-02-31). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date attendu : YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Date inexistante au calendrier');

/** Champs extraits d'un permis de conduire ou d'une pièce d'identité. */
export const driverLicenseSchema = z.object({
  firstName: z.string().min(1, 'Prénom du conducteur'),
  lastName: z.string().min(1, 'Nom de famille du conducteur'),
  birthDate: isoDateSchema.describe('Date de naissance au format YYYY-MM-DD'),
  licenseIssueDate: isoDateSchema.describe('Date de délivrance du permis'),
  licenseExpDate: isoDateSchema.describe('Date d’expiration du permis'),
});

export type DriverLicense = z.infer<typeof driverLicenseSchema>;

/**
 * Variante tolérante utilisée à la sortie immédiate du LLM.
 * Les champs absents restent `null` — jamais inventés — et sont ensuite
 * convertis en demandes de clarification par le nœud Extractor.
 */
export const partialDriverLicenseSchema = z.object({
  firstName: z.string().min(1).nullable().catch(null),
  lastName: z.string().min(1).nullable().catch(null),
  birthDate: isoDateSchema.nullable().catch(null),
  licenseIssueDate: isoDateSchema.nullable().catch(null),
  licenseExpDate: isoDateSchema.nullable().catch(null),
});

export type PartialDriverLicense = z.infer<typeof partialDriverLicenseSchema>;

/** Liste les champs obligatoires absents d'une extraction partielle. */
export function missingLicenseFields(value: PartialDriverLicense): string[] {
  return Object.entries(value)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/** Paramètres de réservation extraits du message utilisateur. */
export const bookingParamsSchema = z.object({
  vehicleId: z.string().nullable().catch(null),
  vehicleCategory: z.string().nullable().catch(null),
  startDate: isoDateSchema.nullable().catch(null),
  endDate: isoDateSchema.nullable().catch(null),
  days: z.number().int().positive().nullable().catch(null),
  insuranceOption: z.enum(['basic', 'all_risk', 'franchise_buyback']).nullable().catch(null),
  discountCode: z.string().nullable().catch(null),
});

export type BookingParams = z.infer<typeof bookingParamsSchema>;

/**
 * Contrat des paramètres reçus par `POST /api/chat` (EX-02).
 *
 * Contrairement à `bookingParamsSchema`, qui tolère les valeurs absentes issues
 * d'une extraction LLM, ce schéma s'applique à une entrée RÉSEAU : il est
 * strict. Aucun `.catch()` — une valeur mal formée doit être REFUSÉE et
 * signalée, jamais convertie silencieusement en `null`, sans quoi le contrôle
 * Zero-Trust « champ absent -> CLARIFICATION_REQUIRED » serait contourné.
 *
 * Les clés inconnues sont retirées : le réseau ne peut injecter dans l'état du
 * graphe que ce qui est déclaré ici (`intentOverride` est ainsi neutralisé).
 */
export const chatRequestParamsSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),

    birthDate: isoDateSchema.optional(),
    licenseIssueDate: isoDateSchema.optional(),
    licenseExpDate: isoDateSchema.optional(),
    referenceDate: isoDateSchema.optional(),

    vehicleId: z.string().min(1).max(50).optional(),
    vehicleCategory: z.string().min(1).max(50).optional(),

    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    days: z.number().int().positive().max(365).optional(),
    month: z.number().int().min(1).max(12).optional(),

    insuranceOption: z.enum(['basic', 'all_risk', 'franchise_buyback']).optional(),
    discountCode: z.string().max(50).optional(),

    kmDriven: z.number().nonnegative().max(1_000_000).optional(),
    kmAllowed: z.number().nonnegative().max(1_000_000).optional(),
  })
  .strip()
  .refine(
    (p) => !p.startDate || !p.endDate || p.endDate > p.startDate,
    'La date de restitution doit être postérieure à la date de prise en charge.',
  );

export type ChatRequestParams = z.infer<typeof chatRequestParamsSchema>;

/**
 * Contrat d'un document JSON téléversé (cahier des charges §8 : « Le JSON est
 * chargé et validé par Zod »).
 *
 * Un document exploitable est un objet non vide. Un tableau, un scalaire ou un
 * objet vide ne décrit aucune donnée métier : il part en
 * CLARIFICATION_REQUIRED, sans qu'aucun champ ne soit inventé.
 */
export const uploadedJsonSchema = z
  .record(z.string(), z.unknown())
  .refine((o) => Object.keys(o).length > 0, 'Objet JSON vide : aucune donnée exploitable.');

export type UploadedJson = z.infer<typeof uploadedJsonSchema>;

/**
 * Contrôle Zero-Trust « date ambiguë -> demande de clarification » (§3).
 *
 * Un document peut porter une date numérique dont l'ordre jour/mois est
 * indécidable : `01/09/2023` vaut 1er septembre en notation française et
 * 9 janvier en notation anglo-saxonne. Le LLM trancherait silencieusement ;
 * l'axiome Zéro-Hallucination l'interdit.
 *
 * N'est ambiguë qu'une date dont les deux premiers groupes sont tous deux des
 * mois possibles ET différents : `18/02/2004` ne l'est pas (18 n'est pas un
 * mois), `05/05/2020` non plus (les deux lectures coïncident).
 *
 * Fonction pure : aucune E/S, aucun appel LLM.
 */
export function detectAmbiguousDates(text: string): string[] {
  const found = new Set<string>();
  const pattern = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;

  for (const match of text.matchAll(pattern)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second) {
      found.add(match[0]);
    }
  }
  return [...found];
}
