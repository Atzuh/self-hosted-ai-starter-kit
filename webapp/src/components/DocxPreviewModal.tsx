import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";

/**
 * Toont een .docx in de browser. Gebruikt door de banktemplates én door de
 * bespreekformulieren waar een sjabloon van is afgeleid; vandaar dat hij niets
 * van banken of sjablonen weet en alleen een URL krijgt.
 */
export interface DocxPreviewDoel {
  titel: string;
  bestandsnaam: string;
  url: string;
}

export function DocxPreviewModal({
  doel,
  onClose,
}: {
  doel: DocxPreviewDoel;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    let afgebroken = false;
    setHtml(null);
    setFout(null);

    (async () => {
      try {
        const res = await fetch(doel.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const arrayBuffer = await res.arrayBuffer();
        // mammoth (~500 KB) pas laden wanneer de gebruiker daadwerkelijk een
        // preview opent — houdt de initiële bundel klein.
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!afgebroken) setHtml(result.value);
      } catch (err) {
        if (!afgebroken) setFout(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      afgebroken = true;
    };
  }, [doel.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-tight text-ink-strong">
              {doel.titel}
            </div>
            <div className="mt-0.5 break-all font-mono text-[11px] text-ink-soft">
              {doel.bestandsnaam}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <a
              href={doel.url}
              download={doel.bestandsnaam}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-wash hover:text-ink-strong"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Sluiten"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-ink-strong"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-wash/40 p-5">
          {!html && !fout && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-soft">
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
              Document laden…
            </div>
          )}
          {fout && (
            <div className="py-16 text-center text-sm">
              <div className="text-danger">Kon document niet laden.</div>
              <div className="mt-1 font-mono text-[11px] text-ink-soft">{fout}</div>
            </div>
          )}
          {html && (
            <div className="mx-auto max-w-2xl rounded-md bg-white p-8 shadow-card">
              <div
                className="docx-preview text-[13px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
