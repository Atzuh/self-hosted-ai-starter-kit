/**
 * Groepering van geüploade dossierbestanden op submap, zodat de gebruiker
 * per submap kan aan-/uitvinken wat mee-geüpload wordt (Docling hoeft dan
 * niet de hele dossiermap te verwerken).
 *
 * De groepssleutel komt uit `webkitRelativePath` en is de éérste submap onder
 * de dossiermap — diepere mappen horen bij hun top-level submap, zodat één
 * vinkje de hele tak aan/uit zet:
 *   "Dossier/Kadaster/info.pdf"          → "Kadaster"
 *   "Dossier/Kadaster/Percelen/kaart.pdf" → "Kadaster"
 *   "Dossier/info.pdf"                   → GROUP_ROOT (direct in de dossiermap)
 *   los bestand (geen pad)               → GROUP_LOOSE
 */

export const GROUP_ROOT = "::hoofdmap::";
export const GROUP_LOOSE = "::losse-bestanden::";

function relativePathOf(file: File): string {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ""
  );
}

export function fileGroupKey(file: File): string {
  const rel = relativePathOf(file);
  if (!rel || !rel.includes("/")) return GROUP_LOOSE;
  const parts = rel.split("/");
  if (parts.length <= 2) return GROUP_ROOT;
  return parts[1];
}

/** Pad ónder de groep ("Kadaster/Percelen/kaart.pdf" → "Percelen/"), of null. */
export function subPathWithinGroup(file: File): string | null {
  const rel = relativePathOf(file);
  if (!rel || !rel.includes("/")) return null;
  const parts = rel.split("/");
  // root / groep / …tussenmappen… / bestandsnaam → alleen de tussenmappen.
  if (parts.length <= 3) return null;
  return parts.slice(2, -1).join("/") + "/";
}

export function groupLabel(key: string): string {
  if (key === GROUP_ROOT) return "Hoofdmap";
  if (key === GROUP_LOOSE) return "Losse bestanden";
  return key;
}

/** Groepeert op submap; hoofdmap eerst, submappen alfabetisch, losse bestanden laatst. */
export function groupFiles(files: File[]): Map<string, File[]> {
  const map = new Map<string, File[]>();
  for (const f of files) {
    const k = fileGroupKey(f);
    const arr = map.get(k);
    if (arr) arr.push(f);
    else map.set(k, [f]);
  }
  const order = (k: string) =>
    k === GROUP_ROOT ? 0 : k === GROUP_LOOSE ? 2 : 1;
  return new Map(
    [...map.entries()].sort(
      ([a], [b]) => order(a) - order(b) || a.localeCompare(b, "nl")
    )
  );
}

/** Bestanden die daadwerkelijk mee-geüpload worden (uitgevinkte groepen eruit). */
export function selectFiles(
  files: File[],
  excludedGroups: ReadonlySet<string>
): File[] {
  if (excludedGroups.size === 0) return files;
  return files.filter((f) => !excludedGroups.has(fileGroupKey(f)));
}
