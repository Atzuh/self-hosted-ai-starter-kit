import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "upcoming" | "active" | "done";

export interface Step {
  label: string;
  state: StepState;
}

interface StepperProps {
  steps: Step[];
}

export function Stepper({ steps }: StepperProps) {
  return (
    <div className="hidden items-center gap-0 sm:flex">
      {steps.map((step, i) => (
        <div key={step.label} className="contents">
          <div className="flex flex-1 items-center gap-3">
            <div
              className={cn(
                "relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border font-mono text-[12px] font-semibold transition-all duration-300",
                step.state === "active" &&
                  "border-azure/60 bg-ink-deeper text-azure-glow shadow-glow",
                step.state === "done" &&
                  "border-success/60 bg-success/15 text-success",
                step.state === "upcoming" &&
                  "border-line bg-surface/60 text-ink-mute"
              )}
            >
              {step.state === "done" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : (
                i + 1
              )}
              {step.state === "active" && (
                <span className="absolute inset-0 -z-10 rounded-full bg-azure/15 animate-pulse-soft" />
              )}
            </div>
            <div className="flex flex-col leading-tight">
              <span
                className={cn(
                  "text-[10.5px] font-semibold uppercase tracking-[0.14em]",
                  step.state === "upcoming" ? "text-ink-mute" : "text-ink-soft"
                )}
              >
                Stap {i + 1}
              </span>
              <span
                className={cn(
                  "mt-1 text-[14.5px] font-semibold leading-tight tracking-[-0.005em] transition-colors",
                  step.state === "active" && "text-ink-strong",
                  step.state === "done" && "text-success",
                  step.state === "upcoming" && "text-ink-mute"
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mx-3 h-px flex-1 transition-colors duration-300",
                steps[i + 1].state === "upcoming"
                  ? "bg-line"
                  : "bg-gradient-to-r from-success to-azure"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
