import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ScanText,
  ShieldCheck,
  ShieldX,
  SpellCheck2,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type BedingStatus = "overgenomen" | "gewijzigd" | "ontbreekt";

export interface Beding {
  id: string;
  titel: string;
  status: BedingStatus;
  brontekst: string;
  aktetekst: string;
  toelichting: string;
}

export interface ComparisonCounts {
  overgenomen: number;
  gewijzigd: number;
  ontbreekt: number;
  totaal: number;
}

export interface SpellingFout {
  woord: string;
  suggestie: string;
  context: string;
}

export interface BrondocumentCheck {
  id: string;
  label: string;
  gevonden: boolean;
  toelichting: string;
}

export interface AkteControleData {
  zaaknummer?: string;
  akte_filename?: string;
  bron_filename?: string;
  comparison: {
    bedingen: Beding[];
    counts?: ComparisonCounts;
  };
  spelling: {
    fouten: SpellingFout[];
    count?: number;
  };
  brondocument_checks?: BrondocumentCheck[];
}

const STATUS_LABEL: Record<BedingStatus, string> = {
  overgenomen: "Overgenomen",
  gewijzigd: "Gewijzigd",
  ontbreekt: "Ontbreekt",
};

const STATUS_BADGE: Record<BedingStatus, string> = {
  overgenomen: "border-success/40 bg-success/10 text-success",
  gewijzigd: "border-seal/40 bg-seal/10 text-seal-deep",
  ontbreekt: "border-danger/40 bg-danger/8 text-danger",
};

const STATUS_ACCENT: Record<BedingStatus, string> = {
  overgenomen: "border-l-success",
  gewijzigd: "border-l-seal",
  ontbreekt: "border-l-danger",
};

function StatusIcon({
  status,
  className,
}: {
  status: BedingStatus;
  className?: string;
}) {
  const Icon =
    status === "overgenomen"
      ? CheckCircle2
      : status === "gewijzigd"
      ? AlertTriangle
      : ShieldX;
  return <Icon className={cn("h-3.5 w-3.5", className)} strokeWidth={2.5} />;
}

function BedingCard({ beding, index }: { beding: Beding; index: number }) {
  const [open, setOpen] = useState(beding.status !== "overgenomen");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-line border-l-4 bg-surface transition-colors",
        STATUS_ACCENT[beding.status]
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
            STATUS_BADGE[beding.status]
          )}
        >
          <StatusIcon status={beding.status} />
          {STATUS_LABEL[beding.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.005em] text-ink-strong">
              <span className="mr-1 font-mono text-[13px] font-medium text-ink-mute">
                {String(index).padStart(2, "0")}
              </span>
              {beding.titel}
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
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line/70 bg-paper/60 px-4 py-4">
          {beding.brontekst && (
            <Section label="Brondocument" body={beding.brontekst} />
          )}
          {beding.aktetekst ? (
            <Section label="Akte van levering" body={beding.aktetekst} />
          ) : beding.status === "ontbreekt" ? (
            <Section
              label="Akte van levering"
              body="Niet teruggevonden in de akte van levering."
            />
          ) : null}
          {beding.toelichting && (
            <Section label="Toelichting" body={beding.toelichting} accent />
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

function CountTile({
  status,
  value,
  label,
}: {
  status: BedingStatus;
  value: number;
  label: string;
}) {
  const colorByStatus: Record<BedingStatus, string> = {
    overgenomen: "text-success",
    gewijzigd: "text-seal-deep",
    ontbreekt: "text-danger",
  };
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <span
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border",
          STATUS_BADGE[status]
        )}
      >
        <StatusIcon status={status} />
      </span>
      <div>
        <div
          className={cn(
            "font-display text-[36px] font-medium leading-none tracking-[-0.02em] tabular-nums",
            value > 0 ? colorByStatus[status] : "text-ink-mute"
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

interface AkteControleResultaatProps {
  data: AkteControleData;
}

export function AkteControleResultaat({ data }: AkteControleResultaatProps) {
  const bedingen = data.comparison?.bedingen ?? [];
  const counts = useMemo<ComparisonCounts>(() => {
    if (data.comparison?.counts) return data.comparison.counts;
    return {
      overgenomen: bedingen.filter((b) => b.status === "overgenomen").length,
      gewijzigd: bedingen.filter((b) => b.status === "gewijzigd").length,
      ontbreekt: bedingen.filter((b) => b.status === "ontbreekt").length,
      totaal: bedingen.length,
    };
  }, [data.comparison, bedingen]);

  const fouten = data.spelling?.fouten ?? [];
  const heeftBedingen = bedingen.length > 0;
  const ontbrekendeChecks = (data.brondocument_checks ?? []).filter(
    (check) => !check.gevonden
  );
  const meta = [
    data.bron_filename ? `Brondocument: ${data.bron_filename}` : null,
    data.akte_filename ? `Akte: ${data.akte_filename}` : null,
    data.zaaknummer ? `Ref: ${data.zaaknummer}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <header className="flex flex-col gap-3 border-b border-line/70 bg-paper-strong/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-azure/40 bg-ink-deeper text-azure-glow shadow-glow">
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Controle akte van levering
            </div>
            <h2 className="mt-1 text-[20px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
              Bedingen-vergelijking & spelling
            </h2>
            {meta && (
              <div className="mt-1.5 font-mono text-[11px] text-ink-soft">
                {meta}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Ontbrekende verplichte bedingen in het brondocument */}
      {ontbrekendeChecks.length > 0 && (
        <div className="space-y-2.5 border-b border-line/70 bg-danger/5 px-5 py-4 sm:px-6">
          {ontbrekendeChecks.map((check) => (
            <div key={check.id} className="flex items-start gap-3">
              <ShieldX
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger"
                strokeWidth={2}
              />
              <div className="text-sm leading-relaxed text-ink">
                <span className="font-semibold text-ink-strong">
                  {check.label} niet gevonden in het brondocument.
                </span>{" "}
                {check.toelichting}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bedingen */}
      <div className="grid grid-cols-3 divide-x divide-line/70 border-b border-line/70">
        <CountTile
          status="overgenomen"
          value={counts.overgenomen}
          label="Overgenomen"
        />
        <CountTile status="gewijzigd" value={counts.gewijzigd} label="Gewijzigd" />
        <CountTile status="ontbreekt" value={counts.ontbreekt} label="Ontbreekt" />
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              <ScanText className="h-3.5 w-3.5 text-ink-mute" strokeWidth={2} />
              Bedingen uit het brondocument{" "}
              <span className="font-mono font-medium text-ink-mute">
                ({counts.totaal})
              </span>
            </div>
          </div>
          {heeftBedingen ? (
            <div className="space-y-3">
              {bedingen.map((beding, i) => (
                <BedingCard key={beding.id ?? i} beding={beding} index={i + 1} />
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-md border border-seal/30 bg-seal/8 p-4">
              <AlertTriangle
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-seal-deep"
                strokeWidth={2}
              />
              <div className="text-sm text-ink">
                Er zijn geen bedingen uit het brondocument herleid. Controleer of
                het juiste brondocument is geüpload en leesbaar is.
              </div>
            </div>
          )}
        </div>

        <div className="divider-fade" />

        {/* Spelling */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            <SpellCheck2 className="h-3.5 w-3.5 text-ink-mute" strokeWidth={2} />
            Spellingscontrole{" "}
            <span className="font-mono font-medium text-ink-mute">
              ({fouten.length})
            </span>
          </div>
          {fouten.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-line">
              {fouten.map((fout, i) => (
                <div
                  key={`${fout.woord}-${i}`}
                  className={cn(
                    "flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
                    i > 0 && "border-t border-line/70"
                  )}
                >
                  <div className="flex items-center gap-2 sm:w-72 sm:flex-shrink-0">
                    <span className="font-mono text-[13px] font-semibold text-danger line-through decoration-danger/50">
                      {fout.woord}
                    </span>
                    {fout.suggestie && (
                      <>
                        <ChevronRight
                          className="h-3.5 w-3.5 text-ink-mute"
                          strokeWidth={2.5}
                        />
                        <span className="font-mono text-[13px] font-semibold text-success">
                          {fout.suggestie}
                        </span>
                      </>
                    )}
                  </div>
                  {fout.context && (
                    <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft">
                      {fout.context}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success-pale p-4">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 flex-shrink-0 text-success"
                strokeWidth={2}
              />
              <div className="text-sm text-ink">
                Geen spelfouten gevonden in de akte van levering.
              </div>
            </div>
          )}
        </div>

        <p className="border-t border-line/70 pt-4 font-display text-[13px] italic leading-relaxed text-ink-soft">
          Deze controle is automatisch gegenereerd en dient ter ondersteuning. De
          behandelaar blijft verantwoordelijk voor de inhoudelijke en juridische
          beoordeling van de akte.
        </p>
      </div>
    </section>
  );
}
