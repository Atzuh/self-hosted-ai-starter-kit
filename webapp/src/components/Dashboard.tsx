import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FileText, LayoutTemplate, Mic, ShieldCheck } from "lucide-react";

import { KantoorVragen, KantoorVragenBeta } from "@/components/KantoorVragen";
import { NotamailPaneel } from "@/components/NotamailPaneel";
import { haalDashboard, useNaam, type Notamail, type Vraag } from "@/lib/dashboard";
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

// Zo vaak halen we Notamail en vragen opnieuw op, zodat een reactie van een
// collega zonder verversen in beeld komt.
const VERVERS_MS = 60_000;

// De vragen staan in bèta en zijn nog niet open voor gebruikers. Op true
// zetten maakt het paneel bruikbaar; de workflow erachter draait al.
const VRAGEN_OPEN: boolean = false;

export function Dashboard({ onNavigate }: DashboardProps) {
  const [notamail, setNotamail] = useState<Notamail | null>(null);
  const [vragen, setVragen] = useState<Vraag[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [naam, setNaam] = useNaam();

  const ophalen = useCallback(async () => {
    try {
      const data = await haalDashboard();
      setNotamail(data.notamail);
      setVragen(data.vragen);
      setFout(null);
    } catch (err) {
      setFout(
        `Kon het dashboard niet laden: ${err instanceof Error ? err.message : String(err)}. Draait n8n op poort 5678?`
      );
    }
  }, []);

  useEffect(() => {
    ophalen();
    const timer = window.setInterval(ophalen, VERVERS_MS);
    return () => window.clearInterval(timer);
  }, [ophalen]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Hero */}
      <section className="mb-8 animate-fade-up">
        <div className="mb-4 flex items-center gap-3">
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
        <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[64px]">
          Vandaag op kantoor
        </h1>
      </section>

      {/* Snelacties */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map((action) => (
          <ActionCard key={action.page} action={action} onNavigate={onNavigate} />
        ))}
      </div>

      {fout && (
        <div className="mb-5 rounded-md border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {fout}
        </div>
      )}

      {/* Notamail + vragen */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <NotamailPaneel
          notamail={notamail}
          naam={naam}
          onGeplaatst={setNotamail}
        />
        {VRAGEN_OPEN ? (
          <KantoorVragen
            vragen={vragen}
            naam={naam}
            onNaam={setNaam}
            onGewijzigd={setVragen}
          />
        ) : (
          <KantoorVragenBeta />
        )}
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
      className="group flex h-full items-start gap-3.5 rounded-lg border border-line bg-surface p-4 text-left shadow-card transition-all animate-fade-up hover:-translate-y-0.5 hover:border-azure/50 hover:shadow-glow"
    >
      <span
        className={cn(
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
          ACCENT_ICON[accent]
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>

      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink-strong">
          {title}
          <ArrowRight className="h-3.5 w-3.5 text-ink-mute transition-all group-hover:translate-x-0.5 group-hover:text-azure" />
        </span>
        <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-soft">
          {description}
        </span>
      </span>
    </button>
  );
}
