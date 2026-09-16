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
