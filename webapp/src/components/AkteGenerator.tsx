import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Download,
  FileText,
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
import { StatusLog } from "@/components/StatusLog";
import type { LogEntry, LogKind, StatusState } from "@/components/StatusLog";
import { RecentAktes } from "@/components/RecentAktes";
import { fetchRecentAktes } from "@/lib/recent-aktes";
import type { RecentAkte } from "@/components/RecentAktes";
import { JuridischeAnalyse } from "@/components/JuridischeAnalyse";
import type { JuridischeAnalyseData } from "@/components/JuridischeAnalyse";
import { cn } from "@/lib/utils";
import { dedupeFilesForUpload } from "@/lib/dedupe-upload-files";

const DEFAULT_WEBHOOK = "http://localhost:5678/webhook/hypotheekakte";

export type GenerationMode = "akte" | "analyse";

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

function formatTime(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GenerationResult {
  mode: GenerationMode;
  downloadUrl?: string;
  filename?: string;
  bankDisplayName?: string;
  zaaknummer?: string;
  klantSamenvatting?: string;
  analyse?: JuridischeAnalyseData;
}

export function AkteGenerator() {
  const [mode, setMode] = useState<GenerationMode>("akte");

  /** Alle PDF's van het dossier voor akte / akte+analyse (map-upload). */
  const [akteDossierFiles, setAkteDossierFiles] = useState<File[]>([]);
  const [analyseFiles, setAnalyseFiles] = useState<File[]>([]);
  const [webhookUrl, setWebhookUrl] = useState(DEFAULT_WEBHOOK);

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [statusState, setStatusState] = useState<StatusState>("running");
  const [statusTitle, setStatusTitle] = useState("Verwerken…");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);
  const [showStatus, setShowStatus] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

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

  const isAnalyseOnly = mode === "analyse";
  const requiresAkteInputs = mode === "akte";
  const hasAkteDossier = akteDossierFiles.length > 0;
  const hasAnalyseFiles = analyseFiles.length > 0;

  const inputsReady = isAnalyseOnly ? hasAnalyseFiles : hasAkteDossier;
  const filesCount = isAnalyseOnly ? analyseFiles.length : akteDossierFiles.length;

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

  function addLog(text: string, kind: LogKind = "info") {
    setLogs((prev) => [
      ...prev,
      {
        id: logCounter + prev.length,
        time: formatTime(new Date()),
        text,
        kind,
      },
    ]);
    setLogCounter((n) => n + 1);
  }

  function resetForm() {
    setAkteDossierFiles([]);
    setAnalyseFiles([]);
    setLogs([]);
    setShowStatus(false);
    setResult(null);
    setCurrentStep(1);
  }

  function handleModeChange(nextMode: GenerationMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setResult(null);
    setShowStatus(false);
    setLogs([]);
    setCurrentStep(1);
  }

  async function startGeneration() {
    if (!inputsReady) return;
    const trimmedUrl = webhookUrl.trim();
    if (!trimmedUrl) {
      alert("Vul de webhook URL in.");
      return;
    }

    setIsGenerating(true);
    setShowStatus(true);
    setResult(null);
    setLogs([]);
    setStatusState("running");
    setStatusTitle("Verwerken…");
    setCurrentStep(2);

    addLog("Bestanden voorbereiden…");

    const sourceFiles = isAnalyseOnly ? analyseFiles : akteDossierFiles;
    const uploadFiles = dedupeFilesForUpload(sourceFiles);
    if (uploadFiles.length === 0) {
      addLog("Geen bruikbare bestanden na filteren.", "error");
      setStatusState("error");
      setStatusTitle("Geen bestanden");
      setIsGenerating(false);
      setCurrentStep(1);
      return;
    }
    if (uploadFiles.length < sourceFiles.length) {
      addLog(
        `${sourceFiles.length - uploadFiles.length} duplicaat of ruisbestand (bijv. .DS_Store, ._*) overgeslagen.`,
        "info"
      );
    }

    const formData = new FormData();
    formData.append("mode", mode);

    if (isAnalyseOnly) {
      uploadFiles.forEach((file, idx) => {
        formData.append(`document_${idx}`, file, file.name);
      });
    } else {
      uploadFiles.forEach((file, idx) => {
        formData.append(`dossier_${idx}`, file, file.name);
      });
    }

    try {
      addLog("Verbinding maken met n8n…");
      const responsePromise = fetch(trimmedUrl, {
        method: "POST",
        body: formData,
      });

      await sleep(600);
      if (isAnalyseOnly) {
        addLog(
          `Documenten naar Docling gestuurd (${uploadFiles.length} stuk${
            uploadFiles.length === 1 ? "" : "s"
          })…`
        );
        await sleep(900);
        addLog("Markdowns samenvoegen voor juridische analyse…");
      } else {
        addLog(
          `${uploadFiles.length} document(en) naar Docling (hele dossier)…`
        );
        await sleep(900);
        addLog("Ollama extraheert bank- en kadastergegevens…");
        await sleep(800);
        addLog("Word template invullen…");
      }
      await sleep(600);
      if (mode !== "akte") {
        addLog("Juridische analyse van het dossier…");
      }

      const response = await responsePromise;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      let downloadUrl: string | undefined;
      let filename: string | undefined;
      let bankDisplayName: string | undefined;
      let zaaknummer: string | undefined;
      let klantSamenvatting: string | undefined;
      let analyse: JuridischeAnalyseData | undefined;

      if (contentType.includes("application/json")) {
        const data = (await response.json()) as {
          mode?: GenerationMode;
          download_url?: string;
          file_path?: string;
          filename?: string;
          bank_display_name?: string;
          zaaknummer?: string;
          klant_samenvatting?: string;
          analysis?: JuridischeAnalyseData | null;
        };
        if (data.filename) filename = data.filename;

        if (data.download_url) {
          downloadUrl = data.download_url;
        } else if (data.file_path) {
          downloadUrl =
            "http://localhost:8080/" +
            data.file_path.replace("/data/shared/", "");
        }

        bankDisplayName = data.bank_display_name;
        zaaknummer = data.zaaknummer;
        klantSamenvatting = data.klant_samenvatting;
        analyse = data.analysis ?? undefined;
      } else if (!isAnalyseOnly) {
        // Fallback: blob (alleen akte-flow zonder JSON response).
        const blob = await response.blob();
        downloadUrl = URL.createObjectURL(blob);
        filename = "hypotheekakte.docx";
      }

      await sleep(300);
      if (analyse) {
        const totaal =
          analyse.counts?.totaal ?? (analyse.aandachtspunten?.length ?? 0);
        const kritiek = analyse.counts?.kritiek ?? 0;
        if (totaal === 0) {
          addLog("Analyse: geen aandachtspunten geconstateerd.", "success");
        } else if (kritiek > 0) {
          addLog(
            `Analyse: ${totaal} aandachtspunt(en), waarvan ${kritiek} kritiek.`,
            "info"
          );
        } else {
          addLog(`Analyse: ${totaal} aandachtspunt(en).`, "info");
        }
      }
      if (filename) {
        addLog("Akte succesvol aangemaakt.", "success");
      } else if (isAnalyseOnly) {
        addLog("Juridische analyse afgerond.", "success");
      }
      setStatusState("done");
      setStatusTitle("Gereed");
      setCurrentStep(3);
      setResult({
        mode,
        downloadUrl,
        filename,
        bankDisplayName,
        zaaknummer,
        klantSamenvatting,
        analyse,
      });
      // Nieuw gegenereerd bestand staat nu in shared/output — lijst verversen.
      loadRecent();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Fout: ${message}`, "error");
      setStatusState("error");
      setStatusTitle("Fout opgetreden");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Hero */}
      <section className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
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

      {/* Mode selector */}
      <div className="mb-8 animate-fade-up">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[11px] font-medium text-ink-mute">01</span>
          <span className="h-px flex-1 bg-line/60" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Modus
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeCard
            active={mode === "akte"}
            icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
            label={MODE_META.akte.shortLabel}
            sublabel="Concept-akte uit dossier"
            onClick={() => handleModeChange("akte")}
          />
          <ModeCard
            active={mode === "analyse"}
            icon={<Scale className="h-4 w-4" strokeWidth={1.75} />}
            label={MODE_META.analyse.shortLabel}
            sublabel="Juridische eerste lezing"
            onClick={() => handleModeChange("analyse")}
          />
        </div>
      </div>

      {/* Werkruimte */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Voortgang */}
          <Panel
            kicker="02"
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
            kicker="03"
            label="Bron-documenten"
            description={
              isAnalyseOnly
                ? "Sleep de hele dossiermap hier (inclusief submappen) of voeg losse PDF/.docx bestanden toe."
                : "Sleep de hele dossiermap hier (inclusief submappen). Passeeropdracht en kadaster worden automatisch herkend; overige stukken gaan mee naar de analyse."
            }
            right={
              <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    inputsReady ? "bg-success" : "bg-seal"
                  )}
                />
                {inputsReady ? `${filesCount} compleet` : "Wachten op upload"}
              </div>
            }
          >
            {requiresAkteInputs ? (
              <MultiFileDropZone
                files={akteDossierFiles}
                onChange={setAkteDossierFiles}
              />
            ) : (
              <MultiFileDropZone
                files={analyseFiles}
                onChange={setAnalyseFiles}
                variant="documenten"
              />
            )}
          </Panel>

          {/* CTA — kalm paneel, zelfde surface als de andere kaarten */}
          <div className="relative overflow-hidden rounded-lg cta-panel shadow-card">
            <div className="relative p-6 sm:p-7">
              <div className="mb-3 flex items-center gap-3">
                <span className="font-mono text-[11px] font-medium text-ink-mute">04</span>
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
                      value={String(filesCount)}
                      accent={inputsReady}
                    />
                    <SummaryChip
                      label="Modus"
                      value={modeMeta.shortLabel}
                    />
                    <SummaryChip
                      label="Output"
                      value={mode === "analyse" ? "Analyse" : "Akte (.docx)"}
                    />
                  </div>

                  {!inputsReady && (
                    <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                      {isAnalyseOnly
                        ? "Voeg minimaal 1 document toe om de analyse te starten."
                        : "Voeg minimaal 1 document toe. Tip: kies de hele map."}
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
                    Webhook URL
                  </Label>
                  <Input
                    id="webhook-url"
                    type="text"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder={DEFAULT_WEBHOOK}
                    className="h-9 border-line bg-paper/60 font-mono text-[12px] text-ink-strong placeholder:text-ink-mute"
                  />
                </div>
              </details>
            </div>
          </div>

          {/* Statuslog */}
          {showStatus && (
            <StatusLog
              state={statusState}
              title={statusTitle}
              entries={logs}
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

          {/* Juridische analyse-blok */}
          {result?.analyse && (
            <JuridischeAnalyse
              analyse={result.analyse}
              zaaknummer={result.zaaknummer}
              bank={result.bankDisplayName}
              klant={result.klantSamenvatting}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <DossierSummary
            mode={mode}
            filesCount={filesCount}
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

interface ModeCardProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  recommended?: boolean;
  onClick: () => void;
}

function ModeCard({
  active,
  icon,
  label,
  sublabel,
  recommended,
  onClick,
}: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all",
        active
          ? "border-azure/60 bg-azure-pale/60 shadow-glow"
          : "border-line bg-surface/60 hover:border-line-strong hover:bg-wash/60"
      )}
      aria-pressed={active}
    >
      {recommended && !active && (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-sm border border-seal/40 bg-paper px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-seal-deep">
          Aanbevolen
        </span>
      )}
      <span
        className={cn(
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
          active
            ? "border-azure/50 bg-ink-deeper text-azure-glow"
            : "border-line bg-ink-deeper text-ink-soft group-hover:text-ink-strong"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[15px] font-semibold leading-tight tracking-[-0.005em]",
            active ? "text-ink-strong" : "text-ink"
          )}
        >
          {label}
        </span>
        <span className="mt-1 block text-[12px] text-ink-soft">
          {sublabel}
        </span>
      </span>
      {active && (
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-azure shadow-[0_0_8px_hsl(var(--azure))]" />
      )}
    </button>
  );
}

interface DossierSummaryProps {
  mode: GenerationMode;
  filesCount: number;
  inputsReady: boolean;
}

function DossierSummary({ mode, filesCount, inputsReady }: DossierSummaryProps) {
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
              {filesCount}
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
