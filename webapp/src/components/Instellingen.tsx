import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  Receipt,
  RotateCcw,
  Save,
  ScrollText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const GET_URL = "http://localhost:5678/webhook/kantoor";
const SAVE_URL = "http://localhost:5678/webhook/kantoor-save";

/**
 * Kantoorbrede standaardwaarden. Zie ook shared/kantoor.json en de nodes
 * 'Read Kantoor' / 'Save Kantoor' in kantoor-instellingen-workflow.json: die
 * geven de velden expliciet door. Een nieuw veld hoort dus op drie plekken
 * tegelijk, anders komt het wel op schijf maar nooit terug in dit scherm.
 */
interface KantoorConfig {
  notaris_naam: string;
  notaris_standplaats: string;
  bank_volmachthouder: string;
  slot_tekst: string[];
  btw_percentage: number;
  offerte_geldigheidsdagen: number;
  offerte_slottekst: string[];
}

/**
 * Het formulier houdt alles als tekst bij: een lijst is een textarea met één
 * regel per item, een getal een invoerveld waarin je ook halverwege een
 * ongeldige waarde mag hebben staan. Pas bij opslaan wordt het teruggerekend.
 */
interface Vorm {
  notaris_naam: string;
  notaris_standplaats: string;
  bank_volmachthouder: string;
  slot_tekst: string;
  btw_percentage: string;
  offerte_geldigheidsdagen: string;
  offerte_slottekst: string;
}

const LEEG: KantoorConfig = {
  notaris_naam: "",
  notaris_standplaats: "",
  bank_volmachthouder: "",
  slot_tekst: [],
  btw_percentage: 21,
  offerte_geldigheidsdagen: 30,
  offerte_slottekst: [],
};

function naarVorm(k: KantoorConfig): Vorm {
  return {
    notaris_naam: k.notaris_naam,
    notaris_standplaats: k.notaris_standplaats,
    bank_volmachthouder: k.bank_volmachthouder,
    slot_tekst: (k.slot_tekst || []).join("\n"),
    btw_percentage: String(k.btw_percentage),
    offerte_geldigheidsdagen: String(k.offerte_geldigheidsdagen),
    offerte_slottekst: (k.offerte_slottekst || []).join("\n"),
  };
}

function regels(tekst: string): string[] {
  return tekst.split("\n").filter((r) => r.trim() !== "");
}

function getal(tekst: string, standaard: number): number {
  const n = Number(tekst.replace(",", "."));
  return Number.isFinite(n) ? n : standaard;
}

function naarConfig(v: Vorm): KantoorConfig {
  return {
    notaris_naam: v.notaris_naam.trim(),
    notaris_standplaats: v.notaris_standplaats.trim(),
    bank_volmachthouder: v.bank_volmachthouder.trim(),
    slot_tekst: regels(v.slot_tekst),
    btw_percentage: getal(v.btw_percentage, LEEG.btw_percentage),
    offerte_geldigheidsdagen: Math.round(
      getal(v.offerte_geldigheidsdagen, LEEG.offerte_geldigheidsdagen)
    ),
    offerte_slottekst: regels(v.offerte_slottekst),
  };
}

function lees(data: unknown): KantoorConfig {
  const k = (data as { kantoor?: Record<string, unknown> })?.kantoor ?? {};
  const lijst = (w: unknown) => (Array.isArray(w) ? w.map(String) : []);
  const nummer = (w: unknown, standaard: number) => {
    const n = Number(w);
    return Number.isFinite(n) ? n : standaard;
  };
  return {
    notaris_naam: String(k.notaris_naam ?? ""),
    notaris_standplaats: String(k.notaris_standplaats ?? ""),
    bank_volmachthouder: String(k.bank_volmachthouder ?? ""),
    slot_tekst: lijst(k.slot_tekst),
    btw_percentage: nummer(k.btw_percentage, LEEG.btw_percentage),
    offerte_geldigheidsdagen: nummer(
      k.offerte_geldigheidsdagen,
      LEEG.offerte_geldigheidsdagen
    ),
    offerte_slottekst: lijst(k.offerte_slottekst),
  };
}

export function Instellingen() {
  // Eén object in plaats van een useState per veld. Dat was hier eerder de bron
  // van een stille bug: de dependency-array van het opslaan miste een veld,
  // waardoor dat veld een oude waarde meestuurde. Met één stuk state kan dat
  // niet meer gebeuren, ook niet als er velden bij komen.
  const [vorm, setVorm] = useState<Vorm>(() => naarVorm(LEEG));
  const [initieel, setInitieel] = useState<Vorm>(() => naarVorm(LEEG));
  const [laden, setLaden] = useState(false);
  const [opslaan, setOpslaan] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [opgeslagen, setOpgeslagen] = useState(false);

  const toepassen = useCallback((k: KantoorConfig) => {
    const v = naarVorm(k);
    setVorm(v);
    setInitieel(v);
  }, []);

  function zet<K extends keyof Vorm>(veld: K, waarde: Vorm[K]) {
    setVorm((vorige) => ({ ...vorige, [veld]: waarde }));
  }

  const ophalen = useCallback(async () => {
    setLaden(true);
    setFout(null);
    try {
      const res = await fetch(GET_URL);
      if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
      toepassen(lees(await res.json()));
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

  const gewijzigd = (Object.keys(vorm) as Array<keyof Vorm>).some(
    (k) => vorm[k] !== initieel[k]
  );

  const opslaanNaarServer = useCallback(async () => {
    setOpslaan(true);
    setFout(null);
    setOpgeslagen(false);
    const payload = naarConfig(vorm);
    try {
      // form-urlencoded 'data' veld: simpele content-type, geen CORS-preflight.
      const res = await fetch(SAVE_URL, {
        method: "POST",
        body: new URLSearchParams({ data: JSON.stringify(payload) }),
      });
      if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || "Onbekende serverfout");
      // Wat de server teruggeeft is leidend: die kan een onzinnig percentage
      // hebben geweigerd en de oude waarde hebben laten staan.
      toepassen(lees(data));
      setOpgeslagen(true);
      window.setTimeout(() => setOpgeslagen(false), 3000);
    } catch (err) {
      setFout(`Opslaan mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpslaan(false);
    }
  }, [vorm, toepassen]);

  return (
    <div className="mx-auto max-w-[860px] px-4 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-medium leading-tight tracking-tight text-ink-strong">
          Instellingen
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Kantoor-specifieke standaardwaarden die in elke gegenereerde akte en offerte
          worden ingevuld.
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
                  value={vorm.notaris_naam}
                  onChange={(e) => zet("notaris_naam", e.target.value)}
                  placeholder="mr. Voornaam Achternaam"
                />
              </Veld>
              <Veld label="Plaats van vestiging" hint="Bijv. Altena.">
                <Input
                  value={vorm.notaris_standplaats}
                  onChange={(e) => zet("notaris_standplaats", e.target.value)}
                  placeholder="Altena"
                />
              </Veld>
              <div className="sm:col-span-2">
                <Veld
                  label="Gevolmachtigde van de bank"
                  hint="Kantoormedewerker die namens de bank compareert. Laat leeg om het per akte handmatig in te vullen — het veld wordt dan geel gearceerd in de akte."
                >
                  <Input
                    value={vorm.bank_volmachthouder}
                    onChange={(e) => zet("bank_volmachthouder", e.target.value)}
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
                <Tekstvak
                  waarde={vorm.slot_tekst}
                  onChange={(w) => zet("slot_tekst", w)}
                  rows={9}
                  placeholder={"Deze akte is verleden te …\nDe verschenen personen zijn mij, notaris, bekend …"}
                />
              </Veld>
            </div>
          </section>

          {/* Offerte */}
          <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
              <Receipt className="h-4 w-4 text-azure" strokeWidth={2} />
              <h2 className="text-[15px] font-semibold text-ink-strong">Offerte</h2>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Veld
                label="Btw-percentage"
                hint="Geldt voor het honorarium. Verschotten worden zonder btw doorbelast."
              >
                <Input
                  value={vorm.btw_percentage}
                  onChange={(e) => zet("btw_percentage", e.target.value)}
                  inputMode="decimal"
                  placeholder="21"
                />
              </Veld>
              <Veld
                label="Geldigheidsduur in dagen"
                hint="Bepaalt de datum die in de slottekst op de plek van <<GELDIG_TOT>> komt."
              >
                <Input
                  value={vorm.offerte_geldigheidsdagen}
                  onChange={(e) => zet("offerte_geldigheidsdagen", e.target.value)}
                  inputMode="numeric"
                  placeholder="30"
                />
              </Veld>
              <div className="sm:col-span-2">
                <Veld
                  label="Voorwaarden onder de offerte"
                  hint="Eén regel per alinea. Gebruik <<GELDIG_TOT>> voor de vervaldatum; die wordt bij het genereren ingevuld."
                >
                  <Tekstvak
                    waarde={vorm.offerte_slottekst}
                    onChange={(w) => zet("offerte_slottekst", w)}
                    rows={6}
                    placeholder={"Deze offerte is geldig tot en met <<GELDIG_TOT>> …"}
                  />
                </Veld>
              </div>
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
              onClick={() => setVorm(initieel)}
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

function Tekstvak({
  waarde,
  onChange,
  rows,
  placeholder,
}: {
  waarde: string;
  onChange: (waarde: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={waarde}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      spellCheck={false}
      className={cn(
        "flex w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink-strong placeholder:text-ink-mute transition-colors",
        "focus-visible:outline-none focus-visible:border-azure focus-visible:ring-4 focus-visible:ring-azure/15"
      )}
      placeholder={placeholder}
    />
  );
}

function Veld({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-ink-strong">{label}</label>
      {children}
      {hint && <p className="text-[11.5px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}
