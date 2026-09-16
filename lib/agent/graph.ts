/**
 * Couche 3 — Orchestrateur LangGraph.js (EX-04).
 *
 * Topologie reprise du notebook Module 4 :
 *
 *   START -> ingestor -> extractor -> intent -> [routeIntent]
 *       policy_query    -> calculator (RAG seul) -> explainer
 *       out_of_scope    -> explainer
 *       human_escalation-> explainer
 *       autres          -> validator -> [routeAfterValidator]
 *                              éligibilité seule -> explainer
 *                              sinon             -> calculator -> explainer
 *   explainer -> reporter -> END
 *
 * L'état partagé est persisté par un checkpointer PostgreSQL, et le chemin
 * réellement emprunté est journalisé dans `graphTrace`.
 */

import { END, START, StateGraph, type StateGraphArgs } from '@langchain/langgraph';
import type { KiraaState } from '@/lib/schemas/state';
import { makeInitialState } from '@/lib/schemas/state';
import {
  calculatorNode,
  explainerNode,
  extractorNode,
  ingestorNode,
  intentNode,
  reporterNode,
  validatorNode,
} from './nodes';

/**
 * Canaux de l'état : chaque champ est écrasé par la valeur produite par le
 * nœud. Les nœuds reçoivent l'état complet et renvoient leurs champs modifiés,
 * ce qui reproduit la sémantique du TypedDict du notebook.
 */
const channels: StateGraphArgs<KiraaState>['channels'] = {
  requestId: { value: (_x: string, y: string) => y, default: () => '' },
  rawInput: { value: (_x: string, y: string) => y, default: () => '' },
  intent: { value: (_x, y) => y, default: () => '' as KiraaState['intent'] },
  intentConfidence: { value: (_x: number, y: number) => y, default: () => 0 },
  params: { value: (_x, y) => y, default: () => ({}) },
  extractedContent: { value: (_x, y) => y, default: () => ({}) },
  ingestedFiles: { value: (_x, y) => y, default: () => [] },
  ocrConfidence: { value: (_x: number, y: number) => y, default: () => 0 },
  eligibilityResult: { value: (_x, y) => y, default: () => null },
  priceResult: { value: (_x, y) => y, default: () => null },
  availabilityResult: { value: (_x, y) => y, default: () => null },
  bookingStatus: { value: (_x, y) => y, default: () => 'NONE' as KiraaState['bookingStatus'] },
  ragPassages: { value: (_x, y) => y, default: () => [] },
  validation: { value: (_x, y) => y, default: () => ({ isValid: false, errors: [] }) },
  needsHumanReview: { value: (_x: boolean, y: boolean) => y, default: () => false },
  escalationReasons: { value: (_x, y) => y, default: () => [] },
  errors: { value: (_x, y) => y, default: () => [] },
  explanation: { value: (_x: string, y: string) => y, default: () => '' },
  report: { value: (_x, y) => y, default: () => null },
  graphTrace: { value: (_x, y) => y, default: () => [] },
  intentOverride: { value: (_x, y) => y, default: () => null },
};

// ─── Fonctions de routage conditionnel ─────────────────────────────────────

/** Équivalent de `route_intent` du notebook. */
export function routeIntent(
  state: KiraaState,
): 'validator_node' | 'calculator_node' | 'explainer_node' {
  switch (state.intent) {
    case 'policy_query':
      // Question de politique : RAG via le calculator, aucun calcul financier.
      return 'calculator_node';
    case 'out_of_scope':
    case 'human_escalation':
      return 'explainer_node';
    default:
      return 'validator_node';
  }
}

/** Équivalent de `route_after_validator` du notebook. */
export function routeAfterValidator(state: KiraaState): 'calculator_node' | 'explainer_node' {
  // Une demande d'éligibilité seule n'appelle jamais le moteur tarifaire.
  if (state.intent === 'validate_eligibility') return 'explainer_node';
  // Un rejet ou une clarification stoppe la chaîne avant tout calcul.
  if (state.bookingStatus === 'REJECTED' || state.bookingStatus === 'CLARIFICATION_REQUIRED') {
    return 'explainer_node';
  }
  return 'calculator_node';
}

/** Équivalent de `route_after_calculator` du notebook. */
export function routeAfterCalculator(_state: KiraaState): 'explainer_node' {
  return 'explainer_node';
}

// ─── Construction du graphe ────────────────────────────────────────────────

export function buildGraph() {
  const graph = new StateGraph<KiraaState>({ channels })
    .addNode('ingestor_node', ingestorNode)
    .addNode('extractor_node', extractorNode)
    .addNode('intent_node', intentNode)
    .addNode('validator_node', validatorNode)
    .addNode('calculator_node', calculatorNode)
    .addNode('explainer_node', explainerNode)
    .addNode('reporter_node', reporterNode);

  graph.addEdge(START, 'ingestor_node' as never);
  graph.addEdge('ingestor_node' as never, 'extractor_node' as never);
  graph.addEdge('extractor_node' as never, 'intent_node' as never);

  graph.addConditionalEdges('intent_node' as never, routeIntent as never, {
    validator_node: 'validator_node',
    calculator_node: 'calculator_node',
    explainer_node: 'explainer_node',
  } as never);

  graph.addConditionalEdges('validator_node' as never, routeAfterValidator as never, {
    calculator_node: 'calculator_node',
    explainer_node: 'explainer_node',
  } as never);

  graph.addConditionalEdges('calculator_node' as never, routeAfterCalculator as never, {
    explainer_node: 'explainer_node',
  } as never);

  graph.addEdge('explainer_node' as never, 'reporter_node' as never);
  graph.addEdge('reporter_node' as never, END);

  return graph;
}

/**
 * Checkpointer PostgreSQL (persistance de l'état du graphe).
 * Retourne `undefined` si la persistance est indisponible : le graphe reste
 * alors fonctionnel, mais sans reprise sur incident.
 */
export async function createCheckpointer() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const saver = PostgresSaver.fromConnString(url);
    await saver.setup();
    return saver;
  } catch (e) {
    console.warn(`[graph] checkpointer PostgreSQL indisponible : ${(e as Error).message}`);
    return undefined;
  }
}

export interface RunOptions {
  requestId: string;
  rawInput: string;
  params?: Record<string, unknown>;
  /** Réservé aux tests E2E déterministes ; jamais renseigné en production. */
  intentOverride?: KiraaState['intentOverride'];
  withCheckpointer?: boolean;
}

/** Exécute le graphe de bout en bout et retourne l'état final. */
export async function runAgent(options: RunOptions): Promise<KiraaState> {
  const checkpointer = options.withCheckpointer === false ? undefined : await createCheckpointer();

  const compiled = buildGraph().compile(checkpointer ? { checkpointer } : undefined);

  const initial = makeInitialState(
    options.requestId,
    options.rawInput,
    options.params ?? {},
    options.intentOverride ?? null,
  );

  const result = (await compiled.invoke(initial, {
    configurable: { thread_id: options.requestId },
  })) as KiraaState;

  return result;
}
