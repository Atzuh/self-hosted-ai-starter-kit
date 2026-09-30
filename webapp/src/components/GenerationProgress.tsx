import { AlertCircle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ProgressState = "running" | "done" | "error";

interface GenerationProgressProps {
  /** Labels van de drie fasen, in volgorde. */
  phases: string[];
  /** Index van de fase die nu (naar schatting) draait. */
  phase: number;
  state: ProgressState;
  errorMessage?: string | null;
}

/**
 * Rustige voortgangsweergave met een spinner en de drie echte pijplijn-fasen.
 * De backend levert één webhook-antwoord zonder tussentijds signaal, dus de
 * fase-overgang is een tijdsschatting; bij binnenkomst van het echte antwoord
 * springt alles naar 'klaar'. Geen valse per-regel-log meer.
 */
export function GenerationProgress({
  phases,
  phase,
  state,
  errorMessage,
}: GenerationProgressProps) {
  const title =
    state === "done" ? "Gereed" : state === "error" ? "Er ging iets mis" : "Bezig…";

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <div className="flex items-center gap-3 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        {state === "running" && (
          <Loader2 className="h-4 w-4 animate-spin text-azure" strokeWidth={2.25} />
        )}
        {state === "done" && (
          <Check className="h-4 w-4 text-success" strokeWidth={2.5} />
        )}
        {state === "error" && (
          <AlertCircle className="h-4 w-4 text-danger" strokeWidth={2.25} />
        )}
        <span className="text-[15px] font-semibold text-ink-strong">{title}</span>
      </div>

      <ol className="space-y-1 p-4">
        {phases.map((label, i) => {
          const done = state === "done" || i < phase;
          const active = state === "running" && i === phase;
          const failed = state === "error" && i === phase;
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
                active && "bg-azure/5"
              )}
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {done ? (
                  <Check className="h-4 w-4 text-success" strokeWidth={2.5} />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-azure" strokeWidth={2.25} />
                ) : failed ? (
                  <AlertCircle className="h-4 w-4 text-danger" strokeWidth={2.25} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              <span
                className={cn(
                  "text-sm",
                  done && "text-ink-soft",
                  active && "font-medium text-ink-strong",
                  !done && !active && !failed && "text-ink-mute",
                  failed && "font-medium text-danger"
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {state === "error" && errorMessage && (
        <div className="border-t border-line/70 px-5 py-3 text-[13px] text-danger">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
