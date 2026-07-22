import { ArrowRight, FileSignature, FileText, Scale } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GenerationMode } from "@/components/AkteGenerator";

/**
 * Keuze-overzicht van het Genereren-tabblad. De gebruiker kiest via cards
 * welk document Scriptor opstelt. Nu: hypotheekakte of juridische analyse.
 * Uitbreidbaar met nieuwe documentsoorten (bijv. leveringsakte) door een
 * entry aan {@link CHOICES} toe te voegen.
 */

interface GeneratorHubProps {
  onSelect: (mode: GenerationMode) => void;
}

type Accent = "azure" | "seal" | "ink";

interface GeneratorChoice {
  /** Zet op een `GenerationMode` als de flow beschikbaar is; `null` = binnenkort. */
  mode: GenerationMode | null;
  title: string;
  description: string;
  icon: typeof FileText;
  accent: Accent;
  /** Losse trefwoorden die tonen wat de flow oplevert. */
  points: string[];
}

const CHOICES: GeneratorChoice[] = [
  {
    mode: "akte",
    title: "Hypotheekakte",
    description:
      "Genereer een concept-hypotheekakte uit het dossier. Scriptor leest de passeeropdracht en het kadaster en vult de bank-template.",
    icon: FileText,
    accent: "azure",
    points: ["Bank-template", "Automatische extractie", "Word (.docx)"],
  },
  {
    mode: "analyse",
    title: "Juridische analyse",
    description:
      "Laat de stukken juridisch nalezen. Levert een eerste-lezing met aandachtspunten — werkt al vanaf één enkel document.",
    icon: Scale,
    accent: "seal",
    points: ["Vier specialisten", "Aandachtspunten", "Vanaf 1 stuk"],
  },
  {
    mode: null,
    title: "Leveringsakte",
    description:
      "Stel een concept-leveringsakte op uit de koopovereenkomst en het dossier. In ontwikkeling.",
    icon: FileSignature,
    accent: "ink",
    points: ["Koopovereenkomst", "Binnenkort"],
  },
];

const ACCENT_ICON: Record<Accent, string> = {
  azure: "border-azure/50 bg-ink-deeper text-azure-glow",
  seal: "border-seal/40 bg-ink-deeper text-seal",
  ink: "border-line bg-ink-deeper text-ink-soft",
};

export function GeneratorHub({ onSelect }: GeneratorHubProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Hero */}
      <section className="mb-10 animate-fade-up">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            <span className="h-1 w-1 rounded-full bg-seal" />
            Genereren
          </span>
          <span className="font-mono text-[11px] text-ink-mute">
            {new Date().toLocaleDateString("nl-NL", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[60px]">
          Wat wil je opstellen?
        </h1>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink">
          Kies een documentsoort. Daarna sleep je het dossier in en stelt
          Scriptor het concept voor je op.
        </p>
      </section>

      {/* Keuze-cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CHOICES.map((choice) => (
          <ChoiceCard key={choice.title} choice={choice} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function ChoiceCard({
  choice,
  onSelect,
}: {
  choice: GeneratorChoice;
  onSelect: (mode: GenerationMode) => void;
}) {
  const { mode, title, description, icon: Icon, accent, points } = choice;
  const available = mode !== null;

  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => available && onSelect(mode)}
      className={cn(
        "group relative flex h-full flex-col rounded-lg border bg-surface p-6 text-left shadow-card transition-all animate-fade-up",
        available
          ? "border-line hover:-translate-y-0.5 hover:border-azure/50 hover:shadow-glow"
          : "cursor-not-allowed border-dashed border-line/70 opacity-70"
      )}
      aria-disabled={!available}
    >
      {!available && (
        <span className="absolute right-4 top-4 rounded-sm border border-line-strong bg-paper px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Binnenkort
        </span>
      )}

      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-md border transition-colors",
          ACCENT_ICON[accent]
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>

      <h2 className="mt-4 flex items-center gap-1.5 text-[19px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong">
        {title}
        {available && (
          <ArrowRight className="h-4 w-4 text-ink-mute transition-all group-hover:translate-x-0.5 group-hover:text-azure" />
        )}
      </h2>

      <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-ink-soft">
        {description}
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {points.map((p) => (
          <span
            key={p}
            className="inline-flex items-center rounded-sm border border-line bg-paper/50 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-mute"
          >
            {p}
          </span>
        ))}
      </div>
    </button>
  );
}
