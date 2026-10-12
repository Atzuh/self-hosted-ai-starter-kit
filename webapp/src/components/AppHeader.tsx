import { LogoMark } from "@/components/LogoMark";
import type { AppPage } from "@/App";

interface AppHeaderProps {
  onNavigate: (page: AppPage) => void;
}

export function AppHeader({ onNavigate }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
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
      </div>
    </header>
  );
}
