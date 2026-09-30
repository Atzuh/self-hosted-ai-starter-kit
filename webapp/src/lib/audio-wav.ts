/**
 * Audio omzetten naar 16 kHz mono WAV — het formaat dat whisper.cpp verwacht.
 *
 * De conversie gebeurt bewust in de browser en niet server-side: whisper.cpp
 * leest zelf alleen WAV, en de n8n-container heeft geen ffmpeg. De Web Audio API
 * decodeert alles wat de browser aankan (webm/opus uit MediaRecorder, maar ook
 * een aangeleverde mp3 of m4a), dus daarmee valt de hele ffmpeg-afhankelijkheid
 * uit de keten weg.
 *
 * Prijs: 16-bits PCM is ~1,9 MB per minuut. Voor besprekingen tot ongeveer een
 * half uur is dat over localhost prima; wordt dit langer, dan hoort de opname
 * gecomprimeerd naar de server te gaan en de conversie alsnog naar een
 * host-proces met ffmpeg.
 */

/** Doel-samplerate van Whisper. Alles wordt hiernaartoe geresampled. */
export const WHISPER_SAMPLE_RATE = 16000;

/** Decodeert willekeurige audio naar een AudioBuffer op de eigen samplerate. */
async function decodeer(blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer();
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
}

/** Mixt alle kanalen samen tot één mono-spoor. */
function naarMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const lengte = buffer.length;
  const mono = new Float32Array(lengte);
  for (let kanaal = 0; kanaal < buffer.numberOfChannels; kanaal++) {
    const data = buffer.getChannelData(kanaal);
    for (let i = 0; i < lengte; i++) mono[i] += data[i];
  }
  for (let i = 0; i < lengte; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

/**
 * Resample naar 16 kHz. Bij voorkeur via OfflineAudioContext — die filtert netjes
 * en voorkomt aliasing. Weigert de browser een context op 16 kHz (oudere Safari),
 * dan valt de code terug op lineaire interpolatie: hoorbaar minder mooi, maar
 * Whisper heeft er in de praktijk weinig last van.
 */
async function resample(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === WHISPER_SAMPLE_RATE) return naarMono(buffer);

  const duur = buffer.length / buffer.sampleRate;
  const doelLengte = Math.max(1, Math.ceil(duur * WHISPER_SAMPLE_RATE));

  try {
    const OfflineCtx: typeof OfflineAudioContext =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const offline = new OfflineCtx(1, doelLengte, WHISPER_SAMPLE_RATE);
    const bron = offline.createBufferSource();
    bron.buffer = buffer;
    bron.connect(offline.destination);
    bron.start(0);
    const gerenderd = await offline.startRendering();
    return gerenderd.getChannelData(0);
  } catch {
    const mono = naarMono(buffer);
    const verhouding = buffer.sampleRate / WHISPER_SAMPLE_RATE;
    const uit = new Float32Array(doelLengte);
    for (let i = 0; i < doelLengte; i++) {
      const positie = i * verhouding;
      const links = Math.floor(positie);
      const rechts = Math.min(links + 1, mono.length - 1);
      const fractie = positie - links;
      uit[i] = mono[links] * (1 - fractie) + mono[rechts] * fractie;
    }
    return uit;
  }
}

/** Verpakt PCM-samples in een WAV-container (16-bits, mono). */
function schrijfWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const schrijfTekst = (offset: number, tekst: string) => {
    for (let i = 0; i < tekst.length; i++) view.setUint8(offset + i, tekst.charCodeAt(i));
  };

  schrijfTekst(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  schrijfTekst(8, "WAVE");
  schrijfTekst(12, "fmt ");
  view.setUint32(16, 16, true); // lengte fmt-blok
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  schrijfTekst(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const klem = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, klem < 0 ? klem * 0x8000 : klem * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export interface WavResultaat {
  blob: Blob;
  duurSeconden: number;
}

/** Zet een opname of geüpload audiobestand om naar 16 kHz mono WAV. */
export async function naarWhisperWav(bron: Blob): Promise<WavResultaat> {
  const buffer = await decodeer(bron);
  const samples = await resample(buffer);
  return {
    blob: schrijfWav(samples, WHISPER_SAMPLE_RATE),
    duurSeconden: Math.round(buffer.length / buffer.sampleRate),
  };
}

/** "1:04:12" / "7:23" — voor de opnameteller en de resultaatkop. */
export function formatteerDuur(seconden: number): string {
  const totaal = Math.max(0, Math.round(seconden));
  const uren = Math.floor(totaal / 3600);
  const minuten = Math.floor((totaal % 3600) / 60);
  const sec = totaal % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return uren > 0 ? `${uren}:${pad(minuten)}:${pad(sec)}` : `${minuten}:${pad(sec)}`;
}
