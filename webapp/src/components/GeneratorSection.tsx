import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { AkteGenerator } from "@/components/AkteGenerator";
import { TestamentBouwer, type VerslagOverdracht } from "@/components/TestamentBouwer";
import type { DocumentSoort } from "@/lib/documentsoorten";

/**
 * De documentsoorten in de keuzelijst. `soort: null` = nog niet beschikbaar;
 * die staat er wel in, zodat zichtbaar is wat eraan komt. Een nieuwe flow
 * toevoegen is een regel hier plus een tak in {@link GeneratorSection}.
 */
const KEUZES: Array<{ soort: DocumentSoort | null; label: string }> = [
  { soort: "analyse", label: "Juridische analyse" },
  { soort: "akte", label: "Hypotheekakte" },
  { soort: "testament", label: "Testament" },
  { soort: null, label: "Leveringsakte (binnenkort)" },
];

const STANDAARD: DocumentSoort = "analyse";
const SOORT_SLEUTEL = "scriptor.documentsoort";

function laatsteSoort(): DocumentSoort {
  try {
    const bewaard = window.localStorage.getItem(SOORT_SLEUTEL);
    const keuze = KEUZES.find((k) => k.soort !== null && k.soort === bewaard);
    return keuze?.soort ?? STANDAARD;
  } catch {
    return STANDAARD;
  }
}

/**
 * Het Genereren-tabblad: opent meteen op een generator, met bovenaan een
 * keuzelijst om van documentsoort te wisselen. De laatst gekozen soort wordt per
 * browser onthouden.
 *
 * Komt de gebruiker hier vanuit een besprekingsverslag, dan wordt de
 * testament-bouwer geopend met dat verslag erbij. De overdracht komt van
 * App.tsx: tabs unmounten bij wisselen, dus de state moet daarboven staan.
 */
export function GeneratorSection({
  overdracht,
  onOverdrachtGebruikt,
}: {
  overdracht?: VerslagOverdracht | null;
  onOverdrachtGebruikt?: () => void;
}) {
  const [soort, setSoort] = useState<DocumentSoort>(() =>
    overdracht ? "testament" : laatsteSoort()
  );

  function kies(nieuw: DocumentSoort) {
    // Wie van het testament wegklikt is klaar met het verslag; anders zou het
    // bij terugkomst opnieuw worden ingeladen.
    if (soort === "testament" && nieuw !== "testament") onOverdrachtGebruikt?.();
    setSoort(nieuw);
    try {
      window.localStorage.setItem(SOORT_SLEUTEL, nieuw);
    } catch {
      // Privévenster of geblokkeerde opslag: de keuze geldt dan alleen nu.
    }
  }

  const kiezer = (
    <label className="mb-6 inline-flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        Documentsoort
      </span>
      <span className="relative inline-flex">
        <select
          value={soort}
          onChange={(e) => kies(e.target.value as DocumentSoort)}
          className="h-10 min-w-[240px] cursor-pointer appearance-none rounded-md border border-line-strong bg-surface pl-3 pr-9 text-sm font-medium text-ink-strong transition-colors hover:border-azure/50 focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15"
        >
          {KEUZES.map((keuze) => (
            <option
              key={keuze.label}
              value={keuze.soort ?? ""}
              disabled={keuze.soort === null}
            >
              {keuze.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
          strokeWidth={2}
        />
      </span>
    </label>
  );

  if (soort === "testament") {
    return <TestamentBouwer overdracht={overdracht ?? null} kiezer={kiezer} />;
  }
  // De key laat de generator opnieuw beginnen bij een andere soort: het
  // resultaat van een akte hoort niet onder een analyse te blijven staan.
  return <AkteGenerator key={soort} mode={soort} kiezer={kiezer} />;
}
