'use client';

/**
 * Interface cliente (EX-07, cahier des charges §3).
 *
 * Permet de saisir un message, de téléverser une pièce d'identité ou un permis
 * (image ou PDF) ainsi que des fichiers PDF / JSON / TXT, de déclencher
 * l'analyse, puis de consulter :
 *   - les résultats déterministes (éligibilité, tarif),
 *   - le score de confiance d'extraction par fichier,
 *   - les sources RAG citées,
 *   - le statut de revue humaine,
 *   - et de télécharger le rapport final en PDF.
 */

import { useState } from 'react';

interface IngestedFileView {
  filename: string;
  fileType: string;
  sizeBytes: number;
  validationStatus: string;
  processingEngine: string;
  confidence: number;
  errors: string[];
  humanReviewStatus: string;
  extractedPreview: string;
}

interface RagPassageView {
  content: string;
  similarity: number;
  sourceSection: string | null;
}

interface AgentResponse {
  requestId: string;
  intent: string;
  intentConfidence: number;
  bookingStatus: string;
  eligibility: Record<string, unknown> | null;
  price: Record<string, unknown> | null;
  availability: Record<string, unknown> | null;
  ragPassages: RagPassageView[];
  validation: { isValid: boolean; errors: string[] };
  needsHumanReview: boolean;
  escalationReasons: string[];
  explanation: string;
  ingestedFiles: IngestedFileView[];
  graphTrace: string[];
  errors: string[];
  error?: string;
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  PENDING_REVIEW: 'bg-amber-100 text-amber-900 border-amber-300',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-300',
  CLARIFICATION_REQUIRED: 'bg-sky-100 text-sky-900 border-sky-300',
  NONE: 'bg-slate-100 text-slate-700 border-slate-300',
};

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

const MAD = (v: unknown) =>
  typeof v === 'number'
    ? `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`
    : '—';

export default function ChatUI() {
  const [message, setMessage] = useState(
    'Je souhaite louer un véhicule. Analysez mes documents et vérifiez mon éligibilité.',
  );
  const [params, setParams] = useState(
    '{\n  "vehicleId": "VH-0001",\n  "days": 5,\n  "month": 7,\n  "insuranceOption": "basic",\n  "discountCode": ""\n}',
  );
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildFormData(format?: 'pdf') {
    const fd = new FormData();
    fd.append('message', message);
    fd.append('params', params);
    if (format) fd.append('format', format);
    if (files) Array.from(files).forEach((f) => fd.append('files', f));
    return fd;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/chat', { method: 'POST', body: buildFormData() });
      const data = (await res.json()) as AgentResponse;
      if (!res.ok) {
        setError(data.error ?? `Erreur HTTP ${res.status}`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch('/api/chat', { method: 'POST', body: buildFormData('pdf') });
      if (!res.ok) {
        setError(`Génération du PDF impossible (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kiraa-devis-${result?.requestId ?? 'rapport'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const price = result?.price as Record<string, unknown> | null;
  const eligibility = result?.eligibility as Record<string, unknown> | null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Kiraa — Agent de location de véhicules</h1>
        <p className="mt-1 text-sm text-slate-600">
          Les montants et décisions proviennent d&apos;un moteur déterministe TypeScript. Le modèle
          de langage se limite à l&apos;extraction, au routage et à l&apos;explication.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label htmlFor="message" className="mb-1 block text-sm font-medium">
            Votre demande
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 p-2 text-sm"
            placeholder="Ex. : puis-je annuler 24 h avant la prise en charge ?"
          />

          <label htmlFor="files" className="mt-4 mb-1 block text-sm font-medium">
            Documents (JPG, PNG, PDF, JSON, TXT)
          </label>
          <input
            id="files"
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf,.json,.txt"
            onChange={(e) => setFiles(e.target.files)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white"
          />

          <label htmlFor="params" className="mt-4 mb-1 block text-sm font-medium">
            Paramètres de réservation (JSON)
          </label>
          <textarea
            id="params"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Analyse en cours…' : 'Lancer l’analyse'}
            </button>
            {result && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {downloading ? 'Génération…' : 'Télécharger le devis PDF'}
              </button>
            )}
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <Section title="Décision">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={STATUS_STYLES[result.bookingStatus] ?? STATUS_STYLES.NONE}>
                {result.bookingStatus}
              </Badge>
              <Badge className="border-slate-300 bg-slate-100 text-slate-700">
                intention : {result.intent} ({(result.intentConfidence * 100).toFixed(0)} %)
              </Badge>
              <Badge
                className={
                  result.needsHumanReview
                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                    : 'border-emerald-300 bg-emerald-100 text-emerald-800'
                }
              >
                {result.needsHumanReview ? 'Revue humaine requise' : 'Aucune revue humaine'}
              </Badge>
              <Badge
                className={
                  result.validation.isValid
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                    : 'border-rose-300 bg-rose-100 text-rose-800'
                }
              >
                validation : {result.validation.isValid ? 'OK' : 'échec'}
              </Badge>
            </div>

            {result.escalationReasons.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-sm text-amber-900">
                {result.escalationReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}

            {result.validation.errors.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-sm text-rose-800">
                {result.validation.errors.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </Section>

          {result.explanation && (
            <Section title="Explication">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.explanation}</p>
            </Section>
          )}

          {eligibility && (
            <Section title="Éligibilité (calcul déterministe)">
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Éligible</dt>
                  <dd className="font-medium">{eligibility.eligible ? 'Oui' : 'Non'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Âge</dt>
                  <dd className="font-medium">{String(eligibility.age ?? '—')} ans</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Ancienneté permis</dt>
                  <dd className="font-medium">
                    {String(eligibility.licenseSeniorityYears ?? '—')} ans
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Catégorie de risque</dt>
                  <dd className="font-medium">{String(eligibility.riskCategory ?? '—')}</dd>
                </div>
              </dl>
            </Section>
          )}

          {price && (
            <Section title="Tarification (calcul déterministe)">
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Sous-total</dt>
                  <dd className="font-medium">{MAD(price.subtotal)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Assurance</dt>
                  <dd className="font-medium">{MAD(price.insuranceCost)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Caution</dt>
                  <dd className="font-medium">{MAD(price.deposit)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Remise</dt>
                  <dd className="font-medium">
                    {MAD(price.discountAmount)}
                    {price.discountCapped ? (
                      <span className="ml-2 text-xs text-amber-700">plafonnée à 15 %</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Coefficient saisonnier</dt>
                  <dd className="font-medium">×{String(price.seasonalMultiplier ?? '—')}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Total</dt>
                  <dd className="text-base font-bold">{MAD(price.totalPrice)}</dd>
                </div>
              </dl>
              {typeof price.depositNote === 'string' && (
                <p className="mt-2 text-xs text-slate-600">{price.depositNote}</p>
              )}
            </Section>
          )}

          {result.ingestedFiles.length > 0 && (
            <Section title="Documents analysés">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-1 pr-3">Fichier</th>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1 pr-3">Statut</th>
                      <th className="py-1 pr-3">Moteur</th>
                      <th className="py-1 pr-3">Confiance</th>
                      <th className="py-1 pr-3">Revue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ingestedFiles.map((f) => (
                      <tr key={f.filename} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 font-medium">{f.filename}</td>
                        <td className="py-1.5 pr-3">{f.fileType}</td>
                        <td className="py-1.5 pr-3">{f.validationStatus}</td>
                        <td className="py-1.5 pr-3">{f.processingEngine}</td>
                        <td className="py-1.5 pr-3">{f.confidence.toFixed(2)}</td>
                        <td className="py-1.5 pr-3">{f.humanReviewStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {result.ragPassages.length > 0 && (
            <Section title="Sources de politique commerciale (RAG)">
              <ul className="space-y-3">
                {result.ragPassages.map((p, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge className="border-slate-300 bg-white text-slate-700">
                        {p.sourceSection ?? 'Politique'}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        similarité {p.similarity.toFixed(3)}
                      </span>
                    </div>
                    <p className="text-slate-700">{p.content}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Traçabilité">
            <p className="font-mono text-xs text-slate-600">{result.graphTrace.join(' → ')}</p>
            {result.errors.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-rose-700">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}
