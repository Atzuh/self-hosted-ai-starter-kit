import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ChevronRight, FileUp, FolderOpen, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DossierDetail } from "@/components/DossierDetail";
import { tijdGeleden, useNaam } from "@/lib/dashboard";
import {
  haalDossier,
  haalDossiers,
  leesKoopovereenkomst,
  type Dossier,
  type DossierRegel,
} from "@/lib/dossiers";
import { cn } from "@/lib/utils";

// Gelijk aan de statussen die de workflow 'Dossiers' in het jobbestand zet.
const STAPPEN = ["document omzetten", "partijen uitlezen", "object en afspraken uitlezen"];

const MAX_BYTES = 40 * 1024 * 1024;

export function Dossiers() {
  const [regels, setRegels] = useState<DossierRegel[] | null>(null);
  const [open, setOpen] = useState<Dossier | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [naam, setNaam] = useNaam();

  const [dossiernummer, setDossiernummer] = useState("");
  const [stap, setStap] = useState<string | null>(null);
  const [sleept, setSleept] = useState(false);
  const bestandRef = useRef<HTMLInputElement>(null);
  const bezig = stap !== null;

  const ophalen = useCallback(async () => {
    try {
      setRegels(await haalDossiers());
      setFout(null);
    } catch (err) {
      setFout(
        `Kon de dossiers niet laden: ${err instanceof Error ? err.message : String(err)}. Draait n8n?`
      );
    }
  }, []);

  useEffect(() => {
    ophalen();
  }, [ophalen]);

  async function uitlezen(bestanden: File[]) {
    const bruikbaar = bestanden.filter((b) => /\.(pdf|docx)$/i.test(b.name));
    if (bruikbaar.length === 0) {
      setFout("Upload de koopovereenkomst als pdf- of Word-bestand.");
      return;
    }
    if (bruikbaar.some((b) => b.size > MAX_BYTES)) {
      setFout("Een van de bestanden is groter dan 40 MB.");
      return;
    }
    setFout(null);
    setStap(STAPPEN[0]);
    try {
      const dossier = await leesKoopovereenkomst(
        bruikbaar,
        { dossiernummer: dossiernummer.trim(), auteur: naam.trim() },
        { onStatus: (job) => job.status && STAPPEN.includes(job.status) && setStap(job.status) }
      );
      setDossiernummer("");
      setOpen(dossier);
    } catch (err) {
      setFout(`Uitlezen mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStap(null);
    }
  }

  async function openDossier(id: string) {
    try {
      setOpen(await haalDossier(id));
      setFout(null);
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
    }
  }

  function opDrop(e: DragEvent) {
    e.preventDefault();
    setSleept(false);
    if (!bezig) uitlezen(Array.from(e.dataTransfer.files));
  }

  if (open) {
    return (
      <DossierDetail
        key={open.id}
        dossier={open}
        naam={naam}
        onNaam={setNaam}
        onTerug={() => {
          setOpen(null);
          ophalen();
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      <section className="mb-8 animate-fade-up">
        <div className="mb-5 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            <span className="h-1 w-1 rounded-full bg-seal" />
            Dossiers
          </span>
        </div>
        <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[64px]">
          Van koopovereenkomst naar dossier
        </h1>
        <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink">
          Upload een koopovereenkomst en Scriptor leest partijen, object, koopsom
          en termijnen uit. Elk veld wordt naast het document gelegd; wat daar
          niet letterlijk in terug te vinden is, staat gemarkeerd om na te
          kijken. Daarna neem je de gegevens over in NotarisDossier.
        </p>
      </section>

      {fout && (
        <div className="mb-5 rounded-md border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {fout}
        </div>
      )}

      {/* Upload */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setSleept(true);
        }}
        onDragLeave={() => setSleept(false)}
        onDrop={opDrop}
        className={cn(
          "mb-8 rounded-lg border border-dashed border-line-strong bg-surface p-6 shadow-card transition-colors",
          sleept && "border-azure bg-wash"
        )}
      >
        <input
          ref={bestandRef}
          type="file"
          accept="application/pdf,.pdf,.docx"
          multiple
          className="hidden"
          onChange={(e) => {
            uitlezen(Array.from(e.target.files ?? []));
            // Leegmaken, anders vuurt onChange niet bij hetzelfde bestand opnieuw.
            e.target.value = "";
          }}
        />

        {bezig ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 text-[14px] font-medium text-ink-strong">
              <Loader2 className="h-4 w-4 animate-spin text-azure" />
              Koopovereenkomst wordt uitgelezen
            </div>
            <ol className="flex flex-col gap-1.5">
              {STAPPEN.map((s, i) => {
                const huidig = STAPPEN.indexOf(stap ?? "");
                return (
                  <li
                    key={s}
                    className={cn(
                      "flex items-center gap-2 text-[13px]",
                      i < huidig && "text-success",
                      i === huidig && "text-ink-strong",
                      i > huidig && "text-ink-mute"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        i < huidig && "bg-success",
                        i === huidig && "animate-pulse bg-azure",
                        i > huidig && "bg-line-strong"
                      )}
                    />
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </li>
                );
              })}
            </ol>
            <p className="text-[12.5px] text-ink-soft">
              Dit duurt één tot twee minuten. Je kunt dit scherm open laten staan.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold text-ink-strong">
                Nieuw dossier uit een koopovereenkomst
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Sleep de pdf hierheen of kies een bestand. Een losse lijst van
                zaken of allonge mag erbij.
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                Dossiernummer (mag later)
              </span>
              <Input
                value={dossiernummer}
                onChange={(e) => setDossiernummer(e.target.value)}
                placeholder="2026.0000"
                className="w-44"
              />
            </label>
            <Button variant="primary" onClick={() => bestandRef.current?.click()}>
              <FileUp />
              Bestand kiezen
            </Button>
          </div>
        )}
      </section>

      {/* Overzicht */}
      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
          <FolderOpen className="h-4 w-4 text-seal" strokeWidth={2} />
          <h2 className="text-[15px] font-semibold text-ink-strong">Dossiers</h2>
          {regels && (
            <span className="font-mono text-[11px] text-ink-mute">{regels.length}</span>
          )}
        </div>

        {regels === null && !fout && (
          <p className="px-5 py-6 text-[13px] text-ink-soft">Laden…</p>
        )}
        {regels?.length === 0 && (
          <p className="px-5 py-6 text-[13px] text-ink-soft">
            Nog geen dossiers. Upload hierboven een koopovereenkomst.
          </p>
        )}
        <ul className="divide-y divide-line/70">
          {regels?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => openDossier(r.id)}
                className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-wash/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink-strong">
                      {r.adres || "Adres onbekend"}
                    </span>
                    {r.dossiernummer && (
                      <span className="font-mono text-[11.5px] text-ink-soft">{r.dossiernummer}</span>
                    )}
                    {r.status === "bevestigd" ? (
                      <Badge variant="success">Gecontroleerd</Badge>
                    ) : (
                      <Badge variant="amber">
                        Concept{r.open_punten > 0 && ` · ${r.open_punten} na te kijken`}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-soft">
                    {r.verkopers.join(", ") || "verkoper onbekend"} →{" "}
                    {r.kopers.join(", ") || "koper onbekend"}
                    {r.datum_levering && ` · levering ${r.datum_levering}`}
                  </span>
                </span>
                <span className="hidden flex-shrink-0 text-[11.5px] text-ink-mute sm:block">
                  {tijdGeleden(r.bijgewerkt_op)}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-mute transition-transform group-hover:translate-x-0.5 group-hover:text-azure" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
