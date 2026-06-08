import { ShieldCheck } from "lucide-react";

interface AppFooterProps {
  version?: string;
  template?: string;
  n8nStatus?: "online" | "offline";
}

export function AppFooter({
  version = "0.1.0",
  template = "HYRABO00 · H1-2018",
  n8nStatus = "online",
}: AppFooterProps) {
  const isOnline = n8nStatus === "online";

  return (
    <footer className="mt-auto border-t border-line/80 bg-paper/60">
      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-2 px-4 py-3.5 text-[11.5px] text-ink-soft sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <ShieldCheck
              className="h-3.5 w-3.5 text-success"
              strokeWidth={2}
            />
            <span className="font-medium">
              Intern gebruik · vertrouwelijk
            </span>
          </div>
          <div className="hidden h-3 w-px bg-line sm:block" />
          <div className="font-mono text-ink">Template · {template}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              {isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  isOnline ? "bg-success" : "bg-danger"
                }`}
              />
            </span>
            <span className="font-medium">n8n · {n8nStatus}</span>
          </div>
          <div className="hidden h-3 w-px bg-line sm:block" />
          <div className="font-mono text-ink-soft">Scriptor v{version}</div>
        </div>
      </div>
    </footer>
  );
}
