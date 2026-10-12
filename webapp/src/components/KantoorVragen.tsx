import { useState } from "react";
import { Check, Loader2, MessagesSquare, RotateCcw, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  bewerkVragen,
  tijdGeleden,
  type Reactie,
  type Vraag,
  type VraagActie,
} from "@/lib/dashboard";

interface KantoorVragenProps {
  vragen: Vraag[];
  naam: string;
  onNaam: (naam: string) => void;
  onGewijzigd: (vragen: Vraag[]) => void;
}

const TEKSTVAK =
  "flex w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-strong placeholder:text-ink-mute transition-colors focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15";

export function KantoorVragen({
  vragen,
  naam,
  onNaam,
  onGewijzigd,
}: KantoorVragenProps) {
  const [nieuw, setNieuw] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Geeft terug of het gelukt is, zodat de aanroeper zijn invoerveld alleen
  // leegmaakt als de tekst ook echt is opgeslagen.
  async function voerUit(actie: VraagActie): Promise<boolean> {
    setBezig(true);
    setFout(null);
    try {
      onGewijzigd(await bewerkVragen(actie));
      return true;
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBezig(false);
    }
  }

  async function stelVraag() {
    if (await voerUit({ actie: "nieuw", auteur: naam.trim(), tekst: nieuw })) {
      setNieuw("");
    }
  }

  // Open vragen eerst; binnen elke groep blijft de volgorde van de server
  // (nieuwste bovenaan) staan.
  const gesorteerd = [...vragen].sort(
    (a, b) => Number(a.opgelost) - Number(b.opgelost)
  );
  const open = vragen.filter((v) => !v.opgelost).length;
  const naamOntbreekt = naam.trim() === "";

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        <MessagesSquare className="h-4 w-4 text-azure" strokeWidth={2} />
        <h2 className="text-[15px] font-semibold text-ink-strong">
          Vragen aan kantoor
        </h2>
        {open > 0 && <Badge variant="amber">{open} open</Badge>}
        <Input
          value={naam}
          onChange={(e) => onNaam(e.target.value)}
          placeholder="Je naam"
          aria-label="Je naam"
          maxLength={60}
          className="ml-auto h-8 w-36 text-[13px]"
        />
      </div>

      <div className="space-y-2 border-b border-line/70 p-5">
        <textarea
          value={nieuw}
          onChange={(e) => setNieuw(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Stel een vraag aan je kantoorgenoten…"
          className={TEKSTVAK}
        />
        <div className="flex items-center gap-3">
          <p className="text-[11.5px] text-ink-soft">
            {naamOntbreekt
              ? "Vul rechtsboven je naam in om een vraag te stellen."
              : "Iedereen op kantoor kan je vraag zien en erop reageren."}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            disabled={bezig || naamOntbreekt || nieuw.trim() === ""}
            onClick={stelVraag}
          >
            {bezig ? <Loader2 className="animate-spin" /> : <Send />}
            Stel vraag
          </Button>
        </div>
        {fout && <p className="text-[13px] text-danger">{fout}</p>}
      </div>

      {gesorteerd.length === 0 ? (
        <p className="p-5 text-[13.5px] text-ink-soft">
          Er zijn nog geen vragen gesteld.
        </p>
      ) : (
        <ul className="max-h-[640px] divide-y divide-line/70 overflow-y-auto">
          {gesorteerd.map((vraag) => (
            <VraagItem
              key={vraag.id}
              vraag={vraag}
              naam={naam}
              bezig={bezig}
              voerUit={voerUit}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Zolang de vragen in bèta staan toont het dashboard dit paneel in plaats van
 * KantoorVragen: zichtbaar wat eraan komt, maar niet te gebruiken.
 */
export function KantoorVragenBeta() {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
      <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        <MessagesSquare className="h-4 w-4 text-ink-mute" strokeWidth={2} />
        <h2 className="text-[15px] font-semibold text-ink-strong">
          Vragen aan kantoor
        </h2>
        <Badge variant="azure">Bèta</Badge>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          Binnenkort kun je hier een vraag stellen aan je kantoorgenoten en op
          elkaars vragen reageren. Deze functie is nog in bèta en staat nog
          niet open.
        </p>
        <textarea
          rows={3}
          disabled
          placeholder="Stel een vraag aan je kantoorgenoten…"
          className={cn(TEKSTVAK, "cursor-not-allowed resize-none opacity-50")}
        />
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled>
            <Send />
            Stel vraag
          </Button>
        </div>
      </div>
    </section>
  );
}

function VraagItem({
  vraag,
  naam,
  bezig,
  voerUit,
}: {
  vraag: Vraag;
  naam: string;
  bezig: boolean;
  voerUit: (actie: VraagActie) => Promise<boolean>;
}) {
  const [reactie, setReactie] = useState("");
  const naamOntbreekt = naam.trim() === "";

  async function reageer() {
    const gelukt = await voerUit({
      actie: "reactie",
      vraag_id: vraag.id,
      auteur: naam.trim(),
      tekst: reactie,
    });
    if (gelukt) setReactie("");
  }

  function verwijder() {
    // Er is geen login, dus iedereen kan verwijderen; een bevestiging voorkomt
    // in elk geval de misklik.
    if (window.confirm(`De vraag van ${vraag.auteur} en alle reacties verwijderen?`)) {
      voerUit({ actie: "verwijderen", vraag_id: vraag.id });
    }
  }

  return (
    <li className={cn("px-5 py-4", vraag.opgelost && "bg-paper-strong/40")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Kop bericht={vraag}>
            {vraag.opgelost && <Badge variant="success">Opgelost</Badge>}
          </Kop>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed",
              vraag.opgelost ? "text-ink-soft" : "text-ink-strong"
            )}
          >
            {vraag.tekst}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          disabled={bezig}
          title={vraag.opgelost ? "Weer openzetten" : "Markeren als opgelost"}
          aria-label={vraag.opgelost ? "Weer openzetten" : "Markeren als opgelost"}
          onClick={() =>
            voerUit({
              actie: "opgelost",
              vraag_id: vraag.id,
              opgelost: !vraag.opgelost,
            })
          }
        >
          {vraag.opgelost ? <RotateCcw /> : <Check />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 hover:text-danger"
          disabled={bezig}
          title="Verwijderen"
          aria-label="Vraag verwijderen"
          onClick={verwijder}
        >
          <Trash2 />
        </Button>
      </div>

      {vraag.reacties.length > 0 && (
        <ul className="mt-3 space-y-3 border-l-2 border-line pl-4">
          {vraag.reacties.map((r) => (
            <li key={r.id}>
              <Kop bericht={r} />
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
                {r.tekst}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!vraag.opgelost && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reageer();
          }}
        >
          <Input
            value={reactie}
            onChange={(e) => setReactie(e.target.value)}
            placeholder={naamOntbreekt ? "Vul eerst je naam in" : "Reageer…"}
            aria-label="Reactie"
            maxLength={4000}
            disabled={naamOntbreekt}
            className="h-8 text-[13px]"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={bezig || naamOntbreekt || reactie.trim() === ""}
          >
            Reageer
          </Button>
        </form>
      )}
    </li>
  );
}

function Kop({
  bericht,
  children,
}: {
  bericht: Reactie;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[13px] font-semibold text-ink-strong">
        {bericht.auteur}
      </span>
      <span className="font-mono text-[11px] text-ink-mute">
        {tijdGeleden(bericht.geplaatst_op)}
      </span>
      {children}
    </div>
  );
}
