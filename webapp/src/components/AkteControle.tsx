import { useState } from "react";
import { ArrowRight, FileCheck2, FileText, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SingleFileDropZone } from "@/components/SingleFileDropZone";
import { StatusLog } from "@/components/StatusLog";
import type { LogEntry, LogKind, StatusState } from "@/components/StatusLog";
import { AkteControleResultaat } from "@/components/AkteControleResultaat";
import type { AkteControleData } from "@/components/AkteControleResultaat";

const DEFAULT_WEBHOOK = "http://localhost:5678/webhook/akte-controle";

function formatTime(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function AkteControle() {
  const [akteFile, setAkteFile] = useState<File | null>(null);
  const [bronFile, setBronFile] = useState<File | null>(null);
  const [webhookUrl, setWebhookUrl] = useState(DEFAULT_WEBHOOK);

  const [isChecking, setIsChecking] = useState(false);
  const [statusState, setStatusState] = useState<StatusState>("running");
  const [statusTitle, setStatusTitle] = useState("Controleren…");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);
  const [showStatus, setShowStatus] = useState(false);
  const [result, setResult] = useState<AkteControleData | null>(null);

  const hasAkte = akteFile !== null;
  const hasBron = bronFile !== null;
  const inputsReady = hasAkte && hasBron;

  function addLog(text: string, kind: LogKind = "info") {
    setLogs((prev) => [
      ...prev,
      { id: logCounter + prev.length, time: formatTime(new Date()), text, kind },
    ]);
    setLogCounter((n) => n + 1);
  }

  function resetForm() {
    setAkteFile(null);
    setBronFile(null);
    setLogs([]);
    setShowStatus(false);
    setResult(null);
  }

  async function startCheck() {
    if (!inputsReady) return;
    const trimmedUrl = webhookUrl.trim();
    if (!trimmedUrl) {
      alert("Vul de webhook URL in.");
      return;
    }

    setIsChecking(true);
    setShowStatus(true);
    setResult(null);
    setLogs([]);
    setStatusState("running");
    setStatusTitle("Controleren…");
    addLog("Bestanden voorbereiden…");

    if (!akteFile || !bronFile) {
      addLog("Beide documenten zijn vereist.", "error");
      setStatusState("error");
      setStatusTitle("Geen bestanden");
      setIsChecking(false);
      return;
    }

    const formData = new FormData();
    formData.append("akte_0", akteFile, akteFile.name);
    formData.append("bron_0", bronFile, bronFile.name);

    try {
      addLog("Verbinding maken met n8n…");
      const responsePromise = fetch(trimmedUrl, {
        method: "POST",
        body: formData,
      });

      await sleep(600);
      addLog("Documenten naar Docling sturen voor tekstextractie…");
      await sleep(900);
      addLog("Bedingen uit het brondocument vergelijken met de akte…");
      await sleep(800);
      addLog("Spellingscontrole op de akte van levering…");

      const response = await responsePromise;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as Partial<AkteControleData> & {
        success?: boolean;
        error?: string;
      };

      if (data.error) {
        throw new Error(data.error);
      }

      const normalised: AkteControleData = {
        zaaknummer: data.zaaknummer,
        akte_filename: data.akte_filename,
        bron_filename: data.bron_filename,
        comparison: {
          bedingen: data.comparison?.bedingen ?? [],
          counts: data.comparison?.counts,
        },
        spelling: {
          fouten: data.spelling?.fouten ?? [],
          count: data.spelling?.count,
        },
        brondocument_checks: data.brondocument_checks ?? [],
      };

      const ontbreekt = normalised.comparison.counts?.ontbreekt ?? 0;
      const gewijzigd = normalised.comparison.counts?.gewijzigd ?? 0;
      const spelCount = normalised.spelling.fouten.length;
      addLog(
        `Vergelijking: ${normalised.comparison.bedingen.length} beding(en), ` +
          `${ontbreekt} ontbrekend, ${gewijzigd} gewijzigd.`,
        ontbreekt > 0 ? "info" : "success"
      );
      addLog(
        spelCount > 0
          ? `Spelling: ${spelCount} mogelijke fout(en).`
          : "Spelling: geen fouten gevonden.",
        spelCount > 0 ? "info" : "success"
      );
      const kwijtingOntbreekt = (normalised.brondocument_checks ?? []).some(
        (check) => check.id === "kwijting" && !check.gevonden
      );
      addLog(
        kwijtingOntbreekt
          ? "Let op: geen kwijting/kwitantie in het brondocument gevonden."
          : "Kwijting/kwitantie aangetroffen in het brondocument.",
        kwijtingOntbreekt ? "info" : "success"
      );
      addLog("Controle afgerond.", "success");

      setStatusState("done");
      setStatusTitle("Gereed");
      setResult(normalised);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Fout: ${message}`, "error");
      setStatusState("error");
      setStatusTitle("Fout opgetreden");
    } finally {
      setIsChecking(false);
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
              Aktecontrole
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
            Controle akte van levering
          </h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink">
            Controleer of alle bedingen uit het brondocument correct zijn
            overgenomen in de akte van levering, inclusief een spellingscontrole.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetForm}>
            Formulier wissen
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6">
        {/* Uploads — twee aparte vakken */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <UploadPanel
            kicker="01"
            label="Akte van levering"
            icon={<FileCheck2 className="h-4 w-4" strokeWidth={1.75} />}
            description="Het te controleren document (één bestand). Hierop wordt ook de spellingscontrole uitgevoerd."
            ready={hasAkte}
          >
            <SingleFileDropZone file={akteFile} onChange={setAkteFile} />
          </UploadPanel>

          <UploadPanel
            kicker="02"
            label="Brondocument"
            icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
            description="De bron met de bedingen (één bestand, bijv. koopovereenkomst of eerdere akte)."
            ready={hasBron}
          >
            <SingleFileDropZone file={bronFile} onChange={setBronFile} />
          </UploadPanel>
        </div>

        {/* CTA */}
        <div className="relative overflow-hidden rounded-lg cta-panel shadow-card">
          <div className="relative p-6 sm:p-7">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-mono text-[11px] font-medium text-ink-mute">
                03
              </span>
              <span className="h-px w-10 bg-line" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                Controleren
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink-strong sm:text-[30px]">
                  {inputsReady ? "Klaar om te controleren" : "Controle staat klaar"}
                </h2>
                {!inputsReady && (
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                    Upload zowel de akte van levering als het brondocument om de
                    controle te starten.
                  </p>
                )}
              </div>

              <Button
                variant="primary"
                size="xl"
                disabled={!inputsReady || isChecking}
                onClick={startCheck}
                className="sm:min-w-[220px]"
              >
                {isChecking ? (
                  <>
                    <ShieldCheck className="h-4 w-4 animate-pulse" />
                    Bezig…
                  </>
                ) : (
                  <>
                    Controle starten
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {/* Geavanceerd — webhook URL */}
            <details className="mt-5 border-t border-line/70 pt-4">
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mute transition-colors hover:text-ink-soft">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-ink-mute">↳</span>
                  Geavanceerd · n8n webhook
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-1.5">
                <Label
                  htmlFor="ac-webhook-url"
                  className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
                >
                  Webhook URL
                </Label>
                <Input
                  id="ac-webhook-url"
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
          <StatusLog state={statusState} title={statusTitle} entries={logs} />
        )}

        {/* Resultaat */}
        {result && <AkteControleResultaat data={result} />}
      </div>
    </div>
  );
}

interface UploadPanelProps {
  kicker: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  ready: boolean;
  children: React.ReactNode;
}

function UploadPanel({
  kicker,
  label,
  icon,
  description,
  ready,
  children,
}: UploadPanelProps) {
  return (
    <section className="flex flex-col rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <header className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start gap-4">
          <span className="mt-0.5 font-mono text-[11px] font-medium text-ink-mute">
            {kicker}
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong">
              <span className="text-ink-soft">{icon}</span>
              {label}
            </h2>
            <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
              {description}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft">
          <span className={cnReady(ready)} />
          {ready ? "Klaar" : "Leeg"}
        </div>
      </header>
      <div className="flex-1 p-5 sm:p-6">{children}</div>
    </section>
  );
}

function cnReady(ready: boolean) {
  return `h-1.5 w-1.5 rounded-full ${ready ? "bg-success" : "bg-seal"}`;
}
