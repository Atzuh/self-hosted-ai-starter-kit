import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecentAkte {
  id: string;
  filename: string;
  type: string;
  client: string;
  generatedAt: string;
  status: "gereed" | "controle" | "fout";
  downloadUrl?: string;
}

interface RecentAktesProps {
  items: RecentAkte[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

const STATUS_STYLES: Record<RecentAkte["status"], string> = {
  gereed: "border-success/40 bg-success/8 text-success",
  controle: "border-seal/40 bg-seal/10 text-seal-deep",
  fout: "border-danger/40 bg-danger/8 text-danger",
};

const STATUS_LABEL: Record<RecentAkte["status"], string> = {
  gereed: "Gereed",
  controle: "In controle",
  fout: "Fout",
};

export function RecentAktes({
  items,
  isLoading = false,
  error = null,
  onRefresh,
}: RecentAktesProps) {
  return (
    <aside className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line/70 px-5 py-4">
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.005em] text-ink-strong">
            Recente aktes
          </h3>
          <p className="mt-0.5 text-[11.5px] text-ink-soft">
            Uit shared/output
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-soft transition-colors hover:text-ink-strong disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
            )}
            Vernieuwen
          </button>
        )}
      </div>
      <ul className="divide-y divide-line/60">
        {isLoading && items.length === 0 && (
          <li className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Laden…
          </li>
        )}
        {!isLoading && error && (
          <li className="px-5 py-8 text-center text-sm text-ink-soft">
            <div className="text-danger">Kon recente aktes niet laden.</div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">{error}</div>
          </li>
        )}
        {!isLoading && !error && items.length === 0 && (
          <li className="px-5 py-8 text-center text-sm text-ink-soft">
            Nog geen aktes gegenereerd.
          </li>
        )}
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.downloadUrl ?? "#"}
              className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-wash/40"
            >
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line bg-ink-deeper text-ink-soft transition-colors group-hover:border-azure/50 group-hover:text-azure-glow">
                <FileText className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[13.5px] font-semibold leading-tight tracking-[-0.005em] text-ink-strong">
                    {item.type}
                  </div>
                  <div className="font-mono text-[10.5px] text-ink-soft">
                    {item.generatedAt}
                  </div>
                </div>
                <div
                  className="mt-1 truncate font-mono text-[11.5px] text-ink-soft"
                  title={item.filename}
                >
                  {item.filename}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]",
                      STATUS_STYLES[item.status]
                    )}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  {item.downloadUrl && (
                    <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10.5px] text-ink-soft transition-colors group-hover:text-azure">
                      <Download className="h-3 w-3" strokeWidth={2} />
                      .docx
                    </span>
                  )}
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
