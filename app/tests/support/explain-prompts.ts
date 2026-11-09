/**
 * DSP-185, DSP-188: the exact prompts DSpatch sends for a synthetic case, built through the same
 * code a session uses, so they can be given to a model outside DSpatch for an independent
 * qualitative check and checked for their structure in tests. Nothing is sent to any provider.
 *
 * - {@link buildExplanationPrompts}: a step's explanation in every public profile (the review
 *   service's envelope for the step, the revision folder's section from the analysis host, the
 *   window's walk outline builder and `stepExplanationPrompt`).
 * - {@link buildSelectionPrompt}: Explain this on a line range of the same code, as the diff's
 *   *Explain this* sends it (`selectionPrompt`), for a comparison under like conditions
 *   (docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md, section 5).
 * - {@link buildWalksPrompt}: the walk generation prompt over the case, in a profile.
 *
 * Used by `scripts/explain-prompt.mjs` and by `tests/explain-prompts.test.ts`, which checks
 * content and structure only, never what a model would write.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ReviewAgentJobs } from '../../src/host/review-agent-jobs';
import { ReviewPairs } from '../../src/host/review-pairs';
import { RevisionSnapshots } from '../../src/host/revision-snapshots';
import { ReviewService } from '../../src/main/review-service';
import { stepExplanationPrompt } from '../../src/main/step-explanation-channel';
import { PUBLIC_PROFILES, PROFILE_PROMPT_NAMES, walkOutlineOf, type PublicProfile } from '../../src/shared/presentation-profiles';
import { linesAround, selectionPrompt, walksPrompt } from '../../src/shared/review-agent';
import { isPairError, type AgentMaterial, type CodeSelection, type LineSide, type SelectedCodeKind } from '../../src/shared/review-pair';
import type { ExplanationAction } from '../../src/shared/step-explanations';
import { CONNECT_CASE, WORK_QUEUE_CASE, connectWalk, makeSyntheticRepo, workQueueWalk, type SyntheticCase } from './synthetic-walks';

export type CaseName = 'work-queue' | 'connect';

const CASES: Record<CaseName, { readonly which: SyntheticCase; readonly walk: (repository: string, base: string, target: string) => Record<string, unknown> }> = {
  'work-queue': { which: WORK_QUEUE_CASE, walk: workQueueWalk },
  connect: { which: CONNECT_CASE, walk: connectWalk },
};

export interface BuiltPrompts {
  readonly stepId: string;
  readonly action: ExplanationAction;
  /** By profile prompt name: Essentials, Standard, Teacher. */
  readonly prompts: Readonly<Record<string, string>>;
  /** Where the two revisions were written as files, as the agent would read them; removed by `dispose`. */
  readonly revisionFolder: string;
  readonly dispose: () => void;
}

interface OpenedCase {
  readonly repo: string;
  readonly base: string;
  readonly target: string;
  readonly definition: Record<string, unknown>;
  readonly definitionPath: string;
  readonly service: ReviewService;
  readonly pairs: ReviewPairs;
  readonly jobs: ReviewAgentJobs;
  readonly pairKey: string;
  readonly pair: { readonly repository: string; readonly base: string; readonly target: string };
  readonly revisionFolder: string;
  readonly folderSection: string;
  readonly release: () => void;
}

/** The case as a repository with two commits, opened as the window and the analysis host open it. */
async function openCase(caseName: CaseName, root: string, language: 'sv' | 'en'): Promise<OpenedCase> {
  const chosen = CASES[caseName];
  const { repo, base, target } = makeSyntheticRepo(path.join(root, 'workspace'), chosen.which);
  const definitionPath = path.join(root, 'workspace', `${chosen.which.name}.review.json`);
  const definition = chosen.walk(path.basename(repo), base, target);
  fs.writeFileSync(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);
  const records = path.join(root, 'records');
  const service = new ReviewService({ recordsDir: path.join(records, 'review'), log: () => undefined });
  const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
  await pairs.repositories([path.join(root, 'workspace')]);
  const pair = await pairs.openPair({ repository: repo, base, target });
  if (isPairError(pair)) {
    throw new Error(pair.error);
  }
  const jobs = new ReviewAgentJobs({
    recordsDir: records,
    createAdapter: () => {
      throw new Error('No provider is used to build prompts.');
    },
    snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions'), log: () => undefined }),
    availability: () => ({ choosable: false, reason: 'prompts only' }),
    pairs,
    language: () => Promise.resolve(language),
    log: () => undefined,
  });
  const held = await jobs.holdForDiscussion(pair.key, pair.pair, 'explain-prompts');
  const revisionFolder = path.join(root, 'revisions-copy');
  fs.cpSync(held.folder, revisionFolder, { recursive: true });
  return { repo, base, target, definition, definitionPath, service, pairs, jobs, pairKey: pair.key, pair: pair.pair, revisionFolder, folderSection: held.section, release: held.release };
}

/** Build the prompts for `stepId` (default W1.2) of a case in every public profile. */
export async function buildExplanationPrompts(options: { readonly caseName?: CaseName; readonly stepId?: string; readonly action?: ExplanationAction; readonly language?: 'sv' | 'en' } = {}): Promise<BuiltPrompts> {
  const caseName = options.caseName ?? 'work-queue';
  const stepId = options.stepId ?? 'W1.2';
  const action = options.action ?? 'present';
  const language = options.language ?? 'en';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-explain-prompts-'));
  const dispose = (): void => fs.rmSync(root, { recursive: true, force: true });
  try {
    const opened = await openCase(caseName, root, language);
    opened.release();
    // The step's envelope, as the window's review service builds it.
    const open = await opened.service.openDefinition(opened.definitionPath);
    if (open.kind !== 'opened') {
      throw new Error(`The synthetic walk did not open: ${open.kind === 'failed' ? open.error : open.kind}`);
    }
    const walk = open.bundle.definition.walks.find((entry) => entry.steps.some((step) => step.id === stepId));
    if (walk === undefined) {
      throw new Error(`The synthetic walk has no step ${stepId}.`);
    }
    const built = await opened.service.envelopeFor({ subject: { kind: 'point', walkId: walk.id, stepId, placeIndex: 0 }, selection: null, language });
    if (built.kind !== 'built') {
      throw new Error(built.error);
    }
    // The walk outline exactly as the window sends it.
    const outline = walkOutlineOf(open.bundle.definition.walks, walk.id, stepId, language);
    const prompts: Record<string, string> = {};
    for (const profile of PUBLIC_PROFILES as readonly PublicProfile[]) {
      prompts[PROFILE_PROMPT_NAMES[profile]] = stepExplanationPrompt({ envelope: built.envelope, action, profile, chain: [], outline, folderSection: opened.folderSection });
    }
    return { stepId, action, prompts, revisionFolder: opened.revisionFolder, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export interface BuiltSelectionPrompt {
  readonly prompt: string;
  readonly revisionFolder: string;
  readonly dispose: () => void;
}

/** What the folder holds, as the prompt's folder section needs it: the two commits, nothing skipped. */
function agentMaterialOf(pair: { readonly base: string; readonly target: string }, folder: string): AgentMaterial {
  const count = (dir: string): number => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile()).length : 0);
  return { base: pair.base, target: pair.target, files: count(path.join(folder, 'base')) + count(path.join(folder, 'target')), skipped: [], skippedCount: 0 };
}

/**
 * Explain this on whole lines `start`–`end` of `filePath` at a side of a case, exactly as the
 * diff window's first *Explain this* sends it: the selected text and the lines around it from
 * the commit, the change section and the revision folder.
 */
export async function buildSelectionPrompt(options: { readonly caseName?: CaseName; readonly path: string; readonly side?: LineSide; readonly start: number; readonly end: number; readonly kind?: SelectedCodeKind; readonly language?: 'sv' | 'en' }): Promise<BuiltSelectionPrompt> {
  const caseName = options.caseName ?? 'work-queue';
  const side = options.side ?? 'target';
  const language = options.language ?? 'en';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-selection-prompt-'));
  const dispose = (): void => fs.rmSync(root, { recursive: true, force: true });
  try {
    const opened = await openCase(caseName, root, language);
    const lines = await opened.pairs.linesAt(opened.pairKey, side, options.path);
    if (lines === null) {
      throw new Error(`${options.path} is not at ${side}.`);
    }
    const material = await opened.pairs.material(opened.pairKey);
    if (isPairError(material)) {
      throw new Error(material.error);
    }
    const selected = lines.slice(options.start - 1, options.end);
    const segment = { side, path: options.path, start: options.start, end: options.end, from: 0, to: (selected.at(-1) ?? '').length, kind: options.kind ?? 'added', text: selected.join('\n') };
    const selection: CodeSelection = { fileKey: options.path, layout: 'split', segments: [segment] };
    const prompt = selectionPrompt(material, agentMaterialOf(opened.pair, opened.revisionFolder), selection, [linesAround(segment, lines)], [], null, language);
    opened.release();
    return { prompt, revisionFolder: opened.revisionFolder, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** The walk generation prompt over a case, in a profile (or none), as *Prepare code walks* sends it. */
export async function buildWalksPrompt(options: { readonly caseName?: CaseName; readonly profile?: PublicProfile | null; readonly language?: 'sv' | 'en' } = {}): Promise<BuiltSelectionPrompt> {
  const caseName = options.caseName ?? 'work-queue';
  const language = options.language ?? 'en';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walks-prompt-'));
  const dispose = (): void => fs.rmSync(root, { recursive: true, force: true });
  try {
    const opened = await openCase(caseName, root, language);
    const material = await opened.pairs.material(opened.pairKey);
    if (isPairError(material)) {
      throw new Error(material.error);
    }
    const prompt = walksPrompt(material, agentMaterialOf(opened.pair, opened.revisionFolder), language, options.profile ?? null);
    opened.release();
    return { prompt, revisionFolder: opened.revisionFolder, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
