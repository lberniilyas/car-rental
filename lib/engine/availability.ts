/**
 * §4.2 — Disponibilité d'un véhicule par détection de chevauchement.
 * Port direct de `check_vehicle_availability()` (notebook Module 2).
 *
 * AXIOME ZÉRO-HALLUCINATION : fonction pure, aucun appel LLM.
 */

import { formatDate, parseDate, type PlainDate } from './dates';
import type { AvailabilityResult, BookingRecord, FleetVehicle, SubstituteVehicle } from './types';

const MAX_SUBSTITUTES = 3;
/** Le notebook n'examine que les 5 premiers véhicules de même catégorie. */
const SUBSTITUTE_SCAN_LIMIT = 5;

/**
 * Chevauchement strict : `start < requestedEnd && end > requestedStart`.
 * Une réservation qui se termine le jour où la suivante commence ne bloque pas.
 */
function overlaps(
  booking: BookingRecord,
  requestedStart: PlainDate,
  requestedEnd: PlainDate,
): boolean {
  const start = parseDate(booking.startDate);
  const end = parseDate(booking.endDate);
  return start.getTime() < requestedEnd.getTime() && end.getTime() > requestedStart.getTime();
}

export interface AvailabilityInput {
  vehicleId: string;
  startDate: string | PlainDate;
  endDate: string | PlainDate;
  bookings: BookingRecord[];
  fleet: FleetVehicle[];
}

export function checkVehicleAvailability(input: AvailabilityInput): AvailabilityResult {
  const requestedStart = parseDate(input.startDate);
  const requestedEnd = parseDate(input.endDate);

  const conflicts = input.bookings
    .filter((b) => b.vehicleId === input.vehicleId)
    .filter((b) => overlaps(b, requestedStart, requestedEnd));

  const available = conflicts.length === 0;
  const substitutes: SubstituteVehicle[] = [];

  if (!available) {
    const vehicle = input.fleet.find((v) => v.vehicleId === input.vehicleId);
    if (vehicle) {
      const sameCategory = input.fleet
        .filter((v) => v.category === vehicle.category && v.vehicleId !== input.vehicleId)
        .slice(0, SUBSTITUTE_SCAN_LIMIT);

      for (const candidate of sameCategory) {
        const isFree = !input.bookings
          .filter((b) => b.vehicleId === candidate.vehicleId)
          .some((b) => overlaps(b, requestedStart, requestedEnd));

        if (isFree) {
          substitutes.push({
            vehicleId: candidate.vehicleId,
            make: candidate.make,
            model: candidate.model,
            baseDailyRate: candidate.baseDailyRate,
          });
        }
        if (substitutes.length >= MAX_SUBSTITUTES) break;
      }
    }
  }

  return {
    available,
    vehicleId: input.vehicleId,
    requestedStart: formatDate(requestedStart),
    requestedEnd: formatDate(requestedEnd),
    conflictingBookings: conflicts.length,
    substitutes,
  };
}
