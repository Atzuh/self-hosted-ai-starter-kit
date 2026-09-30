import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DocxPreviewModal, type DocxPreviewDoel } from "@/components/DocxPreviewModal";
import { Veld, Woordenveld } from "@/components/beheer-bouwstenen";

/**
 * Beheer van de bespreeksjablonen in `shared/templates/besprekingen/`.
 *
 * Anders dan bij de banktemplates is er geen registry: elk .json-bestand in die
 * map is één soort bespreking. bespreking-workflow.json leest ze rechtstreeks —
 * voor de soort-herkenning, de samenvatting per transcriptblok, de verslagprompt
 * en het deterministisch ordenen van de secties.
 *
 * Wat je hier bewerkt gaat dus letterlijk het model in: de `aanwijzing` van een
 * sectie staat in de prompt, en de `trefwoorden` doen de voorselectie zónder
 * model. Daarom bewaart de backend bij elke opslag de vorige versie.
 */

const LIJST_URL = "http://localhost:5678/webhook/bespreeksjablonen";
const OPSLAAN_URL = "http://localhost:5678/webhook/bespreeksjabloon";
const BRON_UPLOAD_URL = "http://localhost:5678/webhook/upload-bespreekformulier";

/** Kleine letters, geen cijfers of leestekens — zie `valideer()` voor het waarom. */
const SOORT_PATROON = /^[a-z]{2,40}$/;

export interface Sectie {
  kop: string;
  aanwijzing: string;
  trefwoorden: string[];
  altijd_nacontrole?: boolean;
}

export interface Versie {
  versie_id: string;
  opgeslagen_op: string | null;
  grootte: number | null;
}

export interface Sjabloon {
  soort: string;
  naam: string;
  bestand: string;
  toelichting: string;
  herken_op: string[];
  secties: Sectie[];
  bron: string | null;
  bron_bestaat: boolean;
  bron_grootte: number | null;
  gewijzigd_op: string | null;
  versies: Versie[];
}

/** Soort waarvan alleen nog versiehistorie over is: verwijderd, maar terug te halen. */
export interface VerwijderdSjabloon {
  soort: string;
  versies: Versie[];
}

interface LijstResponse {
  success: boolean;
  sjablonen?: Sjabloon[];
  verwijderd?: VerwijderdSjabloon[];
  gereserveerde_soorten?: string[];
  onleesbaar?: Array<{ bestand: string; fout: string }>;
  error?: string;
}

/** Bewerkbare kopie van een sjabloon; `isNieuw` bepaalt of de soort nog vrij is. */
interface Concept {
  soort: string;
  naam: string;
  toelichting: string;
  herken_op: string[];
  secties: Sectie[];
  bron: string | null;
  isNieuw: boolean;
}

function bronUrl(bestandsnaam: string): string {
  return `/templates/besprekingen/${encodeURIComponent(bestandsnaam)}`;
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

function formatGrootte(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function conceptVan(s: Sjabloon): Concept {
  return {
    soort: s.soort,
    naam: s.naam,
    toelichting: s.toelichting,
    herken_op: [...s.herken_op],
    secties: s.secties.map((sec) => ({ ...sec, trefwoorden: [...sec.trefwoorden] })),
    bron: s.bron,
    isNieuw: false,
  };
}

function leegConcept(): Concept {
  return {
    soort: "",
    naam: "",
    toelichting: "",
    herken_op: [],
    secties: [{ kop: "", aanwijzing: "", trefwoorden: [] }],
    bron: null,
    isNieuw: true,
  };
}

/**
 * Dezelfde regels als de n8n-node hanteert, zodat de gebruiker fouten ziet
 * vóórdat er iets over de lijn gaat. De backend blijft leidend — dit is comfort,
 * geen beveiliging.
 */
function valideer(c: Concept, bezetteSoorten: string[], gereserveerd: string[]): string[] {
  const fouten: string[] = [];

  if (!SOORT_PATROON.test(c.soort)) {
    fouten.push(
      "Soort moet 2 tot 40 kleine letters zijn, zonder spaties, cijfers of leestekens."
    );
  } else if (gereserveerd.includes(c.soort)) {
    fouten.push(`'${c.soort}' is gereserveerd en betekent juist 'geen vaste indeling'.`);
  } else if (c.isNieuw && bezetteSoorten.includes(c.soort)) {
    fouten.push(`Er bestaat al een sjabloon met soort '${c.soort}'.`);
  }

  if (!c.naam.trim()) fouten.push("Naam is verplicht.");
  if (!c.secties.length) fouten.push("Een sjabloon heeft minstens één sectie nodig.");

  const gezien = new Set<string>();
  c.secties.forEach((sec, i) => {
    const kop = sec.kop.trim();
    if (!kop) {
      fouten.push(`Sectie ${i + 1} heeft geen kop.`);
      return;
    }
    // Twee gelijke kopjes zijn funest: 'Orden Secties' verdeelt de punten op
    // koptekst, dus alles zou onder de eerste belanden.
    const sleutel = kop.toLowerCase();
    if (gezien.has(sleutel)) fouten.push(`Kop '${kop}' komt meer dan één keer voor.`);
    gezien.add(sleutel);
  });

  return fouten;
}

export function BespreeksjabloonBeheer() {
  const [sjablonen, setSjablonen] = useState<Sjabloon[] | null>(null);
  const [verwijderd, setVerwijderd] = useState<VerwijderdSjabloon[]>([]);
  const [gereserveerd, setGereserveerd] = useState<string[]>(["auto", "algemeen"]);
  const [onleesbaar, setOnleesbaar] = useState<Array<{ bestand: string; fout: string }>>([]);
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ tekst: string; soort: "ok" | "fout" } | null>(null);

  const [concept, setConcept] = useState<Concept | null>(null);
  const [opslaan, setOpslaan] = useState(false);
  const [opslagFouten, setOpslagFouten] = useState<string[]>([]);
  const [versiesOpen, setVersiesOpen] = useState<string | null>(null);
  /** Soort waarvoor de verwijderknop op bevestiging staat te wachten. */
  const [bevestigWeg, setBevestigWeg] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocxPreviewDoel | null>(null);

  const haalOp = useCallback(async () => {
    setLaden(true);
    setFout(null);
    // Net als bij de banktemplates: de bind-mount kan een I/O-fout geven, dus
    // een paar keer proberen voordat we de gebruiker lastigvallen.
    let laatsteFout = "Onbekende fout";
    for (let poging = 1; poging <= 3; poging++) {
      try {
        const res = await fetch(LIJST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = (await res.json()) as LijstResponse;
        if (!data.success) throw new Error(data.error || "Onbekende fout van n8n");
        setSjablonen(data.sjablonen || []);
        setVerwijderd(data.verwijderd || []);
        setGereserveerd(data.gereserveerde_soorten || ["auto", "algemeen"]);
        setOnleesbaar(data.onleesbaar || []);
        setLaden(false);
        return;
      } catch (err) {
        laatsteFout = err instanceof Error ? err.message : String(err);
        if (poging < 3) await new Promise((r) => setTimeout(r, poging * 400));
      }
    }
    setFout(laatsteFout);
    setSjablonen(null);
    setLaden(false);
  }, []);

  useEffect(() => {
    haalOp();
  }, [haalOp]);

  const bezetteSoorten = useMemo(
    () => (sjablonen || []).map((s) => s.soort),
    [sjablonen]
  );

  async function verstuur(payload: unknown): Promise<Record<string, unknown>> {
    // Bewust multipart en geen application/json: dat laatste lokt een
    // CORS-preflight uit naar n8n op een andere poort.
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
        (geparsed?.error as string) || `HTTP ${res.status}: ${tekst.slice(0, 200) || "leeg antwoord"}`
      );
    }
    if (geparsed.success === false) {
      throw new Error((geparsed.error as string) || "Opslaan mislukt");
    }
    return geparsed;
  }

  async function slaOp() {
    if (!concept) return;
    const lokaleFouten = valideer(concept, bezetteSoorten, gereserveerd);
    if (lokaleFouten.length) {
      setOpslagFouten(lokaleFouten);
      return;
    }
    setOpslagFouten([]);
    setOpslaan(true);
    try {
      const antwoord = await verstuur({
        actie: "opslaan",
        nieuw: concept.isNieuw,
        sjabloon: {
          soort: concept.soort,
          naam: concept.naam.trim(),
          toelichting: concept.toelichting.trim(),
          herken_op: concept.herken_op,
          secties: concept.secties,
          bron: concept.bron,
        },
      });
      const waarschuwingen = (antwoord.waarschuwingen as string[]) || [];
      setMelding({
        soort: "ok",
        tekst:
          `Sjabloon '${concept.naam}' opgeslagen.` +
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
        tekst:
          `Sjabloon '${soort}' teruggezet naar de versie van ` +
          `${formatDatum(versie.opgeslagen_op)}. De versie van vlak daarvoor is bewaard.`,
      });
      setVersiesOpen(null);
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  async function verwijder(sjabloon: Sjabloon) {
    setOpslaan(true);
    try {
      await verstuur({ actie: "verwijderen", soort: sjabloon.soort });
      setMelding({
        soort: "ok",
        tekst:
          `Sjabloon '${sjabloon.naam}' verwijderd. Het staat nog in de ` +
          `versiehistorie en is hieronder terug te zetten.`,
      });
      setBevestigWeg(null);
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  async function haalTerug(item: VerwijderdSjabloon) {
    const nieuwste = item.versies[0];
    if (!nieuwste) return;
    setOpslaan(true);
    try {
      await verstuur({ actie: "herstellen", soort: item.soort, versie_id: nieuwste.versie_id });
      setMelding({
        soort: "ok",
        tekst: `Sjabloon '${item.soort}' teruggezet, zoals het was op ${formatDatum(nieuwste.opgeslagen_op)}.`,
      });
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  async function uploadBron(soort: string, bestand: File) {
    if (!bestand.name.toLowerCase().endsWith(".docx")) {
      setMelding({ soort: "fout", tekst: "Alleen .docx-bestanden zijn toegestaan." });
      return;
    }
    setOpslaan(true);
    try {
      const form = new FormData();
      form.append("soort", soort);
      form.append("file", bestand, bestand.name);
      const res = await fetch(BRON_UPLOAD_URL, { method: "POST", body: form });
      const tekst = await res.text();
      let geparsed: { success?: boolean; error?: string; bron?: string } | null = null;
      try {
        geparsed = JSON.parse(tekst);
      } catch {
        /* ruwe tekst tonen */
      }
      if (!res.ok || !geparsed || geparsed.success === false) {
        throw new Error(
          geparsed?.error || `HTTP ${res.status}: ${tekst.slice(0, 200) || "leeg antwoord"}`
        );
      }
      setMelding({ soort: "ok", tekst: `Bespreekformulier '${geparsed.bron}' gekoppeld aan '${soort}'.` });
      await haalOp();
    } catch (err) {
      setMelding({ soort: "fout", tekst: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpslaan(false);
    }
  }

  // --- Editor ---------------------------------------------------------------
  if (concept) {
    return (
      <>
        <SjabloonEditor
          concept={concept}
          onChange={setConcept}
          onAnnuleer={() => {
            setConcept(null);
            setOpslagFouten([]);
          }}
          onOpslaan={slaOp}
          bezig={opslaan}
          fouten={opslagFouten}
        />
        {preview && <DocxPreviewModal doel={preview} onClose={() => setPreview(null)} />}
      </>
    );
  }

  // --- Overzicht ------------------------------------------------------------
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[14px] leading-relaxed text-ink-soft">
          Elk sjabloon legt de vaste kopjes van een besprekingsverslag vast. De
          aanwijzing per kopje gaat letterlijk naar het model; de trefwoorden
          bepalen zonder model welke kopjes in een transcriptdeel aan de orde
          kunnen zijn. Bij elke wijziging wordt de vorige versie bewaard.
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
            Nieuw sjabloon
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
              Kon bespreeksjablonen niet ophalen
            </div>
            <div className="mt-0.5 text-ink-soft">{fout}</div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">GET {LIJST_URL}</div>
          </div>
        </div>
      )}

      {onleesbaar.length > 0 && (
        <div className="mb-6 rounded-md border border-amber/30 border-l-4 border-l-amber bg-amber-pale p-4 text-sm">
          <div className="font-display font-bold text-ink-strong">
            Onleesbare bestanden in de sjabloonmap
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

      {!sjablonen && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-ink-strong" />
          Sjablonen laden…
        </div>
      )}

      {sjablonen && sjablonen.length === 0 && !fout && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          Nog geen bespreeksjablonen. Maak er een aan met{" "}
          <span className="font-medium text-ink-strong">Nieuw sjabloon</span>.
        </div>
      )}

      {sjablonen && sjablonen.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sjablonen.map((s) => (
            <SjabloonKaart
              key={s.soort}
              sjabloon={s}
              bezig={opslaan}
              versiesOpen={versiesOpen === s.soort}
              onToggleVersies={() =>
                setVersiesOpen(versiesOpen === s.soort ? null : s.soort)
              }
              onBewerk={() => {
                setConcept(conceptVan(s));
                setOpslagFouten([]);
                setMelding(null);
              }}
              onHerstel={(versie) => herstel(s.soort, versie)}
              bevestigWeg={bevestigWeg === s.soort}
              onVraagVerwijder={() =>
                setBevestigWeg(bevestigWeg === s.soort ? null : s.soort)
              }
              onVerwijder={() => verwijder(s)}
              onUploadBron={(bestand) => uploadBron(s.soort, bestand)}
              onPreviewBron={() =>
                s.bron &&
                setPreview({
                  titel: `${s.naam} — bespreekformulier`,
                  bestandsnaam: s.bron,
                  url: bronUrl(s.bron),
                })
              }
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
            Van deze soorten staat alleen nog versiehistorie op schijf. Terugzetten
            haalt de laatst bewaarde versie terug als actief sjabloon.
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={opslaan}
                  onClick={() => haalTerug(v)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Terugzetten
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && <DocxPreviewModal doel={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overzichtskaart
// ---------------------------------------------------------------------------

function SjabloonKaart({
  sjabloon,
  bezig,
  versiesOpen,
  onToggleVersies,
  onBewerk,
  onHerstel,
  onUploadBron,
  onPreviewBron,
  bevestigWeg,
  onVraagVerwijder,
  onVerwijder,
}: {
  sjabloon: Sjabloon;
  bezig: boolean;
  versiesOpen: boolean;
  onToggleVersies: () => void;
  onBewerk: () => void;
  onHerstel: (versie: Versie) => void;
  onUploadBron: (bestand: File) => void;
  onPreviewBron: () => void;
  bevestigWeg: boolean;
  onVraagVerwijder: () => void;
  onVerwijder: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zonderAanwijzing = sjabloon.secties.filter((s) => !s.aanwijzing.trim()).length;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
            {sjabloon.naam}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-ink-soft">
            soort · {sjabloon.soort}
          </div>
        </div>
        <Badge variant="azure">{sjabloon.secties.length} secties</Badge>
      </div>

      {sjabloon.toelichting && (
        <p className="line-clamp-3 text-[13px] leading-relaxed text-ink-soft">
          {sjabloon.toelichting}
        </p>
      )}

      <div className="border-t border-line/70 pt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Herkent de bespreking aan
        </div>
        {sjabloon.herken_op.length ? (
          <div className="flex flex-wrap gap-1">
            {sjabloon.herken_op.map((w) => (
              <Badge key={w} variant="outline">
                {w}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-ink-soft">
            Niets — alleen handmatig te kiezen in het besprekingsformulier.
          </div>
        )}
      </div>

      <div className="border-t border-line/70 pt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Kopjes
        </div>
        <div className="text-[12.5px] leading-relaxed text-ink">
          {sjabloon.secties.map((s) => s.kop).join(" · ")}
        </div>
        {zonderAanwijzing > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-amber">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
            {zonderAanwijzing} {zonderAanwijzing === 1 ? "kopje heeft" : "kopjes hebben"} geen
            aanwijzing voor het model.
          </div>
        )}
      </div>

      <div className="border-t border-line/70 pt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Bespreekformulier (bron)
        </div>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="break-all font-mono text-[12.5px] font-medium text-ink-strong">
              {sjabloon.bron ?? "—"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">
              {sjabloon.bron
                ? sjabloon.bron_bestaat
                  ? `${formatGrootte(sjabloon.bron_grootte)} · alleen ter vergelijking, de workflow leest dit niet`
                  : "bestand ontbreekt in de sjabloonmap"
                : "geen formulier gekoppeld"}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const bestand = e.target.files?.[0];
              if (bestand) onUploadBron(bestand);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onPreviewBron}
            disabled={!sjabloon.bron || !sjabloon.bron_bestaat}
          >
            <Eye className="h-3.5 w-3.5" />
            Bekijken
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={bezig}
          >
            <Upload className="h-3.5 w-3.5" />
            {sjabloon.bron ? "Vervangen" : "Koppelen"}
          </Button>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-4">
        <div className="font-mono text-[11px] text-ink-soft">
          gewijzigd {formatDatum(sjabloon.gewijzigd_op)}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleVersies}
            disabled={!sjabloon.versies.length}
          >
            <History className="h-3.5 w-3.5" />
            {sjabloon.versies.length} {sjabloon.versies.length === 1 ? "versie" : "versies"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onVraagVerwijder}
            disabled={bezig}
            aria-label={`${sjabloon.naam} verwijderen`}
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
            <span className="font-semibold text-ink-strong">{sjabloon.naam}</span> verwijderen?
            Besprekingen van dit soort krijgen daarna geen vaste indeling meer.
            {sjabloon.herken_op.length > 0 && (
              <> Ook de herkenning op {sjabloon.herken_op.join(", ")} vervalt.</>
            )}{" "}
            Het sjabloon gaat naar de versiehistorie en is terug te zetten.
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={onVerwijder}
              disabled={bezig}
            >
              {bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Ja, verwijderen
            </Button>
            <Button variant="outline" size="sm" onClick={onVraagVerwijder} disabled={bezig}>
              Annuleren
            </Button>
          </div>
        </div>
      )}

      {versiesOpen && sjabloon.versies.length > 0 && (
        <div className="rounded-md border border-line bg-wash/50 p-3">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Eerdere versies
          </div>
          <ul className="space-y-1.5">
            {sjabloon.versies.map((v) => (
              <li key={v.versie_id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11.5px] text-ink">
                  {formatDatum(v.opgeslagen_op)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bezig}
                  onClick={() => onHerstel(v)}
                >
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

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function SjabloonEditor({
  concept,
  onChange,
  onAnnuleer,
  onOpslaan,
  bezig,
  fouten,
}: {
  concept: Concept;
  onChange: (c: Concept) => void;
  onAnnuleer: () => void;
  onOpslaan: () => void;
  bezig: boolean;
  fouten: string[];
}) {
  const [openSectie, setOpenSectie] = useState<number | null>(
    concept.isNieuw ? 0 : null
  );

  function zetSectie(index: number, sectie: Sectie) {
    const secties = [...concept.secties];
    secties[index] = sectie;
    onChange({ ...concept, secties });
  }

  function verplaats(index: number, richting: -1 | 1) {
    const doel = index + richting;
    if (doel < 0 || doel >= concept.secties.length) return;
    const secties = [...concept.secties];
    [secties[index], secties[doel]] = [secties[doel], secties[index]];
    onChange({ ...concept, secties });
    setOpenSectie(openSectie === index ? doel : openSectie === doel ? index : openSectie);
  }

  function verwijder(index: number) {
    onChange({ ...concept, secties: concept.secties.filter((_, i) => i !== index) });
    setOpenSectie(null);
  }

  function voegToe() {
    const secties = [...concept.secties, { kop: "", aanwijzing: "", trefwoorden: [] }];
    onChange({ ...concept, secties });
    setOpenSectie(secties.length - 1);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[26px] font-medium leading-tight text-ink-strong">
            {concept.isNieuw ? "Nieuw bespreeksjabloon" : `${concept.naam || concept.soort} bewerken`}
          </h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
            Wijzigingen gaan direct in bij de volgende bespreking van dit soort.
            De vorige versie wordt bij het opslaan bewaard.
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
          <div className="font-display font-bold text-ink-strong">
            Nog niet opgeslagen
          </div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-ink-soft">
            {fouten.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
        <Veld label="Naam" hint="Zoals de behandelaar het in het besprekingsformulier ziet.">
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
              ? "Bestandsnaam en sleutel. Alleen kleine letters — de workflow zoekt het bestand zo op."
              : "Ligt vast: de workflow zoekt het sjabloonbestand op deze naam."
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
        <div className="sm:col-span-2">
          <Veld
            label="Herkenwoorden"
            hint="Valt een van deze woorden in het onderwerp of dossiernummer, dan kiest de workflow dit sjabloon vanzelf. Het langste passende woord wint."
          >
            <Woordenveld
              waarden={concept.herken_op}
              onChange={(herken_op) => onChange({ ...concept, herken_op })}
              placeholder="woord toevoegen en op Enter drukken"
              disabled={bezig}
            />
          </Veld>
        </div>
        <div className="sm:col-span-2">
          <Veld label="Toelichting" hint="Alleen voor collega's; gaat niet naar het model.">
            <textarea
              value={concept.toelichting}
              onChange={(e) => onChange({ ...concept, toelichting: e.target.value })}
              rows={3}
              disabled={bezig}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-strong transition-colors focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15 disabled:opacity-50"
            />
          </Veld>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Secties · {concept.secties.length}
        </h3>
        <Button variant="outline" size="sm" onClick={voegToe} disabled={bezig}>
          <Plus className="h-3.5 w-3.5" />
          Sectie toevoegen
        </Button>
      </div>

      <div className="space-y-2">
        {concept.secties.map((sectie, i) => (
          <SectieRij
            key={i}
            index={i}
            aantal={concept.secties.length}
            sectie={sectie}
            open={openSectie === i}
            bezig={bezig}
            onToggle={() => setOpenSectie(openSectie === i ? null : i)}
            onChange={(s) => zetSectie(i, s)}
            onOmhoog={() => verplaats(i, -1)}
            onOmlaag={() => verplaats(i, 1)}
            onVerwijder={() => verwijder(i)}
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

function SectieRij({
  index,
  aantal,
  sectie,
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
  sectie: Sectie;
  open: boolean;
  bezig: boolean;
  onToggle: () => void;
  onChange: (s: Sectie) => void;
  onOmhoog: () => void;
  onOmlaag: () => void;
  onVerwijder: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface shadow-card">
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
          <span className="w-6 flex-shrink-0 font-mono text-[11px] text-ink-soft">
            {index + 1}.
          </span>
          <span className="truncate text-[14px] font-medium text-ink-strong">
            {sectie.kop || <span className="text-ink-soft">(nog geen kop)</span>}
          </span>
          {!sectie.aanwijzing.trim() && (
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber" strokeWidth={2.25} />
          )}
          <span className="ml-auto flex-shrink-0 font-mono text-[11px] text-ink-soft">
            {sectie.trefwoorden.length} trefw.
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
            aria-label="Sectie verwijderen"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger-pale hover:text-danger disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line/70 px-4 py-4">
          <Veld label="Kop" hint="Komt letterlijk zo in het verslag te staan.">
            <Input
              value={sectie.kop}
              onChange={(e) => onChange({ ...sectie, kop: e.target.value })}
              placeholder="Familiesituatie"
              disabled={bezig}
            />
          </Veld>
          <Veld
            label="Aanwijzing"
            hint="Gaat letterlijk de prompt in: wat hoort er onder dit kopje? Laat het niet leeg — dan heeft het model alleen de kop als houvast."
          >
            <textarea
              value={sectie.aanwijzing}
              onChange={(e) => onChange({ ...sectie, aanwijzing: e.target.value })}
              rows={4}
              disabled={bezig}
              placeholder="Burgerlijke staat en het huwelijksregime, met de reden erbij…"
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-strong transition-colors focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15 disabled:opacity-50"
            />
          </Veld>
          <Veld
            label="Trefwoorden"
            hint="Vallen deze woorden in een transcriptdeel, dan wijst de workflow het model zonder LLM op dit kopje. Ook het vangnet voor een kopje dat leeg blijft terwijl het woord wél viel."
          >
            <Woordenveld
              waarden={sectie.trefwoorden}
              onChange={(trefwoorden) => onChange({ ...sectie, trefwoorden })}
              placeholder="trefwoord toevoegen en op Enter drukken"
              disabled={bezig}
            />
          </Veld>
          <label className="flex items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={Boolean(sectie.altijd_nacontrole)}
              onChange={(e) =>
                onChange({ ...sectie, altijd_nacontrole: e.target.checked || undefined })
              }
              disabled={bezig}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-line-strong accent-azure"
            />
            <span>
              Altijd nacontrole
              <span className="block text-[12px] text-ink-soft">
                Dit kopje krijgt na het verslag altijd een extra LLM-ronde, ook als
                het al gevuld is. Bedoeld voor kopjes waar de brede prompt
                structureel de mist in gaat.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
