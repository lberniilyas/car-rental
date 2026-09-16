/**
 * Couche 7 — Génération de documents (devis / contrat).
 *
 * Le générateur n'utilise QUE des valeurs déjà produites par le moteur
 * déterministe et présentes dans l'état. Il ne recalcule rien, n'arrondit rien
 * et n'appelle aucun LLM : c'est un formateur, pas une source de vérité.
 */

import PDFDocument from 'pdfkit';
import type { KiraaState } from '@/lib/schemas/state';

export interface QuoteDocument {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const MAD = (value: number): string =>
  `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;

/** Rend l'état final sous forme de devis PDF téléchargeable. */
export async function generateQuotePdf(state: KiraaState): Promise<QuoteDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  // ─── En-tête ────────────────────────────────────────────────────────────
  doc.fontSize(20).text('Kiraa — Location de vehicules', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#555').text(`Reference : ${state.requestId}`);
  doc.text(`Emise le : ${new Date().toLocaleString('fr-FR')}`);
  doc.fillColor('#000');
  doc.moveDown();

  // ─── Statut ─────────────────────────────────────────────────────────────
  doc.fontSize(13).text('Statut de la demande');
  doc.fontSize(10);
  doc.text(`Intention detectee : ${state.intent || 'non determinee'}`);
  doc.text(`Statut : ${state.bookingStatus}`);
  doc.text(`Revue humaine : ${state.needsHumanReview ? 'REQUISE' : 'non requise'}`);
  if (state.escalationReasons.length > 0) {
    doc.text(`Motifs d'escalade : ${state.escalationReasons.join(' ; ')}`);
  }
  doc.moveDown();

  // ─── Éligibilité ────────────────────────────────────────────────────────
  const eligibility = state.eligibilityResult as {
    eligible?: boolean;
    age?: number;
    licenseSeniorityYears?: number;
    licenseExpired?: boolean;
    riskCategory?: string;
    rejectionReasons?: string[];
  } | null;

  if (eligibility) {
    doc.fontSize(13).text('Eligibilite du conducteur');
    doc.fontSize(10);
    doc.text(`Eligible : ${eligibility.eligible ? 'OUI' : 'NON'}`);
    doc.text(`Age : ${eligibility.age} ans`);
    doc.text(`Anciennete du permis : ${eligibility.licenseSeniorityYears} ans`);
    doc.text(`Permis expire : ${eligibility.licenseExpired ? 'OUI' : 'non'}`);
    doc.text(`Categorie de risque : ${eligibility.riskCategory}`);
    for (const reason of eligibility.rejectionReasons ?? []) {
      doc.text(`  - ${reason}`);
    }
    doc.moveDown();
  }

  // ─── Détail tarifaire ───────────────────────────────────────────────────
  const price = state.priceResult as {
    make?: string;
    model?: string;
    category?: string;
    baseDailyRate?: number;
    days?: number;
    seasonalMultiplier?: number;
    insuranceOption?: string;
    insuranceCost?: number;
    subtotal?: number;
    deposit?: number;
    depositNote?: string;
    discountCode?: string;
    discountAmount?: number;
    discountCapped?: boolean;
    discountNote?: string;
    totalPrice?: number;
  } | null;

  if (price) {
    doc.fontSize(13).text('Detail tarifaire');
    doc.fontSize(10);
    doc.text(`Vehicule : ${price.make} ${price.model} (${price.category})`);
    doc.text(`Tarif journalier de base : ${MAD(price.baseDailyRate ?? 0)}`);
    doc.text(`Duree : ${price.days} jour(s)`);
    doc.text(`Coefficient saisonnier : x${price.seasonalMultiplier}`);
    doc.text(`Assurance (${price.insuranceOption}) : ${MAD(price.insuranceCost ?? 0)}`);
    doc.text(`Sous-total : ${MAD(price.subtotal ?? 0)}`);
    doc.text(price.depositNote ?? `Caution : ${MAD(price.deposit ?? 0)}`);
    if (price.discountCode) {
      doc.text(price.discountNote ?? `Remise : ${MAD(price.discountAmount ?? 0)}`);
      if (price.discountCapped) {
        doc.fillColor('#b45309').text('Remise plafonnee a 15% (regle metier).').fillColor('#000');
      }
    }
    doc.moveDown(0.3);
    doc.fontSize(13).text(`TOTAL : ${MAD(price.totalPrice ?? 0)}`);
    doc.moveDown();
  }

  // ─── Explication ────────────────────────────────────────────────────────
  if (state.explanation) {
    doc.fontSize(13).text('Explication');
    doc.fontSize(10).text(state.explanation, { align: 'justify' });
    doc.moveDown();
  }

  // ─── Sources RAG ────────────────────────────────────────────────────────
  if (state.ragPassages.length > 0) {
    doc.fontSize(13).text('Sources de politique commerciale');
    doc.fontSize(9).fillColor('#444');
    for (const passage of state.ragPassages) {
      doc.text(
        `[${passage.sourceSection ?? 'Politique'}] (similarite ${passage.similarity.toFixed(3)})`,
      );
      doc.text(passage.content, { indent: 12 });
      doc.moveDown(0.3);
    }
    doc.fillColor('#000');
    doc.moveDown();
  }

  // ─── Documents traités ──────────────────────────────────────────────────
  if (state.ingestedFiles.length > 0) {
    doc.fontSize(13).text('Documents analyses');
    doc.fontSize(9);
    for (const f of state.ingestedFiles) {
      doc.text(
        `${f.filename} — ${f.fileType} — ${f.validationStatus} — moteur ${f.processingEngine} — ` +
          `confiance ${f.confidence.toFixed(2)} — revue ${f.humanReviewStatus}`,
      );
    }
    doc.moveDown();
  }

  doc
    .fontSize(8)
    .fillColor('#777')
    .text(
      'Document genere automatiquement a partir de calculs deterministes. ' +
        'Les montants proviennent du moteur TypeScript, jamais du modele de langage.',
      { align: 'center' },
    );

  doc.end();
  await done;

  return {
    buffer: Buffer.concat(chunks),
    filename: `kiraa-devis-${state.requestId}.pdf`,
    contentType: 'application/pdf',
  };
}
