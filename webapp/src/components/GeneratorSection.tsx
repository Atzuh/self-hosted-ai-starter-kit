import { useState } from "react";

import { AkteGenerator } from "@/components/AkteGenerator";
import type { GenerationMode } from "@/components/AkteGenerator";
import { GeneratorHub } from "@/components/GeneratorHub";

/**
 * Het Genereren-tabblad: eerst een card-keuze (hub), daarna de generator voor
 * de gekozen documentsoort. `mode === null` = hub tonen.
 */
export function GeneratorSection() {
  const [mode, setMode] = useState<GenerationMode | null>(null);

  if (mode === null) {
    return <GeneratorHub onSelect={setMode} />;
  }
  return <AkteGenerator mode={mode} onBack={() => setMode(null)} />;
}
