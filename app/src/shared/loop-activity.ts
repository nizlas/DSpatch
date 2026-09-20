/**
 * What a loop step is doing, while it is doing it.
 *
 * Before this module a loop step was an opaque call. `waitForTurn` in
 * `main/loop-live.ts` subscribed to the adapter and handled three event types —
 * `assistant.message`, `usage`, `run.finished` — so the only thing that ever left a
 * step was one finished message, forwarded once, minutes later. The direct chat path
 * streamed the whole time, because `chat-service.ts` handles the delta events. The
 * events were always there; nothing downstream was listening.
 *
 * Four rules, and they are the reason this is a module rather than a few fields.
 *
 * **Nothing here invents activity.** Every sentence is built from a provider event
 * that arrived, and the one thing DSpatch says on its own behalf is that it is
 * waiting — see {@link ACTIVITY_WAIT_LEAD}. Silence is reported as silence. A
 * product whose claim is that work is traceable to real code may not narrate work it
 * did not see.
 *
 * **Commentary and activity, not private reasoning.** `reasoning.delta` carries the
 * model's thinking and is deliberately not carried here. What a person sees is the
 * reply text the agent is writing and the tool calls it is making.
 *
 * **Confirmed, waiting and unknown are three different answers.** {@link stepStanding}
 * returns which one a step is in, and the difference is whether an event has arrived,
 * whether one is expected, and whether anyone is still listening. Time alone proves
 * neither progress nor failure, so the waiting line states the interval and claims
 * nothing about it.
 *
 * **The envelope is normalised; the payload is not.** The adapter keeps only a call
 * id, a name and a status, and attaches the whole unmodified provider message as
 * `rawProviderEvent`. {@link describeToolActivity} reads that raw message here, which
 * is where a reading of a provider's own schema belongs — downstream of the adapter,
 * so the adapter keeps a stable contract and a provider's field names never reach it.
 */

/**
 * One thing that happened inside a step, addressed to the step it happened in.
 *
 * Addressed rather than merely ordered, for the same reason a run event is: a window
 * can be opened halfway through, a node can be entered twice, and an event still in
 * flight from a step that has ended must not land on the step that follows it.
 */
export interface StepAddress {
  readonly runId: string;
  readonly nodeId: string;
  /** 1-based visit count, so a re-entered node is a separate step. */
  readonly occurrence: number;
}

export type StepActivity = StepAddress & {
  readonly atUtc: string;
} & (
    | {
        /** The step has been handed its prompt and the provider turn has begun. */
        readonly kind: 'step-started';
        /** The role the drawing named, or `null` for a node that names none. */
        readonly roleId: string | null;
        readonly roleSourcePath: string | null;
      }
    | {
        /** A fragment of the agent's reply, as it is written. Append, never replace. */
        readonly kind: 'reply-text';
        readonly text: string;
      }
    | {
        readonly kind: 'tool-started';
        readonly callId: string;
        readonly name: string;
        /** One readable line. Never the raw arguments. */
        readonly summary: string;
      }
    | {
        readonly kind: 'tool-finished';
        readonly callId: string;
        readonly name: string;
        readonly status: 'ok' | 'error';
        readonly summary: string;
        /**
         * What the call produced, when the provider reported something readable, or
         * `null` when it did not. Never a stand-in for a missing result.
         */
        readonly detail: string | null;
      }
    | {
        /** The provider reported that it is waiting on a person. */
        readonly kind: 'awaiting-approval';
        readonly summary: string;
      }
  );

/** One tool call as the step's activity remembers it. */
export interface StepToolCall {
  readonly callId: string;
  readonly name: string;
  readonly summary: string;
  readonly startedAtUtc: string;
  /** `null` while the call is still running. */
  readonly status: 'ok' | 'error' | null;
  readonly finishedAtUtc: string | null;
  readonly detail: string | null;
}

/**
 * Everything observed about one step, in the order it arrived.
 *
 * `finished` is set by the caller when the step's reply lands, and it is what stops
 * a finished step from going on reporting that it is waiting. It is not derived from
 * a timer: a step with no events for ten minutes is a step with no events for ten
 * minutes, which is a different statement from a step that has ended.
 */
export interface StepActivityState extends StepAddress {
  readonly roleId: string | null;
  readonly roleSourcePath: string | null;
  readonly startedAtUtc: string;
  /** When the last provider event for this step arrived, or `null` if none has. */
  readonly lastEventAtUtc: string | null;
  /** The reply as it is being written. Empty until the first fragment arrives. */
  readonly text: string;
  readonly tools: readonly StepToolCall[];
  /** The provider's own words about what it is waiting for, or `null`. */
  readonly awaitingApproval: string | null;
  readonly finished: boolean;
}

/**
 * The only sentence in this file DSpatch writes about a run rather than forwarding.
 *
 * Exported so a test can assert the exhaustive list rather than a substring, the same
 * discipline `ACTIVITY_OWN_SENTENCES` uses in `chat-workspace.ts`. It is a statement
 * about what DSpatch has heard, not about what an agent is doing.
 */
export const ACTIVITY_WAIT_LEAD = 'Waiting for agent activity';

/**
 * Fold one activity event into the steps observed so far.
 *
 * Returns the **same array** when the event is not about a step this list is
 * following and cannot open one, so a stale event is not merely invisible: it
 * literally does not change what the caller holds, which a React setter can skip
 * re-rendering on and a test can assert directly.
 *
 * Only `step-started` opens a step. Anything else for an unknown step is dropped
 * rather than inventing a step from the fragment that arrived first — an invented
 * step would have no role, no start time and no claim to either.
 */
export function foldStepActivity(
  steps: readonly StepActivityState[],
  activity: StepActivity,
): readonly StepActivityState[] {
  const index = steps.findIndex(
    (step) =>
      step.runId === activity.runId &&
      step.nodeId === activity.nodeId &&
      step.occurrence === activity.occurrence,
  );

  if (activity.kind === 'step-started') {
    if (index !== -1) {
      // A second `step-started` for a step already open. The first one's start time
      // is the one that is true, so nothing is overwritten.
      return steps;
    }
    return [
      ...steps,
      {
        runId: activity.runId,
        nodeId: activity.nodeId,
        occurrence: activity.occurrence,
        roleId: activity.roleId,
        roleSourcePath: activity.roleSourcePath,
        startedAtUtc: activity.atUtc,
        lastEventAtUtc: null,
        text: '',
        tools: [],
        awaitingApproval: null,
        finished: false,
      },
    ];
  }

  if (index === -1) {
    return steps;
  }
  const step = steps[index] as StepActivityState;
  const replace = (next: StepActivityState): readonly StepActivityState[] =>
    steps.map((existing, at) => (at === index ? next : existing));
  const heard = { ...step, lastEventAtUtc: activity.atUtc };

  switch (activity.kind) {
    case 'reply-text':
      return replace({ ...heard, text: `${step.text}${activity.text}` });
    case 'tool-started':
      return replace({
        ...heard,
        tools: [
          ...step.tools,
          {
            callId: activity.callId,
            name: activity.name,
            summary: activity.summary,
            startedAtUtc: activity.atUtc,
            status: null,
            finishedAtUtc: null,
            detail: null,
          },
        ],
      });
    case 'tool-finished': {
      const at = step.tools.findIndex((call) => call.callId === activity.callId);
      const finished: StepToolCall = {
        callId: activity.callId,
        name: activity.name,
        // The completion's summary carries the result, so it replaces the start's.
        summary: activity.summary,
        startedAtUtc: at === -1 ? activity.atUtc : (step.tools[at]?.startedAtUtc ?? activity.atUtc),
        status: activity.status,
        finishedAtUtc: activity.atUtc,
        detail: activity.detail,
      };
      return replace({
        ...heard,
        tools:
          at === -1
            ? [...step.tools, finished]
            : step.tools.map((call, position) => (position === at ? finished : call)),
      });
    }
    case 'awaiting-approval':
      return replace({ ...heard, awaitingApproval: activity.summary });
  }
}

/** Mark the step of this node occurrence finished, once its reply has landed. */
export function finishStep(
  steps: readonly StepActivityState[],
  address: StepAddress,
): readonly StepActivityState[] {
  let changed = false;
  const next = steps.map((step) => {
    if (
      step.runId !== address.runId ||
      step.nodeId !== address.nodeId ||
      step.occurrence !== address.occurrence ||
      step.finished
    ) {
      return step;
    }
    changed = true;
    return { ...step, finished: true };
  });
  return changed ? next : steps;
}

/**
 * Close whichever step of this node is still open in this run.
 *
 * For a reader who has the run's journal but not its replies — the graph view. A node
 * that has produced its result is a node that has stopped working, and a status line
 * still saying *writing a reply* under a step the journal has already closed would be
 * this module forming a second opinion about the run. Earlier occurrences of the same
 * node are already closed, so "the open one" is exact rather than approximate.
 */
export function finishStepsForNode(
  steps: readonly StepActivityState[],
  runId: string,
  nodeId: string,
): readonly StepActivityState[] {
  let changed = false;
  const next = steps.map((step) => {
    if (step.runId !== runId || step.nodeId !== nodeId || step.finished) {
      return step;
    }
    changed = true;
    return { ...step, finished: true };
  });
  return changed ? next : steps;
}

/** The step still running in this run, or `null` when none is. */
export function runningStep(
  steps: readonly StepActivityState[],
  runId: string,
): StepActivityState | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step !== undefined && step.runId === runId && !step.finished) {
      return step;
    }
  }
  return null;
}

/**
 * Which of the three answers a step is in.
 *
 * `confirmed` means a provider event for this step arrived and is recent. `waiting`
 * means the step is open and nothing has come for a while — which is a fact about
 * DSpatch's own listening, not a diagnosis of the agent. `unknown` means nobody is
 * listening for this step any more, so no statement about it can be made at all.
 */
export type StepStanding = 'confirmed' | 'waiting' | 'unknown';

/**
 * How long a step may go quiet before the line stops saying *working* and starts
 * saying *waiting*.
 *
 * Twelve seconds because that is roughly where a person stops reading a static line
 * as progress, and because the first reply on a real chat-loop step has been measured
 * in minutes: a threshold shorter than a thinking pause would flicker, and one longer
 * than a coffee-length silence would be the opaque wait this work exists to remove.
 * The number decides wording only. Nothing branches on it.
 */
export const ACTIVITY_QUIET_MS = 12_000;

export interface StepStandingReport {
  readonly standing: StepStanding;
  /** One short line. Never a paragraph, and never a defence of the wait. */
  readonly text: string;
  /**
   * Whether an animation may be shown as evidence that work is happening.
   *
   * True only for `confirmed`. §9 forbids presenting a running animation as proof of
   * activity when activity is not known, which is enforceable only if "we do not
   * know" is a value a component reads rather than a rule it remembers.
   */
  readonly activityIsKnown: boolean;
}

export function stepStanding(input: {
  readonly step: StepActivityState | null;
  /** Whether the window is still receiving this run's events. */
  readonly stillWatching: boolean;
  readonly nowMs: number;
}): StepStandingReport {
  if (!input.stillWatching) {
    return {
      standing: 'unknown',
      activityIsKnown: false,
      text: 'Unknown — DSpatch is no longer following this run.',
    };
  }
  const step = input.step;
  if (step === null) {
    return {
      standing: 'waiting',
      activityIsKnown: false,
      // Not "no step has started yet": the run may be between steps, or running a
      // gate command, and "yet" would say the run had not begun. What is true in all
      // three cases is that no agent step is open for activity to arrive from.
      text: `${ACTIVITY_WAIT_LEAD} — no agent step is running.`,
    };
  }
  if (step.awaitingApproval !== null) {
    return {
      standing: 'confirmed',
      activityIsKnown: false,
      text: `Waiting for you — ${step.awaitingApproval}`,
    };
  }
  const since = step.lastEventAtUtc ?? step.startedAtUtc;
  const elapsed = elapsedMs(since, input.nowMs);
  if (step.lastEventAtUtc === null) {
    return {
      standing: 'waiting',
      activityIsKnown: false,
      text:
        elapsed === null
          ? `${ACTIVITY_WAIT_LEAD} — nothing has come back yet.`
          : `${ACTIVITY_WAIT_LEAD} — nothing has come back yet, started ${describeAgo(elapsed)}.`,
    };
  }
  if (elapsed !== null && elapsed >= ACTIVITY_QUIET_MS) {
    return {
      standing: 'waiting',
      activityIsKnown: false,
      text: `${ACTIVITY_WAIT_LEAD} — last update ${describeAgo(elapsed)}.`,
    };
  }
  const running = step.tools.find((call) => call.status === null);
  return {
    standing: 'confirmed',
    activityIsKnown: true,
    text: running === undefined ? 'Working — writing a reply.' : `Working — ${running.summary}`,
  };
}

function elapsedMs(atUtc: string, nowMs: number): number | null {
  const at = Date.parse(atUtc);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, nowMs - at);
}

/**
 * How long ago, in the largest unit that does not round the number away.
 *
 * "0 minutes ago" is a sentence saying no time has passed, which under a line whose
 * whole job is to say how long the silence has lasted would be the opposite of
 * informative. `describeBound` in `loop-live.ts` declines the same rounding for the
 * same reason; this is the past-tense form and is deliberately not shared with it,
 * because a bound and an interval read differently in a sentence.
 */
export function describeAgo(ms: number): string {
  if (ms < 5_000) {
    return 'just now';
  }
  if (ms < 60_000) {
    return `${String(Math.round(ms / 1000))} sec ago`;
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${String(minutes)} min ago`;
  }
  const hours = Math.floor(ms / 3_600_000);
  return `${String(hours)} h ago`;
}

/* ------------------------------------------------------------------------- */
/* Reading a provider's own tool message                                      */
/* ------------------------------------------------------------------------- */

export interface ToolDescription {
  readonly summary: string;
  readonly detail: string | null;
}

/**
 * What a tool call was, in a line a person reads.
 *
 * Built from the raw provider message the adapter attached, against the shapes
 * measured on this account on 19 September 2026 (`20260919-012200-agency`, report
 * 002). Tool names there are lowercase — `shell`, `edit`, `read` — `args` was present
 * on all twelve `tool_call` messages, and a completed `shell` carried
 * `result.value.exitCode`, `stdout`, `stderr` and `executionTime`.
 *
 * **Three things are deliberately not claimed.**
 *
 * *That an empty output means no output.* The same report measured a two-megabyte
 * stdout arriving as `""` with `truncated: null` — the field whose entire purpose is
 * to disclose that stayed null at four hundred times the size that worked. So an
 * empty stdout is reported as *no output was reported*, never as *it printed nothing*.
 *
 * *A working directory.* `workingDirectory` was never sent. The session's directory is
 * knowable, but it is not per-call evidence and is not presented as if it were.
 *
 * *Anything about an unrecognised tool beyond its name.* A shape nobody has measured
 * gets the tool's own name and no invented description of what it did.
 */
export function describeToolActivity(
  name: string,
  status: 'started' | 'ok' | 'error',
  rawProviderEvent: unknown,
): ToolDescription {
  const raw = asRecord(rawProviderEvent);
  const args = asRecord(raw?.['args']);
  const value = asRecord(asRecord(raw?.['result'])?.['value']);
  const verb = status === 'started' ? 'running' : 'ran';

  if (name === 'shell') {
    const command = asString(args?.['command']);
    const line = command === null ? 'a shell command' : `\`${clip(command, 90)}\``;
    if (status === 'started') {
      return { summary: `running ${line}`, detail: null };
    }
    const exitCode = asNumber(value?.['exitCode']);
    const took = asNumber(value?.['executionTime']);
    const outcome =
      exitCode === null
        ? status === 'error'
          ? 'and DSpatch was told it failed, without an exit code'
          : 'and reported no exit code'
        : `and exited ${String(exitCode)}`;
    return {
      summary: `${verb} ${line} ${outcome}${took === null ? '' : ` in ${formatSeconds(took)}`}`,
      detail: describeCommandOutput(value, took),
    };
  }

  const path =
    asString(args?.['path']) ?? asString(args?.['file_path']) ?? asString(args?.['target_file']);
  const shortPath = path === null ? null : clip(baseName(path), 60);

  if (name === 'edit' || name === 'write' || name === 'create') {
    const what = shortPath === null ? 'a file' : `\`${shortPath}\``;
    if (status === 'started') {
      return { summary: `editing ${what}`, detail: null };
    }
    const added = asNumber(value?.['linesAdded']);
    const removed = asNumber(value?.['linesRemoved']);
    const counted =
      added === null || removed === null ? '' : ` (+${String(added)} \u2212${String(removed)})`;
    const diff = asString(value?.['diffString']);
    return {
      summary: `edited ${what}${counted}`,
      detail: diff === null ? null : clipBlock(diff, 4_000),
    };
  }

  if (name === 'read') {
    const what = shortPath === null ? 'a file' : `\`${shortPath}\``;
    return { summary: status === 'started' ? `reading ${what}` : `read ${what}`, detail: null };
  }

  // A tool nobody has measured. Its name and its state, and nothing invented about
  // what it did — which is still more than the opaque wait this replaces.
  const named = clip(name, 40);
  const where = shortPath === null ? '' : ` on \`${shortPath}\``;
  if (status === 'started') {
    return { summary: `running \`${named}\`${where}`, detail: null };
  }
  return {
    summary: `${status === 'error' ? 'failed' : 'finished'} \`${named}\`${where}`,
    detail: null,
  };
}

/**
 * What a finished command printed, or the honest statement that nothing was reported.
 *
 * The distinction is the one the 19 September probe made expensive to ignore: a C++
 * build that fails with two megabytes on stdout arrives here as `stdout: ""`, and a
 * line saying *it printed nothing* would be a fabrication presented as a measurement.
 * So this says what DSpatch was told, and where it was told nothing, it says that it
 * was told nothing.
 */
function describeCommandOutput(
  value: Record<string, unknown> | null,
  executionTimeMs: number | null,
): string | null {
  if (value === null) {
    return null;
  }
  const stdout = asString(value['stdout']) ?? '';
  const stderr = asString(value['stderr']) ?? '';
  if (stdout === '' && stderr === '') {
    return (
      'No output was reported' +
      (executionTimeMs === null || executionTimeMs < 1000
        ? '.'
        : ` for a command that ran for ${formatSeconds(executionTimeMs)}.`) +
      ' That is what the provider sent, and it is not the same as the command having ' +
      'printed nothing: large output has been measured arriving here empty with the ' +
      'field that would disclose it left null.'
    );
  }
  return [
    stdout === '' ? '' : clipBlock(stdout, 4_000),
    stderr === '' ? '' : `stderr:\n${clipBlock(stderr, 2_000)}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function formatSeconds(ms: number): string {
  if (ms < 1000) {
    return `${String(Math.round(ms))} ms`;
  }
  return `${String(Math.round((ms / 1000) * 10) / 10)} s`;
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? filePath;
}

/** One line, short enough to sit in a status row. */
function clip(text: string, limit: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}\u2026`;
}

/**
 * The same bound, with the line breaks kept.
 *
 * A diff and a build log are read as blocks, and collapsing their whitespace would
 * turn the one piece of evidence a reader came for into a paragraph.
 */
function clipBlock(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n\u2026 truncated by DSpatch at ${String(limit)} characters.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
