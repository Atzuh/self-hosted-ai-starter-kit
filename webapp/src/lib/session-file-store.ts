/**
 * Sessie-scoped persistentie van ge-uploade bestanden.
 *
 * Doel: ge-uploade dossierbestanden overleven een pagina-refresh, maar
 * verdwijnen zodra het tabblad/de browser sluit. IndexedDB slaat de binaire
 * Blobs op; `sessionStorage` fungeert als sessie-marker (die wordt door de
 * browser automatisch gewist bij tabsluiting):
 *
 *   - marker aanwezig  → zelfde sessie (bv. refresh) → bestanden herstellen.
 *   - marker afwezig   → nieuwe sessie → IndexedDB legen, nieuwe marker zetten.
 *
 * Zo krijgen we sessie-levensduur mét Blob-opslag, wat met alleen
 * sessionStorage (string-only, ~5 MB) niet kan.
 */

const DB_NAME = "scriptor-uploads";
const DB_VERSION = 1;
const STORE = "files";
const SESSION_KEY = "scriptor-upload-session";

/** Opslagvorm van één bestand. `webkitRelativePath` is read-only op File en
 * overleeft `new File()` niet, dus we bewaren die apart als `relativePath`. */
interface StoredFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  relativePath: string;
}

interface StoreRecord {
  key: string;
  files: StoredFile[];
}

function relativePathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      })
  );
}

/**
 * Zorg dat we in dezelfde sessie zitten. Bij een verse sessie (tab was dicht)
 * wordt de hele store geleegd zodat oude uploads niet blijven hangen. Idempotent.
 */
let sessionEnsured: Promise<void> | null = null;
function ensureSession(): Promise<void> {
  if (sessionEnsured) return sessionEnsured;
  sessionEnsured = (async () => {
    let hasMarker = false;
    try {
      hasMarker = sessionStorage.getItem(SESSION_KEY) !== null;
    } catch {
      // sessionStorage niet beschikbaar (bv. private mode) → behandel als nieuw.
    }
    if (!hasMarker) {
      await clearAllInternal();
      try {
        sessionStorage.setItem(SESSION_KEY, String(Date.now()));
      } catch {
        // negeer; dan valt persistentie stil terug op "geen bewaring".
      }
    }
  })();
  return sessionEnsured;
}

function clearAllInternal(): Promise<void> {
  return tx("readwrite", (s) => s.clear()).then(() => undefined);
}

/** Herstel de bestanden voor een key (modus). Lege array bij niets/fout. */
export async function loadFiles(key: string): Promise<File[]> {
  try {
    await ensureSession();
    const record = await tx<StoreRecord | undefined>("readonly", (s) =>
      s.get(key)
    );
    if (!record?.files?.length) return [];
    return record.files.map((sf) => {
      const file = new File([sf.blob], sf.name, {
        type: sf.type,
        lastModified: sf.lastModified,
      });
      if (sf.relativePath) {
        Object.defineProperty(file, "webkitRelativePath", {
          value: sf.relativePath,
          writable: false,
        });
      }
      return file;
    });
  } catch {
    return [];
  }
}

/** Spiegel de huidige bestanden naar de store. Lege array → key verwijderen. */
export async function saveFiles(key: string, files: File[]): Promise<void> {
  try {
    await ensureSession();
    if (files.length === 0) {
      await tx("readwrite", (s) => s.delete(key));
      return;
    }
    const stored: StoredFile[] = files.map((f) => ({
      blob: f,
      name: f.name,
      type: f.type,
      lastModified: f.lastModified,
      relativePath: relativePathOf(f),
    }));
    await tx("readwrite", (s) => s.put({ key, files: stored } satisfies StoreRecord));
  } catch {
    // Persistentie is best-effort; falen mag de upload-flow niet breken.
  }
}

/** Verwijder de bestanden voor één key (modus). */
export async function clearFiles(key: string): Promise<void> {
  try {
    await ensureSession();
    await tx("readwrite", (s) => s.delete(key));
  } catch {
    // best-effort
  }
}
