import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Files,
  Scale,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stepper } from "@/components/Stepper";
import type { Step } from "@/components/Stepper";
import { MultiFileDropZone } from "@/components/MultiFileDropZone";
import { GenerationProgress } from "@/components/GenerationProgress";
import type { ProgressState } from "@/components/GenerationProgress";
import { AktePreview } from "@/components/AktePreview";
import { RecentAktes } from "@/components/RecentAktes";
import { fetchRecentAktes } from "@/lib/recent-aktes";
import type { RecentAkte } from "@/components/RecentAktes";
import { JuridischeAnalyse } from "@/components/JuridischeAnalyse";
import type { JuridischeAnalyseData } from "@/components/JuridischeAnalyse";
import { cn } from "@/lib/utils";
import { dedupeFilesForUpload } from "@/lib/dedupe-upload-files";
import { selectFiles } from "@/lib/file-groups";
import { usePersistedFiles } from "@/hooks/use-persisted-files";
import { jobIdVanAntwoord, wachtOpJob } from "@/lib/job-status";

export type GenerationMode = "akte" | "analyse";

/**
 * Context die de gebruiker aan de analyse meegeeft: om wat voor zaak gaat het.
 * De analyse was standaard op een hypotheekdossier gericht; met deze keuze
 * stuurt de gebruiker de specialisten en de eindanalyse naar de juiste
 * transactie. De waarde gaat als formulierveld mee met de upload en komt in
 * n8n terecht bij registry.zaaksoort_context.
 */
export type Zaaksoort = "hypotheek" | "levering";

/**
 * Vaste volgorde; die bepaalt ook de canonieke sleutel die naar n8n gaat
 * ("hypotheek+levering"), waar registry.zaaksoort_context aan hangt.
 */
const ZAAKSOORT_VOLGORDE: Zaaksoort[] = ["hypotheek", "levering"];

/** Canonieke sleutel: gesorteerd en met '+' aan elkaar. */
function zaaksoortSleutel(gekozen: Zaaksoort[]): string {
  return ZAAKSOORT_VOLGORDE.filter((z) => gekozen.includes(z)).join("+");
}

export function zaaksoortLabel(sleutel: string): string {
  const delen = sleutel.split("+");
  if (delen.length > 1) return "Levering en hypotheek";
  if (sleutel === "levering") return "Levering";
  return "Hypotheek";
}

const ZAAKSOORT_OPTIES: {
  waarde: Zaaksoort;
  label: string;
  omschrijving: string;
}[] = [
  {
    waarde: "hypotheek",
    label: "Hypotheek",
    omschrijving:
      "Vestiging van een recht van hypotheek: passeeropdracht van de bank, hypotheekgever en onderpand.",
  },
  {
    waarde: "levering",
    label: "Levering",
    omschrijving:
      "Eigendomsoverdracht op grond van een koopovereenkomst: verkoper, koper, en wat schoon over moet.",
  },
];

/** Akte en analyse zijn losse n8n-workflows met elk een eigen webhook. */
const DEFAULT_WEBHOOKS: Record<GenerationMode, string> = {
  akte: "http://localhost:5678/webhook/hypotheekakte",
  analyse: "http://localhost:5678/webhook/juridische-analyse",
};

/**
 * Statussen uit het jobbestand, vertaald naar de fase-index in
 * `progressPhases`. Beide workflows draaien als achtergrondjob, met per flow
 * eigen statusnamen die op dezelfde drie fase-labels uitkomen.
 */
const STATUS_FASE: Record<string, number> = {
  // analyse
  "documenten lezen": 0,
  analyseren: 1,
  document: 2,
  // akte
  "documenten omzetten": 0,
  "gegevens extraheren": 1,
  "akte opmaken": 2,
  // beide
  klaar: 2,
};

const MODE_META: Record<
  GenerationMode,
  {
    label: string;
    shortLabel: string;
    description: string;
    badge: string;
    buttonLabel: string;
    title: string;
    subtitle: string;
  }
> = {
  akte: {
    label: "Alleen hypotheekakte",
    shortLabel: "Akte",
    description:
      "Genereer alleen de hypotheekakte-DOCX. Geen juridische analyse.",
    badge: "Hypotheekakte",
    buttonLabel: "Akte genereren",
    title: "Nieuwe hypotheekakte",
    subtitle:
      "Sleep het dossier hier. Scriptor leest, extraheert, en stelt de akte op.",
  },
  analyse: {
    label: "Alleen juridische analyse",
    shortLabel: "Analyse",
    description:
      "Genereer alleen een juridische analyse van de aangeleverde stukken. Geen akte.",
    badge: "Juridische analyse",
    buttonLabel: "Analyse genereren",
    title: "Nieuwe juridische analyse",
    subtitle:
      "Lever 1 of meer stukken aan. Scriptor levert een eerste-lezing met aandachtspunten.",
  },
};

interface GenerationResult {
  mode: GenerationMode;
  downloadUrl?: string;
  previewUrl?: string;
  filename?: string;
  bankDisplayName?: string;
  zaaknummer?: string;
  klantSamenvatting?: string;
  analyse?: JuridischeAnalyseData;
  /** Zaaksoort-sleutel waarop de analyse is gericht (alleen analyse-flow). */
  zaaksoort?: string;
  /** Deterministisch oordeel over de beschikkingsbevoegdheid (alleen akte-flow). */
  bevoegdheid?: BeschikkingsbevoegdheidData;
}

/** Zelfde vorm als de juridische analyse, plus een expliciete status. */
interface BeschikkingsbevoegdheidData extends JuridischeAnalyseData {
  status?: "rond" | "onbekend" | "niet_rond";
}

interface AkteGeneratorProps {
  /** Vaste modus, gekozen op de hub. */
  mode: GenerationMode;
  /** Terug naar de card-keuze. */
  onBack: () => void;
}

export function AkteGenerator({ mode, onBack }: AkteGeneratorProps) {
  /** Alle PDF's van het dossier voor akte / akte+analyse (map-upload).
   * Sessie-scoped bewaard, zodat een refresh de upload niet wist. */
  const [akteDossierFiles, setAkteDossierFiles] = usePersistedFiles("akte");
  const [analyseFiles, setAnalyseFiles] = usePersistedFiles("analyse");
  /** Uitgevinkte submappen per modus: die bestanden blijven in de lijst
   * staan maar gaan niet mee naar n8n/Docling. */
  const [akteExcluded, setAkteExcluded] = useState<Set<string>>(new Set());
  const [analyseExcluded, setAnalyseExcluded] = useState<Set<string>>(
    new Set()
  );
  const [webhookUrls, setWebhookUrls] = useState(DEFAULT_WEBHOOKS);
  /**
   * Alleen van belang voor de analyse-flow; de akte-flow kent maar één
   * zaaksoort. Meerdere tegelijk kan: een A-B-levering met de hypotheekakte er
   * direct achteraan is een gewone passeerdag.
   */
  const [zaaksoorten, setZaaksoorten] = useState<Zaaksoort[]>(["hypotheek"]);

  // Een lege lijst betekent een verse upload: dan mogen eerdere
  // uitvink-keuzes niet blijven plakken aan een volgend dossier.
  const handleAkteFilesChange = useCallback(
    (next: File[]) => {
      setAkteDossierFiles(next);
      if (next.length === 0) setAkteExcluded(new Set());
    },
    [setAkteDossierFiles]
  );
  const handleAnalyseFilesChange = useCallback(
    (next: File[]) => {
      setAnalyseFiles(next);
      if (next.length === 0) setAnalyseExcluded(new Set());
    },
    [setAnalyseFiles]
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [statusState, setStatusState] = useState<ProgressState>("running");
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const phaseTimersRef = useRef<number[]>([]);

  const [recent, setRecent] = useState<RecentAkte[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      setRecent(await fetchRecentAktes());
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : String(err));
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // Fase-timers opruimen bij unmount (voorkomt setState op unmounted component).
  useEffect(() => {
    const timers = phaseTimersRef;
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  const isAnalyseOnly = mode === "analyse";
  const requiresAkteInputs = mode === "akte";

  const activeFiles = isAnalyseOnly ? analyseFiles : akteDossierFiles;
  const activeExcluded = isAnalyseOnly ? analyseExcluded : akteExcluded;
  /** Alleen deze bestanden gaan mee in de upload (uitgevinkte submappen eruit). */
  const selectedFiles = useMemo(
    () => selectFiles(activeFiles, activeExcluded),
    [activeFiles, activeExcluded]
  );

  const inputsReady = selectedFiles.length > 0;
  const filesCount = selectedFiles.length;
  const totalCount = activeFiles.length;

  const modeMeta = MODE_META[mode];

  const steps: Step[] = useMemo(() => {
    const states: Array<"upcoming" | "active" | "done"> = [
      "upcoming",
      "upcoming",
      "upcoming",
    ];
    for (let i = 0; i < 3; i++) {
      if (i + 1 < currentStep) states[i] = "done";
      else if (i + 1 === currentStep) states[i] = "active";
    }
    if (inputsReady && currentStep === 1) states[0] = "done";
    return [
      { label: "Bestanden", state: states[0] },
      { label: "Verwerken", state: states[1] },
      { label: "Gereed", state: states[2] },
    ];
  }, [currentStep, inputsReady]);

  // Fase-labels: de drie echte pijplijn-stappen. De overgang komt bij beide
  // flows uit de job-status van de workflow, dus wat hier staat is wat er
  // werkelijk draait.
  const progressPhases = isAnalyseOnly
    ? ["Documenten omzetten", "Juridische analyse", "Rapport opmaken"]
    : ["Documenten omzetten", "Gegevens extraheren", "Akte opmaken & controleren"];

  function clearPhaseTimers() {
    phaseTimersRef.current.forEach((t) => window.clearTimeout(t));
    phaseTimersRef.current = [];
  }

  /** Aan- of uitvinken; de laatste zaaksoort kan niet uit — dan zou er niets te analyseren zijn. */
  function toggleZaaksoort(waarde: Zaaksoort) {
    setZaaksoorten((huidig) => {
      if (huidig.includes(waarde)) {
        return huidig.length === 1 ? huidig : huidig.filter((z) => z !== waarde);
      }
      return ZAAKSOORT_VOLGORDE.filter((z) => z === waarde || huidig.includes(z));
    });
  }

  function resetForm() {
    handleAkteFilesChange([]);
    handleAnalyseFilesChange([]);
    clearPhaseTimers();
    setShowStatus(false);
    setResult(null);
    setErrorMessage(null);
    setPhaseIndex(0);
    setCurrentStep(1);
  }

  async function startGeneration() {
    if (!inputsReady) return;
    const trimmedUrl = webhookUrls[mode].trim();
    if (!trimmedUrl) {
      alert("Vul de webhook URL in.");
      return;
    }

    setIsGenerating(true);
    setShowStatus(true);
    setResult(null);
    setErrorMessage(null);
    setPhaseIndex(0);
    setStatusState("running");
    setCurrentStep(2);

    const sourceFiles = selectedFiles;
    const uploadFiles = dedupeFilesForUpload(sourceFiles);
    if (uploadFiles.length === 0) {
      setErrorMessage("Geen bruikbare bestanden na filteren.");
      setStatusState("error");
      setIsGenerating(false);
      setCurrentStep(1);
      return;
    }

    const formData = new FormData();

    if (isAnalyseOnly) {
      uploadFiles.forEach((file, idx) => {
        formData.append(`document_${idx}`, file, file.name);
      });
      // Context voor de analyse; de workflow valt zonder dit veld terug op
      // 'hypotheek', het gedrag van vóór deze keuze.
      formData.append("zaaksoort", zaaksoorten.join(","));
    } else {
      uploadFiles.forEach((file, idx) => {
        formData.append(`dossier_${idx}`, file, file.name);
      });
    }

    try {
      const responsePromise = fetch(trimmedUrl, {
        method: "POST",
        body: formData,
      });

      // Geen geschatte fase-overgangen meer: beide flows draaien als job en
      // melden hun echte stap terug via /webhook/job-status.
      clearPhaseTimers();

      const response = await responsePromise;
      clearPhaseTimers();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      let downloadUrl: string | undefined;
      let previewUrl: string | undefined;
      let filename: string | undefined;
      let bankDisplayName: string | undefined;
      let zaaknummer: string | undefined;
      let klantSamenvatting: string | undefined;
      let analyse: JuridischeAnalyseData | undefined;
      // De workflow echoot terug waarop hij daadwerkelijk heeft geanalyseerd;
      // wijkt dat af van de keuze hier, dan wint het antwoord.
      let gebruikteZaaksoort: string = zaaksoortSleutel(zaaksoorten);
      let bevoegdheid: BeschikkingsbevoegdheidData | undefined;

      if (contentType.includes("application/json")) {
        let payload: unknown = await response.json();

        // De analyse-workflow draait als achtergrondjob: die antwoordt meteen
        // met een job_id en werkt daarna door. De akte-workflow is nog
        // synchroon en levert het resultaat in één keer. Aan het antwoord zelf
        // is te zien welke van de twee het is, dus beide blijven werken.
        const jobId = jobIdVanAntwoord(payload);
        if (jobId) {
          payload = await wachtOpJob<Record<string, unknown>>(jobId, {
            onStatus: (job) => {
              const index = job.status ? STATUS_FASE[job.status] : undefined;
              if (index !== undefined) setPhaseIndex(index);
            },
          });
        }

        const data = payload as {
          mode?: GenerationMode;
          download_url?: string;
          preview_url?: string;
          file_path?: string;
          filename?: string;
          bank_display_name?: string;
          zaaknummer?: string;
          klant_samenvatting?: string;
          analysis?: JuridischeAnalyseData | null;
          zaaksoort?: string;
          beschikkingsbevoegdheid?: BeschikkingsbevoegdheidData | null;
        };
        if (data.filename) filename = data.filename;

        if (data.download_url) {
          downloadUrl = data.download_url;
        } else if (data.file_path) {
          downloadUrl =
            "http://localhost:8080/" +
            data.file_path.replace("/data/shared/", "");
        }
        if (data.preview_url) previewUrl = data.preview_url;

        bankDisplayName = data.bank_display_name;
        zaaknummer = data.zaaknummer;
        klantSamenvatting = data.klant_samenvatting;
        analyse = data.analysis ?? undefined;
        gebruikteZaaksoort = data.zaaksoort ?? gebruikteZaaksoort;
        bevoegdheid = data.beschikkingsbevoegdheid ?? undefined;
      } else if (!isAnalyseOnly) {
        // Fallback: blob (alleen akte-flow zonder JSON response).
        const blob = await response.blob();
        downloadUrl = URL.createObjectURL(blob);
        filename = "hypotheekakte.docx";
      }

      setPhaseIndex(progressPhases.length - 1);
      setStatusState("done");
      setCurrentStep(3);
      setResult({
        mode,
        downloadUrl,
        previewUrl,
        filename,
        bankDisplayName,
        zaaknummer,
        klantSamenvatting,
        analyse,
        zaaksoort: isAnalyseOnly ? gebruikteZaaksoort : undefined,
        bevoegdheid,
      });
      // Nieuw gegenereerd bestand staat nu in shared/output — lijst verversen.
      loadRecent();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clearPhaseTimers();
      setErrorMessage(message);
      setStatusState("error");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Terug naar de card-keuze */}
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:text-ink-strong"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Andere documentsoort
      </button>

      {/* Hero */}
      <section className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="animate-fade-up">
          <div className="mb-5 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              <span className="h-1 w-1 rounded-full bg-seal" />
              {modeMeta.badge}
            </span>
            <span className="font-mono text-[11px] text-ink-mute">
              {new Date().toLocaleDateString("nl-NL", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[64px]">
            {modeMeta.title}
          </h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink">
            {modeMeta.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetForm}>
            Formulier wissen
          </Button>
        </div>
      </section>

      {/* Werkruimte */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Voortgang */}
          <Panel
            kicker="01"
            label="Voortgang"
            right={
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                Stap {currentStep} / 3
              </span>
            }
          >
            <Stepper steps={steps} />
            <div className="font-display text-base text-ink-strong sm:hidden">
              Stap {currentStep}: {steps[currentStep - 1].label}
            </div>
          </Panel>

          {/* Bron-documenten */}
          <Panel
            kicker="02"
            label="Bron-documenten"
            description={
              isAnalyseOnly
                ? "Voeg losse stukken toe (bijv. alleen een BRP-inzage) of sleep een map hierheen. Bij een map vink je per submap aan wat meegaat."
                : "Sleep de dossiermap hierheen of voeg losse bestanden toe. Per submap vink je aan wat meegaat — hoe minder mee hoeft, hoe sneller de verwerking. Passeeropdracht en kadaster worden automatisch herkend."
            }
            right={
              <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    inputsReady ? "bg-success" : "bg-seal"
                  )}
                />
                {inputsReady
                  ? filesCount === totalCount
                    ? `${filesCount} compleet`
                    : `${filesCount} van ${totalCount} gaan mee`
                  : totalCount > 0
                    ? "Niets aangevinkt"
                    : "Wachten op upload"}
              </div>
            }
          >
            {requiresAkteInputs ? (
              <MultiFileDropZone
                files={akteDossierFiles}
                onChange={handleAkteFilesChange}
                excludedGroups={akteExcluded}
                onExcludedGroupsChange={setAkteExcluded}
              />
            ) : (
              <MultiFileDropZone
                files={analyseFiles}
                onChange={handleAnalyseFilesChange}
                excludedGroups={analyseExcluded}
                onExcludedGroupsChange={setAnalyseExcluded}
                variant="documenten"
              />
            )}
          </Panel>

          {/* Context — alleen zinvol bij de analyse; de akte-flow kent maar één zaaksoort */}
          {isAnalyseOnly && (
            <Panel
              kicker="03"
              label="Zaaksoort"
              description="Waar gaat deze zaak over? De analyse richt de vier specialisten en de eindbeoordeling op die transactie. Bevat het dossier er meer dan één — een levering met de hypotheekakte er direct achteraan — vink ze dan allebei aan."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ZAAKSOORT_OPTIES.map((optie) => {
                  const actief = zaaksoorten.includes(optie.waarde);
                  const laatste = actief && zaaksoorten.length === 1;
                  return (
                    <button
                      key={optie.waarde}
                      type="button"
                      onClick={() => toggleZaaksoort(optie.waarde)}
                      role="checkbox"
                      aria-checked={actief}
                      title={
                        laatste
                          ? "Er moet minstens één zaaksoort aan blijven staan"
                          : undefined
                      }
                      disabled={isGenerating}
                      className={cn(
                        "rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        actief
                          ? "border-ink-strong bg-wash/60"
                          : "border-line bg-surface hover:bg-wash/30"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-[3px] border",
                            actief
                              ? "border-ink-strong bg-ink-strong text-paper"
                              : "border-line bg-paper"
                          )}
                        >
                          {actief && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="text-[14px] font-semibold text-ink-strong">
                          {optie.label}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                        {optie.omschrijving}
                      </p>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* CTA — kalm paneel, zelfde surface als de andere kaarten */}
          <div className="relative overflow-hidden rounded-lg cta-panel shadow-card">
            <div className="relative p-6 sm:p-7">
              <div className="mb-3 flex items-center gap-3">
                <span className="font-mono text-[11px] font-medium text-ink-mute">
                  {isAnalyseOnly ? "04" : "03"}
                </span>
                <span className="h-px w-10 bg-line" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  Genereren
                </span>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink-strong sm:text-[30px]">
                    {inputsReady
                      ? "Klaar om te genereren"
                      : "Genereren staat klaar"}
                  </h2>

                  {/* Samenvatting-chips */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <SummaryChip
                      label="Bestanden"
                      value={
                        filesCount === totalCount
                          ? String(filesCount)
                          : `${filesCount} van ${totalCount}`
                      }
                      accent={inputsReady}
                    />
                    <SummaryChip
                      label="Modus"
                      value={modeMeta.shortLabel}
                    />
                    {isAnalyseOnly && (
                      <SummaryChip
                        label="Zaaksoort"
                        value={zaaksoortLabel(zaaksoortSleutel(zaaksoorten))}
                      />
                    )}
                    <SummaryChip
                      label="Output"
                      value={mode === "analyse" ? "Analyse" : "Akte (.docx)"}
                    />
                  </div>

                  {!inputsReady && (
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                      {totalCount > 0
                        ? "Alle submappen zijn uitgevinkt — vink er minstens één aan om te kunnen genereren."
                        : isAnalyseOnly
                          ? "Voeg minimaal 1 document toe om de analyse te starten — een enkel stuk (bijv. een BRP-inzage) is genoeg."
                          : "Voeg minimaal 1 document toe. Tip: sleep de dossiermap en vink daarna aan wat mee moet."}
                    </p>
                  )}
                </div>

                <Button
                  variant="primary"
                  size="xl"
                  disabled={!inputsReady || isGenerating}
                  onClick={startGeneration}
                  className="sm:min-w-[220px]"
                >
                  {isGenerating ? (
                    <>
                      <Sparkles className="h-4 w-4 animate-pulse" />
                      Bezig…
                    </>
                  ) : (
                    <>
                      {modeMeta.buttonLabel}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>

              {/* Geavanceerd — verborgen webhook URL */}
              <details className="mt-5 border-t border-line/70 pt-4">
                <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute transition-colors hover:text-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-ink-mute">↳</span>
                    Geavanceerd · n8n webhook
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label
                    htmlFor="webhook-url"
                    className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
                  >
                    Webhook URL ({modeMeta.shortLabel.toLowerCase()}-workflow)
                  </Label>
                  <Input
                    id="webhook-url"
                    type="text"
                    value={webhookUrls[mode]}
                    onChange={(e) =>
                      setWebhookUrls((prev) => ({ ...prev, [mode]: e.target.value }))
                    }
                    placeholder={DEFAULT_WEBHOOKS[mode]}
                    className="h-9 border-line bg-paper/60 font-mono text-[12px] text-ink-strong placeholder:text-ink-mute"
                  />
                </div>
              </details>
            </div>
          </div>

          {/* Voortgang — rustige spinner met de drie echte fasen */}
          {showStatus && (
            <GenerationProgress
              phases={progressPhases}
              phase={phaseIndex}
              state={statusState}
              errorMessage={errorMessage}
            />
          )}

          {/* Resultaat — akte */}
          {result?.downloadUrl && result.filename && (
            <div className="overflow-hidden rounded-lg border border-success/30 bg-success-pale shadow-card animate-fade-up">
              <div className="flex flex-col items-stretch gap-4 p-6 sm:flex-row sm:items-center sm:p-7">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-success text-2xl text-white shadow-card">
                  ✓
                </div>
                <div className="flex-1">
                  <div className="text-[22px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
                    Akte gegenereerd
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-ink">
                    {result.filename}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" size="default" onClick={resetForm}>
                    Nieuwe akte
                  </Button>
                  <Button asChild variant="success" size="default">
                    <a
                      href={result.downloadUrl}
                      download={result.filename}
                    >
                      <Download className="h-4 w-4" />
                      Download .docx
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Inline voorbeeld van de gegenereerde akte (met arceringen) */}
          {result?.previewUrl && (
            <AktePreview url={result.previewUrl} filename={result.filename} />
          )}

          {/* Resultaat — analyse-only */}
          {result && !result.downloadUrl && result.analyse && (
            <div className="overflow-hidden rounded-lg border border-azure/30 bg-azure-pale shadow-card animate-fade-up">
              <div className="flex flex-col items-stretch gap-4 p-6 sm:flex-row sm:items-center sm:p-7">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-azure text-white shadow-card">
                  <Scale className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <div className="text-[22px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
                    Juridische analyse gereed
                  </div>
                  <div className="mt-1 font-mono text-[12px] text-ink">
                    {result.analyse.filename ?? "Analyse zonder DOCX"}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" size="default" onClick={resetForm}>
                    Nieuwe analyse
                  </Button>
                  {result.analyse.download_url && (
                    <Button asChild variant="primary" size="default">
                      <a
                        href={result.analyse.download_url}
                        download={result.analyse.filename ?? undefined}
                      >
                        <Download className="h-4 w-4" />
                        Download analyse
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Beschikkingsbevoegdheid — hoort bij de akte, niet bij de analyse */}
          {result?.bevoegdheid && (
            <div className="space-y-3">
              <div
                className={
                  "flex items-start gap-3 rounded-lg border p-4 " +
                  (result.bevoegdheid.status === "rond"
                    ? "border-azure/30 bg-azure-pale"
                    : "border-amber-400/50 bg-amber-50")
                }
              >
                <Scale
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-ink-strong"
                  strokeWidth={2}
                />
                <div>
                  <div className="text-[15px] font-semibold leading-tight text-ink-strong">
                    Beschikkingsbevoegdheid
                  </div>
                  <div className="mt-1 text-[13px] leading-snug text-ink">
                    {result.bevoegdheid.samenvatting}
                  </div>
                </div>
              </div>
              {result.bevoegdheid.aandachtspunten.length > 0 && (
                <JuridischeAnalyse
                  analyse={result.bevoegdheid}
                  zaaknummer={result.zaaknummer}
                  bank={result.bankDisplayName}
                  klant={result.klantSamenvatting}
                />
              )}
            </div>
          )}

          {/* Juridische analyse-blok */}
          {result?.analyse && (
            <JuridischeAnalyse
              analyse={result.analyse}
              zaaknummer={result.zaaknummer}
              bank={result.bankDisplayName}
              klant={result.klantSamenvatting}
              zaaksoort={result.zaaksoort}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <DossierSummary
            mode={mode}
            filesCount={filesCount}
            totalCount={totalCount}
            inputsReady={inputsReady}
          />
          <RecentAktes
            items={recent}
            isLoading={recentLoading}
            error={recentError}
            onRefresh={loadRecent}
          />
        </div>
      </div>
    </div>
  );
}

// =============== Sub-components ===============

interface PanelProps {
  kicker?: string;
  label: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

function Panel({ kicker, label, description, right, children }: PanelProps) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <header className="flex flex-col gap-2 border-b border-line/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex items-start gap-4">
          {kicker && (
            <span className="mt-0.5 font-mono text-[11px] font-medium text-ink-mute">
              {kicker}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong">
              {label}
            </h2>
            {description && (
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
                {description}
              </p>
            )}
          </div>
        </div>
        {right && <div className="flex flex-shrink-0 items-center">{right}</div>}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

interface DossierSummaryProps {
  mode: GenerationMode;
  filesCount: number;
  totalCount: number;
  inputsReady: boolean;
}

function DossierSummary({
  mode,
  filesCount,
  totalCount,
  inputsReady,
}: DossierSummaryProps) {
  const modeLabel = MODE_META[mode].shortLabel;
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      <header className="border-b border-line/70 px-5 py-4">
        <h3 className="text-[13px] font-semibold tracking-[-0.005em] text-ink-strong">
          Dossier
        </h3>
        <p className="mt-0.5 text-[11.5px] text-ink-soft">
          Samenvatting
        </p>
      </header>
      <dl className="divide-y divide-line/70">
        <Row
          label="Modus"
          value={
            <span className="text-[14px] font-medium text-ink-strong">
              {modeLabel}
            </span>
          }
        />
        <Row
          label="Bestanden"
          value={
            <span className="flex items-center gap-2 text-[14px] font-medium text-ink-strong">
              <Files className="h-3.5 w-3.5 text-ink-soft" strokeWidth={2} />
              {filesCount === totalCount
                ? filesCount
                : `${filesCount} van ${totalCount}`}
            </span>
          }
        />
        <Row
          label="Status"
          value={
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12px] font-medium",
                inputsReady ? "text-success" : "text-ink-soft"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  inputsReady ? "bg-success" : "bg-seal"
                )}
              />
              {inputsReady ? "Klaar om te starten" : "Wachten op upload"}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <dt className="text-[12px] font-medium text-ink-soft">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border bg-paper/50 px-2.5 py-1.5",
        accent
          ? "border-azure/40 shadow-[0_0_0_1px_hsla(209,95%,60%,0.15)]"
          : "border-line"
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mute">
        {label}
      </span>
      <span
        className={cn(
          "text-[13px] font-semibold tracking-[-0.005em]",
          accent ? "text-azure-glow" : "text-ink-strong"
        )}
      >
        {value}
      </span>
    </span>
  );
}
