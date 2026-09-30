import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  ScrollText,
  Trash2,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AktePreview } from "@/components/AktePreview";
import { GenerationProgress, type ProgressState } from "@/components/GenerationProgress";
import { centenNaarEuro } from "@/components/beheer-bouwstenen";
import { jobIdVanAntwoord, wachtOpJob } from "@/lib/job-status";
import {
  berekenOfferte,
  onderbouwingVan,
  stelVoor,
  zonderGetalMarkering,
  type VerslagOnderwerp,
} from "@/lib/akteblokken";
import type { Aktesoort, Blok } from "@/components/AkteblokBeheer";

/**
 * Bouwt een concept-testament plus offerte uit tekstblokken.
 *
 * De blokken worden voorgesteld op basis van het besprekingsverslag — een blok
 * hangt aan een kopje, en kwam daar inhoud onder, dan staat het blok aan. Dat is
 * een voorstel, geen besluit: de behandelaar vinkt af. Er komt geen model aan te
 * pas, in lijn met hoe de rest van dit project met vorm en selectie omgaat.
 *
 * Bij een echtpaar worden twee testamenten gemaakt. Het tweede begint als kopie
 * van het eerste, maar mag daarna inhoudelijk afwijken — wat de een regelt hoeft
 * de ander niet te regelen. Wat de kopie NIET doet is namen omdraaien: "mijn
 * echtgenote" wordt niet automatisch "mijn echtgenoot". Zulke tekstmanipulatie
 * ziet er bij een fout precies zo uit als bij een goede uitkomst; de
 * overgenomen velden worden daarom zichtbaar gemarkeerd.
 */

const AKTEBLOKKEN_URL = "http://localhost:5678/webhook/akteblokken";
const KANTOOR_URL = "http://localhost:5678/webhook/kantoor";
const GENEREER_URL = "http://localhost:5678/webhook/testament";

const FASEN = ["Gegevens verzamelen", "Concept opmaken", "Offerte berekenen"];

export interface VerslagOverdracht {
  job_id: string | null;
  soort: string;
  dossier: string;
  datum: string;
  deelnemers: string[];
  onderwerpen: VerslagOnderwerp[];
}

interface Persoon {
  aanhef: string;
  naam_voluit: string;
  geboortedatum: string;
  geboorteplaats: string;
  adres: string;
}

interface TestamentOpzet {
  geselecteerd: string[];
  velden: Record<string, string>;
  /** Velden die uit het eerste testament zijn overgenomen en nog niet zijn nagelopen. */
  overgenomen: string[];
}

interface Document {
  soort: string;
  titel: string;
  bestandsnaam: string;
  download_url: string;
  preview_url: string;
  lege_velden?: string[];
}

interface Resultaat {
  documenten: Document[];
  totaal_cent: number | null;
  waarschuwingen: string[];
}

function leegPersoon(): Persoon {
  return { aanhef: "mevrouw", naam_voluit: "", geboortedatum: "", geboorteplaats: "", adres: "" };
}

export function TestamentBouwer({
  overdracht,
  onBack,
}: {
  overdracht: VerslagOverdracht | null;
  onBack: () => void;
}) {
  const [akte, setAkte] = useState<Aktesoort | null>(null);
  const [systeemvelden, setSysteemvelden] = useState<string[]>([]);
  const [btwPercentage, setBtwPercentage] = useState(21);
  const [laden, setLaden] = useState(true);
  const [laadFout, setLaadFout] = useState<string | null>(null);

  const [dossier, setDossier] = useState(overdracht?.dossier || "");
  const [datum, setDatum] = useState(
    overdracht?.datum || new Date().toLocaleDateString("nl-NL")
  );
  const [personen, setPersonen] = useState<Persoon[]>(() => {
    // Deelnemersnamen uit de bespreking als startpunt. Ze komen uit een
    // invoerveld van de behandelaar, niet uit Whisper, dus ze zijn bruikbaar —
    // maar het blijft een suggestie die tegen het dossier moet worden gelegd.
    const namen = (overdracht?.deelnemers || []).slice(0, 2);
    if (!namen.length) return [leegPersoon()];
    return namen.map((n) => ({ ...leegPersoon(), naam_voluit: n }));
  });
  const [opzetten, setOpzetten] = useState<TestamentOpzet[]>([]);
  const [actief, setActief] = useState(0);
  const [openBlok, setOpenBlok] = useState<string | null>(null);

  const [bezig, setBezig] = useState(false);
  const [fase, setFase] = useState(0);
  const [status, setStatus] = useState<ProgressState>("running");
  const [toonStatus, setToonStatus] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<Resultaat | null>(null);

  // --- Bibliotheek en kantoorgegevens ophalen ------------------------------
  const haalOp = useCallback(async () => {
    setLaden(true);
    setLaadFout(null);
    try {
      const res = await fetch(AKTEBLOKKEN_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Onbekende fout van n8n");
      const soort = (data.aktes || []).find(
        (a: Aktesoort) => a.soort === (overdracht?.soort || "testament")
      );
      if (!soort) {
        throw new Error(
          "Er zijn nog geen akteblokken voor een testament. Maak ze aan onder Templates → Akteblokken."
        );
      }
      setAkte(soort);
      setSysteemvelden(data.systeem_placeholders || []);
    } catch (err) {
      setLaadFout(err instanceof Error ? err.message : String(err));
    } finally {
      setLaden(false);
    }
  }, [overdracht?.soort]);

  useEffect(() => {
    haalOp();
  }, [haalOp]);

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
        /* 21% blijft staan */
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, []);

  // Zodra de blokken binnen zijn: één opzet per persoon, met het voorstel uit
  // het verslag. Draait één keer, daarna beheert de gebruiker de selectie.
  useEffect(() => {
    if (!akte || opzetten.length) return;
    const voorstel = stelVoor(akte.blokken, overdracht?.onderwerpen || null);
    setOpzetten(
      personen.map(() => ({ geselecteerd: [...voorstel], velden: {}, overgenomen: [] }))
    );
  }, [akte, opzetten.length, overdracht?.onderwerpen, personen]);

  const opzet = opzetten[actief];

  function zetOpzet(index: number, wijziging: Partial<TestamentOpzet>) {
    setOpzetten((v) => v.map((o, i) => (i === index ? { ...o, ...wijziging } : o)));
  }

  function voegPersoonToe() {
    if (!akte || personen.length >= 2) return;
    setPersonen((v) => [...v, { ...leegPersoon(), aanhef: "de heer" }]);
    // Het tweede testament begint als kopie van het eerste: dat is bijna altijd
    // het startpunt. De overgenomen velden worden gemarkeerd zodat zichtbaar
    // blijft wat nog moet worden nagelopen.
    setOpzetten((v) => {
      const eerste = v[0] || { geselecteerd: [], velden: {}, overgenomen: [] };
      return [
        ...v,
        {
          geselecteerd: [...eerste.geselecteerd],
          velden: { ...eerste.velden },
          overgenomen: Object.keys(eerste.velden).filter((k) => eerste.velden[k]?.trim()),
        },
      ];
    });
    setActief(1);
  }

  function verwijderPersoon(index: number) {
    setPersonen((v) => v.filter((_, i) => i !== index));
    setOpzetten((v) => v.filter((_, i) => i !== index));
    setActief(0);
  }

  const offerte = useMemo(() => {
    if (!akte || !opzetten.length) return null;
    return berekenOfferte(
      akte,
      btwPercentage,
      opzetten.map((o) => o.geselecteerd)
    );
  }, [akte, btwPercentage, opzetten]);

  const zonderNaam = personen.some((p) => !p.naam_voluit.trim());

  async function genereer() {
    if (!akte || !offerte) return;
    setBezig(true);
    setToonStatus(true);
    setStatus("running");
    setFase(0);
    setFout(null);
    setResultaat(null);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          soort: akte.soort,
          referentie: dossier.trim() || undefined,
          metadata: { dossier: dossier.trim(), datum: datum.trim() },
          herkomst: {
            job_id: overdracht?.job_id ?? null,
            verslag_datum: overdracht?.datum ?? null,
          },
          personen,
          testamenten: opzetten.map((o, i) => ({
            erflater: i,
            geselecteerd: o.geselecteerd,
            velden: o.velden,
          })),
          prijs_controle_cent: offerte.totaal_cent,
        })
      );
      setFase(1);
      const res = await fetch(GENEREER_URL, { method: "POST", body: form });
      const start = await res.json();
      if (start?.success === false) throw new Error(start.error || "Server weigerde de opdracht.");
      const jobId = jobIdVanAntwoord(start);
      if (!jobId) throw new Error("De server gaf geen job-id terug.");

      setFase(2);
      // wachtOpJob levert het `resultaat`-object zelf op, niet de hele job.
      const r = await wachtOpJob<Record<string, unknown>>(jobId);
      if (!r || r.success === false) {
        throw new Error((r?.error as string) || "Genereren mislukt.");
      }
      setResultaat({
        documenten: (r.documenten as Document[]) || [],
        totaal_cent: (r.totaal_cent as number) ?? null,
        waarschuwingen: (r.waarschuwingen as string[]) || [],
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setFout(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  // --- Weergave -------------------------------------------------------------
  if (laden) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-4 py-16 sm:px-8">
        <div className="flex items-center gap-2 text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Akteblokken laden…</span>
        </div>
      </div>
    );
  }

  if (laadFout || !akte) {
    return (
      <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-6">
          <ArrowLeft className="h-3.5 w-3.5" />
          Terug
        </Button>
        <div className="rounded-md border border-danger/30 border-l-4 border-l-danger bg-danger-pale p-4 text-sm">
          <div className="font-display font-bold text-ink-strong">Kan niet beginnen</div>
          <div className="mt-0.5 text-ink-soft">{laadFout}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-8">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-6">
        <ArrowLeft className="h-3.5 w-3.5" />
        Andere documentsoort
      </Button>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            <span className="h-1 w-1 rounded-full bg-seal" />
            Testament
          </span>
        </div>
        <h1 className="font-display text-[36px] font-medium leading-[1.05] text-ink-strong sm:text-[48px]">
          Concept en offerte samenstellen
        </h1>
        {overdracht ? (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink">
            De blokken hieronder zijn voorgesteld op basis van het besprekingsverslag:
            een kopje waar iets onder stond, zet het bijbehorende blok aan. Loop ze na
            en vul aan wat er nog ontbreekt.
          </p>
        ) : (
          <div className="mt-3 flex max-w-2xl items-start gap-2.5 rounded-md border border-line bg-wash/50 px-4 py-3 text-[13.5px] text-ink">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
            <div>
              Er is geen besprekingsverslag gekoppeld, dus alleen de vaste blokken staan
              aan. Kom je vanuit een testamentbespreking, dan worden de blokken vanzelf
              voorgesteld — gebruik daar de knop{" "}
              <span className="font-medium">Testament + offerte maken</span>.
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Cliëntgegevens */}
          <Paneel nummer="01" titel="Cliëntgegevens">
            <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
              Deze gegevens staan niet in het besprekingsverslag. Wat je leeg laat, komt
              geel gearceerd in het concept te staan.
              {overdracht?.deelnemers?.length ? (
                <>
                  {" "}
                  De namen zijn overgenomen uit het veld ‘Deelnemers’ van de bespreking;
                  controleer de schrijfwijze tegen het dossier.
                </>
              ) : null}
            </p>
            <div className="space-y-5">
              {personen.map((p, i) => (
                <PersoonRij
                  key={i}
                  index={i}
                  persoon={p}
                  verwijderbaar={personen.length > 1}
                  bezig={bezig}
                  onChange={(w) =>
                    setPersonen((v) => v.map((x, j) => (i === j ? { ...x, ...w } : x)))
                  }
                  onVerwijder={() => verwijderPersoon(i)}
                />
              ))}
            </div>
            {personen.length < 2 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={voegPersoonToe}
                disabled={bezig}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Tweede cliënt toevoegen
              </Button>
            )}
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line/70 pt-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
                  Dossiernummer
                </span>
                <Input
                  value={dossier}
                  onChange={(e) => setDossier(e.target.value)}
                  placeholder="2026.0554"
                  disabled={bezig}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
                  Datum
                </span>
                <Input
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                  disabled={bezig}
                />
              </label>
            </div>
          </Paneel>

          {/* Blokken */}
          <Paneel
            nummer="02"
            titel={personen.length > 1 ? "Inhoud per testament" : "Inhoud van het testament"}
          >
            {personen.length > 1 && (
              <div className="mb-4">
                <div className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
                  {personen.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActief(i)}
                      className={cn(
                        "rounded-[5px] px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                        actief === i
                          ? "bg-ink-strong text-paper"
                          : "text-ink-soft hover:bg-wash hover:text-ink-strong"
                      )}
                    >
                      {p.naam_voluit.trim() || `Cliënt ${i + 1}`}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
                  De twee testamenten zijn los van elkaar: wat je hier aan- of uitvinkt
                  geldt alleen voor het gekozen testament.
                  {opzetten[1]?.overgenomen.length ? (
                    <>
                      {" "}
                      Velden met de vermelding{" "}
                      <span className="italic">overgenomen</span> komen uit het eerste
                      testament en zijn nog niet nagelopen.
                    </>
                  ) : null}
                </p>
              </div>
            )}

            {opzet && (
              <div className="space-y-1.5">
                {akte.blokken.map((blok) => (
                  <BlokRegel
                    key={blok.id}
                    blok={blok}
                    aan={opzet.geselecteerd.includes(blok.id)}
                    open={openBlok === blok.id}
                    bezig={bezig}
                    velden={opzet.velden}
                    overgenomen={opzet.overgenomen}
                    systeemvelden={systeemvelden}
                    onderbouwing={onderbouwingVan(blok, overdracht?.onderwerpen || null)}
                    heeftVerslag={!!overdracht}
                    onToggleOpen={() => setOpenBlok(openBlok === blok.id ? null : blok.id)}
                    onToggleAan={() =>
                      zetOpzet(actief, {
                        geselecteerd: opzet.geselecteerd.includes(blok.id)
                          ? opzet.geselecteerd.filter((x) => x !== blok.id)
                          : [...opzet.geselecteerd, blok.id],
                      })
                    }
                    onZetVeld={(naam, waarde) =>
                      zetOpzet(actief, {
                        velden: { ...opzet.velden, [naam]: waarde },
                        overgenomen: opzet.overgenomen.filter((x) => x !== naam),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </Paneel>

          {toonStatus && (
            <GenerationProgress
              phases={FASEN}
              phase={fase}
              state={status}
              errorMessage={fout}
            />
          )}

          {resultaat && (
            <Paneel nummer="03" titel="Klaar">
              {resultaat.waarschuwingen.length > 0 && (
                <div className="mb-4 flex gap-2.5 rounded-md border border-amber/40 bg-amber/8 px-4 py-3 text-[13px] text-ink">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber" strokeWidth={2} />
                  <div className="space-y-1">
                    {resultaat.waarschuwingen.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {resultaat.documenten.map((d) => (
                  <div
                    key={d.bestandsnaam}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-wash/40 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {d.soort === "offerte" ? (
                        <ScrollText className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
                      ) : (
                        <FileText className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-ink-strong">
                          {d.titel}
                        </div>
                        <div className="truncate font-mono text-[11px] text-ink-soft">
                          {d.bestandsnaam}
                          {d.lege_velden?.length
                            ? ` · ${d.lege_velden.length} nog in te vullen`
                            : ""}
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={d.download_url} download>
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
              {resultaat.documenten[0] && (
                <div className="mt-5">
                  <AktePreview
                    url={resultaat.documenten[0].preview_url}
                    filename={resultaat.documenten[0].bestandsnaam}
                  />
                </div>
              )}
            </Paneel>
          )}
        </div>

        {/* Prijsoverzicht */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Offerte
            </div>
            {offerte && (
              <dl className="mt-3 space-y-1.5 text-[13px]">
                {offerte.regels.map((r, i) => (
                  <Bedrag key={i} label={r.omschrijving} cent={r.bedrag_cent} />
                ))}
                <div className="border-t border-line pt-1.5">
                  <Bedrag label="Honorarium" cent={offerte.honorarium_cent} vet />
                </div>
                <Bedrag
                  label={`Btw ${String(btwPercentage).replace(".", ",")}%`}
                  cent={offerte.btw_cent}
                />
                {offerte.verschotten.map((v, i) => (
                  <Bedrag
                    key={i}
                    label={v.aantal > 1 ? `${v.omschrijving} (${v.aantal}×)` : v.omschrijving}
                    cent={v.bedrag_cent}
                  />
                ))}
                <div className="border-t border-line pt-1.5">
                  <Bedrag label="Totaal" cent={offerte.totaal_cent} vet />
                </div>
              </dl>
            )}

            <Button
              className="mt-5 w-full"
              variant="primary"
              onClick={genereer}
              disabled={bezig || !opzetten.length}
            >
              {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
              Concept en offerte maken
            </Button>
            {zonderNaam && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-amber">
                Er staat nog een cliënt zonder naam. Dat mag — het veld komt dan geel
                gearceerd in het concept.
              </p>
            )}
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
              Levert {personen.length > 1 ? "twee concepten" : "één concept"} en een offerte
              op als Word-bestand. Een concept is een dossierstuk, geen akte.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Paneel({
  nummer,
  titel,
  children,
}: {
  nummer: string;
  titel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        <span className="font-mono text-[11px] text-ink-soft">{nummer}</span>
        <h2 className="text-[15px] font-semibold text-ink-strong">{titel}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function PersoonRij({
  index,
  persoon,
  verwijderbaar,
  bezig,
  onChange,
  onVerwijder,
}: {
  index: number;
  persoon: Persoon;
  verwijderbaar: boolean;
  bezig: boolean;
  onChange: (w: Partial<Persoon>) => void;
  onVerwijder: () => void;
}) {
  return (
    <div className="rounded-md border border-line bg-wash/30 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Cliënt {index + 1}
        </span>
        {verwijderbaar && (
          <button
            type="button"
            onClick={onVerwijder}
            disabled={bezig}
            aria-label={`Cliënt ${index + 1} verwijderen`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger-pale hover:text-danger disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[11px] text-ink-soft">Aanhef</span>
          <select
            value={persoon.aanhef}
            onChange={(e) => onChange({ aanhef: e.target.value })}
            disabled={bezig}
            className={cn(
              "flex h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink-strong",
              "focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15",
              "disabled:opacity-50"
            )}
          >
            <option value="mevrouw">mevrouw</option>
            <option value="de heer">de heer</option>
          </select>
        </label>
        <label className="sm:col-span-4">
          <span className="mb-1 block text-[11px] text-ink-soft">Naam voluit</span>
          <Input
            value={persoon.naam_voluit}
            onChange={(e) => onChange({ naam_voluit: e.target.value })}
            placeholder="Johanna Maria de Vries"
            disabled={bezig}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[11px] text-ink-soft">Geboortedatum</span>
          <Input
            value={persoon.geboortedatum}
            onChange={(e) => onChange({ geboortedatum: e.target.value })}
            placeholder="14-03-1978"
            disabled={bezig}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[11px] text-ink-soft">Geboorteplaats</span>
          <Input
            value={persoon.geboorteplaats}
            onChange={(e) => onChange({ geboorteplaats: e.target.value })}
            placeholder="Gorinchem"
            disabled={bezig}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[11px] text-ink-soft">Adres</span>
          <Input
            value={persoon.adres}
            onChange={(e) => onChange({ adres: e.target.value })}
            placeholder="Kerkstraat 12, Woudrichem"
            disabled={bezig}
          />
        </label>
      </div>
    </div>
  );
}

function BlokRegel({
  blok,
  aan,
  open,
  bezig,
  velden,
  overgenomen,
  systeemvelden,
  onderbouwing,
  heeftVerslag,
  onToggleOpen,
  onToggleAan,
  onZetVeld,
}: {
  blok: Blok;
  aan: boolean;
  open: boolean;
  bezig: boolean;
  velden: Record<string, string>;
  overgenomen: string[];
  systeemvelden: string[];
  onderbouwing: ReturnType<typeof onderbouwingVan>;
  heeftVerslag: boolean;
  onToggleOpen: () => void;
  onToggleAan: () => void;
  onZetVeld: (naam: string, waarde: string) => void;
}) {
  const systeem = new Set(systeemvelden.map((s) => s.replace(/^<<|>>$/g, "")));
  const invulbaar = blok.velden.filter((v) => !systeem.has(v.naam));
  const voorgesteld = !blok.altijd && !!onderbouwing?.punten.length;
  const uitTeVullen = invulbaar.filter((v) => !velden[v.naam]?.trim()).length;

  return (
    <div
      className={cn(
        "rounded-md border transition-colors",
        aan ? "border-line bg-surface" : "border-line/60 bg-wash/20"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          type="checkbox"
          checked={aan}
          disabled={bezig || blok.altijd}
          onChange={onToggleAan}
          aria-label={`${blok.naam} opnemen`}
          className="h-4 w-4 flex-shrink-0 rounded border-line-strong accent-azure disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-ink-soft" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-ink-soft" strokeWidth={2} />
          )}
          <span
            className={cn(
              "truncate text-[14px]",
              aan ? "font-medium text-ink-strong" : "text-ink-soft"
            )}
          >
            {blok.naam}
          </span>
          {blok.altijd ? (
            <Badge variant="outline">altijd</Badge>
          ) : voorgesteld ? (
            <Badge variant="success">voorgesteld</Badge>
          ) : null}
          {aan && uitTeVullen > 0 && (
            <span className="flex-shrink-0 text-[11.5px] text-amber">
              {uitTeVullen} in te vullen
            </span>
          )}
          <span className="ml-auto flex-shrink-0 font-mono text-[11.5px] text-ink-soft">
            {blok.prijs_cent ? `+ € ${centenNaarEuro(blok.prijs_cent)}` : "—"}
          </span>
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-line/70 px-4 py-4 lg:grid-cols-2">
          {/* Uit het verslag */}
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Uit het verslag
            </div>
            {!heeftVerslag ? (
              <p className="text-[12.5px] italic text-ink-mute">Geen verslag gekoppeld.</p>
            ) : !blok.kop ? (
              <p className="text-[12.5px] italic text-ink-mute">
                Vast onderdeel, niet aan een kopje gekoppeld.
              </p>
            ) : onderbouwing?.punten.length ? (
              <ul className="space-y-1.5">
                {onderbouwing.punten.map((punt, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink">
                    <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-ink-mute" />
                    <span>{punt}</span>
                  </li>
                ))}
              </ul>
            ) : onderbouwing?.terSprake ? (
              <p className="text-[12.5px] italic text-ink-mute">
                Kwam ter sprake (“{onderbouwing.terSprake}”), geen uitkomst vastgelegd.
              </p>
            ) : (
              <p className="text-[12.5px] italic text-ink-mute">Niet vastgelegd.</p>
            )}
          </div>

          {/* In te vullen */}
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              In te vullen
            </div>
            {invulbaar.length === 0 ? (
              <p className="text-[12.5px] italic text-ink-mute">
                Dit blok heeft overal dezelfde tekst.
              </p>
            ) : (
              <div className="space-y-3">
                {invulbaar.map((v) => (
                  <div key={v.naam}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[11px] text-ink-soft">{v.label || v.naam}</span>
                      {overgenomen.includes(v.naam) && (
                        <span className="text-[10.5px] italic text-amber">overgenomen</span>
                      )}
                      {onderbouwing?.punten.length ? (
                        <button
                          type="button"
                          disabled={bezig}
                          title="Neem het eerste verslagpunt over in dit veld"
                          onClick={() =>
                            onZetVeld(v.naam, zonderGetalMarkering(onderbouwing.punten[0]))
                          }
                          className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-ink-soft transition-colors hover:text-azure"
                        >
                          <Copy className="h-3 w-3" strokeWidth={2} />
                          uit verslag
                        </button>
                      ) : null}
                    </div>
                    <Input
                      value={velden[v.naam] || ""}
                      onChange={(e) => onZetVeld(v.naam, e.target.value)}
                      disabled={bezig}
                      className={cn(overgenomen.includes(v.naam) && "border-amber/60")}
                    />
                    {v.hint && (
                      <p className="mt-1 text-[11px] leading-snug text-ink-soft">{v.hint}</p>
                    )}
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

function Bedrag({ label, cent, vet }: { label: string; cent: number; vet?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-ink", vet && "font-semibold text-ink-strong")}>{label}</dt>
      <dd className={cn("font-mono text-ink-strong", vet && "font-semibold")}>
        € {centenNaarEuro(cent)}
      </dd>
    </div>
  );
}
