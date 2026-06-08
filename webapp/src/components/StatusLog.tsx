import { useEffect, useRef } from "react";
import { CheckCircle2, AlertCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export type LogKind = "info" | "success" | "error";

export interface LogEntry {
  id: number;
  time: string;
  text: string;
  kind: LogKind;
}

export type StatusState = "running" | "done" | "error";

interface StatusLogProps {
  state: StatusState;
  title: string;
  entries: LogEntry[];
}

export function StatusLog({ state, title, entries }: StatusLogProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  const StateIcon =
    state === "running" ? Activity : state === "done" ? CheckCircle2 : AlertCircle;

  return (
    <div className="overflow-hidden rounded-lg border border-line-dark dark-panel shadow-card-hover animate-fade-up">
      {/* Terminal header */}
      <div className="flex items-center justify-between border-b border-line-dark/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
          </div>
          <div className="hidden h-3.5 w-px bg-line-dark sm:block" />
          <div className="flex items-center gap-2">
            <StateIcon
              className={cn(
                "h-3.5 w-3.5",
                state === "running" && "text-azure-glow animate-pulse",
                state === "done" && "text-success",
                state === "error" && "text-danger"
              )}
              strokeWidth={2.25}
            />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper/80">
              {title}
            </span>
          </div>
        </div>
        <div className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-paper/40 sm:block">
          scriptor · n8n
        </div>
      </div>

      <div
        ref={logRef}
        className="max-h-[280px] min-h-[100px] overflow-auto bg-grid-dark p-5 font-mono text-[12.5px] leading-relaxed"
      >
        {entries.length === 0 && (
          <div className="text-paper/40">$ waiting for pipeline…</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex animate-fade-in gap-3 opacity-0 py-0.5"
          >
            <span className="flex-shrink-0 select-none text-azure-glow/80">
              {entry.time}
            </span>
            <span className="flex-shrink-0 select-none text-paper/30">›</span>
            <span
              className={cn(
                entry.kind === "info" && "text-paper/90",
                entry.kind === "success" && "text-success",
                entry.kind === "error" && "text-danger"
              )}
            >
              {entry.text}
            </span>
          </div>
        ))}
        {state === "running" && (
          <div className="mt-1 flex items-center gap-1 text-paper/60">
            <span className="inline-block h-3 w-[6px] animate-pulse bg-azure-glow" />
          </div>
        )}
      </div>
    </div>
  );
}
