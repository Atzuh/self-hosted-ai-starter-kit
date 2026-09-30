import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EuroInvoer, Veld, centenNaarEuro } from "@/components/beheer-bouwstenen";
import type { Aktesoort, Verschot } from "@/components/AkteblokBeheer";

/**
 * Alle bedragen die een offerte opbouwen, op één plek: het basistarief, het
 * tarief voor een tweede testament, de verschotten, en de prijs per blok.
 *
 * Waarom apart van Akteblokken: daar gaat het over de tekst van de akte, hier
 * over wat die tekst kost. Dat zijn andere beslissingen, vaak door andere
 * mensen genomen. De scheiding wordt ook aan de serverkant afgedwongen — dit
 * scherm stuurt `bereik: "tarieven"` mee en raakt de blokteksten niet aan, en
 * omgekeerd. Zonder dat zou het opslaan van het ene scherm het werk van het
 * andere terugdraaien, want beide sturen het hele object mee.
 */

const LIJST_URL = "http://localhost:5678/webhook/akteblokken";
const OPSLAAN_URL = "http://localhost:5678/webhook/akteblok";
const KANTOOR_URL = "http://localhost:5678/webhook/kantoor";

interface Concept {
  soort: string;
  naam: string;
  basistarief_cent: number;
  tarief_tweede_testament_cent: number;
  verschotten: Verschot[];
  /** Alleen id, naam en prijs; de rest van het blok blijft ongemoeid. */
  blokken: Array<{ id: string; naam: string; prijs_cent: number; altijd: boolean }>;
}

function conceptVan(a: Aktesoort): Concept {
  return {
    soort: a.soort,
    naam: a.naam,
    basistarief_cent: a.basistarief_cent,
    tarief_tweede_testament_cent: a.tarief_tweede_testament_cent,
    verschotten: a.verschotten.map((v) => ({ ...v })),
    blokken: a.blokken.map((b) => ({
      id: b.id,
      naam: b.naam,
      prijs_cent: b.prijs_cent,
      altijd: b.altijd,
    })),
  };
}

function gelijk(a: Concept, b: Concept): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function OffertetariefBeheer() {
  const [aktes, setAktes] = useState<Aktesoort[] | null>(null);
  const [btwPercentage, setBtwPercentage] = useState<number | null>(null);
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: "ok" | "fout" } | null>(null);
  const [opslaan, setOpslaan] = useState(false);
  const [concepten, setConcepten] = useState<Record<string, Concept>>({});
  const [origineel, setOrigineel] = useState<Record<string, Concept>>({});

  const haalOp = useCallback(async () => {
    setLaden(true);
    setFout(null);
    let laatsteFout = "Onbekende fout";
    for (let poging = 1; poging <= 3; poging++) {
      try {
        const res = await fetch(LIJST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Onbekende fout van n8n");
        const lijst: Aktesoort[] = data.aktes || [];
        setAktes(lijst);
        const kaart = Object.fromEntries(lijst.map((a) => [a.soort, conceptVan(a)]));
        setConcepten(kaart);
        setOrigineel(JSON.parse(JSON.stringify(kaart)));
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

  // Het btw-percentage staat bij de kantoorinstellingen, want het geldt voor
  // alle aktesoorten. Hier alleen tonen, zodat het voorbeeldtotaal klopt.
  useEffect(() => {
    let afgebroken = false;
    (async () => {
      try {
        const res = await fetch(KANTOOR_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const p = Number(data?.kantoor?.btw_percentage);
        if (!afgebroken && Number.isFinite(p)) setBtwPercentage(p);
      } catch {
        /* zonder percentage tonen we het voorbeeld zonder btw-regel */
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, []);

  async function slaOp(soort: string) {
    const concept = concepten[soort];
    if (!concept) return;
    setOpslaan(true);
    setMelding(null);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          actie: "opslaan",
          bereik: "tarieven",
          akte: {
            soort: concept.soort,
            naam: concept.naam,
            basistarief_cent: concept.basistarief_cent,
            tarief_tweede_testament_cent: concept.tarief_tweede_testament_cent,
            verschotten: concept.verschotten,
            // Alleen id en prijs doen ertoe; de node houdt de rest van het blok
            // van schijf. Naam en tekst gaan mee om de validatie te laten slagen.
            blokken: concept.blokken.map((b) => ({
              id: b.id,
              naam: b.naam,
              prijs_cent: b.prijs_cent,
              tekst: "-",
              velden: [],
            })),
          },
        })
      );
      const res = await fetch(OPSLAAN_URL, { method: "POST", body: form });
      const tekst = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(tekst);
      } catch {
        /* ruwe tekst tonen */
      }
      if (!res.ok || !data || data.success === false) {
        throw new Error(
          (data?.error as string) ||
            `HTTP ${res.status}: ${tekst.slice(0, 200) || "leeg antwoord"}`
        );
      }
      setMelding({
        soort: "ok",
        tekst: `Tarieven voor '${concept.naam}' opgeslagen. De vorige versie is bewaard.`,
      });
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  function zet(soort: string, wijziging: Partial<Concept>) {
    setConcepten((vorige) => ({ ...vorige, [soort]: { ...vorige[soort], ...wijziging } }));
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[14px] leading-relaxed text-ink-soft">
          Alle bedragen die samen de offerte vormen. Het basistarief geldt altijd; elk
          blok dat in een concept meegaat komt daarbovenop. Staat een blok in beide
          testamenten van een echtpaar, dan telt het één keer — het tweede testament
          heeft daarvoor een eigen tarief.
        </p>
        <Button variant="outline" size="sm" onClick={haalOp} disabled={laden || opslaan}>
          {laden ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Vernieuwen
        </Button>
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
              Kon tarieven niet ophalen
            </div>
            <div className="mt-0.5 text-ink-soft">{fout}</div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">GET {LIJST_URL}</div>
          </div>
        </div>
      )}

      {!aktes && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-ink-strong" />
          Tarieven laden…
        </div>
      )}

      {aktes && aktes.length === 0 && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          Nog geen aktesoorten. Maak er eerst een aan onder{" "}
          <span className="font-medium text-ink-strong">Akteblokken</span>.
        </div>
      )}

      {aktes && aktes.length > 0 && (
        <div className="space-y-6">
          {aktes.map((a) => {
            const c = concepten[a.soort];
            if (!c) return null;
            const gewijzigd = !gelijk(c, origineel[a.soort]);
            return (
              <TariefKaart
                key={a.soort}
                concept={c}
                btwPercentage={btwPercentage}
                gewijzigd={gewijzigd}
                bezig={opslaan}
                onZet={(w) => zet(a.soort, w)}
                onHerstel={() =>
                  setConcepten((v) => ({
                    ...v,
                    [a.soort]: JSON.parse(JSON.stringify(origineel[a.soort])),
                  }))
                }
                onOpslaan={() => slaOp(a.soort)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TariefKaart({
  concept,
  btwPercentage,
  gewijzigd,
  bezig,
  onZet,
  onHerstel,
  onOpslaan,
}: {
  concept: Concept;
  btwPercentage: number | null;
  gewijzigd: boolean;
  bezig: boolean;
  onZet: (wijziging: Partial<Concept>) => void;
  onHerstel: () => void;
  onOpslaan: () => void;
}) {
  // Voorbeeldtotaal met alle blokken aan: een bovengrens die laat zien waar de
  // tarieven op uitkomen. Zelfde rekenwijze als genereer_testament.py: hele
  // centen, en de btw met eigen afronding.
  const voorbeeld = useMemo(() => {
    const honorarium =
      concept.basistarief_cent + concept.blokken.reduce((som, b) => som + b.prijs_cent, 0);
    const promille = Math.round((btwPercentage ?? 0) * 10);
    const btw = Math.floor((honorarium * promille + 500) / 1000);
    const verschotten = concept.verschotten.reduce((som, v) => som + v.bedrag_cent, 0);
    return { honorarium, btw, verschotten, totaal: honorarium + btw + verschotten };
  }, [concept, btwPercentage]);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Receipt className="h-4 w-4 text-azure" strokeWidth={2} />
          <h2 className="text-[15px] font-semibold text-ink-strong">{concept.naam}</h2>
          <span className="font-mono text-[10.5px] text-ink-soft">soort · {concept.soort}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onHerstel}
            disabled={!gewijzigd || bezig}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Herstellen
          </Button>
          <Button variant="primary" size="sm" onClick={onOpslaan} disabled={!gewijzigd || bezig}>
            {bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Opslaan
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Veld label="Basistarief" hint="Geldt voor elk concept van deze soort.">
              <EuroInvoer
                cent={concept.basistarief_cent}
                onChange={(cent) => onZet({ basistarief_cent: cent })}
                disabled={bezig}
              />
            </Veld>
            <Veld
              label="Tarief tweede testament"
              hint="Voor het spiegelbeeldige testament van de partner."
            >
              <EuroInvoer
                cent={concept.tarief_tweede_testament_cent}
                onChange={(cent) => onZet({ tarief_tweede_testament_cent: cent })}
                disabled={bezig}
              />
            </Veld>
          </div>

          {/* Verschotten */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
                Verschotten
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={bezig}
                onClick={() =>
                  onZet({
                    verschotten: [
                      ...concept.verschotten,
                      { naam: "", bedrag_cent: 0, per_testament: true },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Verschot toevoegen
              </Button>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-soft">
              Kosten die het kantoor voorschiet en zonder btw doorbelast, zoals de
              registratie in het Centraal Testamentenregister. Staat het vinkje aan, dan
              wordt het bedrag per testament gerekend.
            </p>
            {concept.verschotten.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-soft">
                Geen verschotten.
              </div>
            ) : (
              <div className="space-y-2">
                {concept.verschotten.map((v, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={v.naam}
                      onChange={(e) => {
                        const verschotten = [...concept.verschotten];
                        verschotten[i] = { ...v, naam: e.target.value };
                        onZet({ verschotten });
                      }}
                      placeholder="Registratie Centraal Testamentenregister"
                      disabled={bezig}
                      className="min-w-[16ch] flex-1"
                    />
                    <div className="w-32">
                      <EuroInvoer
                        cent={v.bedrag_cent}
                        onChange={(cent) => {
                          const verschotten = [...concept.verschotten];
                          verschotten[i] = { ...v, bedrag_cent: cent };
                          onZet({ verschotten });
                        }}
                        disabled={bezig}
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                      <input
                        type="checkbox"
                        checked={v.per_testament}
                        disabled={bezig}
                        onChange={(e) => {
                          const verschotten = [...concept.verschotten];
                          verschotten[i] = { ...v, per_testament: e.target.checked };
                          onZet({ verschotten });
                        }}
                        className="h-3.5 w-3.5 rounded border-line-strong accent-azure"
                      />
                      per testament
                    </label>
                    <button
                      type="button"
                      disabled={bezig}
                      aria-label="Verschot verwijderen"
                      onClick={() =>
                        onZet({ verschotten: concept.verschotten.filter((_, j) => j !== i) })
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger-pale hover:text-danger disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Prijs per blok */}
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
              Prijs per blok
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-ink-soft">
              De volgorde en de namen komen uit Akteblokken; hier zet je alleen wat elk
              blok kost. Blokken die altijd meegaan — de aanhef en de slotformule — zitten
              meestal in het basistarief en staan daarom op nul.
            </p>
            <div className="space-y-1.5">
              {concept.blokken.map((b, i) => (
                <div key={b.id} className="flex items-center gap-3">
                  <span className="w-6 flex-shrink-0 font-mono text-[11px] text-ink-soft">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                    {b.naam}
                    {b.altijd && (
                      <span className="ml-2 text-[11px] text-ink-soft">altijd</span>
                    )}
                  </span>
                  <div className="w-32 flex-shrink-0">
                    <EuroInvoer
                      cent={b.prijs_cent}
                      onChange={(cent) => {
                        const blokken = [...concept.blokken];
                        blokken[i] = { ...b, prijs_cent: cent };
                        onZet({ blokken });
                      }}
                      disabled={bezig}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Voorbeeldberekening */}
        <div className="h-fit rounded-md border border-line bg-wash/50 p-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Als alles meegaat
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
            Bovengrens voor één testament met elk blok aan. Een echt concept zit
            hieronder, want er gaan zelden alle blokken in.
          </p>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <Regel label="Honorarium" cent={voorbeeld.honorarium} />
            {btwPercentage !== null && (
              <Regel label={`Btw ${String(btwPercentage).replace(".", ",")}%`} cent={voorbeeld.btw} />
            )}
            {voorbeeld.verschotten > 0 && (
              <Regel label="Verschotten" cent={voorbeeld.verschotten} />
            )}
            <div className="border-t border-line pt-1.5">
              <Regel label="Totaal" cent={voorbeeld.totaal} vet />
            </div>
          </dl>
          {btwPercentage === null && (
            <p className="mt-2 text-[11.5px] text-amber">
              Btw-percentage niet opgehaald; stel het in onder Instellingen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Regel({ label, cent, vet }: { label: string; cent: number; vet?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-ink", vet && "font-semibold text-ink-strong")}>{label}</dt>
      <dd className={cn("font-mono text-ink-strong", vet && "font-semibold")}>
        € {centenNaarEuro(cent)}
      </dd>
    </div>
  );
}
