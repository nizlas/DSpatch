/**
 * DSP-72. The run's roots as a value, and the words DSpatch uses about them.
 *
 * Two kinds of test here, and the second is the unusual one. The first kind checks the
 * value: ordering, naming, deduplication, attribution. The second checks **wording**,
 * because this card's available failure is not a missing feature but a feature that
 * reads as containment it does not have. A restriction verb in the sentence a person
 * reads is a defect, and the only way that defect is caught by a suite is if a test
 * looks for it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeUnobservedOutside,
  describeWorkingRootsForAgent,
  primaryRootOf,
  providerRootPathsFor,
  rootForPath,
  workingRootsFrom,
} from '../src/shared/working-roots';

describe('the run\u2019s working roots', () => {
  it('puts the working directory first however the folders were listed', () => {
    const roots = workingRootsFrom(
      ['C:/work/left', 'C:/work/right', 'C:/work/third'],
      'C:/work/right',
      true,
    );
    assert.deepEqual(
      roots.map((root) => root.path),
      ['C:/work/right', 'C:/work/left', 'C:/work/third'],
    );
    assert.equal(primaryRootOf(roots)?.path, 'C:/work/right');
    assert.deepEqual(
      roots.map((root) => root.primary),
      [true, false, false],
    );
    // The provider's list is the same order, because the first entry is the `cwd`.
    assert.deepEqual(
      [...providerRootPathsFor(roots)],
      ['C:/work/right', 'C:/work/left', 'C:/work/third'],
    );
  });

  it('gives two folders of the same name names that tell them apart', () => {
    const roots = workingRootsFrom(['C:/one/app', 'C:/two/app'], 'C:/one/app', true);
    assert.deepEqual(
      roots.map((root) => root.name),
      ['one/app', 'two/app'],
    );
    // The reason this matters: a per-root report keyed on `app` could not say which.
    assert.equal(new Set(roots.map((root) => root.name)).size, 2);
  });

  it('opens the same folder once, and Windows paths differ in case without differing', () => {
    const windows = workingRootsFrom(['C:/work/app', 'c:/WORK/app'], 'C:/work/app', true);
    assert.equal(windows.length, 1);
    const elsewhere = workingRootsFrom(['/work/app', '/WORK/app'], '/work/app', false);
    assert.equal(elsewhere.length, 2);
  });

  it('attributes a path to the innermost root that contains it', () => {
    const roots = workingRootsFrom(['C:/work/outer', 'C:/work/outer/inner'], 'C:/work/outer', true);
    assert.equal(rootForPath(roots, 'C:/work/outer/inner/file.ts', true)?.path, 'C:/work/outer/inner');
    assert.equal(rootForPath(roots, 'C:/work/outer/file.ts', true)?.path, 'C:/work/outer');
    // A sibling whose path merely starts with a root's characters is not inside it.
    assert.equal(rootForPath(roots, 'C:/work/outer-other/file.ts', true), null);
    assert.equal(rootForPath(roots, 'D:/somewhere/else.ts', true), null);
  });

  it('has nothing to say about an empty list rather than inventing a root', () => {
    assert.deepEqual(workingRootsFrom([], null, true), []);
    assert.equal(primaryRootOf([]), null);
    assert.deepEqual([...providerRootPathsFor([])], []);
  });
});

describe('what the agent is told about the folders', () => {
  it('names every path and which one is the working directory', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const told = describeWorkingRootsForAgent(roots).join('\n');
    assert.ok(told.includes('C:/work/left'));
    assert.ok(told.includes('C:/work/right'));
    assert.match(told, /\(the working directory\)/);
    assert.ok(told.includes('Your shell starts in C:/work/left'));
  });

  /**
   * DSP-91 #2 reverses the assertion this replaced, which pinned `[]` for one root.
   *
   * That was defensible while the question was "which of several folders is which", and
   * it produced the 21 September failure: the coordinator's whole message never named
   * the project it was working in, so the role's resource path, the working folder and
   * the run's result storage were one undifferentiated "here" and the agent resolved a
   * loop-definition path against its own `cwd`. Naming the one folder is what makes them
   * three distinguishable places.
   */
  it('names the one folder too, so the prompt has said where the project is', () => {
    const told = describeWorkingRootsForAgent(
      workingRootsFrom(['C:/work/left'], 'C:/work/left', true),
    ).join('\n');
    assert.match(told, /one working folder/);
    assert.ok(told.includes('C:/work/left'));
    assert.match(told, /\(the working directory\)/);
    // And it is an address rather than an errand: the folder being named must not read
    // as an instruction to go and survey it.
    assert.match(told, /This is an address, not an instruction/);
    assert.match(told, /is decided by the task below/);
    // Nothing to name is still nothing to say.
    assert.deepEqual(describeWorkingRootsForAgent([]), []);
  });

  /**
   * DSP-72 #6, as a gate rather than as a promise.
   *
   * The forbidden thing is a sentence that reads as a boundary. These are the phrases
   * that would do it — the ones a well-meaning author reaches for when describing a
   * folder list — and none may appear in anything DSpatch says about the roots, to the
   * agent or in a run's record. The list is short and specific on purpose: a test
   * against "any mention of limits" would fail on an honest sentence that has to talk
   * about the absence of a limit in order to be honest about it. (The sidebar's own
   * note was removed in DSP-125; what it said is in app/README.md.)
   */
  it('asserts no restriction, in the prompt or in the record', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const everything = [
      describeWorkingRootsForAgent(roots).join('\n'),
      describeUnobservedOutside(roots),
    ].join('\n');
    const forbidden = [
      'limited to',
      'restricted to',
      'confined to',
      'may only',
      'must not leave',
      'cannot access',
      'only these folders',
      'sandbox',
      'do not write outside',
      'stay within',
      'stay inside',
    ];
    for (const phrase of forbidden) {
      assert.equal(
        everything.toLowerCase().includes(phrase),
        false,
        `"${phrase}" reads as a restriction, and nothing DSpatch says about working roots may`,
      );
    }
  });
});

describe('what a record says about the folders it did not look at', () => {
  it('says not observed rather than none about everywhere else', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const note = describeUnobservedOutside(roots);
    assert.ok(note.includes('C:/work/left'));
    assert.ok(note.includes('C:/work/right'));
    assert.match(note, /were not observed/);
    assert.match(note, /not observed is not the same as none/);
    // The word that would make it a claim DSpatch did not measure.
    assert.equal(/no changes outside/i.test(note), false);
  });

  /**
   * DSP-91 #7: a run that took no snapshot has to say so, in the same register.
   *
   * Skipping the hash is the cheap half. The expensive half is that three empty file
   * lists read exactly like a measurement that found nothing changed — and the
   * before/after hash is the only thing in DSpatch that can contradict an agent claiming
   * it changed nothing. So the roots join the folders this record says nothing about, and
   * the reason is carried rather than implied.
   */
  it('puts the roots themselves among the unobserved when no snapshot was taken', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const note = describeUnobservedOutside(roots, 'No step in this run can write files.');
    assert.ok(note.includes('C:/work/left'));
    assert.ok(note.includes('C:/work/right'));
    assert.match(note, /took no before-and-after snapshot/);
    assert.match(note, /No step in this run can write files\./);
    assert.match(note, /not observed is not the same as none/);
    // The sentence that would turn an absent measurement into a finding.
    assert.equal(/nothing changed|no change(s)? (were|was) made/i.test(note), false);
    // And it must not read as the ordinary case: "changes were measured inside" is the
    // claim this record cannot make.
    assert.equal(note.includes('Changes were measured inside'), false);
  });
});
