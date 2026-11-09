import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DiscussionActivity, DiscussionAnswer, PendingLine, ShortThenMore } from './DiscussionAnswer';
import { Markdown } from './Markdown';
import { ReviewDiscussion } from './ReviewDiscussion';
import { AgentPicker } from './AgentPicker';
import { AgentReviewResult, attemptLabel, isRunning, JobLine, JobNote, requestFailure } from './PairReview';
import { Inline, LineGutter, TokensView, asLocation, capitalise, fileName, lineDigits, rangeText, useFiles, useRows, type Files } from './review-code';
import { FileTree, WalkTimeline, stationsOf, unitLabel, unitTitle } from './ReviewTimeline';
import { WORDS, pick, type ReviewWords } from './review-i18n';
import { paneOfStation, panesOf, stopsOf } from './walk-panes';
import {
  stepsWalks,
  type CheckKind,
  type CheckPoint,
  DEFAULT_PREFERENCES,
  EXPLANATION_WIDTH,
  NAVIGATION_WIDTH,
  isProsePath,
  wrapsLines,
  computeCoverage,
  currentHunkDecisions,
  placeKey,
  referenceRows,
  reviewIdentityLabel,
  type CodeLevel,
  type CodeLocation,
  type CoverageSummary,
  type DiffFile,
  type DiffHunk,
  type DiffRow,
  type HunkCoverage,
  type Lang,
  type ReviewPreferences,
  type Place,
  type PlanState,
  type ReviewBridge,
  type ReviewBundle,
  type ReviewDecision,
  type ReviewNote,
  type ReviewOpenOutcome,
  type ReviewSearchHit,
  type ReviewState,
  type RevisionSide,
  type Walk,
  type WalkStep,
} from '../shared/review-model';
import { stepContentHash } from '../shared/review-model';
import { PRESENTATION_INSTRUCTION_VERSION, PUBLIC_PROFILES, isPublicProfile, type PresentationProfile, type PublicProfile, type WalkOutline } from '../shared/presentation-profiles';
import {
  WALK_TEXT,
  historyOf,
  shownItem,
  slotKey,
  wantsExplanation,
  type ExplanationAction,
  type ExplanationHistory,
  type ExplanationSlot,
  type StepExplanation,
  type StepExplanationOutcome,
} from '../shared/step-explanations';
import { usePresentationProfile, useStepExplanations } from './presentation-choice';
import type { DeepenRequest, DiscussionMessage, DiscussionRequest, SelectionQuote } from '../shared/review-discussion';
import { quoteRanges, readQuote } from './walk-selection';
import { generationStale, isPairError, type AgentJob, type LineRange, type PairFile, type PairRecord, type PairWalk, type PanelFollow, type PanelState, type ReviewPairBridge, type ReviewPanelBridge } from '../shared/review-pair';
import { hunkDecisionsFromPair, hunkRanges, pairOpFor } from '../shared/review-pair-walk';
import { KIND_WORDS, STATUS_WORDS, reviewThreadsOf, threadOfPoint, type ReviewThread } from '../shared/review-threads';
import { PairKeyContext } from './DiscussionAnswer';
import { WalkContextPlaces } from './WalkContextPlaces';
import { STATUS_MARK, ThreadCard, ThreadContext, exchangesByThread, replyCountOf, type ThreadActions } from './ReviewThreads';

declare global {
  interface Window {
    readonly dspatchReview?: ReviewBridge;
    /** The review's panel, Step and Discussion (30 October 2026). */
    readonly dspatchReviewPanel?: ReviewPanelBridge;
    /**
     * Save whatever the open review has not saved yet, and say when it is done. The
     * main process calls it before a review window closes (`review-windows.ts`).
     */
    __dspatchReviewFlush?: () => Promise<string>;
    /** What the scripted `review-window` scenario reads and drives, from the main process. */
    __dspatchReviewCheck?: ReviewCheck;
  }
}

/**
 * This page is the review's panel (Niclas's decision of 30 October 2026): the whole right
 * panel, Step and Discussion, belonging to the review, in its own window or docked in a code
 * window of it. It shows no walk of its own: Step follows the walk window, and what it asks
 * of the code (a step, a place, a reference) is done there. It keeps no record of its own.
 */
const PANEL_MODE = new URLSearchParams(window.location.search).get('view') === 'panel';

/**
 * Where an opened code location is (Niclas's trial, 30 October 2026): the file by name and
 * its folder, which revision and commit, and the lines; and the way back to where it was
 * opened from.
 */
function AwayBar({
  away,
  sha,
  back,
  onBack,
}: {
  readonly away: CodeLocation;
  readonly sha: string;
  /** What Back returns to: a step id or a location, or nothing to return to. */
  readonly back: string | null;
  readonly onBack: () => void;
}): JSX.Element {
  const folder = away.path.includes('/') ? away.path.slice(0, away.path.lastIndexOf('/') + 1) : '';
  return (
    <div className="rv-away" data-ev="away-bar">
      <span className="rv-away-where">
        <span className="rv-away-file" title={away.path}>
          {fileName(away.path)}
        </span>
        {folder !== '' && <span className="rv-away-folder">{folder}</span>}
        <span className={`rv-away-side rv-away-side-${away.side}`} data-ev="away-side">
          {away.side === 'base' ? 'From' : 'To'} · {sha.slice(0, 7)}
        </span>
        <span className="rv-away-lines">{away.start === away.end ? `line ${String(away.start)}` : `lines ${String(away.start)}–${String(away.end)}`}</span>
      </span>
      {back !== null && (
        <button type="button" className="rv-away-back" data-ev="away-back" onClick={onBack}>
          ← Back to {back}
        </button>
      )}
    </div>
  );
}

/** The scenario's view of a review window: readings, and the two gestures it makes. */
export interface ReviewCheckReading {
  readonly kind: 'opening' | 'chooser' | 'opened' | 'failed';
  readonly emptyText: string;
  readonly chooseNote: string | null;
  readonly title: string;
  readonly identity: string;
  readonly repository: string | null;
  readonly base: string | null;
  readonly target: string | null;
  readonly position: { readonly walkId: string | null; readonly stepId: string | null; readonly refIndex: number } | null;
  readonly stepIds: readonly string[];
  readonly saveText: string;
  readonly lang: Lang;
  /** Whether the chat's bridge reached this window. It must not. */
  readonly hasChatBridge: boolean;
  readonly hasReviewBridge: boolean;
  readonly overflowX: boolean;
  readonly documentWidth: number;
}

interface ReviewCheck {
  read(): ReviewCheckReading;
  /** Press the view's own "Open a review definition…" button. */
  choose(): boolean;
  /** Go to a step, as choosing it in the walk list does. */
  goToStep(stepId: string): boolean;
}

/** What the open review lends the scenario hook; empty while none is open. */
const openReviewHooks: {
  goToStep: ((stepId: string) => boolean) | null;
  position: (() => ReviewCheckReading['position']) | null;
  stepIds: (() => readonly string[]) | null;
} = { goToStep: null, position: null, stepIds: null };

/**
 * DSpatch's own review surface: a fixed revision pair, its complete diff, prepared
 * walks through it, and the reviewer's record — without Monaco, a loop, the graph
 * editor or an agent.
 *
 * Design rule since the first user observation (23 October 2026): help the reviewer
 * understand the current step, and let them open more when they need it. So the code
 * pane shows the precise lines a step explains — old and new, labelled, in soft
 * colours — with neutral context around them; the step panel leads with what the
 * step is about; detail, notes and decisions open on request.
 *
 * What the screen must never blur (REVIEW_COVERAGE_AND_CODE_WALKS.md §3): a walk's
 * plan, what has been opened, what the reviewer marked walked through, and what they
 * decided. Before/after colours mean old and new code, never accepted or rejected.
 */

// Around a place opened on its own, the code that surrounds it is shown at once (30 October 2026).
const FOCUS_MARGIN = 10;
const MORE_LINES = 20;
const GAP_CONTEXT = 3;

type CodeView = 'before' | 'both' | 'after';
type CodeScope = 'focus' | 'file';

/** How long a place must be on screen before it counts as opened. Longer than the arrival animation. */
const OPENED_AFTER_MS = 900;
type LeftTab = 'walks' | 'coverage' | 'notes' | 'search';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeOf(iso: string, lang: Lang): string {
  if (iso === '') {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(lang === 'sv' ? 'sv-SE' : 'en-GB');
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

/** Where a hunk is, in the reader's words rather than its internal id. */
function hunkWhere(hunk: DiffHunk, words: ReviewWords): string {
  const parts: string[] = [];
  if (hunk.targetCount > 0) {
    parts.push(words.newLines(rangeText({ start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 })));
  } else {
    parts.push(words.removedAfter(hunk.targetStart));
  }
  if (hunk.baseCount > 0) {
    parts.push(words.oldLines(rangeText({ start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 })));
  }
  return words.changeAt(fileName(hunk.path), parts.join(', '));
}

function hunkLocation(hunk: DiffHunk): CodeLocation {
  return hunk.targetCount > 0
    ? { path: hunk.path, side: 'target', start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 }
    : { path: hunk.path, side: 'base', start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 };
}

interface StepStop {
  readonly index: number;
  readonly placeIndexes: readonly number[];
  readonly merged: boolean;
}

function placeIndexesFor(
  stepId: string,
  stations: ReadonlyArray<ReturnType<typeof stationsOf>[number]>,
  stop: { readonly stations: readonly number[] },
): number[] {
  const indexes: number[] = [];
  for (const stationIndex of stop.stations) {
    const station = stations[stationIndex];
    if (station?.stepId === stepId) {
      indexes.push(station.placeIndex);
    }
  }
  return indexes;
}

function stopLabel(step: WalkStep, stop: StepStop, lang: Lang): string {
  if (stop.placeIndexes.length <= 1) {
    return pick(step.places[stop.placeIndexes[0] ?? 0]?.label ?? { sv: '', en: '' }, lang);
  }
  const places = stop.placeIndexes.map((index) => step.places[index]).filter((place): place is Place => place !== undefined);
  const path = fileName(places[0]?.focus.path ?? '');
  const base = places.filter((place) => place.focus.side === 'base').map((place) => rangeText(place.focus)).join(', ');
  const target = places.filter((place) => place.focus.side === 'target').map((place) => rangeText(place.focus)).join(', ');
  const from = base === '' ? '' : `${lang === 'sv' ? 'Från' : 'From'} ${base}`;
  const to = target === '' ? '' : `${lang === 'sv' ? 'Till' : 'To'} ${target}`;
  const where = [from, to].filter((part) => part !== '').join(' → ');
  return where === '' ? path : `${path} (${where})`;
}

function findStep(bundle: ReviewBundle, stepId: string | null): { walk: Walk; step: WalkStep; index: number } | null {
  if (stepId === null) {
    return null;
  }
  for (const walk of stepsWalks(bundle.definition)) {
    const index = walk.steps.findIndex((step) => step.id === stepId);
    const step = walk.steps[index];
    if (step !== undefined) {
      return { walk, step, index };
    }
  }
  return null;
}

// --- The view ----------------------------------------------------------------------

export function ReviewView(): JSX.Element {
  const bridge = window.dspatchReview;
  const [outcome, setOutcome] = useState<ReviewOpenOutcome | null>(null);
  const [lang, setLangState] = useState<Lang>(DEFAULT_PREFERENCES.language);
  const [width, setWidthState] = useState<number>(EXPLANATION_WIDTH.initial);
  const [navWidth, setNavWidthState] = useState<number>(NAVIGATION_WIDTH.initial);
  const [langError, setLangError] = useState<string | null>(null);

  useEffect(() => {
    if (bridge === undefined) {
      setOutcome({ kind: 'failed', error: 'The review bridge is missing from this window (preload).' });
      return;
    }
    void bridge.getPreferences().then(
      (preferences) => {
        setLangState(preferences.language);
        setWidthState(preferences.explanationWidth ?? EXPLANATION_WIDTH.initial);
        setNavWidthState(preferences.navigationWidth ?? NAVIGATION_WIDTH.initial);
      },
      (error: unknown) => {
        setLangError(String(error));
      },
    );
    void bridge.initial().then(setOutcome);
  }, [bridge]);

  /*
   * The preferences are saved whole, so this window's own are put into what is kept now:
   * where the review's panel is and its window's place are kept by the main process
   * (`review-windows.ts`), and a language or a width chosen here must not undo them.
   */
  const savePreferences = useCallback(
    (next: { readonly language: Lang; readonly explanationWidth: number; readonly navigationWidth: number }): Promise<void> => {
      if (bridge === undefined) {
        return Promise.resolve();
      }
      return bridge
        .getPreferences()
        .catch(() => ({}))
        .then((kept) => {
          // The explanation's own window of earlier is gone; its choice means nothing now.
          const { explanationDetached: _gone, ...rest } = kept as ReviewPreferences;
          return bridge.setPreferences({ ...rest, ...next });
        })
        .then((result) => {
          setLangError(result.saved ? null : (result.error ?? 'not saved'));
        });
    },
    [bridge],
  );

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      void savePreferences({ language: next, explanationWidth: width, navigationWidth: navWidth });
    },
    [savePreferences, width, navWidth],
  );

  // DSP-152: the explanation column's width, as the reviewer left it.
  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(EXPLANATION_WIDTH.max, Math.max(EXPLANATION_WIDTH.min, next)));
      setWidthState(clamped);
      void savePreferences({ language: lang, explanationWidth: clamped, navigationWidth: navWidth });
    },
    [savePreferences, lang, navWidth],
  );

  // The left column's width, as the reviewer left it (Niclas's trial feedback, 29 October 2026).
  const setNavWidth = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(NAVIGATION_WIDTH.max, Math.max(NAVIGATION_WIDTH.min, next)));
      setNavWidthState(clamped);
      void savePreferences({ language: lang, explanationWidth: width, navigationWidth: clamped });
    },
    [savePreferences, lang, width],
  );



  // What the last choice said when it opened nothing here: dismissed, or already
  // open in another window (which was brought to the front instead).
  const [chooseNote, setChooseNote] = useState<string | null>(null);
  const choose = useCallback(() => {
    if (bridge !== undefined) {
      void bridge.choose().then(
        (next) => {
          if (next.kind !== 'none') {
            setChooseNote(null);
            setOutcome(next);
          } else {
            setChooseNote(next.note);
          }
        },
        (error: unknown) => {
          setChooseNote(String(error));
        },
      );
    }
  }, [bridge]);

  const latestOutcome = useRef(outcome);
  latestOutcome.current = outcome;
  const latestNote = useRef(chooseNote);
  latestNote.current = chooseNote;
  const latestLang = useRef(lang);
  latestLang.current = lang;
  useEffect(() => {
    const text = (selector: string): string =>
      (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    window.__dspatchReviewCheck = {
      read: () => {
        const current = latestOutcome.current;
        const bundle = current?.kind === 'opened' ? current.bundle : null;
        return {
          kind: current === null ? 'opening' : current.kind === 'opened' ? 'opened' : current.kind === 'none' ? 'chooser' : 'failed',
          emptyText: text('.rv-empty'),
          chooseNote: latestNote.current,
          title: text('.rv-header h1'),
          identity: text('[data-ev="review-identity"]'),
          repository: bundle?.repository ?? (current?.kind === 'none' ? (current.repository ?? null) : null),
          base: bundle?.base.sha ?? null,
          target: bundle?.target.sha ?? null,
          position: openReviewHooks.position?.() ?? null,
          stepIds: openReviewHooks.stepIds?.() ?? [],
          saveText: text('.rv-save'),
          lang: latestLang.current,
          hasChatBridge: typeof (window as { dspatch?: unknown }).dspatch !== 'undefined',
          hasReviewBridge: window.dspatchReview !== undefined,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          documentWidth: document.documentElement.clientWidth,
        };
      },
      choose: () => {
        const button = document.querySelector<HTMLButtonElement>('[data-ev="review-choose"]');
        if (button === null) {
          return false;
        }
        button.click();
        return true;
      },
      goToStep: (stepId) => openReviewHooks.goToStep?.(stepId) ?? false,
    };
    return () => {
      delete window.__dspatchReviewCheck;
    };
  }, []);

  const words = WORDS[lang];
  if (outcome === null) {
    return <div className="rv-empty">{words.opening}</div>;
  }
  if (outcome.kind !== 'opened') {
    const folder = outcome.kind === 'none' ? (outcome.repository ?? null) : null;
    return (
      <div className="rv-empty">
        <p className={outcome.kind === 'failed' ? 'rv-error' : ''}>
          {outcome.kind === 'failed' ? outcome.error : folder === null ? words.noDefinition : words.chooseFor(folder)}
        </p>
        {outcome.kind === 'failed' && outcome.detail !== undefined && (
          // Diagnostics behind a closed disclosure (DSP-129): the message above says what
          // to do; git's own words are here for whoever needs them, never opened for you.
          <details className="rv-sub" data-ev="review-failed-detail">
            <summary>{words.details}</summary>
            <pre>{outcome.detail}</pre>
          </details>
        )}
        {outcome.kind === 'none' && outcome.problem !== undefined && <p className="rv-error">{outcome.problem}</p>}
        <button type="button" data-ev="review-choose" onClick={choose}>
          {words.openDefinition}
        </button>
        {chooseNote !== null && (
          <p className="rv-sub" role="status" data-ev="review-choose-note">
            {chooseNote}
          </p>
        )}
      </div>
    );
  }
  return (
    <OpenReview
      key={outcome.bundle.definitionPath + outcome.bundle.target.sha}
      bundle={outcome.bundle}
      bridge={bridge}
      onChoose={choose}
      lang={lang}
      onLang={setLang}
      langError={langError}
      explanationWidth={width}
      onExplanationWidth={setWidth}
      navigationWidth={navWidth}
      onNavigationWidth={setNavWidth}
      onReread={() => {
        if (bridge !== undefined) {
          void bridge.reread().then((next) => {
            if (next.kind === 'opened') {
              setOutcome(next);
            }
          });
        }
      }}
    />
  );
}

function OpenReview({
  bundle,
  bridge,
  onChoose,
  lang,
  onLang,
  langError,
  explanationWidth,
  onExplanationWidth,
  navigationWidth,
  onNavigationWidth,
  onReread,
}: {
  readonly bundle: ReviewBundle;
  readonly bridge: ReviewBridge | undefined;
  readonly onChoose: () => void;
  readonly lang: Lang;
  readonly onLang: (lang: Lang) => void;
  readonly langError: string | null;
  readonly explanationWidth: number;
  readonly onExplanationWidth: (width: number) => void;
  readonly navigationWidth: number;
  readonly onNavigationWidth: (width: number) => void;
  /** Read this review again as it is on disk: the points worth checking, once found. */
  readonly onReread: () => void;
}): JSX.Element {
  const words = WORDS[lang];
  const [state, setState] = useState<ReviewState>(bundle.state);
  const [save, setSave] = useState<{ at: string; error?: string } | null>(
    bundle.state.savedAt === '' ? null : { at: bundle.state.savedAt },
  );
  const [tab, setTab] = useState<LeftTab>('walks');
  /** The right column: the step's own text, or the discussion about the code (DSP-127). */
  const [rightTab, setRightTab] = useState<'step' | 'discussion'>('step');
  const [selection, setSelection] = useState<CodeLocation | null>(null);
  const [view, setView] = useState<CodeView>('both');
  const [scope, setScope] = useState<CodeScope>('focus');
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const [noticeOpen, setNoticeOpen] = useState(bundle.stateNotice !== null);
  const files = useFiles(bridge);
  const [treePaths, setTreePaths] = useState<readonly string[]>([]);
  useEffect(() => {
    if (bridge === undefined) {
      return;
    }
    void bridge.listFiles('target').then((paths) => {
      const deleted = bundle.files.filter((file) => file.status === 'deleted').map((file) => file.path);
      setTreePaths([...paths, ...deleted.filter((path) => !paths.includes(path))]);
    });
  }, [bridge, bundle]);
  const changedFiles = useMemo(() => new Map(bundle.files.map((file) => [file.path, file])), [bundle]);

  // Persist every change. Decisions, notes and walked marks are written at once;
  // moving around and arranging the view shortly after. Whatever is still unsaved
  // is written when the view goes away or the window unloads, and a failed save is
  // shown, never swallowed.
  const latest = useRef(state);
  latest.current = state;
  /** How the current walk was entered, so its timeline slides in from that side. */
  const entryDirection = useRef<'forward' | 'backward'>('forward');
  const dirty = useRef(false);
  const urgent = useRef(false);
  const [saving, setSaving] = useState(false);
  /** The save on its way, so a flush asked for while one runs waits for it too. */
  const inFlight = useRef<Promise<string> | null>(null);
  const flush = useCallback((): Promise<string> => {
    if (PANEL_MODE) {
      return Promise.resolve('the review panel keeps no record of its own');
    }
    if (!dirty.current || bridge === undefined) {
      return inFlight.current ?? Promise.resolve('nothing unsaved');
    }
    dirty.current = false;
    const pending = bridge.saveState(latest.current).then(
      (result) => {
        if (!result.saved) {
          // Still unsaved: the next change, closing the view or unloading tries again.
          dirty.current = true;
        }
        setSaving(result.saved && dirty.current);
        setSave(result.saved ? { at: result.at } : { at: result.at, error: result.error ?? 'not saved' });
        return result.saved ? `saved at ${result.at}` : `not saved: ${result.error ?? 'no reason given'}`;
      },
      (error: unknown) => {
        dirty.current = true;
        setSaving(false);
        setSave({ at: new Date().toISOString(), error: String(error) });
        return `not saved: ${String(error)}`;
      },
    );
    inFlight.current = pending;
    void pending.finally(() => {
      if (inFlight.current === pending) {
        inFlight.current = null;
      }
    });
    return pending;
  }, [bridge]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    dirty.current = true;
    setSaving(true);
    const timer = setTimeout(flush, urgent.current ? 0 : 250);
    urgent.current = false;
    return () => {
      clearTimeout(timer);
    };
  }, [state, flush]);

  useEffect(() => {
    const onUnload = (): void => {
      void flush();
    };
    window.addEventListener('beforeunload', onUnload);
    // Asked for by the main process before the window closes, and awaited there.
    window.__dspatchReviewFlush = flush;
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      if (window.__dspatchReviewFlush === flush) {
        delete window.__dspatchReviewFlush;
      }
      void flush();
    };
  }, [flush]);

  const update = useCallback((change: (current: ReviewState) => ReviewState) => {
    setState((current) => change(current));
  }, []);

  /** For the reviewer's own record — decisions, notes, walked marks: save at once. */
  const record = useCallback((change: (current: ReviewState) => ReviewState) => {
    urgent.current = true;
    setState((current) => change(current));
  }, []);

  /*
   * DSP-150: the pair this walk is over, and the decisions kept for it. The diff window and
   * every walk over the same two commits read and write that one record, so a change two
   * walks pass counts once and a mark made in one window is seen in the others. Without a
   * pair connection (a window that has none) the walk keeps its own decisions as before.
   */
  const pairBridge = window.dspatchReviewPair;
  const [pair, setPair] = useState<{ readonly key: string; readonly record: PairRecord; readonly files: readonly PairFile[] } | null>(null);
  useEffect(() => {
    if (pairBridge === undefined) {
      return;
    }
    let live = true;
    void pairBridge.forWalk().then((answer) => {
      if (live && !isPairError(answer)) {
        setPair({ key: answer.key, record: answer.record, files: answer.files });
      }
    });
    const stop = pairBridge.onChanged((event) => {
      setPair((current) => (current !== null && current.key === event.key ? { ...current, record: event.record } : current));
    });
    return () => {
      live = false;
      stop();
    };
  }, [pairBridge]);
  const shownState = useMemo(
    () => (pair === null ? state : { ...state, decisions: hunkDecisionsFromPair(bundle.files, pair.record, state.revisions) }),
    [pair, state, bundle],
  );
  const [diffNote, setDiffNote] = useState('');

  /*
   * The review's discussion, as its component reports it: threads and a point worth checking
   * show their exchanges from it. DSP-184: a step's own explanations are not in it; they are
   * in the step explanations' store (`useStepExplanations`).
   */
  const [discussionMessages, setDiscussionMessages] = useState<readonly DiscussionMessage[]>([]);
  // DSP-181: the profile the walk's own explanations were written in, when it was prepared in one; a
  // walk opens in it unless the person chose otherwise for this walk, and reads in it with no call.
  const walkProfile = bundle.definition.presentation?.profile ?? null;
  // Before any walk exists the choice is the computer's, the one the next preparation uses (an empty scope).
  const [profile, rememberLatestProfile] = usePresentationProfile(bundle.definition.walks.length === 0 ? '' : bundle.definitionPath, state.ui.presentationProfile ?? walkProfile);
  // DSP-175: the review's threads, from the pair record every window of the review shares.
  const threads = useMemo(() => (pair === null ? [] : reviewThreadsOf(pair.record)), [pair]);
  const threadExchanges = useMemo(() => exchangesByThread(discussionMessages), [discussionMessages]);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const showThreadInDiff = useCallback(
    (thread: ReviewThread, range: LineRange | null): void => {
      if (pairBridge === undefined) {
        return;
      }
      setSelectedThread(thread.id);
      const at = range ?? thread.anchors[0] ?? null;
      const location = at !== null ? { side: at.side, path: at.path, line: at.start } : thread.file !== null ? { side: thread.file.side, path: thread.file.path, line: 1 } : { side: 'target' as const, path: '', line: 1 };
      void pairBridge.showInDiff({ ...location, threadId: thread.id }).then((answer) => setDiffNote(answer.ok ? '' : answer.note));
    },
    [pairBridge],
  );
  const threadActions: ThreadActions = useMemo(
    () => ({
      selectedId: selectedThread,
      // Choosing a thread here shows its code in this window, its lines marked (DSP-175):
      // the place the agent named, at its side and commit. A thread with no place that
      // could be found opens with that said, and nothing else is marked as if it were it.
      select: (thread) => {
        setSelectedThread(thread.id);
        const at = thread.anchors[0];
        if (at !== undefined) {
          goAway({ side: at.side, path: at.path, start: at.start, end: at.end });
        }
      },
      show: (range) => {
        const thread = threads.find((entry) => entry.anchors.includes(range));
        if (thread !== undefined) {
          setSelectedThread(thread.id);
        }
        goAway({ side: range.side, path: range.path, start: range.start, end: range.end });
      },
      showInDiff: (thread) => showThreadInDiff(thread, null),
      act: async (thread, kind, text) => {
        if (pairBridge === undefined || pair === null) {
          return 'This walk is not tied to a revision pair, so its threads cannot be changed here.';
        }
        try {
          const answer = await pairBridge.thread(pair.key, { threadId: thread.id, kind, text });
          if (isPairError(answer)) {
            return answer.error;
          }
          setPair((current) => (current === null ? current : { ...current, record: answer }));
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
      ask: async (thread, question, quoted) => {
        const discussion = window.dspatchReviewDiscussion;
        if (discussion === undefined) {
          return 'The review discussion is not available in this window.';
        }
        try {
          // DSP-184: asked in the thread; it stays in the thread. No profile: the conversation is the person's.
          const outcome = await discussion.send({ question, subject: { kind: 'thread', threadId: thread.id }, selection: null, quote: quoted, language: lang });
          return outcome.kind === 'sent' ? null : outcome.error;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
      exchanges: (threadId) => threadExchanges.get(threadId) ?? [],
      openLocation: (location) => goAway(location),
    }),
    // goAway is stable over a window's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedThread, showThreadInDiff, threads, pairBridge, pair, threadExchanges, lang],
  );
  const [discussionActivity, setDiscussionActivity] = useState<{ readonly questionId: string; readonly text: string } | null>(null);
  const [deepenError, setDeepenError] = useState<string | null>(null);
  /*
   * A point worth checking that is open (30 October 2026), and the position it was opened
   * from, to go back to. Opening one moves to its step or its own tour; it marks, approves
   * and resolves nothing.
   */
  const [openCheckId, setOpenCheckId] = useState<string | null>(null);
  /*
   * What the person selected to ask about (30 October 2026): code in a code pane, or text of
   * an explanation or an answer. Kept when the focus moves to the action or the question field
   * (the window's own selection is gone by then); a new selection replaces it, and moving to
   * another step or place clears it, so nothing old goes along unseen. It is not a choice of
   * lines for review and decides nothing.
   */
  const [quote, setQuote] = useState<SelectionQuote | null>(null);
  /**
   * One selection to ask about for the whole review (30 October 2026): chosen here, it is
   * what the next question is about in every window of the review, the diff's included.
   */
  const shareQuote = useCallback((next: SelectionQuote | null) => {
    setQuote(next);
    void window.dspatchReviewDiscussion?.setQuote(next).catch(() => undefined);
  }, []);
  /** Where the offer is drawn, beside the selection or in place of the context menu. */
  const [quoteOffer, setQuoteOffer] = useState<{ readonly x: number; readonly y: number; readonly menu: boolean } | null>(null);
  const viewRoot = useRef<HTMLDivElement | null>(null);
  /*
   * The walk window shows no discussion of its own, but hears the review's (30 October 2026):
   * a quote chosen, sent or removed in another window takes this window's selection and its
   * mark away, as in the diff window. The panel hears it through its discussion.
   */
  useEffect(() => {
    const discussion = window.dspatchReviewDiscussion;
    if (PANEL_MODE || discussion === undefined) {
      return;
    }
    const unsubscribe = discussion.onEvent((event) => {
      if (event.kind === 'quote') {
        quoteMark.current = null;
        setQuote(null);
        setQuoteOffer(null);
        // Left selected, the next drag over it would move the text instead of selecting.
        window.getSelection()?.removeAllRanges();
      }
    });
    void discussion.load(null).catch(() => undefined);
    return unsubscribe;
  }, []);
  /** A selection of prose as it was made, to keep it marked (code is found again by its place). */
  const quoteMark = useRef<Range | null>(null);
  /*
   * The right panel's element, rendered through a portal into the review panel's page
   * (30 October 2026). The page itself is what moves between windows (`review-windows.ts`).
   */
  const panelHost = useMemo(() => {
    const node = document.createElement('div');
    node.className = 'rv-right-host';
    return node;
  }, []);
  const dockSlot = useRef<HTMLDivElement | null>(null);
  const [checkReturn, setCheckReturn] = useState<{ readonly stepId: string | null; readonly refIndex: number; readonly away: CodeLocation | null } | null>(null);
  const [delegatingWalk, setDelegatingWalk] = useState(false);
  const [liveWidth, setLiveWidth] = useState(explanationWidth);
  useEffect(() => {
    setLiveWidth(explanationWidth);
  }, [explanationWidth]);
  const [liveNavWidth, setLiveNavWidth] = useState(navigationWidth);
  useEffect(() => {
    setLiveNavWidth(navigationWidth);
  }, [navigationWidth]);

  /*
   * The other walk definitions over this review's pair (several preparations): chosen here,
   * and opened in this same window, which is the review's one walk window.
   */
  const [pairWalks, setPairWalks] = useState<readonly PairWalk[]>([]);
  useEffect(() => {
    if (pairBridge === undefined || pair === null) {
      return;
    }
    let live = true;
    void pairBridge
      .walks(pair.key)
      .catch(() => [])
      .then((answer) => {
        if (live) {
          setPairWalks(isPairError(answer) ? [] : answer);
        }
      });
    return () => {
      live = false;
    };
  }, [pairBridge, pair?.key]);

  // Long lines wrap within the code panes: Markdown by default, code when asked for.
  const wrapProse = state.ui.wrap?.markdown ?? true;
  const wrapCode = state.ui.wrap?.code ?? false;
  const setWrap = useCallback(
    (path: string, on: boolean) => {
      update((value) => {
        const current = value.ui.wrap ?? { markdown: true, code: false };
        return { ...value, ui: { ...value.ui, wrap: isProsePath(path) ? { ...current, markdown: on } : { ...current, code: on } } };
      });
    },
    [update],
  );

  const coverage = useMemo(() => computeCoverage(bundle.definition, bundle.files, shownState), [bundle, shownState]);
  // What the active place's mark names besides its file and lines (DSP-175).
  const focusRevision = useMemo(() => ({ repository: bundle.repository, base: bundle.base.sha, target: bundle.target.sha }), [bundle.repository, bundle.base.sha, bundle.target.sha]);
  const coverageByHunk = useMemo(() => new Map(coverage.hunks.map((entry) => [entry.hunk.id, entry])), [coverage]);

  const current = findStep(bundle, state.position.stepId);
  const away = state.position.away;
  const placeIndex =
    current === null ? 0 : Math.max(0, Math.min(state.position.refIndex, current.step.places.length - 1));
  const place: Place | null = current === null ? null : (current.step.places[placeIndex] ?? null);
  const placeProblem =
    current === null || place === null || away !== null
      ? null
      : (bundle.referenceProblems.find(
          (problem) =>
            problem.stepId === current.step.id &&
            (problem.refId === place.focus.id || problem.refId === `${place.id}.unit` || problem.refId === `${place.id}.from`),
        )?.problem ?? null);
  const level: CodeLevel = state.ui.level ?? 'unit';
  const stations = useMemo(() => (current === null ? [] : stationsOf(current.walk)), [current?.walk]);
  const walkStops = useMemo(() => {
    const panes = panesOf(stations.map((station) => station.place.focus), (path) => changedFiles.get(path) ?? null);
    const paneByStation = paneOfStation(panes);
    return stopsOf(stations.map((station) => ({ stepId: station.stepId, placeIndex: station.placeIndex, focus: station.place.focus })), paneByStation);
  }, [stations, changedFiles]);
  const stepStops = useMemo(() => {
    if (current === null) {
      return [] as StepStop[];
    }
    return walkStops
      .filter((stop) => stop.stepId === current.step.id)
      .map((stop) => ({ index: stop.index, placeIndexes: placeIndexesFor(current.step.id, stations, stop), merged: stop.merged }))
      .filter((stop) => stop.placeIndexes.length > 0);
  }, [current?.step.id, walkStops, stations]);
  const stopByPlace = useMemo(() => {
    const map = new Map<number, number>();
    stepStops.forEach((stop, index) => {
      stop.placeIndexes.forEach((place) => map.set(place, index));
    });
    return map;
  }, [stepStops]);
  const activeStop = stepStops[stopByPlace.get(placeIndex) ?? 0] ?? null;
  const activeStopIndex = activeStop === null ? 0 : (stopByPlace.get(placeIndex) ?? 0);
  const activeStation = current === null ? -1 : stations.findIndex((entry) => entry.stepId === current.step.id && entry.placeIndex === placeIndex);
  const activeWalkStop = activeStation < 0 ? -1 : walkStops.findIndex((stop) => stop.stations.includes(activeStation));
  const focus: CodeLocation | null = away ?? (place === null ? null : asLocation(place.focus));
  const threadsHere = useMemo(
    () =>
      focus === null
        ? []
        : threads.filter(
            (thread) =>
              thread.anchors.some((anchor) => anchor.side === focus.side && anchor.path === focus.path && anchor.start <= focus.end && anchor.end >= focus.start) ||
              // A thread about this file whose place could not be found, or that named no line:
              // listed here too, saying so, and nothing in the code is marked for it.
              (thread.anchors.length === 0 && thread.file !== null && thread.file.path === focus.path),
          ),
    [threads, focus?.side, focus?.path, focus?.start, focus?.end],
  );
  const contexts: readonly CodeLocation[] = away === null && place !== null ? place.context.map(asLocation) : [];

  // Opening a place records that it was opened — and only that.
  const shownKey = current === null || place === null ? null : placeKey(current.step.id, place.id);
  useEffect(() => {
    if (current === null || away !== null || shownKey === null) {
      return;
    }
    if (state.shownSteps[current.step.id] !== undefined && state.shownRefs[shownKey] !== undefined) {
      return;
    }
    const stepId = current.step.id;
    // Only a place the view has settled on counts: code passed on the way while the
    // reader wheels or drags through the timeline is not opened.
    const timer = window.setTimeout(() => {
      const at = new Date().toISOString();
      update((value) => ({
        ...value,
        shownSteps: value.shownSteps[stepId] === undefined ? { ...value.shownSteps, [stepId]: at } : value.shownSteps,
        shownRefs: value.shownRefs[shownKey] === undefined ? { ...value.shownRefs, [shownKey]: at } : value.shownRefs,
      }));
    }, OPENED_AFTER_MS);
    return () => window.clearTimeout(timer);
    // The step id, not the step object: a re-render for any other reason must not restart the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.step.id, away, shownKey, state.shownSteps, state.shownRefs, update]);

  // Explicit choices of a step or place in the lists: each one shows its place in the map.
  const [navRequest, setNavRequest] = useState(0);
  const goToStep = useCallback(
    (stepId: string, placeIndex = 0) => {
      if (PANEL_MODE) {
        window.dspatchReviewPanel?.action({ kind: 'goToStep', stepId, placeIndex });
        return;
      }
      const found = findStep(bundle, stepId);
      if (found === null) {
        return;
      }
      // Entering another walk: it slides in from the side it lies on.
      const here = findStep(bundle, latest.current.position.stepId);
      if (here !== null && here.walk !== found.walk) {
        const walks = bundle.definition.walks;
        entryDirection.current = walks.indexOf(found.walk) > walks.indexOf(here.walk) ? 'forward' : 'backward';
      }
      setSelection(null);
      setScope('focus');
      update((value) => ({
        ...value,
        position: { ...value.position, walkId: found.walk.id, stepId, refIndex: placeIndex, away: null },
      }));
    },
    [bundle, update],
  );

  // Lent to the scenario hook in `ReviewView`; gone with this review.
  useEffect(() => {
    openReviewHooks.goToStep = (stepId) => {
      if (findStep(bundle, stepId) === null) {
        return false;
      }
      goToStep(stepId);
      return true;
    };
    openReviewHooks.position = () => ({
      walkId: latest.current.position.walkId,
      stepId: latest.current.position.stepId,
      refIndex: latest.current.position.refIndex,
    });
    openReviewHooks.stepIds = () => bundle.definition.walks.flatMap((walk) => walk.steps.map((step) => step.id));
    return () => {
      openReviewHooks.goToStep = null;
      openReviewHooks.position = null;
      openReviewHooks.stepIds = null;
    };
  }, [bundle, goToStep]);

  /*
   * Where each code location was opened from (Niclas's trial, 30 October 2026): a reference
   * followed from an answer, a point or the files, and the one before it. *Back* returns to
   * exactly that place, and the walk keeps its own reading position meanwhile. Following a
   * reference changes nothing about the review's status.
   */
  const cameFrom = useRef<{ readonly stepId: string | null; readonly refIndex: number; readonly away: CodeLocation | null; readonly scope: CodeScope }[]>([]);
  /*
   * How each opened location was left (30 October 2026): its lines opened and where it was
   * scrolled, and where the walk's own panes were. Back restores them as they were.
   */
  const paneMemory = useRef(new Map<string, PaneMemory>());
  const stageScroll = useRef<{ readonly element: Element; readonly top: number; readonly left: number }[]>([]);
  const stage = useRef<HTMLDivElement | null>(null);
  const goAway = useCallback(
    (location: CodeLocation, scope: CodeScope = 'focus') => {
      if (PANEL_MODE) {
        window.dspatchReviewPanel?.action({ kind: 'openLocation', location: { side: location.side, path: location.path, start: location.start, end: location.end } });
        return;
      }
      const here = latest.current.position;
      const last = cameFrom.current.at(-1);
      if (here.away === null && stage.current !== null) {
        stageScroll.current = [stage.current, ...stage.current.querySelectorAll('*')]
          .filter((element) => element.scrollTop > 0 || element.scrollLeft > 0)
          .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
      }
      if (here.away === null || JSON.stringify(here.away) !== JSON.stringify(location)) {
        const from = { stepId: here.stepId, refIndex: here.refIndex, away: here.away, scope: scopeNow.current };
        if (last === undefined || JSON.stringify({ ...last, scope: null }) !== JSON.stringify({ ...from, scope: null })) {
          cameFrom.current = [...cameFrom.current.slice(-19), from];
        }
      }
      setSelection(null);
      setScope(scope);
      update((value) => ({ ...value, position: { ...value.position, away: location } }));
    },
    [update],
  );

  const returnToWalk = useCallback(() => {
    setSelection(null);
    setScope('focus');
    cameFrom.current = [];
    update((value) => ({ ...value, position: { ...value.position, away: null } }));
  }, [update]);

  // Back in the walk: its panes where they were scrolled, whatever showing them again did.
  const awayNow = state.position.away;
  useLayoutEffect(() => {
    if (awayNow !== null) {
      return;
    }
    for (const entry of stageScroll.current) {
      if (entry.element.isConnected) {
        entry.element.scrollTop = entry.top;
        entry.element.scrollLeft = entry.left;
      }
    }
    stageScroll.current = [];
  }, [awayNow]);

  /** Back to where this location was opened from: another location, or the walk where it was. */
  const goBack = useCallback(() => {
    const back = cameFrom.current.at(-1);
    cameFrom.current = cameFrom.current.slice(0, -1);
    setSelection(null);
    setScope(back?.away != null ? back.scope : 'focus');
    update((value) =>
      back === undefined
        ? { ...value, position: { ...value.position, away: null } }
        : { ...value, position: { ...value.position, stepId: back.stepId ?? value.position.stepId, refIndex: back.refIndex, away: back.away } },
    );
  }, [update]);

  const toggleWalk = useCallback(
    (walkId: string) => {
      update((value) => {
        const open = new Set(value.ui.openWalks);
        if (open.has(walkId)) {
          open.delete(walkId);
        } else {
          open.add(walkId);
        }
        return { ...value, ui: { ...value.ui, openWalks: [...open] } };
      });
    },
    [update],
  );

  const setLevel = useCallback(
    (next: CodeLevel) => {
      update((value) => ({ ...value, ui: { ...value.ui, level: next } }));
    },
    [update],
  );

  /** One station forward or back; past the end of a walk, into the next or previous walk. */
  const moveStation = useCallback(
    (delta: number) => {
      if (current === null || activeStation < 0) {
        return;
      }
      const stopAt = walkStops.findIndex((stop) => stop.stations.includes(activeStation));
      const targetStop = walkStops[stopAt + delta];
      if (targetStop !== undefined) {
        const station = stations[targetStop.stations[0] ?? -1];
        if (station !== undefined) {
          goToStep(station.stepId, station.placeIndex);
        }
        return;
      }
      // A point's own tour is not one of the walks: its ends are its own.
      if (current.walk.kind === 'check') {
        return;
      }
      const walks = bundle.definition.walks;
      const walkIndex = walks.indexOf(current.walk);
      const neighbour = walks[walkIndex + delta];
      if (neighbour === undefined) {
        return;
      }
      const neighbourStations = stationsOf(neighbour);
      const neighbourPanes = panesOf(neighbourStations.map((station) => station.place.focus), (path) => changedFiles.get(path) ?? null);
      const neighbourStops = stopsOf(
        neighbourStations.map((station) => ({ stepId: station.stepId, placeIndex: station.placeIndex, focus: station.place.focus })),
        paneOfStation(neighbourPanes),
      );
      const boundary = delta > 0 ? neighbourStops[0] : neighbourStops[neighbourStops.length - 1];
      const entry = boundary === undefined ? undefined : neighbourStations[boundary.stations[delta > 0 ? 0 : boundary.stations.length - 1] ?? -1];
      if (entry !== undefined) {
        goToStep(entry.stepId, entry.placeIndex);
      }
    },
    [current, activeStation, stations, walkStops, bundle, goToStep, changedFiles],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      event.preventDefault();
      moveStation(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveStation]);

  const toggleWalked = useCallback(
    (stepId: string) => {
      record((value) => {
        const walked = { ...value.walkedSteps };
        if (walked[stepId] === undefined) {
          walked[stepId] = new Date().toISOString();
        } else {
          delete walked[stepId];
        }
        return { ...value, walkedSteps: walked };
      });
    },
    [record],
  );

  const decide = useCallback(
    (decision: Omit<ReviewDecision, 'id' | 'at' | 'by' | 'revisions'>) => {
      if (pair !== null && pairBridge !== undefined && decision.scope.kind === 'hunk') {
        const hunkId = decision.scope.hunkId;
        const hunk = bundle.files.flatMap((file) => file.hunks).find((candidate) => candidate.id === hunkId);
        if (hunk !== undefined) {
          void pairBridge.mark(pair.key, { op: pairOpFor(decision.outcome), scopes: hunkRanges(hunk), reason: decision.reason }).then((answer) => {
            if (!isPairError(answer)) {
              setPair({ ...pair, record: answer });
            }
          });
          return;
        }
      }
      record((value) => ({
        ...value,
        decisions: [
          ...value.decisions,
          { ...decision, id: newId(), at: new Date().toISOString(), by: { kind: 'human' }, revisions: value.revisions },
        ],
      }));
    },
    [record, pair, pairBridge, bundle],
  );

  const setNoteStatus = useCallback(
    (id: string, status: 'open' | 'resolved', resolution: string) => {
      record((value) => ({
        ...value,
        notes: value.notes.map((note) =>
          note.id === id ? { ...note, status, resolution, updatedAt: new Date().toISOString() } : note,
        ),
      }));
    },
    [record],
  );

  // Open on the first step if the record has no position yet.
  useEffect(() => {
    if (state.position.stepId === null && state.position.away === null) {
      const first = bundle.definition.walks[0]?.steps[0];
      if (first !== undefined) {
        goToStep(first.id);
      }
    }
  }, [bundle, state.position.stepId, state.position.away, goToStep]);

  const diffFile = focus === null ? null : (bundle.files.find((file) => file.path === focus.path) ?? null);


  const revisionText = `${short(bundle.base.sha)}→${short(bundle.target.sha)}`;

  // What a question asked now would be about: the place on screen, a location away
  // from the walk, or the review as a whole; and the lines selected, if any.
  const openCheck = openCheckId === null ? null : (bundle.definition.checks.find((check) => check.id === openCheckId) ?? null);
  // DSP-175: the review thread a point worth checking is, from the pair record; shown with the point.
  const checkThreadOf = useCallback((check: CheckPoint): ReviewThread | null => threadOfPoint(threads, bundle.definitionPath, check.id), [threads, bundle.definitionPath]);
  const openCheckThread = openCheck === null ? null : checkThreadOf(openCheck);
  const discussionRequest: DiscussionRequest = useMemo(
    () => ({
      subject:
        away !== null
          ? { kind: 'away', location: away }
          : current !== null && place !== null
            ? { kind: 'point', walkId: current.walk.id, stepId: current.step.id, placeIndex, ...(openCheck === null ? {} : { checkId: openCheck.id }) }
            : { kind: 'review' },
      selection,
      language: lang,
      quote,
    }),
    [away, current?.walk.id, current?.step.id, place, placeIndex, selection, lang, openCheck, quote],
  );

  /** Let go of the selection: the kept quote and the window's own, which would otherwise be read again. */
  const dropQuote = useCallback(() => {
    shareQuote(null);
    setQuoteOffer(null);
    quoteMark.current = null;
    window.getSelection()?.removeAllRanges();
  }, []);

  /*
   * The kept selection stays marked where it is, quietly, when the window's own selection is
   * gone: the focus in the question field, another window, rows drawn again. Code is found by
   * its file, side, lines and characters; prose is the range as it was selected.
   */
  useEffect(() => {
    const root = viewRoot.current;
    if (quote === null || root === null) {
      return;
    }
    const prose = quote.kind === 'text' ? quoteMark.current : null;
    const view = (prose?.startContainer.ownerDocument?.defaultView ?? window) as Window & typeof globalThis;
    const registry = view.CSS.highlights;
    if (registry === undefined) {
      return;
    }
    let frame = 0;
    const paint = (): void => {
      const ranges = quote.kind === 'code' ? quoteRanges(root, quote) : prose !== null && !prose.collapsed ? [prose] : [];
      registry.set('rv-quote', new view.Highlight(...ranges));
    };
    paint();
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      registry.delete('rv-quote');
    };
  }, [quote]);

  // Another step, place or location: a selection made for the last one does not go along.
  // Not on opening, and not in the review's panel, which only follows the walk window: the
  // quote is the review's, and a window opening must not take it away from the others.
  const placeSeen = useRef(false);
  useEffect(() => {
    if (!placeSeen.current || PANEL_MODE) {
      placeSeen.current = true;
      return;
    }
    dropQuote();
  }, [dropQuote, current?.step.id, placeIndex, away?.path, away?.side, away?.start, away?.end]);

  // A point stays open while its step or tour is shown; moving elsewhere closes it.
  useEffect(() => {
    if (openCheck === null) {
      return;
    }
    const own = openCheck.stepId ?? openCheck.tour?.steps[0]?.id ?? null;
    const inTour = openCheck.tour?.steps.some((step) => step.id === current?.step.id) === true;
    if (own !== null && away === null && current?.step.id !== own && !inTour) {
      setOpenCheckId(null);
    }
  }, [openCheck, current?.step.id, away]);

  const openPoint = useCallback(
    (check: CheckPoint) => {
      const here = latest.current.position;
      // Where it was opened from, unless that is already a point being looked at.
      setCheckReturn((before) => (openCheckId !== null && before !== null ? before : { stepId: here.stepId, refIndex: here.refIndex, away: here.away }));
      setOpenCheckId(check.id);
      setRightTab('step');
      // Its reasoning is shown in the review's panel, on the step; shown if it is not.
      if (!PANEL_MODE) {
        void window.dspatchReviewPanel?.show(null, false, 'step');
      }
      const target = check.stepId ?? check.tour?.steps[0]?.id ?? null;
      if (target !== null) {
        goToStep(target);
        setNavRequest((count) => count + 1);
      }
    },
    [goToStep, openCheckId],
  );

  const closePoint = useCallback(() => {
    const back = checkReturn;
    setOpenCheckId(null);
    setCheckReturn(null);
    if (back === null) {
      return;
    }
    if (back.away !== null) {
      goAway(back.away);
    } else if (back.stepId !== null) {
      goToStep(back.stepId, back.refIndex);
      setNavRequest((count) => count + 1);
    }
  }, [checkReturn, goAway, goToStep]);

  /*
   * The review's panel (30 October 2026). Here in the panel: Step follows the walk window.
   * In the walk window: where it is goes to the panel, and what the panel asks is done here.
   */
  const panelBridge = window.dspatchReviewPanel;
  /*
   * Whether this page shows the review's panel itself (the panel page, or a walk window with no
   * panel bridge, which keeps the panel in its own window). Only such a page hears the discussion
   * and may ask for a step's explanation on its own: a walk window whose panel is a view of its
   * own or another window's renders no discussion, so it must never ask (DSP-181: it asked again
   * after every answer, blind to them).
   */
  const [panelHere, setPanelHere] = useState(!PANEL_MODE && panelBridge === undefined);
  const showsPanel = PANEL_MODE || panelHere;
  // The way back from an open point: the walk window's, named here and in the panel.
  const pointBack = checkReturn === null ? null : checkReturn.away !== null ? words.backToCode : checkReturn.stepId === null ? null : words.backTo(checkReturn.stepId);
  const [followedBack, setFollowedBack] = useState<string | null>(null);
  const rereadFor = useRef<string | null>(null);
  const [panelState, setPanelState] = useState<PanelState | null>(null);
  useEffect(() => {
    if (panelBridge === undefined) {
      return;
    }
    void panelBridge.state().then((known) => {
      if (known !== null) {
        setPanelState(known);
      }
    });
    return panelBridge.onState(setPanelState);
  }, [panelBridge]);
  useEffect(() => {
    if (!PANEL_MODE || panelBridge === undefined) {
      return;
    }
    const follow = (position: PanelFollow): void => {
      if (position.definitionPath.toLowerCase() !== bundle.definitionPath.toLowerCase()) {
        return;
      }
      const found = position.stepId === null ? null : findStep(bundle, position.stepId);
      update((value) => ({
        ...value,
        position: { ...value.position, walkId: found?.walk.id ?? value.position.walkId, stepId: position.stepId ?? value.position.stepId, refIndex: position.refIndex, away: null },
      }));
      setOpenCheckId(position.checkId);
      setFollowedBack(position.checkBack);
      // A point found after this panel opened: the review is read again, once for each.
      if (position.checkId !== null && !bundle.definition.checks.some((entry) => entry.id === position.checkId) && rereadFor.current !== position.checkId) {
        rereadFor.current = position.checkId;
        onReread();
      }
    };
    void panelBridge.lastFollow().then((position) => {
      if (position !== null) {
        follow(position);
      }
    });
    return panelBridge.onFollow(follow);
  }, [panelBridge, bundle, update, onReread]);
  useEffect(() => {
    if (PANEL_MODE || panelBridge === undefined) {
      return;
    }
    panelBridge.follow({ definitionPath: bundle.definitionPath, stepId: state.position.stepId, placeIndex: state.position.refIndex, refIndex: state.position.refIndex, checkId: openCheckId, checkBack: pointBack });
  }, [panelBridge, bundle.definitionPath, state.position.stepId, state.position.refIndex, openCheckId, pointBack]);
  const panelAsks = useRef({ goToStep, goAway, openPoint, closePoint });
  panelAsks.current = { goToStep, goAway, openPoint, closePoint };
  useEffect(() => {
    if (PANEL_MODE || panelBridge === undefined) {
      return;
    }
    return panelBridge.onAction((action) => {
      if (action.kind === 'goToStep') {
        panelAsks.current.goToStep(action.stepId, action.placeIndex);
        setNavRequest((count) => count + 1);
      } else if (action.kind === 'openLocation') {
        panelAsks.current.goAway(action.location);
      } else if (action.kind === 'closeCheck') {
        panelAsks.current.closePoint();
      } else {
        const check = bundle.definition.checks.find((entry) => entry.id === action.checkId);
        if (check !== undefined) {
          panelAsks.current.openPoint(check);
        }
      }
    });
  }, [panelBridge, bundle]);
  /** Show the review's panel, from this window; `ask` puts the cursor in the discussion's question. */
  const showPanel = useCallback(
    (ask: boolean) => {
      void window.dspatchReviewPanel?.show(null, ask);
    },
    [],
  );

  /** A deepening of the open point worth checking: a question in the discussion, as before (DSP-152). */
  const deepen = useCallback(
    async (request: DeepenRequest, fromPoint = false, explained: SelectionQuote | null = null): Promise<void> => {
      const discussion = window.dspatchReviewDiscussion;
      if (discussion === undefined) {
        return;
      }
      setDeepenError(null);
      // The review's own save first, as the discussion does before any question.
      await flush();
      const outcome = await discussion.send({
        question: deepenQuestion(request, lang, fromPoint),
        subject: discussionRequest.subject,
        selection: discussionRequest.selection,
        language: lang,
        deepen: request,
        ...(request.action === 'explain' && explained !== null ? { quote: explained } : {}),
      });
      if (outcome.kind !== 'sent') {
        setDeepenError(outcome.error);
      }
      // Away from the walk an answer has no step to stand under: it is in the discussion.
      if (outcome.kind === 'sent' && discussionRequest.subject.kind !== 'point') {
        setRightTab('discussion');
      }
    },
    [discussionRequest, flush, lang],
  );

  /*
   * DSP-184: the step's explanations, in their own channel and store, apart from the discussion.
   * A profile's explanation, Regenerate, Tell me more, Explain more simply and Explain this from
   * Step write there and are shown in Step, each profile with its own history; nothing of them
   * is a discussion entry. What is shown is the latest unless the person went back (`navAt`,
   * this window's own, never stored).
   */
  const explanationState = useStepExplanations(bundle.definitionPath);
  const [navAt, setNavAt] = useState<Readonly<Record<string, string>>>({});
  const [explanationError, setExplanationError] = useState<{ readonly key: string; readonly error: string } | null>(null);
  const slotOf = useCallback((walkId: string, step: WalkStep, asProfile: PublicProfile): ExplanationSlot => ({ walkId, stepId: step.id, basis: stepContentHash(step), profile: asProfile }), []);
  const outlineOf = useCallback(
    (walk: Walk, stepId: string): WalkOutline => ({
      walkTitle: pick(walk.title, lang),
      steps: walk.steps.map((entry) => ({
        title: pick(entry.title, lang),
        places: entry.places.map((at) => `${at.focus.path} ${rangeText(at.focus)} (${at.focus.side === 'base' ? 'From' : 'To'})`),
      })),
      current: Math.max(0, walk.steps.findIndex((entry) => entry.id === stepId)),
    }),
    [lang],
  );

  /** Ask for a step explanation in its own channel. */
  const askExplanation = useCallback(
    async (
      walk: Walk,
      step: WalkStep,
      asProfile: PublicProfile,
      action: ExplanationAction,
      options: { readonly parent: string | null; readonly selection?: string; readonly quote?: SelectionQuote | null; readonly trigger: 'auto' | 'person' },
    ): Promise<StepExplanationOutcome | null> => {
      const bridge = window.dspatchReviewDiscussion;
      if (bridge?.explain === undefined) {
        return null;
      }
      const slot = slotOf(walk.id, step, asProfile);
      const key = slotKey(slot);
      if (options.trigger === 'person') {
        // What the person asks for is what they want to read when it arrives.
        setNavAt((before) => {
          const { [key]: _gone, ...rest } = before;
          return rest;
        });
      }
      await flush();
      const outcome = await bridge
        .explain({
          ...slot,
          action,
          parent: options.parent,
          ...(options.selection === undefined ? {} : { selection: options.selection }),
          ...(options.quote === undefined || options.quote === null ? {} : { quote: options.quote }),
          trigger: options.trigger,
          language: lang,
          outline: outlineOf(walk, step.id),
        })
        .catch((error: unknown): StepExplanationOutcome => ({ kind: 'refused', error: error instanceof Error ? error.message : String(error) }));
      if (outcome.kind === 'sent') {
        setExplanationError(null);
      } else if (options.trigger === 'person' || outcome.kind !== 'refused' || outcome.busy !== true) {
        setExplanationError({ key, error: outcome.error });
      }
      return outcome;
    },
    [flush, lang, outlineOf, slotOf],
  );

  /** The current step's explanation in the profile chosen: its history and what is shown. */
  const stepExplanation = useMemo(() => {
    if (current === null) {
      return null;
    }
    const slot = slotOf(current.walk.id, current.step, profile);
    const history = historyOf(explanationState.entries, slot);
    const key = slotKey(slot);
    return { slot, key, history, shown: shownItem(history, navAt[key]) };
  }, [current, profile, explanationState.entries, navAt, slotOf]);

  // Asking on arrival (DSP-180, DSP-181, kept): only the page that shows the panel asks, only for
  // the current step and profile, 500 ms after the person settles, the latest step winning; never on
  // open or load, never when there is one, and never after an attempt ended without one.
  const autoArmed = useRef(false);
  const autoInFlight = useRef(false);
  const autoWanted = useRef<{ readonly walk: Walk; readonly step: WalkStep; readonly profile: PublicProfile } | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nowShown = useRef<{ readonly stepId: string | null; readonly profile: PublicProfile }>({ stepId: null, profile });
  nowShown.current = { stepId: away === null ? (current?.step.id ?? null) : null, profile };
  const busyRef = useRef(explanationState.busy);
  busyRef.current = explanationState.busy;

  const runWanted = useCallback(() => {
    const next = autoWanted.current;
    if (next === null || autoInFlight.current || busyRef.current !== null) {
      return;
    }
    autoWanted.current = null;
    // The latest step wins: a wish for a step the person has left is dropped.
    if (nowShown.current.stepId !== next.step.id || nowShown.current.profile !== next.profile) {
      return;
    }
    autoInFlight.current = true;
    void askExplanation(next.walk, next.step, next.profile, 'present', { parent: null, trigger: 'auto' }).then((outcome) => {
      autoInFlight.current = false;
      if (outcome !== null && outcome.kind === 'refused' && outcome.busy === true && autoWanted.current === null) {
        autoWanted.current = next;
      }
    });
  }, [askExplanation]);

  useEffect(() => {
    // The channel became free: a wish that waited for it goes now.
    if (explanationState.busy === null) {
      runWanted();
    }
  }, [explanationState.busy, runWanted]);

  const lastAutoStep = useRef<string | null>(current?.step.id ?? null);
  useEffect(() => {
    const stepId = current?.step.id ?? null;
    if (lastAutoStep.current === null) {
      lastAutoStep.current = stepId;
      return;
    }
    if (stepId !== null && stepId !== lastAutoStep.current) {
      autoArmed.current = true;
    }
    lastAutoStep.current = stepId;
  }, [current?.step.id]);

  useEffect(() => {
    if (autoTimer.current !== null) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    if (!showsPanel || !autoArmed.current || current === null || away !== null || stepExplanation === null) {
      return;
    }
    if (!wantsExplanation(walkProfile, profile, stepExplanation.history)) {
      return;
    }
    const target = { walk: current.walk, step: current.step, profile } as const;
    autoTimer.current = setTimeout(() => {
      autoWanted.current = target;
      runWanted();
    }, 500);
    return () => {
      if (autoTimer.current !== null) {
        clearTimeout(autoTimer.current);
        autoTimer.current = null;
      }
    };
  }, [showsPanel, current, away, stepExplanation, profile, walkProfile, runWanted]);

  const chooseProfile = useCallback(
    (next: PublicProfile) => {
      rememberLatestProfile(next);
      autoArmed.current = true;
      update((value) => ({ ...value, ui: { ...value.ui, presentationProfile: next } }));
      setExplanationError(null);
    },
    [rememberLatestProfile, update],
  );

  useEffect(() => {
    if (state.ui.presentationProfile === profile) {
      return;
    }
    update((value) => ({ ...value, ui: { ...value.ui, presentationProfile: profile } }));
  }, [profile, state.ui.presentationProfile, update]);

  /**
   * DSP-184: what a question in the discussion about the current step carries of the explanation
   * shown in Step: the generated text, as hidden context. The walk's own text is in the envelope
   * already. No profile goes with it: the conversation is the person's.
   */
  const readingFor = useCallback((): { readonly text: string } | null => {
    if (stepExplanation === null || away !== null || openCheck !== null || discussionRequest.subject.kind !== 'point') {
      return null;
    }
    const entry = stepExplanation.history.entries.get(stepExplanation.shown);
    return entry === undefined ? null : { text: entry.text };
  }, [stepExplanation, away, openCheck, discussionRequest.subject.kind]);

  /** Explain this at the current step: an explanation in Step, building on the one shown. */
  const explainInStep = useCallback(
    (text: string, selected: SelectionQuote | null): boolean => {
      if (current === null || away !== null || openCheck !== null || stepExplanation === null || text.trim() === '') {
        return false;
      }
      const parent = stepExplanation.shown === WALK_TEXT ? null : stepExplanation.shown;
      void askExplanation(current.walk, current.step, profile, 'explain', { parent, selection: text.trim().slice(0, 2000), quote: selected, trigger: 'person' });
      setRightTab('step');
      return true;
    },
    [current, away, openCheck, stepExplanation, askExplanation, profile],
  );

  /** Explain exactly this selection: the one just read, or the one kept. */
  const explainQuote = useCallback(
    (selected: SelectionQuote | null = quote) => {
      setQuoteOffer(null);
      // DSP-184: at a step it is the step's explanation, in Step; elsewhere a question in the discussion.
      if (selected !== null && !explainInStep(selected.text, selected)) {
        void deepen({ action: 'explain', text: selected.text.slice(0, 2000) }, false, selected);
      }
    },
    [deepen, quote, explainInStep],
  );

  // Read what is selected now; offer the action beside it, or in place of the context menu.
  const takeSelection = useCallback(
    (menuAt: { readonly x: number; readonly y: number } | null): SelectionQuote | null => {
      const root = viewRoot.current;
      // Text selected in a review thread is asked about in that thread (DSP-175), with its own
      // offer there; the walk's offer would be a second menu for the same selection.
      const anchorNode = root?.ownerDocument.getSelection()?.anchorNode ?? null;
      const anchorElement = anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
      if (anchorElement?.closest('[data-quote-source="thread"]') != null) {
        setQuoteOffer(null);
        return null;
      }
      const found = root === null ? null : readQuote(root);
      if (found === null) {
        if (menuAt === null && (root?.ownerDocument.getSelection()?.isCollapsed ?? true)) {
          setQuoteOffer(null);
        }
        return null;
      }
      quoteMark.current = found.quote.kind === 'text' ? found.range : null;
      shareQuote(found.quote);
      setQuoteOffer(menuAt === null ? { x: found.rect.right, y: found.rect.bottom, menu: false } : { ...menuAt, menu: true });
      return found.quote;
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'E' || event.key === 'e')) {
        // What is selected now, if anything; else the selection kept for the question.
        const selected = takeSelection(null) ?? quote;
        if (selected !== null) {
          event.preventDefault();
          explainQuote(selected);
        }
      } else if (event.key === 'Escape') {
        setQuoteOffer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explainQuote, takeSelection, quote]);

  // The panel's element goes into the review panel's page before anything is painted.
  useLayoutEffect(() => {
    if (dockSlot.current !== null && panelHost.parentNode !== dockSlot.current) {
      dockSlot.current.appendChild(panelHost);
    }
  });

  // The changed lines the current walk covers, for delegating the walk (DSP-152).
  const walkScope = useMemo(() => {
    if (current === null) {
      return null;
    }
    const stepIds = new Set(current.walk.steps.map((entry) => entry.id));
    const ranges = coverage.hunks.filter((entry) => entry.plannedBy.some((id) => stepIds.has(id))).flatMap((entry) => hunkRanges(entry.hunk));
    return ranges.length === 0 ? null : { kind: 'walk' as const, label: `walk ${current.walk.id} · ${pick(current.walk.title, lang)}`, ranges };
  }, [current, coverage, lang]);
  const walkJob =
    current === null || pair === null
      ? null
      : ([...pair.record.jobs].reverse().find((job) => job.kind === 'review' && job.scope?.kind === 'walk' && job.scope.label.startsWith(`walk ${current.walk.id} `)) ?? null);

  /*
   * What is worth checking, asked for on its own (Niclas's decision of 30 October 2026): the
   * walks come without it, and the person asks for it when they want it, perhaps after walking
   * the change. The points are kept beside the walks; when they arrive the review is read again
   * with them, and nothing else about it changes.
   */
  const checksJob =
    pair === null
      ? null
      : ([...pair.record.jobs].reverse().find((job) => job.kind === 'checks' && (job.definitionPath ?? '').toLowerCase() === bundle.definitionPath.toLowerCase()) ?? null);
  const [askingChecks, setAskingChecks] = useState(false);
  const [checksProblem, setChecksProblem] = useState<string | null>(null);
  const checksState = useRef<string | null>(null);
  useEffect(() => {
    const now = checksJob?.state ?? null;
    const before = checksState.current;
    checksState.current = now;
    if (before !== null && before !== 'done' && now === 'done') {
      void flush().then(onReread);
    }
  }, [checksJob?.state, flush, onReread]);
  const checksOffer =
    pair === null || pairBridge === undefined || bundle.definition.checks.length > 0 ? null : (
      <div className="rv-checks-ask" data-ev="walk-checks-ask">
        {checksJob !== null && (!askingChecks || isRunning(checksJob)) && (
          <JobLine job={checksJob} onStop={() => void pairBridge.cancelJob(pair.key, checksJob.id)} />
        )}
        {checksProblem !== null && <p className="rv-error">{checksProblem}</p>}
        {askingChecks ? (
          <AgentPicker
            pairKey={pair.key}
            action="Find what is worth checking"
            busy={false}
            testId="walk-checks-agent"
            onCancel={() => setAskingChecks(false)}
            onStart={(choice) => {
              void pairBridge
                .startJob(pair.key, { kind: 'checks', ...choice, definitionPath: bundle.definitionPath })
                .catch((error: unknown) => ({ error: requestFailure(error) }))
                .then((answer) => {
                  if (isPairError(answer)) {
                    setChecksProblem(`It could not be started: ${answer.error}`);
                  } else {
                    setChecksProblem(null);
                    setAskingChecks(false);
                  }
                });
            }}
          />
        ) : (
          (checksJob === null || !isRunning(checksJob)) && (
            <>
              <button type="button" className="rv-quiet" data-ev="walk-find-checks" onClick={() => setAskingChecks(true)}>
                Find what is worth checking…
              </button>
              <p className="rv-sub">Questions, uncertainties and findings beyond the walks, from the agent, when you want them.</p>
            </>
          )
        )}
      </div>
    );

  // The divider between the code and the explanation: dragged, or moved with the arrow keys.
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clampWidth = (value: number): number => Math.round(Math.min(EXPLANATION_WIDTH.max, Math.max(EXPLANATION_WIDTH.min, value)));
  const navDrag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clampNav = (value: number): number => Math.round(Math.min(NAVIGATION_WIDTH.max, Math.max(NAVIGATION_WIDTH.min, value)));
  const walkKinds = { walks: bundle.definition.walks.filter((walk) => walk.kind === 'walk').length, readings: bundle.definition.walks.filter((walk) => walk.kind === 'reading').length };

  const noWalks = bundle.definition.walks.length === 0;
  useEffect(() => {
    if (noWalks) {
      setRightTab('discussion');
    }
  }, [noWalks]);
  /*
   * A walk is read with its step's explanation, which is in the review's panel. Opening a walk
   * opens the panel on Step, without taking the focus, when the review has none yet; one the
   * person has hidden stays hidden. A walk that belongs to no revision pair has no review
   * panel to show, and keeps the panel here in its own window.
   */
  useEffect(() => {
    if (PANEL_MODE || panelBridge === undefined || noWalks) {
      return;
    }
    void panelBridge.state().then(async (known) => {
      if (known === null && !(await panelBridge.show(null, false, 'step')).ok) {
        setPanelHere(true);
      }
    });
  }, [panelBridge, noWalks]);
  /** The walk window keeps room for the panel while it is docked here, and says where the room is. */
  const dockedHere = !PANEL_MODE && (panelHere || panelState?.dockedHere === true);
  const roomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const room = roomRef.current;
    if (PANEL_MODE || panelBridge === undefined || room === null || !dockedHere || panelHere) {
      return;
    }
    const tell = (): void => {
      const box = room.getBoundingClientRect();
      panelBridge.slot({ x: box.left, y: box.top, width: box.width, height: box.height });
    };
    tell();
    const observer = new ResizeObserver(tell);
    observer.observe(room);
    window.addEventListener('resize', tell);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', tell);
    };
  }, [panelBridge, dockedHere, panelHere]);
  const rightPanel = (
        <aside className="rv-right">
          <div className="rv-tabs rv-right-tabs" role="tablist">
            {(noWalks ? (['discussion'] as const) : (['step', 'discussion'] as const)).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                data-ev={`right-tab-${key}`}
                aria-selected={rightTab === key}
                className={rightTab === key ? 'rv-tab rv-tab-on' : 'rv-tab'}
                onClick={() => setRightTab(key)}
              >
                {words.rightTabs[key]}
              </button>
            ))}
            {/* DSP-181: before any walk exists, the profile the walks will be prepared in. With walks the
                chooser is the step explanation's, in Step (DSP-184). */}
            {noWalks && (
              <label className="rv-profile-choice" title={words.profiles.description[profile]}>
                <span className="rv-sub">{words.profiles.prepareLabel}</span>{' '}
                <select data-ev="presentation-profile" value={profile} onChange={(event) => chooseProfile(isPublicProfile(event.currentTarget.value) ? event.currentTarget.value : profile)}>
                  {PUBLIC_PROFILES.map((id) => (
                    <option key={id} value={id} title={words.profiles.description[id]}>
                      {words.profiles.name[id]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* Where the panel is: its own window, or docked in a code window of the review (30 October 2026). */}
            <span className="rv-panel-places" role="group" aria-label="Where this panel is">
              {panelState !== null && panelState.place !== 'window' && (
                <button type="button" className="rv-panel-window" data-ev="panel-own-window" title="Move this panel to a window of its own" onClick={() => void panelBridge?.dock('window')}>
                  ⧉
                </button>
              )}
              {panelState?.offers.diff === true && panelState.place !== 'diff' && (
                <button type="button" className="rv-panel-window rv-panel-dock" data-ev="panel-dock-diff" title="Dock this panel in the diff window" onClick={() => void panelBridge?.dock('diff')}>
                  Dock in diff
                </button>
              )}
              {panelState?.offers.walk === true && panelState.place !== 'walk' && (
                <button type="button" className="rv-panel-window rv-panel-dock" data-ev="panel-dock-walk" title="Dock this panel in the walk window" onClick={() => void panelBridge?.dock('walk')}>
                  Dock in walk
                </button>
              )}
              {panelState !== null && panelState.place !== 'window' && (
                <button type="button" className="rv-panel-window" data-ev="panel-hide" title="Hide this panel; nothing in it stops" onClick={() => void panelBridge?.hide()}>
                  Hide
                </button>
              )}
            </span>
          </div>
          <ReviewDiscussion
            bundle={bundle}
            request={discussionRequest}
            reading={readingFor}
            lang={lang}
            words={words.discussion}
            shown={rightTab === 'discussion'}
            flush={flush}
            onGoToPoint={(stepId, index) => {
              goToStep(stepId, index);
              setNavRequest((count) => count + 1);
            }}
            onGoToLocation={(location) => goAway(location)}
            onMessages={setDiscussionMessages}
            onActivity={setDiscussionActivity}
            onClearQuote={dropQuote}
            onShow={(quiet, tab) => {
              // Asked for from a window of the review: the discussion, and the cursor in its question;
              // or the step, for a point opened in the walk window.
              setRightTab(tab);
              if (!quiet && tab === 'discussion') {
                setTimeout(() => panelHost.querySelector<HTMLTextAreaElement>('[data-ev="discussion-composer"]')?.focus(), 0);
              }
            }}
            onSharedQuote={(shared) => {
              // Chosen in another window: what the question is about here too, with no mark of
              // its own in this window's code.
              quoteMark.current = null;
              setQuote(shared);
            }}
          />
          {rightTab === 'step' && (
            <>
              {/* DSP-186: as in the diff window, said and never acted on: walks are prepared again only when the person asks. */}
              {pair !== null && pair.record.generation !== null && (generationStale(pair.record, PRESENTATION_INSTRUCTION_VERSION) || (pair.record.generation.profile !== null && pair.record.generation.profile !== profile)) && (
                <p className="rv-pair-hint" data-ev="walk-stale">
                  The code walks of this review were prepared with earlier settings
                  {pair.record.generation.profile !== null && pair.record.generation.profile !== profile && isPublicProfile(pair.record.generation.profile) ? ` (the ${words.profiles.name[pair.record.generation.profile]} profile)` : ''}. Prepare them again to use the current
                  ones; nothing is prepared again by itself.
                </p>
              )}
              {pair !== null && pairBridge !== undefined && focus !== null && (
                <div className="rv-show-in-diff">
                  <button
                    type="button"
                    data-ev="walk-show-in-diff"
                    onClick={() => {
                      void pairBridge
                        .showInDiff({ side: focus.side, path: focus.path, line: focus.start })
                        .then((answer) => setDiffNote(answer.ok ? '' : answer.note));
                    }}
                  >
                    Show in diff
                  </button>
                  {diffNote !== '' && <span className="rv-sub">{diffNote}</span>}
                </div>
              )}
              {focus !== null && threadsHere.some((thread) => thread.id !== openCheckThread?.id) && (
                // DSP-175: the review's threads at the place shown, the same threads the diff shows;
                // an open point's own thread is shown with the point, not twice.
                <div className="rv-threads-here" data-ev="walk-threads-here">
                  {threadsHere.filter((thread) => thread.id !== openCheckThread?.id).map((thread) => (
                    <ThreadCard key={thread.id} thread={thread} />
                  ))}
                </div>
              )}
              {pair !== null && pairBridge !== undefined && current !== null && away === null && walkScope !== null && (
                <div className="rv-walk-delegate">
                  {walkJob !== null && (!delegatingWalk || isRunning(walkJob)) && (
                    <AgentReviewResult
                      job={walkJob}
                      files={pair.files}
                      threads={threads.filter((thread) => thread.jobId === walkJob.id)}
                      expandThreads
                      onStop={() => void pairBridge.cancelJob(pair.key, walkJob.id)}
                      onShow={(range) => {
                        void pairBridge
                          .showInDiff({ side: range.side, path: range.path, line: range.start })
                          .then((answer) => setDiffNote(answer.ok ? '' : answer.note));
                      }}
                    />
                  )}
                  {delegatingWalk ? (
                    <AgentPicker
                      pairKey={pair.key}
                      action="Delegate this walk"
                      busy={false}
                      testId="walk-delegate-agent"
                      onCancel={() => setDelegatingWalk(false)}
                      onStart={(choice) => {
                        void pairBridge
                          .startJob(pair.key, { kind: 'review', ...choice, scope: walkScope })
                          .catch((error: unknown) => ({ error: requestFailure(error) }))
                          .then((answer) => {
                          if (isPairError(answer)) {
                            setDiffNote(`The review could not be started: ${answer.error}`);
                          } else {
                            setDelegatingWalk(false);
                          }
                        });
                      }}
                    />
                  ) : (
                    walkJob?.state !== 'running' &&
                    walkJob?.state !== 'cancelling' && (
                      <button type="button" className="rv-quiet" data-ev="walk-delegate" onClick={() => setDelegatingWalk(true)}>
                        Delegate this walk to the agent…
                      </button>
                    )
                  )}
                </div>
              )}
              {openCheck !== null && (
                <CheckPanel
                  check={openCheck}
                  thread={openCheckThread}
                  inTour={current?.walk.kind === 'check' && current.walk.id === openCheck.id}
                  exchanges={pointExchanges(discussionMessages, openCheck.id)}
                  error={deepenError}
                  backLabel={PANEL_MODE ? followedBack : pointBack}
                  lang={lang}
                  onBack={PANEL_MODE ? () => panelBridge?.action({ kind: 'closeCheck' }) : closePoint}
                  onShow={goAway}
                  onDeepen={(request) => void deepen(request, true)}
                  onAsk={async (question) => {
                    const discussion = window.dspatchReviewDiscussion;
                    if (discussion === undefined) {
                      return 'The discussion is not available in this window.';
                    }
                    await flush();
                    const outcome = await discussion.send({ question, subject: discussionRequest.subject, selection: discussionRequest.selection, language: lang });
                    return outcome.kind === 'sent' ? null : outcome.error;
                  }}
                />
              )}
              {current !== null && away === null && place !== null && (
                <StepPanel
                  codeQuestion={
                    pair === null || pairBridge === undefined
                      ? undefined
                      : () => (
                          <StepCodeQuestion
                            pairKey={pair.key}
                            bridge={pairBridge}
                            jobs={pair.record.jobs.filter(
                              (job) => job.kind === 'explain' && job.question?.definitionPath === bundle.definitionPath && job.question.stepId === current.step.id,
                            )}
                            onShow={(range) => goAway({ path: range.path, side: range.side, start: range.start, end: range.end })}
                          />
                        )
                  }
                  explanation={((): StepExplanationView => {
                    const view = stepExplanation;
                    const history = view?.history ?? historyOf([], slotOf(current.walk.id, current.step, profile));
                    const shown = view?.shown ?? WALK_TEXT;
                    const ask = (action: ExplanationAction, parent: string | null, selection?: string): void =>
                      void askExplanation(current.walk, current.step, profile, action, { parent, ...(selection === undefined ? {} : { selection }), trigger: 'person' });
                    const parentOfShown = shown === WALK_TEXT ? null : shown;
                    return {
                      profile,
                      walkProfile,
                      history,
                      shown,
                      busy: explanationState.busy,
                      error: view !== null && explanationError?.key === view.key ? explanationError.error : null,
                      onChoose: chooseProfile,
                      onNavigate: (item) => {
                        if (view !== null) {
                          setNavAt((before) => ({ ...before, [view.key]: item }));
                        }
                      },
                      onPresent: () => ask(history.hasDone || walkProfile === profile ? 'regenerate' : 'present', history.hasDone ? (history.items.at(-1) ?? null) : null),
                      onMore: () => ask('more', parentOfShown),
                      onSimpler: () => ask('simpler', parentOfShown),
                      onExplainThis: (text) => ask('explain', parentOfShown, text),
                      onRetry: () => {
                        const failed = history.failed;
                        if (failed !== null) {
                          ask(failed.action, failed.parent, failed.selection);
                        }
                      },
                      onStop: () => void window.dspatchReviewDiscussion?.stopExplanation?.(),
                      onContinue: () => {
                        setRightTab('discussion');
                        setTimeout(() => panelHost.querySelector<HTMLTextAreaElement>('[data-ev="discussion-composer"]')?.focus(), 0);
                      },
                    };
                  })()}
                  walk={current.walk}
                  step={current.step}
                  index={current.index}
                  stops={stepStops}
                  placeIndex={placeIndex}
                  stopIndex={activeStopIndex}
                  referenceProblems={bundle.referenceProblems}
                  state={state}
                  words={words}
                  lang={lang}
                  onPlace={(index) => {
                    const stop = stepStops[index];
                    const first = stop?.placeIndexes[0];
                    if (first === undefined) {
                      return;
                    }
                    goToStep(current.step.id, first);
                    setNavRequest((count) => count + 1);
                  }}
                  onOpenEvidence={goAway}
                  quoteText={quote?.text ?? ''}
                />
              )}
              {away !== null && current !== null && (
                <section className="rv-step-panel">
                  <div className="rv-walk-title">{words.outsideWalk}</div>
                  <button type="button" onClick={returnToWalk}>
                    {words.backTo(current.step.id)}
                  </button>
                </section>
              )}
              <Collapsible title={words.reviewSection} defaultOpen={false} ev="walk-review-section">
                {current !== null && away === null && (
                  <div className="rv-walked">
                    <button type="button" onClick={() => toggleWalked(current.step.id)}>
                      {state.walkedSteps[current.step.id] === undefined ? words.markWalked : words.walkedUndo}
                    </button>
                    <span className="rv-sub">{words.walkedNote}</span>
                  </div>
                )}
                <HunkDecisions
                  focus={focus}
                  diffFile={diffFile}
                  files={files}
                  coverage={coverageByHunk}
                  decisions={shownState.decisions}
                  onDecide={decide}
                  revisionText={revisionText}
                  words={words}
                />
              </Collapsible>
              <NotesHere notes={state.notes} location={focus} stepId={current?.step.id ?? null} words={words} onOpen={goAway} />
            </>
          )}
        </aside>
  );
  const quoteOfferView = (
    quoteOffer !== null && quote !== null && (
        <div
          className={quoteOffer.menu ? 'rv-explain-menu' : 'rv-explain-offer'}
          data-ev="walk-quote-offer"
          role={quoteOffer.menu ? 'menu' : undefined}
          style={{
            left: Math.min(quoteOffer.x, window.innerWidth - 220),
            top: Math.min(quoteOffer.y + 4, window.innerHeight - 80),
          }}
        >
          <button
            type="button"
            role={quoteOffer.menu ? 'menuitem' : undefined}
            data-ev="walk-explain-this"
            title="Explain exactly what is selected (Ctrl+Shift+E)"
            // Not a focus change: the selection stays as it is.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              explainQuote();
              showPanel(false);
            }}
          >
            Explain this
          </button>
          {/* DSP-175: Ask beside Explain this, as in the diff: the question opens with the selection quoted, and nothing is sent. */}
          {(
            <button
              type="button"
              role={quoteOffer.menu ? 'menuitem' : undefined}
              data-ev="walk-ask-about-this"
              title="Write your own question about exactly what is selected; nothing is sent until you send it"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuoteOffer(null);
                if (PANEL_MODE) {
                  setRightTab('discussion');
                  setTimeout(() => panelHost.querySelector<HTMLTextAreaElement>('[data-ev="discussion-composer"]')?.focus(), 0);
                } else {
                  showPanel(true);
                }
              }}
            >
              {quoteOffer.menu ? 'Ask about this…' : 'Ask…'}
            </button>
          )}
        </div>
    )
  );
  const rootHandlers = {
    onMouseUp: (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (event.button === 0 && !(event.target as Element).closest('[data-ev="walk-quote-offer"]')) {
        // After the browser has settled the selection for this release.
        setTimeout(() => takeSelection(null), 0);
      }
    },
    onKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.shiftKey && !event.ctrlKey) {
        takeSelection(null);
      }
    },
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (takeSelection({ x: event.clientX, y: event.clientY }) !== null) {
        event.preventDefault();
      }
    },
  };
  if (PANEL_MODE) {
    return (
      <PairKeyContext.Provider value={pair?.key ?? null}>
      <ThreadContext.Provider value={threadActions}>
      <DiscussionActivity.Provider value={discussionActivity}>
        <div className="rv rv-panel-only" ref={viewRoot} {...rootHandlers}>
          {quoteOfferView}
          <div className="rv-right-dock rv-panel-slot" ref={dockSlot} />
          {createPortal(rightPanel, panelHost)}
        </div>
      </DiscussionActivity.Provider>
      </ThreadContext.Provider>
      </PairKeyContext.Provider>
    );
  }

  return (
    <PairKeyContext.Provider value={pair?.key ?? null}>
      <ThreadContext.Provider value={threadActions}>
    <DiscussionActivity.Provider value={discussionActivity}>
    <div className="rv" ref={viewRoot} {...rootHandlers}    >
      {quoteOfferView}
      <Header
        bundle={bundle}
        history={state.previousDefinitionHashes.length}
        words={words}
        lang={lang}
        onLang={onLang}
        langError={langError}
        save={save}
        saving={saving}
        coverage={coverage}
        onChoose={pair === null ? onChoose : null}
        onDiscussion={() => showPanel(true)}
        discussionShown={panelState?.visible === true}
        pairWalks={pairWalks}
        onOpenWalk={(definitionPath) => {
          if (pair !== null && pairBridge !== undefined) {
            void pairBridge.openWalk(pair.key, definitionPath).then((answer) => setDiffNote(answer.ok ? '' : answer.note));
          }
        }}
      />
      {noticeOpen && bundle.stateNotice !== null && (
        <div className="rv-notice" role="status">
          <span>
            {bundle.stateNotice.kind === 'unusable'
              ? words.notices.unusable(bundle.stateNotice.keptAs)
              : words.notices.definitionChanged(bundle.stateNotice.carriedStepMarks, bundle.stateNotice.movedStepMarks)}
          </span>
          <button type="button" onClick={() => setNoticeOpen(false)}>
            {words.notices.dismiss}
          </button>
        </div>
      )}
      <div
        className={`${tab === 'coverage' || tab === 'notes' ? 'rv-body rv-body-wide' : 'rv-body'}${dockedHere ? '' : ' rv-body-detached'}`}
        style={{ '--rv-right-width': `${String(liveWidth)}px`, '--rv-left-width': `${String(liveNavWidth)}px` } as CSSProperties}
      >
        <nav className="rv-left">
          <div className="rv-tabs" role="tablist">
            {(['walks', 'coverage', 'notes', 'search'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? 'rv-tab rv-tab-on' : 'rv-tab'}
                onClick={() => setTab(key)}
              >
                {words.tabs[key]}
              </button>
            ))}
          </div>
          <div className="rv-left-body">
            {tab === 'walks' && (
              <div className="rv-walks-tab">
                {(pick(bundle.definition.overview, lang) !== '' || pick(bundle.definition.overviewSummary, lang) !== '') && (
                  <Collapsible title={words.overviewTitle} defaultOpen={state.shownSteps[bundle.definition.walks[0]?.steps[0]?.id ?? ''] === undefined} ev="walk-about">
                    <Overview summary={pick(bundle.definition.overviewSummary, lang)} full={pick(bundle.definition.overview, lang)} words={words} />
                  </Collapsible>
                )}
                <h2 className="rv-walks-heading" data-ev="walks-heading">
                  {words.walksHeading(walkKinds.walks, walkKinds.readings)}
                </h2>
                <WalkList
                  bundle={bundle}
                  state={state}
                  words={words}
                  lang={lang}
                  onStep={(stepId) => {
                    goToStep(stepId);
                    setNavRequest((count) => count + 1);
                  }}
                  onToggle={toggleWalk}
                />
                <WorthChecking
                  checks={bundle.definition.checks}
                  attention={pick(bundle.definition.attention, lang)}
                  offer={checksOffer}
                  open={openCheck?.id ?? null}
                  words={words}
                  lang={lang}
                  threadOf={checkThreadOf}
                  replies={(thread) => replyCountOf(thread, threadExchanges.get(thread.id) ?? [])}
                  onOpen={openPoint}
                />
                <Collapsible title={words.tree.title} defaultOpen={false} ev="walk-files">
                <FileTree
                  paths={treePaths}
                  changed={changedFiles}
                  current={focus?.path ?? null}
                  words={words}
                  onOpen={(path) => {
                    const file = changedFiles.get(path);
                    const hunk = file?.hunks[0];
                    // A file without changes opens whole: there is no change to centre on.
                    if (hunk === undefined) {
                      goAway({ path, side: file?.status === 'deleted' ? 'base' : 'target', start: 1, end: 1 }, 'file');
                    } else {
                      goAway(hunkLocation(hunk));
                    }
                  }}
                />
                </Collapsible>
              </div>
            )}
            {tab === 'coverage' && <CoverageTable coverage={coverage} words={words} onOpen={(hunk) => goAway(hunkLocation(hunk))} />}
            {tab === 'notes' && (
              <NotesList state={shownState} bundle={bundle} words={words} lang={lang} onOpen={goAway} onStatus={setNoteStatus} />
            )}
            {tab === 'search' && bridge !== undefined && <Browse bridge={bridge} words={words} onOpen={goAway} />}
          </div>
        </nav>

        <div
          className="rv-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={words.navigationWidth}
          aria-valuenow={liveNavWidth}
          aria-valuemin={NAVIGATION_WIDTH.min}
          aria-valuemax={NAVIGATION_WIDTH.max}
          tabIndex={0}
          data-ev="walk-nav-divider"
          onPointerDown={(event) => {
            navDrag.current = { x: event.clientX, width: liveNavWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (navDrag.current !== null) {
              setLiveNavWidth(clampNav(navDrag.current.width + event.clientX - navDrag.current.x));
            }
          }}
          onPointerUp={(event) => {
            if (navDrag.current !== null) {
              const next = clampNav(navDrag.current.width + event.clientX - navDrag.current.x);
              navDrag.current = null;
              onNavigationWidth(next);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onNavigationWidth(clampNav(liveNavWidth + (event.key === 'ArrowRight' ? 40 : -40)));
            }
          }}
        />

        <main className="rv-code">
          {away !== null && (
            <AwayBar
              away={away}
              sha={away.side === 'base' ? bundle.base.sha : bundle.target.sha}
              back={(() => {
                const back = cameFrom.current.at(-1);
                return back?.away != null ? `${fileName(back.away.path)}:${rangeText(back.away)} (${back.away.side === 'base' ? 'From' : 'To'})` : current === null ? null : (back?.stepId ?? current.step.id);
              })()}
              onBack={goBack}
            />
          )}
          {current !== null && activeStation >= 0 && (
            // Kept while a location is open, hidden, so the walk is where it was on the way back.
            <div className="rv-walk-stage" hidden={away !== null} ref={stage}>
              <WalkNavBar
                stations={stations}
                active={activeStation}
                stepId={current.step.id}
                placeIndex={activeStopIndex}
                placeCount={stepStops.length}
                place={place}
                canBack={activeWalkStop > 0 || bundle.definition.walks.indexOf(current.walk) > 0}
                canForward={
                  activeWalkStop >= 0 && activeWalkStop < walkStops.length - 1 ||
                  bundle.definition.walks.indexOf(current.walk) < bundle.definition.walks.length - 1
                }
                onMove={moveStation}
                level={level}
                onLevel={setLevel}
                view={view}
                onView={setView}
                wrap={place === null ? false : wrapsLines(state.ui, place.focus.path)}
                onWrap={(on) => {
                  if (place !== null) {
                    setWrap(place.focus.path, on);
                  }
                }}
                words={words}
                lang={lang}
              />
              {placeProblem !== null && <div className="rv-error rv-problem">{words.view.invalidReference(placeProblem)}</div>}
              <WalkTimeline
                key={current.walk.id}
                walk={current.walk}
                entry={entryDirection.current}
                selection={selection}
                onSelect={setSelection}
                stations={stations}
                active={activeStation}
                onActivate={(index) => {
                  const target = stations[index];
                  if (target !== undefined) {
                    goToStep(target.stepId, target.placeIndex);
                  }
                }}
                diffFiles={bundle.files}
                files={files}
                level={level}
                view={view}
                wrapProse={wrapProse}
                wrapCode={wrapCode}
                words={words}
                lang={lang}
                onOpenLocation={goAway}
                navRequest={navRequest}
                revision={focusRevision}
                activeStopFoci={((): readonly CodeLocation[] => {
                  if (activeStop === null) {
                    return [];
                  }
                  return activeStop.placeIndexes.map((index) => current.step.places[index]?.focus).filter((focus): focus is Place['focus'] => focus !== undefined);
                })()}
              />
            </div>
          )}
          {(away !== null || current === null || activeStation < 0) && (focus === null ? (
            <div className="rv-empty" />
          ) : (
            <CodePane
              key={`${focus.path}:${focus.side}:${String(focus.start)}:${String(focus.end)}`}
              focus={focus}
              contexts={contexts}
              diffFile={diffFile}
              files={files}
              view={view}
              onView={setView}
              scope={scope}
              onScope={setScope}
              wrap={wrapsLines(state.ui, focus.path)}
              onWrap={(on) => setWrap(focus.path, on)}
              selection={selection}
              onSelect={setSelection}
              problem={placeProblem}
              words={words}
              referenceMark={away !== null}
              memory={paneMemory.current.get(`${focus.path}:${focus.side}:${String(focus.start)}:${String(focus.end)}`) ?? null}
              onLeave={(memory) => paneMemory.current.set(`${focus.path}:${focus.side}:${String(focus.start)}:${String(focus.end)}`, memory)}
            />
          ))}
        </main>

        {dockedHere && (
        <div
          className="rv-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Width of the explanation"
          aria-valuenow={liveWidth}
          aria-valuemin={EXPLANATION_WIDTH.min}
          aria-valuemax={EXPLANATION_WIDTH.max}
          tabIndex={0}
          data-ev="walk-divider"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, width: liveWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current !== null) {
              setLiveWidth(clampWidth(drag.current.width + drag.current.x - event.clientX));
            }
          }}
          onPointerUp={(event) => {
            if (drag.current !== null) {
              const next = clampWidth(drag.current.width + drag.current.x - event.clientX);
              drag.current = null;
              onExplanationWidth(next);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onExplanationWidth(clampWidth(liveWidth + (event.key === 'ArrowLeft' ? 40 : -40)));
            }
          }}
        />
        )}
        {/* Room for the review's panel while it is docked in this window; the panel is drawn over it. */}
        <div className="rv-right-dock rv-panel-room" ref={roomRef} data-ev="panel-room" hidden={!dockedHere}>
          {panelHere && <div className="rv-right-dock rv-panel-slot" ref={dockSlot} />}
        </div>
        {panelHere && createPortal(rightPanel, panelHost)}

      </div>
    </div>
    </DiscussionActivity.Provider>
    </ThreadContext.Provider>
      </PairKeyContext.Provider>
  );
}

/**
 * A few sentences first, with what is worth checking right under them; the background
 * opens on request. *Show more* is offered only when there is more to show: in Niclas's
 * trial a generated walk's summary and full text were the same text, so pressing it
 * changed nothing (the preparation wrote one overview into both fields).
 */
function Overview({ summary, full, words }: { readonly summary: string; readonly full: string; readonly words: ReviewWords }): JSX.Element {
  const [more, setMore] = useState(false);
  const first = summary === '' ? full : summary;
  const extra = summary !== '' && full.trim() !== '' && full.trim() !== summary.trim();
  return (
    <div className="rv-explanation rv-overview" data-ev="walk-overview">
      <Markdown text={more && extra ? full : first} />
      {extra && (
        <button type="button" className="rv-link rv-more-link" data-ev="walk-overview-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? words.showLess : words.showMore}
        </button>
      )}
    </div>
  );
}

const CHECK_WORD: Record<CheckKind, { readonly sv: string; readonly en: string }> = {
  question: { sv: 'Fråga', en: 'Question' },
  uncertainty: { sv: 'Osäkert', en: 'Uncertain' },
  finding: { sv: 'Fynd', en: 'Finding' },
};

/**
 * What is worth checking, after the walks (30 October 2026): a short title per point and at
 * most a sentence more. Opening one shows its reasoning at the code. A review prepared before
 * has only its text, shown as written: no links are made up for it.
 */
function WorthChecking({
  checks,
  attention,
  offer,
  open,
  words,
  lang,
  threadOf,
  replies,
  onOpen,
}: {
  readonly checks: readonly CheckPoint[];
  readonly attention: string;
  /** Asking for the points, while there are none (30 October 2026). */
  readonly offer: ReactNode;
  readonly open: string | null;
  readonly words: ReviewWords;
  readonly lang: Lang;
  /** DSP-175: the review thread a point is, when the walk is tied to its revision pair. */
  readonly threadOf: (check: CheckPoint) => ReviewThread | null;
  readonly replies: (thread: ReviewThread) => number;
  readonly onOpen: (check: CheckPoint) => void;
}): JSX.Element | null {
  if (checks.length === 0 && attention.trim() === '' && offer === null) {
    return null;
  }
  // A point that is the same thread as one listed before it is not listed twice.
  const seen = new Set<string>();
  const listed = checks.filter((check) => {
    const id = threadOf(check)?.id;
    if (id === undefined) {
      return true;
    }
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  return (
    <section className="rv-checks" data-ev="walk-attention">
      <h2 className="rv-walks-heading">{words.attentionTitle}</h2>
      {checks.length === 0 ? (
        <>
          {attention.trim() !== '' && (
            <div className="rv-explanation">
              <Markdown text={attention} />
            </div>
          )}
          {offer}
        </>
      ) : (
        <ul className="rv-check-list">
          {listed.map((check) => {
            const thread = threadOf(check);
            const count = thread === null ? 0 : replies(thread);
            return (
            <li key={check.id} {...(thread === null ? {} : { 'data-thread-id': thread.id, 'data-thread-status': thread.status })}>
              <button
                type="button"
                className={`${check.id === open ? 'rv-check-item rv-check-on' : 'rv-check-item'}${thread === null ? '' : ` rv-thread-${thread.status}`}`}
                data-ev={`check-${check.id}`}
                aria-current={check.id === open ? 'true' : undefined}
                onClick={() => onOpen(check)}
              >
                {thread !== null && (
                  // DSP-175: the point as the review thread it is: its status, kind and replies.
                  <span className="rv-check-thread" data-ev="check-thread-line">
                    <span className={`rv-thread-status rv-thread-status-${thread.status}`} data-ev="check-thread-status">
                      <span aria-hidden="true">{STATUS_MARK[thread.status]}</span> {STATUS_WORDS[thread.status]}
                    </span>{' '}
                    <span className="rv-thread-kind">{KIND_WORDS[thread.kind]}</span>{' '}
                    <span className="rv-sub" data-ev="check-thread-replies">
                      {count === 0 ? 'no replies' : `${String(count)} ${count === 1 ? 'reply' : 'replies'}`}
                    </span>
                  </span>
                )}
                <span className="rv-check-head">
                  {thread === null && <span className={`rv-check-kind rv-check-kind-${check.kind}`}>{CHECK_WORD[check.kind][lang]}</span>}
                  <span className="rv-check-title">
                    <Inline text={pick(check.title, lang)} />
                  </span>
                </span>
                {pick(check.detail, lang) !== '' && (
                  <span className="rv-check-detail">
                    <Inline text={pick(check.detail, lang)} />
                  </span>
                )}
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * An open point worth checking, above the step it goes to: why it is worth checking, its
 * places as links, and the way back. Tell me more, Explain more simply and the person's own
 * questions are asked with the point, its code and what was answered before. None of it
 * decides anything: lines are marked, and findings resolved, only where that is done.
 */
function CheckPanel({
  check,
  thread,
  inTour,
  exchanges,
  error,
  backLabel,
  lang,
  onBack,
  onShow,
  onDeepen,
  onAsk,
}: {
  readonly check: CheckPoint;
  /** DSP-175: the review thread the point is, with its recommendation and decisions; `null` when the walk has none. */
  readonly thread: ReviewThread | null;
  /** Shown on its own tour, whose step already holds the reasoning. */
  readonly inTour: boolean;
  readonly exchanges: readonly Deepening[];
  readonly error: string | null;
  readonly backLabel: string | null;
  readonly lang: Lang;
  readonly onBack: () => void;
  readonly onShow: (location: CodeLocation) => void;
  readonly onDeepen: (request: DeepenRequest) => void;
  readonly onAsk: (question: string) => Promise<string | null>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = exchanges.some((entry) => entry.question.status === 'sending' || entry.answer?.status === 'streaming');
  return (
    <section className="rv-check-panel" data-ev="check-panel" data-check={check.id}>
      <div className="rv-check-panel-top">
        <span className={`rv-check-kind rv-check-kind-${check.kind}`}>{CHECK_WORD[check.kind][lang]}</span>
        {backLabel !== null && (
          <button type="button" className="rv-link" data-ev="check-back" onClick={onBack}>
            ← {backLabel}
          </button>
        )}
      </div>
      <h2 className="rv-check-panel-title">
        <Inline text={pick(check.title, lang)} />
      </h2>
      {!inTour && pick(check.reasoning, lang) !== '' && (
        <div className="rv-explanation" data-ev="check-reasoning" data-quote-source="explanation">
          <Markdown text={pick(check.reasoning, lang)} />
        </div>
      )}
      {check.places.length > 0 && (
        <div className="rv-answer-refs" data-ev="check-places">
          <span className="rv-sub">{lang === 'sv' ? 'Koden det gäller:' : 'The code it is about:'}</span>
          <ul>
            {check.places.map((ref) => (
              <li key={ref.id}>
                <button type="button" className="rv-pair-link" data-ev="check-place" onClick={() => onShow(asLocation(ref))}>
                  {ref.note === undefined ? `${ref.path}:${rangeText(ref)}` : pick(ref.note, lang)}
                </button>{' '}
                <span className="rv-sub">
                  {ref.path}:{rangeText(ref)} ({ref.side === 'base' ? 'From' : 'To'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {thread !== null && (
        <div className="rv-check-thread-card" data-ev="check-thread">
          <ThreadCard thread={thread} />
        </div>
      )}
      <div className="rv-deepen-actions">
        <button type="button" data-ev="check-tell-more" disabled={waiting} onClick={() => onDeepen({ action: 'more' })}>
          Tell me more
        </button>
        <button type="button" data-ev="check-explain-simpler" disabled={waiting} onClick={() => onDeepen({ action: 'simpler' })}>
          Explain more simply
        </button>
      </div>
      {exchanges.map((entry, index) => {
        const status = entry.answer?.status ?? entry.question.status;
        return (
          <details key={entry.question.id} className="rv-deepening" open={index === exchanges.length - 1} data-ev="check-exchange" data-state={status}>
            <summary>
              {entry.question.deepen === undefined ? `“${entry.question.text.slice(0, 70)}”` : DEEPEN_WORD[entry.question.deepen.action]}
              {(status === 'sending' || status === 'streaming') && <span className="rv-sub"> · answering…</span>}
              {(status === 'failed' || status === 'unknown' || status === 'cancelled') && <span className="rv-sub"> · {status}</span>}
            </summary>
            {entry.answer !== null && entry.answer.text !== '' ? (
              <div data-quote-origin={`the answer to “${(entry.question.deepen?.text ?? entry.question.text).replace(/\s+/g, ' ').slice(0, 80)}”`} data-quote-message={entry.question.id}>
                <DiscussionAnswer answer={entry.answer} onShow={onShow} />
              </div>
            ) : (
              <PendingLine questionId={entry.question.id} pending={status === 'sending' || status === 'streaming' || status === 'sent'} />
            )}
          </details>
        );
      })}
      {(error ?? problem) !== null && <p className="rv-error">{error ?? problem}</p>}
      <div className="rv-check-ask">
        <textarea
          data-ev="check-question-text"
          rows={2}
          value={text}
          placeholder={lang === 'sv' ? 'Fråga om den här punkten…' : 'Ask about this point…'}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          data-ev="check-ask"
          disabled={waiting || text.trim() === ''}
          onClick={() => {
            void onAsk(text.trim()).then((failure) => {
              setProblem(failure);
              if (failure === null) {
                setText('');
              }
            });
          }}
        >
          {lang === 'sv' ? 'Fråga' : 'Ask'}
        </button>
      </div>
    </section>
  );
}

function Collapsible({
  title,
  defaultOpen,
  children,
  ev,
}: {
  readonly title: string;
  readonly defaultOpen: boolean;
  readonly children: ReactNode;
  readonly ev?: string;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rv-collapsible">
      <button type="button" className="rv-collapsible-head" aria-expanded={open} {...(ev === undefined ? {} : { 'data-ev': ev })} onClick={() => setOpen(!open)}>
        <span className="rv-chevron">{open ? '▾' : '▸'}</span> {title}
      </button>
      {open && <div className="rv-collapsible-body">{children}</div>}
    </section>
  );
}

// --- Header -----------------------------------------------------------------------

function Header({
  bundle,
  history,
  words,
  lang,
  onLang,
  langError,
  save,
  saving,
  coverage,
  onChoose,
  pairWalks,
  onOpenWalk,
  onDiscussion,
  discussionShown,
}: {
  /** Show the review's panel, Step and Discussion (30 October 2026). */
  readonly onDiscussion: () => void;
  readonly discussionShown: boolean;
  readonly bundle: ReviewBundle;
  readonly history: number;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onLang: (lang: Lang) => void;
  readonly langError: string | null;
  readonly save: { at: string; error?: string } | null;
  readonly saving: boolean;
  readonly coverage: CoverageSummary;
  /** The file chooser, for a walk window not tied to a review's pair; `null` over a pair. */
  readonly onChoose: (() => void) | null;
  /** The walk definitions over the same pair, when there are several to choose between. */
  readonly pairWalks: readonly PairWalk[];
  readonly onOpenWalk: (definitionPath: string) => void;
}): JSX.Element {
  // No Details panel (Niclas's decision of 30 October 2026): the identity above says what the
  // review is about; hashes, paths and how the walks were made stay in the record.
  void history;
  return (
    <header className="rv-header">
      <div className="rv-header-title">
        <h1>
          <Inline text={pick(bundle.definition.title, lang)} />
        </h1>
        {/* Which repository and revisions, always in view: a review window left open
            while the chat moves on still says what it is about. */}
        <span className="rv-identity" data-ev="review-identity" title={`${bundle.repository}\n${bundle.base.sha} → ${bundle.target.sha}`}>
          {reviewIdentityLabel(bundle.repository, bundle.base.sha, bundle.target.sha)}
        </span>
      </div>
      <div className="rv-header-side">
        {pairWalks.length > 1 && (
          <label className="rv-lang">
            {words.preparedWalks}{' '}
            <select
              data-ev="walk-definition"
              value={pairWalks.find((walk) => walk.definitionPath.toLowerCase() === bundle.definitionPath.toLowerCase())?.definitionPath ?? ''}
              onChange={(event) => onOpenWalk(event.target.value)}
            >
              {pairWalks.map((walk) => (
                <option key={walk.definitionPath} value={walk.definitionPath}>
                  {walk.note === '' ? walk.title : `${walk.title} · ${walk.note}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {coverage.openFindings > 0 && <span className="rv-findings">{words.openFindings(coverage.openFindings)}</span>}
        <span className={save?.error !== undefined ? 'rv-error rv-save' : 'rv-sub rv-save'} role="status">
          {save?.error !== undefined ? words.notSaved(save.error) : saving ? words.saving : save === null ? '' : words.saved}
        </span>
        <label className="rv-lang">
          {words.language}{' '}
          <select data-ev="review-language" value={lang} onChange={(event) => onLang(event.target.value as Lang)}>
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </label>
        {/* Hidden or not open yet, it says so: this is the way back to what was discussed. */}
        <button
          type="button"
          className={discussionShown ? undefined : 'rv-show-discussion'}
          data-ev="walk-discussion"
          title="The review's discussion: Step and Discussion"
          onClick={onDiscussion}
        >
          {discussionShown ? 'Discussion' : 'Show discussion'}
        </button>
        {onChoose !== null && (
          <button type="button" onClick={onChoose}>
            {words.openAnother}
          </button>
        )}
      </div>
      {langError !== null && <div className="rv-error rv-full">{words.notSaved(langError)}</div>}
    </header>
  );
}

// --- Left column ----------------------------------------------------------------------

function WalkList({
  bundle,
  state,
  words,
  lang,
  onStep,
  onToggle,
}: {
  readonly bundle: ReviewBundle;
  readonly state: ReviewState;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onStep: (stepId: string) => void;
  readonly onToggle: (walkId: string) => void;
}): JSX.Element {
  const open = new Set(state.ui.openWalks);
  return (
    <div className="rv-walks">
      {bundle.definition.walks.map((walk) => {
        const isOpen = open.has(walk.id);
        const opened = walk.steps.filter((step) => state.shownSteps[step.id] !== undefined).length;
        const containsCurrent = walk.steps.some((step) => step.id === state.position.stepId);
        return (
          <section key={walk.id} className={containsCurrent ? 'rv-walk rv-walk-current' : 'rv-walk'}>
            <button type="button" className="rv-walk-head" aria-expanded={isOpen} data-ev={`walk-head-${walk.id}`} onClick={() => onToggle(walk.id)}>
              <span className="rv-chevron">{isOpen ? '▾' : '▸'}</span>
              <span className="rv-walk-name">
                <Inline text={pick(walk.title, lang)} />
              </span>
              <span className="rv-walk-meta">
                <span className="rv-step-id">{walk.id}</span>
                {walk.kind === 'reading' && <span className="rv-kind-tag">{words.readingTag}</span>}
                <span className="rv-sub rv-walk-count">{words.walkProgress(opened, walk.steps.length)}</span>
              </span>
            </button>
            {pick(walk.purpose, lang) !== '' && (
              <p className={isOpen ? 'rv-walk-purpose' : 'rv-walk-purpose rv-walk-purpose-short'} title={pick(walk.purpose, lang).replace(/`/g, '')}>
                <Inline text={pick(walk.purpose, lang)} />
              </p>
            )}
            {isOpen && (
              <ol className="rv-steps">
                {walk.steps.map((step) => {
                  const active = state.position.stepId === step.id;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        className={active ? 'rv-step rv-step-on' : 'rv-step'}
                        aria-current={active ? 'step' : undefined}
                        data-ev={`walk-step-${step.id}`}
                        onClick={() => onStep(step.id)}
                      >
                        <span className="rv-step-id">{step.id}</span>
                        <span className="rv-step-title">
                          <Inline text={pick(step.title, lang)} />
                        </span>
                        {state.walkedSteps[step.id] !== undefined && <span className="rv-mark-walked">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function planWord(state: PlanState, words: ReviewWords): string {
  return state === 'full' ? words.coverage.yes : state === 'partial' ? words.coverage.part : words.coverage.no;
}

function decisionWord(decision: ReviewDecision | null, words: ReviewWords): string {
  if (decision === null || decision.outcome === 'withdrawn') {
    return words.decisions.remaining;
  }
  return decision.outcome === 'accepted' ? words.decisions.accepted : words.decisions.exempted;
}

function CoverageTable({
  coverage,
  words,
  onOpen,
}: {
  readonly coverage: CoverageSummary;
  readonly words: ReviewWords;
  readonly onOpen: (hunk: DiffHunk) => void;
}): JSX.Element {
  const [onlyOutside, setOnlyOutside] = useState(false);
  const outside = coverage.hunks.filter((entry) => entry.planned === 'none');
  const rows = onlyOutside ? outside : coverage.hunks;
  const c = words.coverage;
  const linesWithPartial = (value: { full: number; partialHunks: number }): string =>
    `${c.lines(value.full)}${value.partialHunks > 0 ? c.partly(value.partialHunks) : ''}`;
  return (
    <div className="rv-coverage">
      <p className="rv-legend">{c.intro(coverage.totalLines)}</p>
      <table className="rv-totals">
        <tbody>
          <tr><th>{c.planned}</th><td>{linesWithPartial(coverage.plannedLines)}</td></tr>
          <tr><th>{c.opened}</th><td>{linesWithPartial(coverage.shownLines)}</td></tr>
          <tr><th>{c.walked}</th><td>{linesWithPartial(coverage.walkedLines)}</td></tr>
          <tr><th>{c.accepted}</th><td>{c.lines(coverage.acceptedLines)}</td></tr>
          <tr><th>{c.exempted}</th><td>{c.lines(coverage.exemptedLines)}</td></tr>
          <tr><th>{c.remaining}</th><td>{c.lines(coverage.remainingLines)}</td></tr>
          <tr><th>{c.agent}</th><td>{c.agentNone}</td></tr>
          <tr><th>{c.open}</th><td>{coverage.openFindings} / {coverage.openQuestions}</td></tr>
        </tbody>
      </table>
      <label className="rv-check">
        <input type="checkbox" checked={onlyOutside} onChange={(event) => setOnlyOutside(event.target.checked)} />{' '}
        {c.onlyOutside(outside.length)}
      </label>
      <table className="rv-hunks">
        <thead>
          <tr>
            <th>{c.change}</th>
            <th>±</th>
            <th>{c.planned}</th>
            <th>{c.opened}</th>
            <th>{c.walked}</th>
            <th>{c.remaining}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.hunk.id} className="rv-hunk-row" onClick={() => onOpen(entry.hunk)}>
              <td>
                <span className="rv-path">{fileName(entry.hunk.path)}</span>{' '}
                <span className="rv-sub">
                  {entry.hunk.targetCount > 0
                    ? rangeText({ start: entry.hunk.targetStart, end: entry.hunk.targetStart + entry.hunk.targetCount - 1 })
                    : `−${String(entry.hunk.baseStart)}`}
                </span>
              </td>
              <td>{entry.lines}</td>
              <td title={entry.plannedBy.join(', ')}>
                {planWord(entry.planned, words)}
                {entry.plannedBy.length > 0 ? ` (${entry.plannedBy.join(', ')})` : ''}
              </td>
              <td>{planWord(entry.shown, words)}</td>
              <td>{planWord(entry.walked, words)}</td>
              <td>
                {decisionWord(entry.decision, words)}
                {entry.openFindings > 0 ? ` · ${words.openFindings(entry.openFindings)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesList({
  state,
  bundle,
  words,
  lang,
  onOpen,
  onStatus,
}: {
  readonly state: ReviewState;
  readonly bundle: ReviewBundle;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onOpen: (location: CodeLocation) => void;
  readonly onStatus: (id: string, status: 'open' | 'resolved', resolution: string) => void;
}): JSX.Element {
  const hunkById = new Map(bundle.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)));
  return (
    <div className="rv-notes">
      <h2>{words.notesTab.notesTitle}</h2>
      {state.notes.length === 0 && <p className="rv-sub">{words.notesTab.none}</p>}
      {state.notes.map((note) => (
        <NoteItem key={note.id} note={note} words={words} lang={lang} onOpen={onOpen} onStatus={onStatus} />
      ))}
      <h2>{words.notesTab.historyTitle}</h2>
      {state.decisions.length === 0 && <p className="rv-sub">{words.notesTab.noDecisions}</p>}
      <ol className="rv-history">
        {state.decisions.map((decision) => {
          const scope =
            decision.scope.kind === 'hunk'
              ? (() => {
                  const hunk = hunkById.get(decision.scope.hunkId);
                  return hunk === undefined ? decision.scope.path : hunkWhere(hunk, words);
                })()
              : decision.scope.path;
          return (
            <li key={decision.id}>
              <strong>
                {decision.outcome === 'withdrawn'
                  ? words.decisions.withdraw
                  : decision.outcome === 'accepted'
                    ? words.decisions.accepted
                    : words.decisions.exempted}
              </strong>{' '}
              · {scope} · {timeOf(decision.at, lang)}
              {decision.reason !== '' && <div className="rv-sub">{decision.reason}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NoteItem({
  note,
  words,
  lang,
  onOpen,
  onStatus,
}: {
  readonly note: ReviewNote;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onOpen: (location: CodeLocation) => void;
  readonly onStatus: (id: string, status: 'open' | 'resolved', resolution: string) => void;
}): JSX.Element {
  const [resolution, setResolution] = useState(note.resolution);
  return (
    <div className={`rv-note rv-note-${note.kind} rv-note-${note.status}`}>
      <div>
        <strong>{note.kind === 'finding' ? words.note.finding : words.note.question}</strong> ·{' '}
        {note.status === 'open' ? words.note.open : words.note.resolved}
        <span className="rv-sub">
          {' '}
          · {timeOf(note.createdAt, lang)}
          {note.stepId !== null ? ` · ${words.note.duringStep(note.stepId)}` : ''}
        </span>
      </div>
      <div className="rv-note-text">{note.text}</div>
      {note.location !== null && (
        <button
          type="button"
          className="rv-link"
          onClick={() => {
            if (note.location !== null) {
              onOpen(note.location);
            }
          }}
        >
          {fileName(note.location.path)}:{rangeText(note.location)}
        </button>
      )}
      <div className="rv-note-actions">
        <input value={resolution} placeholder={words.note.resolution} onChange={(event) => setResolution(event.target.value)} />
        <button type="button" onClick={() => onStatus(note.id, note.status === 'open' ? 'resolved' : 'open', resolution)}>
          {note.status === 'open' ? words.note.markResolved : words.note.reopen}
        </button>
      </div>
    </div>
  );
}

function Browse({
  bridge,
  words,
  onOpen,
}: {
  readonly bridge: ReviewBridge;
  readonly words: ReviewWords;
  readonly onOpen: (location: CodeLocation) => void;
}): JSX.Element {
  const [side, setSide] = useState<RevisionSide>('target');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ hits: readonly ReviewSearchHit[]; truncated: boolean; error?: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState<readonly string[]>([]);
  useEffect(() => {
    void bridge.listFiles(side).then(setAll);
  }, [bridge, side]);
  const filtered = filter.trim() === '' ? [] : all.filter((entry) => entry.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  return (
    <div className="rv-browse">
      <div className="rv-side-choice">
        {words.search.revision}:{' '}
        {(['target', 'base'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              checked={side === value}
              onChange={() => {
                setSide(value);
                setResult(null);
              }}
            />{' '}
            {words.side[value]}
          </label>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void bridge.search(side, query).then(setResult);
        }}
      >
        <input value={query} placeholder={words.search.placeholder} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">{words.search.button}</button>
      </form>
      {result !== null && (
        <div className="rv-hits">
          {result.error !== undefined && <p className="rv-error">{result.error}</p>}
          <p className="rv-sub">{words.search.hits(result.hits.length, result.truncated)}</p>
          <ul>
            {result.hits.map((hit) => (
              <li key={`${hit.path}:${String(hit.line)}`}>
                <button type="button" className="rv-link" onClick={() => onOpen({ path: hit.path, side, start: hit.line, end: hit.line })}>
                  {hit.path}:{hit.line}
                </button>
                <code className="rv-hit-text">{hit.text.trim()}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <input value={filter} placeholder={words.search.filter(all.length, words.side[side])} onChange={(event) => setFilter(event.target.value)} />
      <ul className="rv-all-files">
        {filtered.map((entry) => (
          <li key={entry}>
            <button type="button" className="rv-link" onClick={() => onOpen({ path: entry, side, start: 1, end: 1 })}>
              {entry}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Right column ---------------------------------------------------------------------

/** The question a deepening of a point worth checking asks, or one away from the walk, in the review's language. */
function deepenQuestion(request: DeepenRequest, lang: Lang, check = false): string {
  if (check) {
    if (lang === 'sv') {
      return request.action === 'more'
        ? 'Berätta mer om den här punkten att granska: vad koden faktiskt gör här, och vad som avgör om det är ett problem.'
        : request.action === 'simpler'
          ? 'Förklara den här punkten enklare: färre begrepp på en gång och enklare ord, med samma namn och förbehåll; lägg inte till detaljer som inte behövs.'
          : `Förklara detta i sammanhanget av den här punkten: "${request.text ?? ''}"`;
    }
    return request.action === 'more'
      ? 'Tell me more about this point worth checking: what the code actually does here, and what decides whether it is a problem.'
      : request.action === 'simpler'
        ? 'Explain this point more simply: fewer concepts at once and plainer words, with the same names and caveats; add no detail that is not needed.'
        : `Explain this, in the context of this point: "${request.text ?? ''}"`;
  }
  if (lang === 'sv') {
    return request.action === 'more'
      ? 'Berätta mer om det här: mekanismen, hur koden hänger ihop och de detaljer som spelar roll.'
      : request.action === 'simpler'
        ? 'Förklara det här enklare.'
        : `Förklara detta: "${request.text ?? ''}"`;
  }
  return request.action === 'more'
    ? 'Tell me more about this: the mechanism, how the code connects, and the details that matter.'
    : request.action === 'simpler'
      ? 'Explain this more simply.'
      : `Explain this: "${request.text ?? ''}"`;
}

/** An exchange of the discussion: a question and its answer. */
interface Deepening {
  readonly question: DiscussionMessage;
  readonly answer: DiscussionMessage | null;
}

/**
 * DSP-184: the step's explanation in the profile chosen, from the step explanations' own store:
 * its history, what is shown, and what can be asked. Nothing here is a discussion entry.
 */
interface StepExplanationView {
  readonly profile: PublicProfile;
  /** The profile the walk's own explanations were written in; `null` for an older walk (Original). */
  readonly walkProfile: PresentationProfile | null;
  readonly history: ExplanationHistory;
  /** `WALK_TEXT` or an entry id. */
  readonly shown: string;
  readonly busy: { readonly entryId: string; readonly activity?: string } | null;
  readonly error: string | null;
  readonly onChoose: (profile: PublicProfile) => void;
  readonly onNavigate: (item: string) => void;
  readonly onPresent: () => void;
  readonly onMore: () => void;
  readonly onSimpler: () => void;
  readonly onExplainThis: (text: string) => void;
  readonly onRetry: () => void;
  readonly onStop: () => void;
  readonly onContinue: () => void;
}

/** A stored explanation, as the one answer component renders it (references in one place, for DSP-185). */
function asAnswer(entry: StepExplanation): DiscussionMessage {
  return {
    id: entry.id,
    role: 'answer',
    text: entry.text,
    at: entry.finishedAt ?? entry.at,
    subject: '',
    status: entry.status === 'sending' ? 'streaming' : entry.status,
    ...(entry.references === undefined ? {} : { references: entry.references }),
    ...(entry.contextReferences === undefined ? {} : { contextReferences: entry.contextReferences }),
    ...(entry.insufficient === true ? { insufficient: true } : {}),
  };
}

/** What an entry in the history is, in the window's words. */
function itemLabel(view: StepExplanationView, item: string, words: ReviewWords): string {
  const name = words.profiles.name[view.profile];
  if (item === WALK_TEXT) {
    const own = view.walkProfile !== null && isPublicProfile(view.walkProfile) ? words.profiles.name[view.walkProfile] : words.profiles.legacyName;
    return words.profiles.walkText(own);
  }
  const entry = view.history.entries.get(item);
  return entry === undefined ? name : words.profiles.action[entry.action](name);
}

/**
 * The step explanation's own bar (DSP-184): the profile chooser, labelled as the explanation's,
 * with a plain tooltip per option; where the shown explanation is in its history, with Back and
 * Forward; and what is happening to an explanation on its way or one that failed. The same in
 * every profile.
 */
function ExplanationBar({ view, stepId, words }: { readonly view: StepExplanationView; readonly stepId: string; readonly words: ReviewWords }): JSX.Element {
  const items = view.history.items;
  const at = Math.max(0, items.indexOf(view.shown));
  const name = words.profiles.name[view.profile];
  const pending = view.history.pending;
  const failed = view.history.failed;
  const state = pending !== null ? 'pending' : failed !== null ? 'failed' : view.error !== null ? 'refused' : view.history.hasDone ? 'done' : view.walkProfile === view.profile ? 'own' : 'none';
  const shownEntry = view.history.entries.get(view.shown);
  return (
    <div className="rv-explanation-bar" data-ev="explanation-bar" data-state={state} data-profile={view.profile} data-step={stepId} data-shown={view.shown}>
      <div className="rv-explanation-bar-row">
        <label className="rv-profile-choice" title={words.profiles.description[view.profile]}>
          <span className="rv-section-title">{words.profiles.label}</span>{' '}
          <select data-ev="presentation-profile" value={view.profile} onChange={(event) => view.onChoose(isPublicProfile(event.currentTarget.value) ? event.currentTarget.value : view.profile)}>
            {PUBLIC_PROFILES.map((id) => (
              <option key={id} value={id} title={words.profiles.description[id]}>
                {words.profiles.name[id]}
              </option>
            ))}
          </select>
        </label>
        {items.length > 1 && (
          <span className="rv-explanation-history" role="group" aria-label={words.profiles.history}>
            <button type="button" className="rv-quiet" data-ev="explanation-back" disabled={at === 0} title={words.profiles.back} onClick={() => view.onNavigate(items[at - 1] ?? WALK_TEXT)}>
              ← {words.profiles.back}
            </button>
            <span className="rv-sub" data-ev="explanation-position">
              {words.profiles.position(at + 1, items.length)}
            </span>
            <button
              type="button"
              className="rv-quiet"
              data-ev="explanation-forward"
              disabled={at >= items.length - 1}
              title={words.profiles.forward}
              onClick={() => view.onNavigate(items[at + 1] ?? view.shown)}
            >
              {words.profiles.forward} →
            </button>
          </span>
        )}
      </div>
      <div className="rv-profile-line rv-sub" data-ev="profile-status" data-state={state} data-profile={view.profile} data-step={stepId} {...(shownEntry === undefined ? {} : { 'data-version': String(shownEntry.instructionVersion) })}>
        <span data-ev="explanation-shown">{itemLabel(view, view.shown, words)}</span>
        {state === 'pending' && pending !== null && (
          <span role="status">
            {' · '}
            <span className="rv-profile-spinner" aria-hidden="true" /> {view.busy?.entryId === pending.id && view.busy.activity !== undefined ? view.busy.activity : words.profiles.writing(name)}{' '}
            <button type="button" className="rv-link" data-ev="explanation-stop" onClick={view.onStop}>
              {words.discussion.stop}
            </button>
          </span>
        )}
        {state === 'failed' && failed !== null && (
          <span role="status" className="rv-profile-failed">
            {' · '}
            {words.profiles.failed(words.profiles.action[failed.action](name), failed.error ?? failed.status)}{' '}
            <button type="button" className="rv-link" data-ev="profile-retry" onClick={view.onRetry}>
              {words.profiles.tryAgain}
            </button>
          </span>
        )}
        {state === 'refused' && <span className="rv-error"> · {view.error}</span>}
        {state === 'none' && (
          <>
            {' · '}
            <button type="button" className="rv-link" data-ev="profile-present" onClick={view.onPresent}>
              {words.profiles.explainAs(name)}
            </button>
          </>
        )}
        {(state === 'own' || state === 'done') && (
          <>
            {' · '}
            <button type="button" className="rv-link" data-ev="profile-regenerate" onClick={view.onPresent}>
              {words.profiles.regenerate(name)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The deepening actions of the step's explanation, in the profile chosen; their results are in the history. */
function ExplanationActions({ view, selectedText, words }: { readonly view: StepExplanationView; readonly selectedText: string; readonly words: ReviewWords }): JSX.Element {
  const waiting = view.history.pending !== null;
  return (
    <div className="rv-deepen">
      <div className="rv-deepen-actions">
        <button type="button" data-ev="step-tell-more" disabled={waiting} onClick={view.onMore}>
          {words.profiles.more}
        </button>
        <button type="button" data-ev="step-explain-simpler" disabled={waiting} onClick={view.onSimpler}>
          {words.profiles.simpler}
        </button>
        <button
          type="button"
          data-ev="step-explain-this"
          disabled={waiting || selectedText.trim() === ''}
          title={selectedText.trim() === '' ? words.profiles.selectFirst : `${words.profiles.explainThis}: "${selectedText.slice(0, 80)}"`}
          onClick={() => view.onExplainThis(selectedText.trim())}
        >
          {words.profiles.explainThis}
        </button>
        <button type="button" className="rv-quiet" data-ev="step-continue-discussion" title={words.profiles.askAboutHint} onClick={view.onContinue}>
          {words.profiles.askAbout}
        </button>
      </div>
    </div>
  );
}

const DEEPEN_WORD: Record<DeepenRequest['action'], string> = { more: 'Tell me more', simpler: 'Explain more simply', explain: 'Explain this', present: 'The step explained' };

/** Everything asked from a point worth checking, deepenings and the person's own questions, with answers. */
function pointExchanges(messages: readonly DiscussionMessage[], checkId: string): readonly Deepening[] {
  return messages
    .filter((message) => {
      const subject = message.envelope?.subject;
      return message.role === 'question' && subject?.kind === 'point' && subject.checkId === checkId;
    })
    .map((question) => ({ question, answer: messages.find((message) => message.role === 'answer' && message.questionId === question.id) ?? null }));
}

/**
 * DSP-152: a question about this step that the agent answers by looking into the code of
 * the two revisions with its read-only tools (the analysis path), not in the tool-free
 * discussion. Answers stay under the step, folded, with the code they rest on; what the
 * agent read is under Details. One question at a time for the change.
 */
function StepCodeQuestion({
  pairKey,
  bridge,
  jobs,
  onShow,
}: {
  readonly pairKey: string;
  readonly bridge: ReviewPairBridge;
  readonly jobs: readonly AgentJob[];
  readonly onShow: (range: LineRange) => void;
}): JSX.Element | null {
  const running = jobs.find(isRunning);
  if (jobs.length === 0) {
    return null;
  }
  const finished = jobs.filter((job) => !isRunning(job));
  const where = (range: LineRange): string =>
    `${range.path} ${range.start === range.end ? `line ${String(range.start)}` : `lines ${String(range.start)}–${String(range.end)}`} (${range.side === 'base' ? 'From' : 'To'})`;
  return (
    <div className="rv-code-question">
      {finished.map((job, index) => (
        <details key={job.id} className="rv-deepening" open={index === finished.length - 1} data-ev="step-investigation" data-state={job.state}>
          <summary>
            Looked into the code
            <span className="rv-sub"> · “{(job.question?.question ?? '').slice(0, 60)}”</span>
            {job.state !== 'done' && <span className="rv-sub"> · {job.state}</span>}
          </summary>
          {job.state === 'done' && job.answer !== undefined ? (
            <>
              {job.answer.insufficient && <p className="rv-agent-insufficient">The agent could not settle this from the code it could read.</p>}
              <ShortThenMore
                short={job.answer.answer}
                details={job.answer.details}
                rests={
                  job.answer.references.length === 0 ? undefined : (
                    <ul>
                      {job.answer.references.map((reference, at) => (
                        <li key={at}>
                          <button type="button" className="rv-pair-link" data-ev="step-investigation-ref" onClick={() => onShow(reference.range)}>
                            {reference.label}
                          </button>{' '}
                          <span className="rv-sub">{where(reference.range)}</span>
                        </li>
                      ))}
                    </ul>
                  )
                }
              />
              {job.answer.adjustments.length > 0 && (
                <details className="rv-agent-adjustments">
                  <summary>What DSpatch did not accept from the answer</summary>
                  <ul>
                    {job.answer.adjustments.map((entry, at) => (
                      <li key={at}>{entry}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>
              <span className="rv-agent-attempt">{attemptLabel(job)}</span> <JobNote job={job} />
            </p>
          )}
        </details>
      ))}
      {running !== undefined && <JobLine job={running} onStop={() => void bridge.cancelJob(pairKey, running.id)} />}
    </div>
  );
}

function StepPanel({
  walk,
  step,
  index,
  stops,
  placeIndex,
  stopIndex,
  referenceProblems,
  state,
  words,
  lang,
  onPlace,
  onOpenEvidence,
  codeQuestion,
  quoteText,
  explanation,
}: {
  /** DSP-184: the step's explanation in the profile chosen, from its own store, and what can be asked. */
  readonly explanation: StepExplanationView;
  /** DSP-152: asking the agent to look into the code for this step, when the walk is over a revision pair. */
  readonly codeQuestion?: () => JSX.Element;
  readonly walk: Walk;
  readonly step: WalkStep;
  readonly index: number;
  readonly stops: readonly StepStop[];
  readonly placeIndex: number;
  readonly stopIndex: number;
  readonly referenceProblems: ReviewBundle['referenceProblems'];
  readonly state: ReviewState;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onPlace: (index: number) => void;
  readonly onOpenEvidence: (location: CodeLocation) => void;
  /** What is selected to ask about in the window, if anything: Explain this explains it. */
  readonly quoteText: string;
}): JSX.Element {
  const [sources, setSources] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const panel = useRef<HTMLElement | null>(null);
  const active = stopIndex;
  const activePlace = step.places[placeIndex] ?? null;
  // DSP-184: what the history shows: the walk's own text, or a stored explanation of this profile.
  const generated = explanation.shown === WALK_TEXT ? null : (explanation.history.entries.get(explanation.shown) ?? null);
  const purpose = pick(walk.purpose, lang);
  // The walk's introduction, short: its first sentence, the rest on request.
  const firstSentence = /^[\s\S]*?[.!?](\s|$)/.exec(purpose)?.[0]?.trim() ?? purpose;
  const invalid = new Set(
    referenceProblems.filter((problem) => problem.stepId === step.id).map((problem) => problem.refId.replace(/\.(unit|from)$/, '')),
  );
  const summaryLabels = [...new Set(step.evidence.map((entry) => entry.label))];
  const origin = `the explanation of step ${step.id} “${pick(step.title, lang)}”`;
  /*
   * DSP-184: one component order for every profile: the step's title; the explanation's bar
   * (profile, history, status); the step's places with their navigation, kept in view while a
   * long explanation scrolls; the explanation; its deepening actions. Before, the walk's own text
   * put its summary above the places and its body below them, so a walk written in Standard read
   * in another order than an Essentials or Teacher explanation, which came whole above the places.
   */
  return (
    <section className="rv-step-panel" ref={panel} data-quote-step={step.id} data-ev="step-panel">
      <div className="rv-walk-title">
        {walk.id} · <Inline text={pick(walk.title, lang)} />
      </div>
      {purpose !== '' && (
        <div className="rv-purpose">
          <Inline text={introOpen || firstSentence === purpose ? purpose : firstSentence} />
          {firstSentence !== purpose && (
            <button type="button" className="rv-quiet rv-more" aria-expanded={introOpen} onClick={() => setIntroOpen(!introOpen)}>
              {introOpen ? 'Less' : 'More'}
            </button>
          )}
        </div>
      )}
      <h2>
        <span className="rv-step-id">{step.id}</span> <Inline text={pick(step.title, lang)} />
      </h2>
      <div className="rv-sub">
        {words.stepOf(index + 1, walk.steps.length)}
        {state.walkedSteps[step.id] !== undefined && <span className="rv-mark-walked"> ✓</span>}
      </div>
      <ExplanationBar view={explanation} stepId={step.id} words={words} />

      {stops.length > 1 && (
        <div className="rv-places" data-ev="step-places">
          <div className="rv-section-title">{words.places}</div>
          <ol>
            {stops.map((entry, position) => (
              <li key={`${step.id}-stop-${String(position + 1)}`}>
                <button
                  type="button"
                  className={position === active ? 'rv-place rv-place-on' : 'rv-place'}
                  aria-current={position === active ? 'location' : undefined}
                  onClick={() => onPlace(position)}
                >
                  <span className="rv-place-number">{position + 1}</span>
                  <Markdown text={stopLabel(step, entry, lang)} />
                  <span className="rv-sub rv-place-where" data-ev={`place-where-${String(position + 1)}`}>
                    {entry.placeIndexes
                      .map((place) => step.places[place])
                      .filter((place): place is Place => place !== undefined)
                      .map((place) => `${place.focus.side === 'base' ? words.view.shownFrom : words.view.shownTo} · ${place.focus.path.split('/').pop()}:${rangeText(place.focus)}`)
                      .join(' · ')}
                  </span>
                  {entry.placeIndexes
                    .map((place) => step.places[place])
                    .filter((place): place is Place => place !== undefined)
                    .some((place) => invalid.has(place.focus.id)) && <span className="rv-error"> ⚠</span>}
                </button>
              </li>
            ))}
          </ol>
          {activePlace?.from !== null && activePlace?.from !== undefined && (
            <div className="rv-place-from">
              ← <Inline text={pick(activePlace.from?.label ?? { sv: '', en: '' }, lang)} />
            </div>
          )}
        </div>
      )}
      {stops.length > 1 && (
        // Kept in view while a long explanation scrolls (DSP-184).
        <div className="rv-place-nav rv-place-nav-sticky" data-ev="step-place-nav">
          <button type="button" disabled={active === 0} onClick={() => onPlace(active - 1)}>
            ↑ {words.previousPlace}
          </button>
          <span className="rv-sub">{words.placeOf(active + 1, stops.length)}</span>
          <button type="button" disabled={active === stops.length - 1} onClick={() => onPlace(active + 1)}>
            ↓ {words.nextPlace}
          </button>
        </div>
      )}

      {/* What the step says about the place in view: it changes with the place. */}
      {activePlace?.focus.note !== undefined && (
        <div className="rv-place-note" aria-live="polite">
          <Markdown text={pick(activePlace.focus.note ?? { sv: '', en: '' }, lang)} />
        </div>
      )}

      {generated !== null ? (
        <div
          className="rv-profile-explanation rv-explanation rv-reading"
          data-ev="profile-explanation"
          data-profile={explanation.profile}
          data-action={generated.action}
          data-entry={generated.id}
          data-step={step.id}
          data-quote-origin={`the ${words.profiles.name[explanation.profile]} explanation of step ${step.id} “${pick(step.title, lang)}”`}
          data-quote-step={step.id}
        >
          {generated.selection !== undefined && <p className="rv-sub">“{generated.selection.slice(0, 120)}”</p>}
          <DiscussionAnswer answer={asAnswer(generated)} onShow={onOpenEvidence} />
        </div>
      ) : (
        <div className="rv-walk-explanation" data-ev="step-prepared-explanation">
          {pick(step.summary, lang) !== '' && (
            <p className="rv-summary" data-quote-source="explanation" data-quote-origin={origin}>
              <Inline text={pick(step.summary, lang)} />
            </p>
          )}
          <div className="rv-explanation rv-reading rv-prepared" data-quote-source="explanation" data-quote-origin={origin}>
            {/* DSP-181: a walk prepared in a profile may carry a deepening, read behind Show more as an answer's is. */}
            {step.details !== undefined && pick(step.details, lang) !== '' ? (
              <ShortThenMore short={pick(step.body, lang)} details={pick(step.details, lang)} />
            ) : (
              <Markdown text={pick(step.body, lang)} />
            )}
          </div>
          {pick(step.why, lang) !== '' && (
            <>
              <div className="rv-section-title">{words.whyItMatters}</div>
              <div className="rv-explanation rv-reading rv-prepared" data-quote-source="explanation" data-quote-origin={origin}>
                <Markdown text={pick(step.why, lang)} />
              </div>
            </>
          )}
        </div>
      )}
      {/* DSP-175: code from other repositories of the workspace, read as context; never covered. */}
      <WalkContextPlaces step={step} lang={lang} />

      <ExplanationActions view={explanation} selectedText={quoteText} words={words} />
      {codeQuestion?.()}

      {step.evidence.length > 0 && (
        <div className="rv-evidence">
          <div className="rv-section-title">{words.howDoWeKnow}</div>
          <ul className="rv-evidence-summary">
            {summaryLabels.map((label) => (
              <li key={label} className={`rv-evidence-${label}`}>
                <strong>{words.evidenceLabel[label]}.</strong> {words.evidenceMeaning[label]}
              </li>
            ))}
          </ul>
          <button type="button" className="rv-quiet" aria-expanded={sources} onClick={() => setSources(!sources)}>
            {sources ? words.hideSources : words.showSources}
          </button>
          {sources && (
            <ul className="rv-evidence-detail">
              {step.evidence.map((entry) => (
                <li key={entry.text.en}>
                  <span className="rv-sub">{words.evidenceLabel[entry.label]}:</span> <Markdown text={pick(entry.text, lang)} />
                </li>
              ))}
              {step.evidenceRefs.map((ref) => (
                <li key={ref.id}>
                  <button type="button" className="rv-link" onClick={() => onOpenEvidence(asLocation(ref))}>
                    {ref.path}:{rangeText(ref)}
                  </button>
                  {ref.note !== undefined && <span className="rv-sub"> – {pick(ref.note, lang)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}


    </section>
  );
}

/** Decisions for the changes the shown code touches, each with its exact scope. */
function HunkDecisions({
  focus,
  diffFile,
  files,
  coverage,
  decisions,
  onDecide,
  revisionText,
  words,
}: {
  readonly focus: CodeLocation | null;
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly coverage: ReadonlyMap<string, HunkCoverage>;
  readonly decisions: readonly ReviewDecision[];
  readonly onDecide: (decision: Omit<ReviewDecision, 'id' | 'at' | 'by' | 'revisions'>) => void;
  readonly revisionText: string;
  readonly words: ReviewWords;
}): JSX.Element {
  const rows = useRows(files, focus?.path ?? '', diffFile, focus?.side ?? 'target');
  const current = useMemo(() => currentHunkDecisions(decisions), [decisions]);
  const hunks = useMemo(() => {
    if (focus === null || diffFile === null || rows === null) {
      return [];
    }
    const ids = new Set(
      referenceRows(rows.rows, focus)
        .indexes.map((index) => rows.rows[index]?.hunkId)
        .filter((id): id is string => id !== null && id !== undefined),
    );
    return diffFile.hunks.filter((hunk) => ids.has(hunk.id));
  }, [focus, diffFile, rows]);
  if (hunks.length === 0) {
    return <p className="rv-sub">{words.decisions.noChangesHere}</p>;
  }
  return (
    <div className="rv-decisions">
      <div className="rv-section-title">{words.decisions.changesHere}</div>
      {hunks.map((hunk) => (
        <HunkDecision
          key={hunk.id}
          hunk={hunk}
          entry={coverage.get(hunk.id) ?? null}
          decision={current.get(hunk.id) ?? null}
          onDecide={onDecide}
          revisionText={revisionText}
          words={words}
        />
      ))}
    </div>
  );
}

function HunkDecision({
  hunk,
  entry,
  decision,
  onDecide,
  revisionText,
  words,
}: {
  readonly hunk: DiffHunk;
  readonly entry: HunkCoverage | null;
  readonly decision: ReviewDecision | null;
  readonly onDecide: (decision: Omit<ReviewDecision, 'id' | 'at' | 'by' | 'revisions'>) => void;
  readonly revisionText: string;
  readonly words: ReviewWords;
}): JSX.Element {
  const [asking, setAsking] = useState<'accepted' | 'exempted' | null>(null);
  const [reason, setReason] = useState('');
  const where = hunkWhere(hunk, words);
  return (
    <div className="rv-decision">
      <div>
        {capitalise(where)} — <strong className={decision === null ? '' : `rv-decision-${decision.outcome}`}>{decisionWord(decision, words)}</strong>
        {entry !== null && entry.openFindings > 0 && <span className="rv-error"> · {words.openFindings(entry.openFindings)}</span>}
      </div>
      {asking === null ? (
        <div className="rv-decision-actions">
          {decision === null ? (
            <>
              <button type="button" onClick={() => setAsking('accepted')}>
                {words.decisions.accept}
              </button>
              <button type="button" onClick={() => setAsking('exempted')}>
                {words.decisions.exempt}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onDecide({ scope: { kind: 'hunk', path: hunk.path, hunkId: hunk.id }, outcome: 'withdrawn', reason: '' })}
            >
              {words.decisions.withdraw}
            </button>
          )}
        </div>
      ) : (
        <form
          className="rv-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            if (asking === 'exempted' && reason.trim() === '') {
              return;
            }
            onDecide({ scope: { kind: 'hunk', path: hunk.path, hunkId: hunk.id }, outcome: asking, reason: reason.trim() });
            setAsking(null);
            setReason('');
          }}
        >
          <div>
            <strong>{asking === 'accepted' ? words.decisions.accept.replace('…', '') : words.decisions.exempt.replace('…', '')}</strong>:{' '}
            {words.decisions.scope(`${where} (${hunk.path})`, revisionText)}
            {asking === 'accepted' && ` ${words.decisions.notGuarantee}`}
          </div>
          <input
            value={reason}
            placeholder={asking === 'exempted' ? words.decisions.reasonRequired : words.decisions.commentOptional}
            onChange={(event) => setReason(event.target.value)}
          />
          <button type="submit" disabled={asking === 'exempted' && reason.trim() === ''}>
            {words.decisions.confirm}
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            {words.decisions.cancel}
          </button>
        </form>
      )}
    </div>
  );
}

function NotesHere({
  notes,
  location,
  stepId,
  words,
  onOpen,
}: {
  readonly notes: readonly ReviewNote[];
  readonly location: CodeLocation | null;
  readonly stepId: string | null;
  readonly words: ReviewWords;
  readonly onOpen: (location: CodeLocation) => void;
}): JSX.Element | null {
  const here = notes.filter(
    (note) =>
      note.status === 'open' &&
      ((stepId !== null && note.stepId === stepId) || (location !== null && note.location?.path === location.path)),
  );
  if (here.length === 0) {
    return null;
  }
  return (
    <div className="rv-notes-here">
      <div className="rv-section-title">{words.note.hereTitle}</div>
      {here.map((note) => (
        <div key={note.id} className={`rv-note rv-note-${note.kind}`}>
          <strong>{note.kind === 'finding' ? words.note.finding : words.note.question}:</strong> {note.text}{' '}
          {note.location !== null && (
            <button
              type="button"
              className="rv-link"
              onClick={() => {
                if (note.location !== null) {
                  onOpen(note.location);
                }
              }}
            >
              {fileName(note.location.path)}:{rangeText(note.location)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Fixed navigation -----------------------------------------------------------------------

/**
 * Always in the same place above the code: where you are, back and forward one code
 * place at a time, and how much code to show. Moving approves nothing.
 */
function WalkNavBar({
  stations,
  active,
  stepId,
  placeIndex,
  placeCount,
  place,
  canBack,
  canForward,
  onMove,
  level,
  onLevel,
  view,
  onView,
  wrap,
  onWrap,
  words,
  lang,
}: {
  readonly stations: readonly unknown[];
  readonly active: number;
  readonly stepId: string;
  readonly placeIndex: number;
  readonly placeCount: number;
  readonly place: Place | null;
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly onMove: (delta: number) => void;
  readonly level: CodeLevel;
  readonly onLevel: (level: CodeLevel) => void;
  readonly view: CodeView;
  readonly onView: (view: CodeView) => void;
  readonly wrap: boolean;
  readonly onWrap: (on: boolean) => void;
  readonly words: ReviewWords;
  readonly lang: Lang;
}): JSX.Element {
  void stations;
  void active;
  void place;
  void lang;
  return (
    <div className="rv-navbar">
      <div className="rv-navbar-row">
        <button type="button" className="rv-nav-button rv-nav-previous" disabled={!canBack} onClick={() => onMove(-1)}>
          {words.nav.previous}
        </button>
        {/* Where in the walk, compactly; the place's own name is not repeated above the code (30 October 2026). */}
        <div className="rv-nav-where">
          <span className="rv-sub">{words.nav.placeOf(stepId, placeIndex + 1, placeCount)}</span>
        </div>
        <button type="button" className="rv-nav-button rv-nav-next" disabled={!canForward} onClick={() => onMove(1)}>
          {words.nav.next}
        </button>
      </div>
      <div className="rv-navbar-row rv-navbar-controls">
        <span className="rv-seg" role="group" aria-label={words.levels.label}>
          {(['change', 'unit', 'file'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={level === value ? 'rv-on' : ''}
              aria-pressed={level === value}
              title={value === 'unit' ? unitTitle(place) : undefined}
              onClick={() => onLevel(value)}
            >
              {value === 'change' ? words.levels.change : value === 'file' ? words.levels.file : unitLabel(place, words)}
            </button>
          ))}
        </span>
        <span className="rv-seg" role="group">
          {(['before', 'both', 'after'] as const).map((value) => (
            <button key={value} type="button" className={view === value ? 'rv-on' : ''} data-ev={`code-view-${value}`} aria-pressed={view === value} onClick={() => onView(value)}>
              {words.view[value]}
            </button>
          ))}
        </span>
        <label className="rv-check rv-walk-toggle" title={words.wrapLinesTitle}>
          <input type="checkbox" data-ev="walk-wrap" checked={wrap} onChange={(event) => onWrap(event.target.checked)} /> {words.wrapLines}
        </label>
      </div>
    </div>
  );
}

// --- Code ---------------------------------------------------------------------------------

/** How an opened location's pane was left: what was opened in it, and where it was scrolled. */
interface PaneMemory {
  readonly extra: { readonly above: number; readonly below: number; readonly context: boolean };
  readonly openGaps: readonly number[];
  readonly top: number;
  readonly left: number;
}

function CodePane({
  focus,
  contexts,
  diffFile,
  files,
  view,
  onView,
  scope,
  onScope,
  wrap,
  onWrap,
  selection,
  onSelect,
  problem,
  words,
  referenceMark = false,
  memory = null,
  onLeave,
}: {
  /** A location opened on its own: its lines carry the reference's own mark (30 October 2026). */
  readonly referenceMark?: boolean;
  /** How this pane was left before, to open as it was. */
  readonly memory?: PaneMemory | null;
  readonly onLeave?: (memory: PaneMemory) => void;
  readonly focus: CodeLocation;
  readonly contexts: readonly CodeLocation[];
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly view: CodeView;
  readonly onView: (view: CodeView) => void;
  readonly scope: CodeScope;
  readonly onScope: (scope: CodeScope) => void;
  readonly wrap: boolean;
  readonly onWrap: (on: boolean) => void;
  readonly selection: CodeLocation | null;
  readonly onSelect: (location: CodeLocation | null) => void;
  readonly problem: string | null;
  readonly words: ReviewWords;
}): JSX.Element {
  const content = useRows(files, focus.path, diffFile, focus.side);
  const [extra, setExtra] = useState(memory?.extra ?? { above: 0, below: 0, context: false });
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(new Set(memory?.openGaps ?? []));
  const container = useRef<HTMLDivElement>(null);
  const left = useRef({ extra, openGaps, top: memory?.top ?? 0, left: memory?.left ?? 0 });
  const wrapHold = useRef<{ readonly row: HTMLElement; readonly offset: number } | null>(null);
  useLayoutEffect(() => {
    const held = wrapHold.current;
    const element = container.current;
    wrapHold.current = null;
    if (held !== null && element !== null && held.row.isConnected) {
      element.scrollTop += held.row.getBoundingClientRect().top - element.getBoundingClientRect().top - held.offset;
    }
  }, [wrap]);
  left.current = { ...left.current, extra, openGaps };
  useEffect(
    () => () => {
      onLeave?.({ extra: left.current.extra, openGaps: [...left.current.openGaps], top: left.current.top, left: left.current.left });
    },
    // Once, when the pane goes: what it was left as.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const rows = content?.rows ?? [];

  const focused = useMemo(() => referenceRows(rows, focus), [rows, focus]);
  const focusSet = useMemo(() => new Set(focused.indexes), [focused]);
  // Each context range on its own: separate ranges never merge into one long span.
  const contextRows = useMemo(
    () =>
      contexts
        .filter((location) => location.path === focus.path)
        .map((location) => referenceRows(rows, location).indexes)
        .filter((indexes) => indexes.length > 0),
    [contexts, rows, focus.path],
  );
  const contextRange =
    contextRows.length === 0
      ? null
      : { first: Math.min(...contextRows.map((indexes) => indexes[0] ?? 0)), last: Math.max(...contextRows.map((indexes) => indexes[indexes.length - 1] ?? 0)) };
  const selectionSet = useMemo(() => (selection === null ? new Set<number>() : new Set(referenceRows(rows, selection).indexes)), [selection, rows]);

  const changed = focused.changed;
  const effectiveView: CodeView = changed ? view : 'both';
  const hidden = (row: DiffRow): boolean =>
    (effectiveView === 'before' && row.kind === 'added') || (effectiveView === 'after' && row.kind === 'deleted');

  // Which rows are on screen.
  const visible = useMemo(() => {
    const keep = rows.map(() => false);
    if (rows.length === 0) {
      return keep;
    }
    if (scope === 'file') {
      // The whole file: changes with a little context; long unchanged runs fold away.
      rows.forEach((row, index) => {
        if (row.kind !== 'context' || focusSet.has(index)) {
          for (let near = Math.max(0, index - GAP_CONTEXT); near <= Math.min(rows.length - 1, index + GAP_CONTEXT); near += 1) {
            keep[near] = true;
          }
        }
      });
      if (diffFile === null) {
        keep.fill(true);
      }
      let index = 0;
      while (index < keep.length) {
        if (keep[index] === true) {
          index += 1;
          continue;
        }
        const start = index;
        while (index < keep.length && keep[index] !== true) {
          index += 1;
        }
        if (openGaps.has(start)) {
          keep.fill(true, start, index);
        }
      }
      return keep;
    }
    const first = focused.indexes[0] ?? 0;
    const last = focused.indexes[focused.indexes.length - 1] ?? first;
    const from = first - FOCUS_MARGIN - extra.above;
    const to = last + FOCUS_MARGIN + extra.below;
    keep.fill(true, Math.max(0, from), Math.min(rows.length, to + 1));
    if (extra.context) {
      for (const indexes of contextRows) {
        indexes.forEach((index) => {
          keep[index] = true;
        });
      }
    }
    // Rows between ranges stay folded until opened.
    let index = 0;
    while (index < keep.length) {
      if (keep[index] === true) {
        index += 1;
        continue;
      }
      const start = index;
      while (index < keep.length && keep[index] !== true) {
        index += 1;
      }
      if (openGaps.has(start)) {
        keep.fill(true, start, index);
      }
    }
    return keep;
  }, [rows, scope, focusSet, focused, extra, contextRows, openGaps, diffFile]);

  // Bring the focused change into view: its first changed row, not the top of a range.
  const scrollKey = `${focus.path}:${focus.side}:${String(focus.start)}:${String(focus.end)}:${scope}:${effectiveView}`;
  const scrolledFor = useRef('');
  useLayoutEffect(() => {
    if (content === null || scrolledFor.current === scrollKey) {
      return;
    }
    const target =
      container.current?.querySelector('[data-focus-change="1"]') ?? container.current?.querySelector('[data-focus="1"]');
    // Back at a location left before: where it was scrolled, not its first line again.
    if (memory !== null && scrolledFor.current === '' && container.current !== null && target !== null && target !== undefined) {
      container.current.scrollTop = memory.top;
      container.current.scrollLeft = memory.left;
      scrolledFor.current = scrollKey;
      return;
    }
    if (target !== null && target !== undefined) {
      // A new place starts at the left edge: no sideways scroll is carried over from another.
      if (container.current !== null) {
        container.current.scrollLeft = 0;
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      scrolledFor.current = scrollKey;
    }
  });

  const select = (row: DiffRow, extend: boolean): void => {
    const side: RevisionSide = row.targetLine !== null ? 'target' : 'base';
    const line = row.targetLine ?? row.baseLine;
    if (line === null) {
      return;
    }
    if (extend && selection !== null && selection.path === focus.path && selection.side === side) {
      onSelect({ ...selection, start: Math.min(selection.start, line), end: Math.max(selection.end, line) });
    } else {
      onSelect({ path: focus.path, side, start: line, end: line });
    }
  };

  const body: JSX.Element[] = [];
  if (content !== null && content.error === null) {
    const firstVisible = visible.indexOf(true);
    const lastVisible = visible.lastIndexOf(true);
    if (scope === 'focus' && firstVisible > 0) {
      body.push(
        <div key="more-above" className="rv-more">
          <button type="button" onClick={() => setExtra({ ...extra, above: extra.above + MORE_LINES })}>
            ↑ {words.view.moreAbove}
          </button>
          {contextRange !== null && !extra.context && contextRange.first < firstVisible && (
            <button type="button" onClick={() => setExtra({ ...extra, context: true })}>
              {words.view.wholeContext}
            </button>
          )}
        </div>,
      );
    }
    let firstFocus = true;
    let firstChange = true;
    let hiddenNoted = false;
    let index = scope === 'focus' ? Math.max(0, firstVisible) : 0;
    const end = scope === 'focus' ? lastVisible : rows.length - 1;
    while (index <= end && index >= 0) {
      if (visible[index] !== true) {
        const start = index;
        while (index <= end && visible[index] !== true) {
          index += 1;
        }
        body.push(
          <div key={`gap-${String(start)}`} className="rv-gap">
            <button type="button" onClick={() => setOpenGaps(new Set([...openGaps, start]))}>
              {words.view.hiddenLines(index - start)}
            </button>
          </div>,
        );
        continue;
      }
      const row = rows[index];
      if (row === undefined) {
        break;
      }
      if (hidden(row)) {
        // Say so where the focus had lines that this view leaves out.
        if (focusSet.has(index) && !hiddenNoted) {
          hiddenNoted = true;
          if (!focused.indexes.some((focusIndex) => !hidden(rows[focusIndex] as DiffRow))) {
            body.push(
              <div key={`none-${String(index)}`} className="rv-nothing">
                {effectiveView === 'before' ? words.view.nothingBefore : words.view.nothingAfter}
              </div>,
            );
          }
        }
        index += 1;
        continue;
      }
      const inFocus = focusSet.has(index);
      const side: RevisionSide = row.targetLine !== null ? 'target' : 'base';
      const lineTokens = side === 'target' ? content.tokens.target[(row.targetLine ?? 1) - 1] : content.tokens.base[(row.baseLine ?? 1) - 1];
      const classes = ['rv-row'];
      if (row.kind === 'deleted') {
        classes.push(inFocus ? 'rv-old' : 'rv-old-faint');
      } else if (row.kind === 'added') {
        classes.push(inFocus ? 'rv-new' : 'rv-new-faint');
      } else if (inFocus) {
        classes.push('rv-neutral-focus');
      }
      if (selectionSet.has(index)) {
        classes.push('rv-row-selected');
      }
      if (referenceMark && inFocus) {
        classes.push('rv-ref-mark');
      }
      const mark = row.kind === 'deleted' ? { sign: '−', word: words.view.before } : row.kind === 'added' ? { sign: '+', word: words.view.after } : null;
      const focusAttrs: Record<string, string> = {};
      if (inFocus && firstFocus) {
        focusAttrs['data-focus'] = '1';
        firstFocus = false;
      }
      if (inFocus && row.kind !== 'context' && firstChange) {
        focusAttrs['data-focus-change'] = '1';
        firstChange = false;
      }
      body.push(
        <div
          key={`row-${String(index)}`}
          className={classes.join(' ')}
          {...focusAttrs}
          // Where this row's text is, for a text selection to ask about (`walk-selection.ts`).
          data-sel-side={side}
          data-sel-path={focus.path}
          data-sel-line={String((side === 'target' ? row.targetLine : row.baseLine) ?? '')}
        >
          <LineGutter
            base={row.baseLine}
            target={row.targetLine}
            mark={mark}
            strong={inFocus && mark !== null}
            title={words.view.selectLine}
            onSelect={(shift) => select(row, shift)}
          />
          <code className="rv-text">
            <TokensView tokens={lineTokens} />
          </code>
        </div>,
      );
      index += 1;
    }
    if (scope === 'focus' && lastVisible < rows.length - 1 && lastVisible >= 0) {
      body.push(
        <div key="more-below" className="rv-more">
          <button type="button" onClick={() => setExtra({ ...extra, below: extra.below + MORE_LINES })}>
            ↓ {words.view.moreBelow}
          </button>
          {contextRange !== null && !extra.context && contextRange.last > lastVisible && (
            <button type="button" onClick={() => setExtra({ ...extra, context: true })}>
              {words.view.wholeContext}
            </button>
          )}
        </div>,
      );
    }
  }

  return (
    <div className="rv-code-pane">
      <div className="rv-code-bar">
        <span className="rv-path" title={focus.path}>
          {fileName(focus.path)}
        </span>
        {diffFile === null && <span className="rv-sub">{words.view.unchangedFile}</span>}
        {changed ? (
          <span className="rv-seg" role="group">
            {(['before', 'both', 'after'] as const).map((value) => (
              <button key={value} type="button" className={view === value ? 'rv-on' : ''} data-ev={`code-view-${value}`} aria-pressed={view === value} onClick={() => onView(value)}>
                {words.view[value]}
              </button>
            ))}
          </span>
        ) : (
          <span className="rv-sub">{words.view.noChangeHere}</span>
        )}
        <span className="rv-seg" role="group">
          {(['focus', 'file'] as const).map((value) => (
            <button key={value} type="button" className={scope === value ? 'rv-on' : ''} aria-pressed={scope === value} onClick={() => onScope(value)}>
              {value === 'focus' ? words.view.focus : words.view.wholeFile}
            </button>
          ))}
        </span>
        <label className="rv-check rv-walk-toggle" title={words.wrapLinesTitle}>
          <input
            type="checkbox"
            data-ev="code-wrap"
            checked={wrap}
            onChange={(event) => {
              // The line being read stays where it is when rows change height (30 October 2026).
              const element = container.current;
              if (element !== null) {
                const top = element.getBoundingClientRect().top;
                const row = [...element.querySelectorAll<HTMLElement>('[data-sel-line]')].find((entry) => entry.getBoundingClientRect().bottom > top + 1);
                wrapHold.current = row === undefined ? null : { row, offset: row.getBoundingClientRect().top - top };
              }
              onWrap(event.target.checked);
            }}
          />{' '}
          {words.wrapLines}
        </label>
      </div>
      {problem !== null && <div className="rv-error rv-problem">{words.view.invalidReference(problem)}</div>}
      <div className="rv-legend-bar" aria-hidden="true">
        {changed && (
          <>
            <span className="rv-key rv-old">{words.view.legendOld}</span>
            <span className="rv-key rv-new">{words.view.legendNew}</span>
          </>
        )}
        {focused.indexes.some((index) => rows[index]?.kind === 'context') && (
          <span className="rv-key rv-neutral-focus">{words.view.legendFocus}</span>
        )}
      </div>
      <div
        className={wrap ? 'rv-lines rv-lines-wrap' : 'rv-lines'}
        ref={container}
        style={{ '--rv-digits': String(lineDigits(rows)) } as CSSProperties}
        onScroll={(event) => {
          left.current = { ...left.current, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
        }}
      >
        {content === null && <div className="rv-empty">{words.view.reading}</div>}
        {content !== null && content.error !== null && (
          <div className="rv-error">
            {content.error === 'binary'
              ? words.view.binary
              : content.error === 'missing'
                ? words.view.fileMissing(focus.path, words.side[focus.side])
                : content.error}
          </div>
        )}
        {body}
      </div>
    </div>
  );
}
