import { useState } from "react";

import { AkteGenerator } from "@/components/AkteGenerator";
import { GeneratorHub } from "@/components/GeneratorHub";
import { TestamentBouwer, type VerslagOverdracht } from "@/components/TestamentBouwer";
import type { DocumentSoort } from "@/lib/documentsoorten";

/**
 * Het Genereren-tabblad: eerst een card-keuze (hub), daarna de generator voor
 * de gekozen documentsoort. `mode === null` = hub tonen.
 *
 * Komt de gebruiker hier vanuit een besprekingsverslag, dan wordt de
 * testament-bouwer meteen geopend met dat verslag erbij. De overdracht komt van
 * App.tsx: tabs unmounten bij wisselen, dus de state moet daarboven staan.
 */
export function GeneratorSection({
  overdracht,
  onOverdrachtGebruikt,
}: {
  overdracht?: VerslagOverdracht | null;
  onOverdrachtGebruikt?: () => void;
}) {
  const [mode, setMode] = useState<DocumentSoort | null>(overdracht ? "testament" : null);

  if (mode === "testament") {
    return (
      <TestamentBouwer
        overdracht={overdracht ?? null}
        onBack={() => {
          setMode(null);
          onOverdrachtGebruikt?.();
        }}
      />
    );
  }
  if (mode === null) {
    return <GeneratorHub onSelect={setMode} />;
  }
  return <AkteGenerator mode={mode} onBack={() => setMode(null)} />;
}
