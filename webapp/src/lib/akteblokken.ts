import type { Aktesoort, Blok } from "@/components/AkteblokBeheer";

/**
 * Blokselectie en prijsberekening voor de testament-bouwer.
 *
 * Losse functies zonder React, zodat ze zonder scherm te controleren zijn en
 * één op één te vergelijken met `bereken_offerte()` in
 * `shared/genereer_testament.py`. Die twee moeten hetzelfde uitrekenen: wat de
 * gebruiker in het scherm ziet is wat er op de offerte komt te staan.
 */

/** Eén onderwerp uit een besprekingsverslag; zie Besprekingen.tsx. */
export interface VerslagOnderwerp {
  kop?: string;
  punten?: string[];
  aangevuld?: string[];
  ter_sprake?: string | null;
}

export interface OnderbouwingRegel {
  /** De punten uit het verslag, letterlijk. */
  punten: string[];
  /** Trefwoord dat wél in het transcript viel terwijl het kopje leeg bleef. */
  terSprake: string | null;
}

/**
 * Wat het verslag over een blok zegt. Gaat op `kop`, de enige koppeling die
 * betrouwbaar is: de bespreking-workflow neemt die letterlijk over uit het
 * bespreeksjabloon.
 */
export function onderbouwingVan(
  blok: Blok,
  onderwerpen: VerslagOnderwerp[] | null
): OnderbouwingRegel | null {
  if (!blok.kop || !onderwerpen) return null;
  const o = onderwerpen.find((x) => (x?.kop || "") === blok.kop);
  if (!o) return null;
  return {
    punten: [...(o.punten || []), ...(o.aangevuld || [])],
    terSprake: o.ter_sprake ?? null,
  };
}

/**
 * Welke blokken stelt het verslag voor? Deterministisch: een blok dat altijd
 * meegaat staat aan, en verder alleen blokken waarvan het gekoppelde kopje
 * inhoud heeft. Geen model, geen gokwerk — een kopje dat leeg bleef levert geen
 * clausule op, ook niet als er een trefwoord viel.
 */
export function stelVoor(blokken: Blok[], onderwerpen: VerslagOnderwerp[] | null): string[] {
  return blokken
    .filter((b) => {
      if (b.altijd) return true;
      const o = onderbouwingVan(b, onderwerpen);
      return !!o && o.punten.length > 0;
    })
    .map((b) => b.id);
}

export interface OfferteRegel {
  omschrijving: string;
  bedrag_cent: number;
}

export interface OfferteBerekening {
  regels: OfferteRegel[];
  honorarium_cent: number;
  btw_cent: number;
  verschotten: Array<{ omschrijving: string; aantal: number; bedrag_cent: number }>;
  verschotten_cent: number;
  totaal_cent: number;
}

/**
 * Zelfde rekenwijze als `bereken_offerte()` in genereer_testament.py:
 *
 * - basistarief, altijd;
 * - elk gekozen blok ÉÉN keer, ook als het in beide testamenten staat — het
 *   denkwerk is één keer gedaan;
 * - het vaste tarief voor elk extra testament;
 * - btw over het honorarium, verschotten daarbuiten;
 * - alles in hele centen, en de btw met eigen afronding. `Math.round` op een
 *   float geeft hier centen-verschillen die op een offerte zichtbaar worden.
 */
export function berekenOfferte(
  akte: Aktesoort,
  btwPercentage: number,
  selectiePerTestament: string[][]
): OfferteBerekening {
  const prijzen = new Map(akte.blokken.map((b) => [b.id, b.prijs_cent]));
  const namen = new Map(akte.blokken.map((b) => [b.id, b.naam]));

  const gekozen: string[] = [];
  for (const selectie of selectiePerTestament) {
    for (const id of selectie) if (!gekozen.includes(id)) gekozen.push(id);
  }
  // In de volgorde van de bibliotheek, zodat de offerte dezelfde volgorde heeft
  // als de akte.
  const geordend = akte.blokken.map((b) => b.id).filter((id) => gekozen.includes(id));

  const regels: OfferteRegel[] = [
    { omschrijving: `Basistarief ${akte.naam}`, bedrag_cent: akte.basistarief_cent },
  ];
  for (const id of geordend) {
    const bedrag = prijzen.get(id) ?? 0;
    if (bedrag) regels.push({ omschrijving: namen.get(id) ?? id, bedrag_cent: bedrag });
  }

  const extra = Math.max(0, selectiePerTestament.length - 1);
  for (let i = 0; i < extra; i++) {
    regels.push({
      omschrijving: extra === 1 ? "Tweede testament partner" : `Extra testament ${i + 2}`,
      bedrag_cent: akte.tarief_tweede_testament_cent,
    });
  }

  const honorarium = regels.reduce((som, r) => som + r.bedrag_cent, 0);
  const promille = Math.round(btwPercentage * 10);
  const btw = Math.floor((honorarium * promille + 500) / 1000);

  const verschotten = akte.verschotten
    .map((v) => {
      const aantal = v.per_testament ? selectiePerTestament.length : 1;
      return { omschrijving: v.naam, aantal, bedrag_cent: v.bedrag_cent * aantal };
    })
    .filter((v) => v.bedrag_cent > 0);
  const verschottenTotaal = verschotten.reduce((som, v) => som + v.bedrag_cent, 0);

  return {
    regels,
    honorarium_cent: honorarium,
    btw_cent: btw,
    verschotten,
    verschotten_cent: verschottenTotaal,
    totaal_cent: honorarium + btw + verschottenTotaal,
  };
}

/** Alle plaatshouders in een bloktekst die de gebruiker zelf moet invullen. */
export function invulveldenVan(blok: Blok, systeemvelden: string[]): Blok["velden"] {
  const systeem = new Set(systeemvelden.map((s) => s.replace(/^<<|>>$/g, "")));
  return blok.velden.filter((v) => !systeem.has(v.naam));
}

/**
 * Haalt de markering weg die `Controleer Getallen` achter een verslagpunt plakt
 * als een getal niet in het transcript terug te vinden was. In de context­weergave
 * blijft hij staan — daar is het een waarschuwing — maar wie het punt naar een
 * invulveld kopieert wil hem niet mee.
 */
export function zonderGetalMarkering(punt: string): string {
  return punt.replace(/\s*\[niet in transcript:[^\]]*\]\s*$/, "").trim();
}
