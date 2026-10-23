import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { Markdown } from './Markdown';
import {
  buildDiffRows,
  computeCoverage,
  currentHunkDecisions,
  highlightLines,
  type CodeLocation,
  type CodeReference,
  type CoverageSummary,
  type DiffFile,
  type DiffHunk,
  type DiffRow,
  type EvidenceLabel,
  type HunkCoverage,
  type PlanState,
  type ReviewBridge,
  type ReviewBundle,
  type ReviewDecision,
  type ReviewFileOutcome,
  type ReviewNote,
  type ReviewOpenOutcome,
  type ReviewSearchHit,
  type ReviewState,
  type RevisionSide,
  type Token,
  type Walk,
  type WalkStep,
} from '../shared/review-model';

declare global {
  interface Window {
    readonly dspatchReview?: ReviewBridge;
  }
}

/**
 * DSpatch's own review surface: a fixed revision pair, its complete diff, prepared
 * walks through it, and the reviewer's record — on one screen, without Monaco, a loop,
 * the graph editor or an agent.
 *
 * What the screen must never blur (REVIEW_COVERAGE_AND_CODE_WALKS.md §3): a walk's
 * plan, what has been shown, what the reviewer marked walked through, and what they
 * decided. Moving to the next step records only that the step was shown; a decision
 * exists only after an explicit, confirmed action that names its scope and revision.
 *
 * The walks are prepared material read from the definition file. Nothing here
 * generates, adapts or "reviews" with an agent; there is no control that would
 * pretend to.
 */

const LABEL_TEXT: Record<EvidenceLabel, string> = {
  analysis: 'Analysis',
  'test-simulated': 'Test: simulated',
  'test-real-substitute': 'Test: real substitute process',
  'not-observed': 'Not observed',
};

/** What each label means in general. What exactly was substituted is the claim's to say. */
const LABEL_HELP: Record<EvidenceLabel, string> = {
  analysis: 'A possible path read from the code. Not observed in any run.',
  'test-simulated': 'Observed in a test in which parts of the system are substituted; the claim names the test.',
  'test-real-substitute':
    'Observed with a real local process standing in for another; the claim says what it stands in for and what stayed simulated.',
  'not-observed': 'Nothing recorded has observed this.',
};

const CONTEXT_LINES = 3;
const FOCUS_MARGIN = 8;

function short(sha: string): string {
  return sha.slice(0, 7);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeOf(iso: string): string {
  if (iso === '') {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function rangeText(location: { start: number; end: number }): string {
  return location.start === location.end ? String(location.start) : `${String(location.start)}–${String(location.end)}`;
}

function locationText(location: CodeLocation): string {
  return `${location.path}:${rangeText(location)} (${location.side === 'base' ? 'base' : 'target'})`;
}

function hunkRangeText(hunk: DiffHunk): string {
  const target =
    hunk.targetCount > 0
      ? `target ${rangeText({ start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 })}`
      : `removed after target ${String(hunk.targetStart)}`;
  const base =
    hunk.baseCount > 0 ? `base ${rangeText({ start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 })}` : '';
  return [target, base].filter((part) => part !== '').join(' · ');
}

function planText(state: PlanState): string {
  return state === 'full' ? 'yes' : state === 'partial' ? 'partly' : 'no';
}

function findStep(bundle: ReviewBundle, stepId: string | null): { walk: Walk; step: WalkStep; index: number } | null {
  if (stepId === null) {
    return null;
  }
  for (const walk of bundle.definition.walks) {
    const index = walk.steps.findIndex((step) => step.id === stepId);
    if (index !== -1) {
      const step = walk.steps[index];
      if (step !== undefined) {
        return { walk, step, index };
      }
    }
  }
  return null;
}

// --- File contents --------------------------------------------------------------

function useFiles(bridge: ReviewBridge | undefined): {
  get: (side: RevisionSide, path: string) => ReviewFileOutcome | null;
  load: (side: RevisionSide, path: string) => void;
} {
  const cache = useRef(new Map<string, ReviewFileOutcome>());
  const pending = useRef(new Set<string>());
  const [, setTick] = useState(0);
  const load = useCallback(
    (side: RevisionSide, path: string) => {
      const key = `${side}:${path}`;
      if (bridge === undefined || cache.current.has(key) || pending.current.has(key)) {
        return;
      }
      pending.current.add(key);
      void bridge.readFile(side, path).then((outcome) => {
        cache.current.set(key, outcome);
        pending.current.delete(key);
        setTick((value) => value + 1);
      });
    },
    [bridge],
  );
  const get = useCallback((side: RevisionSide, path: string) => cache.current.get(`${side}:${path}`) ?? null, []);
  return useMemo(() => ({ get, load }), [get, load]);
}

/** The side of a diff that does not exist (an added or a deleted file). */
const NO_LINES: ReviewFileOutcome = { kind: 'text', lines: [] };

// --- The view ----------------------------------------------------------------------

type LeftTab = 'walks' | 'files' | 'coverage' | 'notes' | 'browse';

export function ReviewView(): JSX.Element {
  const bridge = window.dspatchReview;
  const [outcome, setOutcome] = useState<ReviewOpenOutcome | null>(null);

  useEffect(() => {
    if (bridge === undefined) {
      setOutcome({ kind: 'failed', error: 'The review bridge is missing from this window (preload).' });
      return;
    }
    void bridge.initial().then(setOutcome);
  }, [bridge]);

  const choose = useCallback(() => {
    if (bridge !== undefined) {
      void bridge.choose().then((next) => {
        if (next.kind !== 'none') {
          setOutcome(next);
        }
      });
    }
  }, [bridge]);

  if (outcome === null) {
    return <div className="rv-empty">Opening the review…</div>;
  }
  if (outcome.kind !== 'opened') {
    return (
      <div className="rv-empty">
        <h1>Review</h1>
        <p className={outcome.kind === 'failed' ? 'rv-error' : ''}>
          {outcome.kind === 'failed' ? outcome.error : outcome.note}
        </p>
        <button type="button" onClick={choose}>
          Open a review definition…
        </button>
      </div>
    );
  }
  return <OpenReview key={outcome.bundle.definitionPath + outcome.bundle.target.sha} bundle={outcome.bundle} bridge={bridge} onChoose={choose} />;
}

function OpenReview({
  bundle,
  bridge,
  onChoose,
}: {
  readonly bundle: ReviewBundle;
  readonly bridge: ReviewBridge | undefined;
  readonly onChoose: () => void;
}): JSX.Element {
  const [state, setState] = useState<ReviewState>(bundle.state);
  const [save, setSave] = useState<{ at: string; error?: string } | null>(
    bundle.state.savedAt === '' ? null : { at: bundle.state.savedAt },
  );
  const [tab, setTab] = useState<LeftTab>('walks');
  const [selection, setSelection] = useState<CodeLocation | null>(null);
  const files = useFiles(bridge);

  // Persist every change. The record is the reviewer's: decisions, notes and walked
  // marks are written at once; moving around is written shortly after. Whatever is
  // still unsaved is written when the view goes away or the window unloads, and a
  // failed save is shown, never swallowed.
  const latest = useRef(state);
  latest.current = state;
  const dirty = useRef(false);
  const urgent = useRef(false);
  const [saving, setSaving] = useState(false);
  const flush = useCallback(() => {
    if (!dirty.current || bridge === undefined) {
      return;
    }
    dirty.current = false;
    void bridge.saveState(latest.current).then(
      (result) => {
        if (!result.saved) {
          // Still unsaved: the next change, closing the view or unloading tries again.
          dirty.current = true;
        }
        setSaving(result.saved && dirty.current);
        setSave(result.saved ? { at: result.at } : { at: result.at, error: result.error ?? 'not saved' });
      },
      (error: unknown) => {
        dirty.current = true;
        setSaving(false);
        setSave({ at: new Date().toISOString(), error: String(error) });
      },
    );
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
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
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

  const coverage = useMemo(() => computeCoverage(bundle.definition, bundle.files, state), [bundle, state]);
  const coverageByHunk = useMemo(() => new Map(coverage.hunks.map((entry) => [entry.hunk.id, entry])), [coverage]);

  const refProblems = useMemo(() => {
    const map = new Map<string, string>();
    for (const problem of bundle.referenceProblems) {
      map.set(`${problem.stepId}#${String(problem.refIndex)}`, problem.problem);
    }
    return map;
  }, [bundle]);

  const current = findStep(bundle, state.position.stepId);
  const currentRef: CodeReference | null =
    current === null ? null : (current.step.refs[state.position.refIndex] ?? current.step.refs[0] ?? null);
  const away = state.position.away;
  const shownLocation: CodeLocation | null =
    away ?? (currentRef === null ? null : { path: currentRef.path, side: currentRef.side, start: currentRef.start, end: currentRef.end });

  // Showing a step's code is recorded as shown — per reference, and only that.
  const shownKey = current === null ? null : `${current.step.id}#${String(state.position.refIndex)}`;
  useEffect(() => {
    if (current === null || away !== null || shownKey === null) {
      return;
    }
    if (state.shownSteps[current.step.id] !== undefined && state.shownRefs[shownKey] !== undefined) {
      return;
    }
    const stepId = current.step.id;
    const at = new Date().toISOString();
    update((value) => ({
      ...value,
      shownSteps: value.shownSteps[stepId] === undefined ? { ...value.shownSteps, [stepId]: at } : value.shownSteps,
      shownRefs: value.shownRefs[shownKey] === undefined ? { ...value.shownRefs, [shownKey]: at } : value.shownRefs,
    }));
  }, [current, away, shownKey, state.shownSteps, state.shownRefs, update]);

  const goToStep = useCallback(
    (stepId: string, refIndex = 0) => {
      const found = findStep(bundle, stepId);
      if (found === null) {
        return;
      }
      setSelection(null);
      update((value) => ({
        ...value,
        position: { ...value.position, walkId: found.walk.id, stepId, refIndex, away: null },
      }));
    },
    [bundle, update],
  );

  const goAway = useCallback(
    (location: CodeLocation) => {
      setSelection(null);
      update((value) => ({ ...value, position: { ...value.position, away: location } }));
    },
    [update],
  );

  const returnToWalk = useCallback(() => {
    setSelection(null);
    update((value) => ({ ...value, position: { ...value.position, away: null } }));
  }, [update]);

  const setCodeMode = useCallback(
    (codeMode: 'diff' | 'file') => {
      update((value) => ({ ...value, position: { ...value.position, codeMode } }));
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
      record((value) => ({
        ...value,
        decisions: [
          ...value.decisions,
          {
            ...decision,
            id: newId(),
            at: new Date().toISOString(),
            by: { kind: 'human' },
            revisions: value.revisions,
          },
        ],
      }));
    },
    [record],
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

  const diffFile = shownLocation === null ? null : (bundle.files.find((file) => file.path === shownLocation.path) ?? null);

  return (
    <div className="rv">
      <Header bundle={bundle} save={save} saving={saving} coverage={coverage} onChoose={onChoose} />
      <div className={tab === 'coverage' || tab === 'notes' ? 'rv-body rv-body-wide' : 'rv-body'}>
        <nav className="rv-left">
          <div className="rv-tabs" role="tablist">
            {(
              [
                ['walks', 'Walks'],
                ['files', `Changed files (${String(bundle.files.length)})`],
                ['coverage', 'Coverage'],
                ['notes', `Notes & decisions (${String(state.notes.length + state.decisions.length)})`],
                ['browse', 'Search & all files'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? 'rv-tab rv-tab-on' : 'rv-tab'}
                onClick={() => {
                  setTab(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rv-left-body">
            {tab === 'walks' && (
              <WalkList bundle={bundle} state={state} refProblems={refProblems} onStep={goToStep} />
            )}
            {tab === 'files' && (
              <FileList
                files={bundle.files}
                coverage={coverageByHunk}
                current={shownLocation?.path ?? null}
                onOpen={(file) => {
                  const hunk = file.hunks[0];
                  goAway(
                    hunk === undefined
                      ? { path: file.path, side: file.status === 'deleted' ? 'base' : 'target', start: 1, end: 1 }
                      : hunkLocation(hunk),
                  );
                }}
              />
            )}
            {tab === 'coverage' && (
              <CoverageTable
                coverage={coverage}
                bundle={bundle}
                onOpen={(hunk) => {
                  goAway(hunkLocation(hunk));
                }}
              />
            )}
            {tab === 'notes' && (
              <NotesList
                state={state}
                bundle={bundle}
                onOpen={(location) => {
                  goAway(location);
                }}
                onStatus={setNoteStatus}
              />
            )}
            {tab === 'browse' && bridge !== undefined && (
              <Browse
                bridge={bridge}
                onOpen={(location) => {
                  goAway(location);
                }}
              />
            )}
          </div>
        </nav>

        <main className="rv-code">
          {away !== null && current !== null && (
            <div className="rv-away">
              Outside the walk: {locationText(away)}.{' '}
              <button type="button" onClick={returnToWalk}>
                Back to {current.step.id}
              </button>
            </div>
          )}
          {shownLocation === null ? (
            <div className="rv-empty">Choose a walk step, a changed file or a search result.</div>
          ) : (
            <CodePane
              location={shownLocation}
              diffFile={diffFile}
              mode={state.position.codeMode}
              onMode={setCodeMode}
              files={files}
              coverage={coverageByHunk}
              decisions={state.decisions}
              selection={selection}
              onSelect={setSelection}
              onDecide={decide}
              revisions={`${short(bundle.base.sha)}→${short(bundle.target.sha)}`}
            />
          )}
        </main>

        <aside className="rv-right">
          {current !== null && (
            <StepPanel
              bundle={bundle}
              walk={current.walk}
              step={current.step}
              index={current.index}
              state={state}
              refIndex={state.position.refIndex}
              refProblems={refProblems}
              isAway={away !== null}
              onRef={(refIndex) => {
                goToStep(current.step.id, refIndex);
              }}
              onStep={goToStep}
              onToggleWalked={toggleWalked}
            />
          )}
          <NoteForm
            selection={selection}
            shown={shownLocation}
            stepId={away === null ? (current?.step.id ?? null) : null}
            onAdd={addNote}
          />
          <NotesHere
            notes={state.notes}
            location={shownLocation}
            stepId={current?.step.id ?? null}
            onOpen={goAway}
          />
        </aside>
      </div>
    </div>
  );
}

function hunkLocation(hunk: DiffHunk): CodeLocation {
  return hunk.targetCount > 0
    ? { path: hunk.path, side: 'target', start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 }
    : { path: hunk.path, side: 'base', start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 };
}

// --- Header -----------------------------------------------------------------------

function Header({
  bundle,
  save,
  saving,
  coverage,
  onChoose,
}: {
  readonly bundle: ReviewBundle;
  readonly save: { at: string; error?: string } | null;
  readonly saving: boolean;
  readonly coverage: CoverageSummary;
  readonly onChoose: () => void;
}): JSX.Element {
  const [details, setDetails] = useState(false);
  const problems = bundle.definitionProblems.length + bundle.referenceProblems.length;
  const references = bundle.definition.walks.flatMap((walk) => walk.steps.flatMap((step) => step.refs));
  const referenceCount = references.length;
  const anchoredCount = references.filter((ref) => ref.anchor !== undefined).length;
  return (
    <header className="rv-header">
      <div className="rv-identity">
        <h1>{bundle.definition.title}</h1>
        <div className="rv-revs">
          <span title={`${bundle.base.sha}\n${bundle.base.subject}`}>
            base <code>{short(bundle.base.sha)}</code> {bundle.base.subject}
          </span>
          <span className="rv-arrow">→</span>
          <span title={`${bundle.target.sha}\n${bundle.target.subject}`}>
            target <code>{short(bundle.target.sha)}</code> {bundle.target.subject}
          </span>
          <span className="rv-chip">
            {bundle.singleCommit ? 'one commit (base is the parent)' : 'several commits between base and target'}
          </span>
        </div>
        <div className="rv-sub">
          Repository <code>{bundle.repository}</code> · {bundle.files.length} files · +
          {bundle.files.reduce((total, file) => total + file.added, 0)} −
          {bundle.files.reduce((total, file) => total + file.deleted, 0)} lines · read from git at these two
          commits, not from a working tree
        </div>
      </div>
      <div className="rv-header-side">
        <div className={save?.error !== undefined ? 'rv-error' : saving ? 'rv-sub' : 'rv-saved'} role="status">
          {save?.error !== undefined
            ? `Record NOT saved — your latest changes exist only in this window and are retried with the next change. Reason: ${save.error}`
            : saving
              ? 'Saving…'
              : save === null
                ? 'Nothing recorded yet'
                : `Record saved ${timeOf(save.at)}`}
        </div>
        <div className="rv-sub">
          Open findings {coverage.openFindings} · open questions {coverage.openQuestions}
        </div>
        <button type="button" onClick={onChoose}>
          Open another review…
        </button>
        <button
          type="button"
          onClick={() => {
            setDetails(!details);
          }}
        >
          {details ? 'Hide' : 'About this review'}
          {problems > 0 ? ` (${String(problems)} problems)` : ''}
        </button>
      </div>
      {(details || bundle.stateNote !== '') && (
        <div className="rv-details">
          {bundle.stateNote !== '' && <p className="rv-warn">{bundle.stateNote}</p>}
          {details && (
            <>
              <p>
                <strong>Definition:</strong> <code>{bundle.definitionPath}</code>
              </p>
              <p>{bundle.definition.provenance}</p>
              <p>
                <strong>Explanations</strong> are prepared text, written in the teaching mode “
                {bundle.definition.teachingMode || 'unstated'}”. This view does not adapt them, and no agent is
                connected to it. Review depth is your choice; nothing on screen changes with it.
              </p>
              <p>
                <strong>Decisions</strong> are yours only (provenance “you”). Delegated agent review is not available
                here and is never simulated.
              </p>
              {problems === 0 ? (
                <p>
                  All {referenceCount} walk references were checked against their revision for path and line
                  range; {anchoredCount} of them also for their anchor text.
                </p>
              ) : (
                <ul className="rv-error">
                  {bundle.definitionProblems.map((problem) => (
                    <li key={`${problem.where}${problem.problem}`}>
                      {problem.where}: {problem.problem}
                    </li>
                  ))}
                  {bundle.referenceProblems.map((problem) => (
                    <li key={`${problem.stepId}#${String(problem.refIndex)}`}>
                      {problem.stepId} reference {problem.refIndex + 1}: {problem.problem}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
}

// --- Left column ----------------------------------------------------------------------

function WalkList({
  bundle,
  state,
  refProblems,
  onStep,
}: {
  readonly bundle: ReviewBundle;
  readonly state: ReviewState;
  readonly refProblems: ReadonlyMap<string, string>;
  readonly onStep: (stepId: string) => void;
}): JSX.Element {
  return (
    <div className="rv-walks">
      <p className="rv-legend">
        <span className="rv-mark-shown">●</span> opened <span className="rv-mark-walked">✓</span> marked walked
        through by you. Neither is a review decision.
      </p>
      {bundle.definition.walks.map((walk) => (
        <section key={walk.id} className="rv-walk">
          <h2>
            {walk.id} — {walk.title}
          </h2>
          <p className="rv-question">{walk.question}</p>
          <ol>
            {walk.steps.map((step) => {
              const active = state.position.stepId === step.id;
              const problem = step.refs.some((_, index) => refProblems.has(`${step.id}#${String(index)}`));
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={active ? 'rv-step rv-step-on' : 'rv-step'}
                    onClick={() => {
                      onStep(step.id);
                    }}
                  >
                    <span className="rv-step-marks">
                      <span className={state.shownSteps[step.id] === undefined ? 'rv-mark-off' : 'rv-mark-shown'}>●</span>
                      <span className={state.walkedSteps[step.id] === undefined ? 'rv-mark-off' : 'rv-mark-walked'}>✓</span>
                    </span>
                    <span className="rv-step-id">{step.id}</span> {step.title}
                    {problem && <span className="rv-error"> (reference problem)</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function fileDecisionSummary(file: DiffFile, coverage: ReadonlyMap<string, HunkCoverage>): string {
  let accepted = 0;
  let exempted = 0;
  let planned = 0;
  for (const hunk of file.hunks) {
    const entry = coverage.get(hunk.id);
    if (entry?.decision?.outcome === 'accepted') {
      accepted += 1;
    } else if (entry?.decision?.outcome === 'exempted') {
      exempted += 1;
    }
    if (entry !== undefined && entry.planned !== 'none') {
      planned += 1;
    }
  }
  const remaining = file.hunks.length - accepted - exempted;
  return `${String(planned)}/${String(file.hunks.length)} hunks in a walk · accepted ${String(accepted)} · exempted ${String(exempted)} · remaining ${String(remaining)}`;
}

function FileList({
  files,
  coverage,
  current,
  onOpen,
}: {
  readonly files: readonly DiffFile[];
  readonly coverage: ReadonlyMap<string, HunkCoverage>;
  readonly current: string | null;
  readonly onOpen: (file: DiffFile) => void;
}): JSX.Element {
  return (
    <ul className="rv-files">
      {files.map((file) => (
        <li key={file.path}>
          <button
            type="button"
            className={current === file.path ? 'rv-file rv-file-on' : 'rv-file'}
            onClick={() => {
              onOpen(file);
            }}
          >
            <span className={`rv-status rv-status-${file.status}`}>{file.status.charAt(0).toUpperCase()}</span>{' '}
            <span className="rv-path">{file.path}</span>
            <span className="rv-sub">
              +{file.added} −{file.deleted} · {file.binary ? 'binary' : `${String(file.hunks.length)} hunks`} ·{' '}
              {fileDecisionSummary(file, coverage)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CoverageTable({
  coverage,
  bundle,
  onOpen,
}: {
  readonly coverage: CoverageSummary;
  readonly bundle: ReviewBundle;
  readonly onOpen: (hunk: DiffHunk) => void;
}): JSX.Element {
  const [onlyOutside, setOnlyOutside] = useState(false);
  const rows = onlyOutside ? coverage.hunks.filter((entry) => entry.planned === 'none') : coverage.hunks;
  const outside = coverage.hunks.filter((entry) => entry.planned === 'none');
  return (
    <div className="rv-coverage">
      <p className="rv-legend">
        Counted in changed lines of the diff (additions + deletions): <strong>{coverage.totalLines}</strong>. Each
        column is a separate fact; none of them implies another.
      </p>
      <table className="rv-totals">
        <tbody>
          <tr>
            <th>Planned in a walk</th>
            <td>
              {coverage.plannedLines.full} lines
              {coverage.plannedLines.partialHunks > 0 ? ` + ${String(coverage.plannedLines.partialHunks)} hunks partly` : ''}
            </td>
          </tr>
          <tr>
            <th>In walk references you opened</th>
            <td>
              {coverage.shownLines.full} lines
              {coverage.shownLines.partialHunks > 0 ? ` + ${String(coverage.shownLines.partialHunks)} hunks partly` : ''}
            </td>
          </tr>
          <tr>
            <th>In steps you marked walked through</th>
            <td>
              {coverage.walkedLines.full} lines
              {coverage.walkedLines.partialHunks > 0 ? ` + ${String(coverage.walkedLines.partialHunks)} hunks partly` : ''}
            </td>
          </tr>
          <tr>
            <th>Accepted by you @ {short(bundle.target.sha)}</th>
            <td>{coverage.acceptedLines} lines</td>
          </tr>
          <tr>
            <th>Exempted by you</th>
            <td>{coverage.exemptedLines} lines</td>
          </tr>
          <tr>
            <th>No decision (remaining)</th>
            <td>{coverage.remainingLines} lines</td>
          </tr>
          <tr>
            <th>Accepted by an agent</th>
            <td>none — no delegated review in this view</td>
          </tr>
          <tr>
            <th>Open findings / questions</th>
            <td>
              {coverage.openFindings} / {coverage.openQuestions}
            </td>
          </tr>
        </tbody>
      </table>
      <label className="rv-check">
        <input
          type="checkbox"
          checked={onlyOutside}
          onChange={(event) => {
            setOnlyOutside(event.target.checked);
          }}
        />{' '}
        Only hunks outside every walk ({outside.length})
      </label>
      <table className="rv-hunks">
        <thead>
          <tr>
            <th>Hunk</th>
            <th>Lines</th>
            <th>Planned</th>
            <th>Opened</th>
            <th>Walked</th>
            <th>Decision</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr
              key={entry.hunk.id}
              className="rv-hunk-row"
              onClick={() => {
                onOpen(entry.hunk);
              }}
            >
              <td>
                <span className="rv-step-id">{entry.hunk.id}</span> {entry.hunk.path.split('/').pop()}{' '}
                <span className="rv-sub">{hunkRangeText(entry.hunk)}</span>
              </td>
              <td>{entry.lines}</td>
              <td title={entry.plannedBy.join(', ')}>
                {planText(entry.planned)}
                {entry.plannedBy.length > 0 ? ` (${entry.plannedBy.join(', ')})` : ''}
              </td>
              <td>{planText(entry.shown)}</td>
              <td>{planText(entry.walked)}</td>
              <td>{decisionText(entry.decision)}</td>
              <td>
                {entry.openFindings > 0 ? `${String(entry.openFindings)} finding(s) ` : ''}
                {entry.openQuestions > 0 ? `${String(entry.openQuestions)} question(s)` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function decisionText(decision: ReviewDecision | null): string {
  if (decision === null) {
    return 'remaining';
  }
  return decision.outcome === 'accepted' ? 'accepted by you' : decision.outcome === 'exempted' ? 'exempted by you' : 'remaining';
}

function NotesList({
  state,
  bundle,
  onOpen,
  onStatus,
}: {
  readonly state: ReviewState;
  readonly bundle: ReviewBundle;
  readonly onOpen: (location: CodeLocation) => void;
  readonly onStatus: (id: string, status: 'open' | 'resolved', resolution: string) => void;
}): JSX.Element {
  const hunkById = new Map(bundle.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)));
  return (
    <div className="rv-notes">
      <h2>Questions and findings</h2>
      {state.notes.length === 0 && <p className="rv-sub">None yet.</p>}
      {state.notes.map((note) => (
        <NoteItem key={note.id} note={note} onOpen={onOpen} onStatus={onStatus} />
      ))}
      <h2>Decision history</h2>
      {state.decisions.length === 0 && <p className="rv-sub">No decisions. Every hunk is remaining.</p>}
      <ol className="rv-history">
        {state.decisions.map((decision) => (
          <li key={decision.id}>
            <strong>{decision.outcome === 'withdrawn' ? 'Withdrawn' : decision.outcome === 'accepted' ? 'Accepted' : 'Exempted'}</strong>{' '}
            by {decision.by.kind === 'human' ? 'you' : `agent ${decision.by.adapterId}`} at {timeOf(decision.at)} ·{' '}
            {decision.scope.kind === 'hunk'
              ? `${decision.scope.hunkId} ${decision.scope.path} ${(() => {
                  const hunk = hunkById.get(decision.scope.hunkId);
                  return hunk === undefined ? '' : hunkRangeText(hunk);
                })()}`
              : `file ${decision.scope.path} (${decision.scope.hunkIds.join(', ')})`}{' '}
            @ {short(decision.revisions.base)}→{short(decision.revisions.target)}
            {decision.reason !== '' && <div className="rv-sub">Reason: {decision.reason}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function NoteItem({
  note,
  onOpen,
  onStatus,
}: {
  readonly note: ReviewNote;
  readonly onOpen: (location: CodeLocation) => void;
  readonly onStatus: (id: string, status: 'open' | 'resolved', resolution: string) => void;
}): JSX.Element {
  const [resolution, setResolution] = useState(note.resolution);
  return (
    <div className={`rv-note rv-note-${note.kind} rv-note-${note.status}`}>
      <div>
        <strong>{note.kind === 'finding' ? 'Finding' : 'Question'}</strong> · {note.status} ·{' '}
        <span className="rv-sub">{timeOf(note.createdAt)}</span>
        {note.stepId !== null && <span className="rv-sub"> · during {note.stepId}</span>}
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
          {locationText(note.location)}
        </button>
      )}
      <div className="rv-note-actions">
        <input
          value={resolution}
          placeholder={note.status === 'open' ? 'Answer or resolution (optional)' : 'Resolution'}
          onChange={(event) => {
            setResolution(event.target.value);
          }}
        />
        {note.status === 'open' ? (
          <button
            type="button"
            onClick={() => {
              onStatus(note.id, 'resolved', resolution);
            }}
          >
            Mark resolved
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onStatus(note.id, 'open', resolution);
            }}
          >
            Reopen
          </button>
        )}
      </div>
    </div>
  );
}

function Browse({
  bridge,
  onOpen,
}: {
  readonly bridge: ReviewBridge;
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
        Revision:{' '}
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
            {value}
          </label>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void bridge.search(side, query).then(setResult);
        }}
      >
        <input
          value={query}
          placeholder="Search text in the repository (git grep)"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <button type="submit">Search</button>
      </form>
      {result !== null && (
        <div className="rv-hits">
          {result.error !== undefined && <p className="rv-error">{result.error}</p>}
          <p className="rv-sub">
            {result.hits.length} hits{result.truncated ? ' (first 500 only)' : ''}
          </p>
          <ul>
            {result.hits.map((hit) => (
              <li key={`${hit.path}:${String(hit.line)}`}>
                <button
                  type="button"
                  className="rv-link"
                  onClick={() => {
                    onOpen({ path: hit.path, side, start: hit.line, end: hit.line });
                  }}
                >
                  {hit.path}:{hit.line}
                </button>
                <code className="rv-hit-text">{hit.text.trim()}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <input
        value={filter}
        placeholder={`Filter all ${String(all.length)} files at ${side}`}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <ul className="rv-all-files">
        {filtered.map((entry) => (
          <li key={entry}>
            <button
              type="button"
              className="rv-link"
              onClick={() => {
                onOpen({ path: entry, side, start: 1, end: 1 });
              }}
            >
              {entry}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Right column ---------------------------------------------------------------------

function StepPanel({
  bundle,
  walk,
  step,
  index,
  state,
  refIndex,
  refProblems,
  isAway,
  onRef,
  onStep,
  onToggleWalked,
}: {
  readonly bundle: ReviewBundle;
  readonly walk: Walk;
  readonly step: WalkStep;
  readonly index: number;
  readonly state: ReviewState;
  readonly refIndex: number;
  readonly refProblems: ReadonlyMap<string, string>;
  readonly isAway: boolean;
  readonly onRef: (refIndex: number) => void;
  readonly onStep: (stepId: string) => void;
  readonly onToggleWalked: (stepId: string) => void;
}): JSX.Element {
  const previous = walk.steps[index - 1];
  const next = walk.steps[index + 1];
  const walkIndex = bundle.definition.walks.indexOf(walk);
  const nextWalk = bundle.definition.walks[walkIndex + 1];
  const walked = state.walkedSteps[step.id];
  return (
    <section className={isAway ? 'rv-step-panel rv-step-panel-away' : 'rv-step-panel'}>
      <div className="rv-walk-title">
        {walk.id} — {walk.title}
      </div>
      <h2>
        <span className="rv-step-id">{step.id}</span> {step.title}{' '}
        <span className="rv-sub">
          ({index + 1}/{walk.steps.length})
        </span>
      </h2>
      <Markdown text={step.text} />
      {step.claims.length > 0 && (
        <ul className="rv-claims">
          {step.claims.map((claim) => (
            <li key={claim.text}>
              <span className={`rv-label rv-label-${claim.label}`} title={LABEL_HELP[claim.label]}>
                {LABEL_TEXT[claim.label]}
              </span>{' '}
              <Markdown text={claim.text} />
            </li>
          ))}
        </ul>
      )}
      <div className="rv-refs">
        <div className="rv-sub">Code for this step (click to show):</div>
        <ul>
          {step.refs.map((ref, position) => {
            const problem = refProblems.get(`${step.id}#${String(position)}`);
            return (
              <li key={`${ref.path}:${String(ref.start)}:${String(position)}`}>
                <button
                  type="button"
                  className={!isAway && position === refIndex ? 'rv-ref rv-ref-on' : 'rv-ref'}
                  onClick={() => {
                    onRef(position);
                  }}
                >
                  <span className={`rv-role rv-role-${ref.role}`}>{ref.role}</span> {ref.path}:{rangeText(ref)}{' '}
                  <span className="rv-sub">{ref.side}</span>
                  {ref.note !== undefined && <span className="rv-ref-note"> — {ref.note}</span>}
                </button>
                {problem !== undefined && <div className="rv-error">Invalid reference: {problem}</div>}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rv-step-nav">
        <button
          type="button"
          disabled={previous === undefined}
          onClick={() => {
            if (previous !== undefined) {
              onStep(previous.id);
            }
          }}
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={next === undefined && nextWalk === undefined}
          onClick={() => {
            const target = next ?? nextWalk?.steps[0];
            if (target !== undefined) {
              onStep(target.id);
            }
          }}
        >
          {next === undefined && nextWalk !== undefined ? `Next walk (${nextWalk.id}) →` : 'Next →'}
        </button>
      </div>
      <p className="rv-sub">Moving between steps records only which step and code you opened. It approves nothing.</p>
      <div className="rv-walked">
        <button
          type="button"
          onClick={() => {
            onToggleWalked(step.id);
          }}
        >
          {walked === undefined ? 'Mark this step walked through' : 'Walked through ✓ — undo'}
        </button>
        <span className="rv-sub">
          {state.shownSteps[step.id] === undefined ? '' : `First opened ${timeOf(state.shownSteps[step.id] ?? '')}. `}
          Walked through is your note of progress, not acceptance.
        </span>
      </div>
    </section>
  );
}

function NoteForm({
  selection,
  shown,
  stepId,
  onAdd,
}: {
  readonly selection: CodeLocation | null;
  readonly shown: CodeLocation | null;
  readonly stepId: string | null;
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
            <input
              type="radio"
              checked={kind === value}
              onChange={() => {
                setKind(value);
              }}
            />{' '}
            {value === 'question' ? 'Question' : 'Finding'}
          </label>
        ))}
      </div>
      <textarea
        value={text}
        rows={3}
        placeholder={kind === 'question' ? 'Your question…' : 'What is wrong, and why…'}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="rv-sub">
        At: {location === null ? 'no code location' : locationText(location)}
        {selection === null ? ' (click line numbers to choose lines; shift-click extends)' : ' (your selection)'}
      </div>
      <button type="submit" disabled={text.trim() === ''}>
        Add {kind}
      </button>
    </form>
  );
}

function NotesHere({
  notes,
  location,
  stepId,
  onOpen,
}: {
  readonly notes: readonly ReviewNote[];
  readonly location: CodeLocation | null;
  readonly stepId: string | null;
  readonly onOpen: (location: CodeLocation) => void;
}): JSX.Element | null {
  const here = notes.filter(
    (note) => (stepId !== null && note.stepId === stepId) || (location !== null && note.location?.path === location.path),
  );
  if (here.length === 0) {
    return null;
  }
  return (
    <div className="rv-notes-here">
      <div className="rv-sub">Notes on this step or file:</div>
      {here.map((note) => (
        <div key={note.id} className={`rv-note rv-note-${note.kind} rv-note-${note.status}`}>
          <strong>{note.kind === 'finding' ? 'Finding' : 'Question'}</strong> ({note.status}): {note.text}{' '}
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
              {note.location.path.split('/').pop()}:{rangeText(note.location)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Code ---------------------------------------------------------------------------------

function TokensView({ tokens }: { readonly tokens: readonly Token[] | undefined }): JSX.Element {
  if (tokens === undefined) {
    return <></>;
  }
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`rv-tk-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

function inRange(location: CodeLocation | null, side: RevisionSide, line: number | null, path: string): boolean {
  return (
    location !== null &&
    line !== null &&
    location.path === path &&
    location.side === side &&
    location.start <= line &&
    line <= location.end
  );
}

function CodePane({
  location,
  diffFile,
  mode,
  onMode,
  files,
  coverage,
  decisions,
  selection,
  onSelect,
  onDecide,
  revisions,
}: {
  readonly location: CodeLocation;
  readonly diffFile: DiffFile | null;
  readonly mode: 'diff' | 'file';
  readonly onMode: (mode: 'diff' | 'file') => void;
  readonly files: ReturnType<typeof useFiles>;
  readonly coverage: ReadonlyMap<string, HunkCoverage>;
  readonly decisions: readonly ReviewDecision[];
  readonly selection: CodeLocation | null;
  readonly onSelect: (location: CodeLocation | null) => void;
  readonly onDecide: (decision: Omit<ReviewDecision, 'id' | 'at' | 'by' | 'revisions'>) => void;
  readonly revisions: string;
}): JSX.Element {
  const [whole, setWhole] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [fileSide, setFileSide] = useState<RevisionSide>(location.side);
  const showDiff = diffFile !== null && !diffFile.binary && mode === 'diff';
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFileSide(location.side);
  }, [location.path, location.side, location.start]);

  const needBase = showDiff ? diffFile.status !== 'added' : fileSide === 'base';
  const needTarget = showDiff ? diffFile.status !== 'deleted' : fileSide === 'target';
  useEffect(() => {
    if (needBase) {
      files.load('base', location.path);
    }
    if (needTarget) {
      files.load('target', location.path);
    }
  }, [files, location.path, needBase, needTarget]);

  const base = needBase ? files.get('base', location.path) : NO_LINES;
  const target = needTarget ? files.get('target', location.path) : NO_LINES;

  const content = useMemo((): { rows: DiffRow[]; error: string | null } | null => {
    if (base === null || target === null) {
      return null;
    }
    if (base.kind === 'failed' || target.kind === 'failed') {
      return { rows: [], error: base.kind === 'failed' ? base.error : target.kind === 'failed' ? target.error : '' };
    }
    if (base.kind === 'binary' || target.kind === 'binary') {
      return { rows: [], error: 'Binary content is not shown.' };
    }
    const baseLines = base.kind === 'text' ? base.lines : [];
    const targetLines = target.kind === 'text' ? target.lines : [];
    if (showDiff) {
      try {
        return { rows: buildDiffRows(baseLines, targetLines, diffFile.hunks), error: null };
      } catch (error) {
        return { rows: [], error: error instanceof Error ? error.message : String(error) };
      }
    }
    const lines = fileSide === 'base' ? baseLines : targetLines;
    const missing = (fileSide === 'base' ? base : target).kind === 'missing';
    if (missing) {
      return { rows: [], error: `${location.path} does not exist at ${fileSide}.` };
    }
    return {
      rows: lines.map((text, index) => ({
        kind: 'context' as const,
        baseLine: fileSide === 'base' ? index + 1 : null,
        targetLine: fileSide === 'target' ? index + 1 : null,
        text,
        hunkId: null,
      })),
      error: null,
    };
  }, [base, target, showDiff, diffFile, fileSide, location.path]);

  const tokens = useMemo(() => {
    const baseLines = base?.kind === 'text' ? base.lines : [];
    const targetLines = target?.kind === 'text' ? target.lines : [];
    return {
      base: highlightLines(baseLines, location.path),
      target: highlightLines(targetLines, location.path),
    };
  }, [base, target, location.path]);

  // Which rows are visible: everything in whole-file mode; otherwise changed rows and
  // their context, the focus range, the selection and anything expanded by hand.
  const visible = useMemo(() => {
    const rows = content?.rows ?? [];
    if (!showDiff || whole) {
      return rows.map(() => true);
    }
    const keep = rows.map(() => false);
    rows.forEach((row, index) => {
      const focused =
        inRange(
          { ...location, start: location.start - FOCUS_MARGIN, end: location.end + FOCUS_MARGIN },
          'target',
          row.targetLine,
          location.path,
        ) ||
        inRange(
          { ...location, start: location.start - FOCUS_MARGIN, end: location.end + FOCUS_MARGIN },
          'base',
          row.baseLine,
          location.path,
        );
      if (row.kind !== 'context' || focused) {
        for (
          let near = Math.max(0, index - (focused ? 0 : CONTEXT_LINES));
          near <= Math.min(rows.length - 1, index + (focused ? 0 : CONTEXT_LINES));
          near += 1
        ) {
          keep[near] = true;
        }
      }
    });
    // Gaps the reviewer opened stay open; a gap is named by its first row.
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
      if (expanded.has(`${location.path}:${String(start)}`)) {
        keep.fill(true, start, index);
      }
    }
    return keep;
  }, [content, showDiff, whole, location, expanded]);

  // Scroll the focused lines into the middle of the pane once they exist.
  const focusKey = `${location.path}:${location.side}:${String(location.start)}:${mode}:${fileSide}`;
  const scrolledFor = useRef('');
  useLayoutEffect(() => {
    if (content === null || scrolledFor.current === focusKey) {
      return;
    }
    const element = container.current?.querySelector('[data-focus="1"]');
    if (element !== null && element !== undefined) {
      element.scrollIntoView({ block: 'center' });
      scrolledFor.current = focusKey;
    }
  });

  const currentDecisions = useMemo(() => currentHunkDecisions(decisions), [decisions]);

  const select = (row: DiffRow, extend: boolean): void => {
    const side: RevisionSide = row.targetLine !== null ? 'target' : 'base';
    const line = row.targetLine ?? row.baseLine;
    if (line === null) {
      return;
    }
    if (extend && selection !== null && selection.path === location.path && selection.side === side) {
      onSelect({ ...selection, start: Math.min(selection.start, line), end: Math.max(selection.end, line) });
    } else {
      onSelect({ path: location.path, side, start: line, end: line });
    }
  };

  const body: ReactNode[] = [];
  if (content !== null) {
    let firstFocus = true;
    let index = 0;
    let lastHunk: string | null = null;
    while (index < content.rows.length) {
      if (visible[index] !== true) {
        const start = index;
        while (index < content.rows.length && visible[index] !== true) {
          index += 1;
        }
        const key = `${location.path}:${String(start)}`;
        {
          body.push(
            <div key={`gap-${String(start)}`} className="rv-gap">
              <button
                type="button"
                onClick={() => {
                  setExpanded(new Set([...expanded, key]));
                }}
              >
                ⋯ show {index - start} unchanged lines
              </button>
            </div>,
          );
        }
        continue;
      }
      const row = content.rows[index];
      if (row === undefined) {
        break;
      }
      if (row.hunkId !== null && row.hunkId !== lastHunk) {
        const hunk = diffFile?.hunks.find((entry) => entry.id === row.hunkId);
        const entry = coverage.get(row.hunkId);
        if (hunk !== undefined && entry !== undefined) {
          body.push(
            <HunkBar
              key={`hunk-${hunk.id}`}
              hunk={hunk}
              entry={entry}
              decision={currentDecisions.get(hunk.id) ?? null}
              onDecide={onDecide}
              revisions={revisions}
            />,
          );
        }
      }
      lastHunk = row.hunkId;
      const side: RevisionSide = row.targetLine !== null ? 'target' : 'base';
      const focused =
        inRange(location, 'target', row.targetLine, location.path) || inRange(location, 'base', row.baseLine, location.path);
      const selected =
        inRange(selection, 'target', row.targetLine, location.path) || inRange(selection, 'base', row.baseLine, location.path);
      const lineTokens = side === 'target' ? tokens.target[(row.targetLine ?? 1) - 1] : tokens.base[(row.baseLine ?? 1) - 1];
      body.push(
        <div
          key={`row-${String(index)}`}
          className={`rv-row rv-row-${row.kind}${focused ? ' rv-row-focus' : ''}${selected ? ' rv-row-selected' : ''}`}
          {...(focused && firstFocus ? { 'data-focus': '1' } : {})}
        >
          <button
            type="button"
            className="rv-ln"
            title="Select this line for a note (shift-click to extend)"
            onClick={(event) => {
              select(row, event.shiftKey);
            }}
          >
            <span>{row.baseLine ?? ''}</span>
            <span>{row.targetLine ?? ''}</span>
          </button>
          <span className="rv-sign">{row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ' '}</span>
          <code className="rv-text">
            <TokensView tokens={lineTokens} />
          </code>
        </div>,
      );
      if (focused) {
        firstFocus = false;
      }
      index += 1;
    }
  }

  return (
    <div className="rv-code-pane">
      <div className="rv-code-bar">
        <span className="rv-path">{location.path}</span>
        {diffFile === null ? (
          <span className="rv-chip">not changed between base and target</span>
        ) : (
          <span className={`rv-chip rv-status-${diffFile.status}`}>{diffFile.status}</span>
        )}
        {diffFile !== null && !diffFile.binary && (
          <span className="rv-seg">
            <button type="button" className={mode === 'diff' ? 'rv-on' : ''} onClick={() => onMode('diff')}>
              Diff
            </button>
            <button type="button" className={mode === 'file' ? 'rv-on' : ''} onClick={() => onMode('file')}>
              File
            </button>
          </span>
        )}
        {(!showDiff) && (
          <span className="rv-seg">
            {(['target', 'base'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={fileSide === value ? 'rv-on' : ''}
                onClick={() => {
                  setFileSide(value);
                }}
              >
                {value}
              </button>
            ))}
          </span>
        )}
        {showDiff && (
          <label className="rv-check">
            <input
              type="checkbox"
              checked={whole}
              onChange={(event) => {
                setWhole(event.target.checked);
              }}
            />{' '}
            Whole file
          </label>
        )}
        <span className="rv-sub">
          {showDiff ? 'line numbers: base | target' : `whole file at ${fileSide}`} · highlighted:{' '}
          {location.side} {rangeText(location)}
        </span>
      </div>
      <div className="rv-lines" ref={container}>
        {content === null && <div className="rv-empty">Reading the file from git…</div>}
        {content?.error !== null && content?.error !== undefined && <div className="rv-error">{content.error}</div>}
        {body}
      </div>
    </div>
  );
}

function HunkBar({
  hunk,
  entry,
  decision,
  onDecide,
  revisions,
}: {
  readonly hunk: DiffHunk;
  readonly entry: HunkCoverage;
  readonly decision: ReviewDecision | null;
  readonly onDecide: (decision: Omit<ReviewDecision, 'id' | 'at' | 'by' | 'revisions'>) => void;
  readonly revisions: string;
}): JSX.Element {
  const [asking, setAsking] = useState<'accepted' | 'exempted' | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div className="rv-hunk-bar">
      <div>
        <span className="rv-step-id">{hunk.id}</span> {hunkRangeText(hunk)} · {entry.lines} changed lines · in a
        walk: {planText(entry.planned)}
        {entry.plannedBy.length > 0 ? ` (${entry.plannedBy.join(', ')})` : ''} · opened in walk: {planText(entry.shown)} ·
        walked: {planText(entry.walked)} ·{' '}
        <strong className={decision === null ? '' : `rv-decision-${decision.outcome}`}>{decisionText(decision)}</strong>
        {entry.openFindings > 0 && <span className="rv-error"> · {entry.openFindings} open finding(s)</span>}
        {asking === null && (
          <span className="rv-hunk-actions">
            {decision === null ? (
              <>
                <button type="button" onClick={() => setAsking('accepted')}>
                  Accept…
                </button>
                <button type="button" onClick={() => setAsking('exempted')}>
                  Exempt…
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onDecide({ scope: { kind: 'hunk', path: hunk.path, hunkId: hunk.id }, outcome: 'withdrawn', reason: '' });
                }}
              >
                Withdraw decision
              </button>
            )}
          </span>
        )}
      </div>
      {asking !== null && (
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
            {asking === 'accepted' ? 'Accept' : 'Exempt from review'} <strong>{hunk.id}</strong> — {hunk.path},{' '}
            {hunkRangeText(hunk)} — at <code>{revisions}</code>, as your own decision.
            {asking === 'accepted' && ' Acceptance covers this hunk at this revision pair only and is no guarantee of correctness.'}
          </div>
          <input
            value={reason}
            placeholder={asking === 'exempted' ? 'Reason (required)' : 'Comment (optional)'}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <button type="submit" disabled={asking === 'exempted' && reason.trim() === ''}>
            Confirm
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
