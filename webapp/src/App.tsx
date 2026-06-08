import { useState } from "react";

import { AkteGenerator } from "@/components/AkteGenerator";
import { AkteControle } from "@/components/AkteControle";
import { TemplatesManager } from "@/components/TemplatesManager";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";

export type AppPage = "controle" | "generator" | "templates";

const CURRENT_USER = {
  name: "J. de Vries",
  role: "Notarieel medewerker",
  initials: "JV",
};

export default function App() {
  const [page, setPage] = useState<AppPage>("generator");

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader
        user={CURRENT_USER}
        environment="Intern · DEV"
        currentPage={page}
        onNavigate={setPage}
      />

      <main className="flex-1">
        {page === "controle" && <AkteControle />}
        {page === "generator" && <AkteGenerator />}
        {page === "templates" && <TemplatesManager />}
      </main>

      <AppFooter
        version="0.1.0"
        template="Multi-bank"
        n8nStatus="online"
      />
    </div>
  );
}
