import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/pdf-format";
import type { PdfPreview } from "@/lib/pdf-format";
import type { Classification } from "@/lib/pdf-classify";
import { classifyFileName, classifyText } from "@/lib/pdf-classify";
import { detectDossierName, filesFromDataTransfer } from "@/lib/folder-drop";
import {
  fileUploadKey,
  isDossierNoiseFile,
} from "@/lib/dedupe-upload-files";

interface MultiFileDropZoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  /**
   * "dossier"   — map-first: hele dossiermap uploaden (akte-modus).
   * "documenten" — bestand-first: losse PDF/Word-documenten uploaden
   *   (analyse-modus). Het grote klikvlak opent dan direct de
   *   bestandskiezer; de map-optie blijft beschikbaar als knop.
   */
  variant?: "dossier" | "documenten";
}

interface FileMeta {
  preview?: PdfPreview;
  classification?: Classification;
  error?: string;
  loading: boolean;
}

const SLOT_LABEL: Record<string, { title: string; tone: string }> = {
  bank: {
    title: "Bank-passeeropdracht",
    tone: "border-azure/40 bg-azure/8 text-azure",
  },
  kadaster: {
    title: "Kadaster eigendomsinformatie",
    tone: "border-azure/40 bg-azure/8 text-azure",
  },
  brp: {
    title: "BRP-inzage",
    tone: "border-seal/40 bg-seal/10 text-seal-deep",
  },
};

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function isWordDocxFile(file: File): boolean {
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function isAcceptedDossierFile(file: File): boolean {
  return isPdfFile(file) || isWordDocxFile(file);
}

async function loadMeta(
  file: File
): Promise<{ preview: PdfPreview; classification: Classification }> {
  if (isWordDocxFile(file)) {
    return {
      preview: {
        pageCount: 0,
        thumbnailDataUrl: "",
        fileSize: file.size,
        firstPageText: "",
      },
      classification: classifyFileName(file.name),
    };
  }
  const { getPdfPreview } = await import("@/lib/pdf");
  const preview = await getPdfPreview(file);
  const classification = classifyText(preview.firstPageText);
  return { preview, classification };
}

function dedupeFiles(existing: File[], incoming: File[]): File[] {
  const ok = incoming.filter((f) => !isDossierNoiseFile(f));
  const seen = new Set(existing.map(fileUploadKey));
  const merged = [...existing];
  for (const f of ok) {
    const k = fileUploadKey(f);
    if (!seen.has(k)) {
      merged.push(f);
      seen.add(k);
    }
  }
  return merged;
}

export function MultiFileDropZone({
  files,
  onChange,
  variant = "dossier",
}: MultiFileDropZoneProps) {
  const isDocsMode = variant === "documenten";
  const [metaMap, setMetaMap] = useState<Map<File, FileMeta>>(new Map());
  const [isDragOver, setIsDragOver] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef(
    new WeakMap<
      File,
      { preview: PdfPreview; classification: Classification }
    >()
  );

  const dossierName = useMemo(() => detectDossierName(files), [files]);
  const subfolderCount = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string })
        .webkitRelativePath;
      if (rel && rel.includes("/")) {
        const parts = rel.split("/");
        if (parts.length >= 3) {
          // root/subfolder/...filename → "subfolder"
          set.add(parts.slice(1, -1).join("/"));
        }
      }
    }
    return set.size;
  }, [files]);

  const ensureMeta = useCallback(async (file: File) => {
    if (cacheRef.current.has(file)) {
      const cached = cacheRef.current.get(file)!;
      setMetaMap((prev) => {
        const next = new Map(prev);
        next.set(file, {
          preview: cached.preview,
          classification: cached.classification,
          loading: false,
        });
        return next;
      });
      return;
    }
    setMetaMap((prev) => {
      const next = new Map(prev);
      next.set(file, { loading: true });
      return next;
    });
    try {
      const meta = await loadMeta(file);
      cacheRef.current.set(file, meta);
      setMetaMap((prev) => {
        const next = new Map(prev);
        next.set(file, {
          preview: meta.preview,
          classification: meta.classification,
          loading: false,
        });
        return next;
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Onbekende fout";
      setMetaMap((prev) => {
        const next = new Map(prev);
        next.set(file, { loading: false, error: message });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    for (const f of files) {
      if (!metaMap.has(f)) {
        ensureMeta(f);
      }
    }
    // Verwijder meta van bestanden die niet meer in files zitten
    setMetaMap((prev) => {
      const next = new Map(prev);
      for (const k of next.keys()) {
        if (!files.includes(k)) next.delete(k);
      }
      return next;
    });
  }, [files, ensureMeta, metaMap]);

  function addFiles(incoming: File[]) {
    const ok = incoming.filter(isAcceptedDossierFile);
    if (ok.length === 0) return;
    onChange(dedupeFiles(files, ok));
  }

  function removeFile(file: File) {
    onChange(files.filter((f) => f !== file));
  }

  function clearAll() {
    onChange([]);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    setIsScanning(true);
    try {
      // Recursief: pak ook bestanden uit submappen wanneer een map gesleept is.
      const all = await filesFromDataTransfer(e.dataTransfer);
      addFiles(all);
    } finally {
      setIsScanning(false);
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFolderChange(e: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  const hasFiles = files.length > 0;

  // In document-modus opent het grote klikvlak direct de bestandskiezer
  // (losse PDF/Word). In dossier-modus opent het de map-kiezer.
  const openPrimaryPicker = () => {
    if (isDocsMode) inputRef.current?.click();
    else folderInputRef.current?.click();
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={openPrimaryPicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPrimaryPicker();
          }
        }}
        className={cn(
          "group cursor-pointer rounded-lg border border-dashed border-line-strong bg-ink-deeper/40 p-5 text-center transition-all",
          "hover:border-azure/60 hover:bg-azure-pale/30 focus:border-azure/60 focus:bg-azure-pale/30 focus:outline-none",
          isDragOver && "border-azure bg-azure-pale/50 shadow-glow scale-[1.005]",
          hasFiles ? "py-5" : "py-12"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          className="sr-only"
          onChange={handleChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error -- non-standard attribute
          webkitdirectory=""
          directory=""
          multiple
          className="sr-only"
          onChange={handleFolderChange}
        />

        <div
          className={cn(
            "mx-auto mb-3 flex items-center justify-center rounded-full border border-line-strong bg-ink-deeper text-ink-soft transition-all group-hover:border-azure/50 group-hover:text-azure-glow group-hover:shadow-glow",
            hasFiles ? "h-10 w-10" : "h-16 w-16",
            isScanning && "border-azure/60 text-azure-glow shadow-glow"
          )}
        >
          {isScanning ? (
            <Loader2
              className={hasFiles ? "h-4 w-4 animate-spin" : "h-7 w-7 animate-spin"}
              strokeWidth={2}
            />
          ) : hasFiles ? (
            <UploadCloud className="h-4 w-4" strokeWidth={1.75} />
          ) : isDocsMode ? (
            <FileText className="h-7 w-7" strokeWidth={1.5} />
          ) : (
            <Folder className="h-7 w-7" strokeWidth={1.5} />
          )}
        </div>

        <div
          className={cn(
            "font-semibold tracking-[-0.012em] text-ink-strong",
            hasFiles ? "text-[15px]" : "mb-1 text-[22px] sm:text-[26px]"
          )}
        >
          {isScanning
            ? "Dossiermap doorzoeken…"
            : hasFiles
              ? isDocsMode
                ? "Voeg nog meer documenten toe"
                : "Voeg nog meer toe of sleep een andere map"
              : isDocsMode
                ? "Sleep documenten hierheen"
                : "Sleep de dossiermap hierheen"}
        </div>

        {!hasFiles && (
          <p className="mx-auto mb-5 mt-1.5 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
            {isDocsMode
              ? "Eén of meer losse stukken — bijv. een BRP-inzage, passeeropdracht of kadasterbericht. PDF en Word (.docx). Of upload een hele map."
              : "Inclusief alle submappen — passeeropdracht, kadaster, BRP/CIR, voorblad. PDF en Word (.docx). We herkennen automatisch wat waar hoort."}
          </p>
        )}

        <div className="mt-3 flex items-center justify-center gap-2 text-[11.5px] text-ink-mute">
          <span>of</span>
          {(() => {
            const primaryClass =
              "inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-strong transition-colors hover:border-azure/50 hover:bg-azure-pale/40 hover:text-azure-glow";
            const secondaryClass =
              "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface/60 px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-wash hover:text-ink-strong";
            const filesButton = (
              <button
                key="files"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className={isDocsMode ? primaryClass : secondaryClass}
              >
                <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                Losse bestanden…
              </button>
            );
            const folderButton = (
              <button
                key="folder"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                className={isDocsMode ? secondaryClass : primaryClass}
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                {isDocsMode ? "Hele map…" : "Kies dossiermap…"}
              </button>
            );
            // In document-modus staat de bestand-knop voorop; in
            // dossier-modus de map-knop.
            return isDocsMode
              ? [filesButton, folderButton]
              : [folderButton, filesButton];
          })()}
        </div>
      </div>

      {hasFiles && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {dossierName && (
                <span className="inline-flex max-w-[60%] items-center gap-1.5 rounded-md border border-azure/40 bg-azure-pale/50 px-2 py-1 text-[12px] font-medium text-azure-glow">
                  <Folder className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
                  <span className="truncate" title={dossierName}>
                    {dossierName}
                  </span>
                </span>
              )}
              <div className="text-[11.5px] font-medium text-ink-soft">
                <span className="font-mono text-ink-strong">{files.length}</span>{" "}
                bestand{files.length === 1 ? "" : "en"}
                {subfolderCount > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-mono text-ink-strong">
                      {subfolderCount}
                    </span>{" "}
                    submap{subfolderCount === 1 ? "" : "pen"}
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="flex-shrink-0 text-[11.5px] font-medium text-ink-soft transition-colors hover:text-danger"
            >
              Alles wissen
            </button>
          </div>

          <ul className="space-y-2">
            {files.map((file) => {
              const meta = metaMap.get(file);
              const detectedCategory =
                meta?.classification?.category ??
                meta?.classification?.slot ??
                null;
              const slotInfo = detectedCategory
                ? SLOT_LABEL[detectedCategory]
                : null;
              const isWord = isWordDocxFile(file);
              return (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="group flex items-center gap-3 rounded-md border border-line bg-surface p-3 transition-colors hover:border-line-strong"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-line bg-ink-deeper text-ink-soft">
                    {meta?.loading ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        strokeWidth={2}
                      />
                    ) : (
                      <FileText className="h-5 w-5" strokeWidth={1.75} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="break-all font-mono text-[12px] font-medium leading-tight text-ink-strong">
                      {file.name}
                    </div>
                    {(() => {
                      const rel = (file as File & {
                        webkitRelativePath?: string;
                      }).webkitRelativePath;
                      if (!rel || !rel.includes("/")) return null;
                      const parts = rel.split("/");
                      const subfolder =
                        parts.length >= 3
                          ? parts.slice(1, -1).join("/")
                          : null;
                      if (!subfolder) return null;
                      return (
                        <div
                          className="mt-0.5 truncate font-mono text-[10.5px] text-ink-mute"
                          title={rel}
                        >
                          ↳ {subfolder}/
                        </div>
                      );
                    })()}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
                      {meta?.loading && <span>Inlezen…</span>}
                      {meta?.error && (
                        <span className="text-danger">
                          Niet leesbaar — {meta.error}
                        </span>
                      )}
                      {meta?.preview && (
                        <>
                          <span className="font-mono">
                            {isWord
                              ? "Word-document"
                              : `${meta.preview.pageCount} ${
                                  meta.preview.pageCount === 1
                                    ? "pagina"
                                    : "pagina's"
                                }`}
                          </span>
                          <span className="font-mono">
                            {formatFileSize(meta.preview.fileSize)}
                          </span>
                        </>
                      )}
                      {slotInfo && (
                        <Badge variant="outline" className={cn(slotInfo.tone)}>
                          {slotInfo.title}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(file)}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-danger hover:text-white"
                    aria-label={`Verwijder ${file.name}`}
                    title="Verwijderen"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
