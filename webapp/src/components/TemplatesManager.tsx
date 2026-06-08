import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function templateUrl(bank: BankInfo): string | null {
  if (!bank.file_exists || !bank.template_filename) return null;
  return `/templates/${bank.bank_id}/${encodeURIComponent(bank.template_filename)}`;
}

interface PreviewState {
  bank: BankInfo;
  html: string | null;
  loading: boolean;
  error: string | null;
}

const DEFAULT_LIST_URL = "http://localhost:5678/webhook/templates";
const DEFAULT_UPLOAD_URL = "http://localhost:5678/webhook/upload-template";

interface BankInfo {
  bank_id: string;
  display_name: string;
  keywords: string[];
  template_filename: string | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  file_exists: boolean;
  file_size: number | null;
  file_mtime: string | null;
  placeholder_count: number;
}

interface ListResponse {
  success: boolean;
  schema_version?: number;
  banks?: BankInfo[];
  error?: string;
}

interface UploadResponse {
  success: boolean;
  bank_id?: string;
  template_filename?: string;
  uploaded_at?: string;
  file_size?: number;
  error?: string;
  message?: string;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("nl-NL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TemplatesManager() {
  const [listUrl, setListUrl] = useState(DEFAULT_LIST_URL);
  const [uploadUrl, setUploadUrl] = useState(DEFAULT_UPLOAD_URL);
  const [banks, setBanks] = useState<BankInfo[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingBank, setUploadingBank] = useState<string | null>(null);
  const [lastUploadMsg, setLastUploadMsg] = useState<{
    bankId: string;
    text: string;
    kind: "success" | "error";
  } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const openPreview = useCallback(async (bank: BankInfo) => {
    const url = templateUrl(bank);
    if (!url) return;
    setPreview({ bank, html: null, loading: true, error: null });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      // mammoth (~500 KB) pas laden wanneer de gebruiker daadwerkelijk een
      // preview opent — houdt de initiële bundel klein.
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setPreview({ bank, html: result.value, loading: false, error: null });
    } catch (err) {
      setPreview({
        bank,
        html: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const fetchBanks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(listUrl, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as ListResponse;
      if (!data.success) {
        throw new Error(data.error || "Onbekende fout van n8n");
      }
      setBanks(data.banks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBanks(null);
    } finally {
      setIsLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  async function handleUpload(bankId: string, file: File) {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setLastUploadMsg({
        bankId,
        kind: "error",
        text: "Alleen .docx-bestanden zijn toegestaan.",
      });
      return;
    }
    setUploadingBank(bankId);
    setLastUploadMsg(null);
    try {
      const formData = new FormData();
      formData.append("bank_id", bankId);
      formData.append("uploaded_by", "scriptor-webapp");
      formData.append("file", file, file.name);
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const text = await res.text();
      let parsed: UploadResponse | null = null;
      try {
        parsed = JSON.parse(text) as UploadResponse;
      } catch {
        /* keep raw text */
      }
      if (!res.ok) {
        throw new Error(
          parsed?.error || parsed?.message || `HTTP ${res.status}: ${text.slice(0, 200)}`
        );
      }
      if (parsed && parsed.success === false) {
        throw new Error(parsed.error || "Upload mislukt");
      }
      setLastUploadMsg({
        bankId,
        kind: "success",
        text: `Template ${parsed?.template_filename || file.name} geactiveerd voor ${bankId}.`,
      });
      await fetchBanks();
    } catch (err) {
      setLastUploadMsg({
        bankId,
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingBank(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">
      {/* Hero */}
      <section className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="animate-fade-up">
          <div className="mb-5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface/80 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              <span className="h-1 w-1 rounded-full bg-seal" />
              Templates
            </span>
          </div>
          <h1 className="font-display text-[44px] font-medium leading-[1.02] text-ink-strong sm:text-[64px]">
            Bank-templates beheren
          </h1>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink">
            Per bank wordt één actieve template gebruikt. Upload een nieuwe
            <span className="font-mono"> .docx</span> om de huidige te
            vervangen — de wijziging is direct actief in de generator.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBanks}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Vernieuwen
          </Button>
        </div>
      </section>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-danger/30 border-l-4 border-l-danger bg-danger-pale p-4 text-sm">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger"
            strokeWidth={2.25}
          />
          <div className="flex-1">
            <div className="font-display font-bold text-ink-strong">
              Kon templates niet ophalen
            </div>
            <div className="mt-0.5 text-ink-soft">{error}</div>
            <div className="mt-1 font-mono text-[11px] text-ink-soft">
              GET {listUrl}
            </div>
          </div>
        </div>
      )}

      {!banks && !error && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-ink-strong" />
          Templates laden…
        </div>
      )}

      {banks && banks.length === 0 && !error && (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-ink-soft shadow-card">
          Geen banken geconfigureerd in <span className="font-mono">registry.json</span>.
        </div>
      )}

      {banks && banks.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {banks.map((b) => (
            <BankCard
              key={b.bank_id}
              bank={b}
              isUploading={uploadingBank === b.bank_id}
              uploadMessage={
                lastUploadMsg && lastUploadMsg.bankId === b.bank_id
                  ? lastUploadMsg
                  : null
              }
              onUpload={(file) => handleUpload(b.bank_id, file)}
              onPreview={() => openPreview(b)}
            />
          ))}
        </div>
      )}

      {/* n8n endpoint configuratie (developer-instelling) */}
      <details className="mt-8 rounded-lg border border-line bg-surface p-4 shadow-card">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft transition-colors hover:text-ink-strong">
          Geavanceerd · n8n-webhook URL's
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
              GET templates
            </span>
            <input
              type="text"
              value={listUrl}
              onChange={(e) => setListUrl(e.target.value)}
              className="rounded-md border border-line-strong bg-paper px-2 py-1.5 font-mono text-[12px] focus:border-ink-strong focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink">
              POST upload-template
            </span>
            <input
              type="text"
              value={uploadUrl}
              onChange={(e) => setUploadUrl(e.target.value)}
              className="rounded-md border border-line-strong bg-paper px-2 py-1.5 font-mono text-[12px] focus:border-ink-strong focus:outline-none"
            />
          </label>
        </div>
      </details>

      {preview && (
        <TemplatePreviewModal preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

interface BankCardProps {
  bank: BankInfo;
  isUploading: boolean;
  uploadMessage:
    | { bankId: string; text: string; kind: "success" | "error" }
    | null;
  onUpload: (file: File) => void;
  onPreview: () => void;
}

function BankCard({
  bank,
  isUploading,
  uploadMessage,
  onUpload,
  onPreview,
}: BankCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = () => inputRef.current?.click();

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight tracking-[-0.012em] text-ink-strong">
            {bank.display_name}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-ink-soft">
            id · {bank.bank_id}
          </div>
        </div>
        <Badge variant={bank.file_exists ? "success" : "outline"}>
          {bank.file_exists ? (
            <>
              <CheckCircle2 className="mr-1 -ml-0.5 h-3 w-3" strokeWidth={2.5} />
              Actief
            </>
          ) : (
            <>
              <AlertTriangle className="mr-1 -ml-0.5 h-3 w-3" strokeWidth={2.5} />
              Geen bestand
            </>
          )}
        </Badge>
      </div>

      {/* Huidige template */}
      <div className="border-t border-line/70 pt-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Actieve template
        </div>
        <div className="flex items-start gap-2">
          <FileText
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-soft"
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <div className="break-all font-mono text-[13px] font-medium text-ink-strong">
              {bank.template_filename ?? "—"}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-soft">
              <span>{formatFileSize(bank.file_size)}</span>
              <span>geüpload {formatDate(bank.uploaded_at)}</span>
              {bank.uploaded_by && <span>door {bank.uploaded_by}</span>}
              <span>· {bank.placeholder_count} placeholders</span>
            </div>
          </div>
          {bank.file_exists && bank.template_filename && (
            <button
              type="button"
              onClick={onPreview}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-wash hover:text-ink-strong"
              title="Bekijk het actieve template in de browser"
            >
              <Eye className="h-3.5 w-3.5" strokeWidth={2} />
              Inzien
            </button>
          )}
        </div>
      </div>

      {/* Keywords (read-only, info) */}
      {bank.keywords.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Auto-detectie keywords
          </div>
          <div className="flex flex-wrap gap-1">
            {bank.keywords.map((kw) => (
              <span
                key={kw}
                className="inline-block rounded-sm border border-line bg-paper px-2 py-0.5 font-mono text-[10px] text-ink"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Upload */}
      <div className="border-t border-line/70 pt-4">
        <input
          ref={inputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={open}
          disabled={isUploading}
          className="w-full sm:w-auto"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploaden…
            </>
          ) : (
            <>
              <Upload className="h-3.5 w-3.5" />
              Nieuwe versie uploaden
            </>
          )}
        </Button>
        {uploadMessage && (
          <div
            className={cn(
              "mt-2 flex items-start gap-1.5 text-[11px]",
              uploadMessage.kind === "success" ? "text-success" : "text-danger"
            )}
          >
            {uploadMessage.kind === "success" ? (
              <CheckCircle2
                className="mt-0.5 h-3 w-3 flex-shrink-0"
                strokeWidth={2.5}
              />
            ) : (
              <AlertTriangle
                className="mt-0.5 h-3 w-3 flex-shrink-0"
                strokeWidth={2.5}
              />
            )}
            <span>{uploadMessage.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplatePreviewModal({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}) {
  const { bank, html, loading, error } = preview;
  const url = templateUrl(bank);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-ink-deeper/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-tight text-ink-strong">
              {bank.display_name} — template
            </div>
            <div className="mt-0.5 break-all font-mono text-[11px] text-ink-soft">
              {bank.template_filename}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {url && (
              <a
                href={url}
                download={bank.template_filename ?? undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-wash hover:text-ink-strong"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2} />
                Download
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Sluiten"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-wash hover:text-ink-strong"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-wash/40 p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-soft">
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
              Template laden…
            </div>
          )}
          {error && (
            <div className="py-16 text-center text-sm">
              <div className="text-danger">Kon template niet laden.</div>
              <div className="mt-1 font-mono text-[11px] text-ink-soft">{error}</div>
            </div>
          )}
          {html && (
            <div className="mx-auto max-w-2xl rounded-md bg-white p-8 shadow-card">
              <div
                className="docx-preview text-[13px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
