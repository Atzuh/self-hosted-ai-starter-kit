import type { RecentAkte } from "@/components/RecentAktes";

/**
 * Basis-URL van de gegenereerde aktes. nginx serveert `shared/output/` op
 * `/output/` (zie nginx.conf) en levert daar een JSON-directorylisting via
 * `autoindex_format json`. Absoluut gehouden zodat het ook werkt vanaf de
 * dev-server (:5173) die cross-origin naar de stack (:8080) praat.
 */
export const OUTPUT_BASE = "http://localhost:8080/output/";

/** Eén entry uit de nginx `autoindex_format json`-listing. */
interface NginxDirEntry {
  name: string;
  type: "file" | "directory";
  mtime: string;
  size?: number;
}

/** Grofmazige categorie van een gegenereerd document, voor statistiek. */
export type AkteKind = "akte" | "analyse" | "overig";

/**
 * Verrijkte variant van {@link RecentAkte} met de ruwe timestamp en categorie,
 * zodat het dashboard er statistiek en een activiteitengrafiek op kan bouwen.
 */
export interface AkteRecord extends RecentAkte {
  timestampMs: number;
  kind: AkteKind;
}

/**
 * Leid een leesbaar type + referentie + categorie af uit de bestandsnaam. De
 * n8n-workflow schrijft naar vaste patronen: `hypotheekakte_<zaak>.docx` en
 * `juridische_analyse_<ref>.docx`.
 */
function parseFilename(name: string): {
  type: string;
  reference: string;
  kind: AkteKind;
} {
  const base = name.replace(/\.docx$/i, "");
  if (base.startsWith("hypotheekakte_")) {
    return {
      type: "Hypotheekakte",
      reference: base.slice("hypotheekakte_".length),
      kind: "akte",
    };
  }
  if (base.startsWith("juridische_analyse_")) {
    return {
      type: "Juridische analyse",
      reference: base.slice("juridische_analyse_".length).replace(/_/g, "."),
      kind: "analyse",
    };
  }
  return { type: "Document", reference: base, kind: "overig" };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "Vandaag 14:22" / "Gisteren 16:41" / "28 mei 22:21". */
function formatGeneratedAt(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000
  );

  if (dayDiff === 0) return `Vandaag ${time}`;
  if (dayDiff === 1) return `Gisteren ${time}`;
  return `${date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  })} ${time}`;
}

/**
 * Haal álle gegenereerde documenten op uit `shared/output/`, nieuw→oud
 * gesorteerd en verrijkt met timestamp + categorie. Basis voor zowel de
 * recente-lijst als het dashboard. Gooit bij een netwerk-/HTTP-fout (bv. stack
 * niet actief), zodat de UI dat kan onderscheiden van een lege map.
 */
export async function fetchAkteRecords(): Promise<AkteRecord[]> {
  const res = await fetch(OUTPUT_BASE, { method: "GET" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const entries = (await res.json()) as NginxDirEntry[];

  return entries
    .filter((e) => e.type === "file" && /\.docx$/i.test(e.name))
    .map((e) => ({ entry: e, time: new Date(e.mtime).getTime() }))
    .sort((a, b) => b.time - a.time)
    .map(({ entry, time }): AkteRecord => {
      const { type, reference, kind } = parseFilename(entry.name);
      return {
        id: entry.name,
        filename: entry.name,
        type,
        client: reference,
        generatedAt: formatGeneratedAt(new Date(entry.mtime)),
        status: "gereed",
        downloadUrl: OUTPUT_BASE + encodeURIComponent(entry.name),
        timestampMs: Number.isNaN(time) ? 0 : time,
        kind,
      };
    });
}

/**
 * Haal de meest recente gegenereerde aktes op uit `shared/output/`.
 */
export async function fetchRecentAktes(limit = 6): Promise<RecentAkte[]> {
  return (await fetchAkteRecords()).slice(0, limit);
}
