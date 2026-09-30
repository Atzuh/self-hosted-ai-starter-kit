import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tekstvlak, Veld, centenNaarEuro } from "@/components/beheer-bouwstenen";

/**
 * Beheer van de tekstblokken waaruit een concept-akte wordt opgebouwd, met de
 * prijs die elk blok aan de offerte toevoegt.
 *
 * Een blok hangt via `kop` aan een kopje uit het bespreeksjabloon. Kwam er in de
 * bespreking inhoud onder dat kopje, dan stelt de testament-bouwer het blok
 * voor. Die koppeling is de enige die betrouwbaar is: het verslag kent geen
 * gestructureerde keuzes, alleen kopjes met vrije tekst eronder.
 *
 * Dit scherm gaat over WAT er in de akte staat, niet over wat het kost. De
 * bedragen zijn hier alleen leesbaar; ze worden beheerd onder Offertetarieven.
 * Die scheiding wordt ook aan de serverkant afgedwongen: opslaan vanaf hier
 * stuurt `bereik: "blokken"` mee, waarna de node de bedragen van schijf houdt.
 * Zonder dat zou een tekstwijziging een tariefwijziging van een minuut eerder
 * terugdraaien, want beide schermen sturen het hele object mee.
 */

const LIJST_URL = "http://localhost:5678/webhook/akteblokken";
const OPSLAAN_URL = "http://localhost:5678/webhook/akteblok";

const SOORT_PATROON = /^[a-z]{2,40}$/;
const BLOK_ID_PATROON = /^[a-z0-9][a-z0-9-]{0,59}$/;
const VELD_PATROON = /^[A-Z][A-Z0-9_]{0,59}$/;

export interface Invulveld {
  naam: string;
  label: string;
  hint: string;
}

export interface Blok {
  id: string;
  naam: string;
  /** Kopje uit het bespreeksjabloon; null = vast blok (aanhef, slotformule). */
  kop: string | null;
  /** Verwijst `kop` nog naar een bestaand kopje? Anders wordt het blok nooit voorgesteld. */
  kop_bestaat?: boolean;
  altijd: boolean;
  prijs_cent: number;
  tekst: string;
  velden: Invulveld[];
  onbekende_placeholders?: string[];
  ongebruikte_velden?: string[];
}

export interface Verschot {
  naam: string;
  bedrag_cent: number;
  per_testament: boolean;
}

export interface Versie {
  versie_id: string;
  opgeslagen_op: string | null;
  grootte: number | null;
}

export interface Aktesoort {
  soort: string;
  naam: string;
  bestand: string;
  bespreeksjabloon: string | null;
  bekende_koppen: string[];
  basistarief_cent: number;
  tarief_tweede_testament_cent: number;
  verschotten: Verschot[];
  blokken: Blok[];
  gewijzigd_op: string | null;
  versies: Versie[];
}

interface VerwijderdeAkte {
  soort: string;
  versies: Versie[];
}

interface LijstResponse {
  success: boolean;
  aktes?: Aktesoort[];
  verwijderd?: VerwijderdeAkte[];
  systeem_placeholders?: string[];
  onleesbaar?: Array<{ bestand: string; fout: string }>;
  error?: string;
}

/** Bewerkbare kopie; `isNieuw` bepaalt of de soort nog vrij is. */
interface Concept {
  soort: string;
  naam: string;
  bespreeksjabloon: string | null;
  bekende_koppen: string[];
  basistarief_cent: number;
  tarief_tweede_testament_cent: number;
  verschotten: Verschot[];
  blokken: Blok[];
  isNieuw: boolean;
}

const STANDAARD_SYSTEEMVELDEN = [
  "<<AKTE_DATUM>>",
  "<<NOTARIS_NAAM>>",
  "<<NOTARIS_STANDPLAATS>>",
  "<<ERFLATERS>>",
  "<<SLOT_TEKST>>",
];

function placeholdersIn(tekst: string): string[] {
  return tekst.match(/<<[A-Z0-9_]+>>/g) || [];
}

function formatDatum(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function conceptVan(a: Aktesoort): Concept {
  return {
    soort: a.soort,
    naam: a.naam,
    bespreeksjabloon: a.bespreeksjabloon,
    bekende_koppen: [...a.bekende_koppen],
    basistarief_cent: a.basistarief_cent,
    tarief_tweede_testament_cent: a.tarief_tweede_testament_cent,
    verschotten: a.verschotten.map((v) => ({ ...v })),
    blokken: a.blokken.map((b) => ({ ...b, velden: b.velden.map((v) => ({ ...v })) })),
    isNieuw: false,
  };
}

function leegConcept(): Concept {
  return {
    soort: "",
    naam: "",
    bespreeksjabloon: null,
    bekende_koppen: [],
    basistarief_cent: 0,
    tarief_tweede_testament_cent: 0,
    verschotten: [],
    blokken: [
      { id: "aanhef", naam: "Aanhef", kop: null, altijd: true, prijs_cent: 0, tekst: "", velden: [] },
    ],
    isNieuw: true,
  };
}

/**
 * Dezelfde regels als de n8n-node, zodat fouten zichtbaar zijn vóór er iets
 * over de lijn gaat. De backend blijft leidend — dit is comfort, geen
 * beveiliging.
 */
function valideer(c: Concept, bezetteSoorten: string[]): string[] {
  const fouten: string[] = [];

  if (!SOORT_PATROON.test(c.soort)) {
    fouten.push("Soort moet 2 tot 40 kleine letters zijn, zonder spaties, cijfers of leestekens.");
  } else if (c.isNieuw && bezetteSoorten.includes(c.soort)) {
    fouten.push(`Er bestaat al een aktesoort '${c.soort}'.`);
  }
  if (!c.naam.trim()) fouten.push("Naam is verplicht.");
  if (!c.blokken.length) fouten.push("Een aktesoort heeft minstens één blok nodig.");

  const gezienId = new Set<string>();
  c.blokken.forEach((b, i) => {
    const nr = i + 1;
    const label = b.naam.trim() ? `'${b.naam.trim()}'` : `${nr}`;
    if (!BLOK_ID_PATROON.test(b.id)) {
      fouten.push(`Blok ${nr} heeft een ongeldig id: kleine letters, cijfers en koppeltekens.`);
    } else if (gezienId.has(b.id)) {
      fouten.push(`Blok-id '${b.id}' komt meer dan één keer voor.`);
    } else {
      gezienId.add(b.id);
    }
    if (!b.naam.trim()) fouten.push(`Blok ${nr} heeft geen naam.`);
    if (!b.tekst.trim()) fouten.push(`Blok ${label} heeft geen tekst.`);

    const gezienVeld = new Set<string>();
    b.velden.forEach((v, vi) => {
      if (!VELD_PATROON.test(v.naam)) {
        fouten.push(
          `Veld ${vi + 1} van blok ${label} heeft een ongeldige naam: hoofdletters, cijfers en liggende streepjes.`
        );
      } else if (gezienVeld.has(v.naam)) {
        fouten.push(`Veld '${v.naam}' komt meer dan één keer voor in blok ${label}.`);
      } else {
        gezienVeld.add(v.naam);
      }
    });
  });

  return fouten;
}

export function AkteblokBeheer() {
  const [aktes, setAktes] = useState<Aktesoort[] | null>(null);
  const [verwijderd, setVerwijderd] = useState<VerwijderdeAkte[]>([]);
  const [systeemvelden, setSysteemvelden] = useState<string[]>(STANDAARD_SYSTEEMVELDEN);
  const [onleesbaar, setOnleesbaar] = useState<Array<{ bestand: string; fout: string }>>([]);
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: "ok" | "fout" } | null>(null);

  const [concept, setConcept] = useState<Concept | null>(null);
  const [opslaan, setOpslaan] = useState(false);
  const [opslagFouten, setOpslagFouten] = useState<string[]>([]);
  const [versiesOpen, setVersiesOpen] = useState<string | null>(null);
  const [bevestigWeg, setBevestigWeg] = useState<string | null>(null);

  const haalOp = useCallback(async () => {
    setLaden(true);
    setFout(null);
    let laatsteFout = "Onbekende fout";
    for (let poging = 1; poging <= 3; poging++) {
      try {
        const res = await fetch(LIJST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = (await res.json()) as LijstResponse;
        if (!data.success) throw new Error(data.error || "Onbekende fout van n8n");
        setAktes(data.aktes || []);
        setVerwijderd(data.verwijderd || []);
        setSysteemvelden(data.systeem_placeholders || STANDAARD_SYSTEEMVELDEN);
        setOnleesbaar(data.onleesbaar || []);
        setLaden(false);
        return;
      } catch (err) {
        laatsteFout = err instanceof Error ? err.message : String(err);
        if (poging < 3) await new Promise((r) => setTimeout(r, poging * 400));
      }
    }
    setFout(laatsteFout);
    setAktes(null);
    setLaden(false);
  }, []);

  useEffect(() => {
    haalOp();
  }, [haalOp]);

  const bezetteSoorten = useMemo(() => (aktes || []).map((a) => a.soort), [aktes]);

  async function verstuur(payload: unknown): Promise<Record<string, unknown>> {
    // Multipart en geen application/json: dat laatste lokt een CORS-preflight
    // uit naar n8n op een andere poort.
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    const res = await fetch(OPSLAAN_URL, { method: "POST", body: form });
    const tekst = await res.text();
    let geparsed: Record<string, unknown> | null = null;
    try {
      geparsed = JSON.parse(tekst) as Record<string, unknown>;
    } catch {
      /* ruwe tekst tonen */
    }
    if (!res.ok || !geparsed) {
      throw new Error(
        (geparsed?.error as string) ||
          `HTTP ${res.status}: ${tekst.slice(0, 200) || "leeg antwoord"}`
      );
    }
    if (geparsed.success === false) {
      throw new Error((geparsed.error as string) || "Opslaan mislukt");
    }
    return geparsed;
  }

  async function slaOp() {
    if (!concept) return;
    const lokaal = valideer(concept, bezetteSoorten);
    if (lokaal.length) {
      setOpslagFouten(lokaal);
      return;
    }
    setOpslagFouten([]);
    setOpslaan(true);
    try {
      const antwoord = await verstuur({
        actie: "opslaan",
        // Een nieuwe aktesoort bestaat nog niet op schijf, dus die moet in één
        // keer worden weggeschreven; daarna is alleen de tekst van hier.
        bereik: concept.isNieuw ? "alles" : "blokken",
        nieuw: concept.isNieuw,
        akte: {
          soort: concept.soort,
          naam: concept.naam.trim(),
          bespreeksjabloon: concept.bespreeksjabloon,
          basistarief_cent: concept.basistarief_cent,
          tarief_tweede_testament_cent: concept.tarief_tweede_testament_cent,
          verschotten: concept.verschotten,
          blokken: concept.blokken,
        },
      });
      const waarschuwingen = (antwoord.waarschuwingen as string[]) || [];
      setMelding({
        soort: "ok",
        tekst:
          `Akteblokken voor '${concept.naam}' opgeslagen.` +
          (antwoord.vorige_versie_bewaard_als ? " De vorige versie is bewaard." : "") +
          (waarschuwingen.length ? ` ${waarschuwingen.join(" ")}` : ""),
      });
      setConcept(null);
      await haalOp();
    } catch (err) {
      setOpslagFouten([err instanceof Error ? err.message : String(err)]);
    } finally {
      setOpslaan(false);
    }
  }

  async function herstel(soort: string, versie: Versie) {
    setOpslaan(true);
    try {
      await verstuur({ actie: "herstellen", soort, versie_id: versie.versie_id });
      setMelding({
        soort: "ok",
        tekst: `'${soort}' teruggezet naar de versie van ${formatDatum(versie.opgeslagen_op)}. De versie van vlak daarvoor is bewaard.`,
      });
      setVersiesOpen(null);
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  async function verwijder(akte: Aktesoort) {
    setOpslaan(true);
    try {
      await verstuur({ actie: "verwijderen", soort: akte.soort });
      setMelding({
        soort: "ok",
        tekst: `'${akte.naam}' verwijderd. Het staat nog in de versiehistorie en is hieronder terug te zetten.`,
      });
      setBevestigWeg(null);
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  async function haalTerug(item: VerwijderdeAkte) {
    const nieuwste = item.versies[0];
    if (!nieuwste) return;
    setOpslaan(true);
    try {
      await verstuur({ actie: "herstellen", soort: item.soort, versie_id: nieuwste.versie_id });
      setMelding({
        soort: "ok",
        tekst: `'${item.soort}' teruggezet, zoals het was op ${formatDatum(nieuwste.opgeslagen_op)}.`,
      });
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  if (concept) {
    return (
      <AkteEditor
        concept={concept}
        systeemvelden={systeemvelden}
        onChange={setConcept}
        onAnnuleer={() => {
          setConcept(null);
          setOpslagFouten([]);
        }}
        onOpslaan={slaOp}
        bezig={opslaan}
        fouten={opslagFouten}
      />
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[14px] leading-relaxed text-ink-soft">
          Uit deze tekstblokken bouwt Scriptor een concept-akte. Elk blok hangt aan
          een kopje uit het bespreeksjabloon: kwam dat onderwerp in de bespreking aan
          bod, dan wordt het blok voorgesteld. De prijs per blok komt bovenop het
          basistarief en bepaalt de offerte.
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={haalOp} disabled={laden}>
            {laden ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Vernieuwen
          </Button>
          <Button size="sm" onClick={() => setConcept(leegConcept())} disabled={laden}>
            <Plus className="h-3.5 w-3.5" />
            Nieuwe aktesoort
          </Button>
        </div>
      </div>

      {melding && (
        <div
          className={cn(
            "mb-5 flex items-start gap-3 rounded-md border border-l-4 p-4 text-sm",
            melding.soort === "ok"
              ? "border-success/30 border-l-success bg-success/8"
              : "border-danger/30 border-l-danger bg-danger-pale"
          )}
        >
          {melding.soort === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" strokeWidth={2.25} />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" strokeWidth={2.25} />
          )}
          <div className="flex-1 text-ink">{melding.tekst}</div>
          <button
            type="button"
            onClick={() => setMelding(null)}
            aria-label="Melding sluiten"
            className="text-ink-soft transition-colors hover:text-ink-strong"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {fout && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-danger/30 border-l-4 border-l-danger bg-danger-pale p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" strokeWidth={2.25} />
          <div className="flex-1">
            <div className="font-display font-bold text-ink-strong">
              Kon akteblokken niet ophalen
            </div>
            <div className="mt-0.5 text-ink-soft">{fout}</div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">GET {LIJST_URL}</div>
          </div>
        </div>
      )}

      {onleesbaar.length > 0 && (
        <div className="mb-6 rounded-md border border-amber/30 border-l-4 border-l-amber bg-amber-pale p-4 text-sm">
          <div className="font-display font-bold text-ink-strong">
            Onleesbare bestanden in de aktemap
          </div>
          <ul className="mt-1 space-y-0.5 text-ink-soft">
            {onleesbaar.map((o) => (
              <li key={o.bestand} className="font-mono text-[11.5px]">
                {o.bestand} — {o.fout}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!aktes && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-ink-strong" />
          Akteblokken laden…
        </div>
      )}

      {aktes && aktes.length === 0 && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          Nog geen aktesoorten. Maak er een aan met{" "}
          <span className="font-medium text-ink-strong">Nieuwe aktesoort</span>.
        </div>
      )}

      {aktes && aktes.length > 0 && (
        <div className="space-y-4">
          {aktes.map((a) => (
            <AkteKaart
              key={a.soort}
              akte={a}
              bezig={opslaan}
              versiesOpen={versiesOpen === a.soort}
              onToggleVersies={() => setVersiesOpen(versiesOpen === a.soort ? null : a.soort)}
              onBewerk={() => {
                setConcept(conceptVan(a));
                setOpslagFouten([]);
                setMelding(null);
              }}
              onHerstel={(versie) => herstel(a.soort, versie)}
              bevestigWeg={bevestigWeg === a.soort}
              onVraagVerwijder={() =>
                setBevestigWeg(bevestigWeg === a.soort ? null : a.soort)
              }
              onVerwijder={() => verwijder(a)}
            />
          ))}
        </div>
      )}

      {verwijderd.length > 0 && (
        <div className="mt-8 rounded-lg border border-line bg-surface p-5 shadow-card">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Verwijderd
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Van deze aktesoorten staat alleen nog versiehistorie op schijf.
          </p>
          <ul className="mt-3 space-y-2">
            {verwijderd.map((v) => (
              <li
                key={v.soort}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-wash/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="font-mono text-[13px] text-ink-strong">{v.soort}</span>
                  <span className="ml-2 text-[11.5px] text-ink-soft">
                    laatst bewaard {formatDatum(v.versies[0]?.opgeslagen_op ?? null)} ·{" "}
                    {v.versies.length} {v.versies.length === 1 ? "versie" : "versies"}
                  </span>
                </div>
                <Button variant="outline" size="sm" disabled={opslaan} onClick={() => haalTerug(v)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Terugzetten
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overzichtskaart
// ---------------------------------------------------------------------------

function AkteKaart({
  akte,
  bezig,
  versiesOpen,
  onToggleVersies,
  onBewerk,
  onHerstel,
  bevestigWeg,
  onVraagVerwijder,
  onVerwijder,
}: {
  akte: Aktesoort;
  bezig: boolean;
  versiesOpen: boolean;
  onToggleVersies: () => void;
  onBewerk: () => void;
  onHerstel: (versie: Versie) => void;
  bevestigWeg: boolean;
  onVraagVerwijder: () => void;
  onVerwijder: () => void;
}) {
  const losgeraakt = akte.blokken.filter((b) => b.kop_bestaat === false);
  const zonderTekstveld = akte.blokken.filter((b) => (b.onbekende_placeholders || []).length);
  const gekoppeld = akte.blokken.filter((b) => b.kop !== null).length;
  const vast = akte.blokken.length - gekoppeld;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
            {akte.naam}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-ink-soft">
            soort · {akte.soort}
            {akte.bespreeksjabloon && <> · bespreeksjabloon {akte.bespreeksjabloon}</>}
          </div>
        </div>
        <Badge variant="azure">{akte.blokken.length} blokken</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-line/70 pt-4 sm:grid-cols-3">
        <Kengetal label="Basistarief" waarde={`€ ${centenNaarEuro(akte.basistarief_cent)}`} />
        <Kengetal
          label="Tweede testament"
          waarde={`€ ${centenNaarEuro(akte.tarief_tweede_testament_cent)}`}
        />
        <Kengetal
          label="Verschotten"
          waarde={
            akte.verschotten.length
              ? akte.verschotten
                  .map((v) => `${v.naam} € ${centenNaarEuro(v.bedrag_cent)}`)
                  .join(" · ")
              : "geen"
          }
        />
      </div>

      <div className="border-t border-line/70 pt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Blokken
        </div>
        <div className="text-[12.5px] leading-relaxed text-ink">
          {akte.blokken.map((b) => b.naam).join(" · ")}
        </div>
        <div className="mt-2 font-mono text-[11px] text-ink-soft">
          {vast} vast · {gekoppeld} aan een kopje
        </div>

        {losgeraakt.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger-pale px-3 py-2 text-[12.5px] text-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-danger" strokeWidth={2.25} />
            <div>
              <span className="font-semibold text-ink-strong">
                {losgeraakt.length} {losgeraakt.length === 1 ? "blok verwijst" : "blokken verwijzen"} naar
                een kopje dat niet meer bestaat
              </span>{" "}
              ({losgeraakt.map((b) => `${b.naam} → “${b.kop}”`).join(", ")}). Deze blokken worden
              nooit meer voorgesteld. Waarschijnlijk is het kopje in het bespreeksjabloon hernoemd.
            </div>
          </div>
        )}

        {zonderTekstveld.length > 0 && (
          <div className="mt-2 flex items-start gap-2 text-[11.5px] text-amber">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.25} />
            <div>
              {zonderTekstveld
                .map((b) => `${b.naam}: ${(b.onbekende_placeholders || []).join(", ")}`)
                .join(" · ")}{" "}
              — deze plaatshouders hebben geen invulveld en komen letterlijk in de akte.
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-4">
        <div className="font-mono text-[11px] text-ink-soft">
          gewijzigd {formatDatum(akte.gewijzigd_op)}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleVersies}
            disabled={!akte.versies.length}
          >
            <History className="h-3.5 w-3.5" />
            {akte.versies.length} {akte.versies.length === 1 ? "versie" : "versies"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onVraagVerwijder}
            disabled={bezig}
            aria-label={`${akte.naam} verwijderen`}
            className="text-ink-soft hover:bg-danger-pale hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Verwijderen
          </Button>
          <Button variant="primary" size="sm" onClick={onBewerk}>
            Bewerken
          </Button>
        </div>
      </div>

      {bevestigWeg && (
        <div className="rounded-md border border-danger/30 border-l-4 border-l-danger bg-danger-pale p-3">
          <div className="text-[13px] text-ink">
            <span className="font-semibold text-ink-strong">{akte.naam}</span> verwijderen? Er kan
            daarna geen concept van deze soort meer worden gebouwd. De blokken gaan naar de
            versiehistorie en zijn terug te zetten.
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button variant="destructive" size="sm" onClick={onVerwijder} disabled={bezig}>
              {bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Ja, verwijderen
            </Button>
            <Button variant="outline" size="sm" onClick={onVraagVerwijder} disabled={bezig}>
              Annuleren
            </Button>
          </div>
        </div>
      )}

      {versiesOpen && akte.versies.length > 0 && (
        <div className="rounded-md border border-line bg-wash/50 p-3">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Eerdere versies
          </div>
          <ul className="space-y-1.5">
            {akte.versies.map((v) => (
              <li key={v.versie_id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11.5px] text-ink">
                  {formatDatum(v.opgeslagen_op)}
                </span>
                <Button variant="outline" size="sm" disabled={bezig} onClick={() => onHerstel(v)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Terugzetten
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11.5px] text-ink-soft">
            Terugzetten bewaart de huidige versie eerst, dus het is omkeerbaar.
          </div>
        </div>
      )}
    </div>
  );
}

function Kengetal({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {label}
      </div>
      <div className="mt-0.5 text-[13.5px] text-ink-strong">{waarde}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function AkteEditor({
  concept,
  systeemvelden,
  onChange,
  onAnnuleer,
  onOpslaan,
  bezig,
  fouten,
}: {
  concept: Concept;
  systeemvelden: string[];
  onChange: (c: Concept) => void;
  onAnnuleer: () => void;
  onOpslaan: () => void;
  bezig: boolean;
  fouten: string[];
}) {
  const [openBlok, setOpenBlok] = useState<number | null>(concept.isNieuw ? 0 : null);

  const totaalAlles = useMemo(
    () =>
      concept.basistarief_cent +
      concept.blokken.reduce((som, b) => som + b.prijs_cent, 0),
    [concept]
  );

  function zetBlok(index: number, blok: Blok) {
    const blokken = [...concept.blokken];
    blokken[index] = blok;
    onChange({ ...concept, blokken });
  }

  function verplaats(index: number, richting: -1 | 1) {
    const doel = index + richting;
    if (doel < 0 || doel >= concept.blokken.length) return;
    const blokken = [...concept.blokken];
    [blokken[index], blokken[doel]] = [blokken[doel], blokken[index]];
    onChange({ ...concept, blokken });
    setOpenBlok(openBlok === index ? doel : openBlok === doel ? index : openBlok);
  }

  function verwijderBlok(index: number) {
    onChange({ ...concept, blokken: concept.blokken.filter((_, i) => i !== index) });
    setOpenBlok(null);
  }

  function voegBlokToe() {
    const blokken = [
      ...concept.blokken,
      {
        id: `blok-${concept.blokken.length + 1}`,
        naam: "",
        kop: null,
        altijd: false,
        prijs_cent: 0,
        tekst: "",
        velden: [],
      } as Blok,
    ];
    onChange({ ...concept, blokken });
    setOpenBlok(blokken.length - 1);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] font-medium leading-tight text-ink-strong">
            {concept.isNieuw ? "Nieuwe aktesoort" : `${concept.naam || concept.soort} bewerken`}
          </h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
            Wijzigingen gelden voor het volgende concept dat wordt gebouwd. De vorige
            versie wordt bij het opslaan bewaard.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onAnnuleer} disabled={bezig}>
            Annuleren
          </Button>
          <Button variant="primary" size="sm" onClick={onOpslaan} disabled={bezig}>
            {bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Opslaan
          </Button>
        </div>
      </div>

      {fouten.length > 0 && (
        <div className="mb-6 rounded-md border border-danger/30 border-l-4 border-l-danger bg-danger-pale p-4 text-sm">
          <div className="font-display font-bold text-ink-strong">Nog niet opgeslagen</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-ink-soft">
            {fouten.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Kerngegevens — de bedragen staan hier alleen ter informatie */}
      <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
        <Veld label="Naam" hint="Zoals de aktesoort in de generator wordt getoond.">
          <Input
            value={concept.naam}
            onChange={(e) => onChange({ ...concept, naam: e.target.value })}
            placeholder="Testament"
            disabled={bezig}
          />
        </Veld>
        <Veld
          label="Soort"
          hint={
            concept.isNieuw
              ? "Bestandsnaam en sleutel. Alleen kleine letters."
              : "Ligt vast: de generator zoekt het blokkenbestand op deze naam."
          }
        >
          <Input
            value={concept.soort}
            onChange={(e) =>
              onChange({ ...concept, soort: e.target.value.toLowerCase().replace(/[^a-z]/g, "") })
            }
            placeholder="testament"
            disabled={bezig || !concept.isNieuw}
            className="font-mono"
          />
        </Veld>

        {!concept.isNieuw && (
          <div className="sm:col-span-2 rounded-md border border-line bg-wash/50 px-4 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Tarieven
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink">
              <span>
                Basistarief{" "}
                <span className="font-mono text-ink-strong">
                  € {centenNaarEuro(concept.basistarief_cent)}
                </span>
              </span>
              <span>
                Tweede testament{" "}
                <span className="font-mono text-ink-strong">
                  € {centenNaarEuro(concept.tarief_tweede_testament_cent)}
                </span>
              </span>
              <span>
                Verschotten{" "}
                <span className="font-mono text-ink-strong">
                  {concept.verschotten.length || "geen"}
                </span>
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft">
              Bedragen worden beheerd onder{" "}
              <span className="font-medium text-ink">Templates → Offertetarieven</span>. Hier
              staan ze alleen ter informatie, zodat je bij het schrijven van een blok ziet
              wat het kost.
            </p>
          </div>
        )}
      </div>

      {/* Blokken */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Blokken · {concept.blokken.length}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-soft">
            Alle blokken samen: € {centenNaarEuro(totaalAlles)}
          </span>
          <Button variant="outline" size="sm" onClick={voegBlokToe} disabled={bezig}>
            <Plus className="h-3.5 w-3.5" />
            Blok toevoegen
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {concept.blokken.map((blok, i) => (
          <BlokRij
            key={i}
            index={i}
            aantal={concept.blokken.length}
            blok={blok}
            bekendeKoppen={concept.bekende_koppen}
            systeemvelden={systeemvelden}
            open={openBlok === i}
            bezig={bezig}
            onToggle={() => setOpenBlok(openBlok === i ? null : i)}
            onChange={(b) => zetBlok(i, b)}
            onOmhoog={() => verplaats(i, -1)}
            onOmlaag={() => verplaats(i, 1)}
            onVerwijder={() => verwijderBlok(i)}
          />
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onAnnuleer} disabled={bezig}>
          Annuleren
        </Button>
        <Button variant="primary" onClick={onOpslaan} disabled={bezig}>
          {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
          Opslaan
        </Button>
      </div>
    </div>
  );
}

function BlokRij({
  index,
  aantal,
  blok,
  bekendeKoppen,
  systeemvelden,
  open,
  bezig,
  onToggle,
  onChange,
  onOmhoog,
  onOmlaag,
  onVerwijder,
}: {
  index: number;
  aantal: number;
  blok: Blok;
  bekendeKoppen: string[];
  systeemvelden: string[];
  open: boolean;
  bezig: boolean;
  onToggle: () => void;
  onChange: (b: Blok) => void;
  onOmhoog: () => void;
  onOmlaag: () => void;
  onVerwijder: () => void;
}) {
  // Live meelezen welke plaatshouders in de tekst geen invulveld hebben, en
  // welke velden nergens in de tekst voorkomen. Beide leveren stille fouten op:
  // het eerste zet <<TYPFOUT>> letterlijk in de akte, het tweede vraagt de
  // gebruiker om iets in te vullen dat nergens terechtkomt.
  const { onbekend, ongebruikt } = useMemo(() => {
    const gedeclareerd = new Set([...blok.velden.map((v) => `<<${v.naam}>>`), ...systeemvelden]);
    const inTekst = [...new Set(placeholdersIn(blok.tekst))];
    return {
      onbekend: inTekst.filter((p) => !gedeclareerd.has(p)),
      ongebruikt: blok.velden
        .map((v) => `<<${v.naam}>>`)
        .filter((p) => p !== "<<>>" && !inTekst.includes(p)),
    };
  }, [blok.tekst, blok.velden, systeemvelden]);

  const kopWeg = blok.kop !== null && bekendeKoppen.length > 0 && !bekendeKoppen.includes(blok.kop);

  return (
    <div
      className={cn(
        "rounded-lg border bg-surface shadow-card",
        kopWeg ? "border-danger/40" : "border-line"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
          )}
          <span className="w-6 flex-shrink-0 font-mono text-[11px] text-ink-soft">{index + 1}.</span>
          <span className="truncate text-[14px] font-medium text-ink-strong">
            {blok.naam || <span className="text-ink-soft">(nog geen naam)</span>}
          </span>
          {blok.altijd ? (
            <Badge variant="outline">altijd</Badge>
          ) : blok.kop ? (
            <Badge variant={kopWeg ? "danger" : "azure"}>{blok.kop}</Badge>
          ) : (
            <Badge variant="outline">los</Badge>
          )}
          {(onbekend.length > 0 || kopWeg) && (
            <AlertTriangle
              className={cn("h-3.5 w-3.5 flex-shrink-0", kopWeg ? "text-danger" : "text-amber")}
              strokeWidth={2.25}
            />
          )}
          <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-ink-soft">
            € {centenNaarEuro(blok.prijs_cent)}
          </span>
        </button>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onOmhoog}
            disabled={bezig || index === 0}
            aria-label="Omhoog"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-ink-strong disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onOmlaag}
            disabled={bezig || index === aantal - 1}
            aria-label="Omlaag"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-ink-strong disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onVerwijder}
            disabled={bezig}
            aria-label="Blok verwijderen"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger-pale hover:text-danger disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line/70 px-4 py-4">
          {kopWeg && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-pale px-3 py-2 text-[12.5px] text-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-danger" strokeWidth={2.25} />
              <div>
                Het kopje “{blok.kop}” bestaat niet meer in het bespreeksjabloon. Dit blok
                wordt daardoor nooit voorgesteld. Kies hieronder een bestaand kopje, of
                zet het blok op “geen”.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Veld label="Naam" hint="Zoals het blok in de bouwer heet.">
              <Input
                value={blok.naam}
                onChange={(e) => onChange({ ...blok, naam: e.target.value })}
                placeholder="Voogdij"
                disabled={bezig}
              />
            </Veld>
            <Veld label="Id" hint="Vaste sleutel; wijzig hem niet zonder reden.">
              <Input
                value={blok.id}
                onChange={(e) =>
                  onChange({ ...blok, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                }
                placeholder="voogdij"
                disabled={bezig}
                className="font-mono"
              />
            </Veld>
            <Veld label="Prijs" hint="Aan te passen onder Offertetarieven.">
              <div className="flex h-10 items-center rounded-md border border-dashed border-line bg-wash/50 px-3 font-mono text-sm text-ink-soft">
                € {centenNaarEuro(blok.prijs_cent)}
              </div>
            </Veld>
          </div>

          <Veld
            label="Gekoppeld kopje"
            hint="Kwam er in de bespreking inhoud onder dit kopje, dan wordt het blok voorgesteld. Kies 'geen' voor vaste onderdelen als de aanhef of de slotformule."
          >
            <select
              value={blok.kop ?? ""}
              onChange={(e) => onChange({ ...blok, kop: e.target.value || null })}
              disabled={bezig}
              className={cn(
                "flex h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink-strong transition-colors",
                "focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <option value="">geen — vast blok</option>
              {/* Een kop die niet meer in het sjabloon staat blijft kiesbaar, anders
                  zou de waarde bij het opslaan stilzwijgend omslaan naar 'geen'. */}
              {kopWeg && blok.kop && <option value={blok.kop}>{blok.kop} (bestaat niet meer)</option>}
              {bekendeKoppen.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Veld>

          <label className="flex items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={blok.altijd}
              onChange={(e) => onChange({ ...blok, altijd: e.target.checked })}
              disabled={bezig}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-line-strong accent-azure"
            />
            <span>
              Altijd meenemen
              <span className="block text-[12px] text-ink-soft">
                Het blok staat vast aan in de bouwer en is niet uit te vinken. Voor de
                aanhef, de comparitie en de slotformule.
              </span>
            </span>
          </label>

          <Veld
            label="Tekst"
            hint="Komt zo in de akte. Gebruik <<VELDNAAM>> voor wat per dossier verschilt; wat leeg blijft komt geel gearceerd in het concept."
          >
            <Tekstvlak
              waarde={blok.tekst}
              onChange={(tekst) => onChange({ ...blok, tekst })}
              rows={6}
              disabled={bezig}
              placeholder="VOOGDIJ&#10;Ik benoem tot voogd over mijn minderjarige kinderen: <<VOOGD_NAAM>>."
            />
          </Veld>

          {(onbekend.length > 0 || ongebruikt.length > 0) && (
            <div className="space-y-1 rounded-md border border-amber/30 bg-amber-pale px-3 py-2 text-[12px] text-ink">
              {onbekend.length > 0 && (
                <div>
                  <span className="font-mono">{onbekend.join(", ")}</span> {onbekend.length === 1 ? "heeft" : "hebben"} geen
                  invulveld en {onbekend.length === 1 ? "komt" : "komen"} letterlijk zo in de akte te staan.
                </div>
              )}
              {ongebruikt.length > 0 && (
                <div>
                  <span className="font-mono">{ongebruikt.join(", ")}</span> {ongebruikt.length === 1 ? "staat" : "staan"} niet
                  in de tekst; de gebruiker vult dan iets in dat nergens terechtkomt.
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
                Invulvelden
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={bezig}
                onClick={() =>
                  onChange({ ...blok, velden: [...blok.velden, { naam: "", label: "", hint: "" }] })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Veld toevoegen
              </Button>
            </div>
            {blok.velden.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                Geen invulvelden — dit blok heeft overal dezelfde tekst.
              </div>
            ) : (
              <div className="space-y-2">
                {blok.velden.map((v, vi) => (
                  <div key={vi} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                    <Input
                      value={v.naam}
                      onChange={(e) => {
                        const velden = [...blok.velden];
                        velden[vi] = { ...v, naam: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") };
                        onChange({ ...blok, velden });
                      }}
                      placeholder="VOOGD_NAAM"
                      disabled={bezig}
                      className="font-mono"
                    />
                    <Input
                      value={v.label}
                      onChange={(e) => {
                        const velden = [...blok.velden];
                        velden[vi] = { ...v, label: e.target.value };
                        onChange({ ...blok, velden });
                      }}
                      placeholder="Naam voogd"
                      disabled={bezig}
                    />
                    <Input
                      value={v.hint}
                      onChange={(e) => {
                        const velden = [...blok.velden];
                        velden[vi] = { ...v, hint: e.target.value };
                        onChange({ ...blok, velden });
                      }}
                      placeholder="Toelichting voor wie het invult (optioneel)"
                      disabled={bezig}
                    />
                    <button
                      type="button"
                      disabled={bezig}
                      aria-label="Veld verwijderen"
                      onClick={() =>
                        onChange({ ...blok, velden: blok.velden.filter((_, j) => j !== vi) })
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger-pale hover:text-danger disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

