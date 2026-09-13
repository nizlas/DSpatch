import type { DspatchBridge } from '../shared/bridge';

declare global {
  interface Window {
    /** All main-process access available to the renderer. Set by preload. */
    readonly dspatch: DspatchBridge;
  }
}
