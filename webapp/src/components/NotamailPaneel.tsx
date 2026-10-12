import { useRef, useState, type DragEvent } from "react";
import {
  ExternalLink,
  FileUp,
  Loader2,
  Newspaper,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  langeDatum,
  notamailPdfUrl,
  tijdGeleden,
  uploadNotamailPdf,
  vandaag,
  type Notamail,
} from "@/lib/dashboard";

interface NotamailPaneelProps {
  notamail: Notamail | null;
  naam: string;
  onGeplaatst: (notamail: Notamail) => void;
}

// Gelijk aan MAX_BYTES in de node 'Save Notamail PDF'.
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export function NotamailPaneel({
  notamail,
  naam,
  onGeplaatst,
}: NotamailPaneelProps) {
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [sleept, setSleept] = useState(false);
  const bestandRef = useRef<HTMLInputElement>(null);

  const vanVandaag = notamail?.datum === vandaag();
  const pdfUrl = notamail ? notamailPdfUrl(notamail) : null;

  async function voerUit(actie: () => Promise<Notamail>) {
    setBezig(true);
    setFout(null);
    try {
      onGeplaatst(await actie());
    } catch (err) {
      setFout(`Plaatsen mislukt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBezig(false);
    }
  }

  function upload(bestand: File | undefined) {
    if (!bestand) return;
    if (!bestand.name.toLowerCase().endsWith(".pdf")) {
      setFout("Alleen pdf-bestanden kunnen worden geüpload.");
      return;
    }
    if (bestand.size > MAX_PDF_BYTES) {
      setFout("Het bestand is groter dan 25 MB.");
      return;
    }
    voerUit(() => uploadNotamailPdf(bestand, naam.trim()));
  }

  function opDrop(e: DragEvent) {
    e.preventDefault();
    setSleept(false);
    if (!bezig) upload(e.dataTransfer.files[0]);
  }

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setSleept(true);
      }}
      onDragLeave={() => setSleept(false)}
      onDrop={opDrop}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-colors animate-fade-up",
        sleept && "border-azure"
      )}
    >
      <input
        ref={bestandRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          upload(e.target.files?.[0]);
          // Leegmaken, anders vuurt onChange niet bij hetzelfde bestand opnieuw.
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
        <Newspaper className="h-4 w-4 text-seal" strokeWidth={2} />
        <h2 className="text-[15px] font-semibold text-ink-strong">Notamail</h2>
        {notamail &&
          (vanVandaag ? (
            <Badge variant="success">Vandaag</Badge>
          ) : (
            <Badge variant="amber">{langeDatum(notamail.datum)}</Badge>
          ))}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={bezig}
          onClick={() => bestandRef.current?.click()}
        >
          {bezig ? <Loader2 className="animate-spin" /> : <FileUp />}
          Pdf uploaden
        </Button>
      </div>

      {fout && (
        <p className="border-b border-line/70 px-5 py-3 text-[13px] text-danger">
          {fout}
        </p>
      )}

      {notamail ? (
        <div className="p-5">
          {!vanVandaag && (
            <p className="mb-4 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-ink">
              De Notamail van vandaag is nog niet geplaatst. Hieronder staat de
              laatste.
            </p>
          )}
          {pdfUrl && (
            <iframe
              // De key dwingt een nieuwe iframe af bij een nieuwe upload; alleen
              // de src wijzigen laat sommige pdf-viewers de oude pagina tonen.
              key={pdfUrl}
              src={pdfUrl}
              title="Notamail"
              className="h-[720px] w-full rounded-md border border-line bg-white"
            />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-[11.5px] text-ink-soft">
            <span>
              Geplaatst
              {notamail.geplaatst_door && ` door ${notamail.geplaatst_door}`},{" "}
              {tijdGeleden(notamail.geplaatst_op)}
            </span>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-azure underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Openen in nieuw tabblad
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 p-5">
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            Er is nog geen Notamail geplaatst. Upload de pdf van vandaag of
            sleep hem hierheen, dan ziet iedereen op kantoor hem hier.
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={bezig}
            onClick={() => bestandRef.current?.click()}
          >
            {bezig ? <Loader2 className="animate-spin" /> : <FileUp />}
            Pdf uploaden
          </Button>
        </div>
      )}
    </section>
  );
}
