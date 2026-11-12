import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ReviewService, reviewRecordKey, type ReviewServiceOptions } from '../main/review-service';
import type { EnvelopeOutcome } from '../shared/review-discussion';
import type {
  ReviewHostApi,
  ReviewHostError,
  ReviewHostErrorCode,
  ReviewHostIdentified,
  ReviewHostOpened,
  ReviewHostRecordReading,
  ReviewHostRepositoryKey,
  ReviewHostSaveAnswer,
  ReviewHostSearchAnswer,
  ReviewIdentity,
} from '../shared/review-host-contract';
import type { ReviewFileOutcome, ReviewOpenOutcome, ReviewPreferences, RevisionSide } from '../shared/review-model';

/*
 * The review host (DSP-111): repository access and durable review data behind
 * `ReviewHostApi`, for any client that speaks the contract.
 *
 * It owns what used to be spread over the review windows: one `ReviewService` per
 * session (so a session keeps today's per-window semantics, including the reviews it
 * opened earlier, whose late saves still go to their own records), the repository top
 * level, and the index of the last review per repository. It imports no Electron and
 * nothing of the renderer; `tests/review-host.test.ts` walks its imports to keep it so.
 *
 * **It never throws across the contract.** Every method answers, with its outcome or a
 * `host-error`. A fault inside is caught at the method and said as `internal`.
 *
 * **One window per review stays the client's rule.** The host does not refuse a
 * second session on a review another session has open: the client's window registry
 * prevents that today, and a host that more than one client can reach needs that
 * refusal here first (recorded as the next step in the roadmap, section 1.2).
 */

/** The file the last review per repository is kept in, beside the review records. */
const RECENT_FILE = 'recent.json';

export interface ReviewHostOptions {
  /** Where review records live: `userData/reviews` in the local app. */
  readonly recordsDir: string;
  readonly log: (message: string) => void;
  /** DSP-152: a step's answered code questions, for the discussion's context. */
  readonly stepAnalysis?: ReviewServiceOptions['stepAnalysis'];
}

interface RecentEntry {
  readonly repository: string;
  readonly definitionPath: string;
  readonly openedAt: string;
}

function hostError(code: ReviewHostErrorCode, message: string, detail?: string): ReviewHostError {
  return detail === undefined ? { kind: 'host-error', code, message } : { kind: 'host-error', code, message, detail };
}

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A repository's top level, or the folder itself when git cannot say. */
function topLevel(folder: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', folder, 'rev-parse', '--show-toplevel'],
      { windowsHide: true, encoding: 'utf8', timeout: 10_000 },
      (error, stdout) => {
        const found = stdout.trim();
        resolve(error === null && found !== '' ? path.resolve(found) : path.resolve(folder));
      },
    );
  });
}

function folderKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export class ReviewHost implements ReviewHostApi {
  private readonly options: ReviewHostOptions;

  private readonly sessions = new Map<string, ReviewService>();

  constructor(options: ReviewHostOptions) {
    this.options = options;
  }

  // --- Sessions ----------------------------------------------------------------------

  createSession(): Promise<{ readonly sessionId: string } | ReviewHostError> {
    return this.guard('createSession', () => {
      const sessionId = randomUUID();
      this.sessions.set(sessionId, new ReviewService(this.serviceOptions()));
      return Promise.resolve({ sessionId });
    });
  }

  closeSession(request: unknown): Promise<{ readonly closed: true } | ReviewHostError> {
    return this.guard('closeSession', () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return Promise.resolve(found);
      }
      this.sessions.delete(found.sessionId);
      return Promise.resolve({ closed: true as const });
    });
  }

  // --- Opening -----------------------------------------------------------------------

  identify(request: unknown): Promise<ReviewHostIdentified | ReviewHostError> {
    return this.guard('identify', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      const definitionPath = (request as { definitionPath?: unknown }).definitionPath;
      if (!nonEmptyString(definitionPath)) {
        return hostError('invalid-request', 'No review definition file was named.');
      }
      const unreadable = this.unreadableDefinition(definitionPath);
      if (unreadable !== null) {
        return unreadable;
      }
      return found.service.identify(definitionPath);
    });
  }

  open(request: unknown): Promise<ReviewHostOpened | ReviewHostError> {
    return this.guard('open', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      const { definitionPath, remember } = request as { definitionPath?: unknown; remember?: unknown };
      if (!nonEmptyString(definitionPath) || typeof remember !== 'boolean') {
        return hostError('invalid-request', 'Opening a review needs a definition file and whether to remember it.');
      }
      const unreadable = this.unreadableDefinition(definitionPath);
      if (unreadable !== null) {
        return unreadable;
      }
      const outcome = await found.service.openDefinition(definitionPath);
      const identity = identityOf(outcome);
      if (identity !== null && remember) {
        await this.rememberRecent(identity);
      }
      return { outcome, identity };
    });
  }

  lastReviewFor(request: unknown): Promise<{ readonly definitionPath: string | null } | ReviewHostError> {
    return this.guard('lastReviewFor', async () => {
      const folder = isRecord(request) ? request['folder'] : undefined;
      if (!nonEmptyString(folder)) {
        return hostError('invalid-request', 'No folder was named.');
      }
      const key = folderKey(await topLevel(folder));
      const entry = this.readRecent()[key];
      if (entry === undefined || typeof entry.definitionPath !== 'string' || !fs.existsSync(entry.definitionPath)) {
        return { definitionPath: null };
      }
      return { definitionPath: entry.definitionPath };
    });
  }

  repositoryKey(request: unknown): Promise<ReviewHostRepositoryKey | ReviewHostError> {
    return this.guard('repositoryKey', async () => {
      const folder = isRecord(request) ? request['folder'] : undefined;
      if (!nonEmptyString(folder)) {
        return hostError('invalid-request', 'No folder was named.');
      }
      const root = await topLevel(folder);
      return { root, key: folderKey(root) };
    });
  }

  // --- Reading at the identified commits ---------------------------------------------

  readFile(request: unknown): Promise<ReviewFileOutcome | ReviewHostError> {
    return this.guard('readFile', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      // The service checks the side and the path and answers `failed` in words.
      const { side, path: filePath } = request as { side?: unknown; path?: unknown };
      return found.service.readFile(side as RevisionSide, filePath as string);
    });
  }

  listFiles(request: unknown): Promise<{ readonly files: readonly string[] } | ReviewHostError> {
    return this.guard('listFiles', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      const side = (request as { side?: unknown }).side;
      try {
        return { files: await found.service.listFiles(side as RevisionSide) };
      } catch (error) {
        return hostError('git-failed', 'The files at this revision could not be listed.', textOf(error));
      }
    });
  }

  search(request: unknown): Promise<ReviewHostSearchAnswer | ReviewHostError> {
    return this.guard('search', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      const { side, query } = request as { side?: unknown; query?: unknown };
      return found.service.search(side as RevisionSide, query as string);
    });
  }

  // --- Saving ------------------------------------------------------------------------

  saveState(request: unknown): Promise<ReviewHostSaveAnswer | ReviewHostError> {
    return this.guard('saveState', () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return Promise.resolve(found);
      }
      const result = found.service.saveState((request as { state?: unknown }).state);
      if (result.writeFailed === true) {
        // The window already says the work is kept and saved again with the next change;
        // the technical cause goes to the log, not into the window.
        this.options.log(`review host: saving a review record failed: ${result.error ?? 'unknown cause'}`);
        return Promise.resolve(
          hostError('save-failed', 'Your review could not be saved: the record file could not be written.', result.error),
        );
      }
      return Promise.resolve(result.error === undefined ? { saved: result.saved, at: result.at } : { saved: result.saved, at: result.at, error: result.error });
    });
  }

  getPreferences(): Promise<ReviewPreferences | ReviewHostError> {
    return this.guard('getPreferences', () => Promise.resolve(this.preferenceService().getPreferences()));
  }

  setPreferences(request: unknown): Promise<{ readonly saved: boolean; readonly error?: string } | ReviewHostError> {
    return this.guard('setPreferences', () => {
      if (!isRecord(request) || !('preferences' in request)) {
        return Promise.resolve(hostError('invalid-request', 'No preferences were sent.'));
      }
      const result = this.preferenceService().setPreferences(request['preferences']);
      if (result.writeFailed === true) {
        this.options.log(`review host: saving review preferences failed: ${result.error ?? 'unknown cause'}`);
        return Promise.resolve(
          hostError('save-failed', 'Your preference could not be saved: the preferences file could not be written.', result.error),
        );
      }
      if (!result.saved) {
        // DSP-200: the window says only that its view preferences were not saved; which fields, here.
        this.options.log(`review host: review preferences not saved: ${result.error ?? 'unknown cause'}`);
      }
      return Promise.resolve(result.error === undefined ? { saved: result.saved } : { saved: result.saved, error: result.error });
    });
  }

  // --- The review discussion's context -------------------------------------------------

  envelopeFor(request: unknown): Promise<EnvelopeOutcome | ReviewHostError> {
    return this.guard('envelopeFor', async () => {
      const found = this.sessionOf(request);
      if ('kind' in found) {
        return found;
      }
      return found.service.envelopeFor((request as { request?: unknown }).request);
    });
  }

  // --- Scenario readings ---------------------------------------------------------------

  recordReading(request: unknown): Promise<ReviewHostRecordReading | ReviewHostError> {
    return this.guard('recordReading', () => {
      const key = isRecord(request) ? request['key'] : undefined;
      if (typeof key !== 'string' || !/^[0-9a-f]{24}$/.test(key)) {
        return Promise.resolve(hostError('invalid-request', 'A review record key is 24 hexadecimal characters.'));
      }
      const recordPath = path.join(this.options.recordsDir, `${key}.json`);
      let recordPosition: unknown = null;
      if (fs.existsSync(recordPath)) {
        try {
          recordPosition = (JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { position?: unknown }).position ?? null;
        } catch (error) {
          recordPosition = `unreadable: ${String(error)}`;
        }
      }
      return Promise.resolve({ recordPath, recordPosition });
    });
  }

  recentIndex(): Promise<{ readonly index: unknown } | ReviewHostError> {
    return this.guard('recentIndex', () => {
      try {
        return Promise.resolve({ index: JSON.parse(fs.readFileSync(this.recentPath(), 'utf8')) as unknown });
      } catch {
        return Promise.resolve({ index: null });
      }
    });
  }

  // --- Inside --------------------------------------------------------------------------

  /** Run one method; a fault inside becomes an `internal` answer, never a throw. */
  private async guard<T>(method: string, run: () => Promise<T | ReviewHostError>): Promise<T | ReviewHostError> {
    try {
      return await run();
    } catch (error) {
      this.options.log(`review host: ${method} failed inside the host: ${textOf(error)}`);
      return hostError('internal', `The review host could not answer (${method}).`, textOf(error));
    }
  }

  private serviceOptions(): ReviewServiceOptions {
    return {
      recordsDir: this.options.recordsDir,
      log: this.options.log,
      ...(this.options.stepAnalysis === undefined ? {} : { stepAnalysis: this.options.stepAnalysis }),
    };
  }

  private sessionOf(request: unknown): { readonly sessionId: string; readonly service: ReviewService } | ReviewHostError {
    const sessionId = isRecord(request) ? request['sessionId'] : undefined;
    if (typeof sessionId !== 'string') {
      return hostError('invalid-request', 'The request names no review session.');
    }
    const service = this.sessions.get(sessionId);
    if (service === undefined) {
      return hostError('unknown-session', 'This review session is not open on the host (it was closed or never created).');
    }
    return { sessionId, service };
  }

  /** Preferences are kept beside the records, not per session. */
  private preferenceService(): ReviewService {
    return new ReviewService(this.serviceOptions());
  }

  /** `definition-unreadable` when the file cannot be read at all; `null` when it can. */
  private unreadableDefinition(definitionPath: string): ReviewHostError | null {
    const absolute = path.resolve(definitionPath);
    try {
      fs.accessSync(absolute, fs.constants.R_OK);
      if (!fs.statSync(absolute).isFile()) {
        return hostError('definition-unreadable', `The review definition ${absolute} is not a file.`);
      }
      return null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const why = code === 'ENOENT' ? 'there is no such file' : code === 'EACCES' || code === 'EPERM' ? 'it may not be read' : 'it cannot be read';
      return hostError('definition-unreadable', `The review definition ${absolute} could not be read: ${why}.`, textOf(error));
    }
  }

  private recentPath(): string {
    return path.join(this.options.recordsDir, RECENT_FILE);
  }

  private readRecent(): Record<string, RecentEntry> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.recentPath(), 'utf8')) as { version?: unknown; repositories?: unknown };
      if (parsed.version === 1 && typeof parsed.repositories === 'object' && parsed.repositories !== null) {
        return parsed.repositories as Record<string, RecentEntry>;
      }
    } catch {
      // Missing or unreadable: no last review is known, and the chooser opens instead.
    }
    return {};
  }

  /**
   * DSP-186: a deleted review's walks are no longer the last review of their repository. Only
   * entries naming one of `definitions` go; the others stay as they are.
   */
  forgetDefinitions(definitions: readonly string[]): void {
    if (definitions.length === 0) {
      return;
    }
    const gone = new Set(definitions.map((definition) => folderKey(path.resolve(definition))));
    const repositories = { ...this.readRecent() };
    const kept = Object.fromEntries(
      Object.entries(repositories).filter(([, entry]) => typeof entry.definitionPath !== 'string' || !gone.has(folderKey(path.resolve(entry.definitionPath)))),
    );
    if (Object.keys(kept).length === Object.keys(repositories).length) {
      return;
    }
    try {
      const temporary = `${this.recentPath()}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, repositories: kept }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.recentPath());
    } catch (error) {
      this.options.log(`the recent reviews could not be updated after a deletion: ${String(error)}`);
    }
  }

  /** Remember the definition just opened as the last one for its repository. */
  private async rememberRecent(identity: ReviewIdentity): Promise<void> {
    const root = await topLevel(identity.repository);
    try {
      const repositories = { ...this.readRecent() };
      repositories[folderKey(root)] = {
        repository: root,
        definitionPath: identity.definitionPath,
        openedAt: new Date().toISOString(),
      };
      fs.mkdirSync(this.options.recordsDir, { recursive: true });
      const temporary = `${this.recentPath()}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, repositories }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.recentPath());
    } catch (error) {
      // Opening the review is not undone by this; next time the chooser opens instead.
      this.options.log(`the last review for ${root} could not be remembered: ${String(error)}`);
    }
  }
}

function identityOf(outcome: ReviewOpenOutcome): ReviewIdentity | null {
  if (outcome.kind !== 'opened') {
    return null;
  }
  const bundle = outcome.bundle;
  return {
    key: reviewRecordKey(bundle.repository, bundle.base.sha, bundle.target.sha, bundle.definitionPath),
    definitionPath: bundle.definitionPath,
    repository: bundle.repository,
    base: bundle.base.sha,
    target: bundle.target.sha,
  };
}
