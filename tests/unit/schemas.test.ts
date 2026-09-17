/**
 * Contrats Zod appliqués À L'EXÉCUTION (EX-02, cahier des charges §3 et §8).
 *
 * Ces tests vérifient que les schémas ne servent pas qu'au typage : ils doivent
 * refuser une entrée invalide au moment où elle arrive, sans jamais la corriger
 * en silence ni inventer de valeur.
 */

import { describe, expect, it } from 'vitest';
import {
  chatRequestParamsSchema,
  detectAmbiguousDates,
  uploadedJsonSchema,
} from '@/lib/schemas/extraction';
import { validatorNode } from '@/lib/agent/nodes';
import { makeInitialState } from '@/lib/schemas/state';

describe('Paramètres réseau — validation Zod stricte', () => {
  it('accepte une demande complète et bien formée', () => {
    const r = chatRequestParamsSchema.safeParse({
      birthDate: '1991-05-20',
      licenseIssueDate: '2012-08-01',
      licenseExpDate: '2032-08-01',
      vehicleId: 'VH-0001',
      startDate: '2026-07-15',
      endDate: '2026-07-20',
      days: 5,
      month: 7,
      insuranceOption: 'basic',
    });
    expect(r.success).toBe(true);
  });

  it('REFUSE une date mal formée au lieu de la convertir en null', () => {
    const r = chatRequestParamsSchema.safeParse({ birthDate: '20/05/1991' });
    expect(r.success).toBe(false);
  });

  it('refuse une date inexistante au calendrier', () => {
    const r = chatRequestParamsSchema.safeParse({ birthDate: '2026-02-31' });
    expect(r.success).toBe(false);
  });

  it('refuse une restitution antérieure ou égale à la prise en charge', () => {
    expect(
      chatRequestParamsSchema.safeParse({ startDate: '2026-07-20', endDate: '2026-07-15' }).success,
    ).toBe(false);
    expect(
      chatRequestParamsSchema.safeParse({ startDate: '2026-07-15', endDate: '2026-07-15' }).success,
    ).toBe(false);
  });

  it('refuse un mois ou une durée hors bornes', () => {
    expect(chatRequestParamsSchema.safeParse({ month: 13 }).success).toBe(false);
    expect(chatRequestParamsSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(chatRequestParamsSchema.safeParse({ days: -3 }).success).toBe(false);
  });

  it('refuse une option d’assurance hors barème', () => {
    expect(chatRequestParamsSchema.safeParse({ insuranceOption: 'gratuite' }).success).toBe(false);
  });

  it('retire les clés inconnues, dont toute tentative de forçage d’intention', () => {
    const r = chatRequestParamsSchema.parse({
      vehicleId: 'VH-0001',
      intentOverride: 'make_reservation',
      isAdmin: true,
    });
    expect(r).not.toHaveProperty('intentOverride');
    expect(r).not.toHaveProperty('isAdmin');
    expect(r.vehicleId).toBe('VH-0001');
  });
});

describe('Document JSON téléversé — validation Zod (§8)', () => {
  it('accepte un objet de données non vide', () => {
    expect(uploadedJsonSchema.safeParse({ birthDate: '1991-05-20' }).success).toBe(true);
  });

  it('refuse un tableau, un scalaire ou un objet vide', () => {
    expect(uploadedJsonSchema.safeParse([1, 2, 3]).success).toBe(false);
    expect(uploadedJsonSchema.safeParse('texte').success).toBe(false);
    expect(uploadedJsonSchema.safeParse({}).success).toBe(false);
  });
});

describe('Zero-Trust — détection des dates ambiguës (§3)', () => {
  it('signale une date dont l’ordre jour/mois est indécidable', () => {
    expect(detectAmbiguousDates('DATE DE DELIVRANCE 01/09/2023')).toEqual(['01/09/2023']);
    expect(detectAmbiguousDates('émis le 04-11-2020')).toEqual(['04-11-2020']);
  });

  it('ne signale pas une date sans ambiguïté possible', () => {
    // 18 n'est pas un mois : la lecture est unique.
    expect(detectAmbiguousDates('NAISSANCE 18/02/2004')).toEqual([]);
    // Les deux lectures coïncident.
    expect(detectAmbiguousDates('le 05/05/2020')).toEqual([]);
    // Format ISO : non ambigu par construction.
    expect(detectAmbiguousDates('DOB: 1990-01-01')).toEqual([]);
  });

  it('dédoublonne les occurrences répétées', () => {
    expect(detectAmbiguousDates('01/09/2023 puis encore 01/09/2023')).toEqual(['01/09/2023']);
  });
});

describe('Validator — une date ambiguë déclenche une clarification', () => {
  it('bloque avant tout calcul et demande confirmation', async () => {
    const state = makeInitialState('t-ambigu', 'Voici mon permis', {
      birthDate: '1991-05-20',
      licenseIssueDate: '2012-08-01',
      licenseExpDate: '2032-08-01',
    });
    state.ambiguousDates = ['01/09/2023'];

    const r = await validatorNode(state);

    expect(r.bookingStatus).toBe('CLARIFICATION_REQUIRED');
    expect(r.eligibilityResult).toBeNull();
    expect(r.validation?.isValid).toBe(false);
    expect(r.validation?.errors.join(' ')).toMatch(/ambigu/i);
    expect(r.needsHumanReview).toBe(true);
  });

  it('laisse passer une demande sans date ambiguë', async () => {
    const state = makeInitialState('t-net', 'Voici mon permis', {
      birthDate: '1991-05-20',
      licenseIssueDate: '2012-08-01',
      licenseExpDate: '2032-08-01',
      referenceDate: '2026-07-15',
    });

    const r = await validatorNode(state);

    expect(r.bookingStatus).not.toBe('CLARIFICATION_REQUIRED');
    expect(r.eligibilityResult).not.toBeNull();
  });
});

describe('Éligibilité appréciée à la date de prise en charge (§4)', () => {
  it('bloque un permis expirant entre la date de référence et le départ', async () => {
    const state = makeInitialState('t-permis', 'Je veux louer', {
      birthDate: '1991-05-20',
      licenseIssueDate: '2012-08-01',
      licenseExpDate: '2026-08-01',
      // Prise en charge APRÈS l'expiration du permis.
      referenceDate: '2026-09-16',
    });

    const r = await validatorNode(state);
    const eligibility = r.eligibilityResult as { licenseExpired: boolean; eligible: boolean };

    expect(eligibility.licenseExpired).toBe(true);
    expect(eligibility.eligible).toBe(false);
    expect(r.bookingStatus).toBe('REJECTED');
  });
});
