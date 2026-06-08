import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent, ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/pdf-format";
import type { PdfPreview } from "@/lib/pdf-format";
import type {
  AssignInput,
  Classification,
  DocSlot,
} from "@/lib/pdf-classify";

interface SmartDropZoneProps {
  bankFile: File | null;
  kadasterFile: File | null;
  onChange: (next: { bank: File | null; kadaster: File | null }) => void;
  bankIcon: ReactNode;
  kadasterIcon: ReactNode;
}

interface SlotMeta {
  preview: PdfPreview;
  classification: Classification;
}

type SlotState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; meta: SlotMeta }
  | { status: "error"; message: string };

const SLOT_LABELS: Record<DocSlot, { title: string; subtitle: string }> = {
  bank: { title: "Passeeropdracht", subtitle: "Bank" },
  kadaster: { title: "Eigendomsinformatie", subtitle: "Kadaster" },
};

interface FileWithMeta {
  file: File;
  meta: SlotMeta;
}

interface FolderScanResult {
  totalPdfs: number;
  unreadable: number;
  unrecognized: number;
  bankCandidates: FileWithMeta[];
  kadasterCandidates: FileWithMeta[];
}

// ---------- Hulpfuncties ----------

async function loadPreviewAndClassify(
  file: File
): Promise<{ preview: PdfPreview; classification: Classification }> {
  const [{ getPdfPreview }, { classifyText }] = await Promise.all([
    import("@/lib/pdf"),
    import("@/lib/pdf-classify"),
  ]);
  const preview = await getPdfPreview(file);
  const classification = classifyText(preview.firstPageText);
  return { preview, classification };
}

// ---------- Hoofdcomponent ----------

export function SmartDropZone({
  bankFile,
  kadasterFile,
  onChange,
  bankIcon,
  kadasterIcon,
}: SmartDropZoneProps) {
  const [bankSlot, setBankSlot] = useState<SlotState>({ status: "empty" });
  const [kadasterSlot, setKadasterSlot] = useState<SlotState>({
    status: "empty",
  });
  const [isClassifying, setIsClassifying] = useState(false);
  const [isScanningFolder, setIsScanningFolder] = useState(false);
  const [folderResult, setFolderResult] = useState<FolderScanResult | null>(
    null
  );

  // Cache van File → meta zodat we niet opnieuw parsen na re-assignment
  const cacheRef = useRef(new WeakMap<File, SlotMeta>());

  const loadInto = useCallback(
    async (
      file: File,
      setter: (s: SlotState) => void,
      cancelledRef: { current: boolean }
    ) => {
      if (cacheRef.current.has(file)) {
        setter({ status: "ready", meta: cacheRef.current.get(file)! });
        return;
      }
      setter({ status: "loading" });
      try {
        const meta = await loadPreviewAndClassify(file);
        if (cancelledRef.current) return;
        cacheRef.current.set(file, meta);
        setter({ status: "ready", meta });
      } catch (err) {
        if (cancelledRef.current) return;
        const message =
          err instanceof Error ? err.message : "Onbekende fout";
        setter({ status: "error", message });
      }
    },
    []
  );

  // Bank slot synchroniseren
  useEffect(() => {
    const cancelled = { current: false };
    if (!bankFile) {
      setBankSlot({ status: "empty" });
    } else {
      loadInto(bankFile, setBankSlot, cancelled);
    }
    return () => {
      cancelled.current = true;
    };
  }, [bankFile, loadInto]);

  // Kadaster slot synchroniseren
  useEffect(() => {
    const cancelled = { current: false };
    if (!kadasterFile) {
      setKadasterSlot({ status: "empty" });
    } else {
      loadInto(kadasterFile, setKadasterSlot, cancelled);
    }
    return () => {
      cancelled.current = true;
    };
  }, [kadasterFile, loadInto]);

  // ---------- Drop handlers ----------

  /**
   * Verwerkt meerdere PDFs tegelijk: parsed + classifieert + verdeelt over slots.
   * Voor multi-drop op de hoofdzone.
   */
  async function handleBulkFiles(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    if (pdfs.length === 0) return;

    setIsClassifying(true);
    try {
      const metas = await Promise.all(
        pdfs.map(async (file) => {
          if (cacheRef.current.has(file)) {
            return { file, meta: cacheRef.current.get(file)! };
          }
          try {
            const meta = await loadPreviewAndClassify(file);
            cacheRef.current.set(file, meta);
            return { file, meta };
          } catch {
            return null;
          }
        })
      );

      const valid = metas.filter(
        (x): x is { file: File; meta: SlotMeta } => x !== null
      );

      const inputs: AssignInput[] = valid.map(({ file, meta }) => ({
        file,
        classification: meta.classification,
      }));

      const { assignFiles } = await import("@/lib/pdf-classify");
      const next = assignFiles(inputs, {
        bank: bankFile,
        kadaster: kadasterFile,
      });

      onChange(next);
    } finally {
      setIsClassifying(false);
    }
  }

  /**
   * Verwerkt alle PDFs in een gekozen map: classifieert ze allemaal en filtert
   * strikt op herkenning. Niet-herkende PDFs worden genegeerd.
   *   - 0 of 1 kandidaat per slot → automatisch toewijzen.
   *   - Meerdere kandidaten voor een slot → kandidaat-picker tonen.
   */
  async function handleFolderFiles(allFiles: File[]) {
    const pdfs = allFiles.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) return;

    setIsScanningFolder(true);
    setFolderResult(null);
    try {
      const metas = await Promise.all(
        pdfs.map(async (file) => {
          if (cacheRef.current.has(file)) {
            return { file, meta: cacheRef.current.get(file)! };
          }
          try {
            const meta = await loadPreviewAndClassify(file);
            cacheRef.current.set(file, meta);
            return { file, meta };
          } catch {
            return null;
          }
        })
      );

      const valid = metas.filter(
        (x): x is FileWithMeta => x !== null
      );
      const unreadable = pdfs.length - valid.length;

      const bankCandidates = valid
        .filter(
          (v) =>
            v.meta.classification.slot === "bank" &&
            v.meta.classification.confidence > 0
        )
        .sort(
          (a, b) =>
            b.meta.classification.confidence - a.meta.classification.confidence
        );

      const kadasterCandidates = valid
        .filter(
          (v) =>
            v.meta.classification.slot === "kadaster" &&
            v.meta.classification.confidence > 0
        )
        .sort(
          (a, b) =>
            b.meta.classification.confidence - a.meta.classification.confidence
        );

      const unrecognized =
        valid.length - bankCandidates.length - kadasterCandidates.length;

      const bankAmbiguous = bankCandidates.length > 1;
      const kadasterAmbiguous = kadasterCandidates.length > 1;

      const nextBank =
        bankCandidates.length === 1 ? bankCandidates[0].file : bankFile;
      const nextKadaster =
        kadasterCandidates.length === 1
          ? kadasterCandidates[0].file
          : kadasterFile;

      if (nextBank !== bankFile || nextKadaster !== kadasterFile) {
        onChange({ bank: nextBank, kadaster: nextKadaster });
      }

      if (bankAmbiguous || kadasterAmbiguous) {
        setFolderResult({
          totalPdfs: pdfs.length,
          unreadable,
          unrecognized,
          bankCandidates,
          kadasterCandidates,
        });
      } else {
        setFolderResult(null);
      }
    } finally {
      setIsScanningFolder(false);
    }
  }

  function pickCandidate(slot: DocSlot, file: File) {
    if (slot === "bank") onChange({ bank: file, kadaster: kadasterFile });
    else onChange({ bank: bankFile, kadaster: file });
    // Verwijder kandidaten voor dit slot uit de picker.
    setFolderResult((prev) => {
      if (!prev) return prev;
      const next: FolderScanResult = {
        ...prev,
        bankCandidates: slot === "bank" ? [] : prev.bankCandidates,
        kadasterCandidates:
          slot === "kadaster" ? [] : prev.kadasterCandidates,
      };
      const stillAmbiguous =
        next.bankCandidates.length > 1 || next.kadasterCandidates.length > 1;
      return stillAmbiguous ? next : null;
    });
  }

  function dismissFolderResult() {
    setFolderResult(null);
  }

  /**
   * Plaatst een file direct in een specifiek slot (zonder classificatie).
   * Voor klik/drop op een individuele rij.
   */
  function handleDirectFile(slot: DocSlot, file: File) {
    if (file.type !== "application/pdf") return;
    if (slot === "bank") {
      onChange({ bank: file, kadaster: kadasterFile });
    } else {
      onChange({ bank: bankFile, kadaster: file });
    }
  }

  function handleRemove(slot: DocSlot) {
    if (slot === "bank") onChange({ bank: null, kadaster: kadasterFile });
    else onChange({ bank: bankFile, kadaster: null });
  }

  function handleSwap() {
    onChange({ bank: kadasterFile, kadaster: bankFile });
  }

  const hasAny = bankFile !== null || kadasterFile !== null;
  const hasBoth = bankFile !== null && kadasterFile !== null;

  // ---------- Lege staat: één grote dropzone ----------
  if (!hasAny) {
    return (
      <div className="space-y-3">
        <BigDropZone
          onFiles={handleBulkFiles}
          onFolderFiles={handleFolderFiles}
          isClassifying={isClassifying}
          isScanningFolder={isScanningFolder}
          bankIcon={bankIcon}
          kadasterIcon={kadasterIcon}
        />
        {folderResult && (
          <CandidatePicker
            result={folderResult}
            currentBank={bankFile}
            currentKadaster={kadasterFile}
            onPick={pickCandidate}
            onDismiss={dismissFolderResult}
          />
        )}
      </div>
    );
  }

  // ---------- Gevulde staat: lijstweergave ----------
  return (
    <div className="space-y-3">
      <CompactDropHint
        onFiles={handleBulkFiles}
        onFolderFiles={handleFolderFiles}
        isClassifying={isClassifying}
        isScanningFolder={isScanningFolder}
        hasBoth={hasBoth}
      />

      {folderResult && (
        <CandidatePicker
          result={folderResult}
          currentBank={bankFile}
          currentKadaster={kadasterFile}
          onPick={pickCandidate}
          onDismiss={dismissFolderResult}
        />
      )}

      {hasBoth && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSwap}
            className="inline-flex items-center gap-1.5 font-display text-xs font-semibold text-azure hover:text-azure-dark hover:underline"
            title="Verwissel beide bestanden van slot"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2.25} />
            Verwissel slots
          </button>
        </div>
      )}

      <SlotRow
        slot="bank"
        file={bankFile}
        state={bankSlot}
        icon={bankIcon}
        onFileChosen={(f) => handleDirectFile("bank", f)}
        onRemove={() => handleRemove("bank")}
      />
      <SlotRow
        slot="kadaster"
        file={kadasterFile}
        state={kadasterSlot}
        icon={kadasterIcon}
        onFileChosen={(f) => handleDirectFile("kadaster", f)}
        onRemove={() => handleRemove("kadaster")}
      />
    </div>
  );
}

// ============================================================
// Sub-componenten
// ============================================================

interface BigDropZoneProps {
  onFiles: (files: File[]) => void;
  onFolderFiles: (files: File[]) => void;
  isClassifying: boolean;
  isScanningFolder: boolean;
  bankIcon: ReactNode;
  kadasterIcon: ReactNode;
}

function BigDropZone({
  onFiles,
  onFolderFiles,
  isClassifying,
  isScanningFolder,
  bankIcon,
  kadasterIcon,
}: BigDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const open = () => inputRef.current?.click();
  const openFolder = () => folderInputRef.current?.click();

  const busy = isClassifying || isScanningFolder;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "relative cursor-pointer border border-dashed border-line bg-paper px-6 py-10 text-center transition-all sm:py-12",
        "hover:border-azure hover:bg-wash hover:shadow-card focus:outline-none focus:border-azure focus:bg-wash",
        isDragOver && "border-azure bg-wash shadow-card-hover",
        busy && "pointer-events-none opacity-70"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="sr-only"
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      <input
        ref={folderInputRef}
        type="file"
        // webkitdirectory bestaat niet in de standaard HTMLInputElement-types,
        // maar wordt door alle moderne browsers ondersteund (Chrome/Edge/Firefox/Safari).
        // @ts-expect-error -- non-standard attribute
        webkitdirectory=""
        directory=""
        multiple
        className="sr-only"
        onChange={(e) => onFolderFiles(Array.from(e.target.files ?? []))}
      />

      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center bg-azure text-white">
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2.25} />
        ) : (
          <UploadCloud className="h-7 w-7" strokeWidth={2} />
        )}
      </div>

      <div className="mb-1 font-display text-lg font-bold text-ink-strong sm:text-xl">
        {isScanningFolder
          ? "Map doorzoeken…"
          : isClassifying
            ? "Bestanden analyseren…"
            : "Sleep beide PDF-bestanden hierheen"}
      </div>
      <p className="mx-auto mb-6 max-w-md text-sm text-ink">
        {isScanningFolder
          ? "We lezen elke PDF in de map en filteren automatisch de passeeropdracht en eigendomsinformatie eruit."
          : isClassifying
            ? "We lezen de eerste pagina van elk bestand en bepalen automatisch welke de passeeropdracht en welke de eigendomsinformatie is."
            : "Of klik om bestanden te kiezen. We herkennen automatisch welk document waar hoort."}
      </p>

      <div className="mx-auto flex max-w-md flex-col items-stretch justify-center gap-2 sm:flex-row">
        <SlotHint icon={bankIcon} title="Passeeropdracht" subtitle="Bank" />
        <SlotHint
          icon={kadasterIcon}
          title="Eigendomsinformatie"
          subtitle="Kadaster"
        />
      </div>

      {!busy && (
        <>
          <div className="mt-6 flex items-center justify-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider text-azure">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
            Automatische herkenning
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-soft">
            <span>of</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFolder();
              }}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-1.5 font-display text-xs font-semibold text-ink-strong transition-colors hover:border-azure hover:bg-wash hover:text-azure"
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.25} />
              Map kiezen…
            </button>
            <span>met meerdere stukken</span>
          </div>
        </>
      )}
    </div>
  );
}

function SlotHint({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 border border-line bg-wash px-3 py-2 text-left">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center bg-paper text-azure">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-display text-xs font-bold text-ink-strong">
          {title}
        </div>
        <div className="font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
          {subtitle}
        </div>
      </div>
    </div>
  );
}

interface CompactDropHintProps {
  onFiles: (files: File[]) => void;
  onFolderFiles: (files: File[]) => void;
  isClassifying: boolean;
  isScanningFolder: boolean;
  hasBoth: boolean;
}

function CompactDropHint({
  onFiles,
  onFolderFiles,
  isClassifying,
  isScanningFolder,
  hasBoth,
}: CompactDropHintProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const open = () => inputRef.current?.click();
  const openFolder = () => folderInputRef.current?.click();

  const busy = isClassifying || isScanningFolder;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border border-dashed border-line bg-paper px-4 py-3 text-center text-sm transition-all hover:border-azure hover:bg-wash focus:outline-none focus:border-azure focus:bg-wash",
        isDragOver && "border-azure bg-wash",
        busy && "pointer-events-none opacity-60"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="sr-only"
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error -- non-standard attribute
        webkitdirectory=""
        directory=""
        multiple
        className="sr-only"
        onChange={(e) => onFolderFiles(Array.from(e.target.files ?? []))}
      />
      <div className="flex items-center gap-2">
        {busy ? (
          <Loader2
            className="h-4 w-4 animate-spin text-azure"
            strokeWidth={2.25}
          />
        ) : (
          <UploadCloud className="h-4 w-4 text-azure" strokeWidth={2.25} />
        )}
        <span className="text-ink">
          {isScanningFolder
            ? "Map doorzoeken…"
            : isClassifying
              ? "Analyseren…"
              : hasBoth
                ? "Sleep nieuwe PDFs hierheen om te vervangen"
                : "Sleep nog een PDF hierheen of klik om te kiezen"}
        </span>
      </div>
      {!busy && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openFolder();
          }}
          className="inline-flex items-center gap-1.5 font-display text-xs font-semibold text-azure hover:text-azure-dark hover:underline"
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.25} />
          Map kiezen…
        </button>
      )}
    </div>
  );
}

// ----- Slot rij (gevuld of leeg) -----

interface SlotRowProps {
  slot: DocSlot;
  file: File | null;
  state: SlotState;
  icon: ReactNode;
  onFileChosen: (file: File) => void;
  onRemove: () => void;
}

function SlotRow({
  slot,
  file,
  state,
  icon,
  onFileChosen,
  onRemove,
}: SlotRowProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const labels = SLOT_LABELS[slot];

  const open = () => inputRef.current?.click();

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFileChosen(dropped);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) onFileChosen(selected);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Lege rij
  if (!file) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={open}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className={cn(
          "flex cursor-pointer items-center gap-4 border border-dashed border-line bg-paper p-4 transition-all hover:border-azure hover:bg-wash focus:outline-none focus:border-azure focus:bg-wash",
          isDragOver && "border-azure bg-wash"
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".pdf"
          className="sr-only"
          onChange={handleChange}
        />

        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-wash text-azure">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-ink-strong">
            {labels.title}
          </div>
          <div className="text-xs text-ink-soft">
            Sleep PDF hier of klik om te kiezen
          </div>
        </div>
        <Badge variant="outline">{labels.subtitle}</Badge>
      </div>
    );
  }

  // Gevulde rij — bepaal classification mismatch
  const meta = state.status === "ready" ? state.meta : null;
  const detectedSlot = meta?.classification.slot ?? null;
  const mismatch =
    detectedSlot !== null && detectedSlot !== slot && meta!.classification.confidence > 0;
  const confidencePct = meta
    ? Math.round(meta.classification.confidence * 100)
    : 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "relative border bg-paper p-4 transition-all",
        state.status === "error"
          ? "border-danger/60 bg-danger/5"
          : mismatch
            ? "border-amber/70 bg-amber/5"
            : "border-success bg-success/5",
        isDragOver && "ring-2 ring-azure ring-offset-1"
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".pdf"
        className="sr-only"
        onChange={handleChange}
      />

      {/* Verwijderknop */}
      <button
        type="button"
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center bg-paper text-ink-soft transition-colors hover:bg-danger hover:text-white"
        aria-label="Bestand verwijderen"
        title="Bestand verwijderen"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>

      <div className="flex gap-4">
        {/* Thumbnail */}
        <div className="flex h-[110px] w-20 flex-shrink-0 items-center justify-center overflow-hidden border border-line bg-paper shadow-sm">
          {state.status === "loading" && (
            <Loader2 className="h-5 w-5 animate-spin text-azure" strokeWidth={2.25} />
          )}
          {state.status === "ready" && state.meta.preview.thumbnailDataUrl && (
            <img
              src={state.meta.preview.thumbnailDataUrl}
              alt={`Voorbeeld van ${file.name}`}
              className="h-full w-full object-cover object-top"
            />
          )}
          {state.status === "ready" &&
            !state.meta.preview.thumbnailDataUrl && (
              <FileText className="h-7 w-7 text-ink-soft" strokeWidth={1.75} />
            )}
          {state.status === "error" && (
            <AlertTriangle className="h-6 w-6 text-danger" strokeWidth={2.25} />
          )}
        </div>

        {/* Metadata */}
        <div className="min-w-0 flex-1 pr-6">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge variant={state.status === "error" ? "outline" : "success"}>
              <Check className="mr-1 -ml-0.5 h-3 w-3" strokeWidth={2.75} />
              {labels.subtitle}
            </Badge>
            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-ink-soft">
              {labels.title}
            </span>
          </div>

          <div className="break-all font-mono text-[13px] font-semibold leading-tight text-ink-strong">
            {file.name}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
            {state.status === "loading" && <span>Inlezen…</span>}
            {state.status === "ready" && (
              <>
                <span className="font-semibold uppercase tracking-wider text-success">
                  PDF
                </span>
                <span>
                  {state.meta.preview.pageCount}{" "}
                  {state.meta.preview.pageCount === 1 ? "pagina" : "pagina's"}
                </span>
                <span>{formatFileSize(state.meta.preview.fileSize)}</span>
              </>
            )}
            {state.status === "error" && (
              <span className="text-danger">
                Kon PDF niet inlezen — {state.message}
              </span>
            )}
          </div>

          {/* Classificatie-info */}
          {state.status === "ready" && (
            <ClassificationInfo
              currentSlot={slot}
              detectedSlot={detectedSlot}
              confidencePct={confidencePct}
              matched={state.meta.classification.matched}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ----- Classificatie info-regel onder de metadata -----

function ClassificationInfo({
  currentSlot,
  detectedSlot,
  confidencePct,
  matched,
}: {
  currentSlot: DocSlot;
  detectedSlot: DocSlot | null;
  confidencePct: number;
  matched: string[];
}) {
  if (detectedSlot === null) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-soft">
        <Sparkles className="h-3 w-3" strokeWidth={2.25} />
        Geen automatische herkenning — handmatig geplaatst
      </div>
    );
  }

  const matchPreview = matched.slice(0, 3).join(", ");
  if (detectedSlot === currentSlot) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
        <Sparkles className="h-3 w-3" strokeWidth={2.25} />
        <span className="font-semibold">
          Auto-herkend ({confidencePct}%)
        </span>
        {matchPreview && (
          <span className="text-ink-soft">· trefwoorden: {matchPreview}</span>
        )}
      </div>
    );
  }

  // Mismatch — gewaarschuwd
  return (
    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber">
      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" strokeWidth={2.5} />
      <div>
        <span className="font-semibold">
          Lijkt op {SLOT_LABELS[detectedSlot].title.toLowerCase()} ({confidencePct}%)
        </span>{" "}
        — gebruik <em className="not-italic font-semibold">Verwissel slots</em>{" "}
        als dit niet klopt.
      </div>
    </div>
  );
}

// ============================================================
// CandidatePicker — gebruiker kiest welke PDF voor welk slot
// ============================================================

interface CandidatePickerProps {
  result: FolderScanResult;
  currentBank: File | null;
  currentKadaster: File | null;
  onPick: (slot: DocSlot, file: File) => void;
  onDismiss: () => void;
}

function CandidatePicker({
  result,
  currentBank,
  currentKadaster,
  onPick,
  onDismiss,
}: CandidatePickerProps) {
  const showBank = result.bankCandidates.length > 1;
  const showKadaster = result.kadasterCandidates.length > 1;

  return (
    <div className="border-l-4 border-azure bg-azure/5 p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-ink-strong">
            Map gescand — meerdere kandidaten gevonden
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">
            {result.totalPdfs} PDF
            {result.totalPdfs === 1 ? "" : "s"} · {result.bankCandidates.length}{" "}
            passeeropdracht
            {result.bankCandidates.length === 1 ? "" : "en"} ·{" "}
            {result.kadasterCandidates.length} eigendomsinformatie
            {result.unrecognized > 0 && (
              <>
                {" "}
                · {result.unrecognized} niet-herkend (genegeerd)
              </>
            )}
            {result.unreadable > 0 && (
              <>
                {" "}
                · {result.unreadable} onleesbaar
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center bg-paper text-ink-soft transition-colors hover:bg-ink-soft hover:text-white"
          aria-label="Sluiten"
          title="Sluiten"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="space-y-4">
        {showBank && (
          <CandidateGroup
            slot="bank"
            candidates={result.bankCandidates}
            currentFile={currentBank}
            onPick={(file) => onPick("bank", file)}
          />
        )}
        {showKadaster && (
          <CandidateGroup
            slot="kadaster"
            candidates={result.kadasterCandidates}
            currentFile={currentKadaster}
            onPick={(file) => onPick("kadaster", file)}
          />
        )}
      </div>
    </div>
  );
}

interface CandidateGroupProps {
  slot: DocSlot;
  candidates: FileWithMeta[];
  currentFile: File | null;
  onPick: (file: File) => void;
}

function CandidateGroup({
  slot,
  candidates,
  currentFile,
  onPick,
}: CandidateGroupProps) {
  const labels = SLOT_LABELS[slot];
  return (
    <div>
      <div className="mb-2 font-display text-[11px] font-bold uppercase tracking-wider text-ink-strong">
        Kies {labels.title.toLowerCase()}
        <span className="ml-1.5 font-normal text-ink-soft">
          ({candidates.length} kandidaten)
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {candidates.map(({ file, meta }) => {
          const selected = currentFile === file;
          const confidencePct = Math.round(meta.classification.confidence * 100);
          const matchPreview = meta.classification.matched
            .slice(0, 3)
            .join(", ");
          // webkitRelativePath bevat het pad relatief aan de gekozen map,
          // bijv. "Janssen-Pietersen/bank/passeeropdracht.pdf".
          // Toont de submap zodat gebruikers identieke bestandsnamen
          // uit verschillende submappen kunnen onderscheiden.
          const relPath = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath;
          const subfolder =
            relPath && relPath.includes("/")
              ? relPath.slice(0, relPath.lastIndexOf("/"))
              : null;
          return (
            <button
              key={`${slot}-${file.name}-${file.size}`}
              type="button"
              onClick={() => onPick(file)}
              className={cn(
                "flex items-start gap-3 border bg-paper p-3 text-left transition-all",
                selected
                  ? "border-success bg-success/5 ring-1 ring-success"
                  : "border-line hover:border-azure hover:bg-wash"
              )}
              title={file.name}
            >
              <div className="flex h-[72px] w-12 flex-shrink-0 items-center justify-center overflow-hidden border border-line bg-paper shadow-sm">
                {meta.preview.thumbnailDataUrl ? (
                  <img
                    src={meta.preview.thumbnailDataUrl}
                    alt={`Voorbeeld van ${file.name}`}
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <FileText className="h-5 w-5 text-ink-soft" strokeWidth={1.75} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5">
                  {selected ? (
                    <Badge variant="success">
                      <Check className="mr-1 -ml-0.5 h-3 w-3" strokeWidth={2.75} />
                      Geselecteerd
                    </Badge>
                  ) : (
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-azure">
                      {confidencePct}% match
                    </span>
                  )}
                </div>
                <div className="break-all font-mono text-[12px] font-semibold leading-tight text-ink-strong">
                  {file.name}
                </div>
                {subfolder && (
                  <div
                    className="mt-0.5 truncate font-mono text-[10px] text-ink-soft"
                    title={subfolder}
                  >
                    {subfolder}/
                  </div>
                )}
                <div className="mt-1 text-[11px] text-ink-soft">
                  {meta.preview.pageCount}{" "}
                  {meta.preview.pageCount === 1 ? "pagina" : "pagina's"} ·{" "}
                  {formatFileSize(meta.preview.fileSize)}
                </div>
                {matchPreview && (
                  <div className="mt-1 line-clamp-2 text-[10px] text-ink-soft">
                    Trefwoorden: {matchPreview}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
