import { useCallback, useState } from "react";

/**
 * Notamail en vragen van kantoorgenoten op het dashboard. Opslag loopt via de
 * workflow 'Dashboard' (dashboard-workflow.json) naar shared/dashboard/.
 */

// Relatief: nginx stuurt /webhook/ door naar n8n (zie nginx.conf), zodat de
// webapp onder elk adres werkt en niet alleen op de Mac zelf.
const BASIS = "/webhook";

export interface Notamail {
  /** Dag waarvoor de Notamail geldt, als JJJJ-MM-DD in lokale tijd. */
  datum: string;
  /** Bestandsnaam van de pdf binnen shared/dashboard/. */
  pdf?: string | null;
  geplaatst_door: string;
  geplaatst_op: string;
}

export interface Reactie {
  id: string;
  auteur: string;
  tekst: string;
  geplaatst_op: string;
}

export interface Vraag extends Reactie {
  opgelost: boolean;
  reacties: Reactie[];
}

export type VraagActie =
  | { actie: "nieuw"; auteur: string; tekst: string }
  | { actie: "reactie"; vraag_id: string; auteur: string; tekst: string }
  | { actie: "opgelost"; vraag_id: string; opgelost: boolean }
  | { actie: "verwijderen"; vraag_id: string };

async function antwoord<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Server gaf status ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(data?.error || "Onbekende serverfout");
  return data as T;
}

// form-urlencoded 'data' veld: simpele content-type, geen CORS-preflight.
function post<T>(pad: string, payload: unknown): Promise<T> {
  return fetch(`${BASIS}/${pad}`, {
    method: "POST",
    body: new URLSearchParams({ data: JSON.stringify(payload) }),
  }).then((res) => antwoord<T>(res));
}

export async function haalDashboard(): Promise<{
  notamail: Notamail | null;
  vragen: Vraag[];
}> {
  const data = await antwoord<{ notamail: Notamail | null; vragen: Vraag[] }>(
    await fetch(`${BASIS}/dashboard`)
  );
  return { notamail: data.notamail ?? null, vragen: data.vragen ?? [] };
}

export async function uploadNotamailPdf(
  bestand: File,
  auteur: string
): Promise<Notamail> {
  // FormData zonder eigen headers: multipart is een simpele content-type, dus
  // ook hier geen CORS-preflight.
  const form = new FormData();
  form.append("datum", vandaag());
  form.append("auteur", auteur);
  form.append("file", bestand, bestand.name);
  const res = await fetch(`${BASIS}/dashboard-notamail-pdf`, {
    method: "POST",
    body: form,
  });
  return (await antwoord<{ notamail: Notamail }>(res)).notamail;
}

/**
 * Adres van de geüploade pdf. nginx serveert shared/ onder /files/. Het
 * bestand heeft elke dag dezelfde naam, vandaar de versie in de query: zonder
 * zou de browser de pdf van gisteren uit zijn cache tonen.
 */
export function notamailPdfUrl(notamail: Notamail): string | null {
  if (!notamail.pdf) return null;
  const versie = encodeURIComponent(notamail.geplaatst_op);
  return `/files/dashboard/${encodeURIComponent(notamail.pdf)}?v=${versie}`;
}

export async function bewerkVragen(actie: VraagActie): Promise<Vraag[]> {
  const data = await post<{ vragen: Vraag[] }>("dashboard-vraag", actie);
  return data.vragen ?? [];
}

/** Vandaag als JJJJ-MM-DD in lokale tijd (toISOString zou UTC geven). */
export function vandaag(): string {
  const d = new Date();
  const twee = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`;
}

export function langeDatum(datum: string): string {
  return new Date(`${datum}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function tijdGeleden(iso: string): string {
  const toen = new Date(iso);
  const minuten = Math.floor((Date.now() - toen.getTime()) / 60000);
  if (Number.isNaN(minuten)) return "";
  if (minuten < 1) return "zojuist";
  if (minuten < 60) return `${minuten} min geleden`;
  const tijd = toen.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (toen.toDateString() === new Date().toDateString()) return `vandaag ${tijd}`;
  const dag = toen.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return `${dag} ${tijd}`;
}

const NAAM_SLEUTEL = "scriptor.naam";

/**
 * De webapp kent geen login; wie iets plaatst vult een naam in. Die onthouden
 * we per browser, zodat het bij één keer invullen blijft.
 */
export function useNaam(): [string, (naam: string) => void] {
  const [naam, setNaam] = useState(() => {
    try {
      return window.localStorage.getItem(NAAM_SLEUTEL) ?? "";
    } catch {
      return "";
    }
  });

  const zet = useCallback((nieuw: string) => {
    setNaam(nieuw);
    try {
      window.localStorage.setItem(NAAM_SLEUTEL, nieuw);
    } catch {
      // Privévenster of geblokkeerde opslag: de naam geldt dan alleen nu.
    }
  }, []);

  return [naam, zet];
}
