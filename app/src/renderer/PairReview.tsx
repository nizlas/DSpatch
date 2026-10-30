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

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import { highlightLines, type Token } from '../shared/review-model';
import {
  changedLinesOf,
  fileProgressOf,
  fileReviewFactsOf,
  changeMarksOf,
  isPairError,
  lineKey,
  lineStatusesOf,
  rangesOf,
  shownPath,
  splitRowsOf,
  stripStatusOf,
  unifiedRowsOf,
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
  type AgentFinding,
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
  type ReviewRequirement,
  type StripStatus,
} from '../shared/review-pair';
import { TokensView } from './review-code';
import { AgentPicker, type AgentChoice } from './AgentPicker';
import { ExplainPanel, explanationThreads } from './ExplainPanel';
import { rangeInCell } from './walk-selection';
import { changedRangesOf } from '../shared/review-agent';

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
   * The way into review: the reviews not ended, when there are any, with *Start a new
   * review* beside them; else straight to choosing a repository. Reading the list starts
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
      const outcome = await bridge.open(review.pair);
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
      const outcome = await bridge.open(start.pair);
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
  return (
    <div className="rv rv-pair">
      {phase.kind === 'loading' && <p className="rv-pair-message">Reading the workspace…</p>}
      {phase.kind === 'message' && <p className="rv-pair-message" data-ev="pair-message">{phase.text}</p>}
      {phase.kind === 'ongoing' && (
        <OngoingList
          reviews={phase.reviews}
          note={phase.note}
          onResume={(review) => void resume(review)}
          onNew={() => void chooseRepository()}
          onEnd={(review) => {
            void bridge.end(review.pair).then((answer) => {
              void showReviews(isPairError(answer) ? answer.error : '');
            });
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
          onChangeRevisions={() => setPhase({ kind: 'log', repository: phase.repository, several: phase.several })}
          onAllReviews={() => void showReviews('')}
        />
      )}
    </div>
  );
}

// --- Choosing ---------------------------------------------------------------------------

/**
 * The reviews not ended (Niclas's trial feedback, 29 October 2026): each opens where it
 * was left, with its marks, explanations and walks, without any agent work. Several can be
 * ongoing at once; closing a window does not end one, *End review* does, and that approves
 * nothing.
 */
function OngoingList({
  reviews,
  note,
  onResume,
  onNew,
  onEnd,
}: {
  readonly reviews: readonly OngoingReview[];
  readonly note: string | null;
  readonly onResume: (review: OngoingReview) => void;
  readonly onNew: () => void;
  readonly onEnd: (review: OngoingReview) => void;
}): JSX.Element {
  return (
    <div className="rv-pair-choose">
      <header className="rv-pair-head">
        <h1>Reviews</h1>
        <button type="button" className="rv-pair-primary" data-ev="pair-new-review" onClick={onNew}>
          Start a new review
        </button>
      </header>
      {note !== null && note !== '' && (
        <p className="rv-pair-hint" data-ev="pair-ongoing-note">
          {note}
        </p>
      )}
      {reviews.length === 0 ? (
        <p className="rv-pair-message">No ongoing reviews.</p>
      ) : (
        <>
          <h2 className="rv-pair-section">Ongoing</h2>
          <ul className="rv-pair-ongoing">
            {reviews.map((review, index) => {
              const percent = review.total === 0 ? null : Math.floor((review.handled * 100) / review.total);
              return (
                <li key={review.key} className="rv-pair-ongoing-row">
                  <button type="button" className="rv-pair-ongoing-open" data-ev={`pair-ongoing-open-${String(index)}`} onClick={() => onResume(review)}>
                    <span className="rv-pair-ongoing-repo">{review.repositoryName}</span>
                    <span className="rv-pair-ongoing-revs">
                      <code>{short(review.base.hash)}</code> {review.base.subject}
                      <span className="rv-pair-arrow" aria-hidden="true"> → </span>
                      <code>{short(review.target.hash)}</code> {review.target.subject}
                    </span>
                    <span className="rv-pair-ongoing-progress">
                      {percent === null ? '' : `${String(percent)}% handled · `}
                      {review.filesDone} of {review.files} {review.files === 1 ? 'file' : 'files'} done
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rv-pair-link"
                    data-ev={`pair-ongoing-end-${String(index)}`}
                    title="Take it off this list. Nothing is approved or deleted; choosing the same two commits opens it again."
                    onClick={() => onEnd(review)}
                  >
                    End review
                  </button>
                </li>
              );
            })}
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
        const file = open.files.find((candidate) => fileLocationMatch(candidate, location));
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
  const startJob = async (request: AgentJobRequestInput): Promise<boolean> => (await sendJob(request)) !== null;
  /** The one way this window starts agent work; a refusal or a failed request is said. */
  const sendJob = async (request: AgentJobRequestInput): Promise<AgentJob | null> => {
    setProblem(null);
    setExplainProblem(null);
    // A request that fails on its way (IPC or the host) is said, as a refusal is: a press
    // that starts nothing must never leave the window as it was.
    const answer = await bridge.startJob(open.key, request).catch((error: unknown) => ({ error: requestFailure(error) }));
    if (isPairError(answer)) {
      if (request.kind === 'explain') {
        setExplainProblem(`The explanation could not be started: ${answer.error}`);
        setExplainOpen(true);
      } else {
        setProblem(`${request.kind === 'walks' ? 'The code walks could not be started' : 'The review could not be started'}: ${answer.error}`);
      }
      return null;
    }
    if (request.kind === 'walks') {
      startedWalks.current.add(answer.id);
    }
    return answer;
  };

  /*
   * DSP-152: explanations of selected code. Started with the review's current agent and
   * model, the ones the picker would start from, without asking again; only when there is
   * no usable choice does the picker ask, and the selection waits for it. Never another
   * agent or a fallback model.
   */
  type ExplainAsk = Pick<AgentJobRequestInput, 'selection' | 'followUp'>;
  const [explainActive, setExplainActive] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainProblem, setExplainProblem] = useState<string | null>(null);
  const [awaitingAgent, setAwaitingAgent] = useState<ExplainAsk | null>(null);
  const threads = useMemo(() => explanationThreads(record.jobs), [record.jobs]);
  const explaining = record.jobs.some((job) => job.kind === 'explain' && isRunning(job));
  const explainWith = async (asked: ExplainAsk, choice: AgentChoice): Promise<void> => {
    const job = await sendJob({ kind: 'explain', ...choice, ...asked });
    if (job !== null) {
      setAwaitingAgent(null);
      setExplainActive(job.followUp?.root ?? job.id);
    }
  };
  const explain = async (asked: ExplainAsk): Promise<void> => {
    setExplainOpen(true);
    setExplainProblem(null);
    const agents = await bridge.agents(open.key).catch((error: unknown) => ({ error: requestFailure(error) }));
    if (isPairError(agents)) {
      setExplainProblem(`The explanation could not be started: ${agents.error}`);
      return;
    }
    const chosen = agents.current;
    if (chosen === null || !chosen.choosable || chosen.model.trim() === '') {
      setAwaitingAgent(asked);
      return;
    }
    await explainWith(asked, { provider: chosen.provider, model: chosen.model });
  };
  /** A place in the diff, in this file or another of the change, as Show in diff goes there. */
  const showAt = (location: DiffLocation): void => {
    const file = open.files.find((candidate) => fileLocationMatch(candidate, location));
    if (file !== undefined) {
      openFile(file.key);
      setTarget((before) => ({ location, nonce: (before?.nonce ?? 0) + 1 }));
    }
  };
  const showSelection = (selection: CodeSelection): void => {
    const first = selection.segments[0];
    const file = open.files.find((candidate) => candidate.key === selection.fileKey);
    if (first !== undefined && file !== undefined) {
      openFile(file.key);
      setTarget((before) => ({ location: { side: first.side, path: first.path, line: first.start }, nonce: (before?.nonce ?? 0) + 1 }));
    }
  };
  const stopJob = async (job: AgentJob): Promise<void> => {
    const answer = await bridge.cancelJob(open.key, job.id).catch((error: unknown) => ({ error: requestFailure(error) }));
    if (isPairError(answer)) {
      setProblem(answer.error);
    }
  };

  const setRequirement = async (requirement: ReviewRequirement): Promise<void> => {
    const answer = await bridge.setRequirement(open.key, requirement);
    if (!isPairError(answer)) {
      setRecord(answer);
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
        explainActive,
        explainPanel: ((): unknown => {
          const panel = document.querySelector<HTMLElement>('.rv-explain');
          return panel === null
            ? null
            : {
                open: panel.dataset['ev'] === 'explain-panel',
                text: (panel.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
                segments: [...panel.querySelectorAll('[data-ev="explain-segment"]')].map((node) => node.textContent ?? ''),
                answers: [...panel.querySelectorAll<HTMLDetailsElement>('[data-ev="explain-answer"]')].map((node) => ({
                  state: node.dataset['state'] ?? '',
                  open: node.open,
                  text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
                })),
                reopen: [...panel.querySelectorAll('[data-ev="explain-reopen"]')].map((node) => node.textContent ?? ''),
                picker: panel.querySelector('[data-ev="explain-agent"]') !== null,
                width: Math.round(panel.getBoundingClientRect().width),
              };
        })(),
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
      }),
    };
    return () => {
      delete window.__dspatchPairCheck;
    };
  }, [open, fileKey, layout, record, progress, explainActive, walksNote, walkCount]);

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
    <div className="rv-pair-review">
      <header className="rv-pair-head rv-pair-review-head">
        <h1>
          {open.repositoryName}
          <span className="rv-pair-revs">
            <code title={open.base.subject}>{short(open.base.hash)}</code> → <code title={open.target.subject}>{short(open.target.hash)}</code>
          </span>
        </h1>
        <div className="rv-pair-tools">
          <label
            className="rv-pair-requirement"
            title="What counts as handled. Exempted lines count either way. An agent's approval counts only for parts you delegated to it, unless you choose any recorded agent review."
          >
            Counts as handled
            <select data-ev="pair-requirement" value={record.requirement} onChange={(event) => void setRequirement(event.target.value as ReviewRequirement)}>
              <option value="manual">Your review, or the agent's where you delegate</option>
              <option value="manual-or-agent">Your review or any recorded agent review</option>
            </select>
          </label>
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
          <button type="button" className="rv-pair-link" data-ev="pair-change-revisions" onClick={onChangeRevisions}>
            Change revisions
          </button>
          <button type="button" className="rv-pair-link" data-ev="pair-all-reviews" onClick={onAllReviews}>
            All reviews
          </button>
        </div>
      </header>
      {preparing && (
        <div className="rv-pair-walks">
          <AgentPicker
            pairKey={open.key}
            action="Prepare code walks"
            busy={false}
            testId="pair-walks-agent"
            onCancel={() => setPreparing(false)}
            onStart={(choice) => {
              void startJob({ kind: 'walks', ...choice }).then((ok) => {
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
      <div className="rv-pair-body" ref={body}>
        {current === null ? (
          <FilesChanged
            pairKey={open.key}
            files={open.files}
            progress={progress}
            record={record}
            totals={totals}
            jobs={record.jobs}
            onOpen={(file) => openFile(file.key)}
            onDelegate={(choice) =>
              startJob({ kind: 'review', ...choice, scope: { kind: 'file', label: 'the whole change', ranges: changedRangesOf(open.files) } })
            }
            onStop={(job) => void stopJob(job)}
          />
        ) : (
          <FileDiff
            key={current.key}
            bridge={bridge}
            pairKey={open.key}
            file={current}
            record={record}
            layout={layout}
            target={target !== null && fileLocationMatch(current, target.location) ? target : null}
            progress={progress.get(current.key) as FileProgress}
            onLayout={setLayout}
            onMark={mark}
            jobs={record.jobs}
            onDelegate={(choice, scope) => startJob({ kind: 'review', ...choice, scope })}
            onStop={(job) => void stopJob(job)}
            explained={threads.find((entry) => entry.root.id === explainActive)?.root.selection ?? null}
            onExplain={(selection) => void explain({ selection })}
            explainPanel={
              <ExplainPanel
                pairKey={open.key}
                threads={threads}
                fileKey={current.key}
                active={explainActive}
                open={explainOpen}
                picking={awaitingAgent !== null}
                busy={explaining}
                problem={explainProblem}
                canShow={(range) => open.files.some((file) => fileLocationMatch(file, { side: range.side, path: range.path, line: range.start }))}
                onToggle={() => setExplainOpen((value) => !value)}
                onActivate={(root) => {
                  setExplainActive(root);
                  const thread = threads.find((entry) => entry.root.id === root);
                  if (thread !== undefined) {
                    showSelection(thread.root.selection);
                  }
                }}
                onShowSelection={showSelection}
                onShowRange={(range) => showAt({ side: range.side, path: range.path, line: range.start })}
                onFollowUp={(root, action, question) => void explain({ followUp: { root, action, ...(action === 'question' ? { question } : {}) } })}
                onPick={(choice) => {
                  if (awaitingAgent !== null) {
                    void explainWith(awaitingAgent, choice);
                  }
                }}
                onCancelPick={() => setAwaitingAgent(null)}
                onStop={(job) => void stopJob(job)}
              />
            }
            onBack={() => openFile(null)}
            onPrevious={currentIndex > 0 ? () => openFile(open.files[currentIndex - 1]?.key ?? null) : null}
            onNext={currentIndex < open.files.length - 1 ? () => openFile(open.files[currentIndex + 1]?.key ?? null) : null}
          />
        )}
      </div>
    </div>
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
  return `${job.provider === 'claude' ? 'Claude' : 'Cursor'} (${job.model})`;
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
  const words = `${job.provider === 'claude' ? 'Claude' : 'Cursor'} · ${job.model} · ${formatDate(job.startedAt)}`;
  return job.state === 'done' ? words : `Last attempt (${words}):`;
}

/**
 * Where one piece of agent work stands, in a line, with Stop while it runs. Since Niclas's
 * trial feedback (29 October 2026) the product view says only that: no job ids, internal
 * times, reads or tool calls. Those stay in the review record, and the provider's own
 * words for a failure are on the note's tooltip for whoever needs them.
 */
export function JobLine({ job, onStop }: { readonly job: AgentJob; readonly onStop: () => void }): JSX.Element {
  const running = job.state === 'running' || job.state === 'cancelling';
  const what =
    job.kind === 'walks'
      ? 'Preparing code walks'
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

const SEVERITY_WORD: Record<AgentFinding['severity'], string> = { problem: 'Problem', question: 'Question', note: 'Note' };

/** A delegated review's outcome: what was reviewed and approved, and every finding and uncertainty. */
function AgentReviewResult({
  job,
  onStop,
  onShow,
}: {
  readonly job: AgentJob;
  readonly onStop: () => void;
  readonly onShow: (range: LineRange) => void;
}): JSX.Element {
  const result = job.result;
  const approved = result?.approved.reduce((total, range) => total + range.end - range.start + 1, 0) ?? 0;
  return (
    <details className="rv-agent-review" open data-ev="agent-review" data-state={job.state}>
      <summary>
        Agent review · {job.scope?.label ?? ''} · {job.state === 'done' ? (result?.insufficient ? 'not enough to judge' : `${String(approved)} line(s) approved`) : job.state}
      </summary>
      {job.state === 'running' || job.state === 'cancelling' ? (
        <JobLine job={job} onStop={onStop} />
      ) : result === null ? (
        <p>
          <span className="rv-agent-attempt">{attemptLabel(job)}</span> <JobNote job={job} />
        </p>
      ) : (
        <div className="rv-agent-review-body">
          {result.insufficient && <p className="rv-agent-insufficient">The agent could not judge this part from the code it could read. Nothing was approved.</p>}
          {result.assessment !== '' && <p>{result.assessment}</p>}
          {result.findings.length > 0 && (
            <ul className="rv-agent-findings">
              {result.findings.map((finding, index) => (
                <li key={index} className={`rv-agent-finding-${finding.severity}`} data-ev="agent-finding">
                  <strong>{SEVERITY_WORD[finding.severity]}.</strong> {finding.text}
                  {finding.location !== null && (
                    <button type="button" className="rv-pair-link" onClick={() => onShow(finding.location as LineRange)}>
                      {rangeWords(finding.location)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.uncertainties.length > 0 && (
            <div className="rv-agent-uncertain">
              <span className="rv-pair-muted">Not established:</span>
              <ul>
                {result.uncertainties.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="rv-pair-muted">
            {agentName(job)} · reviewed {result.reviewed.map(rangeWords).join(', ') || 'nothing'}
            {approved > 0 ? ` · approved ${result.approved.map(rangeWords).join(', ')}` : ''}
          </p>
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
  onOpen,
  onDelegate,
  onStop,
}: {
  readonly pairKey: string;
  readonly files: readonly PairFile[];
  readonly progress: ReadonlyMap<string, FileProgress>;
  readonly record: PairRecord;
  readonly totals: { readonly total: number; readonly handled: number; readonly done: number };
  readonly jobs: readonly AgentJob[];
  readonly onOpen: (file: PairFile) => void;
  readonly onDelegate: (choice: AgentChoice) => Promise<boolean>;
  readonly onStop: (job: AgentJob) => void;
}): JSX.Element {
  const [delegating, setDelegating] = useState(false);
  const facts = useMemo(() => new Map(files.map((file) => [file.key, fileReviewFactsOf(file, record)])), [files, record]);
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
      {whole !== null && (!delegating || isRunning(whole)) && <JobLine job={whole} onStop={() => onStop(whole)} />}
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
                  {fileFacts.findings > 0 && (
                    <span className="rv-pair-findings" data-ev="pair-file-findings">
                      {fileFacts.findings} open {fileFacts.findings === 1 ? 'finding' : 'findings'}
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

function FileDiff({
  bridge,
  pairKey,
  file,
  record,
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
}: {
  /** DSP-152: the selection of the explanation shown, drawn marked in the code. */
  readonly explained: CodeSelection | null;
  readonly onExplain: (selection: CodeSelectionRequest) => void;
  readonly explainPanel: JSX.Element;
  readonly bridge: ReviewPairBridge;
  readonly pairKey: string;
  readonly file: PairFile;
  readonly record: PairRecord;
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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

  // A place asked for from a walk is always shown, even inside a folded run.
  useEffect(() => {
    if (target === null || text === null || text.base === null) {
      return;
    }
    setExpanded(new Set(['*']));
  }, [target, text]);

  useEffect(() => {
    if (target === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scroller.current?.querySelector('.rv-pair-target')?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [target, text, layout, expanded]);

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
  const allExpanded = expanded.has('*');
  const unified = useMemo(
    () => (text === null || text.binary ? [] : unifiedRowsOf(file, baseLength, targetLength, allExpanded ? new Set(['*']) : expanded)),
    [file, text, baseLength, targetLength, expanded, allExpanded],
  );
  const split = useMemo(
    () => (text === null || text.binary ? [] : splitRowsOf(file, baseLength, targetLength, allExpanded ? new Set(['*']) : expanded)),
    [file, text, baseLength, targetLength, expanded, allExpanded],
  );

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

  const gapRow = (id: string, count: number, columns: number): JSX.Element => (
    <tr key={id} className="rv-pair-gap">
      <td colSpan={columns}>
        <button type="button" onClick={() => setExpanded((before) => new Set([...before, id]))}>
          ⋯ {count} unchanged {count === 1 ? 'line' : 'lines'}
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
  const dragging = useRef(false);
  const [offer, setOffer] = useState<{ readonly request: CodeSelectionRequest; readonly x: number; readonly y: number; readonly menu: boolean } | null>(null);
  const menuFirst = useRef<HTMLButtonElement | null>(null);
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

  const readOffer = (menu: boolean, at?: { readonly x: number; readonly y: number }): boolean => {
    const root = scroller.current;
    const box = wrap.current?.getBoundingClientRect();
    if (root === null || box === undefined || text === null || text.base === null || text.target === null) {
      setOffer(null);
      return false;
    }
    const found = codeSelectionIn(root, file, layout, text.base, text.target);
    if (found === null) {
      setOffer(null);
      return false;
    }
    const point = at ?? { x: found.rect?.right ?? box.left, y: (found.rect?.bottom ?? box.top) + 4 };
    setOffer({ request: found.request, x: Math.max(4, Math.min(point.x - box.left, box.width - 140)), y: Math.max(4, Math.min(point.y - box.top, box.height - 70)), menu });
    return true;
  };
  const explainNow = (request: CodeSelectionRequest): void => {
    const root = scroller.current;
    const first = request.segments[0];
    if (root !== null && first !== undefined) {
      // The reading position is the selection's: it stays where it is when the panel opens.
      rememberRow(codeCellOf(root, first.side, first.start)?.closest('tr'));
    }
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
        const root = scroller.current;
        if (root === null || text === null || text.base === null || text.target === null) {
          return;
        }
        const found = codeSelectionIn(root, file, layout, text.base, text.target);
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

  // The selection of the explanation shown, marked in the code without touching the DOM.
  useLayoutEffect(() => {
    const registry = CSS.highlights;
    const root = scroller.current;
    if (registry === undefined) {
      return;
    }
    if (explained === null || explained.fileKey !== file.key || root === null) {
      registry.delete('rv-explained');
      return;
    }
    const ranges: Range[] = [];
    for (const segment of explained.segments) {
      for (let line = segment.start; line <= segment.end; line += 1) {
        const cell = codeCellOf(root, segment.side, line);
        const length = cell?.textContent?.length ?? 0;
        const found = cell === null ? null : rangeInCell(cell, line === segment.start ? segment.from : 0, line === segment.end ? Math.min(segment.to, length) : length);
        if (found !== null) {
          ranges.push(found);
        }
      }
    }
    registry.set('rv-explained', new Highlight(...ranges));
    return () => {
      registry.delete('rv-explained');
    };
  }, [explained, file.key, text, layout, expanded, record]);

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
            <button type="button" data-ev="pair-layout-split" aria-pressed={layout === 'split'} onClick={() => onLayout('split')}>
              Side by side
            </button>
            <button type="button" data-ev="pair-layout-unified" aria-pressed={layout === 'unified'} onClick={() => onLayout('unified')}>
              Unified
            </button>
          </div>
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
          {fileJobs.map((job) => (
            <AgentReviewResult
              key={job.id}
              job={job}
              onStop={() => onStop(job)}
              onShow={(range) => setOwnTarget((before) => ({ location: { side: range.side, path: range.path, line: range.start }, nonce: (before?.nonce ?? 0) + 1 }))}
            />
          ))}
        </div>
      )}
      <div className="rv-pair-diff-row">
      <div className="rv-pair-diff-wrap" ref={wrap}>
      <div
        className="rv-pair-diff"
        ref={scroller}
        onScroll={() => {
          rememberRow();
          if (offer !== null && !offer.menu) {
            readOffer(false);
          }
        }}
        onMouseDown={(event) => {
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
        }}
        onMouseUp={(event) => {
          // A right button's release is followed by the context menu, which this would replace.
          if (event.button !== 0) {
            return;
          }
          dragging.current = false;
          // After the browser has settled the selection for this release.
          setTimeout(() => {
            readOffer(false);
            rememberRow();
          }, 0);
        }}
        onKeyUp={(event) => {
          if (event.shiftKey) {
            readOffer(false);
          }
        }}
        onContextMenu={(event) => {
          const keyboard = event.clientX === 0 && event.clientY === 0;
          if (readOffer(true, keyboard ? undefined : { x: event.clientX, y: event.clientY })) {
            event.preventDefault();
          }
        }}
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
              {split.map((row, index) =>
                row.kind === 'gap' && row.gap !== undefined ? (
                  gapRow(row.gap.id, row.gap.count, 8)
                ) : (
                  <tr key={index} className={row.kind === 'change' ? 'rv-pair-row-change' : 'rv-pair-row-context'}>
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
                      ].join(' ')}
                      data-code-side="target"
                      data-code-line={row.target ?? undefined}
                    >
                      {codeView('target', row.target, row.kind === 'change')}
                    </td>
                  </tr>
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
              {unified.map((row, index) => {
                if (row.kind === 'gap') {
                  return gapRow(row.id, row.count, 5);
                }
                const side: LineSide = row.kind === 'deleted' ? 'base' : 'target';
                const line = row.kind === 'deleted' ? row.base : row.target;
                const changedRow = row.kind !== 'context';
                return (
                  <Fragment key={index}>
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
                        ].join(' ')}
                        data-code-side={side}
                        data-code-line={line ?? undefined}
                        // An unchanged line is drawn once, at To; it is the same line of From.
                        data-code-also={row.kind === 'context' ? `base:${String(row.base)}` : undefined}
                      >
                        {codeView(side, line, changedRow)}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
        {offer !== null &&
          (offer.menu ? (
            <div className="rv-explain-menu" role="menu" data-ev="explain-menu" style={{ left: offer.x, top: offer.y }}>
              <button
                type="button"
                role="menuitem"
                ref={menuFirst}
                data-ev="explain-menu-explain"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => explainNow(offer.request)}
              >
                Explain this
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
            <button
              type="button"
              className="rv-explain-this"
              data-ev="explain-this"
              title="Explain the selected code (Ctrl+Shift+E). Marks nothing."
              style={{ left: offer.x, top: offer.y }}
              // Pressing it must not take the selection away.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => explainNow(offer.request)}
            >
              Explain this
            </button>
          ))}
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
