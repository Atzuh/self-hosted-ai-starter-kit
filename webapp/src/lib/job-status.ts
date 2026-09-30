/**
 * Volgen van achtergrondjobs in n8n.
 *
 * Zowel de bespreking- als de analyse-workflow antwoordt direct met een `job_id`
 * en werkt daarna door; de voortgang staat in `/data/shared/jobs/<id>.json` en is
 * op te vragen via `/webhook/job-status`. Zo blijft er geen HTTP-request minuten
 * openstaan voor werk dat minuten duurt, en toont de webapp de échte stap uit de
 * workflow in plaats van een tijdsschatting.
 */

export const JOB_STATUS_URL = "http://localhost:5678/webhook/job-status";

/** Hoe vaak de status wordt opgevraagd. */
const POLL_MS = 2000;

/**
 * Blijft de status onveranderd hangen, dan is de workflow er onderweg
 * uitgeklapt zonder het jobbestand bij te werken. Na deze tijd zonder enige
 * wijziging stoppen we met wachten in plaats van eindeloos te pollen.
 *
 * Stond op vijf minuten, en dat was te krap: bij een bespreking van 46 minuten
 * lag het jobbestand 318 seconden stil tijdens het samenvatten, waarna de webapp
 * afhaakte terwijl het verslag 18 seconden later klaar was. De workflow meldt
 * zich nu vaker, maar één stap kan op een trage machine nog altijd enkele
 * minuten duren — vandaar ruim.
 */
const STIL_TIMEOUT_MS = 10 * 60 * 1000;

export interface JobStatus<T = unknown> {
  success?: boolean;
  job_id?: string;
  soort?: string;
  status?: string;
  fase?: number;
  resultaat?: T | null;
  fout?: string | null;
  bijgewerkt_op?: string;
  [key: string]: unknown;
}

export interface VolgOpties<T> {
  /** Wordt bij elke poll aangeroepen, ook als er niets veranderd is. */
  onStatus?: (job: JobStatus<T>) => void;
  /** Stopt het pollen wanneer dit signaal afgaat. */
  signal?: AbortSignal;
  /**
   * Overschrijft de stilte-drempel. Nodig bij lange opnames: de transcriptie
   * loopt in één ruk door zonder tussentijdse status, dus de toegestane stilte
   * moet met de opnameduur meeschalen.
   */
  stilTimeoutMs?: number;
}

/** Antwoord van de start-webhook van een job-workflow. */
export interface JobStart {
  success?: boolean;
  job_id?: string;
  status?: string;
  fout?: string;
}

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pollt tot de job klaar is en levert het resultaat op. Gooit een Error bij een
 * mislukte job, bij een onbereikbare status-webhook, of wanneer de status te
 * lang niet meer verandert.
 */
export async function wachtOpJob<T>(
  jobId: string,
  { onStatus, signal, stilTimeoutMs }: VolgOpties<T> = {}
): Promise<T> {
  const stilTimeout = Math.max(STIL_TIMEOUT_MS, stilTimeoutMs ?? 0);
  let laatsteWijziging = Date.now();
  let vorigeStempel = "";

  for (;;) {
    if (signal?.aborted) throw new Error("Afgebroken.");
    await wacht(POLL_MS);
    if (signal?.aborted) throw new Error("Afgebroken.");

    const res = await fetch(`${JOB_STATUS_URL}?job=${encodeURIComponent(jobId)}`, { signal });
    if (!res.ok) throw new Error(`Status opvragen mislukt (HTTP ${res.status}).`);
    const job = (await res.json()) as JobStatus<T>;

    onStatus?.(job);

    if (job.bijgewerkt_op && job.bijgewerkt_op !== vorigeStempel) {
      vorigeStempel = job.bijgewerkt_op;
      laatsteWijziging = Date.now();
    }

    if (job.status === "klaar" && job.resultaat) return job.resultaat;

    if (job.status === "fout" || job.success === false) {
      throw new Error(
        job.fout || "De verwerking is afgebroken. Kijk in n8n welke stap is gesneuveld."
      );
    }

    if (Date.now() - laatsteWijziging > stilTimeout) {
      // Bewust voorzichtig geformuleerd: het is voorgekomen dat de verwerking
      // gewoon doorliep en het document even later alsnog verscheen.
      throw new Error(
        "Al een tijd geen voortgang meer. Mogelijk draait de verwerking nog door — kijk " +
          "zo meteen bij de recente bestanden of het verslag er alsnog staat. Blijft het " +
          "weg, kijk dan in n8n bij de laatste uitvoering wat er misging."
      );
    }
  }
}

/**
 * Leest het antwoord van een start-webhook. Geeft het job-id terug wanneer de
 * workflow asynchroon draait, en `null` wanneer het antwoord al het complete
 * resultaat is — zo blijven flows die nog synchroon zijn gewoon werken.
 */
export function jobIdVanAntwoord(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const job = (data as JobStart).job_id;
  return typeof job === "string" && job ? job : null;
}
