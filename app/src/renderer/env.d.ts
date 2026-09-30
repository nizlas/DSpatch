import type { DspatchBridge, LoopGraphOpenRequest } from '../shared/bridge';
import type { EditorRunSummary } from '../shared/loop-editor-run';

/**
 * What the node panel ended up showing, for a window trial to check before it claims a
 * screenshot. `roleChars` and `roleVisibleHeight` are the two that matter: a capture in
 * which the role text is absent or has no height is not evidence that it is legible.
 */
interface PanelShown {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly roleId: string | null;
  readonly roleSourcePath: string | null;
  readonly roleChars: number;
  /** Pixels of the role box inside the window, with the panel at the top. */
  readonly roleVisibleHeight: number;
  /** Pixels of the Advanced section inside the window, once it has been opened. */
  readonly advancedVisibleHeight: number;
  readonly briefHeadings: number;
  readonly advancedFound: boolean;
  readonly advancedOpen: boolean;
  readonly purpose: string;
  /**
   * The runtime instructions the panel shows as text rather than as a description of
   * text (DSP-94). Each is read from the rendered block, so a trial can put what is on
   * screen beside what the prompt builder makes and see whether they are the same
   * characters. A heading with no block here is a part the message only points at.
   */
  readonly briefTexts: readonly { readonly id: string; readonly text: string }[];
  /** Pixels of the instruction list inside the window, once it has been scrolled to. */
  readonly briefVisibleHeight: number;
  /** What the panel says the step may do while it works, or '' if it says nothing. */
  readonly toolPolicyNote: string;
  /** What the panel says about where this step's model comes from. */
  readonly modelNote: string;
  /** Whether the model box claims this choice reaches the whole run. */
  readonly modelAppliesToEveryStep: boolean;
}

/**
 * The whole graph view as one reading, so "a run start moved nothing" can be measured.
 *
 * DSP-86. Every field here exists to be compared with itself a moment later: the claim
 * the card makes is about *sameness* across a run starting and ending, and sameness is
 * the one property a single reading cannot establish. The lock is read three ways —
 * the state, the canvas's class and the fieldset the browser is enforcing — because a
 * lock that was computed and never rendered is the interesting way for this to fail.
 */
interface ViewShown {
  readonly zoom: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly svgWidth: number;
  readonly canvasBox: { readonly width: number; readonly height: number };
  readonly inspectorBox: { readonly width: number; readonly height: number };
  readonly paletteBox: { readonly width: number; readonly height: number };
  readonly selectedKind: string;
  readonly selectedId: string;
  readonly nodesDrawn: number;
  readonly edgesDrawn: number;
  readonly graphName: string;
  readonly titleLine: string;
  readonly noteLine: string;
  readonly locked: boolean;
  readonly canvasLocked: boolean;
  readonly inspectorLocked: boolean | null;
  readonly chooserDisabled: boolean | null;
  readonly openLoopDisabled: boolean | null;
  readonly saveDisabled: boolean | null;
  readonly dryRunDisabled: boolean | null;
  readonly runDisabled: boolean | null;
  readonly paletteButtonsEnabled: number;
  readonly marked: readonly {
    readonly id: string;
    readonly state: string;
    /** Whether the glint is running on this node (DSP-80). */
    readonly working: boolean;
    /** `success`, `reached`, or empty for a node no run ended at (DSP-36). */
    readonly ending: string;
  }[];
  readonly entryNodeId: string;
  readonly entryState: string;
  readonly gone: {
    readonly runBanner: boolean;
    readonly leaveTheRunView: boolean;
    readonly theRunOnScreen: boolean;
    readonly whatTheWordsMean: boolean;
    readonly thisRunSoFar: boolean;
    readonly journal: boolean;
  };
  readonly controlPresent: boolean;
  readonly controlPhase: string;
  readonly standing: string;
  readonly pinnedDrawingChip: string;
  readonly unsavedChip: string;
}

/**
 * What one node is doing and how big it is, measured rather than asserted (DSP-80).
 *
 * The two claims this exists for are the ones a screenshot cannot settle. *Motion* is
 * `animations`, which is how many CSS animations the browser reports as actually running
 * on this node's own elements — a count from `getAnimations()`, not a class name and not an
 * animation's name, so it says whether something is moving rather than whether a rule was
 * written. *Size* is `bodyWidth`/`bodyHeight` for the drawn box and `groupWidth`/
 * `groupHeight` for everything drawn with it, including the halo and the glint; a glint
 * that inflated the node would show up in the second pair while the first stayed put,
 * which is exactly the failure the card warns about.
 */
interface NodeLiveness {
  readonly id: string;
  readonly state: string;
  readonly working: boolean;
  readonly ending: string;
  /** Running CSS animations on the body, the halo and the glint segments together. */
  readonly animations: number;
  /** Glint segments drawn with any visible opacity at all. */
  readonly glintsLit: number;
  /** The halo's opacity as the browser is currently painting it. */
  readonly haloOpacity: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly groupWidth: number;
  readonly groupHeight: number;
  readonly groupLeft: number;
  readonly groupTop: number;
  /** Whether a green tick is drawn on this node, and whether a plain ring is. */
  readonly tick: boolean;
  readonly ring: boolean;
}

declare global {
  interface Window {
    /** All main-process access available to the renderer. Set by preload. */
    readonly dspatch: DspatchBridge;
    /** Present only while a graph is open; used by DSPATCH_EDITOR_AUTORUN. */
    __dspatchEditorCheck?: {
      dryRunCurrent: () => Promise<EditorRunSummary | null>;
      dryRunRedirectedE08: () => Promise<EditorRunSummary | null>;
      /** Draw a graph the way the header's buttons do, and say what appeared. */
      openTarget: (request: LoopGraphOpenRequest) => Promise<{
        readonly headerText: string;
        readonly noteText: string;
        readonly nodesDrawn: number;
      }>;
      /**
       * Choose a loop from the editor's chooser and report what the window then shows.
       *
       * DSP-85. The chooser's own value and options are in the answer because the claim
       * being checked is that one gesture both selects and draws: `chooserValue` says what
       * is selected and `nodesDrawn` says what is on the canvas, and a refusal has to
       * leave both of them where they were.
       */
      chooseLoop: (definitionPath: string) => Promise<{
        readonly noteText: string;
        readonly headerText: string;
        readonly chooserValue: string;
        readonly chooserKeys: readonly string[];
        readonly nodesDrawn: number;
        readonly choiceError: string;
        readonly unsavedWarning: string;
        /**
         * Whether the switch was carried out (DSP-88).
         *
         * `unchanged` covers all three ways a choice can decline to happen — a dismissed
         * chooser, a refused definition, and a *Cancel* at the unsaved-drawing question —
         * and it comes from the function that decided, not from the document. A cancelled
         * switch is supposed to leave the drawing and the chooser untouched, so a trial
         * inferring "nothing happened" from them would be reading its own premise.
         */
        readonly switched: 'switched' | 'unchanged';
      }>;
      /** What the chooser and canvas say now, with no gesture. */
      readChooser: () => {
        readonly chooserValue: string;
        readonly chooserKeys: readonly string[];
        readonly nodesDrawn: number;
        readonly headerText: string;
      };
      /**
       * Select a node and report what its panel shows. See LoopEditor for why.
       * `anchor` is a selector to bring into view before the picture is taken.
       */
      showNode: (id: string, advanced: boolean, anchor?: string) => Promise<PanelShown | null>;
      /** Everything a trial compares either side of a run starting and ending. */
      readView: () => ViewShown;
      /**
       * What every marked node is doing, and its geometry, for DSP-80 and DSP-36.
       *
       * Separate from `readView` because it reads the browser's running animations and
       * the painted layout of every node, which is worth doing at the moment a state is
       * being judged and not on every reading of the header.
       */
      readLiveness: () => readonly NodeLiveness[];
      /**
       * Dry-run the drawing the way the button does, and answer what the runner recorded.
       *
       * The status and the terminal come from `RunResult`, which is the thing DSP-36 calls
       * the recorded outcome. `null` when the canvas had nothing runnable on it.
       */
      dryRunOnCanvas: () => Promise<{
        readonly status: string;
        readonly terminalNodeId: string | null;
        readonly path: readonly string[];
      } | null>;
      /**
       * Mark one node as working, or the entry node as ready, without running anything.
       *
       * Both announcements are the ones real callers send and both go through the same
       * `receiveRunEvent`, so the drawing that results is the drawing a run produces. The
       * two states exclude each other by the state rule, so a caller wanting both reads
       * them one after the other. `null` when no graph is on the canvas.
       */
      showLivenessForLook: (
        want: 'working' | 'ready',
        nodeId?: string,
      ) => Promise<{ readonly nodeId: string } | null>;
      /**
       * Hold the glint still with its leading edge at `leadAt`, and say where to sample.
       *
       * `back` and `ahead` are how far behind and in front of the leading edge to sample,
       * in the same hundredths of the outline the glint's own numbers are in, and `step` is
       * the spacing. Each sample carries its screen position, the outward normal there, and
       * how far the outline has turned since the first sample — which is how a reader knows
       * whether its samples crossed a corner.
       */
      freezeGlintAt: (
        nodeId: string,
        leadAt: number,
        back: number,
        ahead: number,
        step: number,
      ) => Promise<{
        readonly leadAt: number;
        readonly frozenAtMs: number;
        readonly screenPixelsPerUnit: number;
        readonly devicePixelRatio: number;
        readonly viewportWidth: number;
        readonly viewportHeight: number;
        readonly samples: readonly {
          readonly offsetFromLead: number;
          readonly x: number;
          readonly y: number;
          readonly nx: number;
          readonly ny: number;
          readonly turnDeg: number;
        }[];
      } | null>;
      /**
       * Scroll a node to the middle of the drawing area, and answer both rectangles.
       *
       * Client coordinates, so a caller can require that the node — and any line of points it
       * means to sample — is really inside the canvas and not behind the inspector panel.
       */
      centreNodeInCanvas: (nodeId: string) => {
        readonly nodeLeft: number;
        readonly nodeTop: number;
        readonly nodeRight: number;
        readonly nodeBottom: number;
        readonly canvasLeft: number;
        readonly canvasTop: number;
        readonly canvasRight: number;
        readonly canvasBottom: number;
      } | null;
      /**
       * Play every animation on a node again after a frame of it was frozen, and say how many.
       *
       * What reduced motion does cannot be read on a node whose animations are already
       * paused: nothing running before and nothing running after is the same reading whether
       * the preference was honoured or ignored.
       */
      resumeLivenessMotion: (nodeId: string) => number;
      /**
       * The pulse's weakest and strongest states, its rhythm, and its reach toward the text.
       *
       * Opacities are the browser's computed values with the real animation stopped at the
       * keyframes that define them. `labelClearanceUnits` is the gap in graph units between
       * the label's ink and the inner edge of the halo's stroke; a positive number is the
       * ring being unable to reach the words.
       */
      readPulseExtremes: (
        nodeId: string,
        /** The fraction of the cycle to leave the animations stopped at, for a picture. */
        leaveAt?: number,
      ) => {
        readonly haloTrough: number;
        readonly haloPeak: number;
        readonly bodyTrough: number;
        readonly bodyPeak: number;
        readonly haloDurationMs: number;
        readonly bodyDurationMs: number;
        readonly haloStrokeWidth: number;
        readonly labelClearanceUnits: number | null;
      } | null;
      /** Zoom and scroll the canvas the way a person does, so the view is distinctive. */
      setViewState: (zoom: number, scrollLeft: number, scrollTop: number) => Promise<void>;
      /** Move a node, which is a real edit and leaves a real unsaved drawing. */
      nudgeNode: (id: string, by: number) => boolean;
    };
  }
}
