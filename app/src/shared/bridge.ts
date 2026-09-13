/**
 * Contract between the renderer and the main process.
 *
 * This file contains **types only**. That is a requirement: sandboxed preload
 * may import only Electron modules as values. A type import disappears during
 * compilation and is therefore safe.
 */

import type { CapabilityReport } from '../adapter/types';

/** Versions shown by the renderer. Obtained in the main process, never the renderer. */
export interface RuntimeVersions {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly v8: string;
}

/** The source of renderer content. Displayed by the UI without inference. */
export type RendererSource = 'dev-server' | 'built-files';

/** What the main process knows about the app and adapter at startup. */
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

/** Renderer acknowledgement of mounting and painting. Evidence for the smoke test. */
export interface RendererReady {
  readonly headingText: string;
  readonly capabilityCount: number;
  readonly renderedAt: string;
}

/** The only main-process interface accessible to the renderer, via `contextBridge`. */
export interface DspatchBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  reportReady(ready: RendererReady): void;
}

/**
 * Channel names. Preload must write these as literals: a shared constant would
 * be a value, which cannot be imported into sandboxed preload. The type catches
 * misspellings during type checking instead.
 */
export type BridgeChannel = 'dspatch:get-environment' | 'dspatch:renderer-ready';
