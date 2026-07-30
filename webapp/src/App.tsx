import { useState } from "react";

import { Dashboard } from "@/components/Dashboard";
import { GeneratorSection } from "@/components/GeneratorSection";
import { AkteControle } from "@/components/AkteControle";
import { TemplatesManager } from "@/components/TemplatesManager";
import { Instellingen } from "@/components/Instellingen";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";

export type AppPage = "dashboard" | "controle" | "generator" | "templates" | "instellingen";

export default function App() {
  const [page, setPage] = useState<AppPage>("dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader
        currentPage={page}
        onNavigate={setPage}
      />

      <main className="flex-1">
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "controle" && <AkteControle />}
        {page === "generator" && <GeneratorSection />}
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
