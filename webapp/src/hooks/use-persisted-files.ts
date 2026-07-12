import { useCallback, useEffect, useRef, useState } from "react";

import { loadFiles, saveFiles } from "@/lib/session-file-store";

/**
 * `useState<File[]>`-vervanger die de bestanden sessie-scoped bewaart in
 * IndexedDB, zodat ze een pagina-refresh overleven maar bij tabsluiting
 * verdwijnen (zie `session-file-store`).
 *
 * API is opzettelijk gelijk aan `useState`: `[files, setFiles]`. `hydrated`
 * geeft aan of het herstel uit de store klaar is (handig om flikkeren te
 * voorkomen), maar is optioneel te negeren.
 */
export function usePersistedFiles(
  key: string
): [File[], (files: File[]) => void, boolean] {
  const [files, setFilesState] = useState<File[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Voorkom dat het initiële herstel (setFilesState) meteen weer wordt
  // teruggeschreven; we spiegelen alleen expliciete gebruikersmutaties.
  const skipNextSave = useRef(true);

  useEffect(() => {
    let cancelled = false;
    loadFiles(key).then((restored) => {
      if (cancelled) return;
      if (restored.length > 0) {
        skipNextSave.current = true;
        setFilesState(restored);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setFiles = useCallback(
    (next: File[]) => {
      skipNextSave.current = false;
      setFilesState(next);
    },
    []
  );

  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    void saveFiles(key, files);
  }, [key, files]);

  return [files, setFiles, hydrated];
}
