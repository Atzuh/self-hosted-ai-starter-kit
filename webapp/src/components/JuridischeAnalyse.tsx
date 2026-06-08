import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Scale,
  ShieldAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Ernst = "kritiek" | "aandacht" | "info";

export interface AandachtsPunt {
  id: string;
  ernst: Ernst;
  categorie: string;
  titel: string;
  constatering: string;
  juridisch_kader: string;
  actie: string;
  bronnen: string[];
}

export interface AnalyseCounts {
  kritiek: number;
  aandacht: number;
  info: number;
  totaal: number;
}

export interface JuridischeAnalyseData {
  samenvatting: string;
  aandachtspunten: AandachtsPunt[];
  counts?: AnalyseCounts;
  filename?: string | null;
  download_url?: string | null;
  generation_warning?: string | null;
}

interface JuridischeAnalyseProps {
  analyse: JuridischeAnalyseData;
  zaaknummer?: string;
  bank?: string;
  klant?: string;
}

const ERNST_LABEL: Record<Ernst, string> = {
  kritiek: "Kritiek",
  aandacht: "Aandacht",
  info: "Informatief",
};

const ERNST_BADGE: Record<Ernst, string> = {
  kritiek: "border-danger/40 bg-danger/8 text-danger",
  aandacht: "border-seal/40 bg-seal/10 text-seal-deep",
  info: "border-azure/40 bg-azure/8 text-azure",
};

const ERNST_ACCENT: Record<Ernst, string> = {
  kritiek: "border-l-danger",
  aandacht: "border-l-seal",
  info: "border-l-azure",
};

function ErnstIcon({ ernst, className }: { ernst: Ernst; className?: string }) {
  const Icon =
    ernst === "kritiek"
      ? ShieldAlert
      : ernst === "aandacht"
      ? AlertTriangle
      : Info;
  return <Icon className={cn("h-3.5 w-3.5", className)} strokeWidth={2.5} />;
}

function bronLabel(bron: string): string {
  const b = bron.toLowerCase();
  if (b.includes("passeer")) return "Passeeropdracht";
  if (b.includes("kadaster")) return "Kadaster";
  if (b.includes("extractie")) return "Extractie";
  return bron;
}

function ItemCard({ punt, index }: { punt: AandachtsPunt; index: number }) {
  const [open, setOpen] = useState(punt.ernst === "kritiek");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-line border-l-4 bg-surface transition-colors",
        ERNST_ACCENT[punt.ernst]
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-wash/40"
      >
        <span
          className={cn(
            "mt-0.5 inline-flex flex-shrink-0 items-center gap-1.5 border px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]",
            ERNST_BADGE[punt.ernst]
          )}
        >
          <ErnstIcon ernst={punt.ernst} />
          {ERNST_LABEL[punt.ernst]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.005em] text-ink-strong">
              <span className="text-ink-mute font-mono text-[13px] font-medium mr-1">
                {String(index).padStart(2, "0")}
              </span>
              {punt.titel}
            </h3>
            {open ? (
              <ChevronDown
                className="h-4 w-4 flex-shrink-0 text-ink-soft"
                strokeWidth={2.25}
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 flex-shrink-0 text-ink-soft"
                strokeWidth={2.25}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-soft">
            {punt.categorie && (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold uppercase tracking-[0.1em] text-[10px] text-ink-mute">
                  Categorie
                </span>
                <span className="font-medium">{punt.categorie}</span>
              </span>
            )}
            {punt.bronnen?.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-semibold uppercase tracking-[0.1em] text-[10px] text-ink-mute">
                  Bron
                </span>
                <span>
                  {punt.bronnen.map((b, i) => (
                    <span key={`${b}-${i}`}>
                      {i > 0 && ", "}
                      {bronLabel(b)}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line/70 bg-paper/60 px-4 py-4">
          {punt.constatering && (
            <Section label="Constatering" body={punt.constatering} />
          )}
          {punt.juridisch_kader && (
            <Section label="Juridisch kader" body={punt.juridisch_kader} />
          )}
          {punt.actie && (
            <Section
              label="Aanbevolen actie"
              body={punt.actie}
              accent
            />
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  body,
  accent,
}: {
  label: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </div>
      <div
        className={cn(
          "text-sm leading-relaxed",
          accent ? "font-medium text-ink-strong" : "text-ink"
        )}
      >
        {body}
      </div>
    </div>
  );
}

export function JuridischeAnalyse({
  analyse,
  zaaknummer,
  bank,
  klant,
}: JuridischeAnalyseProps) {
  const counts = useMemo<AnalyseCounts>(() => {
    if (analyse.counts) return analyse.counts;
    const list = analyse.aandachtspunten ?? [];
    return {
      kritiek: list.filter((p) => p.ernst === "kritiek").length,
      aandacht: list.filter((p) => p.ernst === "aandacht").length,
      info: list.filter((p) => p.ernst === "info").length,
      totaal: list.length,
    };
  }, [analyse]);

  const punten = analyse.aandachtspunten ?? [];
  const heeftPunten = punten.length > 0;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <header className="flex flex-col gap-3 border-b border-line/70 bg-paper-strong/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-azure/40 bg-ink-deeper text-azure-glow shadow-glow">
            <Scale className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Juridische analyse
            </div>
            <h2 className="mt-1 text-[20px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
              Aandachtspunten voor de behandelaar
            </h2>
            <div className="mt-1.5 font-mono text-[11px] text-ink-soft">
              {[
                bank ? `Bank: ${bank}` : null,
                zaaknummer ? `Zaak: ${zaaknummer}` : null,
                klant ? `Cliënt: ${klant}` : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </div>
        </div>
        {analyse.download_url && (
          <Button asChild variant="outline" size="sm">
            <a href={analyse.download_url} download={analyse.filename ?? undefined}>
              <Download className="h-4 w-4" />
              Analyse als .docx
            </a>
          </Button>
        )}
      </header>

      <div className="grid grid-cols-3 divide-x divide-line/70 border-b border-line/70">
        <CountTile ernst="kritiek" value={counts.kritiek} label="Kritiek" />
        <CountTile ernst="aandacht" value={counts.aandacht} label="Aandacht" />
        <CountTile ernst="info" value={counts.info} label="Informatief" />
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div>
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Samenvatting
          </div>
          {analyse.samenvatting ? (
            <p className="text-[15.5px] leading-relaxed text-ink-strong">
              {analyse.samenvatting}
            </p>
          ) : (
            <p className="text-sm italic text-ink-soft">
              Geen samenvatting beschikbaar.
            </p>
          )}
        </div>

        <div className="divider-fade" />

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Aandachtspunten <span className="font-mono font-medium text-ink-mute">({counts.totaal})</span>
            </div>
          </div>
          {heeftPunten ? (
            <div className="space-y-3">
              {punten.map((punt, i) => (
                <ItemCard key={punt.id ?? i} punt={punt} index={i + 1} />
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success-pale p-4">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-success"
                strokeWidth={2}
              />
              <div className="text-sm text-ink">
                Op basis van de aangeleverde stukken zijn er geen specifieke
                aandachtspunten geconstateerd. De standaard formele controles
                blijven uiteraard van toepassing.
              </div>
            </div>
          )}
        </div>

        {analyse.generation_warning && (
          <p className="rounded-sm border-l-2 border-seal bg-seal/10 px-3 py-2 font-mono text-[11px] text-seal-deep">
            {analyse.generation_warning}
          </p>
        )}

        <p className="border-t border-line/70 pt-4 font-display text-[13px] italic leading-relaxed text-ink-soft">
          Deze analyse is automatisch gegenereerd op basis van de aangeleverde
          stukken en dient ter ondersteuning. De behandelaar blijft
          verantwoordelijk voor de juridische beoordeling.
        </p>
      </div>
    </section>
  );
}

function CountTile({
  ernst,
  value,
  label,
}: {
  ernst: Ernst;
  value: number;
  label: string;
}) {
  const colorByErnst: Record<Ernst, string> = {
    kritiek: "text-danger",
    aandacht: "text-seal-deep",
    info: "text-azure",
  };
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <span
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border",
          ERNST_BADGE[ernst]
        )}
      >
        <ErnstIcon ernst={ernst} />
      </span>
      <div>
        <div
          className={cn(
            "font-display text-[36px] font-medium leading-none tracking-[-0.02em] tabular-nums",
            value > 0 ? colorByErnst[ernst] : "text-ink-mute"
          )}
        >
          {value}
        </div>
        <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
        </div>
      </div>
    </div>
  );
}
