import type { GenerationMode } from "@/components/AkteGenerator";

/**
 * De documentsoorten die de Genereren-tab aanbiedt.
 *
 * `GenerationMode` in AkteGenerator blijft bewust smaller: die component werkt
 * met `Record<GenerationMode, …>` voor webhooks en labels, en is volledig
 * upload-gedreven. Het testament is een formulier en heeft een eigen scherm, dus
 * het hoort niet in die records thuis.
 */
export type DocumentSoort = GenerationMode | "testament";
