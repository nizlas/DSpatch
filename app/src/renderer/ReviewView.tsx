import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, ReactNode } from 'react';

import { Markdown } from './Markdown';
import { ReviewDiscussion } from './ReviewDiscussion';
import { AgentPicker } from './AgentPicker';
import { isRunning, JobLine, requestFailure } from './PairReview';
import { Inline, TokensView, asLocation, capitalise, fileName, rangeText, useFiles, useRows, type Files } from './review-code';
import { FileTree, WalkTimeline, stationsOf, unitLabel, unitTitle } from './ReviewTimeline';
import { WORDS, pick, type ReviewWords } from './review-i18n';
import {
  DEFAULT_PREFERENCES,
  EXPLANATION_WIDTH,
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
import type { DeepenRequest, DiscussionMessage, DiscussionRequest } from '../shared/review-discussion';
import { isPairError, type PairRecord } from '../shared/review-pair';
import { hunkDecisionsFromPair, hunkRanges, pairOpFor } from '../shared/review-pair-walk';

declare global {
  interface Window {
    readonly dspatchReview?: ReviewBridge;
    /**
     * Save whatever the open review has not saved yet, and say when it is done. The
     * main process calls it before a review window closes (`review-windows.ts`).
     */
    __dspatchReviewFlush?: () => Promise<string>;
    /** What the scripted `review-window` scenario reads and drives, from the main process. */
    __dspatchReviewCheck?: ReviewCheck;
  }
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

const FOCUS_MARGIN = 4;
const MORE_LINES = 15;
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

function findStep(bundle: ReviewBundle, stepId: string | null): { walk: Walk; step: WalkStep; index: number } | null {
  if (stepId === null) {
    return null;
  }
  for (const walk of bundle.definition.walks) {
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
      },
      (error: unknown) => {
        setLangError(String(error));
      },
    );
    void bridge.initial().then(setOutcome);
  }, [bridge]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      if (bridge !== undefined) {
        void bridge.setPreferences({ language: next, explanationWidth: width }).then((result) => {
          setLangError(result.saved ? null : (result.error ?? 'not saved'));
        });
      }
    },
    [bridge, width],
  );

  // DSP-152: the explanation column's width, as the reviewer left it.
  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(EXPLANATION_WIDTH.max, Math.max(EXPLANATION_WIDTH.min, next)));
      setWidthState(clamped);
      if (bridge !== undefined) {
        void bridge.setPreferences({ language: lang, explanationWidth: clamped });
      }
    },
    [bridge, lang],
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
}: {
  readonly bundle: ReviewBundle;
  readonly bridge: ReviewBridge | undefined;
  readonly onChoose: () => void;
  readonly lang: Lang;
  readonly onLang: (lang: Lang) => void;
  readonly langError: string | null;
  readonly explanationWidth: number;
  readonly onExplanationWidth: (width: number) => void;
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
  const [pair, setPair] = useState<{ readonly key: string; readonly record: PairRecord } | null>(null);
  useEffect(() => {
    if (pairBridge === undefined) {
      return;
    }
    let live = true;
    void pairBridge.forWalk().then((answer) => {
      if (live && !isPairError(answer)) {
        setPair({ key: answer.key, record: answer.record });
      }
    });
    const stop = pairBridge.onChanged((event) => {
      setPair((current) => (current !== null && current.key === event.key ? { key: current.key, record: event.record } : current));
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
   * DSP-152: deepening a step. Tell me more, Explain more simply and Explain this are
   * questions in this review's own discussion, sent with the step as their subject so the
   * envelope carries the revisions, the step and its code; the step shows their answers
   * beside it, and the discussion goes on from there. Asking for a simpler explanation is
   * one question: it changes nothing else about the review.
   */
  const [discussionMessages, setDiscussionMessages] = useState<readonly DiscussionMessage[]>([]);
  const [deepenError, setDeepenError] = useState<string | null>(null);
  const [delegatingWalk, setDelegatingWalk] = useState(false);
  const [liveWidth, setLiveWidth] = useState(explanationWidth);
  useEffect(() => {
    setLiveWidth(explanationWidth);
  }, [explanationWidth]);

  const coverage = useMemo(() => computeCoverage(bundle.definition, bundle.files, shownState), [bundle, shownState]);
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
  const activeStation = current === null ? -1 : stations.findIndex((entry) => entry.stepId === current.step.id && entry.placeIndex === placeIndex);
  const focus: CodeLocation | null = away ?? (place === null ? null : asLocation(place.focus));
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

  const goAway = useCallback(
    (location: CodeLocation, scope: CodeScope = 'focus') => {
      setSelection(null);
      setScope(scope);
      update((value) => ({ ...value, position: { ...value.position, away: location } }));
    },
    [update],
  );

  const returnToWalk = useCallback(() => {
    setSelection(null);
    setScope('focus');
    update((value) => ({ ...value, position: { ...value.position, away: null } }));
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
      const target = stations[activeStation + delta];
      if (target !== undefined) {
        goToStep(target.stepId, target.placeIndex);
        return;
      }
      const walks = bundle.definition.walks;
      const walkIndex = walks.indexOf(current.walk);
      const neighbour = walks[walkIndex + delta];
      if (neighbour === undefined) {
        return;
      }
      const neighbourStations = stationsOf(neighbour);
      const entry = delta > 0 ? neighbourStations[0] : neighbourStations[neighbourStations.length - 1];
      if (entry !== undefined) {
        goToStep(entry.stepId, entry.placeIndex);
      }
    },
    [current, activeStation, stations, bundle, goToStep],
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

  const setHighlightWalk = useCallback(
    (on: boolean) => {
      update((value) => ({ ...value, ui: { ...value.ui, highlightWalk: on } }));
    },
    [update],
  );

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
              setPair({ key: pair.key, record: answer });
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

  const addNote = useCallback(
    (note: Pick<ReviewNote, 'kind' | 'text' | 'location' | 'stepId'>) => {
      const at = new Date().toISOString();
      record((value) => ({
        ...value,
        notes: [
          ...value.notes,
          { ...note, id: newId(), status: 'open', resolution: '', createdAt: at, updatedAt: at, revisions: value.revisions },
        ],
      }));
    },
    [record],
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

  // The light purple overview: every place of the current walk, focus and context.
  const walkOverlay: readonly CodeLocation[] = useMemo(() => {
    if (!state.ui.highlightWalk || current === null) {
      return [];
    }
    return current.walk.steps.flatMap((step) => step.places.flatMap((entry) => [entry.focus, ...entry.context].map(asLocation)));
  }, [state.ui.highlightWalk, current]);

  const revisionText = `${short(bundle.base.sha)}→${short(bundle.target.sha)}`;

  // What a question asked now would be about: the place on screen, a location away
  // from the walk, or the review as a whole; and the lines selected, if any.
  const discussionRequest: DiscussionRequest = useMemo(
    () => ({
      subject:
        away !== null
          ? { kind: 'away', location: away }
          : current !== null && place !== null
            ? { kind: 'point', walkId: current.walk.id, stepId: current.step.id, placeIndex }
            : { kind: 'review' },
      selection,
      language: lang,
    }),
    [away, current?.walk.id, current?.step.id, place, placeIndex, selection, lang],
  );

  const deepen = useCallback(
    async (request: DeepenRequest): Promise<void> => {
      const discussion = window.dspatchReviewDiscussion;
      if (discussion === undefined || current === null) {
        return;
      }
      setDeepenError(null);
      // The review's own save first, as the discussion does before any question.
      await flush();
      const outcome = await discussion.send({
        question: deepenQuestion(request, lang),
        subject: discussionRequest.subject,
        selection: discussionRequest.selection,
        language: lang,
        deepen: request,
      });
      if (outcome.kind !== 'sent') {
        setDeepenError(outcome.error);
      }
    },
    [current, discussionRequest, flush, lang],
  );

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

  // The divider between the code and the explanation: dragged, or moved with the arrow keys.
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clampWidth = (value: number): number => Math.round(Math.min(EXPLANATION_WIDTH.max, Math.max(EXPLANATION_WIDTH.min, value)));

  return (
    <div className="rv">
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
        onChoose={onChoose}
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
        className={tab === 'coverage' || tab === 'notes' ? 'rv-body rv-body-wide' : 'rv-body'}
        style={{ '--rv-right-width': `${String(liveWidth)}px` } as CSSProperties}
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
                  <Collapsible title={words.overviewTitle} defaultOpen={state.shownSteps[bundle.definition.walks[0]?.steps[0]?.id ?? ''] === undefined}>
                    <Overview summary={pick(bundle.definition.overviewSummary, lang)} full={pick(bundle.definition.overview, lang)} words={words} />
                  </Collapsible>
                )}
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
              </div>
            )}
            {tab === 'coverage' && <CoverageTable coverage={coverage} words={words} onOpen={(hunk) => goAway(hunkLocation(hunk))} />}
            {tab === 'notes' && (
              <NotesList state={shownState} bundle={bundle} words={words} lang={lang} onOpen={goAway} onStatus={setNoteStatus} />
            )}
            {tab === 'search' && bridge !== undefined && <Browse bridge={bridge} words={words} onOpen={goAway} />}
          </div>
        </nav>

        <main className="rv-code">
          {away !== null && current !== null && (
            <div className="rv-away">
              <span>
                {words.outsideWalk}: {fileName(away.path)}:{rangeText(away)}
              </span>
              <button type="button" onClick={returnToWalk}>
                {words.backTo(current.step.id)}
              </button>
            </div>
          )}
          {away === null && current !== null && activeStation >= 0 ? (
            <>
              <WalkNavBar
                stations={stations}
                active={activeStation}
                stepId={current.step.id}
                placeIndex={placeIndex}
                placeCount={current.step.places.length}
                place={place}
                canBack={activeStation > 0 || bundle.definition.walks.indexOf(current.walk) > 0}
                canForward={
                  activeStation < stations.length - 1 ||
                  bundle.definition.walks.indexOf(current.walk) < bundle.definition.walks.length - 1
                }
                onMove={moveStation}
                level={level}
                onLevel={setLevel}
                view={view}
                onView={setView}
                highlightWalk={state.ui.highlightWalk}
                onHighlightWalk={setHighlightWalk}
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
                highlightWalk={state.ui.highlightWalk}
                words={words}
                lang={lang}
                onOpenLocation={goAway}
                navRequest={navRequest}
              />
            </>
          ) : focus === null ? (
            <div className="rv-empty" />
          ) : (
            <CodePane
              key={`${focus.path}:${focus.side}:${String(focus.start)}:${String(focus.end)}`}
              focus={focus}
              contexts={contexts}
              overlay={walkOverlay}
              diffFile={diffFile}
              files={files}
              view={view}
              onView={setView}
              scope={scope}
              onScope={setScope}
              highlightWalk={state.ui.highlightWalk}
              onHighlightWalk={current === null ? null : setHighlightWalk}
              selection={selection}
              onSelect={setSelection}
              problem={placeProblem}
              words={words}
            />
          )}
        </main>

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

        <aside className="rv-right">
          <div className="rv-tabs rv-right-tabs" role="tablist">
            {(['step', 'discussion'] as const).map((key) => (
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
          </div>
          <ReviewDiscussion
            bundle={bundle}
            request={discussionRequest}
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
          />
          {rightTab === 'step' && (
            <>
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
              {pair !== null && pairBridge !== undefined && current !== null && away === null && walkScope !== null && (
                <div className="rv-walk-delegate">
                  {walkJob !== null && (!delegatingWalk || isRunning(walkJob)) && (
                    <JobLine job={walkJob} onStop={() => void pairBridge.cancelJob(pair.key, walkJob.id)} />
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
              {current !== null && away === null && place !== null && (
                <StepPanel
                  deepenings={deepeningsFor(discussionMessages, current.step.id)}
                  deepenError={deepenError}
                  onDeepen={(request) => void deepen(request)}
                  onContinue={() => setRightTab('discussion')}
                  walk={current.walk}
                  step={current.step}
                  index={current.index}
                  placeIndex={placeIndex}
                  referenceProblems={bundle.referenceProblems}
                  state={state}
                  words={words}
                  lang={lang}
                  onPlace={(index) => {
                    goToStep(current.step.id, index);
                    setNavRequest((count) => count + 1);
                  }}
                  onOpenEvidence={goAway}
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
              <Collapsible title={words.reviewSection} defaultOpen={false}>
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
              <Collapsible title={words.notesSection} defaultOpen={false}>
                <NoteForm
                  selection={selection}
                  shown={focus}
                  stepId={away === null ? (current?.step.id ?? null) : null}
                  words={words}
                  onAdd={addNote}
                />
              </Collapsible>
              <NotesHere notes={state.notes} location={focus} stepId={current?.step.id ?? null} words={words} onOpen={goAway} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A few sentences first; the whole account, with what lies outside the walks, in their place on request. */
function Overview({ summary, full, words }: { readonly summary: string; readonly full: string; readonly words: ReviewWords }): JSX.Element {
  const [more, setMore] = useState(false);
  if (summary === '' || full === '') {
    return (
      <div className="rv-explanation rv-overview">
        <Markdown text={summary === '' ? full : summary} />
      </div>
    );
  }
  return (
    <div className="rv-explanation rv-overview">
      <Markdown text={more ? full : summary} />
      <button type="button" className="rv-link rv-more-link" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? words.showLess : words.showMore}
      </button>
    </div>
  );
}

function Collapsible({
  title,
  defaultOpen,
  children,
}: {
  readonly title: string;
  readonly defaultOpen: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rv-collapsible">
      <button type="button" className="rv-collapsible-head" aria-expanded={open} onClick={() => setOpen(!open)}>
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
}: {
  readonly bundle: ReviewBundle;
  readonly history: number;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onLang: (lang: Lang) => void;
  readonly langError: string | null;
  readonly save: { at: string; error?: string } | null;
  readonly saving: boolean;
  readonly coverage: CoverageSummary;
  readonly onChoose: () => void;
}): JSX.Element {
  const [details, setDetails] = useState(false);
  const references = bundle.definition.walks.flatMap((walk) => walk.steps.flatMap((step) => step.refs));
  const anchored = references.filter((ref) => ref.anchor !== undefined).length;
  const problems = bundle.definitionProblems.length + bundle.referenceProblems.length;
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
        {coverage.openFindings > 0 && <span className="rv-findings">{words.openFindings(coverage.openFindings)}</span>}
        <span className={save?.error !== undefined ? 'rv-error rv-save' : 'rv-sub rv-save'} role="status">
          {save?.error !== undefined ? words.notSaved(save.error) : saving ? words.saving : save === null ? '' : words.saved}
        </span>
        <label className="rv-lang">
          {words.language}{' '}
          <select value={lang} onChange={(event) => onLang(event.target.value as Lang)}>
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </label>
        <button type="button" onClick={() => setDetails(!details)} aria-expanded={details}>
          {details ? words.hideDetails : words.details}
          {problems > 0 ? ` (${String(problems)} !)` : ''}
        </button>
      </div>
      {langError !== null && <div className="rv-error rv-full">{words.notSaved(langError)}</div>}
      {details && (
        <div className="rv-details">
          <dl>
            <dt>{words.detailsPanel.revisions}</dt>
            <dd>
              {words.detailsPanel.base}: <code>{bundle.base.sha}</code> {bundle.base.subject}
              <br />
              {words.detailsPanel.target}: <code>{bundle.target.sha}</code> {bundle.target.subject}
              <br />
              {bundle.singleCommit ? words.detailsPanel.oneCommit : words.detailsPanel.severalCommits}{' '}
              {words.detailsPanel.readFromGit}
            </dd>
            <dt>{words.detailsPanel.repository}</dt>
            <dd>
              <code>{bundle.repository}</code>
            </dd>
            <dt>{words.detailsPanel.definition}</dt>
            <dd>
              <code>{bundle.definitionPath}</code>
              <br />
              {pick(bundle.definition.provenance, lang)}
              {history > 0 && (
                <>
                  <br />
                  {words.detailsPanel.definitionHistory(history)}
                </>
              )}
              {bundle.definition.languages.length < 2 && (
                <>
                  <br />
                  {words.detailsPanel.languagesMissing}
                </>
              )}
            </dd>
          </dl>
          <p>{words.detailsPanel.explanations(bundle.definition.teachingMode || '–')}</p>
          <p>{words.detailsPanel.decisionsInfo}</p>
          <p>{words.detailsPanel.validated(references.length, anchored)}</p>
          {problems > 0 && (
            <>
              <p className="rv-error">{words.detailsPanel.problems}</p>
              <ul className="rv-error">
                {bundle.definitionProblems.map((problem) => (
                  <li key={`${problem.where}${problem.problem}`}>
                    {problem.where}: {problem.problem}
                  </li>
                ))}
                {bundle.referenceProblems.map((problem) => (
                  <li key={`${problem.stepId}#${problem.refId}`}>
                    {problem.stepId} {problem.refId}: {problem.problem}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" onClick={onChoose}>
            {words.openAnother}
          </button>
        </div>
      )}
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
            <button type="button" className="rv-walk-head" aria-expanded={isOpen} onClick={() => onToggle(walk.id)}>
              <span className="rv-chevron">{isOpen ? '▾' : '▸'}</span>
              <span className="rv-walk-name">
                <span className="rv-step-id">{walk.id}</span> <Inline text={pick(walk.title, lang)} />
              </span>
              <span className="rv-sub rv-walk-count">{words.walkProgress(opened, walk.steps.length)}</span>
            </button>
            {isOpen && pick(walk.purpose, lang) !== '' && (
              <p className="rv-walk-purpose">
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

/** The question a deepening action asks, in the review's language. */
function deepenQuestion(request: DeepenRequest, lang: Lang): string {
  if (lang === 'sv') {
    return request.action === 'more'
      ? 'Berätta mer om det här steget: mekanismen, hur koden hänger ihop och de detaljer som spelar roll.'
      : request.action === 'simpler'
        ? 'Förklara det här steget enklare: mer bakgrund, ett tydligare orsakssamband eller ett konkret exempel. Behåll klass- och metodnamnen.'
        : `Förklara detta i sammanhanget av det här steget: "${request.text ?? ''}"`;
  }
  return request.action === 'more'
    ? 'Tell me more about this step: the mechanism, how the code connects, and the details that matter.'
    : request.action === 'simpler'
      ? 'Explain this step more simply: more background, a clearer cause and effect, or a concrete example. Keep the class and method names.'
      : `Explain this, in the context of this step: "${request.text ?? ''}"`;
}

/** A step's deepenings: its deepening questions in this discussion, each with its answer. */
interface Deepening {
  readonly question: DiscussionMessage;
  readonly answer: DiscussionMessage | null;
}

function deepeningsFor(messages: readonly DiscussionMessage[], stepId: string): readonly Deepening[] {
  return messages
    .filter((message) => {
      const subject = message.envelope?.subject;
      return message.role === 'question' && message.deepen !== undefined && subject?.kind === 'point' && subject.stepId === stepId;
    })
    .map((question) => ({ question, answer: messages.find((message) => message.role === 'answer' && message.questionId === question.id) ?? null }));
}

const DEEPEN_WORD: Record<DeepenRequest['action'], string> = { more: 'Tell me more', simpler: 'Explain more simply', explain: 'Explain this' };

/** The deepening actions of a step, and its deepenings so far, folded under the explanation. */
function StepDeepening({
  deepenings,
  error,
  onDeepen,
  onContinue,
  selectedText,
}: {
  readonly deepenings: readonly Deepening[];
  readonly error: string | null;
  readonly onDeepen: (request: DeepenRequest) => void;
  readonly onContinue: () => void;
  readonly selectedText: string;
}): JSX.Element {
  const waiting = deepenings.some((entry) => entry.question.status === 'sending' || entry.answer?.status === 'streaming');
  return (
    <div className="rv-deepen">
      <div className="rv-deepen-actions">
        <button type="button" data-ev="step-tell-more" disabled={waiting} onClick={() => onDeepen({ action: 'more' })}>
          Tell me more
        </button>
        <button type="button" data-ev="step-explain-simpler" disabled={waiting} onClick={() => onDeepen({ action: 'simpler' })}>
          Explain more simply
        </button>
        <button
          type="button"
          data-ev="step-explain-this"
          disabled={waiting || selectedText.trim() === ''}
          title={selectedText.trim() === '' ? 'Select a sentence or a term in the explanation first.' : `Explain "${selectedText.slice(0, 80)}"`}
          onClick={() => onDeepen({ action: 'explain', text: selectedText.trim() })}
        >
          Explain this
        </button>
      </div>
      {error !== null && <p className="rv-error">{error}</p>}
      {deepenings.map((entry, index) => {
        const status = entry.answer?.status ?? entry.question.status;
        const last = index === deepenings.length - 1;
        return (
          <details key={entry.question.id} className="rv-deepening" open={last} data-ev="step-deepening" data-state={status}>
            <summary>
              {DEEPEN_WORD[entry.question.deepen?.action ?? 'more']}
              {entry.question.deepen?.text !== undefined && <span className="rv-sub"> · “{entry.question.deepen.text.slice(0, 60)}”</span>}
              {(status === 'sending' || status === 'streaming') && <span className="rv-sub"> · answering…</span>}
              {(status === 'failed' || status === 'unknown' || status === 'cancelled') && <span className="rv-sub"> · {status}</span>}
            </summary>
            {entry.answer !== null && entry.answer.text !== '' ? <Markdown text={entry.answer.text} /> : <p className="rv-sub">…</p>}
            {last && (
              <button type="button" className="rv-quiet" data-ev="step-continue-discussion" onClick={onContinue}>
                Continue in the discussion
              </button>
            )}
          </details>
        );
      })}
    </div>
  );
}

function StepPanel({
  walk,
  step,
  index,
  placeIndex,
  referenceProblems,
  state,
  words,
  lang,
  onPlace,
  onOpenEvidence,
  deepenings,
  deepenError,
  onDeepen,
  onContinue,
}: {
  readonly deepenings: readonly Deepening[];
  readonly deepenError: string | null;
  readonly onDeepen: (request: DeepenRequest) => void;
  readonly onContinue: () => void;
  readonly walk: Walk;
  readonly step: WalkStep;
  readonly index: number;
  readonly placeIndex: number;
  readonly referenceProblems: ReviewBundle['referenceProblems'];
  readonly state: ReviewState;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onPlace: (index: number) => void;
  readonly onOpenEvidence: (location: CodeLocation) => void;
}): JSX.Element {
  const [sources, setSources] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const panel = useRef<HTMLElement | null>(null);
  const active = placeIndex;
  const purpose = pick(walk.purpose, lang);
  // The walk's introduction, short: its first sentence, the rest on request.
  const firstSentence = /^[\s\S]*?[.!?](\s|$)/.exec(purpose)?.[0]?.trim() ?? purpose;
  const invalid = new Set(
    referenceProblems.filter((problem) => problem.stepId === step.id).map((problem) => problem.refId.replace(/\.(unit|from)$/, '')),
  );
  const summaryLabels = [...new Set(step.evidence.map((entry) => entry.label))];
  return (
    <section
      className="rv-step-panel"
      ref={panel}
      onMouseUp={() => {
        const chosen = window.getSelection();
        const inside = chosen !== null && chosen.anchorNode !== null && panel.current?.contains(chosen.anchorNode) === true;
        setSelectedText(inside ? (chosen?.toString() ?? '') : '');
      }}
    >
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
      {pick(step.summary, lang) !== '' && (
        <p className="rv-summary">
          <Inline text={pick(step.summary, lang)} />
        </p>
      )}

      {step.places.length > 1 && (
        <div className="rv-places">
          <div className="rv-section-title">{words.places}</div>
          <ol>
            {step.places.map((entry, position) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={position === active ? 'rv-place rv-place-on' : 'rv-place'}
                  aria-current={position === active ? 'location' : undefined}
                  onClick={() => onPlace(position)}
                >
                  <span className="rv-place-number">{position + 1}</span>
                  <Markdown text={pick(entry.label, lang)} />
                  {invalid.has(entry.focus.id) && <span className="rv-error"> ⚠</span>}
                </button>
              </li>
            ))}
          </ol>
          {step.places[active]?.from !== null && step.places[active]?.from !== undefined && (
            <div className="rv-place-from">
              ← <Inline text={pick(step.places[active]?.from?.label ?? { sv: '', en: '' }, lang)} />
            </div>
          )}
          <div className="rv-place-nav">
            <button type="button" disabled={active === 0} onClick={() => onPlace(active - 1)}>
              ↑ {words.previousPlace}
            </button>
            <span className="rv-sub">{words.placeOf(active + 1, step.places.length)}</span>
            <button type="button" disabled={active === step.places.length - 1} onClick={() => onPlace(active + 1)}>
              ↓ {words.nextPlace}
            </button>
          </div>
        </div>
      )}

      {/* What the step says about the place in view: it changes with the place. */}
      {step.places[active]?.focus.note !== undefined && (
        <div className="rv-place-note" aria-live="polite">
          <Markdown text={pick(step.places[active]?.focus.note ?? { sv: '', en: '' }, lang)} />
        </div>
      )}

      <div className="rv-explanation">
        <Markdown text={pick(step.body, lang)} />
      </div>
      {pick(step.why, lang) !== '' && (
        <>
          <div className="rv-section-title">{words.whyItMatters}</div>
          <div className="rv-explanation">
            <Markdown text={pick(step.why, lang)} />
          </div>
        </>
      )}

      <StepDeepening deepenings={deepenings} error={deepenError} onDeepen={onDeepen} onContinue={onContinue} selectedText={selectedText} />

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

function NoteForm({
  selection,
  shown,
  stepId,
  words,
  onAdd,
}: {
  readonly selection: CodeLocation | null;
  readonly shown: CodeLocation | null;
  readonly stepId: string | null;
  readonly words: ReviewWords;
  readonly onAdd: (note: Pick<ReviewNote, 'kind' | 'text' | 'location' | 'stepId'>) => void;
}): JSX.Element {
  const [kind, setKind] = useState<'question' | 'finding'>('question');
  const [text, setText] = useState('');
  const location = selection ?? shown;
  return (
    <form
      className="rv-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === '') {
          return;
        }
        onAdd({ kind, text: text.trim(), location, stepId });
        setText('');
      }}
    >
      <div className="rv-note-kind">
        {(['question', 'finding'] as const).map((value) => (
          <label key={value}>
            <input type="radio" checked={kind === value} onChange={() => setKind(value)} />{' '}
            {value === 'question' ? words.note.question : words.note.finding}
          </label>
        ))}
      </div>
      <textarea
        value={text}
        rows={3}
        placeholder={kind === 'question' ? words.note.yourQuestion : words.note.yourFinding}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="rv-sub">
        {words.note.at(location === null ? words.note.noLocation : `${fileName(location.path)}:${rangeText(location)}`)}
        {selection === null ? ` — ${words.note.selectHint}` : ` (${words.note.yourSelection})`}
      </div>
      <button type="submit" disabled={text.trim() === ''}>
        {words.note.add(kind)}
      </button>
    </form>
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
  highlightWalk,
  onHighlightWalk,
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
  readonly highlightWalk: boolean;
  readonly onHighlightWalk: (on: boolean) => void;
  readonly words: ReviewWords;
  readonly lang: Lang;
}): JSX.Element {
  void stations;
  void active;
  return (
    <div className="rv-navbar">
      <div className="rv-navbar-row">
        <button type="button" className="rv-nav-button" disabled={!canBack} onClick={() => onMove(-1)}>
          {words.nav.previous}
        </button>
        <div className="rv-nav-where">
          <span className="rv-sub">{words.nav.placeOf(stepId, placeIndex + 1, placeCount)}</span>
          {place !== null && (
            <span className="rv-nav-label" title={pick(place.label, lang).replace(/`/g, '')}>
              <Inline text={pick(place.label, lang)} />
            </span>
          )}
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
            <button key={value} type="button" className={view === value ? 'rv-on' : ''} aria-pressed={view === value} onClick={() => onView(value)}>
              {words.view[value]}
            </button>
          ))}
        </span>
        <label className="rv-check rv-walk-toggle">
          <input type="checkbox" checked={highlightWalk} onChange={(event) => onHighlightWalk(event.target.checked)} /> {words.view.highlightWalk}
        </label>
      </div>
    </div>
  );
}

// --- Code ---------------------------------------------------------------------------------

function CodePane({
  focus,
  contexts,
  overlay,
  diffFile,
  files,
  view,
  onView,
  scope,
  onScope,
  highlightWalk,
  onHighlightWalk,
  selection,
  onSelect,
  problem,
  words,
}: {
  readonly focus: CodeLocation;
  readonly contexts: readonly CodeLocation[];
  readonly overlay: readonly CodeLocation[];
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly view: CodeView;
  readonly onView: (view: CodeView) => void;
  readonly scope: CodeScope;
  readonly onScope: (scope: CodeScope) => void;
  readonly highlightWalk: boolean;
  readonly onHighlightWalk: ((on: boolean) => void) | null;
  readonly selection: CodeLocation | null;
  readonly onSelect: (location: CodeLocation | null) => void;
  readonly problem: string | null;
  readonly words: ReviewWords;
}): JSX.Element {
  const content = useRows(files, focus.path, diffFile, focus.side);
  const [extra, setExtra] = useState({ above: 0, below: 0, context: false });
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const rows = content?.rows ?? [];

  const focused = useMemo(() => referenceRows(rows, focus), [rows, focus]);
  const focusSet = useMemo(() => new Set(focused.indexes), [focused]);
  const overlaySet = useMemo(() => {
    const set = new Set<number>();
    for (const location of overlay) {
      if (location.path === focus.path) {
        referenceRows(rows, location).indexes.forEach((index) => set.add(index));
      }
    }
    return set;
  }, [overlay, rows, focus.path]);
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
    if (target !== null && target !== undefined) {
      target.scrollIntoView({ block: 'center' });
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
      } else if (highlightWalk && overlaySet.has(index)) {
        classes.push('rv-walk-mark');
      }
      if (row.kind !== 'context' && !inFocus && highlightWalk && overlaySet.has(index)) {
        classes.push('rv-walk-edge');
      }
      if (selectionSet.has(index)) {
        classes.push('rv-row-selected');
      }
      const marker =
        row.kind === 'deleted' ? words.view.before : row.kind === 'added' ? words.view.after : '';
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
        <div key={`row-${String(index)}`} className={classes.join(' ')} {...focusAttrs}>
          <button type="button" className="rv-ln" title={words.view.selectLine} onClick={(event) => select(row, event.shiftKey)}>
            <span>{row.baseLine ?? ''}</span>
            <span>{row.targetLine ?? ''}</span>
          </button>
          <span className={inFocus && marker !== '' ? 'rv-marker rv-marker-strong' : 'rv-marker'}>{marker}</span>
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
              <button key={value} type="button" className={view === value ? 'rv-on' : ''} aria-pressed={view === value} onClick={() => onView(value)}>
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
        {onHighlightWalk !== null && (
          <label className="rv-check rv-walk-toggle">
            <input type="checkbox" checked={highlightWalk} onChange={(event) => onHighlightWalk(event.target.checked)} />{' '}
            {words.view.highlightWalk}
          </label>
        )}
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
        {highlightWalk && <span className="rv-key rv-walk-mark">{words.view.legendWalk}</span>}
      </div>
      <div className="rv-lines" ref={container}>
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
