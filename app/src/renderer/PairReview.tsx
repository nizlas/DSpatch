/**
 * The diff review of a chosen revision pair (DSP-150), in a review window of its own.
 *
 * Niclas's decision of 28 October 2026: choose a repository, choose From and To in its
 * log, start from *Files changed*, open a file's diff side by side or unified, and mark
 * changed lines as reviewed or exempted. Code walks over the same pair open in further
 * windows and share what is marked here; they never move this view unless asked to with
 * *Show in diff*.
 *
 * Everything this view knows comes through `window.dspatchReviewPair`: the host runs git,
 * reads the two commits and keeps the record. Calm by design — no diagnostics, no test
 * controls, no explanations in the ordinary flow.
 */

import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';

import { delegatedReviewView } from '../shared/delegated-review-view';
import { highlightLines, type Token } from '../shared/review-model';
import {
  changedLinesOf,
  fileProgressOf,
  fileReviewFactsOf,
  changeMarksOf,
  generationStale,
  isPairError,
  lineKey,
  lineStatusesOf,
  rangesOf,
  shownPath,
  splitRowsOf,
  stripStatusOf,
  unifiedRowsOf,
  expandGap,
  gapHiding,
  MORE_LINES,
  NO_EXPANSION,
  CONTEXT_LINES,
  outsideFileKey,
  type FileExpansion,
  type GapRow,
  type ChangedLine,
  type DiffLocation,
  type AgentJob,
  type AgentJobRequestInput,
  type CodeSelection,
  type CodeSelectionRequest,
  type DelegationScope,
  type FileProgress,
  type FileReviewFacts,
  type OngoingReview,
  type LineRanges,
  type LineRange,
  type LineSide,
  type LineStatus,
  type LogCommit,
  type OpenPair,
  type PairFile,
  type PairPosition,
  type PairRecord,
  type ReviewPairBridge,
  type ReviewRepository,
  type StripStatus,
} from '../shared/review-pair';
import { TokensView } from './review-code';
import { AgentPicker, type AgentChoice } from './AgentPicker';
import { useDefaultProfile } from './presentation-choice';
import { PRESENTATION_INSTRUCTION_VERSION } from '../shared/presentation-profiles';
import type { SelectionQuote } from '../shared/review-discussion';
import type { PanelState } from '../shared/review-pair';
import { rangeInCell } from './walk-selection';
import { changedRangesOf } from '../shared/review-agent';
import { isRemaining, remainingInFile, remainingLine, reviewThreadsOf, threadCountsOf, type ReviewThread } from '../shared/review-threads';
import { PairKeyContext } from './DiscussionAnswer';
import { ThreadCard, ThreadContext, ThreadIndex, exchangesByThread, useDiscussionMessages, type ThreadActions } from './ReviewThreads';

declare global {
  interface Window {
    readonly dspatchReviewPair?: ReviewPairBridge;
    /** Read by the scripted review scenarios through the client; never shown. */
    __dspatchPairCheck?: PairCheck;
  }
}

/** What a scripted scenario may read of this window. */
export interface PairCheck {
  read(): Record<string, unknown>;
}

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'ongoing'; readonly reviews: readonly OngoingReview[]; readonly note: string | null }
  | { readonly kind: 'repositories'; readonly repositories: readonly ReviewRepository[] }
  | { readonly kind: 'log'; readonly repository: ReviewRepository; readonly several: boolean }
  | { readonly kind: 'review'; readonly open: OpenPair; readonly at: DiffLocation | null; readonly several: boolean; readonly repository: ReviewRepository };

function short(hash: string): string {
  return hash.slice(0, 7);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function PairReview(): JSX.Element {
  const bridge = window.dspatchReviewPair;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // The review this window left for the commit log or the list of reviews: the way back to it.
  const [left, setLeft] = useState<Extract<Phase, { kind: 'review' }> | null>(null);
  useEffect(() => {
    if (phase.kind === 'review') {
      setLeft(null);
    }
  }, [phase.kind]);

  const chooseRepository = useCallback(async (): Promise<void> => {
    if (bridge === undefined) {
      return;
    }
    const repositories = await bridge.repositories();
    if (repositories.length === 0) {
      setPhase({ kind: 'message', text: 'No Git repository was found in this workspace. Open a project that is a Git repository, or holds one.' });
    } else if (repositories.length === 1) {
      setPhase({ kind: 'log', repository: repositories[0] as ReviewRepository, several: false });
    } else {
      setPhase({ kind: 'repositories', repositories });
    }
  }, [bridge]);

  /**
   * The way into review: every review, open and closed, when there are any, with *Start a
   * new review* beside them; else straight to choosing a repository. Reading the list starts
   * nothing and sends nothing to an agent.
   */
  const showReviews = useCallback(
    async (note: string | null = null): Promise<void> => {
      if (bridge === undefined) {
        return;
      }
      const reviews = await bridge.ongoing().catch(() => []);
      if (reviews.length === 0 && note === null) {
        await chooseRepository();
      } else {
        setPhase({ kind: 'ongoing', reviews, note });
      }
    },
    [bridge, chooseRepository],
  );

  const resume = useCallback(
    async (review: OngoingReview): Promise<void> => {
      if (bridge === undefined) {
        return;
      }
      // DSP-186: exactly this review, a closed one becoming open again.
      const outcome = await bridge.open({ review: review.key });
      if (outcome.kind === 'opened') {
        const repository = { path: outcome.open.pair.repository, name: outcome.open.repositoryName };
        setPhase({ kind: 'review', open: outcome.open, at: null, several: true, repository });
      } else {
        await showReviews(outcome.kind === 'failed' ? outcome.error : outcome.note);
      }
    },
    [bridge, showReviews],
  );

  useEffect(() => {
    if (bridge === undefined) {
      setPhase({ kind: 'message', text: 'This window has no review connection.' });
      return;
    }
    void (async () => {
      const start = await bridge.start();
      if (start.kind === 'choose') {
        await showReviews();
        return;
      }
      const outcome = await bridge.open(start.review === undefined ? start.pair : { review: start.review });
      if (outcome.kind === 'opened') {
        const repository = { path: outcome.open.pair.repository, name: outcome.open.repositoryName };
        setPhase({ kind: 'review', open: outcome.open, at: start.at, several: false, repository });
      } else {
        setPhase({ kind: 'message', text: outcome.kind === 'failed' ? outcome.error : outcome.note });
      }
    })();
  }, [bridge, showReviews]);

  useEffect(() => {
    // The review installs its own, fuller reading; a parent effect runs after it and
    // must not replace it.
    if (phase.kind === 'review') {
      return;
    }
    window.__dspatchPairCheck = {
      read: () => ({
        phase: phase.kind,
        repositories: [...document.querySelectorAll<HTMLElement>('[data-ev^="pair-repo-"]')].map((row) => row.textContent ?? ''),
        ongoing: [...document.querySelectorAll<HTMLElement>('[data-ev^="pair-ongoing-open-"]')].map((row) => (row.innerText || '').replace(/\s+/g, ' ').trim()),
        ongoingNote: document.querySelector('[data-ev="pair-ongoing-note"]')?.textContent ?? '',
        heading: document.querySelector('.rv-pair-head h1')?.textContent ?? '',
        // Commits chosen in the log, and how many the log shows.
        chosen: document.querySelectorAll('.rv-pair-commit[aria-pressed="true"]').length,
        commits: document.querySelectorAll('.rv-pair-commit').length,
        // How the two chosen commits are ordered, as drawn: From and To, or the choice asked for.
        direction: document.querySelector<HTMLElement>('[data-ev="pair-picked"]')?.dataset['direction'] ?? null,
        from: document.querySelector('[data-ev="pair-from"] code')?.textContent ?? null,
        to: document.querySelector('[data-ev="pair-to"] code')?.textContent ?? null,
        reversed: document.querySelector('[data-ev="pair-reversed"]') !== null,
        directionAsked: document.querySelector('[data-ev="pair-direction"]')?.textContent ?? null,
        openEnabled: !(document.querySelector<HTMLButtonElement>('[data-ev="pair-open"]')?.disabled ?? true),
        log: [...document.querySelectorAll<HTMLElement>('.rv-pair-commit')].map((commit) => ({
          hash: commit.dataset['hash'] ?? '',
          subject: commit.querySelector('.rv-pair-commit-message')?.textContent?.split('\n')[0] ?? '',
          role: commit.querySelector('.rv-pair-role')?.textContent ?? null,
        })),
      }),
    };
    return () => {
      delete window.__dspatchPairCheck;
    };
  }, [phase]);

  if (bridge === undefined) {
    return <div className="rv rv-pair"><p className="rv-pair-message">This window has no review connection.</p></div>;
  }
  const backToReview = async (review: Extract<Phase, { kind: 'review' }>): Promise<void> => {
    const outcome = await bridge.open({ review: review.open.key });
    if (outcome.kind === 'opened') {
      setPhase({ ...review, open: outcome.open, at: null });
    } else {
      setPhase({ kind: 'message', text: outcome.kind === 'failed' ? outcome.error : outcome.note });
    }
  };
  const shown = (
    <>
      {phase.kind === 'loading' && <p className="rv-pair-message">Reading the workspace…</p>}
      {phase.kind === 'message' && <p className="rv-pair-message" data-ev="pair-message">{phase.text}</p>}
      {phase.kind === 'ongoing' && (
        <OngoingList
          reviews={phase.reviews}
          note={phase.note}
          onResume={(review) => void resume(review)}
          onNew={() => void chooseRepository()}
          onEnd={(review) => {
            if (left !== null && left.open.key === review.key) {
              setLeft(null);
            }
            void bridge.end(review.key).then((answer) => {
              void showReviews(isPairError(answer) ? answer.error : '');
            });
          }}
          onDelete={(review) => {
            if (left !== null && left.open.key === review.key) {
              setLeft(null);
            }
            void bridge.delete(review.key).then(
              (answer) => {
                void showReviews(isPairError(answer) ? answer.error : 'The review was deleted.');
              },
              (error: unknown) => {
                void showReviews(`The review could not be deleted: ${error instanceof Error ? error.message : String(error)}`);
              },
            );
          }}
        />
      )}
      {phase.kind === 'repositories' && (
        <RepositoryList
          repositories={phase.repositories}
          onChoose={(repository) => setPhase({ kind: 'log', repository, several: true })}
        />
      )}
      {phase.kind === 'log' && (
        <CommitLog
          bridge={bridge}
          repository={phase.repository}
          onBack={phase.several ? () => void chooseRepository() : null}
          onOpened={(open) => setPhase({ kind: 'review', open, at: null, several: phase.several, repository: phase.repository })}
          onFocused={(note) => setPhase({ kind: 'message', text: note })}
        />
      )}
      {phase.kind === 'review' && (
        <DiffReview
          key={phase.open.key}
          bridge={bridge}
          open={phase.open}
          initialAt={phase.at}
          onChangeRevisions={() => {
            setLeft(phase);
            setPhase({ kind: 'log', repository: phase.repository, several: phase.several });
          }}
          onAllReviews={() => {
            setLeft(phase);
            void showReviews('');
          }}
        />
      )}
    </>
  );
  return (
    <div className="rv rv-pair">
      {left !== null && phase.kind !== 'review' ? (
        <LeftReview review={left.open} onBack={() => void backToReview(left)}>
          {shown}
        </LeftReview>
      ) : (
        shown
      )}
    </div>
  );
}

// --- Choosing ---------------------------------------------------------------------------

/**
 * Every review (Niclas's trial feedback of 29 October and decision of 9 November 2026):
 * each is an instance of its own, opened where it was left, with its marks, explanations
 * and walks, without any agent work. Several can be open at once, also of one pair. *Close*
 * keeps a review for reopening and approves nothing; *Delete* removes that review's own
 * data, after asking, and nothing else.
 */
function OngoingList({
  reviews,
  note,
  onResume,
  onNew,
  onEnd,
  onDelete,
}: {
  readonly reviews: readonly OngoingReview[];
  readonly note: string | null;
  readonly onResume: (review: OngoingReview) => void;
  readonly onNew: () => void;
  readonly onEnd: (review: OngoingReview) => void;
  readonly onDelete: (review: OngoingReview) => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState<string | null>(null);
  const open = reviews.filter((review) => !review.closed);
  const closed = reviews.filter((review) => review.closed);
  const row = (review: OngoingReview, index: number, group: 'open' | 'closed'): JSX.Element => {
    const percent = review.total === 0 ? null : Math.floor((review.handled * 100) / review.total);
    const prefix = group === 'open' ? 'pair-ongoing' : 'pair-closed';
    return (
      <li key={review.key} className="rv-pair-ongoing-row" data-review={review.key}>
        <button type="button" className="rv-pair-ongoing-open" data-ev={`${prefix}-open-${String(index)}`} title={group === 'closed' ? 'Reopen this review where it was left' : undefined} onClick={() => onResume(review)}>
          <span className="rv-pair-ongoing-repo">{review.repositoryName}</span>
          <span className="rv-pair-ongoing-revs">
            <code>{short(review.base.hash)}</code> {review.base.subject}
            <span className="rv-pair-arrow" aria-hidden="true"> → </span>
            <code>{short(review.target.hash)}</code> {review.target.subject}
          </span>
          <span className="rv-pair-ongoing-progress">
            Started {formatDate(review.createdAt)} · {percent === null ? '' : `${String(percent)}% handled · `}
            {review.filesDone} of {review.files} {review.files === 1 ? 'file' : 'files'} done
            {review.stale ? ' · walks prepared with earlier settings' : ''}
          </span>
        </button>
        {confirming === review.key ? (
          <span className="rv-pair-confirm" data-ev={`${prefix}-confirm-${String(index)}`}>
            Delete this review with its walks, discussion and marks? The code is not touched.{' '}
            <button
              type="button"
              data-ev={`${prefix}-delete-yes-${String(index)}`}
              onClick={() => {
                setConfirming(null);
                onDelete(review);
              }}
            >
              Delete
            </button>{' '}
            <button type="button" className="rv-pair-link" data-ev={`${prefix}-delete-no-${String(index)}`} onClick={() => setConfirming(null)}>
              Keep it
            </button>
          </span>
        ) : (
          <>
            {group === 'open' ? (
              <button
                type="button"
                className="rv-pair-link"
                data-ev={`pair-ongoing-end-${String(index)}`}
                title="Keep it, closed, for reopening. Nothing is approved or deleted."
                onClick={() => onEnd(review)}
              >
                Close review
              </button>
            ) : (
              <button type="button" className="rv-pair-link" data-ev={`pair-closed-reopen-${String(index)}`} title="Reopen this review where it was left" onClick={() => onResume(review)}>
                Reopen
              </button>
            )}
            <button
              type="button"
              className="rv-pair-link"
              data-ev={`${prefix}-delete-${String(index)}`}
              title="Delete this review and only its own walks, discussion and marks"
              onClick={() => setConfirming(review.key)}
            >
              Delete…
            </button>
          </>
        )}
      </li>
    );
  };
  return (
    <div className="rv-pair-choose">
      <header className="rv-pair-head">
        <h1>Reviews</h1>
        <button type="button" className="rv-pair-primary" data-ev="pair-new-review" title="A new review starts empty, also of commits reviewed before" onClick={onNew}>
          Start a new review
        </button>
      </header>
      {note !== null && note !== '' && (
        <p className="rv-pair-hint" data-ev="pair-ongoing-note">
          {note}
        </p>
      )}
      {open.length === 0 ? (
        <p className="rv-pair-message">No open reviews.</p>
      ) : (
        <>
          <h2 className="rv-pair-section">Open</h2>
          <ul className="rv-pair-ongoing">{open.map((review, index) => row(review, index, 'open'))}</ul>
        </>
      )}
      {closed.length > 0 && (
        <>
          <h2 className="rv-pair-section">Closed</h2>
          <ul className="rv-pair-ongoing" data-ev="pair-closed-list">
            {closed.map((review, index) => row(review, index, 'closed'))}
          </ul>
        </>
      )}
    </div>
  );
}

function RepositoryList({
  repositories,
  onChoose,
}: {
  readonly repositories: readonly ReviewRepository[];
  readonly onChoose: (repository: ReviewRepository) => void;
}): JSX.Element {
  return (
    <div className="rv-pair-choose">
      <header className="rv-pair-head">
        <h1>Choose a repository</h1>
      </header>
      <ul className="rv-pair-repos">
        {repositories.map((repository, index) => (
          <li key={repository.path}>
            <button type="button" className="rv-pair-row" data-ev={`pair-repo-${String(index)}`} title={repository.path} onClick={() => onChoose(repository)}>
              {repository.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The direction of two chosen commits, as the log shows it. */
type ChosenDirection =
  | { readonly kind: 'none' }
  | { readonly kind: 'deciding' }
  /** From and To; `reversed` once the person reversed what ancestry gave. */
  | { readonly kind: 'ordered'; readonly base: string; readonly target: string; readonly reversed: boolean }
  /** Git could not order them: the person chooses. */
  | { readonly kind: 'choose'; readonly first: string; readonly second: string; readonly reason: string };

const ROLE_WORD = { from: 'From', to: 'To', chosen: 'Chosen' } as const;

/**
 * Where the review's panel is, as this window is told, and the room this view keeps for it
 * while it is docked here; the panel is drawn over the room.
 */
function usePanelRoom(): { readonly panelState: PanelState | null; readonly dockedHere: boolean; readonly roomRef: RefObject<HTMLDivElement | null> } {
  const panelBridge = window.dspatchReviewPanel;
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
  const dockedHere = panelState?.dockedHere === true;
  const roomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const room = roomRef.current;
    if (panelBridge === undefined || room === null || !dockedHere) {
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
  }, [panelBridge, dockedHere]);
  return { panelState, dockedHere, roomRef };
}

/**
 * Around the commit log and the list of reviews, once a review was left for them (Niclas's
 * trial, 30 October 2026): choosing nothing is always possible, and the review's panel stays
 * as it was, docked here or hidden, until another review is chosen.
 */
function LeftReview({ review, onBack, children }: { readonly review: OpenPair; readonly onBack: () => void; readonly children: ReactNode }): JSX.Element {
  const { panelState, dockedHere, roomRef } = usePanelRoom();
  return (
    <div className="rv-pair-main">
      <div className="rv-pair-left-body">
        <div className="rv-pair-left" data-ev="pair-left-review">
          <button type="button" data-ev="pair-back-review" onClick={onBack}>
            ← Back to {review.repositoryName} {short(review.pair.base)} → {short(review.pair.target)}
          </button>
          <button
            type="button"
            className={panelState?.visible === true ? undefined : 'rv-show-discussion'}
            data-ev="pair-left-discussion"
            title="The discussion of the review you left"
            onClick={() => void window.dspatchReviewPanel?.show(review.key, true)}
          >
            {panelState?.visible === true ? 'Discussion' : 'Show discussion'}
          </button>
        </div>
        {children}
      </div>
      {dockedHere && <div className="rv-pair-room" ref={roomRef} data-ev="panel-room" />}
    </div>
  );
}

function CommitLog({
  bridge,
  repository,
  onBack,
  onOpened,
  onFocused,
}: {
  readonly bridge: ReviewPairBridge;
  readonly repository: ReviewRepository;
  readonly onBack: (() => void) | null;
  readonly onOpened: (open: OpenPair) => void;
  readonly onFocused: (note: string) => void;
}): JSX.Element {
  const [commits, setCommits] = useState<readonly LogCommit[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The commits chosen, in click order: neither is From or To until Git's ancestry says
  // which came first (Niclas's decision after his trial, 29 October 2026).
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [direction, setDirection] = useState<ChosenDirection>({ kind: 'none' });
  const [opening, setOpening] = useState(false);
  // Every change of the chosen commits counts up, so a late answer about an earlier
  // choice is dropped rather than written over a newer one.
  const asked = useRef(0);
  const pending = useRef<Promise<ChosenDirection> | null>(null);

  const load = useCallback(
    async (skip: number): Promise<void> => {
      const page = await bridge.log(repository.path, skip);
      if (isPairError(page)) {
        setError(page.error);
        setLoaded(true);
        return;
      }
      setCommits((before) => (skip === 0 ? page.commits : [...before, ...page.commits]));
      setMore(page.more);
      // Nothing starts chosen when the log opens: the person chooses the comparison.
      // Choosing a pair reviewed before brings its marks back from its record.
      setLoaded(true);
    },
    [bridge, repository.path],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const decide = (first: string, second: string): void => {
    const ask = ++asked.current;
    setDirection({ kind: 'deciding' });
    const answer = bridge.direction(repository.path, first, second).then(
      (found): ChosenDirection => {
        if (isPairError(found)) {
          return { kind: 'choose', first, second, reason: 'The order of these commits could not be read.' };
        }
        if (found.kind === 'ordered') {
          return { kind: 'ordered', base: found.base, target: found.target, reversed: false };
        }
        return {
          kind: 'choose',
          first,
          second,
          reason: found.kind === 'unrelated' ? 'Neither commit comes before the other; they are on separate branches.' : found.reason,
        };
      },
      (): ChosenDirection => ({ kind: 'choose', first, second, reason: 'The order of these commits could not be read.' }),
    );
    pending.current = answer;
    void answer.then((found) => {
      if (ask === asked.current) {
        setDirection(found);
      }
    });
  };

  const choose = (hash: string): void => {
    setError(null);
    const next = picked.includes(hash) ? picked.filter((one) => one !== hash) : picked.length < 2 ? [...picked, hash] : [hash];
    setPicked(next);
    const [first, second] = next;
    if (first !== undefined && second !== undefined) {
      decide(first, second);
    } else {
      asked.current += 1;
      pending.current = null;
      setDirection({ kind: 'none' });
    }
  };

  const subjectOf = (hash: string | null): string => commits.find((commit) => commit.hash === hash)?.subject ?? '';

  const openReview = async (): Promise<void> => {
    const ask = asked.current;
    // Pressed before Git answered: wait for that answer, unless the choice changed meanwhile.
    const settled = direction.kind === 'deciding' && pending.current !== null ? await pending.current : direction;
    if (ask !== asked.current || settled.kind !== 'ordered') {
      return;
    }
    setOpening(true);
    const outcome = await bridge.open({ repository: repository.path, base: settled.base, target: settled.target });
    setOpening(false);
    if (outcome.kind === 'opened') {
      onOpened(outcome.open);
    } else if (outcome.kind === 'focused') {
      onFocused(outcome.note);
    } else {
      setError(outcome.error);
    }
  };

  const ordered = direction.kind === 'ordered' ? direction : null;
  const roleOf = (hash: string): 'from' | 'to' | 'chosen' | null =>
    ordered?.base === hash ? 'from' : ordered?.target === hash ? 'to' : picked.includes(hash) ? 'chosen' : null;
  const commitText = (hash: string): JSX.Element => (
    <>
      <code>{short(hash)}</code> {subjectOf(hash)}
    </>
  );

  return (
    <div className="rv-pair-choose">
      <header className="rv-pair-head">
        {onBack !== null && (
          <button type="button" className="rv-pair-link" data-ev="pair-back-to-repositories" onClick={onBack}>
            ← Repositories
          </button>
        )}
        <h1>{repository.name}</h1>
      </header>
      <div className="rv-pair-picked" data-ev="pair-picked" data-direction={direction.kind}>
        {ordered !== null ? (
          <>
            <span className="rv-pair-slot" data-ev="pair-from">
              <span className="rv-pair-slot-label">From</span>
              {commitText(ordered.base)}
            </span>
            <span className="rv-pair-arrow" aria-hidden="true">→</span>
            <span className="rv-pair-slot" data-ev="pair-to">
              <span className="rv-pair-slot-label">To</span>
              {commitText(ordered.target)}
            </span>
            <button
              type="button"
              className="rv-pair-link"
              data-ev="pair-swap"
              title="Show the change the other way round"
              onClick={() => setDirection({ kind: 'ordered', base: ordered.target, target: ordered.base, reversed: !ordered.reversed })}
            >
              Reverse direction
            </button>
          </>
        ) : (
          <span className={picked.length === 0 ? 'rv-pair-slot rv-pair-slot-empty' : 'rv-pair-slot'} data-ev="pair-chosen">
            {picked.length === 0 ? (
              'Click two commits to compare, in any order'
            ) : picked.length === 1 ? (
              <>{commitText(picked[0] ?? '')} — click a second commit</>
            ) : direction.kind === 'choose' ? (
              'Choose the direction below'
            ) : (
              'Reading which commit came first…'
            )}
          </span>
        )}
        <button
          type="button"
          className="rv-pair-primary"
          data-ev="pair-open"
          disabled={picked.length < 2 || direction.kind === 'choose' || opening}
          onClick={() => void openReview()}
        >
          Review changes
        </button>
      </div>
      {ordered?.reversed === true && (
        <p className="rv-pair-hint" data-ev="pair-reversed">
          Reversed: the diff shows the change from the later commit back to the earlier one.
        </p>
      )}
      {direction.kind === 'choose' && (
        <div className="rv-pair-direction" data-ev="pair-direction" role="group" aria-label="Direction">
          <p>{direction.reason} Choose which is From.</p>
          {[
            [direction.first, direction.second],
            [direction.second, direction.first],
          ].map(([base = '', target = ''], index) => (
            <button
              key={base}
              type="button"
              data-ev={`pair-direction-${String(index)}`}
              onClick={() => setDirection({ kind: 'ordered', base, target, reversed: false })}
            >
              From <code>{short(base)}</code> → To <code>{short(target)}</code>
            </button>
          ))}
        </div>
      )}
      {error !== null && <p className="rv-pair-error" data-ev="pair-error">{error}</p>}
      {loaded && commits.length === 0 && error === null && <p className="rv-pair-message">This repository has no commits yet.</p>}
      <ol className="rv-pair-log" data-ev="pair-log">
        {commits.map((commit, index) => {
          const role = roleOf(commit.hash);
          return (
            <li key={commit.hash}>
              {/*
                One commit as a traditional `git log` writes it: the commit line, the
                author, the date and the whole message indented. The whole block is the
                button. Two clicks, in any order, choose the commits; Git's ancestry
                decides which is From.
              */}
              <button
                type="button"
                className={role === null ? 'rv-pair-commit' : `rv-pair-commit rv-pair-commit-${role}`}
                data-ev={`pair-commit-${String(index)}`}
                data-hash={commit.hash}
                aria-pressed={role !== null}
                aria-label={`${role === null ? '' : `${ROLE_WORD[role]}: `}${short(commit.hash)} ${commit.subject}`}
                onClick={() => choose(commit.hash)}
              >
                <span className="rv-pair-commit-line">
                  <span className="rv-pair-hash">commit {commit.hash}</span>
                  {role !== null && <span className="rv-pair-role">{ROLE_WORD[role]}</span>}
                </span>
                <span className="rv-pair-meta">
                  Author: {commit.author}
                  {commit.email === '' ? '' : ` <${commit.email}>`}
                </span>
                <span className="rv-pair-meta" title={formatDate(commit.date)}>
                  Date:{'   '}
                  {commit.dateText === '' ? formatDate(commit.date) : commit.dateText}
                </span>
                <span className="rv-pair-commit-message">{commit.message}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {more && (
        <button type="button" className="rv-pair-more" data-ev="pair-more" onClick={() => void load(commits.length)}>
          Older commits
        </button>
      )}
    </div>
  );
}

// --- The review -------------------------------------------------------------------------

const STATUS_WORD: Record<PairFile['status'], string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  copied: 'Copied',
  'type-changed': 'Type changed',
};

function fileLocationMatch(file: PairFile, location: DiffLocation): boolean {
  return (location.side === 'base' ? file.oldPath : file.newPath) === location.path;
}

function DiffReview({
  bridge,
  open,
  initialAt,
  onChangeRevisions,
  onAllReviews,
}: {
  readonly bridge: ReviewPairBridge;
  readonly open: OpenPair;
  readonly initialAt: DiffLocation | null;
  readonly onChangeRevisions: () => void;
  readonly onAllReviews: () => void;
}): JSX.Element {
  const [record, setRecord] = useState<PairRecord>(open.record);
  const startFile = (): string | null => {
    if (initialAt !== null) {
      return open.files.find((file) => fileLocationMatch(file, initialAt))?.key ?? null;
    }
    return open.record.position.view === 'file' && open.files.some((file) => file.key === open.record.position.fileKey)
      ? open.record.position.fileKey
      : null;
  };
  const [fileKey, setFileKey] = useState<string | null>(startFile);
  const [layout, setLayout] = useState<'split' | 'unified'>(open.record.position.layout);
  const [target, setTarget] = useState<{ readonly location: DiffLocation; readonly nonce: number } | null>(
    initialAt === null ? null : { location: initialAt, nonce: 1 },
  );
  const [problem, setProblem] = useState<string | null>(null);
  /** Where *Files changed* was scrolled, so coming back from a file finds the same rows. */
  const listScroll = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (fileKey === null && body.current !== null) {
      body.current.scrollTop = listScroll.current;
    }
  }, [fileKey]);
  const openFile = (key: string | null): void => {
    if (fileKey === null && body.current !== null) {
      listScroll.current = body.current.scrollTop;
    }
    setFileKey(key);
  };

  // A place in the change a review result points at, wherever the view is now.
  const showRange = (range: LineRange): void => {
    const location = { side: range.side, path: range.path, line: range.start };
    const file = open.files.find((candidate) => fileLocationMatch(candidate, location));
    if (file !== undefined) {
      openFile(file.key);
      setTarget((before) => ({ location, nonce: (before?.nonce ?? 0) + 1 }));
    }
  };

  // DSP-175: the review's threads, read from the record every window shares, and the
  // questions asked in them from the review's one discussion.
  const threads = useMemo(() => reviewThreadsOf(record), [record]);
  const messages = useDiscussionMessages();
  const exchanges = useMemo(() => exchangesByThread(messages), [messages]);
  const [selectedThread, setSelectedThread] = useState<string | null>(initialAt?.threadId ?? null);
  const selectThread = useCallback(
    (thread: ReviewThread): void => {
      setSelectedThread(thread.id);
      const first = thread.anchors[0];
      if (first !== undefined) {
        showRange(first);
        return;
      }
      const at = thread.file;
      const file = at === null ? undefined : open.files.find((candidate) => (at.side === 'base' ? candidate.oldPath : candidate.newPath) === at.path);
      openFile(file?.key ?? null);
    },
    // showRange and openFile read only state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open.files],
  );
  const threadActions: ThreadActions = useMemo(
    () => ({
      selectedId: selectedThread,
      select: selectThread,
      show: showRange,
      act: async (thread, kind, text) => {
        try {
          const answer = await bridge.thread(open.key, { threadId: thread.id, kind, text });
          if (isPairError(answer)) {
            return answer.error;
          }
          setRecord(answer);
          return null;
        } catch (error) {
          return requestFailure(error);
        }
      },
      ask: async (thread, question, quoted) => {
        const discussion = window.dspatchReviewDiscussion;
        if (discussion === undefined) {
          return 'The review discussion is not available in this window.';
        }
        try {
          const outcome = await discussion.send({ question, subject: { kind: 'thread', threadId: thread.id }, selection: null, quote: quoted, language: 'en' });
          return outcome.kind === 'sent' ? null : outcome.error;
        } catch (error) {
          return requestFailure(error);
        }
      },
      exchanges: (threadId) => exchanges.get(threadId) ?? [],
      openLocation: (location) => showRange({ kind: 'lines', ...location }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedThread, selectThread, exchanges, bridge, open.key],
  );

  // What another window marked reaches this one through the host.
  useEffect(
    () =>
      bridge.onChanged((event) => {
        if (event.key === open.key) {
          setRecord(event.record);
        }
      }),
    [bridge, open.key],
  );

  // `Show in diff` from a walk: the one way another window moves this view.
  useEffect(
    () =>
      bridge.onNavigate((location) => {
        if (location.threadId !== undefined) {
          setSelectedThread(location.threadId);
        }
        const file = open.files.find((candidate) => fileLocationMatch(candidate, location));
        if (file === undefined && location.threadId !== undefined) {
          // A thread over the review as a whole is read in Files changed.
          openFile(null);
        }
        if (file !== undefined) {
          openFile(file.key);
          setTarget((before) => ({ location, nonce: (before?.nonce ?? 0) + 1 }));
        }
      }),
    [bridge, open.files],
  );

  // Where the reviewer is, kept with the pair so reopening comes back here.
  useEffect(() => {
    const position: PairPosition = { view: fileKey === null ? 'files' : 'file', fileKey, layout, line: null };
    const timer = setTimeout(() => {
      void bridge.savePosition(open.key, position);
    }, 250);
    return () => clearTimeout(timer);
  }, [bridge, open.key, fileKey, layout]);

  const progress = useMemo(() => new Map(open.files.map((file) => [file.key, fileProgressOf(file, record)])), [open.files, record]);
  const current = open.files.find((file) => file.key === fileKey) ?? null;
  const currentIndex = current === null ? -1 : open.files.indexOf(current);

  const mark = useCallback(
    async (op: 'manual' | 'exempt' | 'clear', scopes: Parameters<ReviewPairBridge['mark']>[1]['scopes']): Promise<void> => {
      const answer = await bridge.mark(open.key, { op, scopes, reason: '' });
      if (isPairError(answer)) {
        setProblem(answer.error);
      } else {
        setProblem(null);
        setRecord(answer);
      }
    },
    [bridge, open.key],
  );

  // DSP-152: agent work over the pair, started only by an explicit action here.
  const [preparing, setPreparing] = useState(false);
  const walksJob = [...record.jobs].reverse().find((job) => job.kind === 'walks') ?? null;

  /*
   * Niclas's trial feedback (29 October 2026): *Code walks* opens the review's walk window
   * directly, and is dimmed while the pair has no walk to open. A preparation started in
   * this window opens the walk window once when it succeeds; reading the record again,
   * reopening the review or restarting the app never does (the ids live only here).
   */
  const [walkCount, setWalkCount] = useState<number | null>(null);
  const [walksNote, setWalksNote] = useState('');
  useEffect(() => {
    let live = true;
    void bridge
      .walks(open.key)
      .catch(() => [])
      .then((answer) => {
        if (live) {
          setWalkCount(isPairError(answer) ? 0 : answer.length);
        }
      });
    return () => {
      live = false;
    };
  }, [bridge, open.key, walksJob?.endedAt]);
  const startedWalks = useRef(new Set<string>());
  useEffect(() => {
    for (const id of [...startedWalks.current]) {
      const job = record.jobs.find((entry) => entry.id === id);
      if (job === undefined || isRunning(job)) {
        continue;
      }
      startedWalks.current.delete(id);
      if (job.state === 'done' && job.definitionPath !== null) {
        void bridge.openWalk(open.key, job.definitionPath).then((answer) => setWalksNote(answer.ok ? '' : answer.note));
      }
    }
  }, [bridge, open.key, record.jobs]);
  const openWalks = (): void => {
    if (walkCount === null || walkCount === 0) {
      return;
    }
    void bridge
      .openWalks(open.key)
      .catch((error: unknown) => ({ ok: false, note: requestFailure(error) }))
      .then((answer) => setWalksNote(answer.ok ? '' : answer.note));
  };
  // DSP-181: the profile a prepared walk's explanations are written in: the computer's last choice, kept with the review's panel.
  const [explanationsIn, chooseExplanationsIn] = useDefaultProfile();
  const startJob = async (request: AgentJobRequestInput): Promise<boolean> => (await sendJob(request)) !== null;
  /** The one way this window starts agent work; a refusal or a failed request is said. */
  const sendJob = async (request: AgentJobRequestInput): Promise<AgentJob | null> => {
    setProblem(null);
    // A request that fails on its way (IPC or the host) is said, as a refusal is: a press
    // that starts nothing must never leave the window as it was.
    const answer = await bridge.startJob(open.key, request).catch((error: unknown) => ({ error: requestFailure(error) }));
    if (isPairError(answer)) {
      setProblem(`${request.kind === 'walks' ? 'The code walks could not be started' : 'The review could not be started'}: ${answer.error}`);
      return null;
    }
    if (request.kind === 'walks') {
      startedWalks.current.add(answer.id);
    }
    return answer;
  };

  /*
   * The review's panel, Step and Discussion (Niclas's decision of 30 October 2026): it
   * belongs to the review, in its own window or docked in this window or the walk window.
   * This window has no chat of its own. What is selected here is what the next question is
   * about; Discussion and Ask… show the panel (Ask… with the cursor in the question), and
   * Explain this asks there once.
   */
  const panelBridge = window.dspatchReviewPanel;
  const showPanel = (ask: boolean): void => {
    void panelBridge
      ?.show(open.key, ask)
      .catch((error: unknown) => ({ ok: false, note: requestFailure(error) }))
      .then((answer) => {
        if (!answer.ok) {
          setProblem(`The discussion could not be shown: ${answer.note}`);
        }
      });
  };
  const { panelState, dockedHere, roomRef } = usePanelRoom();

  /*
   * A reference opened from the panel when the review has no walk window (30 October 2026):
   * a place of its own, then further ones; Back returns through them to the diff.
   */
  const [away, setAway] = useState<readonly AwayEntry[]>([]);
  const goAway = (location: LineRange): void => {
    setTarget(null);
    setAway((before) => [...before, { location, more: { above: 0, below: 0 }, whole: false, reading: null }]);
  };
  const awayHere = away.at(-1) ?? null;
  const awayKey = awayHere === null ? '' : `${String(away.length)}:${awayHere.location.side}:${awayHere.location.path}:${String(awayHere.location.start)}`;
  useEffect(() => {
    if (panelBridge === undefined) {
      return;
    }
    return panelBridge.onAction((action) => {
      if (action.kind !== 'openLocation') {
        return;
      }
      const { location } = action;
      if (current === null) {
        // From the list of files, a place opens in its file first.
        const file = open.files.find((candidate) => fileLocationMatch(candidate, { side: location.side, path: location.path, line: location.start }));
        if (file !== undefined) {
          openFile(file.key);
        }
      }
      goAway({ kind: 'lines', side: location.side, path: location.path, start: location.start, end: location.end });
    });
  });

  /*
   * How each file is opened and where it was read, kept while the review is open, so a
   * file comes back as it was left, in either layout (30 October 2026).
   */
  const [expansions, setExpansions] = useState<ReadonlyMap<string, FileExpansion>>(new Map());
  const readings = useRef(new Map<string, ReadingSpot>());
  const expansionOf = (key: string): FileExpansion => expansions.get(key) ?? NO_EXPANSION;
  const setExpansion = useCallback((key: string, expansion: FileExpansion) => {
    setExpansions((before) => new Map(before).set(key, expansion));
  }, []);

  /*
   * What the next question is about (30 October 2026): code selected here becomes the quote
   * in the review's chat, in the walk window. `quote` is that selection, kept marked in this
   * window's code until it is sent, removed, replaced, or another file is opened, so no quote
   * follows along unseen.
   */
  const [quote, setQuote] = useState<{ readonly request: CodeSelectionRequest; readonly open: boolean } | null>(null);
  const shareQuote = (next: CodeSelectionRequest | null): void => {
    const shared: SelectionQuote | null = next === null ? null : { kind: 'code', text: next.text, segments: next.segments.map((segment) => ({ ...segment })) };
    setQuote(next === null ? null : { request: next, open: true });
    void window.dspatchReviewDiscussion?.setQuote(shared).catch(() => undefined);
  };
  // This window hears the chat (it is the review's): a quote chosen, sent or removed elsewhere
  // takes this window's mark away.
  useEffect(() => {
    const discussion = window.dspatchReviewDiscussion;
    if (discussion === undefined) {
      return;
    }
    const unsubscribe = discussion.onEvent((event) => {
      if (event.kind === 'quote') {
        setQuote(null);
        // Left selected, the next drag over it would move the text instead of selecting.
        window.getSelection()?.removeAllRanges();
      }
    });
    void discussion.load(null).catch(() => undefined);
    return unsubscribe;
  }, []);
  const placeSeen = useRef(false);
  useEffect(() => {
    if (!placeSeen.current) {
      placeSeen.current = true;
      return;
    }
    if (quote !== null) {
      shareQuote(null);
    }
    // Only a move to another file or place lets the quote go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, awayKey]);
  // Ask… shows the discussion and puts the cursor in it; a selection made while the
  // discussion is shown only becomes what the question is about, so the selection and
  // Explain this stay where they are.
  const askAbout = (request: CodeSelectionRequest, explicit: boolean): void => {
    shareQuote(request);
    if (explicit) {
      showPanel(true);
    }
  };
  /** Explain this: a question in the discussion, about exactly the selection. */
  const explainInDiscussion = async (request: CodeSelectionRequest): Promise<void> => {
    const discussion = window.dspatchReviewDiscussion;
    const first = request.segments[0];
    if (discussion === undefined || first === undefined) {
      return;
    }
    const quoted: SelectionQuote = { kind: 'code', text: request.text, segments: request.segments.map((segment) => ({ ...segment })) };
    const outcome = await discussion
      .send({
        question: `Explain this: "${request.text.replace(/\s+/g, ' ').trim().slice(0, 300)}"`,
        subject: { kind: 'away', location: { side: first.side, path: first.path, start: first.start, end: request.segments.at(-1)?.end ?? first.end } },
        selection: null,
        quote: quoted,
        language: 'en',
        deepen: { action: 'explain', text: request.text.slice(0, 2000) },
      })
      .catch((error: unknown) => ({ kind: 'failed' as const, error: requestFailure(error) }));
    if (outcome.kind !== 'sent') {
      setProblem(`The question could not be sent: ${outcome.error}`);
      return;
    }
    // Sent once; the panel shows it, opened where it is when it was not open.
    showPanel(false);
  };
  const stopJob = async (job: AgentJob): Promise<void> => {
    const answer = await bridge.cancelJob(open.key, job.id).catch((error: unknown) => ({ error: requestFailure(error) }));
    if (isPairError(answer)) {
      setProblem(answer.error);
    }
  };

  useEffect(() => {
    window.__dspatchPairCheck = {
      read: () => ({
        phase: 'review',
        key: open.key,
        base: open.pair.base,
        target: open.pair.target,
        fileKey,
        layout,
        requirement: record.requirement,
        files: open.files.map((file) => {
          const entry = progress.get(file.key) as FileProgress;
          return {
            key: file.key,
            path: shownPath(file),
            status: file.status,
            binary: file.binary,
            added: file.added,
            deleted: file.deleted,
            total: entry.total,
            handled: entry.handled,
            manual: entry.manual,
            exempted: entry.exempted,
            agent: entry.agent,
            percent: entry.percent,
            done: entry.done,
            shown: document.querySelector(`[data-file-key="${CSS.escape(file.key)}"] .rv-pair-progress`)?.textContent ?? '',
            // The check in the file list, or in the file's own header while its diff is open.
            checkbox:
              document.querySelector(`[data-file-key="${CSS.escape(file.key)}"] .rv-pair-check`) !== null ||
              (file.key === fileKey && document.querySelector('.rv-pair-file-head .rv-pair-check') !== null),
          };
        }),
        strips: [...document.querySelectorAll<HTMLElement>('.rv-pair-diff [data-strip]')].map((cell) => ({
          side: cell.dataset['side'],
          line: Number(cell.dataset['line']),
          status: cell.dataset['strip'],
          label: cell.getAttribute('aria-label') ?? '',
        })),
        rowsDrawn: document.querySelectorAll('.rv-pair-diff tr').length,
        // The changed characters marked inside compared lines, by side and line.
        words: [...document.querySelectorAll<HTMLElement>('.rv-pair-diff .rv-pair-word')].map((word) => ({
          side: word.closest('.rv-pair-old') !== null ? 'base' : 'target',
          line: Number(word.closest<HTMLElement>('[data-code-line]')?.dataset['codeLine'] ?? 0),
          text: word.textContent ?? '',
        })),
        // Changed lines that are strong throughout: nothing on the other side to compare with.
        wholeLines: [...document.querySelectorAll<HTMLElement>('.rv-pair-diff td.rv-pair-whole')].map((cell) => `${cell.dataset['codeSide'] ?? ''}:${cell.dataset['codeLine'] ?? ''}`),
        signs: [...document.querySelectorAll<HTMLElement>('.rv-pair-diff td.rv-pair-sign')].map((cell) => cell.textContent ?? '').join(''),
        // DSP-152: explanations of selected code, as recorded, and the panel as drawn.
        explanations: record.jobs
          .filter((job) => job.kind === 'explain' && job.selection !== undefined)
          .map((job) => ({
            id: job.id,
            state: job.state,
            provider: job.provider,
            model: job.model,
            root: job.followUp?.root ?? null,
            action: job.followUp?.action ?? null,
            question: job.followUp?.question ?? null,
            selection: job.selection ?? null,
            answer: job.answer?.answer ?? null,
            references: (job.answer?.references ?? []).map((reference) => reference.range),
            insufficient: job.answer?.insufficient ?? null,
            material: job.material ?? null,
            investigation: job.investigation ?? null,
          })),
        // The text selected in the window now, and whether the action is offered for it.
        textSelection: window.getSelection()?.toString() ?? '',
        explainOffered: document.querySelector('[data-ev="explain-this"]') !== null,
        explainMenu: document.querySelector('[data-ev="explain-menu"]') !== null,
        highlighted: CSS.highlights?.get('rv-explained')?.size ?? 0,
        linesSelected: document.querySelectorAll('.rv-pair-diff td.rv-pair-strip-selected').length,
        diffScrollTop: Math.round(document.querySelector('.rv-pair-diff')?.scrollTop ?? 0),
        jobs: record.jobs.map((job) => ({
          id: job.id,
          kind: job.kind,
          state: job.state,
          provider: job.provider,
          model: job.model,
          note: job.note,
          detail: job.detail,
          scope: job.scope?.label ?? null,
          approved: job.result?.approved ?? [],
          findings: job.result?.findings.length ?? 0,
          insufficient: job.result?.insufficient ?? false,
          definitionPath: job.definitionPath,
          uncovered: job.uncovered.length,
          // DSP-152: where findings point, what the agent could read and what it read.
          findingPlaces: (job.result?.findings ?? []).map((finding) => ({ severity: finding.severity, location: finding.location })),
          material: job.material ?? null,
          investigation: job.investigation ?? null,
          // 30 October 2026: what an explanation was about, and the person's own question.
          selection: job.selection?.segments.map((segment) => ({ side: segment.side, path: segment.path, start: segment.start, end: segment.end, from: segment.from, to: segment.to, kind: segment.kind, text: segment.text })) ?? null,
          selectionFile: job.selection?.fileKey ?? null,
          asked: job.asked ?? null,
          followUp: job.followUp ?? null,
          refs: job.answer?.references.map((reference) => `${reference.range.side}:${reference.range.path}:${String(reference.range.start)}-${String(reference.range.end)}`) ?? [],
          activity: job.activity ?? null,
        })),
        agentReviewsShown: document.querySelectorAll('[data-ev="agent-review"]').length,
        findingsShown: [...document.querySelectorAll<HTMLElement>('[data-ev="agent-finding"]')].map((item) => item.textContent ?? ''),
        diffNote: document.querySelector('.rv-pair-nodiff')?.textContent ?? '',
        walksNote,
        walkCount,
        codeWalks: ((): unknown => {
          const button = document.querySelector<HTMLElement>('[data-ev="pair-walks"]');
          return button === null ? null : { enabled: button.getAttribute('aria-disabled') !== 'true', tip: button.dataset['tip'] ?? '' };
        })(),
        listShown: document.querySelector('.rv-pair-files') !== null,
        sidebarShown: document.querySelector('.rv-pair-sidebar') !== null,
        listScrollTop: Math.round(body.current?.scrollTop ?? 0),
        listScrollSaved: Math.round(listScroll.current),
        diffOverflowX: ((): boolean => {
          const diff = document.querySelector<HTMLElement>('.rv-pair-diff');
          return diff !== null && diff.scrollWidth > diff.clientWidth + 1;
        })(),
        // Lines long enough to wrap, by side and line: where a scenario selects in a wrapped line.
        longLines: [...document.querySelectorAll<HTMLElement>('.rv-pair-diff td[data-code-line]')]
          .filter((cell) => (cell.textContent ?? '').length > 200)
          .map((cell) => ({ side: cell.dataset['codeSide'] ?? '', line: Number(cell.dataset['codeLine']), length: (cell.textContent ?? '').length, height: Math.round(cell.getBoundingClientRect().height) })),
        fileRows: [...document.querySelectorAll<HTMLElement>('[data-file-row]')].map((row) => (row.innerText || '').replace(/\s+/g, ' ').trim()),
        targetShown: document.querySelector('.rv-pair-target') !== null,
        // 30 October 2026: room kept for the review's panel docked here.
        panelRoom: document.querySelector('[data-ev="panel-room"]') !== null,
        // 30 October 2026: what is drawn of the file, the folds and where the reader is.
        context: ((): unknown => {
          const root = document.querySelector<HTMLElement>('.rv-pair-diff');
          if (root === null) {
            return null;
          }
          const top = root.getBoundingClientRect().top;
          const cells = [...root.querySelectorAll<HTMLElement>('td[data-code-line]')];
          const first = cells.find((cell) => cell.getBoundingClientRect().bottom > top + 1);
          const quoteMark = CSS.highlights?.get('rv-quote');
          return {
            // Each drawn code cell as side:line, with the From line an unchanged unified row also is.
            cells: cells.map((cell) => `${cell.dataset['codeSide'] === 'base' ? 'b' : 't'}${cell.dataset['codeLine'] ?? ''}${cell.dataset['codeAlso'] === undefined ? '' : `=b${cell.dataset['codeAlso'].split(':')[1] ?? ''}`}`),
            gaps: [...root.querySelectorAll<HTMLElement>('tr.rv-pair-gap')].map((row) => ({ id: row.dataset['gap'] ?? '', text: (row.textContent ?? '').replace(/\s+/g, ' ').trim() })),
            whole: document.querySelector('[data-ev="pair-whole-file"]')?.getAttribute('aria-pressed') === 'true',
            firstVisible:
              first === undefined
                ? null
                : { side: first.dataset['codeSide'] ?? '', line: Number(first.dataset['codeLine']), offset: Math.round(first.getBoundingClientRect().top - top) },
            // The cells in view and how far below the top of the view each is.
            tops: cells
              .filter((cell) => {
                const box = cell.getBoundingClientRect();
                return box.bottom > top && box.top < top + root.clientHeight;
              })
              .slice(0, 160)
              .map((cell) => [`${cell.dataset['codeSide'] === 'base' ? 'b' : 't'}${cell.dataset['codeLine'] ?? ''}`, Math.round(cell.getBoundingClientRect().top - top)]),
            scrollTop: Math.round(root.scrollTop),
            scrollHeight: root.scrollHeight,
            clientHeight: root.clientHeight,
            away: (document.querySelector('[data-ev="away-bar"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            refLines: [...root.querySelectorAll<HTMLElement>('td.rv-ref-line')].map((cell) => Number(cell.dataset['codeLine'])),
            quote: (document.querySelector('[data-ev="pair-discussion"] [data-ev="discussion-quote"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            askOpen: document.querySelector('[data-ev="pair-discussion"]:not([hidden])') !== null,
            askOffered: document.querySelector('[data-ev="ask-this"]') !== null,
            quoteMark: quoteMark === undefined ? [] : [...quoteMark].map((range) => (range as Range).toString()),
            activity: [...document.querySelectorAll('[data-ev="pair-discussion"] [data-ev="discussion-activity"]')].map((node) => node.textContent ?? ''),
            focused: document.activeElement?.getAttribute('data-ev') ?? document.activeElement?.tagName ?? '',
          };
        })(),
      }),
    };
    return () => {
      delete window.__dspatchPairCheck;
    };
  }, [open, fileKey, layout, record, progress, walksNote, walkCount]);

  const totals = useMemo(() => {
    let total = 0;
    let handled = 0;
    let done = 0;
    for (const entry of progress.values()) {
      total += entry.total;
      handled += entry.handled;
      done += entry.done ? 1 : 0;
    }
    return { total, handled, done };
  }, [progress]);

  const noWalks = walkCount === null || walkCount === 0;
  return (
    <PairKeyContext.Provider value={open.key}>
    <ThreadContext.Provider value={threadActions}>
    <div className="rv-pair-review">
      <header className="rv-pair-head rv-pair-review-head">
        <h1>
          {open.repositoryName}
          <span className="rv-pair-revs">
            <code title={open.base.subject}>{short(open.base.hash)}</code> → <code title={open.target.subject}>{short(open.target.hash)}</code>
          </span>
        </h1>
        <div className="rv-pair-tools">
          {/* While choosing, the picker's own button is the one that starts: no second one by the same name. */}
          {!preparing && (
            <button type="button" data-ev="pair-prepare-walks" disabled={walksJob?.state === 'running' || walksJob?.state === 'cancelling'} onClick={() => setPreparing(true)}>
              Prepare code walks…
            </button>
          )}
          {/* Focusable while dimmed, so its reason reads on hover and on keyboard focus alike. */}
          <button
            type="button"
            className={noWalks ? 'rv-pair-tip rv-pair-dimmed' : 'rv-pair-tip'}
            data-ev="pair-walks"
            aria-disabled={noWalks}
            data-tip={noWalks ? 'No code walks yet' : ''}
            onClick={openWalks}
          >
            Code walks
          </button>
          {/* Hidden or not open yet, it says so: this is the way back to what was discussed. */}
          <button
            type="button"
            className={panelState?.visible === true ? undefined : 'rv-show-discussion'}
            data-ev="pair-discussion"
            title="The review's discussion: Step and Discussion"
            onClick={() => showPanel(true)}
          >
            {panelState?.visible === true ? 'Discussion' : 'Show discussion'}
          </button>
          <button type="button" className="rv-pair-link" data-ev="pair-change-revisions" onClick={onChangeRevisions}>
            Change revisions
          </button>
          <button type="button" className="rv-pair-link" data-ev="pair-all-reviews" onClick={onAllReviews}>
            All reviews
          </button>
        </div>
      </header>
      {/* DSP-186: said, never acted on: walks are prepared again only when the person asks. */}
      {record.generation !== null && (generationStale(record, PRESENTATION_INSTRUCTION_VERSION) || (record.generation.profile !== null && record.generation.profile !== explanationsIn)) && (
        <p className="rv-pair-hint" data-ev="pair-stale">
          The code walks of this review were prepared with earlier settings
          {record.generation.profile !== null && record.generation.profile !== explanationsIn ? ` (the ${record.generation.profile} profile)` : ''}. Prepare them again to use the current
          ones; nothing is prepared again by itself.
        </p>
      )}
      {preparing && (
        <div className="rv-pair-walks">
          <AgentPicker
            pairKey={open.key}
            action="Prepare code walks"
            busy={false}
            testId="pair-walks-agent"
            explanations={{ profile: explanationsIn, onChoose: chooseExplanationsIn }}
            onCancel={() => setPreparing(false)}
            onStart={(choice) => {
              // DSP-181: the step explanations are written in the chosen profile, so the walk
              // opens and is read in it with no further call.
              void startJob({ kind: 'walks', ...choice, presentation: { profile: explanationsIn } }).then((ok) => {
                if (ok) {
                  setPreparing(false);
                }
              });
            }}
          />
        </div>
      )}
      {/* A preparation shows while it runs, and when it gave nothing to open; a good one opens the walks instead. */}
      {walksJob !== null && (isRunning(walksJob) || (!preparing && (walksJob.state !== 'done' || walksJob.definitionPath === null))) && (
        <JobLine job={walksJob} onStop={() => void stopJob(walksJob)} />
      )}
      {walksNote !== '' && (
        <p className="rv-pair-error" data-ev="pair-walks-note">
          {walksNote}
        </p>
      )}
      {problem !== null && <p className="rv-pair-error">{problem}</p>}
      <div className="rv-pair-main">
      <div className="rv-pair-body" ref={body}>
          {current === null ? (
            <FilesChanged
              pairKey={open.key}
              files={open.files}
              progress={progress}
              record={record}
              totals={totals}
              jobs={record.jobs}
              threads={threads}
              onOpen={(file) => openFile(file.key)}
              onDelegate={(choice) =>
                startJob({ kind: 'review', ...choice, scope: { kind: 'file', label: 'the whole change', ranges: changedRangesOf(open.files) } })
              }
              onStop={(job) => void stopJob(job)}
              onShow={showRange}
            />
          ) : awayHere !== null ? (
            <ReferenceView
              key={awayKey}
              bridge={bridge}
              pairKey={open.key}
              pair={open.pair}
              entry={awayHere}
              inChange={open.files.find((file) => (awayHere.location.side === 'base' ? file.oldPath : file.newPath) === awayHere.location.path) ?? null}
              back={(() => {
                const before = away.at(-2);
                return before === undefined
                  ? shownPath(current).split('/').pop() ?? shownPath(current)
                  : `${before.location.path.split('/').pop() ?? ''}:${before.location.start === before.location.end ? String(before.location.start) : `${String(before.location.start)}–${String(before.location.end)}`}`;
              })()}
              onBack={() => setAway((before) => before.slice(0, -1))}
              onChange={((at: number) => (entry: AwayEntry) => setAway((before) => before.map((value, index) => (index === at ? entry : value))))(away.length - 1)}
              onShowInDiff={
                open.files.some((file) => fileLocationMatch(file, { side: awayHere.location.side, path: awayHere.location.path, line: awayHere.location.start }))
                  ? () => {
                      setAway([]);
                      setTarget((before) => ({ location: { side: awayHere.location.side, path: awayHere.location.path, line: awayHere.location.start }, nonce: (before?.nonce ?? 0) + 1 }));
                    }
                  : null
              }
              explained={null}
              onExplain={(selection) => void explainInDiscussion(selection)}
              quote={quote}
              onAsk={askAbout}
              explainPanel={<></>}
            />
          ) : (
            <FileDiff
              key={current.key}
              bridge={bridge}
              pairKey={open.key}
              file={current}
              allFiles={open.files}
              onShowElsewhere={showRange}
              record={record}
              threads={threads}
              layout={layout}
              target={target !== null && fileLocationMatch(current, target.location) ? target : null}
              progress={progress.get(current.key) as FileProgress}
              onLayout={setLayout}
              onMark={mark}
              jobs={record.jobs}
              onDelegate={(choice, scope) => startJob({ kind: 'review', ...choice, scope })}
              onStop={(job) => void stopJob(job)}
              explained={null}
              onExplain={(selection) => void explainInDiscussion(selection)}
              explainPanel={<></>}
              expansion={expansionOf(current.key)}
              onExpansion={(expansion) => setExpansion(current.key, expansion)}
              reading={readings.current.get(current.key) ?? null}
              onReading={(spot) => readings.current.set(current.key, spot)}
              quote={quote}
              onAsk={askAbout}
              onBack={() => openFile(null)}
              onPrevious={currentIndex > 0 ? () => openFile(open.files[currentIndex - 1]?.key ?? null) : null}
              onNext={currentIndex < open.files.length - 1 ? () => openFile(open.files[currentIndex + 1]?.key ?? null) : null}
            />
          )}
        </div>
        {/* Room for the review's panel while it is docked in this window; the panel is drawn over it. */}
        {dockedHere && <div className="rv-pair-room" ref={roomRef} data-ev="panel-room" />}
      </div>
    </div>
    </ThreadContext.Provider>
    </PairKeyContext.Provider>
  );
}

/** Who handled a file's changed lines, in a few words: you, which agent, exempted, with how many lines each when mixed. */
function handledBy(progress: FileProgress, facts: FileReviewFacts): string {
  const parts: string[] = [];
  if (progress.total === 0) {
    return progress.wholeFile === null ? '' : progress.wholeFile.op === 'manual' ? 'You' : 'Exempted';
  }
  if (progress.manual > 0) {
    parts.push(progress.manual === progress.handled ? 'You' : `You: ${String(progress.manual)}`);
  }
  if (progress.agent > 0) {
    const who = facts.agents.length === 0 ? 'Agent' : facts.agents.join(', ');
    parts.push(progress.agent === progress.handled ? who : `${who}: ${String(progress.agent)}`);
  }
  if (progress.exempted > 0) {
    parts.push(progress.exempted === progress.handled ? 'Exempted' : `exempted: ${String(progress.exempted)}`);
  }
  return parts.join(' · ');
}

function ProgressMark({ progress, compact = false }: { readonly progress: FileProgress; readonly compact?: boolean }): JSX.Element {
  const parts: string[] = [];
  if (progress.manual > 0) {
    parts.push(`${String(progress.manual)} reviewed by you`);
  }
  if (progress.agent > 0) {
    parts.push(`${String(progress.agent)} agent-reviewed`);
  }
  if (progress.exempted > 0) {
    parts.push(`${String(progress.exempted)} exempted`);
  }
  const detail =
    progress.total === 0
      ? progress.wholeFile === null
        ? 'No changed lines to count. Mark the file to finish it.'
        : progress.wholeFile.op === 'manual'
          ? 'File reviewed by you.'
          : 'File exempted.'
      : `${String(progress.handled)} of ${String(progress.total)} changed lines handled${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`;
  if (progress.done) {
    const how =
      progress.total === 0
        ? progress.wholeFile?.op === 'exempt'
          ? 'exempted'
          : 'reviewed'
        : progress.exempted === progress.total
          ? 'exempted'
          : progress.agent === progress.total
            ? 'agent'
            : progress.manual === progress.total
              ? 'reviewed'
              : 'mixed';
    return (
      <span className={`rv-pair-progress rv-pair-done rv-pair-done-${how}`} title={`Done. ${detail}`}>
        <span className="rv-pair-check" role="img" aria-label={`Done. ${detail}`}>
          ✓
        </span>
        {!compact && how !== 'reviewed' && <span className="rv-pair-done-how">{how === 'mixed' ? 'mixed' : how === 'agent' ? 'agent' : 'exempted'}</span>}
      </span>
    );
  }
  return (
    <span className="rv-pair-progress" title={detail}>
      {progress.total === 0 ? '–' : `${String(progress.percent)}%`}
    </span>
  );
}


// --- Agent work (DSP-152) ------------------------------------------------------------------

function agentName(job: AgentJob): string {
  return `${job.provider === 'claude' ? 'Claude' : job.provider === 'copilot' ? 'Copilot' : 'Cursor'} (${job.model})`;
}

/** A request that failed on its way, in the words of what failed: without Electron's wrapping. */
export function requestFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': /, '').replace(/^(?:[A-Za-z]*Error: )+/, '');
}

export function isRunning(job: AgentJob): boolean {
  return job.state === 'running' || job.state === 'cancelling';
}

/**
 * Which attempt a finished line is about: its agent, model and start. A record keeps
 * every job of its revision pair, so reopening the same change shows its last job, which
 * may have been started with another agent long before; the line must not read as the
 * outcome of the choice shown now.
 */
export function attemptLabel(job: AgentJob): string {
  const words = `${job.provider === 'claude' ? 'Claude' : job.provider === 'copilot' ? 'Copilot' : 'Cursor'} · ${job.model} · ${formatDate(job.startedAt)}`;
  return job.state === 'done' ? words : `Last attempt (${words}):`;
}

/**
 * Whether what the host last said can be taken as current (DSP-158). With the connection
 * gone the host's line above the window says how it stands is unknown, and an activity line
 * frozen at its last words would say otherwise. Once back, the window has the host's state.
 */
function useHostReachable(): boolean {
  const [reachable, setReachable] = useState(true);
  useEffect(() => {
    const bridge = window.dspatchHost;
    if (bridge === undefined) {
      return;
    }
    const read = (state: { readonly remote: boolean; readonly phase: string }): void => setReachable(!state.remote || state.phase === 'connected');
    void bridge.state().then(read);
    return bridge.onState(read);
  }, []);
  return reachable;
}

/**
 * Where one piece of agent work stands, in a line, with Stop while it runs. Since Niclas's
 * trial feedback (29 October 2026) the product view says only that: no job ids, internal
 * times, reads or tool calls. Those stay in the review record, and the provider's own
 * words for a failure are on the note's tooltip for whoever needs them.
 */
export function JobLine({ job, onStop }: { readonly job: AgentJob; readonly onStop: () => void }): JSX.Element {
  const running = job.state === 'running' || job.state === 'cancelling';
  const reachable = useHostReachable();
  const what =
    job.kind === 'walks'
      ? 'Preparing code walks'
      : job.kind === 'checks'
        ? 'Looking for what is worth checking'
        : job.kind === 'explain'
        ? job.selection === undefined
          ? 'Looking into the code'
          : 'Explaining the selected code'
        : `Reviewing ${job.scope?.label ?? 'the delegated part'}`;
  return (
    <div className={`rv-agent-line rv-agent-line-${job.state}`} data-ev={`agent-job-${job.kind}`} data-state={job.state} aria-live="polite">
      {running ? (
        <>
          <span className="rv-agent-spinner" aria-hidden="true" />
          <span>
            {job.state === 'cancelling' ? 'Stopping' : what} with {agentName(job)}…
          </span>
          {job.state === 'running' && (
            <button type="button" data-ev={`agent-job-${job.kind}-stop`} onClick={onStop}>
              Stop
            </button>
          )}
          {/* What it is doing now, as it reports it (30 October 2026). */}
          {job.state === 'running' && reachable && job.activity !== undefined && job.activity !== '' && (
            <span className="rv-agent-activity" data-ev={`agent-job-${job.kind}-activity`}>
              {job.activity}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="rv-agent-attempt" data-ev={`agent-job-${job.kind}-attempt`}>
            {attemptLabel(job)}
          </span>
          <JobNote job={job} />
        </>
      )}
    </div>
  );
}

/** A finished job's note; the provider's own text, when there is any, only on its tooltip. */
export function JobNote({ job }: { readonly job: AgentJob }): JSX.Element {
  return (
    <span data-ev={`agent-job-${job.kind}-note`} {...(job.detail === '' ? {} : { title: job.detail })}>
      {job.note}
    </span>
  );
}

export function rangeWords(range: LineRange): string {
  return `${range.path} ${range.side === 'base' ? 'removed ' : ''}line${range.start === range.end ? '' : 's'} ${String(range.start)}${range.start === range.end ? '' : `–${String(range.end)}`}`;
}

/** One finding: its heading and short explanation; longer reasoning and its code on request. */
function RangeLinks({ ranges, onShow }: { readonly ranges: readonly LineRange[]; readonly onShow: (range: LineRange) => void }): JSX.Element {
  return (
    <ul>
      {ranges.map((range, index) => (
        <li key={index}>
          <button type="button" className="rv-pair-link" onClick={() => onShow(range)}>
            {rangeWords(range)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A delegated review's outcome (DSP-158). It opens with what was approved and what remains,
 * in DSpatch's words from the checked ranges, with the agent's own short words beside them;
 * then the findings; everything else it rests on is folded, nothing is left out. While the
 * job runs this is only its one status line: the line, not a second one above it.
 */
export function AgentReviewResult({
  job,
  files,
  threads,
  expandThreads = false,
  open = true,
  onStop,
  onShow,
}: {
  readonly job: AgentJob;
  /** The change's files, to tell a whole part from a partial one; `null` while not known. */
  readonly files: readonly PairFile[] | null;
  /**
   * This review's threads (DSP-175), listed here one line each; each is read in full at its
   * code, so a finding or gap is presented once, with its status.
   */
  readonly threads: readonly ReviewThread[];
  /** In a window without the diff, a thread's line opens it in place. */
  readonly expandThreads?: boolean;
  readonly open?: boolean;
  readonly onStop: () => void;
  readonly onShow: (range: LineRange) => void;
}): JSX.Element {
  if (job.state === 'running' || job.state === 'cancelling') {
    return <JobLine job={job} onStop={onStop} />;
  }
  const result = job.result;
  const view = result === null ? null : delegatedReviewView(result, job.scope, files);
  return (
    <details className="rv-agent-review" open={open} data-ev="agent-review" data-state={job.state} data-standing={view?.standing ?? ''}>
      <summary>
        Agent review · {job.scope?.label ?? ''} · {view?.standingWords ?? job.state}
      </summary>
      {result === null || view === null ? (
        <p>
          <span className="rv-agent-attempt">{attemptLabel(job)}</span> <JobNote job={job} />
        </p>
      ) : (
        <div className="rv-agent-review-body">
          <div className={`rv-agent-verdict rv-agent-verdict-${view.standing}`} data-ev="agent-review-summary">
            <p className="rv-agent-verdict-line" data-ev="agent-review-coverage">{view.approvedLine}</p>
            {/* DSP-175: what remains, apart from coverage: open threads and lines not approved. */}
            <p data-ev="agent-review-remaining">
              {[
                ...(view.notApproved !== null && view.notApproved.length > 0
                  ? [((count: number) => `${String(count)} changed ${count === 1 ? 'line' : 'lines'} not approved`)(view.notApproved.reduce((total, range) => total + range.end - range.start + 1, 0))]
                  : []),
                ...(remainingLine(threadCountsOf(threads)) === '' ? [] : [remainingLine(threadCountsOf(threads))]),
              ].join(' · ') || 'Nothing open from this review.'}
            </p>
            {view.agentSummary !== '' && <p className="rv-pair-muted">The agent says: {view.agentSummary}</p>}
          </div>
          {threads.length > 0 && <ThreadIndex threads={threads} expand={expandThreads} />}
          <details className="rv-agent-adjustments" data-ev="agent-review-basis">
            <summary>Reasoning and what it covers</summary>
            {view.reasoning !== '' && <p className="rv-agent-reasoning">{view.reasoning}</p>}
            <p className="rv-pair-muted">{attemptLabel(job)}</p>
            {result.approved.length > 0 && (
              <>
                <span className="rv-pair-muted">Approved:</span>
                <RangeLinks ranges={result.approved} onShow={onShow} />
              </>
            )}
            {view.notApproved !== null && view.notApproved.length > 0 && (
              <>
                <span className="rv-pair-muted">Not approved:</span>
                <RangeLinks ranges={view.notApproved} onShow={onShow} />
              </>
            )}
            <span className="rv-pair-muted">Reviewed:</span>
            {result.reviewed.length > 0 ? <RangeLinks ranges={result.reviewed} onShow={onShow} /> : <p>Nothing.</p>}
          </details>
          {result.adjustments.length > 0 && (
            <details className="rv-agent-adjustments">
              <summary>What DSpatch did not accept from the answer</summary>
              <ul>
                {result.adjustments.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </details>
          )}
          {job.instruction !== undefined && (
            <details className="rv-agent-adjustments" data-ev="agent-review-instruction">
              <summary>What the agent was told</summary>
              <pre className="rv-agent-instruction">{job.instruction}</pre>
            </details>
          )}
        </div>
      )}
    </details>
  );
}

function touchesFile(job: AgentJob, file: PairFile): boolean {
  return (job.scope?.ranges ?? []).some((range) => range.path === (range.side === 'base' ? file.oldPath : file.newPath));
}

/** A path as the file list shows it: the name first, the folder it is in after it. */
function PathCell({ path }: { readonly path: string }): JSX.Element {
  const slash = path.lastIndexOf('/');
  return (
    <span className="rv-pair-path">
      <span className="rv-pair-path-name">{slash < 0 ? path : path.slice(slash + 1)}</span>
      {slash >= 0 && <span className="rv-pair-path-dir">{path.slice(0, slash + 1)}</span>}
    </span>
  );
}

/**
 * *Files changed*, the review's overview (Niclas's trial feedback, 29 October 2026): the
 * whole width, one row per file, the whole row opening its diff. Each row says the kind of
 * change, how much is handled under the review's requirement (a check once all is), who
 * handled it — you, which agent, exempted, or a mix — and the agent's open problems and
 * questions, which a check never hides. Opening a file, reading an explanation or a walk
 * passing a line counts for nothing here; walk coverage is not review progress.
 */
function FilesChanged({
  pairKey,
  files,
  progress,
  record,
  totals,
  jobs,
  threads,
  onOpen,
  onDelegate,
  onStop,
  onShow,
}: {
  readonly pairKey: string;
  readonly files: readonly PairFile[];
  readonly progress: ReadonlyMap<string, FileProgress>;
  readonly record: PairRecord;
  readonly totals: { readonly total: number; readonly handled: number; readonly done: number };
  readonly jobs: readonly AgentJob[];
  readonly threads: readonly ReviewThread[];
  readonly onOpen: (file: PairFile) => void;
  readonly onDelegate: (choice: AgentChoice) => Promise<boolean>;
  readonly onStop: (job: AgentJob) => void;
  readonly onShow: (range: LineRange) => void;
}): JSX.Element {
  const [delegating, setDelegating] = useState(false);
  const facts = useMemo(() => new Map(files.map((file) => [file.key, fileReviewFactsOf(file, record)])), [files, record]);
  const actions = useContext(ThreadContext);
  const [showThreads, setShowThreads] = useState(false);
  const remaining = remainingLine(threadCountsOf(threads));
  // Threads with no place in one file of the change are read here, over the review.
  const reviewLevel = threads.filter((thread) => thread.level === 'review' || (thread.file !== null && !files.some((file) => (thread.file?.side === 'base' ? file.oldPath : file.newPath) === thread.file?.path)));
  if (files.length === 0) {
    return <p className="rv-pair-message">The two commits have the same content: there is nothing to review.</p>;
  }
  const whole = [...jobs].reverse().find((job) => job.kind === 'review' && job.scope?.label === 'the whole change') ?? null;
  return (
    <section className="rv-pair-files" aria-label="Files changed">
      <h2>
        Files changed <span className="rv-pair-muted">{files.length}</span>
        <span className="rv-pair-summary" data-ev="pair-summary">
          {totals.done} of {files.length} files done · {totals.handled} of {totals.total} changed lines handled
        </span>
        {remaining !== '' && (
          // DSP-175: what remains is said apart from coverage, and opens the threads themselves.
          <button type="button" className="rv-pair-link rv-thread-remaining" data-ev="pair-remaining" aria-expanded={showThreads} onClick={() => setShowThreads(!showThreads)}>
            {remaining}
          </button>
        )}
        {!delegating && (
          <button type="button" className="rv-pair-link" data-ev="pair-delegate-all" onClick={() => setDelegating(true)}>
            Delegate the whole review…
          </button>
        )}
      </h2>
      {delegating && (
        <div className="rv-agent-delegate">
          <p className="rv-pair-muted">
            The agent reviews every changed line and may approve what it reviewed and found acceptable. Its findings and uncertainties stay visible here and at each file.
          </p>
          <AgentPicker
            pairKey={pairKey}
            action="Delegate"
            busy={false}
            testId="pair-delegate-all-agent"
            onCancel={() => setDelegating(false)}
            onStart={(choice) => {
              void onDelegate(choice).then((ok) => {
                if (ok) {
                  setDelegating(false);
                }
              });
            }}
          />
        </div>
      )}
      {showThreads && (
        <div className="rv-thread-overview" data-ev="pair-threads">
          <ThreadIndex threads={threads.filter((thread) => thread.kind !== 'note')} />
        </div>
      )}
      {whole !== null && (!delegating || isRunning(whole)) && (
        <AgentReviewResult job={whole} files={files} threads={threads.filter((thread) => thread.jobId === whole.id)} onStop={() => onStop(whole)} onShow={onShow} />
      )}
      {reviewLevel.length > 0 && (
        <div className="rv-thread-review-level" data-ev="pair-review-threads">
          {reviewLevel.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} />
          ))}
        </div>
      )}
      <div className="rv-pair-filelist" role="list">
        <div className="rv-pair-filerow rv-pair-filehead" aria-hidden="true">
          <span>File</span>
          <span>Change</span>
          <span className="rv-pair-col-num">Lines</span>
          <span>Handled by</span>
          <span className="rv-pair-col-progress">Handled</span>
        </div>
        {files.map((file, index) => {
          const entry = progress.get(file.key) as FileProgress;
          const fileFacts = facts.get(file.key) ?? { agents: [], findings: 0 };
          const open = remainingInFile(threads, file);
          const by = handledBy(entry, fileFacts);
          const running = jobs.some((job) => job.kind === 'review' && isRunning(job) && touchesFile(job, file));
          return (
            <div role="listitem" key={file.key} data-file-key={file.key}>
              <button type="button" className="rv-pair-filerow" data-ev={`pair-file-${String(index)}`} data-file-row="" onClick={() => onOpen(file)}>
                <span className="rv-pair-file-cell">
                  {file.status === 'renamed' || file.status === 'copied' ? (
                    <>
                      <PathCell path={file.newPath ?? shownPath(file)} />
                      <span className="rv-pair-muted rv-pair-renamed-from">from {file.oldPath}</span>
                    </>
                  ) : (
                    <PathCell path={shownPath(file)} />
                  )}
                </span>
                <span className={`rv-pair-status rv-pair-status-${file.status}`}>
                  {STATUS_WORD[file.status]}
                  {file.binary && <span className="rv-pair-muted"> · binary</span>}
                </span>
                <span className="rv-pair-col-num">
                  {file.binary ? (
                    ''
                  ) : (
                    <>
                      <span className="rv-pair-add">+{file.added}</span> <span className="rv-pair-del">−{file.deleted}</span>
                    </>
                  )}
                </span>
                <span className="rv-pair-by" data-ev="pair-file-by">
                  {by}
                  {running && <span className="rv-pair-muted"> · agent reviewing…</span>}
                  {open.length > 0 && (
                    // Opens the file at its first open thread (DSP-175); the row itself opens the file.
                    <span
                      className="rv-pair-findings"
                      data-ev="pair-file-findings"
                      role="link"
                      title="Show the open threads"
                      onClick={(event) => {
                        event.stopPropagation();
                        const first = open[0];
                        if (first !== undefined) {
                          actions?.select(first);
                        }
                      }}
                    >
                      {open.length} open {open.length === 1 ? 'finding' : 'findings'}
                    </span>
                  )}
                </span>
                <span className="rv-pair-col-progress">
                  <ProgressMark progress={entry} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- One file ---------------------------------------------------------------------------

interface FileText {
  readonly base: readonly string[] | null;
  readonly target: readonly string[] | null;
  readonly binary: boolean;
  readonly error: string | null;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.map((line) => line.replace(/\r$/, ''));
}

const STRIP_WORD: Record<StripStatus, string> = {
  manual: 'Reviewed by you',
  agent: 'Agent-reviewed',
  exempt: 'Exempted',
  none: 'Not yet handled',
};

function describeLine(status: LineStatus | undefined): string {
  if (status === undefined) {
    return '';
  }
  const strip = stripStatusOf(status);
  const parts = [STRIP_WORD[strip]];
  if (status.decision !== null && status.decision.at !== '') {
    parts[0] = `${parts[0] as string} (${formatDate(status.decision.at)})`;
  }
  if (status.decision !== null && status.decision.reason !== '') {
    parts.push(`reason: ${status.decision.reason}`);
  }
  if (status.agent.length > 0 && strip !== 'agent') {
    parts.push(`also agent-reviewed${status.agent[0]?.reviewer ? ` by ${status.agent[0].reviewer}` : ''}`);
  } else if (strip === 'agent' && status.agent[0]?.reviewer) {
    parts[0] = `Agent-reviewed by ${status.agent[0].reviewer}`;
  }
  return parts.join('; ');
}

/**
 * DSP-152: the code selected in this file's diff, read from the window's selection: each
 * selected line's side and number from its code cell, the characters from where the
 * selection starts and ends in it, and the text from the file as read (never the drawn
 * text). In the side-by-side layout only one column is selectable at a time, so a
 * selection is on one side there; in the unified layout removed and added lines follow each
 * other and become separate segments. `null` when nothing in the code is selected.
 */
function codeSelectionIn(
  root: HTMLElement,
  file: PairFile,
  layout: 'split' | 'unified',
  base: readonly string[],
  target: readonly string[],
): { readonly request: CodeSelectionRequest; readonly rect: DOMRect | null; readonly firstCell: HTMLElement } | null {
  const chosen = window.getSelection();
  if (chosen === null || chosen.rangeCount === 0 || chosen.isCollapsed) {
    return null;
  }
  const range = chosen.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  // The column the drag started in; a range in the DOM also spans the other column's cells.
  const startCell = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('td[data-code-side]');
  const column = layout === 'split' ? (root.querySelector<HTMLElement>('table')?.dataset['selectSide'] || startCell?.dataset['codeSide'] || null) : null;
  const cells = [...root.querySelectorAll<HTMLElement>('td[data-code-line]')].filter(
    (cell) => range.intersectsNode(cell) && (column === null || cell.dataset['codeSide'] === column),
  );
  const lengthTo = (cell: HTMLElement, node: Node, offset: number): number => {
    const part = document.createRange();
    part.setStart(cell, 0);
    part.setEnd(node, offset);
    return part.toString().length;
  };
  const picked = cells.map((cell) => {
    const side: LineSide = cell.dataset['codeSide'] === 'base' ? 'base' : 'target';
    const line = Number(cell.dataset['codeLine']);
    const length = ((side === 'base' ? base : target)[line - 1] ?? '').length;
    const from = cell.contains(range.startContainer) ? Math.min(length, lengthTo(cell, range.startContainer, range.startOffset)) : 0;
    const to = cell.contains(range.endContainer) ? Math.min(length, lengthTo(cell, range.endContainer, range.endOffset)) : length;
    return { cell, side, line, from, to, length };
  });
  // A selection that only reaches the end of the line before it, or the start of the line
  // after it, does not include those lines.
  while (picked.length > 0 && (picked[0] as (typeof picked)[number]).from >= (picked[0] as (typeof picked)[number]).length) {
    picked.shift();
  }
  while (picked.length > 0 && (picked.at(-1) as (typeof picked)[number]).to === 0) {
    picked.pop();
  }
  const first = picked[0];
  if (first === undefined || (picked.length === 1 && first.from >= first.to)) {
    return null;
  }
  const segments: { side: LineSide; path: string; start: number; end: number; from: number; to: number }[] = [];
  for (const entry of picked) {
    const path = entry.side === 'base' ? file.oldPath : file.newPath;
    if (path === null) {
      continue;
    }
    const last = segments.at(-1);
    if (last !== undefined && last.side === entry.side && last.end + 1 === entry.line) {
      last.end = entry.line;
      last.to = entry.to;
    } else {
      segments.push({ side: entry.side, path, start: entry.line, end: entry.line, from: entry.from, to: entry.to });
    }
  }
  const request: CodeSelectionRequest = { fileKey: file.key, layout, segments, text: selectedTextOf(segments, base, target) };
  if (request.text.trim() === '') {
    return null;
  }
  const rects = range.getClientRects();
  return { request, rect: rects.length > 0 ? (rects[rects.length - 1] ?? null) : null, firstCell: first.cell };
}

/** The text of selected segments, from the file's lines, joined as the host joins them. */
function selectedTextOf(
  segments: readonly { readonly side: LineSide; readonly start: number; readonly end: number; readonly from: number; readonly to: number }[],
  base: readonly string[],
  target: readonly string[],
): string {
  return segments
    .map((segment) =>
      (segment.side === 'base' ? base : target)
        .slice(segment.start - 1, segment.end)
        .map((line, index, all) => {
          const lead = index === 0 ? segment.from : 0;
          return index === all.length - 1 ? line.slice(lead, segment.to) : line.slice(lead);
        })
        .join('\n'),
    )
    .join('\n');
}

/** The code cell that shows a line of one side, in either layout. */
function codeCellOf(root: HTMLElement, side: LineSide, line: number): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(`td[data-code-side="${side}"][data-code-line="${String(line)}"]`) ??
    root.querySelector<HTMLElement>(`td[data-code-also="${side}:${String(line)}"]`)
  );
}

/**
 * Where the reader is in a file's diff (30 October 2026): a line of one side and how far
 * below the top of the view it is. A line is the same line in either layout and however
 * much is opened around it, so the place survives both.
 */
export interface ReadingSpot {
  readonly side: LineSide;
  readonly line: number;
  readonly offset: number;
}

/** The first code line at or below the top of the view (or of one row), as a spot. */
function spotAt(root: HTMLElement, only?: Element | null): ReadingSpot | null {
  const top = root.getBoundingClientRect().top;
  const rows = only === undefined ? [...root.querySelectorAll('tr')] : only === null ? [] : [only];
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (only === undefined && box.bottom <= top + 1) {
      continue;
    }
    const cell = row.querySelector<HTMLElement>('td[data-code-line]');
    const line = Number(cell?.dataset['codeLine']);
    if (cell !== null && cell !== undefined && Number.isInteger(line) && line > 0) {
      return { side: cell.dataset['codeSide'] === 'base' ? 'base' : 'target', line, offset: box.top - top };
    }
  }
  return null;
}

/** Scroll so that a spot's line is as far below the top as it was. */
function restoreSpot(root: HTMLElement, spot: ReadingSpot): boolean {
  const row = codeCellOf(root, spot.side, spot.line)?.closest('tr');
  if (row === null || row === undefined) {
    return false;
  }
  root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - spot.offset;
  return true;
}

type FoundSelection = { readonly request: CodeSelectionRequest; readonly rect: DOMRect | null; readonly firstCell: HTMLElement };

/**
 * DSP-152: what is offered for code selected with the mouse (or the keyboard), in every
 * code view of the diff window (30 October 2026): *Explain this* and *Ask…* beside the
 * selection, the same in a context menu, and Ctrl+Shift+E. Selecting never selects lines
 * for review and never marks anything; the actions leave the selection in place. While a
 * question is being written or the discussion is open (`quoteOpen`), a new selection becomes
 * what it is about, without a further press.
 */
function useSelectionOffer({
  scroller,
  wrap,
  read,
  onExplain,
  onAsk,
  quoteOpen,
  beforeExplain,
}: {
  readonly scroller: { readonly current: HTMLDivElement | null };
  readonly wrap: { readonly current: HTMLDivElement | null };
  /** The selection in this view, read now; `null` when nothing in its code is selected. */
  readonly read: () => FoundSelection | null;
  readonly onExplain: (request: CodeSelectionRequest) => void;
  /** `explicit`: Ask… was pressed, and the question takes the focus. */
  readonly onAsk: (request: CodeSelectionRequest, explicit: boolean) => void;
  readonly quoteOpen: boolean;
  readonly beforeExplain?: (request: CodeSelectionRequest) => void;
}): {
  readonly readOffer: (menu: boolean, at?: { readonly x: number; readonly y: number }) => boolean;
  readonly offered: boolean;
  readonly handlers: {
    readonly onMouseDown: (event: ReactMouseEvent) => void;
    readonly onMouseUp: (event: ReactMouseEvent) => void;
    readonly onKeyUp: (event: ReactKeyboardEvent) => void;
    readonly onContextMenu: (event: ReactMouseEvent) => void;
  };
  readonly view: JSX.Element | null;
  readonly explainNow: (request: CodeSelectionRequest) => void;
} {
  const dragging = useRef(false);
  const [offer, setOffer] = useState<{ readonly request: CodeSelectionRequest; readonly x: number; readonly y: number; readonly menu: boolean } | null>(null);
  const menuFirst = useRef<HTMLButtonElement | null>(null);
  const readOffer = (menu: boolean, at?: { readonly x: number; readonly y: number }): boolean => {
    const box = wrap.current?.getBoundingClientRect();
    const found = scroller.current === null || box === undefined ? null : read();
    if (found === null || box === undefined) {
      setOffer(null);
      return false;
    }
    const point = at ?? { x: found.rect?.right ?? box.left, y: (found.rect?.bottom ?? box.top) + 4 };
    setOffer({ request: found.request, x: Math.max(4, Math.min(point.x - box.left, box.width - 200)), y: Math.max(4, Math.min(point.y - box.top, box.height - 90)), menu });
    if (quoteOpen && !menu) {
      onAsk(found.request, false);
    }
    return true;
  };
  const askNow = (request: CodeSelectionRequest): void => {
    // The panel opening narrows the code: the selection is kept where it is, as for Explain this.
    beforeExplain?.(request);
    setOffer(null);
    onAsk(request, true);
  };
  const explainNow = (request: CodeSelectionRequest): void => {
    beforeExplain?.(request);
    setOffer(null);
    onExplain(request);
  };
  useEffect(() => {
    const changed = (): void => {
      if (!dragging.current) {
        const chosen = window.getSelection();
        if (chosen === null || chosen.isCollapsed) {
          setOffer(null);
        }
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOffer((before) => (before?.menu === true ? null : before));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        const found = scroller.current === null ? null : read();
        if (found !== null) {
          event.preventDefault();
          explainNow(found.request);
        }
      }
    };
    document.addEventListener('selectionchange', changed);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('selectionchange', changed);
      window.removeEventListener('keydown', key);
    };
  });
  useEffect(() => {
    if (offer?.menu === true) {
      menuFirst.current?.focus({ preventScroll: true });
    }
  }, [offer]);
  const handlers = {
    onMouseDown: (event: ReactMouseEvent): void => {
      if (event.button !== 0) {
        return;
      }
      dragging.current = true;
      setOffer(null);
      // Side by side, a selection stays in the column it starts in.
      const table = scroller.current?.querySelector<HTMLElement>('table.rv-pair-table-split');
      const cell = (event.target as Element).closest<HTMLElement>('td[data-code-side]');
      if (table !== null && table !== undefined) {
        table.dataset['selectSide'] = cell?.dataset['codeSide'] ?? '';
      }
    },
    onMouseUp: (event: ReactMouseEvent): void => {
      // A right button's release is followed by the context menu, which this would replace.
      if (event.button !== 0) {
        return;
      }
      dragging.current = false;
      // After the browser has settled the selection for this release.
      setTimeout(() => {
        readOffer(false);
      }, 0);
    },
    onKeyUp: (event: ReactKeyboardEvent): void => {
      if (event.shiftKey) {
        readOffer(false);
      }
    },
    onContextMenu: (event: ReactMouseEvent): void => {
      const keyboard = event.clientX === 0 && event.clientY === 0;
      if (readOffer(true, keyboard ? undefined : { x: event.clientX, y: event.clientY })) {
        event.preventDefault();
      }
    },
  };
  const view =
    offer === null ? null : offer.menu ? (
      <div className="rv-explain-menu" role="menu" data-ev="explain-menu" style={{ left: offer.x, top: offer.y }}>
        <button type="button" role="menuitem" ref={menuFirst} data-ev="explain-menu-explain" onMouseDown={(event) => event.preventDefault()} onClick={() => explainNow(offer.request)}>
          Explain this
        </button>
        <button type="button" role="menuitem" data-ev="explain-menu-ask" onMouseDown={(event) => event.preventDefault()} onClick={() => askNow(offer.request)}>
          Ask about this…
        </button>
        <button
          type="button"
          role="menuitem"
          data-ev="explain-menu-copy"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            void navigator.clipboard?.writeText(offer.request.text).catch(() => undefined);
            setOffer(null);
          }}
        >
          Copy
        </button>
      </div>
    ) : (
      <div className="rv-pair-offer" style={{ left: offer.x, top: offer.y }}>
        <button
          type="button"
          className="rv-explain-this"
          data-ev="explain-this"
          title="Explain the selected code (Ctrl+Shift+E). Marks nothing."
          // Pressing it must not take the selection away.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => explainNow(offer.request)}
        >
          Explain this
        </button>
        <button
          type="button"
          className="rv-explain-this"
          data-ev="ask-this"
          title="Write your own question about the selected code. Sends nothing yet."
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => askNow(offer.request)}
        >
          Ask…
        </button>
      </div>
    );
  return { readOffer, offered: offer !== null && !offer.menu, handlers, view, explainNow };
}

/** Code selected in a view, marked under a highlight name, without touching the DOM. */
function useMarked(
  name: string,
  scroller: { readonly current: HTMLDivElement | null },
  selection: { readonly fileKey: string; readonly segments: readonly { readonly side: LineSide; readonly start: number; readonly end: number; readonly from: number; readonly to: number }[] } | null,
  fileKey: string,
  redraw: readonly unknown[],
): void {
  useLayoutEffect(() => {
    const registry = CSS.highlights;
    const root = scroller.current;
    if (registry === undefined) {
      return;
    }
    if (selection === null || selection.fileKey !== fileKey || root === null) {
      registry.delete(name);
      return;
    }
    const ranges: Range[] = [];
    for (const segment of selection.segments) {
      for (let line = segment.start; line <= segment.end; line += 1) {
        const cell = codeCellOf(root, segment.side, line);
        const length = cell?.textContent?.length ?? 0;
        const found = cell === null ? null : rangeInCell(cell, line === segment.start ? segment.from : 0, line === segment.end ? Math.min(segment.to, length) : length);
        if (found !== null) {
          ranges.push(found);
        }
      }
    }
    registry.set(name, new Highlight(...ranges));
    return () => {
      registry.delete(name);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, selection, fileKey, ...redraw]);
}

function FileDiff({
  bridge,
  pairKey,
  file,
  allFiles,
  onShowElsewhere,
  record,
  threads,
  layout,
  target: targetProp,
  progress,
  onLayout,
  onMark,
  onBack,
  onPrevious,
  onNext,
  jobs,
  onDelegate,
  onStop,
  explained,
  onExplain,
  explainPanel,
  expansion,
  onExpansion,
  reading,
  onReading,
  quote,
  onAsk,
}: {
  /** DSP-152: the selection of the explanation shown, drawn marked in the code. */
  readonly explained: CodeSelection | null;
  readonly onExplain: (selection: CodeSelectionRequest) => void;
  readonly explainPanel: JSX.Element;
  /** How far this file is opened, kept by the review for as long as it is open. */
  readonly expansion: FileExpansion;
  readonly onExpansion: (expansion: FileExpansion) => void;
  /** Where the reader last was in this file, to come back to. */
  readonly reading: ReadingSpot | null;
  readonly onReading: (spot: ReadingSpot) => void;
  /**
   * Code selected to ask one's own question about (30 October 2026), drawn marked while
   * the question is written; `open` while it is. Then a new selection replaces it.
   */
  readonly quote: { readonly request: CodeSelectionRequest; readonly open: boolean } | null;
  /** Ask about the selection: opens the question with it quoted, and sends nothing. */
  readonly onAsk: (request: CodeSelectionRequest, explicit: boolean) => void;
  readonly bridge: ReviewPairBridge;
  readonly pairKey: string;
  readonly file: PairFile;
  /** Every file of the change, to tell a whole delegated part from a partial one. */
  readonly allFiles: readonly PairFile[];
  /** A place a review result points at, in another file of the change. */
  readonly onShowElsewhere: (range: LineRange) => void;
  readonly record: PairRecord;
  /** The review's threads (DSP-175); this file draws those anchored in it. */
  readonly threads: readonly ReviewThread[];
  readonly layout: 'split' | 'unified';
  readonly target: { readonly location: DiffLocation; readonly nonce: number } | null;
  readonly progress: FileProgress;
  readonly onLayout: (layout: 'split' | 'unified') => void;
  readonly onMark: (op: 'manual' | 'exempt' | 'clear', scopes: Parameters<ReviewPairBridge['mark']>[1]['scopes']) => Promise<void>;
  /** Back to *Files changed*, where the list was left. */
  readonly onBack: () => void;
  readonly onPrevious: (() => void) | null;
  readonly onNext: (() => void) | null;
  readonly jobs: readonly AgentJob[];
  readonly onDelegate: (choice: AgentChoice, scope: DelegationScope) => Promise<boolean>;
  readonly onStop: (job: AgentJob) => void;
}): JSX.Element {
  const [text, setText] = useState<FileText | null>(null);
  // A place asked for from this file's own agent findings; a walk's Show in diff replaces it.
  const [ownTarget, setOwnTarget] = useState<{ readonly location: DiffLocation; readonly nonce: number } | null>(null);
  useEffect(() => {
    setOwnTarget(null);
  }, [targetProp]);
  const target = ownTarget ?? targetProp;
  const [delegating, setDelegating] = useState<DelegationScope | null>(null);
  const fileJobs = [...jobs].reverse().filter((job) => job.kind === 'review' && touchesFile(job, file));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (file.binary) {
        setText({ base: null, target: null, binary: true, error: null });
        return;
      }
      const [base, target] = await Promise.all([
        file.oldPath === null ? Promise.resolve(null) : bridge.readFile(pairKey, 'base', file.oldPath),
        file.newPath === null ? Promise.resolve(null) : bridge.readFile(pairKey, 'target', file.newPath),
      ]);
      if (cancelled) {
        return;
      }
      const error = [base, target].find((answer) => answer !== null && isPairError(answer));
      if (error !== undefined && error !== null && isPairError(error)) {
        setText({ base: null, target: null, binary: false, error: error.error });
        return;
      }
      const baseText = base === null || isPairError(base) ? null : base;
      const targetText = target === null || isPairError(target) ? null : target;
      if (baseText?.binary === true || targetText?.binary === true) {
        setText({ base: null, target: null, binary: true, error: null });
        return;
      }
      setText({
        base: baseText?.text === null || baseText === null ? [] : splitLines(baseText.text),
        target: targetText?.text === null || targetText === null ? [] : splitLines(targetText.text),
        binary: false,
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, pairKey, file]);

  // A place asked for from a walk or an answer is always shown: the run hiding it is opened.
  useEffect(() => {
    if (target === null || text === null || text.base === null || text.target === null) {
      return;
    }
    const hiding = gapHiding(unifiedRowsOf(file, text.base.length, text.target.length, expansion), target.location.side, target.location.line);
    if (hiding !== null) {
      onExpansion(expandGap(expansion, hiding, 'all'));
    }
  }, [target, text, file, expansion, onExpansion]);

  // Brought into view once per request, not again whenever more is opened around it.
  const shownTarget = useRef<number | null>(null);
  useEffect(() => {
    if (target === null || shownTarget.current === target.nonce) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const found = scroller.current?.querySelector('.rv-pair-target');
      if (found !== null && found !== undefined) {
        found.scrollIntoView({ block: 'center' });
        shownTarget.current = target.nonce;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [target, text, layout, expansion]);

  const statuses = useMemo(() => lineStatusesOf(file, record), [file, record]);
  const changed = useMemo(() => changedLinesOf(file), [file]);
  const tokens = useMemo(
    () => ({
      base: text?.base === null || text?.base === undefined ? [] : highlightLines(text.base, file.oldPath ?? ''),
      target: text?.target === null || text?.target === undefined ? [] : highlightLines(text.target, file.newPath ?? ''),
    }),
    [text, file],
  );

  /*
   * The columns' widths, set once for the table. With a fixed table layout the browser
   * takes them from the first row, and a diff often starts with a fold whose one cell
   * spans every column: then all columns got the same share and the code a fraction of
   * it. The strip and the sign are narrow and fixed, the numbers as wide as the file's
   * largest line number needs, and the code everything else.
   */
  const digits = String(Math.max(tokens.base.length, tokens.target.length, 1)).length;
  const numberColumn = <col className="rv-pair-col-num" style={{ width: `calc(${String(digits)}ch + 0.8rem)` }} />;
  const sideColumns = (
    <>
      <col className="rv-pair-col-strip" />
      {numberColumn}
      <col className="rv-pair-col-sign" />
      <col />
    </>
  );

  const baseLength = text?.base?.length ?? 0;
  const targetLength = text?.target?.length ?? 0;
  const unified = useMemo(
    () => (text === null || text.binary ? [] : unifiedRowsOf(file, baseLength, targetLength, expansion)),
    [file, text, baseLength, targetLength, expansion],
  );
  const split = useMemo(
    () => (text === null || text.binary ? [] : splitRowsOf(file, baseLength, targetLength, expansion)),
    [file, text, baseLength, targetLength, expansion],
  );

  // DSP-175: threads at their code. A thread's card is drawn under the last line of its
  // first place in this file; its lines carry a margin mark that leaves the diff's red and
  // green readable, outlined when it is the chosen thread. A place in folded code is listed
  // above the diff until it is opened; a place that was not found marks nothing.
  const threadActions = useContext(ThreadContext);
  const selectedThreadId = threadActions?.selectedId ?? null;
  const pathAt = useCallback((side: LineSide): string | null => (side === 'base' ? file.oldPath : file.newPath), [file]);
  const anchoredHere = useMemo(() => threads.filter((thread) => thread.anchors.some((anchor) => anchor.path === pathAt(anchor.side))), [threads, pathAt]);
  const fileLevelThreads = useMemo(
    () => threads.filter((thread) => thread.level === 'file' && thread.file !== null && thread.file.path === pathAt(thread.file.side)),
    [threads, pathAt],
  );
  const cardsAt = useMemo(() => {
    const out = new Map<string, ReviewThread[]>();
    for (const thread of anchoredHere) {
      const anchor = thread.anchors.find((entry) => entry.path === pathAt(entry.side));
      if (anchor !== undefined) {
        const key = `${anchor.side}:${String(anchor.end)}`;
        out.set(key, [...(out.get(key) ?? []), thread]);
      }
    }
    return out;
  }, [anchoredHere, pathAt]);
  const shownLines = useMemo(() => {
    const keys = new Set<string>();
    if (layout === 'split') {
      for (const row of split) {
        if (row.kind !== 'gap') {
          if (row.base !== null) keys.add(`base:${String(row.base)}`);
          if (row.target !== null) keys.add(`target:${String(row.target)}`);
        }
      }
    } else {
      for (const row of unified) {
        if (row.kind !== 'gap') {
          if (row.kind !== 'added' && row.base !== null) keys.add(`base:${String(row.base)}`);
          if (row.kind !== 'deleted' && row.target !== null) keys.add(`target:${String(row.target)}`);
        }
      }
    }
    return keys;
  }, [layout, split, unified]);
  const foldedThreads = useMemo(
    () => [...cardsAt.entries()].filter(([key]) => !shownLines.has(key)).flatMap(([, list]) => list),
    [cardsAt, shownLines],
  );
  const threadMark = (side: LineSide, line: number | null): string => {
    if (line === null) {
      return '';
    }
    let mark = '';
    for (const thread of anchoredHere) {
      for (const anchor of thread.anchors) {
        if (anchor.side === side && anchor.path === pathAt(side) && line >= anchor.start && line <= anchor.end) {
          if (thread.id === selectedThreadId) {
            return 'rv-thread-anchor rv-thread-anchor-selected';
          }
          if (isRemaining(thread)) {
            mark = 'rv-thread-anchor';
          }
        }
      }
    }
    return mark;
  };
  const threadRow = (keys: readonly string[], columns: number): JSX.Element | null => {
    const here = keys.flatMap((key) => cardsAt.get(key) ?? []);
    return here.length === 0 ? null : (
      <tr className="rv-thread-row" data-ev="pair-thread-row">
        <td colSpan={columns}>
          <div className="rv-thread-slot">
            {here.map((thread) => (
              <ThreadCard key={thread.id} thread={thread} inline />
            ))}
          </div>
        </td>
      </tr>
    );
  };

  /*
   * Opening code above what is read keeps what is read where it is (30 October 2026): the
   * line below an opened run, or the first line in view, is held at its place on screen.
   */
  const hold = useRef<ReadingSpot | null>(null);
  useLayoutEffect(() => {
    const root = scroller.current;
    const spot = hold.current;
    if (root !== null && spot !== null) {
      hold.current = null;
      restoreSpot(root, spot);
    }
  }, [unified, split, layout]);
  const openGap = (gap: GapRow, how: 'down' | 'up' | 'all', row: Element | null): void => {
    const root = scroller.current;
    // Lines shown downwards appear below what is read; upwards or all, above the next change.
    hold.current = root === null || how === 'down' ? null : spotAt(root, row?.nextElementSibling ?? null);
    onExpansion(expandGap(expansion, gap, how));
  };
  const setWhole = (whole: boolean): void => {
    const root = scroller.current;
    hold.current = root === null ? null : spotAt(root);
    onExpansion({ ...expansion, whole });
  };
  const changeLayout = (next: 'split' | 'unified'): void => {
    const root = scroller.current;
    if (next !== layout) {
      hold.current = root === null ? null : spotAt(root);
    }
    onLayout(next);
  };
  // Back in a file within the review: where it was left, once its lines are drawn.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (restored.current || root === null || text === null) {
      return;
    }
    restored.current = true;
    if (reading !== null && targetProp === null) {
      restoreSpot(root, reading);
    }
  });

  // The changed lines in the order drawn, which is the order a shift-click spans.
  const order = useMemo(() => {
    const keys: string[] = [];
    if (layout === 'unified') {
      for (const row of unified) {
        if (row.kind === 'deleted' && file.oldPath !== null) {
          keys.push(lineKey({ side: 'base', path: file.oldPath, line: row.base }));
        } else if (row.kind === 'added' && file.newPath !== null) {
          keys.push(lineKey({ side: 'target', path: file.newPath, line: row.target }));
        }
      }
    } else {
      for (const row of split) {
        if (row.kind !== 'change') {
          continue;
        }
        if (row.base !== null && file.oldPath !== null) {
          keys.push(lineKey({ side: 'base', path: file.oldPath, line: row.base }));
        }
        if (row.target !== null && file.newPath !== null) {
          keys.push(lineKey({ side: 'target', path: file.newPath, line: row.target }));
        }
      }
    }
    return keys;
  }, [layout, unified, split, file]);

  const byKey = useMemo(() => new Map(changed.map((line) => [lineKey(line), line])), [changed]);

  const pick = (key: string, extend: boolean): void => {
    const index = order.indexOf(key);
    if (index < 0) {
      return;
    }
    if (extend && anchor.current !== null) {
      const [from, to] = anchor.current < index ? [anchor.current, index] : [index, anchor.current];
      setSelected(new Set(order.slice(from, to + 1)));
      return;
    }
    anchor.current = index;
    setSelected((before) => {
      const next = new Set(before);
      if (next.has(key) && next.size === 1) {
        next.clear();
        anchor.current = null;
      } else {
        next.clear();
        next.add(key);
      }
      return next;
    });
  };

  const applyToSelection = async (op: 'manual' | 'exempt' | 'clear'): Promise<void> => {
    const lines = [...selected].map((key) => byKey.get(key)).filter((line): line is ChangedLine => line !== undefined);
    if (lines.length === 0) {
      return;
    }
    await onMark(op, rangesOf(lines));
    setSelected(new Set());
    anchor.current = null;
  };

  const markWholeFile = async (op: 'manual' | 'exempt' | 'clear'): Promise<void> => {
    if (progress.total === 0) {
      await onMark(op, [{ kind: 'file', fileKey: file.key }]);
    } else {
      await onMark(op, rangesOf(changed));
    }
  };

  const onKey = (event: ReactKeyboardEvent<HTMLElement>, key: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(key, event.shiftKey);
    } else if (event.key === 'Escape') {
      setSelected(new Set());
      anchor.current = null;
    }
  };

  const isTarget = (side: LineSide, line: number | null): boolean =>
    target !== null && line !== null && target.location.side === side && target.location.line === line;

  const strip = (side: LineSide, line: number | null, changedRow: boolean): JSX.Element => {
    const path = side === 'base' ? file.oldPath : file.newPath;
    if (!changedRow || line === null || path === null) {
      return <td className="rv-pair-strip" aria-hidden="true" />;
    }
    const key = lineKey({ side, path, line });
    const status = statuses.get(key);
    const kind = status === undefined ? 'none' : stripStatusOf(status);
    const label = `${side === 'base' ? 'Removed' : 'Added'} line ${String(line)}: ${describeLine(status)}`;
    return (
      <td
        className={`rv-pair-strip rv-pair-strip-${kind}${selected.has(key) ? ' rv-pair-strip-selected' : ''}`}
        data-strip={kind}
        data-side={side}
        data-line={line}
        tabIndex={0}
        role="button"
        aria-pressed={selected.has(key)}
        aria-label={label}
        title={label}
        onClick={(event: ReactMouseEvent) => pick(key, event.shiftKey)}
        onKeyDown={(event) => onKey(event, key)}
      />
    );
  };

  const number = (side: LineSide, line: number | null, changedRow: boolean): JSX.Element => {
    const path = side === 'base' ? file.oldPath : file.newPath;
    const key = line === null || path === null ? null : lineKey({ side, path, line });
    const tint = !changedRow ? '' : line === null ? ' rv-pair-num-empty' : side === 'base' ? ' rv-pair-num-old' : ' rv-pair-num-new';
    return (
      <td
        className={(changedRow && key !== null ? 'rv-pair-num rv-pair-num-pick' : 'rv-pair-num') + tint}
        onClick={changedRow && key !== null ? (event: ReactMouseEvent) => pick(key, event.shiftKey) : undefined}
      >
        {line ?? ''}
      </td>
    );
  };

  const code = (side: LineSide, line: number | null): Token[] | undefined =>
    line === null ? undefined : (side === 'base' ? tokens.base : tokens.target)[line - 1];

  /*
   * What changed on each changed line, as Gerrit draws it: a replaced block is compared
   * as one text, so its lines are light with the changed characters strong; a block with
   * nothing on the other side is strong throughout. Both layouts read this one map.
   */
  const marks = useMemo(
    () => (text === null || text.base === null || text.target === null ? new Map() : changeMarksOf(file, text.base, text.target)),
    [file, text],
  );
  const wholeLine = (side: LineSide, line: number | null): boolean =>
    line !== null && marks.get(`${side}:${String(line)}`)?.kind === 'whole';

  const codeView = (side: LineSide, line: number | null, changedRow: boolean): JSX.Element => {
    const mark = changedRow && line !== null ? marks.get(`${side}:${String(line)}`) : undefined;
    return mark?.kind === 'ranges' && mark.ranges.length > 0 ? (
      <MarkedTokens tokens={code(side, line)} ranges={mark.ranges} />
    ) : (
      <TokensView tokens={code(side, line)} />
    );
  };

  /** The column of − and +, apart from the review strip and the numbers. */
  const sign = (kind: 'old' | 'new' | 'none' | 'empty'): JSX.Element => (
    <td className={`rv-pair-sign rv-pair-sign-${kind}`} aria-hidden="true">
      {kind === 'old' ? '−' : kind === 'new' ? '+' : ''}
    </td>
  );

  const selectedOnRow = (side: LineSide, line: number | null): boolean => {
    const path = side === 'base' ? file.oldPath : file.newPath;
    return line !== null && path !== null && selected.has(lineKey({ side, path, line }));
  };

  /*
   * A folded run of unchanged lines (30 October 2026): more lines from the change above it
   * or from the change below it, or all of it. Opened lines are unchanged code, not counted.
   */
  const gapRow = (gap: GapRow, columns: number): JSX.Element => (
    <tr key={gap.id} className="rv-pair-gap" data-gap={gap.id}>
      <td colSpan={columns}>
        <span className="rv-pair-gap-count">
          ⋯ {gap.count} unchanged {gap.count === 1 ? 'line' : 'lines'}
        </span>
        {gap.down && gap.count > MORE_LINES && (
          <button type="button" data-ev="gap-down" title="Show more of the lines below the change above" onClick={(event) => openGap(gap, 'down', event.currentTarget.closest('tr'))}>
            ↓ Show {MORE_LINES} more lines
          </button>
        )}
        {gap.up && gap.count > MORE_LINES && (
          <button type="button" data-ev="gap-up" title="Show more of the lines above the change below" onClick={(event) => openGap(gap, 'up', event.currentTarget.closest('tr'))}>
            ↑ Show {MORE_LINES} more lines
          </button>
        )}
        <button type="button" data-ev="gap-all" onClick={(event) => openGap(gap, 'all', event.currentTarget.closest('tr'))}>
          Show all {gap.count}
        </button>
      </td>
    </tr>
  );

  const noText = text !== null && (text.binary || (file.hunks.length === 0 && progress.total === 0));

  /*
   * DSP-152: Explain this, for code selected with the mouse (or the keyboard), offered beside
   * the selection, in a context menu, and as Ctrl+Shift+E. Selecting text never selects
   * lines for review and never marks anything; the action leaves the selection in place.
   */
  const wrap = useRef<HTMLDivElement | null>(null);
  // The row the reader is at, kept where it is when the diff's width changes.
  const anchorRow = useRef<{ readonly row: Element; readonly top: number } | null>(null);
  const rememberRow = (row?: Element | null): void => {
    const root = scroller.current;
    if (root === null) {
      return;
    }
    const box = root.getBoundingClientRect();
    const chosen = row ?? [...root.querySelectorAll('tr')].find((entry) => entry.getBoundingClientRect().bottom > box.top + 1);
    anchorRow.current = chosen === undefined || chosen === null ? null : { row: chosen, top: chosen.getBoundingClientRect().top - box.top };
    const spot = spotAt(root);
    if (spot !== null) {
      onReading(spot);
    }
  };
  useEffect(() => {
    const root = scroller.current;
    if (root === null) {
      return;
    }
    let width = root.clientWidth;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === width) {
        return;
      }
      width = root.clientWidth;
      const anchor = anchorRow.current;
      if (anchor !== null && anchor.row.isConnected) {
        root.scrollTop += anchor.row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.top;
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const { readOffer, offered, handlers, view: offerView, explainNow } = useSelectionOffer({
    scroller,
    wrap,
    read: () =>
      scroller.current === null || text === null || text.base === null || text.target === null
        ? null
        : codeSelectionIn(scroller.current, file, layout, text.base, text.target),
    onExplain,
    onAsk,
    // Every selection is what the review's next question is about, wherever it is asked (30 October 2026).
    quoteOpen: true,
    beforeExplain: (request) => {
      const root = scroller.current;
      const first = request.segments[0];
      if (root !== null && first !== undefined) {
        // The reading position is the selection's: it stays where it is when the panel opens.
        rememberRow(codeCellOf(root, first.side, first.start)?.closest('tr'));
      }
    },
  });

  // The selection of the explanation shown, and what a question being written is about.
  useMarked('rv-explained', scroller, explained, file.key, [text, layout, expansion, record]);
  useMarked('rv-quote', scroller, quote?.request ?? null, file.key, [text, layout, expansion]);

  /** The changed lines selected for review, as a selection to explain (the keyboard's way). */
  const explainLines = (): void => {
    if (text === null || text.base === null || text.target === null) {
      return;
    }
    const lines = order.filter((key) => selected.has(key)).map((key) => byKey.get(key)).filter((line): line is ChangedLine => line !== undefined);
    const segments: { side: LineSide; path: string; start: number; end: number; from: number; to: number }[] = [];
    for (const line of lines) {
      const length = ((line.side === 'base' ? text.base : text.target)[line.line - 1] ?? '').length;
      const last = segments.at(-1);
      if (last !== undefined && last.side === line.side && last.end + 1 === line.line) {
        last.end = line.line;
        last.to = length;
      } else {
        segments.push({ side: line.side, path: line.path, start: line.line, end: line.line, from: 0, to: length });
      }
    }
    if (segments.length > 0) {
      explainNow({ fileKey: file.key, layout, segments, text: selectedTextOf(segments, text.base, text.target) });
    }
  };

  return (
    <section className="rv-pair-file-view" aria-label={shownPath(file)}>
      <div className="rv-pair-file-head">
        <div className="rv-pair-file-title">
          <span className={`rv-pair-status rv-pair-status-${file.status}`}>{STATUS_WORD[file.status]}</span>
          {file.status === 'renamed' || file.status === 'copied' ? (
            <span>
              <span className="rv-pair-muted">{file.oldPath}</span> → {file.newPath}
              {file.similarity !== null && <span className="rv-pair-muted"> · {file.similarity}% similar</span>}
            </span>
          ) : (
            <span>{shownPath(file)}</span>
          )}
          <ProgressMark progress={progress} />
        </div>
        <div className="rv-pair-file-tools">
          <div className="rv-pair-toggle" role="group" aria-label="Diff layout">
            <button type="button" data-ev="pair-layout-split" aria-pressed={layout === 'split'} onClick={() => changeLayout('split')}>
              Side by side
            </button>
            <button type="button" data-ev="pair-layout-unified" aria-pressed={layout === 'unified'} onClick={() => changeLayout('unified')}>
              Unified
            </button>
          </div>
          <button
            type="button"
            className="rv-pair-whole"
            data-ev="pair-whole-file"
            aria-pressed={expansion.whole}
            title={expansion.whole ? 'Fold the unchanged code away again' : 'Show every line of the file, with the changes still marked'}
            onClick={() => setWhole(!expansion.whole)}
          >
            {expansion.whole ? 'Compact diff' : 'Show entire file'}
          </button>
          <button type="button" data-ev="pair-previous" disabled={onPrevious === null} onClick={() => onPrevious?.()} aria-label="Previous file">
            ‹
          </button>
          <button type="button" data-ev="pair-next" disabled={onNext === null} onClick={() => onNext?.()} aria-label="Next file">
            ›
          </button>
          <button type="button" className="rv-pair-up" data-ev="pair-files" onClick={onBack} aria-label="Back to Files changed" title="Files changed">
            ↑
          </button>
        </div>
      </div>
      <div className="rv-pair-actions" data-ev="pair-actions">
        {selected.size > 0 ? (
          <>
            <span>
              {selected.size} {selected.size === 1 ? 'line' : 'lines'} selected
            </span>
            <button type="button" data-ev="pair-mark-manual" onClick={() => void applyToSelection('manual')}>
              Mark reviewed
            </button>
            <button type="button" data-ev="pair-mark-exempt" onClick={() => void applyToSelection('exempt')}>
              Exempt
            </button>
            <button type="button" data-ev="pair-mark-clear" onClick={() => void applyToSelection('clear')}>
              Clear mark
            </button>
            <button
              type="button"
              data-ev="pair-delegate-selection"
              onClick={() => {
                const lines = [...selected].map((key) => byKey.get(key)).filter((line): line is ChangedLine => line !== undefined);
                const ranges = rangesOf(lines);
                setDelegating({ kind: 'lines', label: ranges.map((range) => `${range.path} ${range.side === 'base' ? 'removed ' : ''}lines ${String(range.start)}–${String(range.end)}`).join(', '), ranges });
              }}
            >
              Delegate…
            </button>
            <button type="button" data-ev="pair-explain-lines" title="Ask the agent to explain these lines. Marks nothing." onClick={explainLines}>
              Explain
            </button>
            <button type="button" className="rv-pair-link" onClick={() => setSelected(new Set())}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="rv-pair-muted">
              {progress.total === 0 ? 'Nothing to count line by line.' : 'Select changed lines by their edge or number; Shift extends.'}
            </span>
            <button type="button" data-ev="pair-file-manual" onClick={() => void markWholeFile('manual')}>
              {progress.total === 0 ? 'Mark file reviewed' : 'Mark all reviewed'}
            </button>
            <button type="button" data-ev="pair-file-exempt" onClick={() => void markWholeFile('exempt')}>
              {progress.total === 0 ? 'Exempt file' : 'Exempt all'}
            </button>
            <button type="button" data-ev="pair-file-clear" onClick={() => void markWholeFile('clear')}>
              Clear marks
            </button>
            {progress.total > 0 && (
              <button
                type="button"
                data-ev="pair-delegate-file"
                onClick={() => setDelegating({ kind: 'file', label: shownPath(file), ranges: rangesOf(changed) })}
              >
                Delegate file…
              </button>
            )}
          </>
        )}
      </div>
      {delegating !== null && (
        <div className="rv-agent-delegate">
          <p className="rv-pair-muted">
            Delegate {delegating.label} to the agent. It may approve only changed lines in this part that it reviewed and found acceptable; findings and uncertainties stay visible here.
          </p>
          <AgentPicker
            pairKey={pairKey}
            action="Delegate"
            busy={false}
            testId="pair-delegate-agent"
            onCancel={() => setDelegating(null)}
            onStart={(choice) => {
              const scope = delegating;
              void onDelegate(choice, scope).then((ok) => {
                if (ok) {
                  setDelegating(null);
                  setSelected(new Set());
                  anchor.current = null;
                }
              });
            }}
          />
        </div>
      )}
      {fileJobs.length > 0 && (
        <div className="rv-agent-reviews">
          {fileJobs.map((job, index) => (
            <AgentReviewResult
              key={job.id}
              job={job}
              files={allFiles}
              threads={threads.filter((thread) => thread.jobId === job.id)}
              open={index === 0}
              onStop={() => onStop(job)}
              onShow={(range) => {
                if (fileLocationMatch(file, { side: range.side, path: range.path, line: range.start })) {
                  setOwnTarget((before) => ({ location: { side: range.side, path: range.path, line: range.start }, nonce: (before?.nonce ?? 0) + 1 }));
                } else {
                  onShowElsewhere(range);
                }
              }}
            />
          ))}
        </div>
      )}
      {(fileLevelThreads.length > 0 || foldedThreads.length > 0) && (
        <div className="rv-thread-file-level" data-ev="pair-file-threads">
          {/* One line each, so the diff keeps its room; a line opens its thread in place. */}
          <ThreadIndex threads={fileLevelThreads} expand />
          {foldedThreads.length > 0 && (
            <>
              <p className="rv-sub">In code that is folded now; choosing one opens it:</p>
              <ThreadIndex threads={foldedThreads} />
            </>
          )}
        </div>
      )}
      <div className="rv-pair-diff-row">
      <div className="rv-pair-diff-wrap" ref={wrap}>
      <div
        className="rv-pair-diff"
        ref={scroller}
        onScroll={() => {
          rememberRow();
          if (offered) {
            readOffer(false);
          }
        }}
        onMouseDown={handlers.onMouseDown}
        onMouseUp={(event) => {
          handlers.onMouseUp(event);
          if (event.button === 0) {
            setTimeout(() => rememberRow(), 0);
          }
        }}
        onKeyUp={handlers.onKeyUp}
        onContextMenu={handlers.onContextMenu}
      >
        {text === null && <p className="rv-pair-muted">Reading…</p>}
        {text?.error !== null && text?.error !== undefined && <p className="rv-pair-error">{text.error}</p>}
        {noText && (
          <p className="rv-pair-nodiff" data-ev="pair-nodiff">
            {text?.binary
              ? 'Binary file: there is no text diff to show.'
              : file.status === 'renamed'
                ? 'Renamed without changes to its content.'
                : 'No change to the text: only the file mode or type changed.'}
          </p>
        )}
        {text !== null && !noText && text.error === null && layout === 'split' && (
          <table className="rv-pair-table rv-pair-table-split">
            <colgroup>
              {sideColumns}
              {sideColumns}
            </colgroup>
            <tbody>
              {split.map((row) =>
                row.kind === 'gap' && row.gap !== undefined ? (
                  gapRow(row.gap, 8)
                ) : (
                  <Fragment key={`${row.kind}-${String(row.base)}-${String(row.target)}`}>
                  <tr className={row.kind === 'change' ? 'rv-pair-row-change' : 'rv-pair-row-context'}>
                    {strip('base', row.base, row.kind === 'change')}
                    {number('base', row.base, row.kind === 'change')}
                    {sign(row.kind !== 'change' ? 'none' : row.base === null ? 'empty' : 'old')}
                    <td
                      className={[
                        'rv-pair-code',
                        row.kind === 'change' && row.base !== null ? 'rv-pair-old' : '',
                        row.kind === 'change' && wholeLine('base', row.base) ? 'rv-pair-whole' : '',
                        row.kind === 'change' && row.base === null ? 'rv-pair-empty' : '',
                        isTarget('base', row.base) ? 'rv-pair-target' : '',
                        selectedOnRow('base', row.base) ? 'rv-pair-selected' : '',
                        threadMark('base', row.base),
                      ].join(' ')}
                      data-code-side="base"
                      data-code-line={row.base ?? undefined}
                    >
                      {codeView('base', row.base, row.kind === 'change')}
                    </td>
                    {strip('target', row.target, row.kind === 'change')}
                    {number('target', row.target, row.kind === 'change')}
                    {sign(row.kind !== 'change' ? 'none' : row.target === null ? 'empty' : 'new')}
                    <td
                      className={[
                        'rv-pair-code',
                        row.kind === 'change' && row.target !== null ? 'rv-pair-new' : '',
                        row.kind === 'change' && wholeLine('target', row.target) ? 'rv-pair-whole' : '',
                        row.kind === 'change' && row.target === null ? 'rv-pair-empty' : '',
                        isTarget('target', row.target) ? 'rv-pair-target' : '',
                        selectedOnRow('target', row.target) ? 'rv-pair-selected' : '',
                        threadMark('target', row.target),
                      ].join(' ')}
                      data-code-side="target"
                      data-code-line={row.target ?? undefined}
                    >
                      {codeView('target', row.target, row.kind === 'change')}
                    </td>
                  </tr>
                  {threadRow([...(row.base === null ? [] : [`base:${String(row.base)}`]), ...(row.target === null ? [] : [`target:${String(row.target)}`])], 8)}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        )}
        {text !== null && !noText && text.error === null && layout === 'unified' && (
          <table className="rv-pair-table rv-pair-table-unified">
            <colgroup>
              <col className="rv-pair-col-strip" />
              {numberColumn}
              {numberColumn}
              <col className="rv-pair-col-sign" />
              <col />
            </colgroup>
            <tbody>
              {unified.map((row) => {
                if (row.kind === 'gap') {
                  return gapRow(row, 5);
                }
                const side: LineSide = row.kind === 'deleted' ? 'base' : 'target';
                const line = row.kind === 'deleted' ? row.base : row.target;
                const changedRow = row.kind !== 'context';
                return (
                  <Fragment key={row.kind === 'deleted' ? `d-${String(row.base)}` : row.kind === 'added' ? `a-${String(row.target)}` : `c-${String(row.base)}-${String(row.target)}`}>
                    <tr className={changedRow ? 'rv-pair-row-change' : 'rv-pair-row-context'}>
                      {strip(side, line, changedRow)}
                      <td className={`rv-pair-num${row.kind === 'deleted' ? ' rv-pair-num-old' : row.kind === 'added' ? ' rv-pair-num-new' : ''}`}>
                        {row.kind === 'added' ? '' : row.base}
                      </td>
                      <td className={`rv-pair-num${row.kind === 'deleted' ? ' rv-pair-num-old' : row.kind === 'added' ? ' rv-pair-num-new' : ''}`}>
                        {row.kind === 'deleted' ? '' : row.target}
                      </td>
                      {sign(row.kind === 'deleted' ? 'old' : row.kind === 'added' ? 'new' : 'none')}
                      <td
                        className={[
                          'rv-pair-code',
                          row.kind === 'deleted' ? 'rv-pair-old' : row.kind === 'added' ? 'rv-pair-new' : '',
                          changedRow && wholeLine(side, line) ? 'rv-pair-whole' : '',
                          isTarget(side, line) ? 'rv-pair-target' : '',
                          selectedOnRow(side, line) ? 'rv-pair-selected' : '',
                          threadMark(side, line) || (row.kind === 'context' ? threadMark('base', row.base) : ''),
                        ].join(' ')}
                        data-code-side={side}
                        data-code-line={line ?? undefined}
                        // An unchanged line is drawn once, at To; it is the same line of From.
                        data-code-also={row.kind === 'context' ? `base:${String(row.base)}` : undefined}
                      >
                        {codeView(side, line, changedRow)}
                      </td>
                    </tr>
                    {threadRow(
                      row.kind === 'context'
                        ? [`target:${String(row.target)}`, `base:${String(row.base)}`]
                        : [`${side}:${String(line)}`],
                      5,
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
        {offerView}
      </div>
      {explainPanel}
      </div>
    </section>
  );
}

/**
 * A code reference followed from an answer, opened in the diff window when the review has no
 * walk window to open it in (30 October 2026): a place
 * of its own to look around in, not a snippet. The file at the reference's revision is read
 * from Git, with the code around the referenced lines shown at once, more of it on request
 * and the whole file if wanted. The referenced lines carry a mark of their own, never the
 * diff's colours or a review status. Further references open from here; *Back* returns
 * through each to the diff, where it was left.
 */
export interface AwayEntry {
  readonly location: LineRange;
  /** Lines opened above and below the referenced ones, or the whole file. */
  readonly more: { readonly above: number; readonly below: number };
  readonly whole: boolean;
  /** Where the reader was in it, to come back to. */
  readonly reading: ReadingSpot | null;
}

function ReferenceView({
  bridge,
  pairKey,
  pair,
  entry,
  inChange,
  back,
  onBack,
  onChange,
  onShowInDiff,
  explained,
  onExplain,
  quote,
  onAsk,
  explainPanel,
}: {
  readonly bridge: ReviewPairBridge;
  readonly pairKey: string;
  readonly pair: OpenPair['pair'];
  readonly entry: AwayEntry;
  /** The changed file the reference is in, when it is in one at its side. */
  readonly inChange: PairFile | null;
  /** What Back returns to, in words. */
  readonly back: string;
  readonly onBack: () => void;
  readonly onChange: (entry: AwayEntry) => void;
  readonly onShowInDiff: (() => void) | null;
  readonly explained: CodeSelection | null;
  readonly onExplain: (selection: CodeSelectionRequest) => void;
  readonly quote: { readonly request: CodeSelectionRequest; readonly open: boolean } | null;
  readonly onAsk: (request: CodeSelectionRequest, explicit: boolean) => void;
  readonly explainPanel: JSX.Element;
}): JSX.Element {
  const { location } = entry;
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLines(null);
    setProblem(null);
    void bridge
      .readFile(pairKey, location.side, location.path)
      .catch((error: unknown) => ({ error: requestFailure(error) }))
      .then((answer) => {
        if (cancelled) {
          return;
        }
        if (isPairError(answer)) {
          setProblem(answer.error);
        } else if (answer.binary || answer.text === null) {
          setProblem('Binary file: there is no text to show.');
        } else {
          setLines(splitLines(answer.text));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, pairKey, location.side, location.path]);
  const tokens = useMemo(() => (lines === null ? [] : highlightLines([...lines], location.path)), [lines, location.path]);
  // A selection here: in the changed file at this side, or in a file outside the change.
  const file: PairFile = useMemo(
    () =>
      inChange ?? {
        key: outsideFileKey(location.path),
        status: 'modified',
        oldPath: location.path,
        newPath: location.path,
        similarity: null,
        binary: false,
        hunks: [],
        added: 0,
        deleted: 0,
      },
    [inChange, location.path],
  );
  const count = lines?.length ?? 0;
  const first = entry.whole ? 1 : Math.max(1, location.start - CONTEXT_LINES - entry.more.above);
  const last = entry.whole ? count : Math.min(count, location.end + CONTEXT_LINES + entry.more.below);

  // Opening code above what is read keeps what is read where it is; back here, where it was left.
  const hold = useRef<ReadingSpot | null>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (root === null || lines === null) {
      return;
    }
    if (!placed.current) {
      placed.current = true;
      if (entry.reading === null || !restoreSpot(root, entry.reading)) {
        root.querySelector('.rv-ref-line')?.scrollIntoView({ block: 'center' });
      }
      spotNow.current = spotAt(root);
      return;
    }
    const spot = hold.current;
    if (spot !== null) {
      hold.current = null;
      restoreSpot(root, spot);
    }
    spotNow.current = spotAt(root);
  }, [lines, first, last]);
  // Where it is read, kept when it is left (for a further reference, or Back past it).
  const spotNow = useRef<ReadingSpot | null>(entry.reading);
  const leaving = useRef({ entry, onChange });
  leaving.current = { entry, onChange };
  useEffect(
    () => () => {
      leaving.current.onChange({ ...leaving.current.entry, reading: spotNow.current });
    },
    [],
  );
  const change = (next: Partial<AwayEntry>, keep: 'view' | 'below' | null): void => {
    const root = scroller.current;
    if (root !== null && keep !== null) {
      hold.current = keep === 'view' ? spotAt(root) : spotAt(root, root.querySelector('tr.rv-ref-row'));
    }
    onChange({ ...entry, ...next, reading: root === null ? entry.reading : spotAt(root) });
  };

  const side: LineSide = location.side;
  const { readOffer, offered, handlers, view: offerView } = useSelectionOffer({
    scroller,
    wrap,
    read: () => (scroller.current === null || lines === null ? null : codeSelectionIn(scroller.current, file, 'unified', lines, lines)),
    onExplain,
    onAsk,
    // Every selection is what the review's next question is about (30 October 2026).
    quoteOpen: true,
  });
  useMarked('rv-explained', scroller, explained, file.key, [lines, first, last]);
  useMarked('rv-quote', scroller, quote?.request ?? null, file.key, [lines, first, last]);

  const folder = location.path.includes('/') ? location.path.slice(0, location.path.lastIndexOf('/') + 1) : '';
  const sha = side === 'base' ? pair.base : pair.target;
  const digits = String(Math.max(count, 1)).length;
  const gap = (where: 'above' | 'below', hidden: number): JSX.Element => (
    <tr key={`gap-${where}`} className="rv-pair-gap" data-gap={where}>
      <td colSpan={2}>
        <span className="rv-pair-gap-count">
          ⋯ {hidden} {hidden === 1 ? 'line' : 'lines'} {where}
        </span>
        {hidden > MORE_LINES && (
          <button
            type="button"
            data-ev={where === 'above' ? 'gap-up' : 'gap-down'}
            onClick={() => change({ more: { ...entry.more, [where]: entry.more[where] + MORE_LINES } }, where === 'above' ? 'below' : null)}
          >
            {where === 'above' ? '↑' : '↓'} Show {MORE_LINES} more lines
          </button>
        )}
        <button
          type="button"
          data-ev="gap-all"
          onClick={() => change({ more: { ...entry.more, [where]: count } }, where === 'above' ? 'below' : null)}
        >
          Show all {hidden}
        </button>
      </td>
    </tr>
  );
  const rows: JSX.Element[] = [];
  if (lines !== null) {
    if (first > 1) {
      rows.push(gap('above', first - 1));
    }
    for (let line = first; line <= last; line += 1) {
      const inReference = line >= location.start && line <= location.end;
      rows.push(
        <tr key={line} className={inReference ? 'rv-pair-row-context rv-ref-row' : 'rv-pair-row-context'}>
          <td className="rv-pair-num">{line}</td>
          <td className={inReference ? 'rv-pair-code rv-ref-line' : 'rv-pair-code'} data-code-side={side} data-code-line={line}>
            <TokensView tokens={tokens[line - 1]} />
          </td>
        </tr>,
      );
    }
    if (last < count) {
      rows.push(gap('below', count - last));
    }
  }
  return (
    <section className="rv-pair-file-view rv-pair-away" aria-label={location.path} data-ev="pair-away">
      <div className="rv-pair-file-head">
        <div className="rv-away rv-pair-away-bar" data-ev="away-bar">
          <span className="rv-away-where">
            <span className="rv-away-file" title={location.path}>
              {location.path.split('/').pop()}
            </span>
            {folder !== '' && <span className="rv-away-folder">{folder}</span>}
            <span className={`rv-away-side rv-away-side-${side}`} data-ev="away-side">
              {side === 'base' ? 'From' : 'To'} · {sha.slice(0, 7)}
            </span>
            <span className="rv-away-lines">{location.start === location.end ? `line ${String(location.start)}` : `lines ${String(location.start)}–${String(location.end)}`}</span>
            <span className="rv-pair-muted">{inChange === null ? 'not changed in this review' : 'changed in this review'}</span>
          </span>
          <span className="rv-pair-file-tools">
            {onShowInDiff !== null && (
              <button type="button" data-ev="away-show-in-diff" onClick={onShowInDiff}>
                Show in diff
              </button>
            )}
            <button
              type="button"
              className="rv-pair-whole"
              data-ev="pair-whole-file"
              aria-pressed={entry.whole}
              onClick={() => change({ whole: !entry.whole }, 'view')}
            >
              {entry.whole ? 'Around the reference' : 'Show entire file'}
            </button>
            <button type="button" className="rv-away-back" data-ev="away-back" onClick={onBack}>
              ← Back to {back}
            </button>
          </span>
        </div>
      </div>
      <div className="rv-pair-diff-row">
        <div className="rv-pair-diff-wrap" ref={wrap}>
          <div
            className="rv-pair-diff"
            ref={scroller}
            onScroll={() => {
              if (scroller.current !== null && lines !== null) {
                spotNow.current = spotAt(scroller.current);
              }
              if (offered) {
                readOffer(false);
              }
            }}
            {...handlers}
          >
            {lines === null && problem === null && <p className="rv-pair-muted">Reading…</p>}
            {problem !== null && <p className="rv-pair-error">{problem}</p>}
            {lines !== null && (
              <table className="rv-pair-table rv-pair-table-reference">
                <colgroup>
                  <col className="rv-pair-col-num" style={{ width: `calc(${String(digits)}ch + 0.8rem)` }} />
                  <col />
                </colgroup>
                <tbody>{rows}</tbody>
              </table>
            )}
          </div>
          {offerView}
        </div>
        {explainPanel}
      </div>
    </section>
  );
}

/**
 * Highlighted tokens with the changed characters of a compared line marked.
 *
 * The syntax colours stay: a token is cut where a changed range starts or ends, and the
 * changed pieces get a stronger shade of the line's own colour around them.
 */
function MarkedTokens({
  tokens,
  ranges,
}: {
  readonly tokens: readonly Token[] | undefined;
  readonly ranges: LineRanges;
}): JSX.Element {
  if (tokens === undefined) {
    return <></>;
  }
  const pieces: JSX.Element[] = [];
  let at = 0;
  tokens.forEach((token, tokenIndex) => {
    let start = 0;
    while (start < token.text.length) {
      const offset = at + start;
      const inside = ranges.find(([from, to]) => offset >= from && offset < to);
      const nextEdge = inside !== undefined
        ? inside[1]
        : Math.min(...ranges.map(([from]) => from).filter((from) => from > offset), Number.POSITIVE_INFINITY);
      const end = Math.min(token.text.length, nextEdge - at);
      const piece = token.text.slice(start, end);
      const kind = token.kind === 'plain' ? '' : `rv-tk-${token.kind}`;
      const className = [kind, inside !== undefined ? 'rv-pair-word' : ''].filter((name) => name !== '').join(' ');
      pieces.push(
        className === '' ? (
          <Fragment key={`${String(tokenIndex)}-${String(start)}`}>{piece}</Fragment>
        ) : (
          <span key={`${String(tokenIndex)}-${String(start)}`} className={className}>
            {piece}
          </span>
        ),
      );
      start = end;
    }
    at += token.text.length;
  });
  return <>{pieces}</>;
}
