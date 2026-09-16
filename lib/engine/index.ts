/**
 * Moteur déterministe Kiraa — point d'entrée unique.
 *
 * Tout ce qui est exporté ici est une fonction TypeScript pure :
 * aucun appel LLM, aucune E/S, aucun accès réseau ou base de données.
 * C'est la frontière de l'axiome Zéro-Hallucination.
 */

export * from './constants';
export * from './dates';
export * from './types';
export { verifyDriverEligibility, type EligibilityInput } from './eligibility';
export { checkVehicleAvailability, type AvailabilityInput } from './availability';
export { calculateTotalPrice, type PriceInput } from './pricing';
export { calculateMileagePenalty, kmAllowedForDays } from './mileage';
