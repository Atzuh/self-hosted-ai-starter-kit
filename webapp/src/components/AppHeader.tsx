import {
  FileText,
  LayoutDashboard,
  LayoutTemplate,
  Mic,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
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
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "controle", label: "Controle", icon: ShieldCheck },
  { id: "generator", label: "Genereren", icon: FileText },
  { id: "besprekingen", label: "Besprekingen", icon: Mic },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "instellingen", label: "Instellingen", icon: Settings },
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
            onNavigate("dashboard");
          }}
          className="group flex items-center gap-3"
        >
          <LogoMark />
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

        {/* Thema-schakelaar */}
        <div className="ml-auto flex items-center">
          <ThemeToggle />
        </div>
      </div>
    </header>
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
