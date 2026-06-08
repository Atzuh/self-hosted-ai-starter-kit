/**
 * Recursief uitlezen van een gesleepte map (incl. submappen).
 *
 * Browsers leveren bij een drag-and-drop van een map alleen het top-niveau
 * via `e.dataTransfer.files`. Om óók bestanden in submappen mee te nemen
 * moeten we de `DataTransferItem.webkitGetAsEntry()` API gebruiken en de
 * directory-tree zelf aflopen.
 *
 * Voor gewone (losse) bestanden vallen we terug op `dataTransfer.files`.
 *
 * Resultaat: een platte lijst `File[]` waarin elk bestand een
 * `webkitRelativePath` heeft zoals "Janssen-Pietersen/Kadaster/info.pdf"
 * (zelfde shape als wanneer je op "Kies map…" klikt met `webkitdirectory`).
 */

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      cb: (entries: FileSystemEntryLike[]) => void,
      err?: (e: unknown) => void
    ) => void;
  };
};

function readEntriesBatch(
  reader: ReturnType<NonNullable<FileSystemEntryLike["createReader"]>>
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(
      (entries) => resolve(entries),
      (err) => reject(err)
    );
  });
}

async function readAllEntries(
  reader: ReturnType<NonNullable<FileSystemEntryLike["createReader"]>>
): Promise<FileSystemEntryLike[]> {
  const all: FileSystemEntryLike[] = [];
  // readEntries levert in batches (Chrome max 100), dus blijven lezen tot leeg.
  while (true) {
    const batch = await readEntriesBatch(reader);
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

function entryToFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  pathPrefix: string
): Promise<File[]> {
  if (entry.isFile) {
    const file = await entryToFile(entry);
    if (!file) return [];
    // webkitRelativePath is read-only op File; we leveren hem via een
    // wrappende defineProperty zodat downstream-code er gebruik van kan maken.
    const relPath = pathPrefix + entry.name;
    try {
      Object.defineProperty(file, "webkitRelativePath", {
        value: relPath,
        configurable: true,
        writable: false,
      });
    } catch {
      /* sommige File-implementaties zijn frozen — negeer */
    }
    return [file];
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const children = await readAllEntries(reader);
    const childFiles = await Promise.all(
      children.map((c) => walkEntry(c, pathPrefix + entry.name + "/"))
    );
    return childFiles.flat();
  }
  return [];
}

/**
 * Hoofdfunctie: extract alle bestanden uit een drop-event.
 *   - Gesleepte map → recursief alle inhoud (incl. submappen)
 *   - Losse bestanden → gewoon de bestanden
 */
export async function filesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  const items = dataTransfer.items;
  // Als de browser geen items + webkitGetAsEntry levert, fallback op files.
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  const entries: FileSystemEntryLike[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Item moet van kind 'file' zijn — anders skip (bijv. text drags).
    if (item.kind !== "file") continue;
    const entry =
      typeof (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      }).webkitGetAsEntry === "function"
        ? (item as DataTransferItem & {
            webkitGetAsEntry: () => FileSystemEntryLike | null;
          }).webkitGetAsEntry()
        : null;
    if (entry) entries.push(entry);
  }

  // Geen valide entries (oudere browser) → fallback op files.
  if (entries.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  // Loop door alle top-niveau entries en haal recursief alle bestanden op.
  const filesArrays = await Promise.all(entries.map((e) => walkEntry(e, "")));
  return filesArrays.flat();
}

/**
 * Probeer de root-mapnaam te bepalen op basis van het eerste bestand
 * met een `webkitRelativePath`. Bijvoorbeeld voor
 *   "Janssen-Pietersen/Kadaster/info.pdf"
 * → "Janssen-Pietersen"
 */
export function detectDossierName(files: File[]): string | null {
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    if (rel && rel.includes("/")) {
      return rel.split("/")[0];
    }
  }
  return null;
}
