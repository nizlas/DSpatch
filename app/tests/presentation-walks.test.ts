/**
 * DSP-181: a profile chosen before the walks are prepared. The walk generator writes every
 * step's explanation in it, the definition records it, and a walk opened in its own profile is
 * read with no further call. The profile changes how the steps are explained and nothing else:
 * the same walks, steps, titles, places and coverage come out whatever the profile. SIMULATED:
 * the presentation adapter's answers show the data flow, never a real model's writing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { simulatedReviewTask } from '../src/main/presentation-review-tasks';
import { GROUNDING_RULES, walkOutlineSection, PRESENTATION_INSTRUCTION_VERSION, PROFILES, PROFILE_PROMPT_NAMES, PUBLIC_PROFILES, WALK_DETAILS_RULE, walkExplanationSection, type PublicProfile } from '../src/shared/presentation-profiles';
import { answerJson, crowdedStepProblems, definitionFrom, readWalksAnswer, type ProposedWalks } from '../src/shared/review-agent';
import { parseReviewDefinition, stepContentHash } from '../src/shared/review-model';
import { jobFrom } from '../src/shared/review-pair';
import { TASK_HEADER } from '../src/shared/review-task';
import { historyOf, wantsExplanation } from '../src/shared/step-explanations';

const PAIR = { repository: 'sample-repo', base: 'a'.repeat(40), target: 'b'.repeat(40) };

describe('the walk generator\'s section (DSP-181)', () => {
  it('asks for the steps\' explanations in the profile and for nothing else to change', () => {
    for (const id of PUBLIC_PROFILES) {
      const section = walkExplanationSection(id);
      assert.match(section, new RegExp(`^## How to explain the steps \\(${PROFILE_PROMPT_NAMES[id]}\\)`));
      assert.match(section, /Write each step's "summary", "body", "why" and "details" for that reader/);
      assert.match(section, /which walks, readings, steps and places you produce, their titles, questions and purposes, and the change's own summary and background follow the sections above and stay concise, whatever the profile/);
      assert.match(section, new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
      for (const rule of GROUNDING_RULES) {
        assert.ok(section.includes(rule));
      }
      for (const rule of PROFILES[id].manner) {
        assert.ok(section.includes(rule));
      }
      assert.ok(section.includes(PROFILES[id].guideline));
      assert.ok(section.includes(WALK_DETAILS_RULE));
    }
  });
});

/** A proposal as the generator's answer reads, with a deepening on the first step. */
const proposal = {
  summary: 'The greeting takes the visitor\'s name.',
  background: '',
  walks: [
    {
      kind: 'walk',
      title: 'Greeting a visitor',
      question: 'What does greet do with the name?',
      purpose: 'How the greeting is built.',
      steps: [
        {
          title: 'Build the greeting',
          summary: 'greet builds the text from the name.',
          body: '`greet(name)` returns “Hello, <name>!”, and “Hello!” when the name is empty.',
          why: 'Every caller gets the same rule.',
          details: 'The empty check runs before the text is built; a name of spaces counts as empty.',
          places: [{ label: 'greet', path: 'src/greeting.ts', side: 'target', start: 10, end: 14 }],
        },
        {
          title: 'Call it from the request',
          summary: 'The request handler passes the name on.',
          body: 'The handler reads the name and calls `greet`.',
          places: [{ label: 'the call', path: 'src/request.ts', side: 'target', start: 40, end: 42 }],
        },
      ],
    },
  ],
};

describe('the definition records the profile (DSP-181)', () => {
  it('reads a step\'s details, writes the profile and the version, and parses them back; an older definition has none', () => {
    const read = readWalksAnswer(proposal);
    assert.ok(read.walks !== null);
    assert.equal(read.walks.walks[0]?.steps[0]?.details, 'The empty check runs before the text is built; a name of spaces counts as empty.');
    assert.equal(read.walks.walks[0]?.steps[1]?.details, '');
    const written = definitionFrom(read.walks, PAIR, 'Walks', 'Prepared in a test.', { profile: 'standard', version: PRESENTATION_INSTRUCTION_VERSION });
    const parsed = parseReviewDefinition(JSON.parse(JSON.stringify(written)) as unknown);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.definition?.presentation, { profile: 'standard', version: PRESENTATION_INSTRUCTION_VERSION });
    const [first, second] = parsed.definition?.walks[0]?.steps ?? [];
    assert.equal(first?.details?.en, 'The empty check runs before the text is built; a name of spaces counts as empty.');
    assert.equal(second?.details, undefined, 'a step without a deepening carries none');
    const legacy = parseReviewDefinition(JSON.parse(JSON.stringify(definitionFrom(read.walks, PAIR, 'Walks', 'Prepared in a test.'))) as unknown);
    assert.equal(legacy.definition?.presentation, undefined, 'a walk prepared without a profile is the legacy Original');
    const badProfile = parseReviewDefinition({ ...(written as Record<string, unknown>), presentation: { profile: 'other', version: 3 } });
    assert.equal(badProfile.definition?.presentation, undefined, 'an unknown profile is read as none, not as an error');
  });

  it('the step\'s content hash sees its details, so a changed deepening is a changed step', () => {
    const read = readWalksAnswer(proposal);
    assert.ok(read.walks !== null);
    const parsed = parseReviewDefinition(JSON.parse(JSON.stringify(definitionFrom(read.walks, PAIR, 'W', 'p'))) as unknown).definition;
    const step = parsed?.walks[0]?.steps[0];
    assert.ok(step !== undefined);
    assert.notEqual(stepContentHash(step), stepContentHash({ ...step, details: { sv: 'other', en: 'other' } }));
    assert.equal(stepContentHash(step), stepContentHash({ ...step }));
  });

  it('a job record keeps the profile its walks were prepared in', () => {
    const base = { id: 'job-1', kind: 'walks', state: 'done', provider: 'claude', model: 'm', startedAt: '2026-11-08T10:00:00.000Z', endedAt: null, note: '', detail: '', scope: null, result: null, definitionPath: null, uncovered: [] };
    assert.deepEqual(jobFrom({ ...base, presentation: { profile: 'pedagog', version: 3 } })?.presentation, { profile: 'pedagog', version: 3 });
    assert.equal(jobFrom(base)?.presentation, undefined);
    assert.equal(jobFrom({ ...base, presentation: { profile: 'other' } })?.presentation, undefined);
  });
});

/** The simulated provider asked to prepare walks over one changed file, in a profile or none. */
function prepared(profile: PublicProfile | null, folder: string): ProposedWalks {
  const prompt = [
    `${TASK_HEADER} prepare-walks`,
    '',
    'You prepare code walks and readings.',
    ...(profile === null ? [] : ['', walkExplanationSection(profile)]),
    '',
    '## Changed lines (machine-readable)',
    '```json',
    JSON.stringify([
      { path: 'src/greeting.ts', side: 'target', start: 10, end: 14 },
      { path: 'src/request.ts', side: 'target', start: 40, end: 42 },
    ]),
    '```',
    '',
  ].join('\n');
  const answered = simulatedReviewTask(prompt, folder);
  assert.ok(answered !== null);
  const read = readWalksAnswer(answerJson(answered.answer));
  assert.ok(read.walks !== null, read.problems.join('; '));
  return read.walks;
}

/** Everything of the walks but the steps' explanations: what the profile must leave alone. */
function structure(walks: ProposedWalks): unknown {
  return {
    overview: walks.overview,
    background: walks.background,
    walks: walks.walks.map((walk) => ({
      kind: walk.kind,
      title: walk.title,
      question: walk.question,
      purpose: walk.purpose,
      steps: walk.steps.map((step) => ({ title: step.title, summary: step.summary, places: step.places })),
    })),
  };
}

describe('the same walks whatever the profile (DSP-181, SIMULATED)', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-181-walks-'));
  fs.mkdirSync(path.join(folder, 'target', 'src'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'target', 'src', 'greeting.ts'), Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join('\n'));
  fs.writeFileSync(path.join(folder, 'target', 'src', 'request.ts'), Array.from({ length: 50 }, (_, index) => `line ${String(index + 1)}`).join('\n'));

  it('the walks, titles, purposes, steps, places and the change\'s own summary are the same; only the steps\' explanations differ', () => {
    const legacy = prepared(null, folder);
    const byProfile = new Map(PUBLIC_PROFILES.map((id) => [id, prepared(id, folder)] as const));
    for (const [id, walks] of byProfile) {
      assert.deepEqual(structure(walks), structure(legacy), `${id}: the structure`);
      const first = walks.walks[0]?.steps[0];
      assert.ok(first !== undefined);
      assert.match(first.body, new RegExp(`^SIMULATED ${PROFILE_PROMPT_NAMES[id]}`), `${id}: the explanation is in the profile`);
      assert.ok(first.details.startsWith(`SIMULATED deepening (${PROFILE_PROMPT_NAMES[id]})`), `${id}: the deepening is behind Show more`);
      assert.notEqual(first.body, legacy.walks[0]?.steps[0]?.body);
    }
    assert.equal(legacy.walks[0]?.steps[0]?.details, '', 'the legacy text has no deepening');
    assert.ok((byProfile.get('essens')?.walks[0]?.steps[0]?.body.length ?? 0) < (byProfile.get('standard')?.walks[0]?.steps[0]?.body.length ?? 0));
    assert.ok((byProfile.get('standard')?.walks[0]?.steps[0]?.body.length ?? 0) < (byProfile.get('pedagog')?.walks[0]?.steps[0]?.body.length ?? 0));
    assert.match(byProfile.get('pedagog')?.walks[0]?.steps[0]?.body ?? '', /First the idea[\s\S]*Now the code/);
  });

  it('coverage follows the places, which the profile leaves alone', () => {
    const legacy = prepared(null, folder);
    for (const id of PUBLIC_PROFILES) {
      const walks = prepared(id, folder);
      const places = (proposalWalks: ProposedWalks): string[] => proposalWalks.walks.flatMap((walk) => walk.steps.flatMap((step) => step.places.map((place) => `${place.range.side}:${place.range.path}:${String(place.range.start)}-${String(place.range.end)}`)));
      assert.deepEqual(places(walks), places(legacy));
    }
  });
});

describe('a walk is read in its own profile without a call (DSP-181)', () => {
  it('asks for an explanation only in another profile, and only when none is there or on its way (DSP-184: from the step explanations\' store)', () => {
    const nothing = historyOf([], { walkId: 'W1', stepId: 'W1.1', basis: 'h', profile: 'essens' });
    assert.equal(wantsExplanation('essens', 'essens', nothing), false, 'the walk\'s own profile');
    assert.equal(wantsExplanation('standard', 'essens', nothing), true, 'another profile with nothing yet');
    assert.equal(wantsExplanation(null, 'standard', nothing), true, 'an older walk (Original) has no profile of its own');
  });
});

describe('one place per step in the simulated walks (DSP-185, SIMULATED)', () => {
  it('a called definition is a step of its own after the call, and exactly one step compares two places, saying why', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-185-walks-'));
    try {
      fs.mkdirSync(path.join(folder, 'target', 'src'), { recursive: true });
      const app = ["import { lookup } from './table';", '', 'export function first() {', '  return lookup(1);', '}', ...Array.from({ length: 20 }, (_, index) => `// ${String(index)}`), 'export const second = 2;'];
      fs.writeFileSync(path.join(folder, 'target', 'src', 'app.ts'), app.join('\n'));
      fs.writeFileSync(path.join(folder, 'target', 'src', 'table.ts'), 'export function lookup(key) {\n  return null;\n}\n');
      const prompt = [
        `${TASK_HEADER} prepare-walks`,
        '',
        '## Changed lines (machine-readable)',
        '```json',
        JSON.stringify([
          { path: 'src/app.ts', side: 'target', start: 4, end: 4 },
          { path: 'src/app.ts', side: 'target', start: 26, end: 26 },
        ]),
        '```',
        '',
      ].join('\n');
      const answered = simulatedReviewTask(prompt, folder);
      assert.ok(answered !== null);
      const read = readWalksAnswer(answerJson(answered.answer));
      assert.ok(read.walks !== null, read.problems.join('; '));
      const steps = read.walks.walks.flatMap((walk) => walk.steps);
      assert.deepEqual(
        steps.map((step) => step.title),
        ['Changed lines 4–4', 'Where lookup is defined', 'Changed lines 26–26', 'The two changes side by side'],
      );
      // The definition follows the call, reached from it, and builds on the step before.
      assert.equal(steps[1]?.places.length, 1);
      assert.equal(steps[1]?.places[0]?.range.path, 'src/table.ts');
      assert.equal(steps[1]?.places[0]?.from?.range.start, 4);
      assert.match(steps[1]?.body ?? '', /in the previous step/);
      const together = steps.filter((step) => step.places.length > 1);
      assert.equal(together.length, 1);
      assert.match(together[0]?.together ?? '', /compare/);
      assert.deepEqual(steps.filter((step) => step.places.length === 1).length, steps.length - 1);
      assert.equal(crowdedStepProblems(read.walks).size, 0, 'nothing for the repair round');
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('simulated step explanations point at another step and at the diff (DSP-185, SIMULATED)', () => {
  it('one step reference from the outline\'s ids and one reference to lines no step shows', () => {
    const outline = walkOutlineSection({
      walkTitle: 'What changes in app.js',
      steps: [
        { id: 'W1.1', title: 'Removed lines 2–3', places: ['src/app.js 2–3 (From)'] },
        { id: 'W1.2', title: 'Changed lines 2–2', places: ['src/app.js 2 (To)'] },
        { id: 'W1.3', title: 'Changed lines 35–35', places: ['src/app.js 35 (To)'] },
      ],
      current: 1,
    });
    const prompt = [`${TASK_HEADER} review-question`, '', '## How to present (Essentials)', '', 'Step: Changed lines 2–2', '### focus · src/app.js lines 2 · target @ abc', '', outline, '', '## Question', 'Explain this step.', ''].join('\n');
    const answered = simulatedReviewTask(prompt, fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-185-refs-')));
    assert.ok(answered !== null);
    const block = /```dspatch-references\n([\s\S]*?)\n```/.exec(answered.answer)?.[1] ?? '{}';
    const references = (JSON.parse(block) as { references: Record<string, unknown>[] }).references;
    assert.deepEqual(references.find((entry) => entry['step'] !== undefined), { label: 'What the next step shows', step: 'W1.3' });
    assert.deepEqual(references.find((entry) => entry['label'] === 'The surrounding code, outside the walk'), { label: 'The surrounding code, outside the walk', path: 'src/app.js', side: 'target', start: 1, end: 1 });
  });
});
