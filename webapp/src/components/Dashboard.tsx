import { ArrowRight, FileText, LayoutTemplate, Mic, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AppPage } from "@/App";

interface DashboardProps {
  onNavigate: (page: AppPage) => void;
}

type Accent = "azure" | "seal" | "groen" | "ink";

interface QuickAction {
  page: AppPage;
  title: string;
  description: string;
  icon: typeof FileText;
  accent: Accent;
}

const ACTIONS: QuickAction[] = [
  {
    page: "generator",
    title: "Genereren",
    description:
      "Stel een nieuwe hypotheekakte of juridische analyse op uit een dossier.",
    icon: FileText,
    accent: "azure",
  },
  {
    page: "besprekingen",
    title: "Besprekingen",
    description:
      "Neem een bespreking op en laat er een verslag van maken, geordend per onderwerp.",
    icon: Mic,
    accent: "groen",
  },
  {
    page: "controle",
    title: "Controleren",
    description:
      "Toets een bestaand concept-akte op juridische aandachtspunten.",
    icon: ShieldCheck,
    accent: "seal",
  },
  {
    page: "templates",
    title: "Templates",
    description:
      "Bekijk en onderhoud de bank-templates die Scriptor gebruikt.",
    icon: LayoutTemplate,
    accent: "ink",
  },
];

// Groen en niet amber voor Besprekingen: --amber (38°) en --seal (36°) liggen in
// de palettedefinitie vrijwel op dezelfde tint, dus naast de gouden Controleren-
// kaart zou dat niet als een eigen kleur lezen.
const ACCENT_ICON: Record<Accent, string> = {
  azure: "border-azure/50 bg-ink-deeper text-azure-glow",
  seal: "border-seal/40 bg-ink-deeper text-seal",
  groen: "border-success/50 bg-ink-deeper text-success",
  ink: "border-line bg-ink-deeper text-ink-soft",
};

export function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Hero */}
      <section className="mb-10 animate-fade-up">
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            <span className="h-1 w-1 rounded-full bg-seal" />
            Overzicht
          </span>
          <span className="font-mono text-[11px] text-ink-mute">
            {new Date().toLocaleDateString("nl-NL", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>
        <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[60px]">
          Waarmee aan de slag?
        </h1>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink">
          Kies een actie om te beginnen.
        </p>
      </section>

      {/* Snelacties */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ACTIONS.map((action) => (
          <ActionCard key={action.page} action={action} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function ActionCard({
  action,
  onNavigate,
}: {
  action: QuickAction;
  onNavigate: (page: AppPage) => void;
}) {
  const { page, title, description, icon: Icon, accent } = action;

  return (
    <button
      type="button"
      onClick={() => onNavigate(page)}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface p-6 text-left shadow-card transition-all animate-fade-up hover:-translate-y-0.5 hover:border-azure/50 hover:shadow-glow"
    >
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
        <ArrowRight className="h-4 w-4 text-ink-mute transition-all group-hover:translate-x-0.5 group-hover:text-azure" />
      </h2>

      <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-ink-soft">
        {description}
      </p>
    </button>
  );
}
