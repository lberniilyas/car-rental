/**
 * Déclaration pour l'import profond `pdf-parse/lib/pdf-parse.js`.
 *
 * On contourne volontairement l'entrée du paquet (`pdf-parse`) : celle-ci
 * exécute un bloc de debug qui tente de lire un PDF de test absent une fois
 * le paquet installé, ce qui casse au runtime.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
