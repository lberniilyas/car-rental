/**
 * Rasterisation PDF -> images (cahier des charges §8).
 *
 * « Si le texte exploitable est insuffisant, le PDF est traité comme une image
 * et envoyé au pipeline OCR. » Ce module réalise la conversion : chaque page est
 * rendue en PNG par pdf.js sur un canvas natif, puis remise au pipeline OCR.
 *
 * C'est aussi ce qui rend la bascule OCR SÛRE. tesseract.js ne sait pas lire un
 * PDF : il lève alors une erreur asynchrone rethrow-ée dans `process.nextTick`
 * qui échappe à tout `try/catch` et termine le processus Node. En rasterisant en
 * amont, tesseract ne reçoit jamais qu'une image matricielle.
 *
 * AUCUN appel LLM : conversion purement locale.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Nombre maximal de pages rendues puis soumises à l'OCR.
 * Une pièce d'identité ou un permis tient sur une page ; la borne évite qu'un
 * PDF volumineux ne monopolise le processus.
 */
export const MAX_OCR_PAGES = 3;

/** Facteur d'agrandissement au rendu : améliore nettement la précision OCR. */
const RENDER_SCALE = 2;

/**
 * Répertoire des polices standard de pdf.js (Helvetica, Times…).
 *
 * Sans lui, pdf.js ignore silencieusement les caractères des polices non
 * embarquées : l'image produite est visuellement vide et l'OCR ne renvoie rien.
 * Le chemin est surchargeable car la sortie `standalone` de Next.js ne trace pas
 * ces fichiers (ils sont recopiés explicitement par le Dockerfile).
 */
function resolveStandardFontsDir(): string | undefined {
  const candidates = [
    process.env.PDFJS_STANDARD_FONTS,
    path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir.endsWith(path.sep) || dir.endsWith('/') ? dir : `${dir}/`;
    } catch {
      // Chemin inaccessible : on essaie le suivant.
    }
  }
  return undefined;
}

/**
 * Rend les premières pages d'un PDF en PNG.
 * Lève si le document est illisible : l'appelant dégrade alors en
 * CLARIFICATION_REQUIRED, sans jamais inventer de contenu.
 */
export async function rasterizePdf(
  buffer: Buffer,
  maxPages: number = MAX_OCR_PAGES,
): Promise<Buffer[]> {
  // Chargement différé : pdf.js et le canvas natif sont lourds et inutiles
  // tant qu'aucun PDF sans texte natif n'est rencontré.
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ]);

  const standardFontDataUrl = resolveStandardFontsDir();

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Zero-Trust : aucune exécution de code embarqué dans le document.
    isEvalSupported: false,
    standardFontDataUrl,
  }).promise;

  try {
    const pages: Buffer[] = [];
    const count = Math.min(doc.numPages, maxPages);

    for (let i = 1; i <= count; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');

      // Fond blanc : un PDF transparent produirait sinon une image noire,
      // illisible pour l'OCR.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      pages.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }

    if (pages.length === 0) {
      throw new Error('Document PDF sans page exploitable');
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
