/**
 * Tests E2E — les 5 scénarios du cahier des charges §3.
 *
 * Chaque scénario appelle RÉELLEMENT le graphe LangGraph.js et vérifie l'état
 * partagé : bookingStatus, needsHumanReview, escalationReasons, montant de la
 * caution, plafond de remise, présence des passages RAG et absence de calcul
 * pour une question de politique.
 *
 * `intentOverride` rend le routage déterministe : il est réservé à ces tests
 * et n'est jamais renseigné par la route de production.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '@/lib/agent/graph';
import { loadFleet } from '@/lib/agent/repository';
import { closePool } from '@/db/client';
import { DEPOSIT_BY_CATEGORY } from '@/lib/engine/constants';

const REF = '2026-07-15';

let premiumId: string;
let economyId: string;

beforeAll(async () => {
  const fleet = await loadFleet();
  premiumId = fleet.find((v) => v.category === 'Premium')!.vehicleId;
  economyId = fleet.find((v) => v.category === 'Economy')!.vehicleId;
});

afterAll(async () => {
  await closePool();
});

describe('Scénarios E2E du cahier des charges', () => {
  it(
    'S1 — conducteur mineur : rejet automatique, aucun calcul de prix',
    async () => {
      const state = await runAgent({
        requestId: 'e2e-s1',
        rawInput: "J'ai 19 ans et je veux louer une voiture.",
        intentOverride: 'validate_eligibility',
        params: {
          birthDate: '2007-03-10',
          licenseIssueDate: '2025-06-15',
          licenseExpDate: '2035-06-15',
          referenceDate: REF,
        },
      });

      expect(state.bookingStatus).toBe('REJECTED');
      expect(state.validation.isValid).toBe(false);
      expect((state.eligibilityResult as { eligible: boolean }).eligible).toBe(false);
      // Aucun calcul financier ne doit avoir eu lieu.
      expect(state.priceResult).toBeNull();
      expect(state.graphTrace).not.toContain('calculator_node');
      expect(state.graphTrace).toEqual([
        'ingestor_node',
        'extractor_node',
        'intent_node',
        'validator_node',
        'explainer_node',
        'reporter_node',
      ]);
    },
    { timeout: 120_000 },
  );

  it(
    'S2 — permis expiré : blocage immédiat malgré un âge conforme',
    async () => {
      const state = await runAgent({
        requestId: 'e2e-s2',
        rawInput: 'Mon permis a expiré il y a trois mois, puis-je louer ?',
        intentOverride: 'validate_eligibility',
        params: {
          birthDate: '1985-11-22',
          licenseIssueDate: '2010-01-10',
          licenseExpDate: '2026-01-10',
          referenceDate: REF,
        },
      });

      const eligibility = state.eligibilityResult as {
        eligible: boolean;
        licenseExpired: boolean;
        age: number;
      };
      expect(eligibility.licenseExpired).toBe(true);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.age).toBeGreaterThanOrEqual(21); // âge conforme, blocage quand même
      expect(state.bookingStatus).toBe('REJECTED');
      expect(state.priceResult).toBeNull();
    },
    { timeout: 120_000 },
  );

  it(
    'S3 — jeune conducteur + Premium : éligible, caution +50%, escalade humaine',
    async () => {
      const state = await runAgent({
        requestId: 'e2e-s3',
        rawInput: "J'ai 22 ans et je souhaite réserver un véhicule Premium.",
        intentOverride: 'make_reservation',
        params: {
          birthDate: '2004-02-18',
          licenseIssueDate: '2023-09-01',
          licenseExpDate: '2033-09-01',
          referenceDate: REF,
          vehicleId: premiumId,
          vehicleCategory: 'Premium',
          days: 5,
          month: 7,
          insuranceOption: 'basic',
        },
      });

      const eligibility = state.eligibilityResult as {
        eligible: boolean;
        riskCategory: string;
      };
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.riskCategory).toBe('jeune_conducteur');

      expect(state.needsHumanReview).toBe(true);
      expect(state.escalationReasons).toContain('Jeune conducteur sur Premium');
      expect(state.bookingStatus).toBe('PENDING_REVIEW');

      // Caution majorée de 50% par rapport au barème Premium.
      const price = state.priceResult as { deposit: number };
      expect(price.deposit).toBe(Math.trunc(DEPOSIT_BY_CATEGORY.Premium * 1.5));
    },
    { timeout: 120_000 },
  );

  it(
    'S4 — remise hors barème : plafonnée à 15%',
    async () => {
      const state = await runAgent({
        requestId: 'e2e-s4',
        rawInput: 'Je veux une remise de 25% avec le code FLASH25.',
        intentOverride: 'calculate_total_cost',
        params: {
          birthDate: '1991-05-20',
          licenseIssueDate: '2012-08-01',
          licenseExpDate: '2032-08-01',
          referenceDate: REF,
          vehicleId: economyId,
          days: 5,
          month: 7,
          insuranceOption: 'basic',
          discountCode: 'FLASH25',
        },
      });

      const price = state.priceResult as {
        discountCapped: boolean;
        discountAmount: number;
        subtotal: number;
      };
      expect(price.discountCapped).toBe(true);
      // La remise effective ne dépasse jamais 15% du sous-total.
      expect(price.discountAmount).toBeCloseTo(price.subtotal * 0.15, 2);
      expect(price.discountAmount / price.subtotal).toBeLessThanOrEqual(0.15 + 1e-9);
    },
    { timeout: 120_000 },
  );

  it(
    'S5 — question de politique : réponse via RAG uniquement, aucun calcul',
    async () => {
      const state = await runAgent({
        requestId: 'e2e-s5',
        rawInput: "Puis-je annuler ma réservation 24 heures avant la prise en charge ?",
        intentOverride: 'policy_query',
        params: {},
      });

      expect(state.ragPassages.length).toBeGreaterThan(0);
      expect(state.ragPassages[0].content.length).toBeGreaterThan(0);

      // Aucun calcul financier, aucune vérification d'éligibilité.
      expect(state.priceResult).toBeNull();
      expect(state.eligibilityResult).toBeNull();
      expect(state.graphTrace).not.toContain('validator_node');
      expect(state.explanation.length).toBeGreaterThan(0);
    },
    { timeout: 120_000 },
  );
});
