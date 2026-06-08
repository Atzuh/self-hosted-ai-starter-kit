import { useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { isAcceptedDossierFile } from "@/components/MultiFileDropZone";
import { formatFileSize } from "@/lib/pdf-format";

interface SingleFileDropZoneProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Korte hint onder de drop-tekst, bijv. "PDF of Word (.docx)". */
  hint?: string;
}

/**
 * Drop-/kieszone voor precies één document (.pdf of .docx). Bewust géén
 * map-upload of meerdere bestanden — gebruikt op de Controle-pagina waar de
 * gebruiker per vak exact één bestand aanlevert.
 */
export function SingleFileDropZone({
  file,
  onChange,
  hint = "PDF of Word (.docx) — één bestand",
}: SingleFileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFirstAccepted(files: FileList | File[]): File | null {
    for (const f of Array.from(files)) {
      if (isAcceptedDossierFile(f)) return f;
    }
    return null;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const next = pickFirstAccepted(e.dataTransfer.files);
    if (next) onChange(next);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const next = pickFirstAccepted(e.target.files ?? []);
    if (next) onChange(next);
    // Reset zodat hetzelfde bestand opnieuw gekozen kan worden.
    e.target.value = "";
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-paper/50 px-4 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line-strong bg-ink-deeper text-azure">
          <FileText className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink-strong">
            {file.name}
          </div>
          <div className="font-mono text-[11px] text-ink-soft">
            {formatFileSize(file.size)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-danger"
          aria-label="Bestand verwijderen"
        >
          <X className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors",
        dragOver
          ? "border-azure bg-azure-pale/50"
          : "border-line-strong bg-paper/40 hover:border-azure hover:bg-wash/50"
      )}
    >
      <UploadCloud
        className={cn("h-6 w-6", dragOver ? "text-azure" : "text-ink-mute")}
        strokeWidth={1.75}
      />
      <span className="text-[14px] font-medium text-ink-strong">
        Sleep een bestand hierheen of klik om te kiezen
      </span>
      <span className="text-[12px] text-ink-soft">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleInput}
      />
    </button>
  );
}
