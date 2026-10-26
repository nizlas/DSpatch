import type { EnvelopeOutcome } from './review-discussion';
import type { ReviewFileOutcome, ReviewOpenOutcome, ReviewPreferences, ReviewSearchHit, RevisionSide } from './review-model';

/*
 * The review host's contract (DSP-111): what a review client may ask of the host that
 * holds the repository and the durable review data, and what it gets back.
 *
 * The host opens and validates review definitions, reads the two identified commits
 * (code, file lists, search, the diff inside the opened bundle), and reads and saves
 * the reviewer's record and preferences. The client renders and interacts: windows,
 * dialogs, menus and the one-window-per-review registry are the client's.
 *
 * **Plain data only.** Every request and every answer is serialisable data: no class
 * instances, functions, Buffers or shared references. The local binding passes both
 * through `structuredClone`, so a later transport can carry them as JSON unchanged.
 *
 * **Errors are answers.** No method throws across the contract. A method answers with
 * its ordinary outcome (which already carries plain errors such as a failed open or a
 * refused save), or with a `ReviewHostError` when the request could not be served at
 * all. The `message` is for a person; the `detail` holds technical text (git's or the
 * file system's own words) for a closed Details.
 *
 * This is a local module boundary today, not remote operation: there is no separate
 * host process, no network transport, no authentication and no reconnection yet.
 * Definition paths are still paths on the machine the window runs on, because the
 * native file chooser is the client's (a later step browses the host instead).
 */

export type ReviewHostErrorCode =
  /** The session was never created here, or has been closed. */
  | 'unknown-session'
  /** A request field is missing or of the wrong kind. */
  | 'invalid-request'
  /** The review definition file could not be read at all. */
  | 'definition-unreadable'
  /** git could not answer a reading that has no outcome of its own for it. */
  | 'git-failed'
  /** A record or the preferences could not be written. The client keeps its unsaved work. */
  | 'save-failed'
  /** Anything else: a fault in the host, said as such. */
  | 'internal';

export interface ReviewHostError {
  readonly kind: 'host-error';
  readonly code: ReviewHostErrorCode;
  readonly message: string;
  readonly detail?: string;
}

export function isReviewHostError(value: unknown): value is ReviewHostError {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'host-error';
}

/**
 * The identity of one review: the repository, the two resolved commits and the
 * definition file. It is also the name of the reviewer's record, so two windows with
 * the same identity would be two writers of one file; the client's window registry
 * keeps that from happening.
 */
export interface ReviewIdentity {
  readonly key: string;
  readonly definitionPath: string;
  readonly repository: string;
  readonly base: string;
  readonly target: string;
}

/** One host session per review window: its open review and every review it has opened. */
export interface ReviewHostSessionRequest {
  readonly sessionId: string;
}

export interface ReviewHostOpenRequest extends ReviewHostSessionRequest {
  readonly definitionPath: string;
  /** Remember this definition as the last review for its repository when it opens. */
  readonly remember: boolean;
}

/** What opening answers: the review outcome, and the identity when it opened. */
export interface ReviewHostOpened {
  readonly outcome: ReviewOpenOutcome;
  readonly identity: ReviewIdentity | null;
}

export type ReviewHostIdentified = { readonly identity: ReviewIdentity } | { readonly error: string };

export interface ReviewHostFolderRequest {
  /** A folder inside a repository. */
  readonly folder: string;
}

export interface ReviewHostRepositoryKey {
  /** The repository's top level, or the folder itself when git cannot say. */
  readonly root: string;
  /** The top level as a comparable key (case-folded on Windows). */
  readonly key: string;
}

export interface ReviewHostSearchAnswer {
  readonly hits: readonly ReviewSearchHit[];
  readonly truncated: boolean;
  readonly error?: string;
}

export interface ReviewHostSaveAnswer {
  readonly saved: boolean;
  readonly at: string;
  readonly error?: string;
}

/** What the scripted scenarios read of one review record on the host. */
export interface ReviewHostRecordReading {
  readonly recordPath: string;
  /** The record's saved position; `null` when there is no record. */
  readonly recordPosition: unknown;
}

export type HostAnswer<T> = Promise<T | ReviewHostError>;

export interface ReviewHostApi {
  // --- Sessions ----------------------------------------------------------------------
  createSession(): HostAnswer<{ readonly sessionId: string }>;
  /** After this the session answers `unknown-session`. */
  closeSession(request: ReviewHostSessionRequest): HostAnswer<{ readonly closed: true }>;

  // --- Opening -----------------------------------------------------------------------
  /** Which review a definition names, without opening it. */
  identify(request: ReviewHostSessionRequest & { readonly definitionPath: string }): HostAnswer<ReviewHostIdentified>;
  /** Read, resolve, diff and validate a definition, and adopt the reviewer's record. */
  open(request: ReviewHostOpenRequest): HostAnswer<ReviewHostOpened>;
  /** The last definition opened for the repository this folder is in, if it still exists. */
  lastReviewFor(request: ReviewHostFolderRequest): HostAnswer<{ readonly definitionPath: string | null }>;
  repositoryKey(request: ReviewHostFolderRequest): HostAnswer<ReviewHostRepositoryKey>;

  // --- Reading at the identified commits ---------------------------------------------
  readFile(request: ReviewHostSessionRequest & { readonly side: RevisionSide; readonly path: string }): HostAnswer<ReviewFileOutcome>;
  listFiles(request: ReviewHostSessionRequest & { readonly side: RevisionSide }): HostAnswer<{ readonly files: readonly string[] }>;
  search(request: ReviewHostSessionRequest & { readonly side: RevisionSide; readonly query: string }): HostAnswer<ReviewHostSearchAnswer>;

  // --- Saving ------------------------------------------------------------------------
  saveState(request: ReviewHostSessionRequest & { readonly state: unknown }): HostAnswer<ReviewHostSaveAnswer>;
  getPreferences(): HostAnswer<ReviewPreferences>;
  setPreferences(request: { readonly preferences: unknown }): HostAnswer<{ readonly saved: boolean; readonly error?: string }>;

  // --- The review discussion's context -------------------------------------------------
  /** Built on the host from the commits and the saved record, never from text the window sends. */
  envelopeFor(request: ReviewHostSessionRequest & { readonly request: unknown }): HostAnswer<EnvelopeOutcome>;

  // --- Scenario readings ---------------------------------------------------------------
  recordReading(request: { readonly key: string }): HostAnswer<ReviewHostRecordReading>;
  /** The recent-review index as it stands, or `null` when there is none. */
  recentIndex(): HostAnswer<{ readonly index: unknown }>;
}

/** Every method of the contract, for bindings that wrap each one alike. */
export const REVIEW_HOST_METHODS = [
  'createSession',
  'closeSession',
  'identify',
  'open',
  'lastReviewFor',
  'repositoryKey',
  'readFile',
  'listFiles',
  'search',
  'saveState',
  'getPreferences',
  'setPreferences',
  'envelopeFor',
  'recordReading',
  'recentIndex',
] as const satisfies readonly (keyof ReviewHostApi)[];
