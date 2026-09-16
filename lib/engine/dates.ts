/**
 * Primitives de date et d'arrondi.
 *
 * Parité Python : `round()` en Python utilise l'arrondi au pair le plus proche
 * (banker's rounding), et NON l'arrondi commercial de `Number.toFixed()`.
 * `roundPy()` reproduit ce comportement pour garantir l'égalité stricte des
 * montants avec le notebook de référence.
 */

/** Date civile sans fuseau, normalisée à minuit UTC. */
export type PlainDate = Date;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Convertit une chaîne `YYYY-MM-DD` en date UTC. Lève si le format est invalide. */
export function parseDate(value: string | Date): PlainDate {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) {
    throw new Error(`Date invalide « ${value} » : format attendu YYYY-MM-DD`);
  }
  const [y, m, d] = trimmed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Date inexistante au calendrier : « ${value} »`);
  }
  return dt;
}

/** Formate une date UTC en `YYYY-MM-DD`. */
export function formatDate(date: PlainDate): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Âge en années révolues.
 * Port de `calculate_age()` (notebook Module 2).
 */
export function calculateAge(birthDate: PlainDate, referenceDate: PlainDate): number {
  let age = referenceDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const refMonthDay = [referenceDate.getUTCMonth(), referenceDate.getUTCDate()];
  const birthMonthDay = [birthDate.getUTCMonth(), birthDate.getUTCDate()];
  if (
    refMonthDay[0] < birthMonthDay[0] ||
    (refMonthDay[0] === birthMonthDay[0] && refMonthDay[1] < birthMonthDay[1])
  ) {
    age -= 1;
  }
  return age;
}

/** Nombre de jours calendaires entre deux dates. */
export function daysBetween(start: PlainDate, end: PlainDate): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * Années fractionnaires entre deux dates, arrondies à 1 décimale.
 * Port de `calculate_years_between()` : `round(delta.days / 365.25, 1)`.
 */
export function calculateYearsBetween(start: PlainDate, end: PlainDate): number {
  return roundPy(daysBetween(start, end) / 365.25, 1);
}

/**
 * Arrondi « au pair le plus proche » identique à `round()` de Python 3.
 * Indispensable pour la parité des montants (`round(x, 2)` dans le notebook).
 */
export function roundPy(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;

  // Corrige la dérive binaire (ex. 2.675 * 100 === 267.49999999999997)
  const corrected = Number(scaled.toPrecision(15));
  const floor = Math.floor(corrected);
  const diff = corrected - floor;

  let result: number;
  if (Math.abs(diff - 0.5) < Number.EPSILON) {
    // Égalité parfaite : on retient l'entier pair.
    result = floor % 2 === 0 ? floor : floor + 1;
  } else {
    result = Math.round(corrected);
  }
  return result / factor;
}
