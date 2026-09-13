/**
 * Kontraktet mellan renderaren och huvudprocessen.
 *
 * Filen innehåller **enbart typer**. Det är ett krav, inte en stilfråga:
 * preload körs i sandlåda och får bara importera Electrons egna moduler som
 * värden. En typimport försvinner vid kompilering och är därför säker.
 */

import type { CapabilityReport } from '../adapter/types';

/** Versioner renderaren visar. Hämtas i huvudprocessen, aldrig i renderaren. */
export interface RuntimeVersions {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly v8: string;
}

/** Var renderarens innehåll kom ifrån. Visas i gränssnittet utan tolkning. */
export type RendererSource = 'dev-server' | 'built-files';

/** Vad huvudprocessen vet om appen och adaptern vid start. */
export interface EnvironmentInfo {
  readonly appName: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly rendererSource: RendererSource;
  readonly versions: RuntimeVersions;
  readonly adapter: {
    readonly id: string;
    readonly capabilities: CapabilityReport;
  };
}

/** Renderarens kvittens på att den monterat och målat. Underlag för startprovet. */
export interface RendererReady {
  readonly headingText: string;
  readonly capabilityCount: number;
  readonly renderedAt: string;
}

/** Det enda renderaren når av huvudprocessen. Exponeras via `contextBridge`. */
export interface DspatchBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  reportReady(ready: RendererReady): void;
}

/**
 * Kanalnamnen. Typen finns för att preload måste skriva namnen som literaler:
 * en delad konstant vore ett värde, och ett värde går inte att importera in i
 * en sandlådad preload. Typen fångar stavfel vid typkontroll i stället.
 */
export type BridgeChannel = 'dspatch:get-environment' | 'dspatch:renderer-ready';
