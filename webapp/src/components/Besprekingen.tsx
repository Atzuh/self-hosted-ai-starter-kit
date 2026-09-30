import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileAudio,
  FileSignature,
  Info,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  Square,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GenerationProgress, type ProgressState } from "@/components/GenerationProgress";
import { formatteerDuur, naarWhisperWav } from "@/lib/audio-wav";
import { jobIdVanAntwoord, wachtOpJob } from "@/lib/job-status";
import { cn } from "@/lib/utils";
import type { VerslagOverdracht } from "@/components/TestamentBouwer";

const START_URL = "http://localhost:5678/webhook/bespreking";
/** Verslag opnieuw genereren met de aanvullingen van de behandelaar. */
const AANVULLEN_URL = "http://localhost:5678/webhook/bespreking-aanvullen";

/**
 * Onthoudt de gekozen microfoon tussen sessies. Wie een externe microfoon
 * gebruikt wil die niet elke bespreking opnieuw aanwijzen — en de browser kiest
 * uit zichzelf lang niet altijd het juiste apparaat.
 */
const MIC_OPSLAG_SLEUTEL = "scriptor.microfoon";

const FASEN = [
  "Opname voorbereiden",
  "Transcriberen (Whisper, lokaal)",
  "Verslag opstellen",
  "Document opmaken",
];

/** Statusnamen uit het jobbestand naar de fase-index in FASEN. */
const STATUS_FASE: Record<string, number> = {
  transcriberen: 1,
  samenvatten: 2,
  nacontrole: 2,
  document: 3,
  klaar: 3,
};

interface Onderwerp {
  kop?: string;
  punten?: string[];
  /** Kopje uit een vaste indeling waar niets over is gezegd. */
  niet_besproken?: boolean;
  /** Trefwoord dat wél in het transcript valt, terwijl het kopje leeg bleef. */
  ter_sprake?: string | null;
  /**
   * Punten die de behandelaar zelf heeft toegevoegd omdat het onderwerp wél is
   * besproken maar niet uit het transcript kwam. Staan apart van `punten` zodat
   * in het verslag zichtbaar blijft wat uit de opname komt en wat niet.
   */
  aangevuld?: string[];
}

/**
 * Soort bespreking. Bepaalt welk sjabloon uit
 * `shared/templates/besprekingen/` de volgorde van de kopjes vastlegt.
 * "auto" laat de workflow het afleiden uit het onderwerp.
 *
 * De sjablonen zelf komen uit de Templates-tab; deze lijst wordt daarom bij het
 * laden opgehaald in plaats van hier vastgelegd. Een nieuw sjabloon verschijnt
 * zo vanzelf in de keuzelijst. Dit blijft de terugval als die aanroep niet lukt.
 */
const SJABLONEN_URL = "http://localhost:5678/webhook/bespreeksjablonen";

const AUTO_SOORT = { waarde: "auto", label: "Automatisch (op basis van het onderwerp)" };
const VRIJE_SOORT = { waarde: "algemeen", label: "Geen vaste indeling" };

const SOORTEN_TERUGVAL = [
  AUTO_SOORT,
  { waarde: "testament", label: "Testament" },
  { waarde: "levenstestament", label: "Levenstestament" },
  VRIJE_SOORT,
];

interface Verslag {
  titel?: string;
  samenvatting?: string;
  deelnemers?: string[];
  waarnemingen?: string[];
  onderwerpen?: Array<Onderwerp | string>;
  afspraken?: string[];
  open_vragen?: string[];
}

interface Resultaat {
  success?: boolean;
  filename?: string | null;
  download_url?: string | null;
  verslag?: Verslag | null;
  transcript?: string;
  duur_seconden?: number;
  waarschuwingen?: string[];
  /** Welke vaste indeling is toegepast; komt uit 'Build Bespreking Response'. */
  sjabloon?: {
    soort: string;
    secties_totaal?: number;
    secties_besproken?: number;
  } | null;
}

export function Besprekingen({
  onNaarTestament,
}: {
  /** Draagt het verslag over aan de testament-bouwer in de Genereren-tab. */
  onNaarTestament?: (overdracht: VerslagOverdracht) => void;
} = {}) {
  const [dossier, setDossier] = useState("");
  const [onderwerp, setOnderwerp] = useState("");
  const [deelnemers, setDeelnemers] = useState("");
  const [soort, setSoort] = useState("auto");
  const [soorten, setSoorten] = useState(SOORTEN_TERUGVAL);
  const [context, setContext] = useState("");

  // Sjablonen ophalen voor de keuzelijst. Mislukt dat, dan blijft SOORTEN_TERUGVAL
  // staan: een bespreking starten mag nooit stuklopen op het beheerscherm.
  useEffect(() => {
    let afgebroken = false;
    (async () => {
      try {
        const res = await fetch(SJABLONEN_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          sjablonen?: Array<{ soort: string; naam: string }>;
        };
        if (afgebroken || !data.success || !Array.isArray(data.sjablonen)) return;
        setSoorten([
          AUTO_SOORT,
          ...data.sjablonen.map((s) => ({ waarde: s.soort, label: s.naam })),
          VRIJE_SOORT,
        ]);
      } catch {
        /* terugval blijft staan */
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, []);

  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioNaam, setAudioNaam] = useState("");
  const [opnemen, setOpnemen] = useState(false);
  const [opnameSeconden, setOpnameSeconden] = useState(0);

  const [microfoons, setMicrofoons] = useState<MediaDeviceInfo[]>([]);
  /** Leeg = de standaardmicrofoon van het systeem. */
  const [gekozenMic, setGekozenMic] = useState<string>(() => {
    try {
      return window.localStorage.getItem(MIC_OPSLAG_SLEUTEL) ?? "";
    } catch {
      return "";
    }
  });

  const [bezig, setBezig] = useState(false);
  const [fase, setFase] = useState(0);
  const [status, setStatus] = useState<ProgressState>("running");
  const [toonStatus, setToonStatus] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<Resultaat | null>(null);
  /** Nodig om het verslag achteraf te kunnen aanvullen; het jobbestand is de bron. */
  const [jobId, setJobId] = useState<string | null>(null);
  /** Ruwe tekst per kopje, één punt per regel. Sleutel aanwezig = aangevinkt. */
  const [aanvullingen, setAanvullingen] = useState<Record<string, string>>({});
  const [aanvulBezig, setAanvulBezig] = useState(false);
  const [aanvulFout, setAanvulFout] = useState<string | null>(null);
  /** Tijdstempel van de laatste bijwerking; breekt de browsercache op het DOCX. */
  const [aangevuldOp, setAangevuldOp] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const brokkenRef = useRef<Blob[]>([]);
  const tellerRef = useRef<number | null>(null);
  /** Breekt het pollen af als de gebruiker wegnavigeert of opnieuw begint. */
  const pollAbortRef = useRef<AbortController | null>(null);

  const stopPollen = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopPollen();
      if (tellerRef.current) window.clearInterval(tellerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, [stopPollen]);

  /**
   * Haalt de beschikbare microfoons op. Browsers geven de namen pas prijs nadat
   * er één keer toestemming is gegeven; daarvóór staat er alleen een lege label.
   * Daarom draait dit ook opnieuw zodra een opname start.
   */
  const laadMicrofoons = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const apparaten = await navigator.mediaDevices.enumerateDevices();
      const ingangen = apparaten.filter((a) => a.kind === "audioinput");
      setMicrofoons(ingangen);
      // Losgekoppelde microfoon: terug naar de standaardkeuze van het systeem,
      // anders weigert getUserMedia straks met een OverconstrainedError.
      setGekozenMic((huidig) =>
        huidig && !ingangen.some((a) => a.deviceId === huidig) ? "" : huidig
      );
    } catch {
      // Geen apparatenlijst beschikbaar: de opnameknop werkt dan gewoon met de
      // standaardmicrofoon.
    }
  }, []);

  useEffect(() => {
    laadMicrofoons();
    const opWijziging = () => laadMicrofoons();
    navigator.mediaDevices?.addEventListener?.("devicechange", opWijziging);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", opWijziging);
    };
  }, [laadMicrofoons]);

  const kiesMicrofoon = useCallback((deviceId: string) => {
    setGekozenMic(deviceId);
    try {
      if (deviceId) window.localStorage.setItem(MIC_OPSLAG_SLEUTEL, deviceId);
      else window.localStorage.removeItem(MIC_OPSLAG_SLEUTEL);
    } catch {
      // Privémodus of geblokkeerde opslag: de keuze geldt dan alleen nu.
    }
  }, []);

  const startOpname = useCallback(async () => {
    setFout(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // `exact` zodat de browser niet stilzwijgend terugvalt op de interne
          // microfoon als de gekozen externe even niet beschikbaar is — dan is
          // een duidelijke foutmelding beter dan een onbruikbare opname.
          ...(gekozenMic ? { deviceId: { exact: gekozenMic } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });

      // Nu er toestemming is, geeft de browser ook de namen van de apparaten
      // vrij — lijst verversen zodat de keuzelijst niet leeg blijft.
      laadMicrofoons();
      const recorder = new MediaRecorder(stream);
      brokkenRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) brokkenRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(brokkenRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudio(blob);
        setAudioNaam("Opname");
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setOpnemen(true);
      setOpnameSeconden(0);
      setResultaat(null);
    setAanvullingen({});
    setAanvulFout(null);
    setAangevuldOp(null);
      setToonStatus(false);
      tellerRef.current = window.setInterval(() => setOpnameSeconden((s) => s + 1), 1000);
    } catch (err) {
      const naam = err instanceof Error ? err.name : "";
      if (naam === "OverconstrainedError" || naam === "NotFoundError") {
        setFout(
          "De gekozen microfoon is niet beschikbaar. Sluit hem opnieuw aan of kies een " +
            "andere in de lijst hierboven."
        );
        laadMicrofoons();
      } else {
        setFout(
          `Geen toegang tot de microfoon: ${err instanceof Error ? err.message : String(err)}. ` +
            "Sta het gebruik van de microfoon toe, of upload een bestaande opname."
        );
      }
    }
  }, [gekozenMic, laadMicrofoons]);

  const stopOpname = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setOpnemen(false);
    if (tellerRef.current) {
      window.clearInterval(tellerRef.current);
      tellerRef.current = null;
    }
  }, []);

  const kiesBestand = useCallback((bestand: File | undefined) => {
    if (!bestand) return;
    setAudio(bestand);
    setAudioNaam(bestand.name);
    setOpnameSeconden(0);
    setResultaat(null);
    setAanvullingen({});
    setAanvulFout(null);
    setAangevuldOp(null);
    setToonStatus(false);
    setFout(null);
  }, []);

  const opnieuw = useCallback(() => {
    setAudio(null);
    setAudioNaam("");
    setOpnameSeconden(0);
    setResultaat(null);
    setAanvullingen({});
    setAanvulFout(null);
    setAangevuldOp(null);
    setToonStatus(false);
    setFout(null);
    stopPollen();
  }, [stopPollen]);

  const verwerk = useCallback(async () => {
    if (!audio) return;

    setBezig(true);
    setToonStatus(true);
    setStatus("running");
    setFase(0);
    setFout(null);
    setResultaat(null);
    setAanvullingen({});
    setAanvulFout(null);
    setAangevuldOp(null);

    try {
      // Conversie naar 16 kHz mono WAV gebeurt hier in de browser; zie
      // lib/audio-wav.ts voor waarom dat niet server-side gebeurt.
      const { blob: wav, duurSeconden } = await naarWhisperWav(audio);

      const formData = new FormData();
      formData.append("audio", wav, "bespreking.wav");
      formData.append("dossier", dossier.trim());
      formData.append("onderwerp", onderwerp.trim());
      formData.append("deelnemers", deelnemers.trim());
      formData.append("soort", soort);
      formData.append("context", context.trim());
      formData.append("duur_seconden", String(duurSeconden));
      formData.append("datum", new Date().toLocaleDateString("nl-NL"));

      setFase(1);

      const res = await fetch(START_URL, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
      const start = await res.json();
      const jobId = jobIdVanAntwoord(start);
      if (!jobId) throw new Error(start?.fout || "De server gaf geen job-id terug.");
      setJobId(jobId);

      // De workflow werkt op de achtergrond door; de fasen hieronder komen uit
      // het jobbestand en zijn dus geen tijdsschatting.
      stopPollen();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      const data = await wachtOpJob<Resultaat>(jobId, {
        signal: controller.signal,
        // Whisper werkt de status pas bij als het hele transcript klaar is, dus
        // bij een lange opname is een lange stilte normaal. Gerekend op 3×
        // realtime terwijl large-v3 er 4,4× haalt: ruim genoeg marge, ook als de
        // machine het druk heeft. Bij 6× (de vorige waarde, afgestemd op turbo)
        // zou een bespreking van 45 minuten net vóór de finish afhaken.
        stilTimeoutMs: (duurSeconden / 3) * 1000 + 120000,
        onStatus: (job) => {
          if (job.status && job.status in STATUS_FASE) setFase(STATUS_FASE[job.status]);
        },
      });

      setResultaat(data);
      setStatus("done");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setStatus("error");
      setFout(
        `Verwerken mislukt: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBezig(false);
    }
  }, [audio, dossier, onderwerp, deelnemers, soort, context, stopPollen]);

  /**
   * Stuurt de aanvullingen naar n8n, dat het verslag opnieuw door
   * genereer_besprekingsverslag.py haalt. Er komt geen model aan te pas — het
   * DOCX is een zuivere functie van het verslag — dus dit duurt een seconde en
   * overschrijft hetzelfde bestand.
   */
  async function werkVerslagBij() {
    if (!jobId) return;
    const teSturen: Record<string, string[]> = {};
    for (const [kop, tekst] of Object.entries(aanvullingen)) {
      const regels = tekst
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      if (regels.length) teSturen[kop] = regels;
    }
    if (!Object.keys(teSturen).length) return;

    setAanvulBezig(true);
    setAanvulFout(null);
    try {
      const form = new FormData();
      form.append("payload", JSON.stringify({ job_id: jobId, aanvullingen: teSturen }));
      const res = await fetch(AANVULLEN_URL, { method: "POST", body: form });
      const tekst = await res.text();
      let data: { success?: boolean; error?: string; verslag?: Verslag; download_url?: string } | null =
        null;
      try {
        data = JSON.parse(tekst);
      } catch {
        /* ruwe tekst tonen */
      }
      if (!res.ok || !data || data.success === false) {
        throw new Error(
          data?.error || `Server gaf status ${res.status}: ${tekst.slice(0, 200) || "leeg antwoord"}`
        );
      }
      setResultaat((vorig) =>
        vorig
          ? {
              ...vorig,
              verslag: data?.verslag ?? vorig.verslag,
              download_url: data?.download_url ?? vorig.download_url,
            }
          : vorig
      );
      // De ingevulde tekst blijft staan: het kopje toont daarna de aangevulde
      // punten, en een tikfout is zo nog te herstellen zonder opnieuw te typen.
      setAangevuldOp(Date.now());
    } catch (err) {
      setAanvulFout(err instanceof Error ? err.message : String(err));
    } finally {
      setAanvulBezig(false);
    }
  }

  const verslag = resultaat?.verslag;
  /** Aantal kopjes waarvoor daadwerkelijk tekst is ingevuld. */
  const aantalAanvullingen = Object.values(aanvullingen).filter((t) => t.trim()).length;

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-medium leading-tight tracking-tight text-ink-strong">
          Besprekingen
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Neem de bespreking op, of upload een geluidsbestand. Scriptor maakt lokaal een
          transcript en werkt dat uit tot een verslag met de besproken punten en afspraken.
        </p>
      </header>

      <div className="mb-5 flex gap-2.5 rounded-md border border-azure/30 bg-azure/5 px-4 py-3 text-[13px] leading-relaxed text-ink">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-azure" strokeWidth={2} />
        <p>
          Transcriptie en samenvatting draaien volledig op deze machine; er gaat geen audio
          naar buiten. De opname blijft in je browser en wordt nergens bewaard; het
          transcript gaat als bijlage mee in het verslag, zodat elke regel controleerbaar is.
        </p>
      </div>

      {/* Opname of upload */}
      <section className="mb-5 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
          <FileAudio className="h-4 w-4 text-azure" strokeWidth={2} />
          <h2 className="text-[15px] font-semibold text-ink-strong">Opname</h2>
        </div>

        <div className="p-5">
          {audio && !opnemen ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-wash/50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileAudio className="h-4 w-4 flex-shrink-0 text-ink-soft" strokeWidth={2} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink-strong">
                    {audioNaam || "Opname"}
                  </div>
                  <div className="text-[11.5px] text-ink-soft">
                    {opnameSeconden > 0 && `${formatteerDuur(opnameSeconden)} · `}
                    {(audio.size / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={opnieuw} disabled={bezig}>
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Vervangen
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                type="button"
                onClick={opnemen ? stopOpname : startOpname}
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-full transition-all",
                  opnemen
                    ? "bg-danger text-white shadow-[0_0_0_6px_hsl(var(--danger)/0.15)]"
                    : "bg-ink-strong text-paper shadow-card hover:bg-ink-strong/90"
                )}
                aria-label={opnemen ? "Opname stoppen" : "Opname starten"}
              >
                {opnemen ? (
                  <Square className="h-5 w-5" strokeWidth={2.5} />
                ) : (
                  <Mic className="h-6 w-6" strokeWidth={2} />
                )}
              </button>

              <div className="text-center">
                {opnemen ? (
                  <>
                    <div className="font-mono text-[22px] font-medium tabular-nums text-ink-strong">
                      {formatteerDuur(opnameSeconden)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-danger">Opname loopt</div>
                  </>
                ) : (
                  <div className="text-[13px] text-ink-soft">
                    Klik om op te nemen, of{" "}
                    <label className="cursor-pointer font-medium text-azure hover:underline">
                      kies een geluidsbestand
                      <input
                        type="file"
                        accept="audio/*,.m4a,.wav,.mp3,.webm"
                        className="hidden"
                        onChange={(e) => kiesBestand(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                )}
              </div>

              <MicrofoonKeuze
                microfoons={microfoons}
                gekozen={gekozenMic}
                onKies={kiesMicrofoon}
                opnemen={opnemen}
              />
            </div>
          )}
        </div>
      </section>

      {/* Context */}
      <section className="mb-5 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
          <Upload className="h-4 w-4 text-azure" strokeWidth={2} />
          <h2 className="text-[15px] font-semibold text-ink-strong">Context</h2>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Veld label="Dossiernummer" hint="Bepaalt de bestandsnaam van het verslag.">
            <Input
              value={dossier}
              onChange={(e) => setDossier(e.target.value)}
              placeholder="2026.1044"
              disabled={bezig}
            />
          </Veld>
          <Veld label="Onderwerp" hint="Helpt het model de juiste invalshoek te kiezen.">
            <Input
              value={onderwerp}
              onChange={(e) => setOnderwerp(e.target.value)}
              placeholder="Bespreking testament"
              disabled={bezig}
            />
          </Veld>
          <div className="sm:col-span-2">
            <Veld
              label="Soort bespreking"
              hint="Bij testament en levenstestament volgt het verslag de vaste kopjes uit het bespreekformulier; kopjes waar niets onder kwam blijven staan als 'Niet vastgelegd'."
            >
              <select
                value={soort}
                onChange={(e) => setSoort(e.target.value)}
                disabled={bezig}
                className={cn(
                  "flex h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink-strong transition-colors",
                  "focus-visible:outline-none focus-visible:border-azure focus-visible:ring-4 focus-visible:ring-azure/15",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {soorten.map((s) => (
                  <option key={s.waarde} value={s.waarde}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Veld>
          </div>
          <div className="sm:col-span-2">
            <Veld
              label="Deelnemers"
              hint="Bepaalt wie er onder 'Aanwezig' in het verslag komt te staan — alleen deze namen. Laat leeg om het kopje weg te laten. Scheid met komma's."
            >
              <Input
                value={deelnemers}
                onChange={(e) => setDeelnemers(e.target.value)}
                placeholder="mr. Van Dijk, de heer Jansen, mevrouw De Vries"
                disabled={bezig}
              />
            </Veld>
          </div>
          <div className="sm:col-span-2">
            <Veld
              label="Waarnemingen (optioneel)"
              hint="Wat je niet uit de opname kunt horen maar wel bij het dossier hoort: hoe iemand overkwam, wie het woord voerde, of iemand moeilijk uit zijn woorden kwam. Komt letterlijk in het verslag te staan en helpt bij het duiden van het transcript. Eén waarneming per regel."
            >
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                disabled={bezig}
                placeholder={"Mevrouw is 88 en stottert; ze had tijd nodig om uit haar woorden te komen.\nDe heer voerde vrijwel het hele gesprek."}
                className={cn(
                  "flex w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink-strong placeholder:text-ink-mute transition-colors",
                  "focus-visible:outline-none focus-visible:border-azure focus-visible:ring-4 focus-visible:ring-azure/15",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              />
            </Veld>
          </div>
        </div>
      </section>

      <div className="mb-6 flex justify-end">
        <Button
          variant="primary"
          size="lg"
          onClick={verwerk}
          disabled={!audio || opnemen || bezig}
        >
          <FileAudio className="h-4 w-4" strokeWidth={2} />
          Verslag maken
        </Button>
      </div>

      {toonStatus && (
        <div className="mb-6">
          <GenerationProgress
            phases={FASEN}
            phase={fase}
            state={status}
            errorMessage={fout}
          />
        </div>
      )}

      {fout && !toonStatus && (
        <div className="mb-6 rounded-md border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          {fout}
        </div>
      )}

      {verslag && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card animate-fade-up">
          <div className="flex items-center justify-between gap-4 border-b border-line/70 bg-paper-strong/60 px-5 py-3.5">
            <h2 className="truncate text-[15px] font-semibold text-ink-strong">
              {verslag.titel || "Besprekingsverslag"}
            </h2>
            {onNaarTestament && resultaat?.sjabloon?.soort === "testament" && verslag && (
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  onNaarTestament({
                    job_id: jobId,
                    soort: "testament",
                    dossier,
                    datum: new Date().toLocaleDateString("nl-NL"),
                    deelnemers: verslag.deelnemers || [],
                    onderwerpen: (verslag.onderwerpen || []).filter(
                      (o): o is Onderwerp => typeof o !== "string"
                    ),
                  })
                }
              >
                <FileSignature className="h-4 w-4" strokeWidth={2} />
                Testament + offerte maken
              </Button>
            )}
            {resultaat?.download_url && (
              <Button variant="outline" size="sm" asChild>
                {/* Het bijgewerkte verslag heeft dezelfde bestandsnaam, dus zonder
                    tijdstempel zou de browser de oude versie uit de cache geven. */}
                <a
                  href={
                    aangevuldOp
                      ? `${resultaat.download_url}?v=${aangevuldOp}`
                      : resultaat.download_url
                  }
                  download
                >
                  <Download className="h-4 w-4" strokeWidth={2} />
                  Download .docx
                </a>
              </Button>
            )}
          </div>

          <div className="space-y-5 p-5">
            {!!resultaat?.waarschuwingen?.length && (
              <div className="flex gap-2.5 rounded-md border border-amber/40 bg-amber/8 px-4 py-3 text-[13px] text-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber" strokeWidth={2} />
                <div className="space-y-1">
                  {resultaat.waarschuwingen.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}

            {!!verslag.waarnemingen?.length && (
              <Blok titel="Waarnemingen behandelaar">
                <ul className="space-y-1">
                  {verslag.waarnemingen.map((w, i) => (
                    <li key={i} className="text-[13.5px] leading-relaxed text-ink">
                      {w}
                    </li>
                  ))}
                </ul>
              </Blok>
            )}

            {verslag.samenvatting && (
              <Blok titel="Samenvatting">
                <p className="text-[13.5px] leading-relaxed text-ink">{verslag.samenvatting}</p>
              </Blok>
            )}

            {!!verslag.deelnemers?.length && (
              <Blok titel="Aanwezig">
                <div className="flex flex-wrap gap-1.5">
                  {verslag.deelnemers.map((d, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-line bg-wash px-2.5 py-0.5 text-[12px] text-ink"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </Blok>
            )}

            {!!verslag.onderwerpen?.length && (
              <Blok titel="Besproken">
                <div className="space-y-3">
                  {verslag.onderwerpen.map((o, i) =>
                    typeof o === "string" ? (
                      <p key={i} className="text-[13.5px] text-ink">
                        {o}
                      </p>
                    ) : (
                      <OnderwerpRegel
                        key={i}
                        onderwerp={o}
                        // Alleen bij een leeg kopje valt er iets aan te vullen;
                        // wat het model wél heeft opgeleverd blijft zoals het is.
                        aanvulbaar={
                          !!jobId && !o.punten?.length && !!o.kop
                        }
                        invoer={o.kop ? aanvullingen[o.kop] : undefined}
                        bezig={aanvulBezig}
                        onZetInvoer={(tekst) => {
                          if (!o.kop) return;
                          setAanvullingen((vorig) => {
                            const volgend = { ...vorig };
                            if (tekst === null) delete volgend[o.kop as string];
                            else volgend[o.kop as string] = tekst;
                            return volgend;
                          });
                        }}
                      />
                    )
                  )}
                </div>

                {aantalAanvullingen > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-wash/50 px-4 py-3">
                    <Button size="sm" onClick={werkVerslagBij} disabled={aanvulBezig}>
                      {aanvulBezig ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Verslag bijwerken
                    </Button>
                    <span className="text-[12.5px] text-ink-soft">
                      {aantalAanvullingen}{" "}
                      {aantalAanvullingen === 1 ? "kopje" : "kopjes"} aangevuld. Het
                      .docx wordt opnieuw gemaakt en overschrijft de huidige versie.
                    </span>
                  </div>
                )}

                {aanvulFout && (
                  <p className="mt-3 rounded-md border border-danger/40 bg-danger/8 px-4 py-2.5 text-[13px] text-danger">
                    Bijwerken mislukt: {aanvulFout}
                  </p>
                )}

                {aangevuldOp && !aanvulFout && !aanvulBezig && (
                  <p className="mt-3 text-[12.5px] text-ink-soft">
                    Verslag bijgewerkt. In het document staan jouw punten met de
                    vermelding “aangevuld door de behandelaar”, zodat te zien blijft
                    wat uit de opname komt.
                  </p>
                )}
              </Blok>
            )}

            {!!verslag.afspraken?.length && (
              <Blok titel="Gemaakte afspraken">
                <Lijst items={verslag.afspraken} />
              </Blok>
            )}

            {!!verslag.open_vragen?.length && (
              <Blok titel="Open vragen">
                <Lijst items={verslag.open_vragen} />
              </Blok>
            )}

            {resultaat?.transcript && (
              <details className="rounded-md border border-line bg-wash/40 px-4 py-3">
                <summary className="cursor-pointer text-[13px] font-medium text-ink-strong">
                  Transcript tonen
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-soft">
                  {resultaat.transcript}
                </p>
              </details>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Keuzelijst voor de microfoon. Staat er maar één ingang, dan heeft kiezen geen
 * zin en blijft het blok weg — behalve zolang de browser nog geen namen
 * vrijgeeft, want dan weet de gebruiker niet wát er straks opneemt.
 */
function MicrofoonKeuze({
  microfoons,
  gekozen,
  onKies,
  opnemen,
}: {
  microfoons: MediaDeviceInfo[];
  gekozen: string;
  onKies: (deviceId: string) => void;
  opnemen: boolean;
}) {
  // Zonder toestemming levert de browser wel het aantal apparaten, maar lege
  // labels. Dan tonen we een uitleg in plaats van een lijst met "Microfoon 2".
  const namenBekend = microfoons.some((m) => m.label);

  if (microfoons.length <= 1 && namenBekend) return null;

  const actief = microfoons.find((m) => m.deviceId === gekozen);

  return (
    <div className="w-full max-w-sm space-y-1.5">
      <label
        htmlFor="microfoon"
        className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft"
      >
        <Mic className="h-3 w-3" strokeWidth={2.25} />
        Microfoon
      </label>

      {namenBekend ? (
        <select
          id="microfoon"
          value={gekozen}
          disabled={opnemen}
          onChange={(e) => onKies(e.target.value)}
          className={cn(
            "flex h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-ink-strong transition-colors",
            "focus-visible:outline-none focus-visible:border-azure focus-visible:ring-4 focus-visible:ring-azure/15",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <option value="">Standaard van het systeem</option>
          {microfoons.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microfoon ${i + 1}`}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-center text-[11.5px] leading-snug text-ink-soft">
          De namen van de microfoons verschijnen zodra je één keer toestemming
          hebt gegeven voor opnemen.
        </p>
      )}

      {opnemen && actief && (
        <p className="text-center text-[11.5px] text-ink-soft">
          Neemt op via {actief.label}
        </p>
      )}
    </div>
  );
}

/**
 * Eén kopje uit het verslag. Bleef het leeg, dan kan de behandelaar aanvinken
 * dat het onderwerp wél is besproken en zelf opschrijven wat er is afgesproken —
 * het transcript mist zoiets geregeld, en een kopje dat "Niet vastgelegd" blijft
 * lezen terwijl de keuze wel is gemaakt, is voor het dossier onbruikbaar.
 */
function OnderwerpRegel({
  onderwerp,
  aanvulbaar,
  invoer,
  bezig,
  onZetInvoer,
}: {
  onderwerp: Onderwerp;
  aanvulbaar: boolean;
  /** Ruwe tekst uit het invoerveld; undefined = vinkje staat uit. */
  invoer: string | undefined;
  bezig: boolean;
  /** null wist de aanvulling (vinkje uit), een string bewaart de tekst. */
  onZetInvoer: (tekst: string | null) => void;
}) {
  const heeftPunten = !!onderwerp.punten?.length;
  const heeftAanvulling = !!onderwerp.aangevuld?.length;
  const aangevinkt = invoer !== undefined;

  return (
    <div>
      {onderwerp.kop && (
        <div
          className={cn(
            "mb-1 text-[13px] font-semibold",
            heeftPunten || heeftAanvulling ? "text-ink-strong" : "text-ink-mute"
          )}
        >
          {onderwerp.kop}
        </div>
      )}

      {heeftPunten && <Lijst items={onderwerp.punten as string[]} />}

      {heeftAanvulling && (
        <ul className="space-y-1">
          {onderwerp.aangevuld!.map((punt, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-ink">
              <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-ink-mute" />
              <span>
                {punt}
                <span className="ml-1.5 text-[11.5px] italic text-ink-soft">
                  aangevuld
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!heeftPunten && !heeftAanvulling && (
        <p className="text-[12.5px] italic text-ink-mute">
          {onderwerp.ter_sprake
            ? `Kwam ter sprake (\u201c${onderwerp.ter_sprake}\u201d), geen uitkomst vastgelegd — controleer het transcript.`
            : "Niet vastgelegd."}
        </p>
      )}

      {aanvulbaar && (
        <div className="mt-1.5">
          <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={aangevinkt}
              disabled={bezig}
              onChange={(e) =>
                onZetInvoer(
                  e.target.checked ? (onderwerp.aangevuld || []).join("\n") : null
                )
              }
              className="h-3.5 w-3.5 rounded border-line-strong accent-azure"
            />
            {heeftAanvulling ? "Aanvulling aanpassen" : "Wel besproken — zelf invullen"}
          </label>

          {aangevinkt && (
            <textarea
              value={invoer}
              onChange={(e) => onZetInvoer(e.target.value)}
              disabled={bezig}
              rows={3}
              autoFocus
              placeholder="Wat is er over dit onderwerp besproken? Eén punt per regel."
              className="mt-1.5 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink-strong transition-colors focus-visible:border-azure focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-azure/15 disabled:opacity-50"
            />
          )}
        </div>
      )}
    </div>
  );
}

function Blok({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {titel}
      </h3>
      {children}
    </div>
  );
}

function Lijst({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.filter(Boolean).map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink">
          <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-azure" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Veld({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-ink-strong">{label}</label>
      {children}
      {hint && <p className="text-[11.5px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}
