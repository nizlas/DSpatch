import type { DspatchBridge } from '../shared/bridge';

declare global {
  interface Window {
    /** Allt renderaren når av huvudprocessen. Satt av preload. */
    readonly dspatch: DspatchBridge;
  }
}
