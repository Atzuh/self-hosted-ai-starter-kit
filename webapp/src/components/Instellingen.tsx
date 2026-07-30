import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2, RotateCcw, Save, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const GET_URL = "http://localhost:5678/webhook/kantoor";
const SAVE_URL = "http://localhost:5678/webhook/kantoor-save";

interface KantoorConfig {
  notaris_naam: string;
  notaris_standplaats: string;
  bank_volmachthouder: string;
  slot_tekst: string[];
}

const LEEG: KantoorConfig = {
  notaris_naam: "",
  notaris_standplaats: "",
  bank_volmachthouder: "",
  slot_tekst: [],
};

export function Instellingen() {
  const [naam, setNaam] = useState("");
  const [standplaats, setStandplaats] = useState("");
  const [volmachthouder, setVolmachthouder] = useState("");
  const [slot, setSlot] = useState("");
  const [initieel, setInitieel] = useState<KantoorConfig>(LEEG);
  const [laden, setLaden] = useState(false);
  const [opslaan, setOpslaan] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [opgeslagen, setOpgeslagen] = useState(false);

  const toepassen = useCallback((k: KantoorConfig) => {
    setNaam(k.notaris_naam);
    setStandplaats(k.notaris_standplaats);
    setVolmachthouder(k.bank_volmachthouder);
    setSlot((k.slot_tekst || []).join("\n"));
    setInitieel(k);
  }, []);

  const ophalen = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const res = await fetch(GET_URL);
      if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
      const data = await res.json();
      toepassen({
        notaris_naam: String(data?.kantoor?.notaris_naam ?? ""),
        notaris_standplaats: String(data?.kantoor?.notaris_standplaats ?? ""),
        bank_volmachthouder: String(data?.kantoor?.bank_volmachthouder ?? ""),
        slot_tekst: Array.isArray(data?.kantoor?.slot_tekst) ? data.kantoor.slot_tekst : [],
      });
    } catch (err) {
      setFout(
        `Kon instellingen niet laden: ${err instanceof Error ? err.message : String(err)}. Draait n8n op poort 5678?`
      );
    } finally {
      setLaden(false);
    }
  }, [toepassen]);

  useEffect(() => {
    ophalen();
  }, [ophalen]);

  const gewijzigd =
    naam !== initieel.notaris_naam ||
    standplaats !== initieel.notaris_standplaats ||
    volmachthouder !== initieel.bank_volmachthouder ||
    slot !== (initieel.slot_tekst || []).join("\n");

  const opslaanNaarServer = useCallback(async () => {
    setOpslaan(true);
    setFout(null);
    setOpgeslagen(false);
    const payload: KantoorConfig = {
      notaris_naam: naam.trim(),
      notaris_standplaats: standplaats.trim(),
      bank_volmachthouder: volmachthouder.trim(),
      slot_tekst: slot.split("\n").map((r) => r).filter((r) => r.trim() !== ""),
    };
    try {
      // form-urlencoded 'data' veld: simpele content-type, geen CORS-preflight.
      const res = await fetch(SAVE_URL, {
        method: "POST",
        body: new URLSearchParams({ data: JSON.stringify(payload) }),
      });
      if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || "Onbekende serverfout");
      toepassen({
        notaris_naam: String(data.kantoor?.notaris_naam ?? payload.notaris_naam),
        notaris_standplaats: String(data.kantoor?.notaris_standplaats ?? payload.notaris_standplaats),
        bank_volmachthouder: String(data.kantoor?.bank_volmachthouder ?? payload.bank_volmachthouder),
        slot_tekst: Array.isArray(data.kantoor?.slot_tekst) ? data.kantoor.slot_tekst : payload.slot_tekst,
      });
      setOpgeslagen(true);
      window.setTimeout(() => setOpgeslagen(false), 3000);
    } catch (err) {
      setFout(`Opslaan mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpslaan(false);
    }
  }, [naam, standplaats, slot, toepassen]);

  return (
    <div className="mx-auto max-w-[860px] px-4 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-medium leading-tight tracking-tight text-ink-strong">
          Instellingen
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Kantoor-specifieke standaardwaarden die in elke gegenereerde akte worden ingevuld.
        </p>
      </header>

      {fout && (
        <div className="mb-5 rounded-md border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {fout}
        </div>
      )}

      {laden ? (
        <div className="flex items-center gap-2 py-16 text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Instellingen laden…</span>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Notaris */}
          <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
              <Building2 className="h-4 w-4 text-azure" strokeWidth={2} />
              <h2 className="text-[15px] font-semibold text-ink-strong">Notaris</h2>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Veld
                label="Naam notaris"
                hint="Zoals in de aanhef: 'verschenen voor mij, …, notaris'."
              >
                <Input
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                  placeholder="mr. Voornaam Achternaam"
                />
              </Veld>
              <Veld label="Plaats van vestiging" hint="Bijv. Altena.">
                <Input
                  value={standplaats}
                  onChange={(e) => setStandplaats(e.target.value)}
                  placeholder="Altena"
                />
              </Veld>
              <div className="sm:col-span-2">
                <Veld
                  label="Gevolmachtigde van de bank"
                  hint="Kantoormedewerker die namens de bank compareert. Laat leeg om het per akte handmatig in te vullen — het veld wordt dan geel gearceerd in de akte."
                >
                  <Input
                    value={volmachthouder}
                    onChange={(e) => setVolmachthouder(e.target.value)}
                    placeholder="mevrouw Voornaam Achternaam"
                  />
                </Veld>
              </div>
            </div>
          </section>

          {/* Slottekst */}
          <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
              <ScrollText className="h-4 w-4 text-azure" strokeWidth={2} />
              <h2 className="text-[15px] font-semibold text-ink-strong">Slottekst</h2>
            </div>
            <div className="p-5">
              <Veld
                label="Slotbepalingen"
                hint="Eén regel per zin; elke regel wordt een aparte alinea onder 'Slot'. De passeerplaats staat vast in de tekst; laat het ondertekentijdstip open."
              >
                <textarea
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  className={cn(
                    "flex w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink-strong placeholder:text-ink-mute transition-colors",
                    "focus-visible:outline-none focus-visible:border-azure focus-visible:ring-4 focus-visible:ring-azure/15"
                  )}
                  placeholder={"Deze akte is verleden te …\nDe verschenen personen zijn mij, notaris, bekend …"}
                />
              </Veld>
            </div>
          </section>

          {/* Acties */}
          <div className="flex items-center justify-end gap-3 pt-1">
            {opgeslagen && (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-seal-deep">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                Opgeslagen
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => toepassen(initieel)}
              disabled={!gewijzigd || opslaan}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Herstellen
            </Button>
            <Button type="button" onClick={opslaanNaarServer} disabled={!gewijzigd || opslaan}>
              {opslaan ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Save className="h-4 w-4" strokeWidth={2} />
              )}
              Opslaan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Veld({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-ink-strong">{label}</label>
      {children}
      {hint && <p className="text-[11.5px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}
