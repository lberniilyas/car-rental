/**
 * Fournisseur d'embeddings configurable (cahier des charges, "Choix Techniques").
 *
 *   Modele      : Xenova/all-MiniLM-L6-v2 (execution locale, aucune cle API)
 *   Dimension   : 384
 *   Similarite  : cosinus (vecteurs normalises L2, cf. ci-dessous)
 *
 * Les vecteurs sont normalises a la production : la similarite cosinus se
 * calcule alors directement via l'operateur `<=>` de pgvector.
 */

export const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDINGS_DIMENSION = Number(process.env.EMBEDDINGS_DIMENSION ?? 384);
export const SIMILARITY_STRATEGY = 'cosine' as const;

type FeatureExtractionPipeline = (
  text: string | string[],
  options: { pooling: 'mean' | 'none' | 'cls'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Charge le modele une seule fois par processus.
 * Le premier appel telecharge ~90 Mo depuis le hub, puis le modele est mis en
 * cache sur disque et fonctionne hors ligne.
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      // Pas de modeles locaux personnalises : on s'appuie sur le cache du hub.
      env.allowLocalModels = false;
      return (await pipeline('feature-extraction', EMBEDDINGS_MODEL)) as unknown as
        FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

/** Produit le vecteur normalise d'un texte unique. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data as Float32Array);
  if (vector.length !== EMBEDDINGS_DIMENSION) {
    throw new Error(
      `Dimension inattendue : ${vector.length} (attendu ${EMBEDDINGS_DIMENSION}). ` +
        `Verifier EMBEDDINGS_MODEL et EMBEDDINGS_DIMENSION.`,
    );
  }
  return vector;
}

/** Produit les vecteurs d'un lot de textes, en preservant l'ordre. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedText(text));
  }
  return out;
}

/** Litteral pgvector : `[0.1,0.2,...]`. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
