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
  describeWorkingRootsForPerson,
  primaryRootOf,
  providerRootPathsFor,
  rootForPath,
  workingRootsFrom,
  WORKING_ROOTS_ISOLATION_HEADLINE,
  WORKING_ROOTS_ISOLATION_NOTE,
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
   * agent or to the person. The list is short and specific on purpose: a test against
   * "any mention of limits" would fail on the honest note below, which has to talk
   * about the absence of a limit in order to be honest about it.
   */
  it('asserts no restriction, in the prompt or on screen', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const shown = describeWorkingRootsForPerson(roots);
    const everything = [
      describeWorkingRootsForAgent(roots).join('\n'),
      shown.headline,
      shown.detail,
      describeUnobservedOutside(roots),
      WORKING_ROOTS_ISOLATION_NOTE,
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

describe('what a person is told about the folders', () => {
  it('counts the folders in the headline and keeps the note whole in the detail', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const shown = describeWorkingRootsForPerson(roots);
    assert.equal(
      shown.headline,
      `2 working folders. ${WORKING_ROOTS_ISOLATION_HEADLINE}`,
      'the headline is the count plus the one exported line, and nothing written beside it',
    );
    // Whole, not summarised: a shortened version of this note is a version that has
    // stopped being true, and the detail is where its length belongs.
    assert.ok(shown.detail.includes(WORKING_ROOTS_ISOLATION_NOTE));
    assert.ok(shown.detail.includes('left is the working directory'));
  });

  /**
   * DSP-64's shape, and the trap in applying it.
   *
   * A first line short enough to read is only an improvement if it is still true alone.
   * Most people will not open the disclosure, so the headline — not the paragraph behind
   * it — is where the claim not to be a boundary has to live.
   */
  it('says the folders are not a boundary in the headline, not only in the detail', () => {
    const roots = workingRootsFrom(['C:/work/left', 'C:/work/right'], 'C:/work/left', true);
    const headline = describeWorkingRootsForPerson(roots).headline;
    assert.match(headline, /Not a boundary/);
    // What DSpatch does do, beside what it cannot: a headline that carried only the
    // negative would read as alarm, and one that carried only the positive would be the
    // comfortable half. Both beats, and the capability names the path it holds on.
    assert.match(headline, /a loop run .*reports what changed/);
    assert.match(headline, /nothing stops an agent leaving them/);
    // Short enough to be read at a glance in a 300 px column. The failure this replaced
    // was 595 characters drawn open, and the way it returns is by the headline growing.
    assert.ok(
      headline.length <= 200,
      `the headline is ${String(headline.length)} characters, which is a paragraph again`,
    );
  });

  /**
   * The single-source property, held by construction rather than by care.
   *
   * There is one exported line and one exported paragraph, and the paragraph is built
   * out of the line — so a future surface cannot reach a friendlier version of either,
   * and the explanation cannot be drawn without the headline in front of it.
   */
  it('builds the whole note out of the headline, so the two cannot drift', () => {
    assert.ok(
      WORKING_ROOTS_ISOLATION_NOTE.startsWith(`${WORKING_ROOTS_ISOLATION_HEADLINE} `),
      'the note has to open with the headline verbatim, or the short line is a summary',
    );
  });

  it('keeps every fact the note carried, behind the disclosure', () => {
    // Each measured elsewhere and none safe to drop: the agent is not confined, DSpatch
    // has seen it reach outside, and what is outside the roots is unobserved.
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /[Nn]ot a boundary/);
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /no filesystem confinement by default/);
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /reading and writing outside the folder it was given/);
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /not observed, which is not the same as nothing/);
  });

  /**
   * What the note says a folder's own configuration does, checked against what was
   * measured — and this is the second time that sentence has been wrong.
   *
   * Version one claimed `rules, skills and MCP servers` load per root. The MCP third was
   * false, and the test that passed on it asserted the literal phrase. Version two fixed
   * the membership and kept the premise: that each root's rules and skills are loaded at
   * all. DSP-91's canary probe took that premise away.
   *
   * `localOptionsFor` passes `{ cwd }` and no `settingSources`, and the SDK's
   * `setting-sources.js` maps an absent list to every source **off**. Measured on this
   * machine with the product's own options (`canary-reads-probe.log`): prewarm read four
   * paths under the scratch root, the root itself and `.git`, and none of the planted
   * `.cursor/rules`, `.cursor/skills` or `AGENTS.md`. The same probe with
   * `settingSources: ['project']` read 30, including all of them — so the instrument
   * works and the difference is the option. A real turn through `CursorSdkAdapter`
   * then answered NONE to all four planted tokens (`canary-context-probe.log`).
   *
   * So the claim under test is the negative one, and it has to carry its reason: a reader
   * who is told configuration is not loaded needs to know it is a setting DSpatch has not
   * turned on rather than something Cursor cannot do.
   */
  it('says project configuration is not loaded, which is what was measured', () => {
    const claim = WORKING_ROOTS_ISOLATION_NOTE.split(/(?<=\.)\s+/).find((sentence) =>
      /are not loaded/.test(sentence),
    );
    assert.ok(
      claim !== undefined,
      'the note has to say what a folder\u2019s own configuration does, and what it does ' +
        'is nothing',
    );
    for (const named of ['rules', 'skills', 'AGENTS.md']) {
      assert.ok(
        claim.includes(named),
        `the clause does not mention ${named}, which was planted in the scratch project ` +
          'and measured unread',
      );
    }
    // The reason, because the fact alone would read as a provider limitation.
    assert.match(claim, /does not turn on Cursor\u2019s project settings/);
    // And what governs instead, which is the whole point of the measurement: if nothing
    // in the folders reaches the agent, the role and the task are the only inputs — and
    // that is why DSP-91 could be fixed by wording at all.
    assert.match(
      WORKING_ROOTS_ISOLATION_NOTE,
      /governed by the role and the task DSpatch sends it/,
    );
    // The retracted claim must not creep back in either form.
    assert.equal(
      /load(s|ed)? (from|per) (every|each) (unique )?(path|folder|root)/i.test(
        WORKING_ROOTS_ISOLATION_NOTE,
      ),
      false,
      'per-root loading was the premise the canary probe removed',
    );
  });

  /**
   * F2: the note is drawn whenever a folder is open, so every claim in it has to name
   * the path it is true on.
   *
   * Only a loop run passes `dirs` and snapshots each root; an ordinary chat message gives
   * the provider the working directory alone. The headline carried the run-only claim
   * flatly, and the detail said DSpatch "hands them to Cursor" with no condition, on a
   * surface drawn on both paths.
   */
  it('says which path hands the folders over, on both the headline and the detail', () => {
    assert.match(
      WORKING_ROOTS_ISOLATION_HEADLINE,
      /a loop run/,
      'the headline\u2019s capability claim is true of a loop run and not of a chat message',
    );
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /During a loop run/);
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /An ordinary chat message does neither/);
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /the other folders reach nobody/);
    // What is true whichever path you are on has to be said of both, not left to be
    // inferred from the run half. The configuration claim is the one that applies to
    // both, and since DSP-91 it is a negative one — so the phrase is "either" rather
    // than "both", and the property being held is that the path is still named.
    assert.match(WORKING_ROOTS_ISOLATION_NOTE, /on either path/);
  });

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
