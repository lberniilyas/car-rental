/**
 * Contrat du catalogue de flotte — PARTAGÉ entre PostgreSQL, l'API et l'interface.
 *
 * Le cahier des charges impose Drizzle ORM et `drizzle-zod` « afin de partager
 * les contrats de données entre PostgreSQL, l'API et l'interface ». Ce module
 * réalise ce partage : le schéma ci-dessous DÉRIVE de la table Drizzle via
 * `fleetSelectSchema`, l'API le fait respecter à la sortie, et `ChatUI` importe
 * le type qui en découle. Une colonne renommée en base casse donc la
 * compilation de l'interface — c'est exactement l'effet recherché.
 */

import { z } from 'zod';
import { fleetSelectSchema } from '@/db/schema';

/**
 * Véhicule tel qu'exposé au client.
 *
 * `vehicleId`, `category`, `transmission`, `location` et `vehiclesAvailable`
 * sont repris VERBATIM du contrat PostgreSQL. `baseDailyRate` est redéclaré en
 * nombre : la colonne est `numeric`, que le pilote renvoie en chaîne pour
 * préserver la précision décimale. `label` est une composition d'affichage.
 */
export const fleetOptionSchema = fleetSelectSchema
  .pick({
    vehicleId: true,
    category: true,
    transmission: true,
    location: true,
    vehiclesAvailable: true,
  })
  .extend({
    label: z.string().min(1),
    baseDailyRate: z.number().nonnegative(),
  });

export type FleetOption = z.infer<typeof fleetOptionSchema>;

export const fleetResponseSchema = z.object({
  vehicles: z.array(fleetOptionSchema),
});

export type FleetResponse = z.infer<typeof fleetResponseSchema>;
