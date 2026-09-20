import type { DspatchBridge } from '../shared/bridge';
import type { EditorRunSummary } from '../shared/loop-editor-run';

declare global {
  interface Window {
    /** All main-process access available to the renderer. Set by preload. */
    readonly dspatch: DspatchBridge;
    /** Present only while a graph is open; used by DSPATCH_EDITOR_AUTORUN. */
    __dspatchEditorCheck?: {
      dryRunCurrent: () => Promise<EditorRunSummary | null>;
      dryRunRedirectedE08: () => Promise<EditorRunSummary | null>;
    };
  }
}
