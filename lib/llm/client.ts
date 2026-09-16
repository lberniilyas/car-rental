/**
 * Client LLM configurable (API Groq, compatible OpenAI).
 *
 * PERIMETRE STRICT (axiome Zero-Hallucination) : ce module ne sert qu'a
 *   - classer l'intention,
 *   - extraire des champs structures,
 *   - rediger une explication en langage naturel.
 * Il ne calcule aucun montant et ne prend aucune decision reglementaire.
 */

import { z } from 'zod';

export interface LlmConfig {
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  baseUrl: string;
}

export function getLlmConfig(): LlmConfig {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LLM_API_KEY est absente. Copier .env.example vers .env.local et renseigner la cle.',
    );
  }
  return {
    apiKey,
    model: process.env.LLM_MODEL ?? 'qwen/qwen3.8-27b',
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0),
    timeoutMs: Number(process.env.LLM_TIMEOUT_SECONDS ?? 30) * 1000,
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LlmError extends Error {}

/** Appel de completion avec delai maximal et reessais sur erreurs transitoires. */
export async function chat(
  messages: ChatMessage[],
  options: { jsonMode?: boolean; maxTokens?: number; retries?: number } = {},
): Promise<string> {
  const config = getLlmConfig();
  const retries = options.retries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature,
          max_tokens: options.maxTokens ?? 800,
          messages,
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        // 429 / 5xx : transitoire, on reessaie avec un recul exponentiel.
        if (response.status === 429 || response.status >= 500) {
          throw new LlmError(`HTTP ${response.status}`);
        }
        // Le corps peut contenir des details de requete : on ne journalise
        // jamais la cle, seulement le statut et un extrait court.
        throw new Error(`Appel LLM refuse (HTTP ${response.status}) : ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new LlmError('Reponse LLM vide ou malformee.');
      }
      return content;
    } catch (e) {
      lastError = e as Error;
      const retriable = e instanceof LlmError || (e as Error).name === 'AbortError';
      if (!retriable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Echec de l'appel LLM apres ${retries + 1} tentatives : ${lastError?.message}`);
}

/** Extrait le premier objet JSON d'une reponse, tolerant aux blocs Markdown. */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Aucun objet JSON exploitable dans la reponse du LLM.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Appel LLM dont la sortie est OBLIGATOIREMENT validee par un schema Zod.
 * Une sortie non conforme n'est jamais propagee dans l'etat de l'agent.
 */
export async function chatStructured<T>(
  messages: ChatMessage[],
  // `unknown` en type d'entree : accepte les schemas utilisant .catch()/.default()
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: { maxTokens?: number } = {},
): Promise<T> {
  const raw = await chat(messages, { jsonMode: true, maxTokens: options.maxTokens });
  const parsed = extractJsonObject(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Sortie LLM non conforme au schema : ${result.error.message.slice(0, 300)}`);
  }
  return result.data;
}
