import {
  FileText,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  Mic,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import type { AppPage } from "@/App";

interface AppSidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
}

const NAV_ITEMS: Array<{
  id: AppPage;
  label: string;
  icon: typeof FileText;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "dossiers", label: "Dossiers", icon: FolderOpen },
  { id: "controle", label: "Controle", icon: ShieldCheck },
  { id: "generator", label: "Genereren", icon: FileText },
  { id: "besprekingen", label: "Besprekingen", icon: Mic },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
];

// Zijbalk vanaf md; op smalle schermen een horizontaal scrollbare strook onder de header.
export function AppSidebar({ currentPage, onNavigate }: AppSidebarProps) {
  return (
    <aside className="sticky top-14 z-20 flex flex-shrink-0 items-center border-b border-line/80 bg-paper/85 backdrop-blur-md md:h-[calc(100vh-3.5rem)] md:w-52 md:flex-col md:items-stretch md:self-start md:border-b-0 md:border-r">
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 py-2 md:flex-col md:overflow-y-auto md:overflow-x-visible md:py-5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.id === currentPage;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                "group relative flex flex-shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-all",
                active
                  ? "bg-wash text-ink-strong"
                  : "text-ink-soft hover:bg-wash/60 hover:text-ink-strong"
              )}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-azure shadow-[0_0_10px_hsl(var(--azure))] md:block" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-azure" : "text-ink-mute group-hover:text-ink"
                )}
                strokeWidth={2}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Instellingen + thema-schakelaar */}
      <div className="flex flex-shrink-0 items-center gap-2 px-3 py-2 md:border-t md:border-line/80 md:py-3">
        <button
          type="button"
          onClick={() => onNavigate("instellingen")}
          aria-label="Instellingen"
          title="Instellingen"
          aria-current={currentPage === "instellingen" ? "page" : undefined}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md transition-all",
            currentPage === "instellingen"
              ? "bg-wash text-azure"
              : "text-ink-mute hover:bg-wash/60 hover:text-ink-strong"
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={2} />
        </button>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const light = theme === "light";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label="Lichte weergave"
      title={light ? "Schakel naar donkere weergave" : "Schakel naar lichte weergave"}
      onClick={() => setTheme(light ? "dark" : "light")}
      className="relative flex h-7 w-[52px] flex-shrink-0 items-center rounded-full border border-line-strong bg-wash transition-colors hover:border-ink-mute focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/20"
    >
      <Moon
        className="absolute left-[7px] h-3 w-3 text-ink-mute"
        strokeWidth={2.25}
      />
      <Sun
        className="absolute right-[7px] h-3 w-3 text-ink-mute"
        strokeWidth={2.25}
      />
      <span
        className={cn(
          "absolute left-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-surface text-ink-strong shadow-card transition-transform duration-200",
          light && "translate-x-6"
        )}
      >
        {light ? (
          <Sun className="h-3 w-3 text-seal" strokeWidth={2.5} />
        ) : (
          <Moon className="h-3 w-3 text-azure" strokeWidth={2.5} />
        )}
      </span>
    </button>
  );
}
