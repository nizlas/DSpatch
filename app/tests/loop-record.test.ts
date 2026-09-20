/**
 * The run record's format, its tolerance to a file that stops mid-line, and the
 * outcome vocabulary written into it.
 *
 * Every assertion that matters here is on **the sentence or the badge a person
 * reads**, not on the flag behind it. The defect this work exists to remove was a
 * green badge reading `ended: completed` over a run that had stopped at the
 * *Failed or abandoned* terminal, and a gate that had started no process reporting
 * the user's tests as failed. A test that checked an enum would have passed while
 * the window said both of those things.
 *
 * The user-visible assertion is deliberately the **first** one in each test.
 * `node --test` stops a test at its first failure, so a proof whose first
 * assertion is an intermediate detail proves the wrong thing when it is reverted.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeRunOutcome,
  LOOP_RUN_RECORD_VERSION,
  NOT_CHECKED_TERMINAL,
  NOT_ESTABLISHED_TERMINAL,
  NOT_MET_TERMINAL,
  NOTHING_CHANGED_TERMINAL,
  parseRunRecord,
  RUN_OUTCOME_BADGE_TEXT,
  runOutcomeFrom,
  serialiseRecordLine,
  STOPPED_TERMINAL,
  type RecordedCommand,
  type RecordedRunEnding,
  type RunRecordIdentity,
  type RunWalkEnding,
} from '../src/shared/loop-record';
import type { RunJournalEntry } from '../src/shared/loop-run';
import {
  loopTurnBadge,
  loopTurnBadgeText,
  loopTurnEndingLine,
  loopTurnStatusText,
  loopTurnsFromRecordText,
} from '../src/shared/loop-transcript';

const identity: RunRecordIdentity = {
  runId: 'chat-loop-2026-09-17T21-00-00-000Z',
  projectPath: 'C:/Users/nicla/projects/hers',
  conversationId: 'dsp-conv-20260917210000-abcdef',
  mandate: 'Make the window remember what it did.',
  graphId: 'dspatch-chat-loop',
  graphPath: 'C:/Users/nicla/development/DSpatch/docs/loop/graphs/dspatch-chat-loop.graph.json',
  graphVersionId: 'graph-1122334455667788',
  modelRequested: 'claude-haiku-4-5',
  appVersion: '0.1.0',
  startedAtUtc: '2026-09-17T21:00:00.000Z',
};

function command(parts: Partial<RecordedCommand> = {}): RecordedCommand {
  return {
    command: 'cmd.exe /d /s /c npm test',
    cwd: 'C:/Users/nicla/projects/hers',
    exitCode: 0,
    signal: null,
    durationMs: 1200,
    startedAtUtc: '2026-09-17T21:00:10.000Z',
    notRun: null,
    stdoutTail: '',
    stderrTail: '',
    truncatedOutput: null,
    snapshotAfterId: 'snap-abcdef0123456789',
    ...parts,
  };
}

function journalEntry(seq: number, kind: RunJournalEntry['kind'], detail: string): RunJournalEntry {
  return { seq, atIso: '2026-09-17T21:00:05.000Z', sinceStartMs: seq * 1000, kind, detail };
}

function ending(parts: Partial<RecordedRunEnding> = {}): RecordedRunEnding {
  return {
    endedAtUtc: '2026-09-17T21:02:00.000Z',
    kind: 'finished',
    status: 'completed',
    terminalNodeId: 'done',
    outcome: 'work-verified',
    outcomeText: describeRunOutcome('work-verified', { commands: [command()] }),
    modelRequested: 'claude-haiku-4-5',
    modelReported: 'claude-haiku-4-5',
    commands: [command()],
    snapshots: {
      beforeId: 'snap-1111111111111111',
      beforeFileCount: 12,
      afterId: 'snap-2222222222222222',
      afterFileCount: 12,
      changed: [],
      added: [],
      removed: [],
      truncated: null,
    },
    note: 'workspace C:/Users/nicla/projects/hers (open project; files were not reset)',
    cancelled: false,
    cost: 'unknown',
    ...parts,
  };
}

function recordText(
  parts: {
    readonly ending?: RecordedRunEnding | null;
    /** Journal lines beyond the run's first, in the order the runner wrote them. */
    readonly journal?: readonly RunJournalEntry[];
  } = {},
): string {
  const lines = [
    serialiseRecordLine({ line: 'header', formatVersion: LOOP_RUN_RECORD_VERSION, identity }),
    serialiseRecordLine({
      line: 'journal',
      entry: journalEntry(1, 'run-started', 'Run of graph "dspatch-chat-loop".'),
    }),
    ...(parts.journal ?? []).map((entry) => serialiseRecordLine({ line: 'journal', entry })),
    serialiseRecordLine({
      line: 'agent-reply',
      reply: {
        atUtc: '2026-09-17T21:00:40.000Z',
        nodeId: 'implementer',
        nodeLabel: 'Do the requested work',
        occurrence: 1,
        text: 'I edited src/window.ts and added the missing field.',
        terminalStatus: 'completed',
      },
    }),
    serialiseRecordLine({ line: 'command', command: command() }),
  ];
  const last = parts.ending === undefined ? ending() : parts.ending;
  if (last !== null) {
    lines.push(serialiseRecordLine({ line: 'ending', ending: last }));
  }
  return lines.join('');
}

describe('a run kept on disk', () => {
  it('reads back with the run, the project, the conversation and the exact graph version', () => {
    const parsed = parseRunRecord(recordText());
    assert.equal(parsed.completeness, 'complete', 'a record written to the end reads back whole');
    assert.equal(parsed.identity?.runId, identity.runId, 'the run must name itself');
    assert.equal(
      parsed.identity?.projectPath,
      identity.projectPath,
      'and say which project it was run against',
    );
    assert.equal(
      parsed.identity?.conversationId,
      identity.conversationId,
      'and which conversation it belongs to',
    );
    assert.equal(parsed.identity?.mandate, identity.mandate, 'and what it was asked to do');
    // The drawing that ran, identified by its content. A name would not do: the
    // editor exists so a person can change the graph between runs.
    assert.equal(
      parsed.identity?.graphVersionId,
      identity.graphVersionId,
      'and which version of the drawing ran, so a later edit cannot be mistaken for this one',
    );
    assert.equal(parsed.journal.length, 1, 'the steps survive');
    assert.equal(
      parsed.replies[0]?.text,
      'I edited src/window.ts and added the missing field.',
      'the agent\'s own words survive',
    );
    assert.equal(parsed.commands.length, 1, 'the commands survive');
    assert.equal(
      parsed.ending?.modelRequested,
      'claude-haiku-4-5',
      'and the model asked for is kept next to the model that answered',
    );
    assert.equal(parsed.ending?.modelReported, 'claude-haiku-4-5');
  });

  /**
   * The header has no field a credential, an account address or a backend URL could
   * live in, and this is the test that keeps it that way. Asserting the exact set of
   * keys rather than the absence of particular names is the point: a field added
   * later called `apiKey`, `account` or `endpoint` fails here whatever it is called.
   */
  it('has nowhere for a secret to be written', () => {
    const parsed = parseRunRecord(recordText());
    assert.deepEqual(Object.keys(parsed.identity ?? {}).sort(), [
      'appVersion',
      'conversationId',
      'graphId',
      'graphPath',
      'graphVersionId',
      'mandate',
      'modelRequested',
      'projectPath',
      'runId',
      'startedAtUtc',
    ]);
  });
});

/**
 * DSP-25 #4. A process killed while appending leaves a file whose last line stops
 * in the middle of a value, and the run it describes is neither finished nor
 * failed — DSpatch simply stopped watching. Both wrong answers are worse than the
 * truth: a parse error throws away the whole run, and "completed" is a lie.
 */
/**
 * What the record is asked to be readable *about*, rather than how it parses.
 *
 * Two criteria meet here and both are about a person reading the file afterwards:
 *
 * - DSP-46 #1: *what the agent was told can be read from the run record.* Not that a role
 *   was named in the drawing — the drawing is already on disk — but that the text which
 *   reached the provider is recoverable.
 * - DSP-45 #4: *the record says where the command came from and shows it exactly as it
 *   ran.* Both halves, because "exactly as it ran" is the shell line and a person comparing
 *   against their Command field needs the line they would have typed.
 */
describe('reading afterwards what a step was told and whose command ran', () => {
  const told = (): string =>
    [
      serialiseRecordLine({
        line: 'header',
        formatVersion: LOOP_RUN_RECORD_VERSION,
        identity,
      }),
      serialiseRecordLine({
        line: 'agent-reply',
        reply: {
          atUtc: '2026-09-17T21:00:40.000Z',
          nodeId: 'choose-check',
          nodeLabel: 'Work out how to check this project',
          occurrence: 1,
          text: 'COMMAND: ctest --test-dir build',
          terminalStatus: 'completed',
          prompt:
            'You are acting in the role below.\n--- role ---\nRead the project and name one ' +
            'command.\n--- end role ---\nMandate: make the window remember.',
          roleId: 'project-check',
          roleSourcePath: 'docs/loop/roles/project/project-check.role.md',
        },
      }),
      serialiseRecordLine({
        line: 'command',
        command: command({
          command: 'cmd.exe /d /s /c ctest --test-dir build',
          line: 'ctest --test-dir build',
          provenance: 'step-proposal',
          proposedByNodeId: 'choose-check',
          provenanceNote:
            '"choose-check" proposed this command after reading the project, DSpatch showed ' +
            'it to you before running anything, and you confirmed it.',
        }),
      }),
      serialiseRecordLine({ line: 'ending', ending: ending() }),
    ].join('');

  it('gives back the prompt the step was actually sent, and which role it came from', () => {
    const reply = parseRunRecord(told()).replies[0];

    assert.match(
      reply?.prompt ?? '',
      /Read the project and name one command\./,
      'DSP-46 #1: the role text that reached the provider is in the record, not only the ' +
        'fact that a role was named',
    );
    assert.equal(reply?.roleId, 'project-check');
    assert.equal(
      reply?.roleSourcePath,
      'docs/loop/roles/project/project-check.role.md',
      'and the file it was read from, so the prompt can be compared with its source',
    );
  });

  /**
   * The record is about one step's own prompt, so the node has to be on the reply that
   * carries it. A reader asking "what was the step that chose the command told?" must not
   * have to assume that replies and prompts line up by position.
   */
  it('keeps the prompt on the reply of the step that was sent it', () => {
    const reply = parseRunRecord(told()).replies[0];
    assert.equal(reply?.nodeId, 'choose-check');
    assert.equal(reply?.text, 'COMMAND: ctest --test-dir build');
  });

  it('says whose command ran, and shows it both as started and as a person would type it', () => {
    const recorded = parseRunRecord(told()).commands[0];

    assert.equal(recorded?.provenance, 'step-proposal');
    assert.equal(recorded?.proposedByNodeId, 'choose-check');
    assert.match(recorded?.provenanceNote ?? '', /before running anything/);
    assert.equal(
      recorded?.command,
      'cmd.exe /d /s /c ctest --test-dir build',
      'exactly as it ran, shell and all',
    );
    assert.equal(
      recorded?.line,
      'ctest --test-dir build',
      'and without the prefix, which is what the Command field holds',
    );
  });

  /**
   * A record from before these fields must read as *not recorded* and never as a source.
   *
   * The failure this guards against is a default: a reader that treated a missing
   * provenance as "the user" would assert the one thing the field exists to establish, on
   * a file that never said it.
   */
  it('reads an older record as saying nothing about provenance rather than guessing', () => {
    const parsed = parseRunRecord(recordText());

    assert.equal(parsed.commands[0]?.provenance, undefined);
    assert.equal(parsed.commands[0]?.line, undefined);
    assert.equal(parsed.replies[0]?.prompt, undefined);
    assert.equal(parsed.replies[0]?.roleId, undefined);
    assert.equal(
      parsed.completeness,
      'complete',
      'and it still reads as a whole record: these fields are additions, not requirements',
    );
  });
});

describe('a run DSpatch was killed in the middle of', () => {
  const whole = recordText({ ending: null });
  const cut = `${whole}{"line":"journal","entry":{"seq":2,"kind":"node-ent`;

  it('is shown as a run DSpatch stopped before, and never as a pass or a failure', () => {
    const turn = loopTurnsFromRecordText(cut)[0];
    const said = loopTurnStatusText(turn ?? ({} as never));
    assert.match(
      said,
      /DSpatch stopped before the run reported an end/,
      `an interrupted run must say DSpatch stopped first. It said: ${said}`,
    );
    assert.match(said, /not a pass and not a failure/, 'and must refuse both verdicts');
    assert.match(
      said,
      /ends in the middle of a line/,
      'and must say the last write did not finish, because a step may be missing',
    );
    assert.notEqual(loopTurnBadge(turn ?? ({} as never)), 'supported');
    assert.equal(loopTurnBadgeText(turn ?? ({} as never)), 'DSpatch stopped first');
  });

  it('still gives up everything that was written before the interruption', () => {
    const parsed = parseRunRecord(cut);
    assert.equal(parsed.completeness, 'interrupted');
    assert.equal(parsed.truncatedLastLine, true);
    assert.equal(parsed.ending, null);
    // The whole point of appending: the run's identity and its history up to the
    // interruption survive. The half-written line is dropped, not counted as damage.
    assert.equal(parsed.identity?.runId, identity.runId);
    assert.equal(parsed.journal.length, 1);
    assert.equal(parsed.commands.length, 1);
    assert.equal(parsed.unreadableLines, 0);
  });

  it('reads a record from a newer DSpatch as far as it can and refuses to rewrite it', () => {
    const newer = recordText().replace(
      `"formatVersion":${String(LOOP_RUN_RECORD_VERSION)}`,
      `"formatVersion":${String(LOOP_RUN_RECORD_VERSION + 1)}`,
    );
    const parsed = parseRunRecord(newer);
    assert.equal(
      parsed.readOnly,
      true,
      'a record from a newer DSpatch must be left alone, not appended to with fields it will lose',
    );
    assert.match(
      parsed.error ?? '',
      /newer than the/,
      `and the person must be told why parts may be missing. It said: ${parsed.error ?? '(nothing)'}`,
    );
    assert.match(
      parsed.recovery ?? '',
      /never rewrites a record it does not recognise/,
      'and must say the file is safe to open with the newer build',
    );
  });
});

/**
 * DSP-26 #2 and #3. The five states, each in the words a person reads.
 */
describe('what "did it work" is allowed to mean', () => {
  const settled = { status: 'completed' as const, cancelled: false, recordComplete: true };

  it('never calls a gate that started no process a test failure', () => {
    const commands = [
      command({
        exitCode: null,
        notRun: {
          kind: 'no-command-configured',
          message:
            'There is no command to run. Type the build or test command you would use in a terminal.',
        },
      }),
    ];
    const outcome = runOutcomeFrom({ ...settled, commands });
    const said = describeRunOutcome(outcome, { commands });
    assert.match(
      said,
      /DSpatch did not start a command of its own/,
      `a gate that ran nothing must say so. It said: ${said}`,
    );
    assert.match(said, /not a test failure/, 'and must deny the failure explicitly');
    assert.match(said, /There is no command to run/, 'and must carry the reason as it was given');
    assert.equal(outcome, 'verification-not-performed');
  });

  /**
   * DSP-44 #2, checked rather than assumed.
   *
   * DSP-44 makes "there was nothing to run" a routed gate outcome, so a run that was
   * never checked now ends with `status: 'completed'` at a terminal, where before it
   * ended as a runtime fault. That is the one change, and the thing most easily lost
   * by it is the reason `runOutcomeFrom` checks the commands **before** the status: a
   * completed walk with a `no-command-configured` command must still be
   * `verification-not-performed` and must never become `work-verified` on the
   * strength of having arrived somewhere.
   *
   * So this asserts the property the card states — all five told apart, in the record
   * and in the badge — rather than five separate facts that could each hold while the
   * set collapsed. DSP-26 is in Review and not accepted, which is why it is measured
   * here instead of being taken on trust.
   */
  it('keeps all five states distinct, in the record and in the badge', () => {
    const situations = {
      'work-verified': [command({ exitCode: 0 })],
      'tests-failed': [command({ exitCode: 1 })],
      'verification-not-performed': [
        command({
          exitCode: null,
          notRun: { kind: 'no-command-configured', message: 'There is no command to run.' },
        }),
      ],
      'command-could-not-start': [
        command({
          exitCode: null,
          notRun: { kind: 'could-not-start', message: "'nmp' is not recognized." },
        }),
      ],
      unresolved: [
        command({
          exitCode: null,
          notRun: { kind: 'did-not-finish', message: 'Still running after 15 minutes.' },
        }),
      ],
    } as const;

    const reached = new Map<string, string>();
    for (const [expected, commands] of Object.entries(situations)) {
      // `settled` carries `status: 'completed'`, which is what a `not-verified` run
      // now reports. A run that walked to a terminal with nothing checked must not
      // read as one that was checked.
      const outcome = runOutcomeFrom({ ...settled, commands });
      assert.equal(outcome, expected, `${expected} must survive a completed walk`);
      const said = describeRunOutcome(outcome, { commands });
      assert.ok(said.trim() !== '', `${expected} must have a sentence`);
      const previous = reached.get(said);
      assert.equal(
        previous,
        undefined,
        `${expected} and ${String(previous)} must not read identically on screen`,
      );
      reached.set(said, expected);
    }

    // And the badge words, which are what a person reads first. Two states have none
    // by design and defer to the ending's own phrase: `unresolved`, whose endings each
    // name the particular thing, and `verification-not-performed` (DSP-55), which says
    // DSpatch started no command of its own and is therefore true of every chat-loop
    // ending at once. Three words for five states is the correct count rather than a
    // gap, and where a state has words no other state may share them.
    const words = Object.keys(situations).map(
      (outcome) => RUN_OUTCOME_BADGE_TEXT[outcome as keyof typeof situations],
    );
    const said = words.filter((word) => word !== null);
    assert.equal(said.length, 3);
    assert.equal(new Set(said).size, said.length, 'no two states may share a badge word');
    assert.equal(RUN_OUTCOME_BADGE_TEXT['verification-not-performed'], null);
    // The measured defect: a run whose checking agent configured CMake and ran ctest
    // to 3 of 3 passing was badged `nothing was checked`. No badge word may claim
    // that, whichever state it belongs to.
    for (const word of said) {
      assert.doesNotMatch(
        word,
        /nothing was checked/,
        `a badge may not tell a person their project was not checked. It said: ${word}`,
      );
    }
  });

  it('never calls a command that could not be started a test failure', () => {
    const commands = [
      command({
        exitCode: 1,
        notRun: {
          kind: 'could-not-start',
          message:
            'There is no program called "nmp" in C:/p or on this account\'s PATH, so the ' +
            'command never started. The shell said: \'nmp\' is not recognized as an internal ' +
            'or external command, operable program or batch file.',
        },
      }),
    ];
    const outcome = runOutcomeFrom({ ...settled, commands });
    const said = describeRunOutcome(outcome, { commands });
    assert.match(
      said,
      /could not start a command it was given/,
      `a command that never started must say so. It said: ${said}`,
    );
    assert.match(said, /not a test failure/, 'and must deny the failure explicitly');
    // The shell's own words, whatever language they are in. DSpatch has nothing
    // better to put in their place and must not substitute a euphemism.
    assert.match(said, /is not recognized as an internal or external command/);
    assert.equal(outcome, 'command-could-not-start');
    // And it is a different state from "nothing was configured", which is the
    // distinction the whole vocabulary exists for.
    assert.notEqual(outcome, 'verification-not-performed');
  });

  /**
   * The rule that prevents the class. On 17 September a run that reached the
   * *Failed or abandoned* terminal was drawn green, because arriving somewhere was
   * being read as succeeding.
   */
  it('gives arriving at a terminal no credit of its own', () => {
    const outcome = runOutcomeFrom({ ...settled, commands: [] });
    const said = describeRunOutcome(outcome, { commands: [] });
    assert.match(
      said,
      /DSpatch did not start a command of its own/,
      `a walk that ran no command has verified nothing. It said: ${said}`,
    );
    assert.equal(
      outcome,
      'verification-not-performed',
      'reaching a terminal is not evidence about the work',
    );
    assert.notEqual(outcome, 'work-verified');
  });

  it('calls a command that ran and exited 0 a pass, and one that exited 1 a failure', () => {
    const passedCommands = [command({ exitCode: 0 })];
    const passed = runOutcomeFrom({ ...settled, commands: passedCommands });
    const passedText = describeRunOutcome(passed, { commands: passedCommands });
    assert.match(
      passedText,
      /ran and exited 0/,
      `a command that exited 0 is the one thing DSpatch may call a pass. It said: ${passedText}`,
    );
    assert.equal(passed, 'work-verified');

    const failedCommands = [command({ exitCode: 1 })];
    const failed = runOutcomeFrom({ ...settled, commands: failedCommands });
    const said = describeRunOutcome(failed, { commands: failedCommands });
    assert.match(
      said,
      /ran to the end and exited 1/,
      `a command that exited 1 must be reported as your project failing. It said: ${said}`,
    );
    assert.match(said, /real result about your project/, 'and must not be hedged into unknown');
    assert.equal(failed, 'tests-failed');
  });

  /**
   * DSP-26 #1, at the level below the one it was first written for.
   *
   * The Verifier of run `20260917-204500-obs18` measured that the recorded outcome
   * and the sentence beside it — written into the *same* ending line of the *same*
   * record — were derived from different commands: `runOutcomeFrom` quantifies over
   * every command, `describeRunOutcome` read only the last. These three cases are
   * that table. The first assertion in each is the sentence, because the sentence is
   * what a person reads beside the badge.
   *
   * Not reachable on the single-gate graph shipped today. Reachable as soon as a
   * run records two commands, which is what DSP-22's editor, the replay cache's
   * `node:occurrence` key and DSP-29–DSP-33 all point towards.
   */
  describe('the outcome and the sentence beside it read the same command', () => {
    it('does not write "exited 0" beside a badge that says your command failed', () => {
      const commands = [
        command({ exitCode: 1, command: 'cmd.exe /d /s /c npm test' }),
        command({ exitCode: 0, command: 'cmd.exe /d /s /c echo retry' }),
      ];
      const outcome = runOutcomeFrom({ ...settled, commands });
      const said = describeRunOutcome(outcome, { commands });
      assert.doesNotMatch(
        said,
        /exited 0/,
        `the badge over this run says "${String(RUN_OUTCOME_BADGE_TEXT[outcome])}", so the ` +
          `sentence in the same ending line must not say the command exited 0. It said: ${said}`,
      );
      assert.match(said, /exited 1/, 'it must report the exit code the outcome was decided from');
      assert.match(said, /npm test/, 'and name the command that produced it');
      assert.equal(outcome, 'tests-failed');
    });

    it('keeps the shell\'s own reason when a later command exited 0', () => {
      const commands = [
        command({
          exitCode: 1,
          notRun: {
            kind: 'could-not-start',
            message: 'There is no program called "nmp" in C:/p or on this account\'s PATH.',
          },
        }),
        command({ exitCode: 0, command: 'cmd.exe /d /s /c echo retry' }),
      ];
      const outcome = runOutcomeFrom({ ...settled, commands });
      const said = describeRunOutcome(outcome, { commands });
      assert.doesNotMatch(
        said,
        /No reason was recorded/,
        `a reason was recorded, and the record's own ending line must not deny it. ` +
          `It said: ${said}`,
      );
      assert.match(said, /There is no program called "nmp"/, 'the reason, as it was given');
      assert.equal(outcome, 'command-could-not-start');
    });

    it('does not say no command was run while a command ran and failed', () => {
      const commands = [
        command({
          exitCode: null,
          notRun: { kind: 'no-command-configured', message: 'There is no command to run.' },
        }),
        command({ exitCode: 1, command: 'cmd.exe /d /s /c ctest' }),
      ];
      const outcome = runOutcomeFrom({ ...settled, commands });
      const said = describeRunOutcome(outcome, { commands });
      assert.doesNotMatch(
        said,
        /No command was run during this loop/,
        `a command was run during this loop and exited 1, so the ending line must not ` +
          `say none was. It said: ${said}`,
      );
      assert.match(said, /There is no command to run/, 'the gate\'s own reason, as recorded');
      assert.equal(outcome, 'verification-not-performed');
    });
  });

  /**
   * The sixth thing that can happen, which used to happen in silence.
   *
   * A gate command that never returns held the whole run open with no ending line
   * and no window — measured on a bare `.ps1` sitting on an invisible Windows file
   * chooser for 154 seconds. It is neither a pass nor a failure and it is not
   * "could not start" either: the process really started.
   */
  it('never calls a command it had to stop a pass or a failure', () => {
    const commands = [
      command({
        exitCode: null,
        notRun: {
          kind: 'did-not-finish',
          message:
            'The command was still running after 15 minutes, so DSpatch asked the operating ' +
            'system to stop it and the children it could find. Nothing is known about whether ' +
            'your project builds or its tests pass.',
        },
      }),
    ];
    const outcome = runOutcomeFrom({ ...settled, commands });
    const said = describeRunOutcome(outcome, { commands });
    assert.match(
      said,
      /still running after 15 minutes, so DSpatch asked the operating system to stop it/,
      `a command DSpatch had to stop must say so in the record's own ending line. ` +
        `It said: ${said}`,
    );
    assert.match(said, /not a pass and not a failure/, 'and must claim neither');
    assert.equal(outcome, 'unresolved');
    assert.notEqual(outcome, 'work-verified');
    assert.notEqual(outcome, 'tests-failed');
    assert.equal(
      RUN_OUTCOME_BADGE_TEXT[outcome],
      null,
      'and the badge defers to the ending\'s own phrase rather than inventing a word',
    );
  });

  it('leaves a cancelled, waiting or interrupted run unresolved rather than guessing', () => {
    const cancelled = runOutcomeFrom({
      commands: [command({ exitCode: 0 })],
      status: 'completed',
      cancelled: true,
      recordComplete: true,
    });
    assert.equal(cancelled, 'unresolved', 'a stopped run has no established outcome');
    assert.match(describeRunOutcome(cancelled, { commands: [] }), /not a pass and not a failure/);

    assert.equal(
      runOutcomeFrom({ commands: [], status: 'awaiting-human', cancelled: false, recordComplete: true }),
      'unresolved',
    );
    assert.equal(
      runOutcomeFrom({
        commands: [command({ exitCode: 0 })],
        status: 'completed',
        cancelled: false,
        recordComplete: false,
      }),
      'unresolved',
      'a record that stops before its ending says nothing about the outcome',
    );
  });
});

/**
 * DSP-44 #4 and DSP-48 #1: three endings that recorded one outcome and one paragraph.
 *
 * `runOutcomeFrom` reaches `verification-not-performed` whenever no command was
 * attempted, and three of the chat loop's five endings attempt none. All three
 * therefore read, word for word, *"DSpatch did not test the project … Anything the
 * agent changed is still in the working copy, unchecked."* For `stopped` that is
 * three wrong notes at once: the agent's refusal goes unmentioned, the changes
 * warned about do not exist, and *nothing was checked* frames a deliberate stop as a
 * gap in configuration.
 *
 * Counts cannot separate `stopped` from `nothing-changed` — both are zero and both
 * have empty command lists — so what is threaded is the terminal id. Additively, and
 * without a sixth `RunOutcomeKind`: DSP-26 is in Review awaiting Niclas and its
 * vocabulary must not move under him unasked.
 */
describe('which ending it was, in the sentence and never in the outcome', () => {
  const nothingToRun = [
    command({
      exitCode: null,
      notRun: {
        kind: 'no-command-configured' as const,
        message:
          'There is no command to run. Type the build or test command you would use in a terminal.',
      },
    }),
  ];

  function walk(parts: Partial<RunWalkEnding> = {}): RunWalkEnding {
    return { terminalNodeId: null, movedPaths: [], movedPathsNotListed: 0, ...parts };
  }

  it('gives the three not-checked endings three different sentences', () => {
    const said = new Map<string, string>();
    const cases: readonly (readonly [string, readonly RecordedCommand[], RunWalkEnding])[] = [
      [NOT_CHECKED_TERMINAL, nothingToRun, walk({
        terminalNodeId: NOT_CHECKED_TERMINAL,
        movedPaths: ['src/retry.cpp'],
      })],
      [NOTHING_CHANGED_TERMINAL, [], walk({ terminalNodeId: NOTHING_CHANGED_TERMINAL })],
      [STOPPED_TERMINAL, [], walk({ terminalNodeId: STOPPED_TERMINAL })],
    ];
    for (const [terminal, commands, ending] of cases) {
      const outcome = runOutcomeFrom({
        commands,
        status: 'completed',
        cancelled: false,
        recordComplete: true,
      });
      const sentence = describeRunOutcome(outcome, { commands, walk: ending });
      const previous = said.get(sentence);
      assert.equal(
        previous,
        undefined,
        `"${terminal}" and "${String(previous)}" must not read identically on screen`,
      );
      said.set(sentence, terminal);
      assert.match(
        sentence,
        /not a test failure|not a pass and not a failure/,
        `${terminal} must still deny a verdict. It said: ${sentence}`,
      );
    }
    assert.equal(said.size, 3);
  });

  /** `nothing-changed`: nothing is unchecked, so nothing may be described as unchecked. */
  it('does not warn about unchecked changes on a run that changed nothing', () => {
    const sentence = describeRunOutcome('verification-not-performed', {
      commands: [],
      walk: walk({ terminalNodeId: NOTHING_CHANGED_TERMINAL }),
    });
    assert.doesNotMatch(
      sentence,
      /still in the working copy, unchecked/,
      `there are no such changes on this run, and warning about them is the defect. ` +
        `It said: ${sentence}`,
    );
    // What it may say is the measurement; what it may not say is the conclusion. This
    // sentence used to claim "there was nothing to test" and that "nothing is left
    // unchecked", neither of which a file comparison establishes — a reading task, a
    // change the agent thought it had made, and a verification task all change nothing.
    // Niclas's decision of 19 September 2026; §5's rule against substituting "files
    // changed" for an assessment is what it rests on.
    assert.match(sentence, /no file changed, added or removed/);
    assert.match(sentence, /not a finding that nothing needed checking/);
    assert.doesNotMatch(sentence, /nothing to test/);
    assert.doesNotMatch(sentence, /whole result of this run/);
  });

  /**
 * An older record keeps its words; the conversation stops stating them as the finding.
 *
 * The two requirements pull in opposite directions and both are Niclas's: do not rewrite
 * what was written down, and do not present an old conclusion as a current fact. They
 * are met by drawing the column's line from the recorded *outcome* — structured data the
 * run really recorded — and leaving the stored sentence behind the disclosure, where a
 * record of what was believed at the time belongs.
 */
describe('a record written before the claim was corrected', () => {
  const storedClaim =
    'DSpatch did not test the project, and there was nothing to test: its own comparison ' +
    'of the project before the work step and after it found no file changed, added or removed.';

  const nothingChanged = (): string =>
    recordText({
      ending: ending({
        terminalNodeId: NOTHING_CHANGED_TERMINAL,
        outcome: 'verification-not-performed',
        outcomeText: storedClaim,
        commands: [],
      }),
    });

  it('states the measurement and not the old conclusion', () => {
    const turn = loopTurnsFromRecordText(nothingChanged())[0] ?? ({} as never);
    const line = loopTurnEndingLine(turn);
    assert.match(line.text, /No file changed/);
    assert.match(line.text, /not established/);
    assert.doesNotMatch(
      line.text,
      /nothing to test/,
      'the stored conclusion must not be what the conversation now asserts',
    );
  });

  it('keeps the stored sentence readable, unchanged, behind the disclosure', () => {
    const turn = loopTurnsFromRecordText(nothingChanged())[0] ?? ({} as never);
    assert.equal(loopTurnEndingLine(turn).hasMore, true, 'there is something to disclose');
    assert.match(
      loopTurnStatusText(turn),
      /there was nothing to test/,
      'the file\u2019s own words are still there to be read',
    );
  });
});

/** `stopped`: a deliberate refusal, not a project nobody configured a command for. */
  it('says the agent stopped rather than that nothing was configured', () => {
    const sentence = describeRunOutcome('verification-not-performed', {
      commands: [],
      walk: walk({ terminalNodeId: STOPPED_TERMINAL }),
    });
    assert.match(
      sentence,
      /the agent stopped instead of doing the work/,
      `the refusal is the reason this run ended and must be the first thing said. ` +
        `It said: ${sentence}`,
    );
    assert.match(sentence, /premise was wrong or that it was blocked/);
    assert.match(sentence, /its own reply is the account of why/);
    assert.doesNotMatch(
      sentence,
      /still in the working copy, unchecked/,
      'and must not warn about changes it also says were not made',
    );
    assert.match(sentence, /DSpatch measured no file as changed, added or removed/);
  });

  /**
   * A declared failure beats the measurement, so an agent can leave a file behind on
   * its way to declaring one. The sentence must name what moved rather than claim
   * nothing did.
   */
  it('names what moved when an agent wrote something before it stopped', () => {
    const sentence = describeRunOutcome('verification-not-performed', {
      commands: [],
      walk: walk({ terminalNodeId: STOPPED_TERMINAL, movedPaths: ['notes.md'] }),
    });
    assert.match(sentence, /notes\.md/);
    assert.doesNotMatch(sentence, /measured no file as changed/);
  });

  /**
   * DSP-48 #1, at the ending it matters most.
   *
   * `done` is the only ending that says something positive about the project, and it
   * is the ending a read-only mandate reached when a separate process appended a line
   * to `build/CMakeCache.txt` while the agent only read. Naming the path is what lets
   * a person recognise that without knowing it could happen.
   */
  it('writes a different sentence for each increment-1 ending that recorded no command', () => {
    const sentences = ['done', NOT_MET_TERMINAL, NOT_ESTABLISHED_TERMINAL].map((terminal) =>
      describeRunOutcome('verification-not-performed', {
        commands: [],
        walk: walk({ terminalNodeId: terminal }),
      }),
    );
    assert.match(sentences[0] ?? '', /checking step declared that the assignment was met/);
    assert.match(sentences[1] ?? '', /assignment was not met/);
    assert.match(sentences[2] ?? '', /could not establish whether the assignment was met/);
    assert.equal(new Set(sentences).size, 3);
  });

  it('names the files behind a passing run, and who else may have written them', () => {
    const ran = [command({ exitCode: 0 })];
    const outcome = runOutcomeFrom({
      commands: ran,
      status: 'completed',
      cancelled: false,
      recordComplete: true,
    });
    assert.equal(outcome, 'work-verified');
    const sentence = describeRunOutcome(outcome, {
      commands: ran,
      walk: walk({ terminalNodeId: 'done', movedPaths: ['build/CMakeCache.txt'] }),
    });
    assert.match(sentence, /ran and exited 0/, 'the command is still what earned the outcome');
    assert.match(sentence, /build\/CMakeCache\.txt/, 'and the run says which files moved');
    assert.match(sentence, /anything else that wrote there while the loop was working/);
  });

  /**
   * The second direction. The whole risk of threading a terminal id into the outcome
   * vocabulary is that arriving somewhere starts to earn something, which DSP-26 #3
   * forbids and which `runOutcomeFrom` is the single place that could allow.
   *
   * So: the same commands, every terminal the chat loop has, and one recorded value.
   */
  it('lets the terminal change the sentence and never the outcome', () => {
    for (const commands of [[], nothingToRun, [command({ exitCode: 0 })]]) {
      const without = runOutcomeFrom({
        commands,
        status: 'completed',
        cancelled: false,
        recordComplete: true,
      });
      for (const terminal of [
        NOT_CHECKED_TERMINAL,
        NOTHING_CHANGED_TERMINAL,
        STOPPED_TERMINAL,
        NOT_ESTABLISHED_TERMINAL,
        NOT_MET_TERMINAL,
        'done',
        'tests-failed',
        null,
      ]) {
        const withWalk = runOutcomeFrom({
          commands,
          status: 'completed',
          cancelled: false,
          recordComplete: true,
          walk: walk({ terminalNodeId: terminal, movedPaths: ['src/a.cpp'] }),
        });
        assert.equal(
          withWalk,
          without,
          `"${String(terminal)}" must not be able to earn an outcome by being arrived at`,
        );
      }
    }
  });

  /** And a caller that knows no walk reads exactly what it read before. */
  it('reads unchanged for a caller that passes no walk at all', () => {
    const sentence = describeRunOutcome('verification-not-performed', { commands: nothingToRun });
    assert.match(sentence, /DSpatch did not start a command of its own\. This run says nothing about/);
    assert.match(sentence, /Anything the agent changed is still in the working copy\./);
    assert.doesNotMatch(sentence, /The files DSpatch measured/);
    assert.equal(
      sentence,
      describeRunOutcome('verification-not-performed', { commands: nothingToRun, walk: null }),
      'an explicit null must read the same as an absent field',
    );
  });
});

/**
 * What a restored run says about silence and about why control moved.
 *
 * Both facts have always been on disk and nothing was reading either: a recorded
 * reply with empty text, and the runner's `edge-taken` entries. So these are not
 * a record-format change — they are the same files, read further — which is what
 * makes them work for every run ever written.
 */
describe('a restored run reads silence and branches off its own record', () => {
  /** A record whose checking step finished its turn and wrote nothing. */
  function withSilentCheck(): string {
    return [
      serialiseRecordLine({ line: 'header', formatVersion: LOOP_RUN_RECORD_VERSION, identity }),
      serialiseRecordLine({
        line: 'journal',
        entry: journalEntry(1, 'run-started', 'Run of graph "dspatch-chat-loop".'),
      }),
      serialiseRecordLine({
        line: 'journal',
        entry: {
          ...journalEntry(2, 'edge-taken', 'Took edge "e-succeeded".'),
          edgeId: 'e-succeeded',
          data: { from: 'implementer', to: 'check', outcome: 'succeeded' },
        },
      }),
      serialiseRecordLine({
        line: 'agent-reply',
        reply: {
          atUtc: '2026-09-17T21:00:40.000Z',
          nodeId: 'implementer',
          nodeLabel: 'Do the requested work',
          occurrence: 1,
          text: 'I edited src/window.ts and added the missing field.',
          terminalStatus: 'completed',
        },
      }),
      serialiseRecordLine({
        line: 'agent-reply',
        reply: {
          atUtc: '2026-09-17T21:01:40.000Z',
          nodeId: 'check',
          nodeLabel: 'Check the work',
          occurrence: 1,
          text: '   \n',
          terminalStatus: 'completed',
        },
      }),
      serialiseRecordLine({ line: 'ending', ending: ending() }),
    ].join('');
  }

  it('does not show a silent step as an empty answer, and does say it went silent', () => {
    const turn = loopTurnsFromRecordText(withSilentCheck())[0];
    assert.equal(turn?.replies.length, 1, 'only the step that actually said something');
    assert.deepEqual(turn?.silentSteps, [
      { nodeId: 'check', nodeLabel: 'Check the work', occurrence: 1 },
    ]);
    assert.match(
      loopTurnStatusText(turn ?? ({} as never)),
      /said nothing at all: “Check the work”/,
      'a run that reached a terminal over a silent step must not read like one where every step spoke',
    );
  });

  it('recovers why control moved from the runner\u2019s own edge entries', () => {
    const turn = loopTurnsFromRecordText(withSilentCheck())[0];
    assert.deepEqual(turn?.branches, [
      { fromNodeId: 'implementer', toNodeId: 'check', label: 'succeeded' },
    ]);
  });

  /**
   * The negative control for both. A record with no `edge-taken` entry and no
   * empty reply — which is every record the fixture above is built from — must
   * produce neither, or the two assertions are reading something else.
   */
  it('negative control: an ordinary record produces no silent steps and no branches', () => {
    const turn = loopTurnsFromRecordText(recordText())[0];
    assert.deepEqual(turn?.silentSteps, []);
    assert.deepEqual(turn?.branches, []);
    assert.doesNotMatch(loopTurnStatusText(turn ?? ({} as never)), /said nothing at all/);
  });
});

/**
 * DSP-26 #1: one run, one decision. The badge reads what the record says rather
 * than deriving its own answer, so the colour and the sentence cannot disagree.
 */
describe('the badge over a restored run', () => {
  it('draws a verified run positively and a failed command negatively', () => {
    const verified = loopTurnsFromRecordText(recordText())[0];
    assert.equal(
      loopTurnBadgeText(verified ?? ({} as never)),
      'a started command passed',
      'the badge over a restored run must say what was established, not that the walk ended',
    );
    assert.equal(
      loopTurnBadge(verified ?? ({} as never)),
      'supported',
      'and a command that passed is the one case that may be drawn positively',
    );

    const failedCommands = [command({ exitCode: 1 })];
    const failed = loopTurnsFromRecordText(
      recordText({
        ending: ending({
          terminalNodeId: 'failed',
          outcome: 'tests-failed',
          outcomeText: describeRunOutcome('tests-failed', { commands: failedCommands }),
          commands: failedCommands,
        }),
      }),
    )[0];
    assert.equal(
      loopTurnBadgeText(failed ?? ({} as never)),
      'a started command failed',
      'and a run whose command failed must say so on the badge',
    );
    assert.equal(
      loopTurnBadge(failed ?? ({} as never)),
      'unsupported',
      'and must not be drawn green for having reached a terminal',
    );
  });

  /**
   * The exact shape of the defect Niclas met, rebuilt from a record: the walk
   * reached a terminal and the gate tested nothing. The badge must not read the
   * walk while the sentence reads the gate.
   */
  it('does not draw a run that reached a terminal without testing anything as a pass', () => {
    const untested = [
      command({
        exitCode: null,
        notRun: { kind: 'no-command-configured', message: 'There is no command to run.' },
      }),
    ];
    const turn = loopTurnsFromRecordText(
      recordText({
        ending: ending({
          status: 'runtime-fault',
          terminalNodeId: null,
          outcome: 'verification-not-performed',
          outcomeText: describeRunOutcome('verification-not-performed', { commands: untested }),
          commands: untested,
        }),
      }),
    )[0];
    const badge = loopTurnBadgeText(turn ?? ({} as never));
    // This run reached no terminal, so the badge is the ending's own phrase. DSP-55:
    // it must not be the old `nothing was checked`, which was a statement about what
    // DSpatch spawned rather than about whether the project was checked, and which
    // read identically over a run whose agent had checked the project thoroughly.
    assert.equal(
      badge,
      'could not finish',
      `the badge must name the ending this run actually had. It said: ${badge}`,
    );
    assert.doesNotMatch(badge, /nothing was checked/);
    assert.notEqual(loopTurnBadge(turn ?? ({} as never)), 'supported');
    assert.match(loopTurnStatusText(turn ?? ({} as never)), /not a test failure/);
  });

  /**
   * And a run read back off disk is badged by its terminal's label, not its node id.
   *
   * The label reaches the badge from the journal the record already keeps, which is
   * what let DSP-55 be fixed without a record-format field — every run ever written
   * has these entries, because `main.ts` writes each of the runner's own journal
   * entries as it arrives. Worth measuring rather than reasoning about: if the
   * terminal's entry were ever dropped from the record, the badge would quietly go
   * back to naming endings by identifier, and every restored run would still read
   * plausibly.
   */
  it('names a restored run by the terminal label the record kept', () => {
    const untested = [
      command({
        exitCode: null,
        notRun: { kind: 'no-command-configured', message: 'There is no command to run.' },
      }),
    ];
    const turn = loopTurnsFromRecordText(
      recordText({
        journal: [
          {
            ...journalEntry(2, 'node-entered', 'Reached terminal "done" (Assignment met).'),
            nodeId: 'done',
            data: { kind: 'terminal', occurrence: 1, label: 'Assignment met' },
          },
        ],
        ending: ending({
          terminalNodeId: 'done',
          outcome: 'verification-not-performed',
          outcomeText: describeRunOutcome('verification-not-performed', { commands: untested }),
          commands: untested,
        }),
      }),
    )[0];
    assert.equal(loopTurnBadgeText(turn ?? ({} as never)), 'reached “Assignment met”');
    assert.notEqual(loopTurnBadge(turn ?? ({} as never)), 'supported');
  });
});
