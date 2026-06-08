/** Unieke sleutel per bestand voor dossier-upload (pad + grootte). */
export function fileUploadKey(file: File): string {
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() ||
    file.name;
  return `${rel}::${file.size}`;
}

/** macOS / zip-schijnzijden die geen inhoudelijk dossierstuk zijn. */
export function isDossierNoiseFile(file: File): boolean {
  const n = file.name;
  const lower = n.toLowerCase();
  const rel =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  if (lower === ".ds_store" || lower === "thumbs.db") return true;
  if (n.startsWith("._")) return true;
  if (rel.includes("__MACOSX/") || rel.includes("\\__MACOSX\\")) return true;
  return false;
}

/** Verwijdert ruis; dedup op (pad of naam) + grootte, eerste wint. */
export function dedupeFilesForUpload(files: File[]): File[] {
  const cleaned = files.filter((f) => !isDossierNoiseFile(f));
  const seen = new Set<string>();
  const out: File[] = [];
  for (const f of cleaned) {
    const k = fileUploadKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
