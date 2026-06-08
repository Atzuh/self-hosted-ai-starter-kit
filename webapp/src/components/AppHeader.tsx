import {
  Bell,
  Command,
  FileText,
  LayoutTemplate,
  Search,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { AppPage } from "@/App";

interface AppHeaderProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
}

const NAV_ITEMS: Array<{
  id: AppPage;
  label: string;
  icon: typeof FileText;
}> = [
  { id: "controle", label: "Controle", icon: ShieldCheck },
  { id: "generator", label: "Genereren", icon: FileText },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
];

export function AppHeader({
  currentPage,
  onNavigate,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-8">
        {/* Wordmark */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("generator");
          }}
          className="group flex items-center gap-3"
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-ink-deeper shadow-card">
            <span className="font-display text-[19px] font-medium leading-none text-ink-strong">
              S
            </span>
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-seal shadow-[0_0_10px_hsl(var(--seal))]" />
          </div>
          <div className="hidden flex-col leading-tight sm:flex">
            <div className="font-display text-[19px] font-medium leading-none tracking-tight text-ink-strong">
              Scriptor
            </div>
            <div className="mt-1 font-sans text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-soft">
              De Rivieren Notarissen
            </div>
          </div>
        </a>

        <div className="hidden h-5 w-px bg-line sm:block" />

        {/* Navigatie */}
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === currentPage;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "group relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-all",
                  active
                    ? "text-ink-strong"
                    : "text-ink-soft hover:text-ink-strong"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    active ? "text-azure" : "text-ink-mute group-hover:text-ink"
                  )}
                  strokeWidth={2}
                />
                {item.label}
                {active && (
                  <span className="absolute inset-x-2.5 -bottom-[15px] h-0.5 rounded-full bg-azure shadow-[0_0_10px_hsl(var(--azure))]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Cmd-K-stijl search */}
        <div className="ml-auto hidden flex-1 items-center justify-end gap-2 lg:flex lg:max-w-md">
          <div className="relative w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
              strokeWidth={2}
            />
            <input
              type="search"
              placeholder="Zoek dossier, cliënt, akte…"
              className="h-9 w-full rounded-md border border-line bg-surface/60 pl-9 pr-14 text-[13px] text-ink-strong placeholder:text-ink-mute transition-colors hover:border-line-strong focus:border-azure focus:bg-surface focus:outline-none focus:ring-4 focus:ring-azure/15"
            />
            <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-soft">
              <Command className="h-2.5 w-2.5" strokeWidth={2.25} />K
            </div>
          </div>
        </div>

        {/* Notificatie */}
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-ink-strong"
            aria-label="Notificaties"
          >
            <Bell className="h-4 w-4" strokeWidth={2} />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-seal" />
          </button>
        </div>
      </div>
    </header>
  );
}
