import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Info,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tijdGeleden } from "@/lib/dashboard";
import {
  LEGE_PERSOON,
  bewaarDossier,
  controleer,
  kopieer,
  termijnen,
  verwijderDossier,
  volledigeNaam,
  type Dossier,
  type DossierActie,
  type Ernst,
  type Melding,
  type Persoon,
  type Rol,
} from "@/lib/dossiers";
import { cn } from "@/lib/utils";

interface DossierDetailProps {
  dossier: Dossier;
  naam: string;
  onNaam: (naam: string) => void;
  onTerug: () => void;
}

const PERSOON_VELDEN: Array<[keyof Persoon, string]> = [
  ["voornamen", "Voornamen"],
  ["achternaam", "Achternaam"],
  ["geboortedatum", "Geboortedatum"],
  ["geboorteplaats", "Geboorteplaats"],
  ["straat_huisnummer", "Straat en huisnummer"],
  ["postcode", "Postcode"],
  ["woonplaats", "Woonplaats"],
  ["burgerlijke_staat", "Burgerlijke staat"],
  ["legitimatie", "Legitimatie"],
  ["telefoon", "Telefoon"],
  ["email", "E-mail"],
];

const OBJECT_VELDEN: Array<[keyof Dossier["object"], string]> = [
  ["straat_huisnummer", "Straat en huisnummer"],
  ["postcode", "Postcode"],
  ["plaats", "Plaats"],
  ["omschrijving", "Omschrijving"],
  ["kadastrale_gemeente", "Kadastrale gemeente"],
  ["sectie", "Sectie"],
  ["perceelnummer", "Perceelnummer"],
  ["grootte", "Grootte"],
];

type AfspraakVeld = Exclude<keyof Dossier["transactie"], "overige_voorbehouden" | "bijzonderheden">;

const AFSPRAAK_VELDEN: Array<[AfspraakVeld, string]> = [
  ["koopsom", "Koopsom"],
  ["roerende_zaken_bedrag", "Roerende zaken"],
  ["kosten", "Kosten"],
  ["datum_levering", "Datum levering"],
  ["notaris", "Notaris"],
  ["zekerheid_bedrag", "Waarborgsom / bankgarantie"],
  ["zekerheid_datum", "Zekerheid uiterlijk op"],
  ["financiering_bedrag", "Financieringsvoorbehoud"],
  ["financiering_datum", "Financiering uiterlijk op"],
  ["makelaar", "Makelaar"],
  ["datum_ondertekening", "Datum ondertekening"],
];

const ERNST_STIJL: Record<Ernst, string> = {
  kritiek: "border-danger/40 bg-danger/8",
  "let op": "border-amber/40 bg-amber/10",
  info: "border-line bg-wash/60",
};

/** Zet een waarde op een pad als 'kopers.0.postcode' in een kopie van het dossier. */
function metWaarde(d: Dossier, pad: string, waarde: string): Dossier {
  const kopie = structuredClone(d);
  const delen = pad.split(".");
  let doel = kopie as unknown as Record<string, unknown>;
  for (const deel of delen.slice(0, -1)) doel = doel[deel] as Record<string, unknown>;
  doel[delen[delen.length - 1]] = waarde;
  // Wie een veld aanpast heeft het nagekeken.
  kopie.twijfel = kopie.twijfel.filter((p) => p !== pad);
  return kopie;
}

export function DossierDetail({ dossier, naam, onNaam, onTerug }: DossierDetailProps) {
  const [d, setD] = useState(dossier);
  const [gewijzigd, setGewijzigd] = useState(false);
  const [bezig, setBezig] = useState<DossierActie | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [gekopieerd, setGekopieerd] = useState<string | null>(null);

  const controles = useMemo<Melding[]>(() => [...d.meldingen, ...controleer(d)], [d]);
  const data = useMemo(() => termijnen(d), [d]);
  const bevestigd = d.status === "bevestigd";

  function wijzig(volgende: Dossier) {
    setD(volgende);
    setGewijzigd(true);
  }

  const zet = (pad: string, waarde: string) => wijzig(metWaarde(d, pad, waarde));
  const akkoord = (pad: string) => wijzig({ ...d, twijfel: d.twijfel.filter((p) => p !== pad) });

  async function naarKlembord(sleutel: string, tekst: string) {
    if (!tekst) return;
    if (await kopieer(tekst)) {
      setGekopieerd(sleutel);
      window.setTimeout(() => setGekopieerd((s) => (s === sleutel ? null : s)), 1400);
    } else {
      setFout("Kopiëren lukte niet in deze browser. Selecteer de tekst en kopieer met de hand.");
    }
  }

  function persoonErbij(rol: Rol) {
    wijzig({ ...d, [rol]: [...d[rol], { ...LEGE_PERSOON }] });
  }

  function persoonWeg(rol: Rol, index: number) {
    // De paden in 'twijfel' bevatten de positie; alles achter de verwijderde
    // persoon schuift één plek op en moet mee, anders kleurt het veld van een
    // ander.
    const twijfel = d.twijfel.flatMap((pad) => {
      const m = pad.match(/^(verkopers|kopers)\.(\d+)\.(.+)$/);
      if (!m || m[1] !== rol) return [pad];
      const positie = Number(m[2]);
      if (positie === index) return [];
      return [positie > index ? `${rol}.${positie - 1}.${m[3]}` : pad];
    });
    wijzig({ ...d, [rol]: d[rol].filter((_, i) => i !== index), twijfel });
  }

  async function bewaar(actie: Exclude<DossierActie, "verwijderen">) {
    setBezig(actie);
    setFout(null);
    try {
      setD(await bewaarDossier(actie, d, naam.trim()));
      setGewijzigd(false);
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(null);
    }
  }

  async function verwijder() {
    if (!window.confirm("Dit dossier verwijderen? De koopovereenkomst zelf blijft waar hij stond.")) return;
    setBezig("verwijderen");
    try {
      await verwijderDossier(d.id, naam.trim());
      onTerug();
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
      setBezig(null);
    }
  }

  function terug() {
    if (gewijzigd && !window.confirm("Er zijn wijzigingen die nog niet zijn opgeslagen. Toch terug?")) return;
    onTerug();
  }

  function veld(pad: string, label: string, waarde: string, breed = false) {
    const twijfel = d.twijfel.includes(pad);
    return (
      <label key={pad} className={cn("flex flex-col gap-1", breed && "sm:col-span-2")}>
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          {label}
          {twijfel && <span className="normal-case tracking-normal text-amber">niet teruggevonden</span>}
        </span>
        <span className="flex items-center gap-1">
          <Input
            value={waarde}
            onChange={(e) => zet(pad, e.target.value)}
            className={cn("h-9 text-[13.5px]", twijfel && "border-amber bg-amber/10")}
          />
          {twijfel && (
            <IcoonKnop titel="Nagekeken, klopt" onClick={() => akkoord(pad)}>
              <Check className="text-success" />
            </IcoonKnop>
          )}
          <IcoonKnop titel="Kopiëren" onClick={() => naarKlembord(pad, waarde)} disabled={!waarde}>
            {gekopieerd === pad ? <Check className="text-success" /> : <Copy />}
          </IcoonKnop>
        </span>
      </label>
    );
  }

  function personen(rol: Rol, titel: string) {
    return (
      <Sectie
        titel={titel}
        actie={
          <Button variant="ghost" size="sm" onClick={() => persoonErbij(rol)}>
            <Plus />
            Toevoegen
          </Button>
        }
      >
        {d[rol].length === 0 && (
          <p className="text-[13px] text-ink-soft">Niemand uitgelezen. Voeg de partij handmatig toe.</p>
        )}
        <div className="flex flex-col gap-5">
          {d[rol].map((p, i) => (
            <div key={i} className="rounded-md border border-line/80 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-ink-strong">
                  {volledigeNaam(p) || `${titel.replace(/s$/, "")} ${i + 1}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    naarKlembord(
                      `${rol}.${i}`,
                      PERSOON_VELDEN.filter(([k]) => p[k]).map(([k, l]) => `${l}: ${p[k]}`).join("\n")
                    )
                  }
                >
                  {gekopieerd === `${rol}.${i}` ? <Check className="text-success" /> : <Copy />}
                  Alles
                </Button>
                <IcoonKnop titel="Persoon verwijderen" onClick={() => persoonWeg(rol, i)}>
                  <Trash2 />
                </IcoonKnop>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PERSOON_VELDEN.map(([k, label]) => veld(`${rol}.${i}.${k}`, label, p[k]))}
              </div>
            </div>
          ))}
        </div>
      </Sectie>
    );
  }

  const t = d.transactie;
  const open = d.twijfel.length;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-8">
      <button
        type="button"
        onClick={terug}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        Alle dossiers
      </button>

      {/* Kop met acties */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {bevestigd ? <Badge variant="success">Gecontroleerd</Badge> : <Badge variant="amber">Concept</Badge>}
            {open > 0 && <Badge variant="amber">{open} na te kijken</Badge>}
            {gewijzigd && <Badge variant="outline">Niet opgeslagen</Badge>}
          </div>
          <h1 className="font-display text-[32px] font-medium leading-tight text-ink-strong sm:text-[40px]">
            {[d.object.straat_huisnummer, d.object.plaats].filter(Boolean).join(", ") || "Nieuw dossier"}
          </h1>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Dossiernummer</span>
          <Input
            value={d.dossiernummer}
            onChange={(e) => zet("dossiernummer", e.target.value)}
            placeholder="2026.0000"
            className="h-9 w-36"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">Jouw naam</span>
          <Input value={naam} onChange={(e) => onNaam(e.target.value)} className="h-9 w-40" />
        </label>
        <Button variant="outline" disabled={bezig !== null || !gewijzigd} onClick={() => bewaar("opslaan")}>
          {bezig === "opslaan" ? <Loader2 className="animate-spin" /> : <Save />}
          Opslaan
        </Button>
        {bevestigd ? (
          <Button variant="outline" disabled={bezig !== null} onClick={() => bewaar("heropenen")}>
            <Undo2 />
            Heropenen
          </Button>
        ) : (
          <Button
            variant="success"
            disabled={bezig !== null || open > 0}
            title={open > 0 ? "Kijk eerst de gemarkeerde velden na" : undefined}
            onClick={() => bewaar("bevestigen")}
          >
            {bezig === "bevestigen" ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Gecontroleerd
          </Button>
        )}
      </div>

      {fout && (
        <div className="mb-5 rounded-md border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {fout}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,1.25fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {personen("verkopers", "Verkopers")}
          {personen("kopers", "Kopers")}

          <Sectie titel="Object">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {OBJECT_VELDEN.map(([k, label]) => veld(`object.${k}`, label, d.object[k]))}
            </div>
          </Sectie>

          <Sectie titel="Afspraken">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {AFSPRAAK_VELDEN.map(([k, label]) => veld(`transactie.${k}`, label, t[k]))}
            </div>

            <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              Overige voorbehouden
            </h3>
            <Lijst
              leeg="Geen andere voorbehouden uitgelezen."
              regels={t.overige_voorbehouden.map((v) => `${v.omschrijving}${v.datum ? ` — uiterlijk ${v.datum}` : ""}`)}
              onWeg={(i) =>
                wijzig({
                  ...d,
                  transactie: { ...t, overige_voorbehouden: t.overige_voorbehouden.filter((_, j) => j !== i) },
                })
              }
            />

            <h3 className="mb-1 mt-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              Bijzonderheden
            </h3>
            <p className="mb-2 text-[12px] text-ink-soft">
              Voorstellen van het model, samengevat in eigen woorden. Lees ze na in de overeenkomst.
            </p>
            <Lijst
              leeg="Geen bijzonderheden uitgelezen."
              regels={t.bijzonderheden}
              onWeg={(i) =>
                wijzig({ ...d, transactie: { ...t, bijzonderheden: t.bijzonderheden.filter((_, j) => j !== i) } })
              }
            />
          </Sectie>

          <Sectie titel="Notitie">
            <textarea
              value={d.notitie}
              onChange={(e) => zet("notitie", e.target.value)}
              rows={4}
              placeholder="Wat een collega moet weten over dit dossier."
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink-strong placeholder:text-ink-mute focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15"
            />
          </Sectie>
        </div>

        {/* Zijkolom */}
        <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-20">
          <Sectie titel="Controles">
            {controles.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-soft">
                <Check className="h-4 w-4 text-success" />
                Geen bijzonderheden gevonden.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {controles.map((c, i) => (
                  <li key={i} className={cn("rounded-md border px-3 py-2.5", ERNST_STIJL[c.ernst])}>
                    <div className="flex items-start gap-2 text-[13px] font-semibold text-ink-strong">
                      {c.ernst === "kritiek" && <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />}
                      {c.ernst === "let op" && <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber" />}
                      {c.ernst === "info" && <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-soft" />}
                      {c.titel}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{c.toelichting}</p>
                  </li>
                ))}
              </ul>
            )}
          </Sectie>

          <Sectie titel="Termijnen">
            {data.length === 0 ? (
              <p className="text-[13px] text-ink-soft">Geen datums uitgelezen.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-[13px]">
                    <span className="min-w-0 flex-1 text-ink">{r.label}</span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block font-medium text-ink-strong">{r.datum}</span>
                      <span className={cn("text-[11.5px]", r.dagen < 0 ? "text-ink-mute" : r.dagen <= 7 ? "text-amber" : "text-ink-soft")}>
                        {r.dagen < 0 ? "verstreken" : r.dagen === 0 ? "vandaag" : `over ${r.dagen} dagen`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Sectie>

          <Sectie titel="Herkomst">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              Uitgelezen uit {d.bron.bestanden.join(", ") || "een geüpload document"}.
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-line/70 pt-3">
              {[...d.historie].reverse().map((h, i) => (
                <li key={i} className="text-[12px] text-ink-soft">
                  <span className="text-ink">{h.actie}</span>
                  {h.door && ` door ${h.door}`} · {tijdGeleden(h.op)}
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 text-danger hover:text-danger"
              disabled={bezig !== null}
              onClick={verwijder}
            >
              <Trash2 />
              Dossier verwijderen
            </Button>
          </Sectie>
        </div>
      </div>
    </div>
  );
}

function Sectie({ titel, actie, children }: { titel: string; actie?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3">
        <h2 className="text-[14.5px] font-semibold text-ink-strong">{titel}</h2>
        <span className="ml-auto">{actie}</span>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function IcoonKnop({
  titel,
  onClick,
  disabled,
  children,
}: {
  titel: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={titel}
      aria-label={titel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-wash hover:text-ink-strong disabled:pointer-events-none disabled:opacity-30 [&_svg]:h-4 [&_svg]:w-4"
    >
      {children}
    </button>
  );
}

function Lijst({ regels, leeg, onWeg }: { regels: string[]; leeg: string; onWeg: (index: number) => void }) {
  if (regels.length === 0) return <p className="text-[13px] text-ink-soft">{leeg}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {regels.map((regel, i) => (
        <li key={i} className="flex items-start gap-2 rounded-md border border-line/80 px-3 py-2 text-[13px] text-ink">
          <span className="min-w-0 flex-1">{regel}</span>
          <button
            type="button"
            title="Weghalen"
            aria-label="Weghalen"
            onClick={() => onWeg(i)}
            className="mt-0.5 flex-shrink-0 text-ink-mute transition-colors hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
