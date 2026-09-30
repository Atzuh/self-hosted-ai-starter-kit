import { useState } from "react";

import { Dashboard } from "@/components/Dashboard";
import { GeneratorSection } from "@/components/GeneratorSection";
import { AkteControle } from "@/components/AkteControle";
import { Besprekingen } from "@/components/Besprekingen";
import { TemplatesManager } from "@/components/TemplatesManager";
import { Instellingen } from "@/components/Instellingen";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";
import type { VerslagOverdracht } from "@/components/TestamentBouwer";

export type AppPage =
  | "dashboard"
  | "controle"
  | "generator"
  | "besprekingen"
  | "templates"
  | "instellingen";

export default function App() {
  const [page, setPage] = useState<AppPage>("dashboard");
  /**
   * Verslag dat vanuit Besprekingen naar de testament-bouwer gaat. Staat hier
   * omdat de tabs conditioneel worden gerenderd: bij het wisselen unmount
   * Besprekingen en zou zijn eigen state verdwijnen.
   */
  const [overdracht, setOverdracht] = useState<VerslagOverdracht | null>(null);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader
        currentPage={page}
        onNavigate={setPage}
      />

      <main className="flex-1">
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "controle" && <AkteControle />}
        {page === "generator" && (
          <GeneratorSection
            overdracht={overdracht}
            onOverdrachtGebruikt={() => setOverdracht(null)}
          />
        )}
        {page === "besprekingen" && (
          <Besprekingen
            onNaarTestament={(o) => {
              setOverdracht(o);
              setPage("generator");
            }}
          />
        )}
        {page === "templates" && <TemplatesManager />}
        {page === "instellingen" && <Instellingen />}
      </main>

      <AppFooter
        version="0.1.0"
        template="Multi-bank"
        n8nStatus="online"
      />
    </div>
  );
}
