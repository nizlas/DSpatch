/**
 * DSP-185: the exact step-explanation prompts DSpatch sends for a step of the synthetic
 * work-queue case, built through the same code a session uses: the review service's envelope
 * for the step, the revision folder's section from the analysis host, the window's walk outline
 * builder, and `stepExplanationPrompt`. Nothing is sent to any provider.
 *
 * Used by `scripts/explain-prompt.mjs` (which writes them to files for an independent
 * qualitative check) and by `tests/explain-prompts.test.ts` (which checks their content and
 * structure only, never what a model would write).
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
import { isPairError } from '../../src/shared/review-pair';
import type { ExplanationAction } from '../../src/shared/step-explanations';
import { WORK_QUEUE_CASE, makeSyntheticRepo, workQueueWalk } from './synthetic-walks';

export interface BuiltPrompts {
  readonly stepId: string;
  readonly action: ExplanationAction;
  /** By profile prompt name: Essentials, Standard, Teacher. */
  readonly prompts: Readonly<Record<string, string>>;
  /** Where the two revisions were written as files, as the agent would read them; removed by `dispose`. */
  readonly revisionFolder: string;
  readonly dispose: () => void;
}

/** Build the prompts for `stepId` (default W1.2, `acquire`) in every public profile. */
export async function buildExplanationPrompts(options: { readonly stepId?: string; readonly action?: ExplanationAction; readonly language?: 'sv' | 'en' } = {}): Promise<BuiltPrompts> {
  const stepId = options.stepId ?? 'W1.2';
  const action = options.action ?? 'present';
  const language = options.language ?? 'en';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-explain-prompts-'));
  const dispose = (): void => fs.rmSync(root, { recursive: true, force: true });
  try {
    const { repo, base, target } = makeSyntheticRepo(path.join(root, 'workspace'), WORK_QUEUE_CASE);
    const definitionPath = path.join(root, 'workspace', 'work-queue.review.json');
    const definition = workQueueWalk(path.basename(repo), base, target);
    fs.writeFileSync(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);
    const records = path.join(root, 'records');

    // The step's envelope, as the window's review service builds it.
    const service = new ReviewService({ recordsDir: path.join(records, 'review'), log: () => undefined });
    const opened = await service.openDefinition(definitionPath);
    if (opened.kind !== 'opened') {
      throw new Error(`The synthetic walk did not open: ${opened.kind === 'failed' ? opened.error : opened.kind}`);
    }
    const walk = opened.bundle.definition.walks.find((entry) => entry.steps.some((step) => step.id === stepId));
    if (walk === undefined) {
      throw new Error(`The synthetic walk has no step ${stepId}.`);
    }
    const built = await service.envelopeFor({ subject: { kind: 'point', walkId: walk.id, stepId, placeIndex: 0 }, selection: null, language });
    if (built.kind !== 'built') {
      throw new Error(built.error);
    }

    // The revision folder and its prompt section, as the analysis host gives a session.
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
    const section = held.section;
    held.release();

    // The walk outline exactly as the window sends it.
    const outline = walkOutlineOf(opened.bundle.definition.walks, walk.id, stepId, language);
    const prompts: Record<string, string> = {};
    for (const profile of PUBLIC_PROFILES as readonly PublicProfile[]) {
      prompts[PROFILE_PROMPT_NAMES[profile]] = stepExplanationPrompt({ envelope: built.envelope, action, profile, chain: [], outline, folderSection: section });
    }
    return { stepId, action, prompts, revisionFolder, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
