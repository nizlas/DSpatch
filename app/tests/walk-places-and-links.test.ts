/**
 * DSP-185: one code place per walk step, and references that lead to the walk step or to the
 * right lines in the diff (Niclas's decision of 9 November 2026).
 *
 * What these establish is DSpatch's own handling: what the walk prompt and the repair round
 * ask for, which steps the structural check sends back, that a reason for showing places
 * together is kept and old walks read as before, and where a reference leads. They say nothing
 * about what a real model writes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STEP_REFERENCE_RULE, outlineFrom, walkOutlineOf, walkOutlineSection } from '../src/shared/presentation-profiles';
import { changedPathsOf, resolveLineReference, resolveStepReference, type ReferenceScope } from '../src/shared/reference-links';
import { PATH_RULES, PLACE_RULES, crowdedStepProblems, repeatedStepProblems, definitionFrom, distinctPlaceCount, readStepAnswer, readWalksAnswer, repairPrompt, walksPrompt } from '../src/shared/review-agent';
import { stepReferencesFrom } from '../src/shared/review-discussion';
import { parseReviewDefinition, stepContentHash, type ReviewDefinition } from '../src/shared/review-model';

const PAIR = { repository: 'r', base: 'a'.repeat(40), target: 'b'.repeat(40) };
const place = (path: string, side: 'base' | 'target', start: number, end: number): Record<string, unknown> => ({ label: `${path} ${String(start)}`, path, side, start, end });

function definitionOf(answer: unknown): ReviewDefinition {
  const read = readWalksAnswer(answer);
  assert.ok(read.walks !== null, read.problems.join('; '));
  const parsed = parseReviewDefinition(JSON.parse(JSON.stringify(definitionFrom(read.walks, PAIR, 'Walks', 'Prepared in a test.'))) as unknown);
  assert.deepEqual(parsed.problems, []);
  assert.ok(parsed.definition !== null);
  return parsed.definition;
}

describe('one place per step: what the agent is asked (DSP-185)', () => {
  const material = { pair: PAIR, repositoryName: 'r', baseSubject: 'b', targetSubject: 't', files: [], diff: '', diffLeftOut: [] };
  const folder = { base: PAIR.base, target: PAIR.target, files: 0, skipped: [], skippedCount: 0 };

  it('the walk prompt asks for one place per step, the order carrying the reasoning, and a reason for any exception', () => {
    const prompt = walksPrompt(material as never, folder, 'en');
    assert.match(prompt, /## One place per step/);
    for (const rule of PLACE_RULES) {
      assert.ok(prompt.includes(rule));
    }
    assert.match(prompt, /declaring an option, passing it on and using it are three steps/);
    assert.match(prompt, /From and To, are one place/);
    assert.match(prompt, /"together": "Only for a step with several places/);
    // A profile changes how steps are explained, never their structure: its section says so.
    assert.match(walksPrompt(material as never, folder, 'en', 'essens'), /This section decides how the steps are explained, nothing else: which walks, readings, steps and places you produce/);
  });

  it('the repair round asks to split a crowded step, and only when one was found', () => {
    const answer = { summary: 's', walks: [{ title: 'w', steps: [{ title: 'Option', body: 'b', places: [place('a.ts', 'target', 1, 2), place('b.ts', 'target', 5, 6)] }] }] };
    const read = readWalksAnswer(answer);
    assert.ok(read.walks !== null);
    const problems = [...crowdedStepProblems(read.walks).values()];
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /walk 1, step 1 \("Option"\) shows several places/);
    assert.match(repairPrompt(problems), /one step per place, each with its own explanation/);
    assert.match(repairPrompt(problems), /"together"/);
    assert.doesNotMatch(repairPrompt(['walk 1, step 1, place 1: the lines do not exist.']), /one step per place/);
  });
});

describe('the structural check (DSP-185)', () => {
  it('counts From and To of one file as one place, and leaves context places out', () => {
    assert.equal(distinctPlaceCount([{ range: { kind: 'lines', path: 'a.ts', side: 'base', start: 2, end: 3 } }, { range: { kind: 'lines', path: 'a.ts', side: 'target', start: 2, end: 2 } }] as never), 1);
    assert.equal(distinctPlaceCount([{ range: { kind: 'lines', path: 'a.ts', side: 'target', start: 2, end: 3 } }, { range: { kind: 'lines', path: 'a.ts', side: 'target', start: 20, end: 22 } }] as never), 2);
    const read = readWalksAnswer({
      summary: 's',
      walks: [
        {
          title: 'w',
          steps: [
            { title: 'One change, both sides', body: 'b', places: [place('a.ts', 'base', 2, 3), place('a.ts', 'target', 2, 2)] },
            { title: 'With context', body: 'b', places: [place('a.ts', 'target', 9, 9), { label: 'lib', repository: 'lib', path: 'x.js', start: 1, end: 2 }] },
            { title: 'Compared', body: 'b', together: 'Side by side they show the same guard twice.', places: [place('a.ts', 'target', 20, 21), place('b.ts', 'target', 4, 5)] },
            { title: 'Crowded', body: 'b', places: [place('a.ts', 'target', 30, 31), place('b.ts', 'target', 8, 9)] },
          ],
        },
      ],
    });
    assert.ok(read.walks !== null);
    assert.deepEqual([...crowdedStepProblems(read.walks).keys()], ['0.3']);
  });
});

describe('the reason for showing places together (DSP-185)', () => {
  it('is kept on the step, written to the definition and read back', () => {
    const definition = definitionOf({
      summary: 's',
      walks: [
        {
          title: 'w',
          steps: [
            { title: 'Compared', body: 'b', together: 'Side by side they show the same guard twice.', places: [place('a.ts', 'target', 20, 21), place('b.ts', 'target', 4, 5)] },
            { title: 'Alone', body: 'b', places: [place('a.ts', 'target', 1, 1)] },
          ],
        },
      ],
    });
    const [compared, alone] = definition.walks[0]?.steps ?? [];
    assert.deepEqual(compared?.together, { sv: 'Side by side they show the same guard twice.', en: 'Side by side they show the same guard twice.' });
    assert.equal(alone?.together, undefined);
  });

  it('an older walk without it opens unchanged, its step hash too', () => {
    const older = {
      format: 'dspatch-review/2',
      title: { sv: 'W', en: 'W' },
      repository: 'r',
      base: PAIR.base,
      target: PAIR.target,
      teachingMode: 'Generated',
      walks: [
        {
          id: 'W1',
          kind: 'walk',
          title: { sv: 'w', en: 'w' },
          purpose: { sv: '', en: '' },
          question: { sv: 'q', en: 'q' },
          steps: [
            {
              id: 'W1.1',
              title: { sv: 't', en: 't' },
              summary: { sv: 's', en: 's' },
              body: { sv: 'b', en: 'b' },
              places: [
                { id: 'P1', label: { sv: 'a', en: 'a' }, focus: { path: 'a.ts', side: 'target', start: 1, end: 2, role: 'walk' } },
                { id: 'P2', label: { sv: 'b', en: 'b' }, focus: { path: 'b.ts', side: 'target', start: 3, end: 4, role: 'walk' } },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseReviewDefinition(older);
    assert.deepEqual(parsed.problems, []);
    const step = parsed.definition?.walks[0]?.steps[0];
    assert.ok(step !== undefined);
    assert.equal(step.together, undefined);
    assert.equal(step.places.length, 2, 'a saved step with several places keeps them all');
    // The hash a saved step had before DSP-185: carrying marks over depends on it being the same.
    assert.equal(stepContentHash(step), 'e9756136f65d5c04');
    const withReason = parseReviewDefinition({ ...older, walks: [{ ...older.walks[0], steps: [{ ...older.walks[0]?.steps[0], together: { sv: 'r', en: 'r' } }] }] });
    assert.notEqual(stepContentHash(withReason.definition?.walks[0]?.steps[0] as never), stepContentHash(step));
  });
});

describe('where a reference leads (DSP-185)', () => {
  const definition = definitionOf({
    summary: 's',
    walks: [
      {
        title: 'The option',
        steps: [
          { title: 'Declared', body: 'b', places: [place('build.ts', 'target', 10, 14)] },
          { title: 'Passed on', body: 'b', places: [place('config.ts', 'target', 30, 40)] },
          { title: 'Narrow', body: 'b', places: [place('config.ts', 'target', 33, 34)] },
          { title: 'Removed', body: 'b', places: [place('build.ts', 'base', 10, 12)] },
        ],
      },
    ],
  });
  const scope = (currentStepId: string | null = null): ReferenceScope => ({ walks: definition.walks, changedPaths: new Set(['build.ts', 'config.ts', 'other.ts']), currentStepId });

  it('code a step shows leads to that step and place, the narrowest containing place first', () => {
    assert.deepEqual(resolveLineReference({ path: 'build.ts', side: 'target', start: 11, end: 12 }, scope()), {
      kind: 'step',
      walkId: 'W1',
      stepId: 'W1.1',
      placeIndex: 0,
      stepTitle: { sv: 'Declared', en: 'Declared' },
      here: false,
    });
    const narrow = resolveLineReference({ path: 'config.ts', side: 'target', start: 33, end: 33 }, scope());
    assert.equal(narrow.kind === 'step' ? narrow.stepId : null, 'W1.3');
    // Not contained anywhere: the place it overlaps most, when that place holds most of its lines.
    const overlapping = resolveLineReference({ path: 'config.ts', side: 'target', start: 38, end: 41 }, scope());
    assert.equal(overlapping.kind === 'step' ? overlapping.stepId : null, 'W1.2');
    // Most of its lines outside every place: the diff at its lines, not a step it only grazes.
    assert.deepEqual(resolveLineReference({ path: 'config.ts', side: 'target', start: 40, end: 48 }, scope()), { kind: 'diff', location: { path: 'config.ts', side: 'target', start: 40, end: 48 } });
    assert.equal(resolveLineReference({ path: 'config.ts', side: 'target', start: 38, end: 43 }, scope()).kind, 'diff', 'half is not a majority');
    // The side matters: base lines lead to the step showing the base lines.
    const removed = resolveLineReference({ path: 'build.ts', side: 'base', start: 10, end: 10 }, scope('W1.4'));
    assert.ok(removed.kind === 'step' && removed.stepId === 'W1.4' && removed.here);
  });

  it('other code in the diff opens the diff at its lines; code outside the diff opens the unchanged file', () => {
    assert.deepEqual(resolveLineReference({ path: 'build.ts', side: 'target', start: 1, end: 2 }, scope()), { kind: 'diff', location: { path: 'build.ts', side: 'target', start: 1, end: 2 } });
    assert.deepEqual(resolveLineReference({ path: 'other.ts', side: 'base', start: 5, end: 5 }, scope()), { kind: 'diff', location: { path: 'other.ts', side: 'base', start: 5, end: 5 } });
    assert.deepEqual(resolveLineReference({ path: 'util.ts', side: 'target', start: 3, end: 4 }, scope()), { kind: 'unchanged', location: { path: 'util.ts', side: 'target', start: 3, end: 4 } });
    assert.equal(resolveLineReference({ path: '', side: 'target', start: 0, end: 0 }, scope()).kind, 'unresolved');
  });

  it('a base-side reference to a renamed file\'s old path is code in the diff, not unchanged code', () => {
    const paths = changedPathsOf([{ path: 'new-name.ts' }], [{ oldPath: 'old-name.ts', newPath: 'new-name.ts' }, { oldPath: null, newPath: 'added.ts' }]);
    assert.deepEqual([...paths].sort(), ['added.ts', 'new-name.ts', 'old-name.ts']);
    const renamed = resolveLineReference({ path: 'old-name.ts', side: 'base', start: 2, end: 3 }, { walks: [], changedPaths: paths, currentStepId: null });
    assert.equal(renamed.kind, 'diff');
  });

  it('an explicit step reference leads to that step; an id the walk does not have is shown as not found', () => {
    const found = resolveStepReference('W1.2', scope('W1.1'));
    assert.ok(found.kind === 'step' && found.stepId === 'W1.2' && found.placeIndex === 0 && !found.here);
    assert.deepEqual(resolveStepReference('W9.9', scope()), { kind: 'unresolved', reason: 'This walk has no step W9.9.' });
    assert.equal(resolveStepReference('W1.2', { walks: [], changedPaths: new Set(), currentStepId: null }).kind, 'unresolved');
  });
});

describe('step references in answers (DSP-185)', () => {
  it('are read from the references block as written, and a malformed one is named', async () => {
    const read = (): Promise<readonly string[] | null> => Promise.resolve(['one', 'two', 'three']);
    const answer = await readStepAnswer(
      {
        answer: 'Text.',
        references: [
          { label: 'The declaration', step: 'W1.2' },
          { label: 'Bad', step: 'not a step' },
          { label: 'Code', path: 'a.ts', side: 'target', start: 1, end: 2 },
        ],
      },
      () => read(),
    );
    assert.ok(!('error' in answer));
    assert.deepEqual(answer.stepReferences, [{ label: 'The declaration', step: 'W1.2' }]);
    assert.equal(answer.references.length, 1);
    assert.ok(answer.adjustments.some((line) => line.includes('step reference')));
    assert.deepEqual(stepReferencesFrom([{ step: 'R2.1' }, { step: 'W1' }, 'x']), [{ label: 'R2.1', step: 'R2.1' }]);
  });

  it('the explanation prompt offers them only when the outline carries the steps\' ids', () => {
    const withIds = walkOutlineSection({ walkTitle: 'w', steps: [{ id: 'W1.1', title: 'a', places: [] }, { id: 'W1.2', title: 'b', places: [] }], current: 0 });
    assert.match(withIds, /^1\. \[W1\.1\] a {2}<- this step$/m);
    assert.ok(withIds.includes(STEP_REFERENCE_RULE));
    const without = walkOutlineSection({ walkTitle: 'w', steps: [{ title: 'a', places: [] }], current: 0 });
    assert.ok(!without.includes(STEP_REFERENCE_RULE));
  });
});

describe('a walk as a coherent path (DSP-185 extension)', () => {
  it('the walk prompt asks for central called implementation as steps or references, checked facts, and no transport steps', () => {
    const material = { pair: PAIR, repositoryName: 'r', baseSubject: 'b', targetSubject: 't', files: [], diff: '', diffLeftOut: [] };
    const prompt = walksPrompt(material as never, { base: PAIR.base, target: PAIR.target, files: 0, skipped: [], skippedCount: 0 }, 'en');
    assert.match(prompt, /## A coherent path/);
    for (const rule of PATH_RULES) {
      assert.ok(prompt.includes(rule));
    }
    assert.match(prompt, /A place is not treated because it is in a step or because its function is named/);
    assert.match(prompt, /"revisit": "Only for a step that shows a place an earlier step/);
  });

  it('a step that repeats an earlier place with no new purpose goes to the repair round; one that says what is new does not', () => {
    const read = readWalksAnswer({
      summary: 's',
      walks: [
        {
          title: 'w',
          steps: [
            { title: 'Caller', body: 'b', places: [place('w.js', 'target', 2, 3)] },
            { title: 'First', body: 'b', places: [place('w.js', 'target', 10, 13)] },
            { title: 'Caller again', body: 'b', places: [place('w.js', 'target', 2, 3)] },
            { title: 'Second', body: 'b', places: [place('w.js', 'target', 15, 19)] },
            { title: 'Caller at the end', body: 'b', revisit: 'With both functions read, the order of the two calls matters.', places: [place('w.js', 'target', 2, 3)] },
          ],
        },
      ],
    });
    assert.ok(read.walks !== null);
    const problems = repeatedStepProblems(read.walks);
    assert.deepEqual([...problems.keys()], ['0.2']);
    assert.match([...problems.values()][0] ?? '', /shows exactly the place an earlier step of the walk showed \(step 1\)/);
    assert.match(repairPrompt([...problems.values()]), /let the next step's explanation make the transition|the next step's explanation makes the short transition/);
    const definition = parseReviewDefinition(JSON.parse(JSON.stringify(definitionFrom(read.walks, PAIR, 'W', 'p'))) as unknown).definition;
    assert.equal(definition?.walks[0]?.steps[4]?.revisit?.en, 'With both functions read, the order of the two calls matters.');
    assert.equal(definition?.walks[0]?.steps[0]?.revisit, undefined);
  });

  it('the outline names the other walks\' steps, so an explanation can point at a step in another walk', () => {
    const definition = definitionOf({
      summary: 's',
      walks: [
        { title: 'Starting', steps: [{ title: 'Caller', body: 'b', places: [place('w.js', 'target', 2, 3)] }] },
        { title: 'Formatting', steps: [{ title: 'formatPair', body: 'b', places: [place('f.js', 'target', 2, 2)] }] },
      ],
    });
    const outline = walkOutlineOf(definition.walks, 'W1', 'W1.1', 'en');
    assert.deepEqual(outline?.otherWalks, [{ title: 'Formatting', steps: [{ id: 'W2.1', title: 'formatPair' }] }]);
    assert.deepEqual(outlineFrom(JSON.parse(JSON.stringify(outline)) as unknown), outline, 'what the window sends is read back the same');
    const section = walkOutlineSection(outline);
    assert.match(section, /Other walks of this review:\n- Formatting: \[W2\.1\] formatPair/);
    assert.ok(section.includes('or of another walk of this review'));
    const cross = resolveStepReference('W2.1', { walks: definition.walks, changedPaths: new Set(), currentStepId: 'W1.1' });
    assert.ok(cross.kind === 'step' && cross.walkId === 'W2' && cross.stepId === 'W2.1');
  });
});
