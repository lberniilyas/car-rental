/**
 * Route d'exécution de l'agent.
 *
 * Reçoit le message utilisateur, les fichiers téléversés et les paramètres de
 * réservation, puis exécute le graphe LangGraph.js et renvoie l'état final.
 *
 * `intentOverride` est volontairement IGNORÉ ici : le forçage d'intention est
 * réservé aux tests E2E déterministes et ne doit jamais être exposé en
 * production, même si un client l'envoie.
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent/graph';
import { getDb } from '@/db/client';
import { agentRequests } from '@/db/schema';
import { generateQuotePdf } from '@/lib/reporter/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 10) * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.json', '.txt'];

function parseJsonField(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  try {
    const formData = await request.formData();

    const message = String(formData.get('message') ?? '').trim();
    const params = parseJsonField(formData.get('params'));
    const wantsPdf = String(formData.get('format') ?? '') === 'pdf';

    if (!message && formData.getAll('files').length === 0) {
      return NextResponse.json(
        { error: 'Un message ou au moins un fichier est requis.' },
        { status: 400 },
      );
    }

    // ─── Fichiers téléversés : limite de taille et formats acceptés ───────
    const files: { buffer: Buffer; filename: string }[] = [];
    for (const entry of formData.getAll('files')) {
      if (!(entry instanceof File)) continue;
      if (entry.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          {
            error: `Fichier « ${entry.name} » trop volumineux (limite ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo).`,
          },
          { status: 413 },
        );
      }
      const lower = entry.name.toLowerCase();
      if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        return NextResponse.json(
          { error: `Format refusé pour « ${entry.name} ». Acceptés : JPG, PNG, PDF, JSON, TXT.` },
          { status: 415 },
        );
      }
      files.push({
        buffer: Buffer.from(await entry.arrayBuffer()),
        filename: entry.name,
      });
    }

    const state = await runAgent({
      requestId,
      rawInput: message,
      params: { ...params, files },
      // Jamais de forçage d'intention depuis le réseau.
      intentOverride: null,
    });

    // ─── Journalisation de la requête ─────────────────────────────────────
    try {
      // Les buffers de fichiers ne sont pas persistés : seules les métadonnées.
      const persistableParams = { ...params };
      await getDb()
        .insert(agentRequests)
        .values({
          requestId,
          rawInput: message,
          intent: state.intent || 'out_of_scope',
          bookingStatus: state.bookingStatus,
          needsHumanReview: state.needsHumanReview,
          graphTrace: state.graphTrace,
          finalState: { ...state, params: persistableParams },
        });
    } catch (e) {
      console.warn(`[chat] journalisation impossible : ${(e as Error).message}`);
    }

    if (wantsPdf) {
      const pdf = await generateQuotePdf(state);
      return new NextResponse(new Uint8Array(pdf.buffer), {
        status: 200,
        headers: {
          'Content-Type': pdf.contentType,
          'Content-Disposition': `attachment; filename="${pdf.filename}"`,
        },
      });
    }

    return NextResponse.json({
      requestId,
      intent: state.intent,
      intentConfidence: state.intentConfidence,
      bookingStatus: state.bookingStatus,
      eligibility: state.eligibilityResult,
      price: state.priceResult,
      availability: state.availabilityResult,
      ragPassages: state.ragPassages,
      validation: state.validation,
      needsHumanReview: state.needsHumanReview,
      escalationReasons: state.escalationReasons,
      explanation: state.explanation,
      ingestedFiles: state.ingestedFiles.map((f) => ({
        filename: f.filename,
        fileType: f.fileType,
        sizeBytes: f.sizeBytes,
        validationStatus: f.validationStatus,
        processingEngine: f.processingEngine,
        confidence: f.confidence,
        errors: f.errors,
        humanReviewStatus: f.humanReviewStatus,
        extractedPreview: f.extractedText.slice(0, 400),
      })),
      graphTrace: state.graphTrace,
      errors: state.errors,
      report: state.report,
    });
  } catch (e) {
    console.error(`[chat] echec ${requestId} :`, (e as Error).message);
    return NextResponse.json(
      { error: "Echec du traitement de la demande.", requestId },
      { status: 500 },
    );
  }
}
