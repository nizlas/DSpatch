/**
 * Where a command came from, whether it may run, and what a step proposed.
 *
 * No provider turn and no process: everything here is pure, and the one thing that looks
 * like it spawns something is a counter.
 *
 * ## Why the containment is tested twice
 *
 * *A command DSpatch never showed the user never runs* is what contains everything else in
 * DSP-45, so it is asserted from two independent directions:
 *
 * 1. `loop-chat.test.ts` reads `main.ts` and requires that the handler asks
 *    `mayRunCommandOffer` before the gate. That is evidence about the file.
 * 2. Here, `runCommandOffer` is given a spawn that counts its calls. That is evidence about
 *    behaviour, and it holds for a caller that forgot direction 1 entirely.
 *
 * The second is the one that survives a refactor, because it does not mention `main.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMAND_PROPOSAL_TOKEN,
  COMMAND_PROPOSED_OUTCOME,
  commandNeedsConfirmation,
  confirmedOffer,
  describeCommandProvenance,
  mayRunCommandOffer,
  NO_COMMAND_OUTCOME,
  NO_COMMAND_TOKEN,
  proposalOffer,
  proposedCommandFrom,
  proposedCommandOutcome,
  provenanceRecordFor,
  runCommandOffer,
  suggestionOffer,
  userOffer,
  type CommandOffer,
  type CommandProvenance,
} from '../src/shared/loop-command';

/**
 * One offer per provenance, as a `Record` on purpose.
 *
 * The type makes the exhaustiveness the compiler's problem: a fourth provenance added to
 * `CommandProvenance` stops this file from type checking until someone says what the door
 * does with it. A hand-written array would have quietly kept passing, and the new source
 * would have gone straight to the spawn.
 */
const UNCONFIRMED: Record<CommandProvenance, CommandOffer> = {
  'dspatch-suggestion': suggestionOffer('npm test', 'C:/p'),
  user: userOffer('ctest --test-dir build', 'C:/p', 'field'),
  'step-proposal': proposalOffer('cmake --build build', 'C:/p', 'choose-check'),
};

/** A spawn that records rather than runs. Its call count is the whole assertion. */
function countingSpawn(): {
  readonly spawn: (command: string, cwd: string) => Promise<string>;
  readonly calls: { command: string; cwd: string }[];
} {
  const calls: { command: string; cwd: string }[] = [];
  return {
    calls,
    spawn: (command, cwd) => {
      calls.push({ command, cwd });
      return Promise.resolve(`exit 0 for ${command}`);
    },
  };
}

describe('runCommandOffer — the door an unseen command cannot get through', () => {
  /**
   * The containment, stated as the thing it protects: the process.
   *
   * Not *the predicate returned false* — that is direction 1 restated — but *nothing was
   * started*, which is the fact Niclas would care about.
   */
  it('never calls the spawn for a command the user has not seen', async () => {
    const { spawn, calls } = countingSpawn();

    const attempt = await runCommandOffer(UNCONFIRMED['step-proposal'], spawn);

    assert.equal(attempt.ran, false);
    assert.equal(calls.length, 0, 'no process may be started for an unconfirmed proposal');
    assert.match(
      attempt.ran ? '' : attempt.why,
      /have not seen it yet/,
      'and the refusal says why in words a person can act on',
    );
  });

  /**
   * The two sources that are in the field before Send goes through, which is what being
   * seen means for them. Confirmation for these would be a dialogue asking whether the
   * user meant the thing they typed.
   */
  it('runs the two the user was already looking at, and says whose each was', async () => {
    for (const provenance of ['dspatch-suggestion', 'user'] as const) {
      const { spawn, calls } = countingSpawn();
      const offer = UNCONFIRMED[provenance];

      const attempt = await runCommandOffer(offer, spawn);

      assert.equal(attempt.ran, true, `${provenance} is visible in the field already`);
      assert.deepEqual(calls, [{ command: offer.command, cwd: offer.cwd }]);
      assert.equal(
        attempt.ran ? attempt.result : null,
        `exit 0 for ${offer.command}`,
        'the door returns the spawn\'s own result untouched — DSpatch still reads the exit code',
      );
    }
  });

  /**
   * Exhaustive over provenance, so a source added later cannot slip in unexamined.
   *
   * Every provenance is either refused unconfirmed or explicitly named here as one the
   * user had already seen. There is no third answer and no default.
   */
  it('has decided, for every provenance there is, whether an unconfirmed offer runs', async () => {
    const seenInTheFieldAlready: readonly CommandProvenance[] = ['dspatch-suggestion', 'user'];
    for (const [provenance, offer] of Object.entries(UNCONFIRMED) as readonly [
      CommandProvenance,
      CommandOffer,
    ][]) {
      const { spawn, calls } = countingSpawn();
      const attempt = await runCommandOffer(offer, spawn);
      const expected = seenInTheFieldAlready.includes(provenance);
      assert.equal(
        attempt.ran,
        expected,
        `${provenance}: ${
          expected
            ? 'is in the window\'s own field, so it runs'
            : 'was not shown to the user, so it must not run'
        }`,
      );
      assert.equal(calls.length, expected ? 1 : 0);
    }
  });

  /** The confirmation is what changes it, and it is the field's text that runs. */
  it('runs a proposal once it has been confirmed, using what the field then held', async () => {
    const { spawn, calls } = countingSpawn();
    const confirmed = confirmedOffer(UNCONFIRMED['step-proposal'], {
      command: 'cmake --build build --config Debug',
      cwd: 'C:/p',
    });

    const attempt = await runCommandOffer(confirmed, spawn);

    assert.equal(attempt.ran, true);
    assert.deepEqual(calls, [{ command: 'cmake --build build --config Debug', cwd: 'C:/p' }]);
    assert.equal(confirmed.editedByUser, true, 'the edit is recorded, not inferred later');
  });

  /**
   * Leftover helper behaviour. Decision D3 is not a product requirement: the
   * chat loop does not ask this question. These predicates still describe the
   * unused offer door, so a later reader cannot treat them as the loop's rule.
   */
  it('is leftover helper behaviour, not a chat-loop confirmation', () => {
    assert.equal(commandNeedsConfirmation(UNCONFIRMED['step-proposal']), true);
    assert.equal(
      commandNeedsConfirmation(
        confirmedOffer(UNCONFIRMED['step-proposal'], { command: 'x', cwd: 'C:/p' }),
      ),
      false,
    );
    assert.equal(commandNeedsConfirmation(UNCONFIRMED.user), false);
    assert.equal(commandNeedsConfirmation(UNCONFIRMED['dspatch-suggestion']), false);
  });

  /**
   * The rule is provenance and **not** a list of dangerous names.
   *
   * Stated as a test because it is the kind of rule someone helpfully strengthens. A
   * frightening command the user typed runs; a harmless one nobody has seen does not. Any
   * content check added to this module would break one of these two.
   */
  it('judges where the command came from and never what it says', async () => {
    const frightening = 'git reset --hard && rm -rf build';
    const harmless = 'echo hello';

    const typed = countingSpawn();
    const typedAttempt = await runCommandOffer(
      userOffer(frightening, 'C:/p', 'field'),
      typed.spawn,
    );
    assert.equal(typedAttempt.ran, true, 'the user\'s own command is the user\'s to judge');
    assert.equal(typed.calls.length, 1);

    const proposed = countingSpawn();
    const proposedAttempt = await runCommandOffer(
      proposalOffer(harmless, 'C:/p', 'choose-check'),
      proposed.spawn,
    );
    assert.equal(proposedAttempt.ran, false, 'harmless is not the question being asked');
    assert.equal(proposed.calls.length, 0);
  });

  /** A refusal must never look like a result. */
  it('reports no result at all when it refused', async () => {
    const attempt = await runCommandOffer(UNCONFIRMED['step-proposal'], () =>
      Promise.resolve('passed'),
    );
    assert.equal('result' in attempt, false, 'there is no result, because nothing ran');
  });
});

describe('describeCommandProvenance — DSP-45 #4, in the record and the window', () => {
  it('names DSpatch, the user and the step as three different answers', () => {
    const suggestion = describeCommandProvenance(UNCONFIRMED['dspatch-suggestion']);
    const field = describeCommandProvenance(UNCONFIRMED.user);
    const conversation = describeCommandProvenance(
      userOffer('npm test', 'C:/p', 'conversation'),
    );
    const unconfirmed = describeCommandProvenance(UNCONFIRMED['step-proposal']);

    assert.match(suggestion, /DSpatch suggested this command itself/);
    assert.match(field, /you put this command in the Command field yourself/i);
    assert.match(conversation, /you gave this command in the conversation/i);
    assert.match(unconfirmed, /did not run it/);
    assert.notEqual(field, conversation, 'DSP-45 #3 needs these to be distinguishable');
  });

  /**
   * The sentence a confirmed run leaves behind has to keep the evidence rule intact: the
   * step worked the command out, and DSpatch read the exit code.
   */
  it('says the step did not report whether it passed', () => {
    const note = describeCommandProvenance(
      confirmedOffer(UNCONFIRMED['step-proposal'], {
        command: 'cmake --build build',
        cwd: 'C:/p',
      }),
    );
    assert.match(note, /exit code itself/);
    assert.match(note, /did not report\s+whether it passed|did not report whether it passed/);
  });

  it('records an edited proposal as the user\'s command, not the step\'s', () => {
    const note = describeCommandProvenance(
      confirmedOffer(UNCONFIRMED['step-proposal'], { command: 'ctest -V', cwd: 'C:/p' }),
    );
    assert.match(note, /you changed it/);
  });

  /** The record keeps the source and the step, and does not keep the inputs to the decision. */
  it('reduces an offer to what a later reader can safely believe', () => {
    const record = provenanceRecordFor(
      confirmedOffer(UNCONFIRMED['step-proposal'], { command: 'ctest', cwd: 'C:/p' }),
    );
    assert.equal(record.provenance, 'step-proposal');
    assert.equal(record.proposedByNodeId, 'choose-check');
    assert.ok(record.note.length > 0);
    assert.equal('confirmed' in record, false, 'a stale flag invites the decision to be re-taken');
  });
});

describe('proposedCommandFrom — reading a command out of a reply', () => {
  it('takes the command from the opening line, verbatim', () => {
    assert.deepEqual(proposedCommandFrom(`${COMMAND_PROPOSAL_TOKEN} ctest --test-dir build`), {
      kind: 'command',
      command: 'ctest --test-dir build',
    });
  });

  it('accepts the answer after blank lines and a bare fence marker', () => {
    assert.deepEqual(proposedCommandFrom('\n\n```\nCOMMAND: `npm test`\n```'), {
      kind: 'command',
      command: 'npm test',
    });
  });

  it('reads "there is no check here" as an answer about the project', () => {
    assert.deepEqual(proposedCommandFrom(`${NO_COMMAND_TOKEN} — no build files anywhere`), {
      kind: 'none',
    });
  });

  /**
   * Prose is not a command. The expensive mistake in this direction is guessing a command
   * out of a sentence, and DSpatch does not guess.
   */
  it('refuses to invent a command out of prose', () => {
    for (const reply of [
      'You could probably run npm test here.',
      'DONE',
      '',
      'COMMAND:',
      'NO_COMMANDS_FOUND_ANYWHERE is a strange thing to say',
    ]) {
      assert.deepEqual(
        proposedCommandFrom(reply),
        { kind: 'unreadable' },
        `"${reply}" contains no command in the form DSpatch reads`,
      );
    }
  });
});

describe('proposedCommandOutcome — the branch is in the drawing', () => {
  const declared = [COMMAND_PROPOSED_OUTCOME, NO_COMMAND_OUTCOME];

  it('routes a proposal and a refusal to the two declared names', () => {
    assert.equal(
      proposedCommandOutcome(declared, { kind: 'command', command: 'npm test' })?.outcome,
      COMMAND_PROPOSED_OUTCOME,
    );
    assert.equal(
      proposedCommandOutcome(declared, { kind: 'none' })?.outcome,
      NO_COMMAND_OUTCOME,
    );
    assert.equal(
      proposedCommandOutcome(declared, { kind: 'unreadable' })?.outcome,
      NO_COMMAND_OUTCOME,
      'an unreadable reply is a run that checked nothing, not a run that failed',
    );
  });

  /** Declaration-gated, so every graph drawn before today keeps working. */
  it('stays out of the way of a node that declares neither name', () => {
    assert.equal(proposedCommandOutcome([], { kind: 'command', command: 'npm test' }), null);
    assert.equal(
      proposedCommandOutcome([COMMAND_PROPOSED_OUTCOME], { kind: 'none' }),
      null,
      'both names or neither: one name leaves a verdict with nowhere to go',
    );
  });

  /** The sentence must not read as though the check had already happened. */
  it('says nothing has run yet', () => {
    const routed = proposedCommandOutcome(declared, { kind: 'command', command: 'npm test' });
    assert.match(routed?.why ?? '', /Nothing has run yet/);
    assert.match(routed?.why ?? '', /does not say\s+whether it passed|whether it passed/);
  });
});
