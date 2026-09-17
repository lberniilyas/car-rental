'use client';

/**
 * Interface cliente (EX-07, cahier des charges §3).
 *
 * Le client décrit QUI il est et CE QU'IL VEUT, avec des champs de formulaire
 * ordinaires — aucune saisie technique, aucun JSON, aucun identifiant à taper.
 * Les paramètres attendus par le graphe (`days`, `month`, `vehicleCategory`)
 * sont dérivés des dates et du véhicule choisi, jamais demandés au client.
 *
 * Les éléments de traçabilité exigés par le cahier des charges (moteur
 * d'extraction, score de confiance, similarité RAG, chemin du graphe) restent
 * intégralement affichés, mais repliés sous « Détails techniques » afin de ne
 * pas encombrer la vue client.
 */

import { useEffect, useMemo, useState } from 'react';
import { INSURANCE_OPTIONS } from '@/lib/engine/constants';
import type { IngestedFile, RagPassage } from '@/lib/schemas/state';
import type { FleetOption } from '@/lib/schemas/fleet';

/**
 * Les contrats viennent des schémas Zod partagés, jamais d'une redéclaration
 * locale : une divergence entre l'API et l'interface casse la compilation.
 *
 * Seul écart assumé : la route `/api/chat` tronque `extractedText` à 400
 * caractères et le republie sous `extractedPreview`, ce qui se modélise ici par
 * une substitution de champ sur le contrat d'origine.
 */
type IngestedFileView = Omit<IngestedFile, 'extractedText' | 'structuredContent'> & {
  extractedPreview: string;
};

type RagPassageView = RagPassage;

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

/** Libellés clients des statuts — jamais le code brut à l'écran. */
const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Votre demande est confirmée',
  PENDING_REVIEW: 'Votre demande est transmise à un conseiller',
  REJECTED: 'Votre demande ne peut pas être acceptée',
  CLARIFICATION_REQUIRED: 'Il nous manque des informations',
  // `NONE` couvre aussi bien un simple devis qu'une question de politique :
  // le libellé doit rester neutre et ne pas se lire comme un refus.
  NONE: 'Voici notre réponse — aucune réservation n’est engagée',
};

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  PENDING_REVIEW: 'bg-amber-100 text-amber-900 border-amber-300',
  REJECTED: 'bg-rose-100 text-rose-900 border-rose-300',
  CLARIFICATION_REQUIRED: 'bg-sky-100 text-sky-900 border-sky-300',
  NONE: 'bg-slate-100 text-slate-700 border-slate-300',
};

/** Statut d'un document, en langage client. */
const FILE_STATUS_LABELS: Record<string, string> = {
  PASS: 'Lu et accepté',
  FAIL: 'Illisible',
  CLARIFICATION_REQUIRED: 'À renvoyer',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm focus:border-slate-900 focus:outline-none';

const MAD = (v: unknown) =>
  typeof v === 'number'
    ? `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`
    : '—';

/** Ligne de devis. `strong` réserve le gras au total. */
function Line({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1.5 ${
        strong ? 'border-t border-slate-300 pt-2.5' : ''
      }`}
    >
      <span className={strong ? 'text-sm font-semibold' : 'text-sm text-slate-600'}>
        {label}
        {note && <span className="ml-2 text-xs text-amber-700">{note}</span>}
      </span>
      <span className={strong ? 'text-lg font-bold' : 'text-sm font-medium'}>{value}</span>
    </div>
  );
}

/** Nombre de jours calendaires entre deux dates ISO, ou null si incomplet. */
function daysBetweenIso(start: string, end: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const days = Math.round((b - a) / 86_400_000);
  return days > 0 ? days : null;
}

export default function ChatUI() {
  // ─── Identité du conducteur ───────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [licenseIssueDate, setLicenseIssueDate] = useState('');
  const [licenseExpDate, setLicenseExpDate] = useState('');

  // ─── Besoin de location ───────────────────────────────────────────────────
  const [vehicleId, setVehicleId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [insuranceOption, setInsuranceOption] = useState('basic');
  const [discountCode, setDiscountCode] = useState('');
  const [kmDriven, setKmDriven] = useState('');

  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);

  const [fleet, setFleet] = useState<FleetOption[]>([]);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<AgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { vehicles: FleetOption[] }) => setFleet(d.vehicles))
      .catch(() => setFleetError('Catalogue des véhicules momentanément indisponible.'));
  }, []);

  /** Véhicules groupés par catégorie pour le sélecteur. */
  const fleetByCategory = useMemo(() => {
    const groups = new Map<string, FleetOption[]>();
    for (const v of fleet) {
      const list = groups.get(v.category) ?? [];
      list.push(v);
      groups.set(v.category, list);
    }
    return [...groups.entries()];
  }, [fleet]);

  const selectedVehicle = useMemo(
    () => fleet.find((v) => v.vehicleId === vehicleId) ?? null,
    [fleet, vehicleId],
  );

  const days = daysBetweenIso(startDate, endDate);
  const datesInvalid = Boolean(startDate && endDate && days === null);

  /**
   * Assemble les paramètres attendus par le graphe.
   * `days`, `month` et `vehicleCategory` sont DÉRIVÉS : le client ne les saisit
   * jamais. Les champs vides sont omis plutôt qu'envoyés vides, afin que le
   * contrôle Zero-Trust du validateur demande une clarification au lieu de
   * travailler sur une chaîne vide.
   */
  function buildParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (firstName.trim()) params.firstName = firstName.trim();
    if (lastName.trim()) params.lastName = lastName.trim();
    if (birthDate) params.birthDate = birthDate;
    if (licenseIssueDate) params.licenseIssueDate = licenseIssueDate;
    if (licenseExpDate) params.licenseExpDate = licenseExpDate;

    if (vehicleId) params.vehicleId = vehicleId;
    if (selectedVehicle) params.vehicleCategory = selectedVehicle.category;

    if (startDate) {
      params.startDate = startDate;
      // Le coefficient saisonnier dépend du mois de prise en charge.
      params.month = Number(startDate.slice(5, 7));
      // L'éligibilité s'apprécie au JOUR DE LA PRISE EN CHARGE : c'est la date
      // à laquelle le conducteur prend le volant. Sans cela, un permis expirant
      // entre aujourd'hui et le départ serait accepté à tort (cahier §4 :
      // « Permis expiré -> blocage immédiat »).
      params.referenceDate = startDate;
    }
    if (endDate) params.endDate = endDate;
    if (days !== null) params.days = days;

    if (insuranceOption) params.insuranceOption = insuranceOption;
    if (discountCode.trim()) params.discountCode = discountCode.trim().toUpperCase();
    if (kmDriven.trim()) params.kmDriven = Number(kmDriven);

    return params;
  }

  function buildFormData(format?: 'pdf') {
    const fd = new FormData();
    fd.append('message', message.trim());
    fd.append('params', JSON.stringify(buildParams()));
    if (format) fd.append('format', format);
    if (files) Array.from(files).forEach((f) => fd.append('files', f));
    return fd;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (datesInvalid) {
      setError('La date de restitution doit être postérieure à la date de prise en charge.');
      return;
    }
    if (!message.trim() && !files?.length && !vehicleId) {
      setError('Décrivez votre besoin, choisissez un véhicule ou joignez un document.');
      return;
    }
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
  const mileage = price?.mileage as Record<string, unknown> | undefined;
  const availability = result?.availability as Record<string, unknown> | null;

  // Le sous-total du moteur inclut déjà l'assurance : on isole la part location
  // pour que les lignes affichées s'additionnent réellement jusqu'au total.
  const rentalOnly =
    typeof price?.subtotal === 'number' && typeof price?.insuranceCost === 'number'
      ? price.subtotal - price.insuranceCost
      : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Kiraa — Location de véhicules</h1>
        <p className="mt-1 text-sm text-slate-600">
          Renseignez vos informations et votre besoin. Nous vérifions votre éligibilité et
          établissons votre devis.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        {/* ─── Le conducteur ─────────────────────────────────────────────── */}
        <Section title="Vos informations">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom">
              <input
                className={INPUT}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </Field>
            <Field label="Nom">
              <input
                className={INPUT}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </Field>
            <Field label="Date de naissance">
              <input
                type="date"
                className={INPUT}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Field>
            <div className="hidden sm:block" />
            <Field label="Permis délivré le">
              <input
                type="date"
                className={INPUT}
                value={licenseIssueDate}
                onChange={(e) => setLicenseIssueDate(e.target.value)}
              />
            </Field>
            <Field label="Permis valable jusqu’au">
              <input
                type="date"
                className={INPUT}
                value={licenseExpDate}
                onChange={(e) => setLicenseExpDate(e.target.value)}
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Si vous joignez votre permis ou votre pièce d’identité ci-dessous, les informations du
            document font foi et ces champs servent de vérification.
          </p>
        </Section>

        {/* ─── Le besoin ─────────────────────────────────────────────────── */}
        <Section title="Votre location">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Véhicule souhaité"
                hint={
                  selectedVehicle
                    ? `${selectedVehicle.category} · ${selectedVehicle.transmission} · ${selectedVehicle.location} · ${selectedVehicle.baseDailyRate.toLocaleString('fr-FR')} MAD/jour`
                    : undefined
                }
              >
                <select
                  className={INPUT}
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">— Choisir un véhicule —</option>
                  {fleetByCategory.map(([category, vehicles]) => (
                    <optgroup key={category} label={category}>
                      {vehicles.map((v) => (
                        <option key={v.vehicleId} value={v.vehicleId}>
                          {v.label} — {v.baseDailyRate.toLocaleString('fr-FR')} MAD/jour —{' '}
                          {v.location}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {fleetError && <p className="mt-1 text-xs text-rose-700">{fleetError}</p>}
            </div>

            <Field label="Prise en charge">
              <input
                type="date"
                className={INPUT}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field
              label="Restitution"
              hint={
                days !== null
                  ? `Durée : ${days} jour${days > 1 ? 's' : ''}`
                  : datesInvalid
                    ? 'La restitution doit suivre la prise en charge.'
                    : undefined
              }
            >
              <input
                type="date"
                className={INPUT}
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>

            <Field label="Assurance">
              <select
                className={INPUT}
                value={insuranceOption}
                onChange={(e) => setInsuranceOption(e.target.value)}
              >
                {Object.entries(INSURANCE_OPTIONS).map(([key, opt]) => (
                  <option key={key} value={key}>
                    {opt.label}
                    {opt.dailyRate > 0 ? ` — ${opt.dailyRate} MAD/jour` : ''}
                    {opt.flatFee > 0 ? ` — ${opt.flatFee} MAD` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Code promotionnel" hint="Facultatif">
              <input
                className={`${INPUT} uppercase`}
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="Ex. : LOYAL10"
              />
            </Field>

            <Field
              label="Kilométrage prévu"
              hint={
                days !== null
                  ? `Facultatif. ${(days * 300).toLocaleString('fr-FR')} km inclus pour ${days} jour${days > 1 ? 's' : ''}.`
                  : 'Facultatif. 300 km inclus par jour.'
              }
            >
              <input
                type="number"
                min={0}
                className={INPUT}
                value={kmDriven}
                onChange={(e) => setKmDriven(e.target.value)}
                placeholder="Ex. : 1800"
              />
            </Field>
          </div>
        </Section>

        {/* ─── Message et pièces jointes ─────────────────────────────────── */}
        <Section title="Votre demande">
          <Field label="Votre message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className={INPUT}
              placeholder="Ex. : puis-je annuler 24 h avant la prise en charge ?"
            />
          </Field>

          <div className="mt-4">
            <Field
              label="Vos documents"
              hint="Permis de conduire, pièce d’identité — JPG, PNG, PDF, JSON ou TXT."
            >
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.pdf,.json,.txt"
                onChange={(e) => setFiles(e.target.files)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white"
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? 'Analyse en cours…' : 'Obtenir mon devis'}
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
        </Section>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* ─── Décision ───────────────────────────────────────────────── */}
          <Section title="Réponse">
            <div
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                STATUS_STYLES[result.bookingStatus] ?? STATUS_STYLES.NONE
              }`}
            >
              {STATUS_LABELS[result.bookingStatus] ?? result.bookingStatus}
            </div>

            {result.explanation && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {result.explanation}
              </p>
            )}

            {result.validation.errors.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-sm text-rose-800">
                {result.validation.errors.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}

            {result.needsHumanReview && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Un conseiller doit valider votre dossier.</p>
                {result.escalationReasons.length > 0 && (
                  <ul className="mt-1 list-inside list-disc">
                    {result.escalationReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>

          {/* ─── Disponibilite, issue de PostgreSQL ─────────────────────── */}
          {availability && (
            <Section title="Disponibilité du véhicule">
              <div
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  availability.available
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-rose-300 bg-rose-50 text-rose-900'
                }`}
              >
                {availability.available
                  ? 'Ce véhicule est disponible sur la période demandée.'
                  : 'Ce véhicule n’est pas disponible sur la période demandée.'}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Du</dt>
                  <dd className="font-medium">{String(availability.requestedStart ?? '—')}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Au</dt>
                  <dd className="font-medium">{String(availability.requestedEnd ?? '—')}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Réservations en conflit</dt>
                  <dd className="font-medium">{String(availability.conflictingBookings ?? 0)}</dd>
                </div>
              </dl>
              {Array.isArray(availability.substitutes) && availability.substitutes.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="text-slate-500">Véhicules équivalents proposés</p>
                  <ul className="mt-1 list-inside list-disc">
                    {(availability.substitutes as unknown[]).map((sub, i) => (
                      <li key={i}>
                        {typeof sub === 'string' ? sub : JSON.stringify(sub)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* ─── Éligibilité ────────────────────────────────────────────── */}
          {eligibility && (
            <Section title="Votre éligibilité">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Dossier recevable</dt>
                  <dd className="font-medium">{eligibility.eligible ? 'Oui' : 'Non'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Âge</dt>
                  <dd className="font-medium">{String(eligibility.age ?? '—')} ans</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Ancienneté du permis</dt>
                  <dd className="font-medium">
                    {String(eligibility.licenseSeniorityYears ?? '—')} ans
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Profil</dt>
                  <dd className="font-medium">
                    {eligibility.riskCategory === 'jeune_conducteur'
                      ? 'Jeune conducteur'
                      : 'Conducteur confirmé'}
                  </dd>
                </div>
              </dl>
            </Section>
          )}

          {/* ─── Devis ──────────────────────────────────────────────────── */}
          {price && (
            <Section title="Votre devis">
              <div className="divide-y divide-slate-100">
                <Line
                  label={`Location${
                    typeof price.days === 'number' ? ` — ${price.days} jour${Number(price.days) > 1 ? 's' : ''}` : ''
                  }`}
                  value={MAD(rentalOnly)}
                  note={
                    typeof price.seasonalMultiplier === 'number' && price.seasonalMultiplier !== 1
                      ? `tarif saisonnier ×${price.seasonalMultiplier}`
                      : undefined
                  }
                />
                <Line label="Assurance" value={MAD(price.insuranceCost)} />
                <Line label="Sous-total" value={MAD(price.subtotal)} />
                <Line label="Caution (restituée en fin de location)" value={MAD(price.deposit)} />
                {typeof price.discountAmount === 'number' && price.discountAmount > 0 && (
                  <Line
                    label="Remise"
                    value={`− ${MAD(price.discountAmount)}`}
                    note={price.discountCapped ? 'plafonnée à 15 %' : undefined}
                  />
                )}
                <Line label="Total à régler" value={MAD(price.totalPrice)} strong />
              </div>

              {typeof price.depositNote === 'string' && (
                <p className="mt-2 text-xs text-slate-600">{price.depositNote}</p>
              )}

              {/* Pénalité kilométrique — calculée séparément, NON incluse au total. */}
              {mileage && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Kilométrage
                  </h4>
                  <div className="mt-1 divide-y divide-slate-200">
                    <Line
                      label="Kilométrage prévu"
                      value={`${Number(mileage.kmDriven).toLocaleString('fr-FR')} km`}
                    />
                    <Line
                      label="Inclus dans le forfait"
                      value={`${Number(mileage.kmAllowed).toLocaleString('fr-FR')} km`}
                    />
                    <Line
                      label="Dépassement"
                      value={`${Number(mileage.kmOverage).toLocaleString('fr-FR')} km`}
                    />
                    <Line
                      label={`Pénalité (${mileage.extraKmRate} MAD/km)`}
                      value={MAD(mileage.penalty)}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    {Number(mileage.kmOverage) > 0
                      ? 'Cette pénalité est facturée en fin de location selon le kilométrage réel. Elle n’est pas comprise dans le total ci-dessus.'
                      : 'Votre kilométrage prévu reste dans le forfait inclus : aucune pénalité.'}
                  </p>
                </div>
              )}
            </Section>
          )}

          {/* ─── Documents, vue client ──────────────────────────────────── */}
          {result.ingestedFiles.length > 0 && (
            <Section title="Vos documents">
              <ul className="space-y-1.5 text-sm">
                {result.ingestedFiles.map((f) => (
                  <li key={f.filename} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.filename}</span>
                    <span
                      className={
                        f.validationStatus === 'PASS' ? 'text-emerald-700' : 'text-amber-800'
                      }
                    >
                      {FILE_STATUS_LABELS[f.validationStatus] ?? f.validationStatus}
                    </span>
                    {f.humanReviewStatus === 'REQUIRED' && (
                      <span className="text-xs text-amber-700">· vérification par un conseiller</span>
                    )}
                    {f.errors.length > 0 && (
                      <span className="text-xs text-rose-700">· {f.errors.join(' ; ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* ─── Conditions citées ──────────────────────────────────────── */}
          {result.ragPassages.length > 0 && (
            <Section title="Nos conditions de location">
              <ul className="space-y-3">
                {result.ragPassages.map((p, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                    {p.sourceSection && (
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {p.sourceSection}
                      </p>
                    )}
                    <p className="text-slate-700">{p.content}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* ─── Traçabilité, repliée ───────────────────────────────────── */}
          <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600">
              Détails techniques
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-4 py-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Requête</p>
                <p className="font-mono text-xs text-slate-700">{result.requestId}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Intention détectée
                </p>
                <p className="text-slate-700">
                  {result.intent} — confiance {(result.intentConfidence * 100).toFixed(0)} %
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Chemin parcouru dans le graphe
                </p>
                <p className="font-mono text-xs text-slate-700">{result.graphTrace.join(' → ')}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Validation déterministe
                </p>
                <p className="text-slate-700">
                  {result.validation.isValid ? 'OK' : 'échec'} ·{' '}
                  {result.needsHumanReview ? 'revue humaine requise' : 'aucune revue humaine'}
                </p>
              </div>

              {result.ingestedFiles.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                    Ingestion des documents
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="uppercase text-slate-500">
                        <tr>
                          <th className="py-1 pr-3">Fichier</th>
                          <th className="py-1 pr-3">Type</th>
                          <th className="py-1 pr-3">Taille</th>
                          <th className="py-1 pr-3">Statut</th>
                          <th className="py-1 pr-3">Moteur</th>
                          <th className="py-1 pr-3">Confiance</th>
                          <th className="py-1 pr-3">Revue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.ingestedFiles.map((f) => (
                          <tr key={f.filename} className="border-t border-slate-100 align-top">
                            <td className="py-1.5 pr-3 font-medium">{f.filename}</td>
                            <td className="py-1.5 pr-3">{f.fileType}</td>
                            <td className="py-1.5 pr-3">{(f.sizeBytes / 1024).toFixed(0)} Ko</td>
                            <td className="py-1.5 pr-3">{f.validationStatus}</td>
                            <td className="py-1.5 pr-3">{f.processingEngine}</td>
                            <td className="py-1.5 pr-3">{f.confidence.toFixed(2)}</td>
                            <td className="py-1.5 pr-3">{f.humanReviewStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {result.ingestedFiles.map((f) =>
                    f.extractedPreview ? (
                      <details key={f.filename} className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-500">
                          Texte extrait — {f.filename}
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                          {f.extractedPreview}
                        </pre>
                      </details>
                    ) : null,
                  )}
                </div>
              )}

              {result.ragPassages.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                    Passages RAG et similarité cosinus
                  </p>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {result.ragPassages.map((p, i) => (
                      <li key={i}>
                        <span className="font-mono">{p.similarity.toFixed(3)}</span> —{' '}
                        {p.sourceSection ?? 'Politique'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.errors.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Erreurs</p>
                  <ul className="list-inside list-disc text-xs text-rose-700">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </div>
      )}
    </main>
  );
}
