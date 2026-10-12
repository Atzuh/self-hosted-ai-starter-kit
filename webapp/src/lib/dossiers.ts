import { jobIdVanAntwoord, wachtOpJob, type JobStatus } from "@/lib/job-status";

/**
 * Dossiers die uit een koopovereenkomst zijn uitgelezen. Opslag en extractie
 * lopen via de workflow 'Dossiers' (dossiers-workflow.json); een dossier is één
 * JSON-bestand in shared/dossiers/.
 *
 * NotarisDossier heeft geen import, dus het dossier daar wordt nog met de hand
 * aangemaakt. Dit scherm neemt het lezen en overtypen weg: de gegevens staan
 * klaar om veld voor veld over te nemen.
 */

const BASIS = "/webhook";

export interface Persoon {
  achternaam: string;
  voornamen: string;
  geboorteplaats: string;
  geboortedatum: string;
  straat_huisnummer: string;
  postcode: string;
  woonplaats: string;
  burgerlijke_staat: string;
  legitimatie: string;
  telefoon: string;
  email: string;
}

export interface DossierObject {
  straat_huisnummer: string;
  postcode: string;
  plaats: string;
  omschrijving: string;
  kadastrale_gemeente: string;
  sectie: string;
  perceelnummer: string;
  grootte: string;
}

export interface Voorbehoud {
  omschrijving: string;
  datum: string;
}

export interface Transactie {
  koopsom: string;
  roerende_zaken_bedrag: string;
  kosten: string;
  datum_levering: string;
  notaris: string;
  zekerheid_bedrag: string;
  zekerheid_datum: string;
  financiering_bedrag: string;
  financiering_datum: string;
  makelaar: string;
  datum_ondertekening: string;
  overige_voorbehouden: Voorbehoud[];
  bijzonderheden: string[];
}

export type Ernst = "kritiek" | "let op" | "info";

export interface Melding {
  ernst: Ernst;
  titel: string;
  toelichting: string;
}

export type Rol = "verkopers" | "kopers";

export interface Dossier {
  id: string;
  dossiernummer: string;
  soort: string;
  status: "concept" | "bevestigd";
  verkopers: Persoon[];
  kopers: Persoon[];
  object: DossierObject;
  transactie: Transactie;
  notitie: string;
  /**
   * Paden van velden die het model heeft ingevuld maar die niet letterlijk in
   * het document zijn teruggevonden, bv. 'kopers.0.geboortedatum'.
   */
  twijfel: string[];
  /** Wat de workflow bij het uitlezen aan het document zelf opmerkte. */
  meldingen: Melding[];
  bron: { bestanden: string[]; tekens: number; uitgelezen_op: string };
  historie: Array<{ op: string; door: string; actie: string }>;
  aangemaakt_op: string;
  bijgewerkt_op: string;
}

export interface DossierRegel {
  id: string;
  dossiernummer: string;
  soort: string;
  status: Dossier["status"];
  adres: string;
  verkopers: string[];
  kopers: string[];
  datum_levering: string;
  open_punten: number;
  bijgewerkt_op: string;
}

export type DossierActie = "opslaan" | "bevestigen" | "heropenen" | "verwijderen";

export const LEGE_PERSOON: Persoon = {
  achternaam: "",
  voornamen: "",
  geboorteplaats: "",
  geboortedatum: "",
  straat_huisnummer: "",
  postcode: "",
  woonplaats: "",
  burgerlijke_staat: "",
  legitimatie: "",
  telefoon: "",
  email: "",
};

async function antwoord<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(data?.error || "Onbekende serverfout");
  return data as T;
}

export async function haalDossiers(): Promise<DossierRegel[]> {
  const data = await antwoord<{ dossiers: DossierRegel[] }>(await fetch(`${BASIS}/dossiers`));
  return data.dossiers ?? [];
}

export async function haalDossier(id: string): Promise<Dossier> {
  const res = await fetch(`${BASIS}/dossiers?id=${encodeURIComponent(id)}`);
  return (await antwoord<{ dossier: Dossier }>(res)).dossier;
}

/**
 * Bewaart het dossier. `basis` is de `bijgewerkt_op` waarmee het geladen is; de
 * server weigert als een collega het intussen heeft gewijzigd.
 */
export async function bewaarDossier(
  actie: Exclude<DossierActie, "verwijderen">,
  dossier: Dossier,
  auteur: string
): Promise<Dossier> {
  // form-urlencoded 'data' veld: simpele content-type, geen CORS-preflight.
  const res = await fetch(`${BASIS}/dossier-opslaan`, {
    method: "POST",
    body: new URLSearchParams({
      data: JSON.stringify({ actie, id: dossier.id, auteur, basis: dossier.bijgewerkt_op, dossier }),
    }),
  });
  return (await antwoord<{ dossier: Dossier }>(res)).dossier;
}

export async function verwijderDossier(id: string, auteur: string): Promise<void> {
  const res = await fetch(`${BASIS}/dossier-opslaan`, {
    method: "POST",
    body: new URLSearchParams({ data: JSON.stringify({ actie: "verwijderen", id, auteur }) }),
  });
  await antwoord(res);
}

/**
 * Stuurt de koopovereenkomst naar de workflow en wacht tot het dossier er is.
 * `onStatus` krijgt de echte workflowstap, geen tijdsschatting.
 */
export async function leesKoopovereenkomst(
  bestanden: File[],
  velden: { dossiernummer: string; auteur: string },
  opties: { onStatus?: (job: JobStatus) => void; signal?: AbortSignal } = {}
): Promise<Dossier> {
  const form = new FormData();
  form.append("dossiernummer", velden.dossiernummer);
  form.append("auteur", velden.auteur);
  bestanden.forEach((b, i) => form.append(`document_${i}`, b, b.name));

  const res = await fetch(`${BASIS}/koopovereenkomst`, {
    method: "POST",
    body: form,
    signal: opties.signal,
  });
  if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
  const jobId = jobIdVanAntwoord(await res.json());
  if (!jobId) throw new Error("De server gaf geen job-id terug.");

  const resultaat = await wachtOpJob<{ dossier: Dossier }>(jobId, opties);
  return resultaat.dossier;
}

// ---------------------------------------------------------------------------
// Controles. Draaien in de browser, zodat ze meebewegen terwijl de behandelaar
// velden corrigeert; de workflow doet alleen wat het document zelf nodig heeft.
// ---------------------------------------------------------------------------

const MAANDEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/** Leest '15 januari 2027' of '15-01-2027'; null als er geen datum staat. */
export function leesDatum(tekst: string): Date | null {
  const t = tekst.toLowerCase();
  let m = t.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (m && MAANDEN.includes(m[2])) return new Date(+m[3], MAANDEN.indexOf(m[2]), +m[1]);
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

/** Bedrag in hele centen; null als er geen bedrag staat. */
export function leesBedrag(tekst: string): number | null {
  const m = tekst.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{2}))?/);
  if (!m) return null;
  const centen = parseInt(m[1].replace(/[.\s]/g, ""), 10) * 100 + (m[2] ? parseInt(m[2], 10) : 0);
  return Number.isFinite(centen) && centen > 0 ? centen : null;
}

function isGehuwd(staat: string): boolean {
  const s = staat.toLowerCase();
  if (/ongehuwd|niet gehuwd|geen geregistreerd/.test(s)) return false;
  return /gehuwd|geregistreerd partner/.test(s);
}

export function controleer(d: Dossier): Melding[] {
  const uit: Melding[] = [];
  const t = d.transactie;

  const ontbreekt: string[] = [];
  if (d.verkopers.length === 0) ontbreekt.push("verkoper");
  if (d.kopers.length === 0) ontbreekt.push("koper");
  if (!t.koopsom) ontbreekt.push("koopsom");
  if (!t.datum_levering) ontbreekt.push("datum levering");
  if (!d.object.kadastrale_gemeente || !d.object.sectie || !d.object.perceelnummer) {
    ontbreekt.push("kadastrale aanduiding");
  }
  if (ontbreekt.length > 0) {
    uit.push({
      ernst: "kritiek",
      titel: `Ontbreekt: ${ontbreekt.join(", ")}`,
      toelichting: "Zonder deze gegevens is het dossier niet compleet. Vul ze aan uit de koopovereenkomst.",
    });
  }

  const levering = leesDatum(t.datum_levering);
  const financiering = leesDatum(t.financiering_datum);
  const zekerheid = leesDatum(t.zekerheid_datum);
  if (levering && financiering && financiering >= levering) {
    uit.push({
      ernst: "kritiek",
      titel: "Financieringsvoorbehoud loopt tot op of na de levering",
      toelichting: `Het voorbehoud loopt tot ${t.financiering_datum}, de levering staat op ${t.datum_levering}.`,
    });
  }
  if (levering && zekerheid && zekerheid >= levering) {
    uit.push({
      ernst: "let op",
      titel: "Waarborgsom of bankgarantie pas op of na de levering",
      toelichting: `De zekerheid moet uiterlijk ${t.zekerheid_datum} zijn gesteld, de levering staat op ${t.datum_levering}.`,
    });
  }
  if (financiering && zekerheid && zekerheid < financiering) {
    uit.push({
      ernst: "let op",
      titel: "Waarborgsom vóór afloop van het financieringsvoorbehoud",
      toelichting: `De zekerheid moet op ${t.zekerheid_datum} zijn gesteld, terwijl koper tot ${t.financiering_datum} nog kan ontbinden.`,
    });
  }

  const koopsom = leesBedrag(t.koopsom);
  const waarborg = leesBedrag(t.zekerheid_bedrag);
  const lening = leesBedrag(t.financiering_bedrag);
  if (koopsom && waarborg && Math.abs(waarborg * 10 - koopsom) > 100) {
    uit.push({
      ernst: "info",
      titel: "Waarborgsom is niet 10% van de koopsom",
      toelichting: `Koopsom ${t.koopsom}, zekerheid ${t.zekerheid_bedrag}. Dat mag, maar wijkt af van wat gebruikelijk is.`,
    });
  }
  if (koopsom && lening && lening > koopsom) {
    uit.push({
      ernst: "let op",
      titel: "Financieringsvoorbehoud hoger dan de koopsom",
      toelichting: `Voorbehoud voor ${t.financiering_bedrag} bij een koopsom van ${t.koopsom}.`,
    });
  }

  // Eén verkoper die gehuwd is: de echtgenoot staat niet in de overeenkomst,
  // maar moet bij een echtelijke woning wel toestemming geven.
  if (d.verkopers.length === 1 && isGehuwd(d.verkopers[0].burgerlijke_staat)) {
    uit.push({
      ernst: "let op",
      titel: "Eén verkoper, gehuwd of geregistreerd partner",
      toelichting:
        "Ga na of de echtgenoot of partner toestemming moet geven (art. 1:88 BW) of mede-eigenaar is.",
    });
  }

  return uit;
}

export interface Termijn {
  label: string;
  datum: string;
  /** Dagen vanaf vandaag; negatief als de datum voorbij is. */
  dagen: number;
}

/** De datums uit de overeenkomst waar het kantoor of de cliënt iets mee moet. */
export function termijnen(d: Dossier): Termijn[] {
  const t = d.transactie;
  const ruw: Array<[string, string]> = [
    ["Financieringsvoorbehoud", t.financiering_datum],
    ...t.overige_voorbehouden.map((v): [string, string] => [v.omschrijving, v.datum]),
    ["Waarborgsom of bankgarantie", t.zekerheid_datum],
    ["Levering", t.datum_levering],
  ];
  const vandaag = new Date();
  vandaag.setHours(0, 0, 0, 0);
  return ruw
    .map(([label, datum]) => ({ label, datum, tijd: leesDatum(datum) }))
    .filter((r): r is { label: string; datum: string; tijd: Date } => r.tijd !== null)
    .sort((a, b) => a.tijd.getTime() - b.tijd.getTime())
    .map(({ label, datum, tijd }) => ({
      label,
      datum,
      dagen: Math.round((tijd.getTime() - vandaag.getTime()) / 86_400_000),
    }));
}

export function volledigeNaam(p: Persoon): string {
  return [p.voornamen, p.achternaam].filter(Boolean).join(" ");
}

/**
 * Zet tekst op het klembord. `navigator.clipboard` bestaat alleen op https en
 * localhost; wie de webapp via een ander adres opent (de Tailscale-naam van de
 * Mac) krijgt daarom de oude weg via een tijdelijk tekstvak.
 */
export async function kopieer(tekst: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch {
    // Geweigerd door de browser: door naar de terugvaloptie.
  }
  const vak = document.createElement("textarea");
  vak.value = tekst;
  vak.style.position = "fixed";
  vak.style.opacity = "0";
  document.body.appendChild(vak);
  vak.select();
  let gelukt = false;
  try {
    gelukt = document.execCommand("copy");
  } catch {
    gelukt = false;
  }
  document.body.removeChild(vak);
  return gelukt;
}
