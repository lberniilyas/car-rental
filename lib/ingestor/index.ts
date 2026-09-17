/**
 * EX-01 — Ingestion et normalisation multi-format (cahier des charges §8).
 *
 * Contrat d'ingestion :
 *   - formats acceptés : JPG, JPEG, PNG, PDF, TXT, JSON ;
 *   - PDF : extraction native d'abord, bascule OCR si le texte est insuffisant ;
 *   - JSON : chargé et validé par Zod ;
 *   - pour chaque fichier on expose nom, type, statut, moteur utilisé, contenu,
 *     score de confiance, erreurs et statut de revue humaine.
 *
 * Zero-Trust : un document illisible, corrompu, hors sujet ou incomplet est
 * rejeté ou placé en `CLARIFICATION_REQUIRED`. Aucun champ absent n'est inventé.
 */

import path from 'node:path';
import { OCR_CONFIDENCE_THRESHOLD } from '@/lib/engine/constants';
import type { IngestedFile } from '@/lib/schemas/state';
import { uploadedJsonSchema } from '@/lib/schemas/extraction';
import { rasterizePdf } from './rasterize';

/**
 * En deçà de ce nombre de caractères exploitables, le texte natif d'un PDF est
 * jugé insuffisant et le document est traité comme une image (bascule OCR).
 */
export const MIN_NATIVE_PDF_CHARS = 100;

const EXTENSION_TO_TYPE: Record<string, IngestedFile['fileType']> = {
  '.jpg': 'JPG',
  '.jpeg': 'JPEG',
  '.png': 'PNG',
  '.pdf': 'PDF',
  '.json': 'JSON',
  '.txt': 'TXT',
};

export function detectFileType(filename: string): IngestedFile['fileType'] {
  return EXTENSION_TO_TYPE[path.extname(filename).toLowerCase()] ?? 'UNKNOWN';
}

/** Proportion de caractères imprimables — proxy de lisibilité d'un texte. */
function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  const printable = text.replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu, '').length;
  return printable / text.length;
}

function baseResult(filename: string, sizeBytes: number): IngestedFile {
  return {
    filename,
    fileType: detectFileType(filename),
    sizeBytes,
    validationStatus: 'FAIL',
    processingEngine: 'not_used',
    extractedText: '',
    structuredContent: null,
    confidence: 0,
    errors: [],
    humanReviewStatus: 'PASS',
  };
}

// ─── PDF ───────────────────────────────────────────────────────────────────

async function extractPdfNative(buffer: Buffer): Promise<string> {
  // Import direct de l'implementation : l'entree `pdf-parse` execute un mode
  // debug qui lit un fichier de test absent en production.
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;

  // pdf.js peut echouer ("bad XRef entry") sur les tout premiers appels d'un
  // processus, avec des PDF dont la table XRef est malformee : la reprise par
  // reindexation complete des objets n'aboutit qu'une fois le module chaud.
  // On retente donc quelques fois, en laissant la boucle d'evenements tourner
  // entre deux essais.
  const MAX_ATTEMPTS = 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const parsed = await pdfParse(Buffer.from(buffer));
      return parsed.text ?? '';
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Message de repli lorsque la chaine « rasterisation -> OCR » echoue elle-meme
 * (PDF corrompu, chiffre, ou sans page rendable). Zero-Trust : on demande un
 * nouveau document plutot que de renvoyer un contenu partiel ou invente.
 */
const PDF_OCR_UNAVAILABLE =
  'PDF illisible : ni texte natif exploitable, ni conversion en image possible. ' +
  "Merci de fournir un document lisible, une capture d'ecran ou une photo.";

// ─── OCR ───────────────────────────────────────────────────────────────────

/**
 * OCR via tesseract.js. Retourne le texte et la confiance normalisée [0,1].
 * Le chargement est différé : tesseract.js est lourd et inutile pour les
 * formats texte.
 */
export async function runOcr(
  buffer: Buffer,
  languages = 'eng+fra',
): Promise<{ text: string; confidence: number }> {
  const { createWorker } = await import('tesseract.js');

  // En conteneur, /app appartient a root : le cachePath par defaut de
  // tesseract.js ('./') n'y est pas inscriptible et le telechargement des
  // `.traineddata` echoue. TESSDATA_CACHE_PATH pointe vers un repertoire
  // dedie. Hors conteneur la variable est absente : comportement inchange.
  const cachePath = process.env.TESSDATA_CACHE_PATH;
  const worker = await createWorker(languages, undefined, cachePath ? { cachePath } : undefined);
  try {
    const { data } = await worker.recognize(buffer);
    return {
      text: data.text ?? '',
      confidence: typeof data.confidence === 'number' ? data.confidence / 100 : 0,
    };
  } finally {
    await worker.terminate();
  }
}

// ─── Ingestion ─────────────────────────────────────────────────────────────

export interface IngestOptions {
  /** Injection possible d'un OCR alternatif (tests, API Vision). */
  ocr?: (buffer: Buffer) => Promise<{ text: string; confidence: number }>;
  /** Permet de désactiver l'OCR quand seule l'extraction native est voulue. */
  enableOcr?: boolean;
  /**
   * Force la bascule « rasterisation -> OCR » d'un PDF même lorsque son texte
   * natif suffirait. Réservé aux tests : la production privilégie toujours
   * l'extraction native, moins coûteuse et sans perte.
   */
  forceOcr?: boolean;
}

export async function ingestFile(
  buffer: Buffer,
  filename: string,
  options: IngestOptions = {},
): Promise<IngestedFile> {
  const result = baseResult(filename, buffer.byteLength);
  const ocr = options.ocr ?? runOcr;
  const enableOcr = options.enableOcr !== false;

  if (result.fileType === 'UNKNOWN') {
    result.validationStatus = 'FAIL';
    result.errors.push(
      `Format non pris en charge : « ${path.extname(filename) || 'sans extension'} ». ` +
        `Formats acceptés : JPG, JPEG, PNG, PDF, JSON, TXT.`,
    );
    result.humanReviewStatus = 'REQUIRED';
    return result;
  }

  if (buffer.byteLength === 0) {
    result.validationStatus = 'FAIL';
    result.errors.push('Fichier vide ou corrompu : aucun contenu à analyser.');
    result.humanReviewStatus = 'REQUIRED';
    return result;
  }

  try {
    switch (result.fileType) {
      case 'JSON': {
        const raw = buffer.toString('utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          result.validationStatus = 'FAIL';
          result.errors.push(`JSON invalide : ${(e as Error).message}`);
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        // Cahier des charges §8 : le JSON est chargé ET VALIDÉ PAR ZOD.
        const validated = uploadedJsonSchema.safeParse(parsed);
        if (!validated.success) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push(
            `JSON valide mais ne décrit pas un objet de données exploitable : ${validated.error.issues
              .map((i) => i.message)
              .join(' ; ')}`,
          );
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        result.processingEngine = 'json_parser';
        result.structuredContent = validated.data;
        result.extractedText = raw;
        result.confidence = 1.0;
        result.validationStatus = 'PASS';
        break;
      }

      case 'TXT': {
        const text = buffer.toString('utf-8');
        if (text.trim().length === 0) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push('Fichier texte vide : aucun contenu exploitable.');
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        result.processingEngine = 'plain_text';
        result.extractedText = text;
        result.confidence = 1.0;
        result.validationStatus = 'PASS';
        break;
      }

      case 'PDF': {
        let nativeText = '';
        let nativeError: string | null = null;
        try {
          nativeText = await extractPdfNative(buffer);
        } catch (e) {
          nativeError = (e as Error).message;
        }

        const usable = nativeText.trim();
        if (
          !options.forceOcr &&
          usable.length >= MIN_NATIVE_PDF_CHARS &&
          printableRatio(usable) > 0.8
        ) {
          // Texte natif suffisant : l'OCR n'est pas nécessaire.
          result.processingEngine = 'native_pdf';
          result.extractedText = nativeText;
          result.confidence = 1.0;
          result.validationStatus = 'PASS';
          break;
        }

        if (!enableOcr) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push(
            nativeError
              ? `Extraction native impossible (${nativeError}) et OCR désactivé.`
              : 'Texte natif insuffisant et OCR désactivé.',
          );
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }

        // Bascule OCR (§8) : « le PDF est traité comme une image et envoyé au
        // pipeline OCR ». La rasterisation est OBLIGATOIRE avant l'OCR.
        //
        // On ne transmet JAMAIS un PDF a tesseract.js : son worker leve alors
        // une erreur asynchrone rethrow-ee dans process.nextTick ("Pdf reading
        // is not supported") qui echappe a tout try/catch et termine le
        // processus Node. Rasteriser en amont supprime ce danger a la racine :
        // tesseract ne recoit que des PNG.
        let ocrResult: { text: string; confidence: number };
        try {
          const pages = await rasterizePdf(buffer);
          const rendered = await Promise.all(pages.map((page) => ocr(page)));
          ocrResult = {
            text: rendered.map((r) => r.text).join('\n\n'),
            // Principe du maillon faible, comme pour un lot de fichiers.
            confidence: Math.min(...rendered.map((r) => r.confidence)),
          };
        } catch (e) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push(
            `${PDF_OCR_UNAVAILABLE} (${(e as Error)?.message ?? 'erreur OCR'})`,
          );
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        result.processingEngine = 'ocr';
        result.extractedText = ocrResult.text;
        result.confidence = ocrResult.confidence;
        if (ocrResult.text.trim().length === 0) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push('PDF illisible : ni texte natif ni résultat OCR exploitable.');
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        result.validationStatus = 'PASS';
        break;
      }

      case 'JPG':
      case 'JPEG':
      case 'PNG': {
        const ocrResult = await ocr(buffer);
        result.processingEngine = 'ocr';
        result.extractedText = ocrResult.text;
        result.confidence = ocrResult.confidence;
        if (ocrResult.text.trim().length === 0) {
          result.validationStatus = 'CLARIFICATION_REQUIRED';
          result.errors.push('Image illisible : aucun texte détecté par l’OCR.');
          result.humanReviewStatus = 'REQUIRED';
          return result;
        }
        result.validationStatus = 'PASS';
        break;
      }
    }
  } catch (e) {
    result.validationStatus = 'FAIL';
    result.errors.push(
      `Échec du traitement : ${(e as Error)?.message ?? String(e) ?? 'erreur inconnue'}`,
    );
    result.humanReviewStatus = 'REQUIRED';
    return result;
  }

  // Seuil HITL : une extraction peu fiable part en revue humaine (§4).
  if (result.validationStatus === 'PASS' && result.confidence < OCR_CONFIDENCE_THRESHOLD) {
    result.humanReviewStatus = 'REQUIRED';
    result.errors.push(
      `Confiance d’extraction ${result.confidence.toFixed(2)} < seuil ` +
        `${OCR_CONFIDENCE_THRESHOLD} : revue humaine requise.`,
    );
  }

  return result;
}

/** Ingestion d'un lot de fichiers, en préservant l'ordre d'entrée. */
export async function ingestFiles(
  files: { buffer: Buffer; filename: string }[],
  options: IngestOptions = {},
): Promise<IngestedFile[]> {
  const out: IngestedFile[] = [];
  for (const f of files) {
    out.push(await ingestFile(f.buffer, f.filename, options));
  }
  return out;
}
