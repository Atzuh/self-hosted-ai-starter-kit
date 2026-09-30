import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Highlighter } from "lucide-react";

import { cn } from "@/lib/utils";

interface AktePreviewProps {
  /** URL naar de HTML-preview van de gegenereerde akte (met arceringen). */
  url: string;
  /** Bestandsnaam, voor de kop. */
  filename?: string;
}

/**
 * Toont de gegenereerde akte inline als voorbeeld. De preview is een door de
 * backend gerenderde HTML-versie (zelfde tekst als de .docx) waarin de nog te
 * controleren/invullen velden geel gearceerd zijn. Weergave in een iframe zodat
 * de akte-styling geïsoleerd blijft van de app.
 */
export function AktePreview({ url, filename }: AktePreviewProps) {
  const [open, setOpen] = useState(true);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5 text-left transition-colors hover:bg-wash/40"
      >
        <FileText className="h-4 w-4 flex-shrink-0 text-azure" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink-strong">Voorbeeld akte</div>
          {filename && (
            <div className="truncate font-mono text-[11.5px] text-ink-soft">{filename}</div>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-seal/40 bg-seal/10 px-2 py-1 text-[11px] font-medium text-seal-deep">
          <Highlighter className="h-3 w-3" strokeWidth={2} />
          Geel = nog controleren / invullen
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2.25} />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2.25} />
        )}
      </button>

      {open && (
        <div className="bg-wash/40 p-3 sm:p-4">
          <iframe
            key={url}
            src={url}
            title="Akte-voorbeeld"
            className={cn(
              "h-[720px] w-full rounded-md border border-line bg-white",
              "shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
            )}
          />
        </div>
      )}
    </section>
  );
}
