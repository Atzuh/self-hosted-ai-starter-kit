import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Bouwstenen die de beheerschermen onder de Templates-tab delen
 * (bespreeksjablonen en akteblokken). Stonden eerst in
 * BespreeksjabloonBeheer.tsx; hier neergezet toen het tweede scherm ze nodig
 * had, zodat er niet twee versies gaan rondlopen die uit elkaar groeien.
 */

export function Veld({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11.5px] leading-relaxed text-ink-soft">{hint}</span>}
    </label>
  );
}

/** Lijstje woorden als badges; Enter of komma voegt toe, Backspace haalt weg. */
export function Woordenveld({
  waarden,
  onChange,
  placeholder,
  disabled,
  kleineLetters = true,
}: {
  waarden: string[];
  onChange: (waarden: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Trefwoorden worden op kleine letters vergeleken en dus zo opgeslagen. Voor
   * lijstjes waar de schrijfwijze ertoe doet staat dit uit.
   */
  kleineLetters?: boolean;
}) {
  const [invoer, setInvoer] = useState("");

  function voegToe(ruw: string) {
    const woord = kleineLetters ? ruw.trim().toLowerCase() : ruw.trim();
    if (!woord || waarden.includes(woord)) {
      setInvoer("");
      return;
    }
    onChange([...waarden, woord]);
    setInvoer("");
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface p-2",
        disabled && "opacity-50"
      )}
    >
      {waarden.map((w) => (
        <span
          key={w}
          className="inline-flex items-center gap-1 rounded-sm border border-line bg-wash px-1.5 py-0.5 text-[12px] text-ink"
        >
          {w}
          <button
            type="button"
            onClick={() => onChange(waarden.filter((x) => x !== w))}
            disabled={disabled}
            aria-label={`${w} verwijderen`}
            className="text-ink-soft transition-colors hover:text-danger"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={invoer}
        onChange={(e) => setInvoer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            voegToe(invoer);
          } else if (e.key === "Backspace" && !invoer && waarden.length) {
            onChange(waarden.slice(0, -1));
          }
        }}
        onBlur={() => voegToe(invoer)}
        placeholder={waarden.length ? "" : placeholder}
        disabled={disabled}
        className="min-w-[12ch] flex-1 bg-transparent px-1 text-sm text-ink-strong placeholder:text-ink-soft focus:outline-none"
      />
    </div>
  );
}

/** Meerregelig tekstveld in de opmaak van de beheerschermen. */
export function Tekstvlak({
  waarde,
  onChange,
  rows = 3,
  disabled,
  placeholder,
  className,
}: {
  waarde: string;
  onChange: (waarde: string) => void;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      value={waarde}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      className={cn(
        "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-strong transition-colors",
        "focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15",
        "disabled:opacity-50",
        className
      )}
    />
  );
}

/**
 * Bedragen staan intern in centen; de gebruiker ziet en typt euro's, met
 * duizendtalpunt zoals de gegenereerde offerte hem ook schrijft. `euroNaarCenten`
 * strippen die punten er weer af, dus het veld blijft rondlopen.
 */
export function centenNaarEuro(cent: number): string {
  const heel = Math.trunc(Math.abs(Math.round(cent)) / 100);
  const rest = Math.abs(Math.round(cent)) % 100;
  const teken = cent < 0 ? "-" : "";
  return `${teken}${heel.toLocaleString("nl-NL")},${String(rest).padStart(2, "0")}`;
}

/**
 * Leest een getypt bedrag terug naar hele centen. Accepteert zowel komma als
 * punt als decimaalteken en negeert duizendtalpunten, want beide schrijfwijzen
 * komen voor. Levert null bij onzin, zodat de aanroeper de oude waarde kan
 * laten staan in plaats van er 0 van te maken.
 */
export function euroNaarCenten(tekst: string): number | null {
  const schoon = tekst.trim().replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!schoon) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(schoon)) return null;
  return Math.round(parseFloat(schoon) * 100);
}

/**
 * Bedrag in euro's dat intern centen bewaart. De ruwe tekst staat lokaal, zodat
 * een half getypt bedrag ("12,") niet meteen wordt omgezet en de cursor gaat
 * springen; pas bij verlaten van het veld wordt het teruggerekend.
 */
export function EuroInvoer({
  cent,
  onChange,
  disabled,
}: {
  cent: number;
  onChange: (cent: number) => void;
  disabled?: boolean;
}) {
  const [tekst, setTekst] = useState(() => centenNaarEuro(cent));
  const [vorigeCent, setVorigeCent] = useState(cent);

  // Wijzigt de waarde van buitenaf (verplaatsen, herstellen), dan het veld
  // meenemen — maar niet tijdens het typen.
  if (cent !== vorigeCent) {
    setVorigeCent(cent);
    setTekst(centenNaarEuro(cent));
  }

  const ongeldig = euroNaarCenten(tekst) === null;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-soft">
        €
      </span>
      <Input
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={() => {
          const nieuw = euroNaarCenten(tekst);
          if (nieuw === null) {
            setTekst(centenNaarEuro(cent));
          } else {
            onChange(nieuw);
            setTekst(centenNaarEuro(nieuw));
          }
        }}
        disabled={disabled}
        inputMode="decimal"
        className={cn("pl-7 text-right font-mono", ongeldig && "border-danger")}
      />
    </div>
  );
}
