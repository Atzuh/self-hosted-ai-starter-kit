export type DocSlot = "bank" | "kadaster";

/**
 * Documentcategorie voor weergave. Breder dan {@link DocSlot}: bevat ook
 * "brp" (inzagestukken zoals een BRP-uitdraai). De akte-slotmachinerie
 * (SmartDropZone) werkt alleen met bank/kadaster via {@link Classification.slot};
 * "brp" levert daar slot=null op.
 */
export type DocCategory = DocSlot | "brp";

export interface Classification {
  slot: DocSlot | null;
  /** Bredere categorie incl. "brp"; null als niets gedetecteerd. */
  category: DocCategory | null;
  confidence: number; // 0..1; 0 = geen match, 1 = volledig zekere match
  matched: string[]; // gevonden keywords
}

// Keywords zijn lowercase. We matchen op substring in de eerste-pagina-tekst.
// Houd ze specifiek genoeg om geen false positives te krijgen.
const BANK_KEYWORDS = [
  "passeeropdracht",
  "rabobank",
  "rabohypotheek",
  "stater",
  "obvion",
  "munt hypotheken",
  "hypothecaire geldlening",
  "hypotheekstelling",
  "geldgever",
  "geldnemer",
  "hypotheekgever",
  "hypotheekhouder",
  "hypotheeknemer",
  "renteperiode",
  "leningnummer",
  "ECH",
];

const KADASTER_KEYWORDS = [
  "kadaster",
  "eigendomsinformatie",
  "kadastrale aanduiding",
  "kadastraal nummer",
  "kadastrale gemeente",
  "openbare registers",
  "rechthebbende",
  "perceelnummer",
  "perceeloppervlak",
  "burgerlijke gemeente",
  "notarisdossier",
];

// Inzagestukken uit de Basisregistratie Personen (BRP-uitdraai / persoonslijst).
// Termen zijn specifiek genoeg om niet met passeeropdracht/kadaster te botsen.
const BRP_KEYWORDS = [
  "brp bevraging",
  "basisregistratie personen",
  "burgerservicenummer",
  "a-nummer",
  "huwelijk/partnerschap",
  "huwelijks geschiedenis",
  "huwelijksgeschiedenis",
  "partnerschapsgeschiedenis",
  "datum ontbinding",
  "reden ontbinding",
  "datum opneming gba",
];

function matchesKeyword(lowerText: string, kw: string): boolean {
  const k = kw.toLowerCase();
  // Korte codes (bv. "ech") alleen als heel woord matchen — anders vangen
  // ze deelwoorden af ("ech" zit in "echtgenoot", "recht", "slechts").
  if (/^[a-z]{2,4}$/.test(k)) {
    return new RegExp(`\\b${k}\\b`).test(lowerText);
  }
  return lowerText.includes(k);
}

function findMatches(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const kw of keywords) {
    if (matchesKeyword(lower, kw)) out.push(kw);
  }
  return out;
}

/** Classificatie op basis van de bestandsnaam (voor .docx zonder PDF-tekstextractie). */
export function classifyFileName(filename: string): Classification {
  const stem = String(filename || "")
    .replace(/\.[^.]+$/i, "")
    .replace(/[_0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return classifyText(stem.length ? stem : filename);
}

export function classifyText(text: string): Classification {
  const bankMatched = findMatches(text, BANK_KEYWORDS);
  const kadasterMatched = findMatches(text, KADASTER_KEYWORDS);
  const brpMatched = findMatches(text, BRP_KEYWORDS);

  const bankScore = bankMatched.length;
  const kadasterScore = kadasterMatched.length;
  const brpScore = brpMatched.length;
  const total = bankScore + kadasterScore + brpScore;

  if (total === 0) {
    return { slot: null, category: null, confidence: 0, matched: [] };
  }

  // BRP-inzagestukken eerst: hun termen zijn distinctief, dus winnen ze
  // bij gelijke of hogere score. category="brp" → slot=null (geen akte-slot).
  if (brpScore > 0 && brpScore >= bankScore && brpScore >= kadasterScore) {
    return {
      slot: null,
      category: "brp",
      confidence: brpScore / total,
      matched: brpMatched,
    };
  }

  if (bankScore === kadasterScore) {
    // Gelijkstand tussen bank en kadaster: niet beslissend
    return {
      slot: null,
      category: null,
      confidence: 0,
      matched: [...bankMatched, ...kadasterMatched],
    };
  }

  if (bankScore > kadasterScore) {
    return {
      slot: "bank",
      category: "bank",
      confidence: bankScore / total,
      matched: bankMatched,
    };
  }
  return {
    slot: "kadaster",
    category: "kadaster",
    confidence: kadasterScore / total,
    matched: kadasterMatched,
  };
}

export interface AssignInput {
  file: File;
  classification: Classification;
}

export interface AssignedSlots {
  bank: File | null;
  kadaster: File | null;
}

/**
 * Verdeel een lijst geclassificeerde PDFs over de twee slots.
 * Strategie:
 *   1. Plaats stellig geclassificeerde files in hun "voorkeurslot"
 *      (alleen als dat slot nog leeg is).
 *   2. Vul de overgebleven, niet-geclassificeerde / botsende files
 *      in de eerste vrije slot (bank → kadaster volgorde).
 *   3. Als beide slots vol zijn, worden extra bestanden genegeerd.
 */
export function assignFiles(
  pdfs: AssignInput[],
  current: AssignedSlots
): AssignedSlots {
  let bank = current.bank;
  let kadaster = current.kadaster;
  const remaining: AssignInput[] = [];

  for (const item of pdfs) {
    if (item.classification.slot === "bank" && !bank) {
      bank = item.file;
    } else if (item.classification.slot === "kadaster" && !kadaster) {
      kadaster = item.file;
    } else {
      remaining.push(item);
    }
  }

  for (const item of remaining) {
    if (!bank) bank = item.file;
    else if (!kadaster) kadaster = item.file;
    // anders: slot vol, negeren
  }

  return { bank, kadaster };
}
