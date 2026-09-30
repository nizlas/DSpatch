/**
 * The chat window as a workspace rather than a debug view.
 *
 * DSP-27 is about attention. What a person needs continuously is small — which
 * project, which agent, whether the connection is up, what is happening right now
 * — and what they need occasionally is large: session identifiers, full paths,
 * context statistics, the explanation of how the adapter works. Today both are on
 * screen permanently at the same weight.
 *
 * The rules for deciding which is which live here rather than inside the
 * components, for one reason: a rule living only inside a React component cannot
 * be tested at all in this repository, and "important problems stay visible" is
 * exactly the kind of rule that decays silently. Nothing here restyles anything.
 * There are no colours in this file — only which strings belong where.
 *
 * **This module derives no outcome.** It never asks whether a run succeeded and it
 * never reads a run record. `runOutcomeFrom` decides that, once, and the badge and
 * the sentence beside it both read that decision. A presentation module is exactly
 * where a second derivation gets reintroduced, so this one takes every verdict as
 * an argument and computes none.
 */

/** A fact that belongs behind the expander: interesting occasionally, never urgent. */
export interface HeaderFact {
  readonly label: string;
  readonly value: string;
}

/**
 * Something bad that must be readable without expanding anything.
 *
 * `severity` is `'bad'` for something that has definitely gone wrong and
 * `'unknown'` for something whose outcome nobody established — the distinction the
 * rest of the product already makes, carried here so the header cannot flatten an
 * unresolved attempt into a failure or vice versa.
 */
export interface HeaderProblem {
  readonly id: string;
  readonly text: string;
  readonly severity: 'bad' | 'unknown';
}

/** What the top of the window says, split into what is always on screen and what is not. */
export interface ChatHeaderView {
  /** The project's name. Never its path: the path is a detail. */
  readonly project: string;
  /** The agent or model actually in play, in as few words as it can be said. */
  readonly agent: string;
  /** The connection in one word, for the badge that is already there. */
  readonly connection: string;
  /** What is happening right now, in one line. */
  readonly activity: string;
  /** Directly visible, unexpanded, always. */
  readonly problems: readonly HeaderProblem[];
  /** Behind the expander. */
  readonly details: readonly HeaderFact[];
}

export interface HeaderProject {
  readonly name: string;
  readonly fullPath: string;
  /** DSpatch's own session id. A detail: it identifies a session, not a project. */
  readonly dspatchSessionId: string | null;
  /** The provider's session id, when it gave one. Also a detail. */
  readonly providerSessionId: string | null;
  readonly gitSummary: string | null;
  readonly dirtySummary: string | null;
}

export interface HeaderConnection {
  /** `connected`, `checking`, `not-connected` or `error`, as the bridge reports it. */
  readonly kind: string;
  /** The model DSpatch asked for, or null when there is no session to ask for one. */
  readonly modelRequested: string | null;
  readonly account: string | null;
  /** Non-null only when the connection is not usable; the reason, in the provider's words. */
  readonly problem: string | null;
}

export interface HeaderContext {
  readonly promptsSent: number;
  readonly promptCharactersSent: number;
  readonly fileContentsSentByDspatch: number;
  readonly toolCallsByAgent: number;
  readonly toolNames: readonly string[];
}

export interface ChatHeaderInput {
  readonly project: HeaderProject | null;
  readonly connection: HeaderConnection;
  /** Already written by `describeActivity` from real events. Passed through whole. */
  readonly activityText: string;
  /** Earlier runs that never reported an end. A problem, not a statistic. */
  readonly unresolvedRuns: number;
  /** Attempts whose outcome nobody established, by id. A problem. */
  readonly unresolvedAttempts: readonly string[];
  /** A refusal the user has to see: the send that was turned down, in its own words. */
  readonly refusal: string | null;
  /** A save or a write that did not happen. A problem, and easy to lose in a detail view. */
  readonly saveFailure: string | null;
  readonly context: HeaderContext;
  /**
   * How the adapter works, in the technical terms that belong to whoever is
   * debugging DSpatch. Always a detail, however well written it is.
   */
  readonly adapterNote: string | null;
}

/**
 * The problems that must survive the compression.
 *
 * The test of a good cut is whether a person who never opens the detail view can
 * still be surprised by something bad. So this is deliberately not "errors": a
 * refusal is not an error, an unresolved attempt is not a failure, and a save that
 * did not happen may have reported no error at all. Each of them is still
 * something the person doing the work has to know without going looking.
 */
export function headerProblems(input: ChatHeaderInput): readonly HeaderProblem[] {
  const problems: HeaderProblem[] = [];
  if (input.connection.problem !== null) {
    problems.push({
      id: 'connection-problem',
      text: input.connection.problem,
      severity: 'bad',
    });
  }
  if (input.refusal !== null) {
    problems.push({ id: 'refusal', text: input.refusal, severity: 'bad' });
  }
  if (input.saveFailure !== null) {
    problems.push({ id: 'save-failure', text: input.saveFailure, severity: 'bad' });
  }
  if (input.unresolvedAttempts.length > 0) {
    problems.push({
      id: 'unresolved-attempts',
      // Named, not counted. Report 006 measured a restart where two attempts were
      // unknown, one was named and the other stayed unseen behind a number.
      text:
        `${input.unresolvedAttempts.length === 1 ? 'An earlier attempt has' : `${String(input.unresolvedAttempts.length)} earlier attempts have`} ` +
        `no known outcome (${input.unresolvedAttempts.join(', ')}), so DSpatch will not send another ` +
        'message by itself.',
      severity: 'unknown',
    });
  }
  if (input.unresolvedRuns > 0) {
    problems.push({
      id: 'unresolved-runs',
      text:
        `${String(input.unresolvedRuns)} earlier run${input.unresolvedRuns === 1 ? '' : 's'} never reported an end. ` +
        'DSpatch is no longer applying their events and cannot tell whether anything is still running.',
      severity: 'unknown',
    });
  }
  return problems;
}

/**
 * The compressed top of the window, and everything it moved out of the way.
 *
 * Four things stay: project, agent, connection, activity. Everything else becomes
 * a labelled fact behind an expander — and the problems above stay out in front of
 * it regardless of how many of them there are.
 */
export function chatHeaderView(input: ChatHeaderInput): ChatHeaderView {
  const details: HeaderFact[] = [];
  if (input.project !== null) {
    details.push({ label: 'Project folder', value: input.project.fullPath });
    if (input.project.dspatchSessionId !== null) {
      details.push({ label: 'DSpatch session', value: input.project.dspatchSessionId });
    }
    if (input.project.providerSessionId !== null) {
      details.push({ label: 'Provider session', value: input.project.providerSessionId });
    }
    if (input.project.gitSummary !== null) {
      details.push({ label: 'Revision', value: input.project.gitSummary });
    }
    if (input.project.dirtySummary !== null) {
      details.push({ label: 'Already modified', value: input.project.dirtySummary });
    }
  }
  if (input.connection.account !== null) {
    details.push({ label: 'Account', value: input.connection.account });
  }
  if (input.project !== null) {
    details.push({
      label: 'Context DSpatch sent',
      value:
        input.context.promptsSent === 0
          ? 'the folder path and the model name — no message yet'
          : `${String(input.context.promptsSent)} message${input.context.promptsSent === 1 ? '' : 's'}, ` +
            `${String(input.context.promptCharactersSent)} characters`,
    });
    details.push({
      label: 'Files sent by DSpatch',
      value:
        `${String(input.context.fileContentsSentByDspatch)} — opening a folder does not send it`,
    });
    details.push({
      label: 'The agent\u2019s own tool calls',
      value:
        input.context.toolCallsByAgent === 0
          ? 'none yet, so it has read nothing itself'
          : `${String(input.context.toolCallsByAgent)}${
              input.context.toolNames.length === 0
                ? ''
                : ` (${input.context.toolNames.join(', ')})`
            } — DSpatch sees the tool name, not the file`,
    });
  }
  if (input.adapterNote !== null) {
    details.push({ label: 'How this is wired', value: input.adapterNote });
  }
  return {
    project: input.project?.name ?? 'No project open',
    agent: input.connection.modelRequested ?? 'no model requested yet',
    connection: input.connection.kind,
    activity: input.activityText,
    problems: headerProblems(input),
    details,
  };
}

/**
 * Every string the compressed header puts on screen, for the assertion that keeps
 * it compressed: a path or a session id appearing in any of these has leaked back
 * out of the detail view.
 */
export function headerSummaryStrings(view: ChatHeaderView): readonly string[] {
  return [view.project, view.agent, view.connection, view.activity];
}

/**
 * What a keypress in the composer means.
 *
 * `'insert-break'` is not "do nothing": it means leave the key to the textarea,
 * which is what puts the line break in. `'ignore'` means swallow it — the caller
 * prevents the default and nothing happens.
 */
export type ComposerKeyAction = 'send' | 'insert-break' | 'ignore';

export interface ComposerKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /**
   * An IME composition is in progress.
   *
   * Enter ends the composition and must never send: someone typing Japanese would
   * lose the word they were in the middle of choosing. The textarea gets the key.
   */
  readonly composing: boolean;
}

/**
 * Enter sends, Shift+Enter breaks the line.
 *
 * Ctrl+Enter and Cmd+Enter keep working, because that is what the window has asked
 * for until now and an accelerator someone has learned should not be taken away in
 * the release that adds a shorter one.
 *
 * When sending is blocked — an outstanding turn, an unresolved attempt, an empty
 * box — Enter is `'ignore'` rather than a line break. Someone who pressed Enter
 * meaning "send" did not mean "reshape my text", and the reason it did not send is
 * already on screen beside the button.
 */
export function composerKeyAction(
  key: ComposerKey,
  state: { readonly canSend: boolean },
): ComposerKeyAction {
  if (key.key !== 'Enter') {
    return 'insert-break';
  }
  if (key.composing) {
    return 'insert-break';
  }
  if (key.shiftKey || key.altKey) {
    return 'insert-break';
  }
  return state.canSend ? 'send' : 'ignore';
}

/**
 * What happened to a send, from the composer's point of view.
 *
 * Only `'accepted'` means the message is somewhere other than the box.
 */
export type SendOutcomeKind = 'accepted' | 'refused' | 'failed' | 'superseded';

/**
 * The composer's text after a send has settled.
 *
 * A refusal or a failed handover leaves the text exactly where it was, because the
 * alternative is a product that eats what someone typed at the moment it also
 * tells them no. `'superseded'` is the send the window stopped waiting for: its
 * result must not reach into a box someone has since typed into.
 */
export function composerTextAfterSend(
  typed: string,
  outcome: SendOutcomeKind,
): string {
  return outcome === 'accepted' ? '' : typed;
}

/**
 * The two sentences this module is allowed to write about a run itself.
 *
 * Everything else in the activity line is forwarded from an event. DSP-27 forbids
 * invented thinking text, and the way to keep that true under later edits is to
 * make the exhaustive list of DSpatch's own sentences something a test can read.
 * Both of these are statements about what DSpatch knows, not about what an agent
 * is thinking.
 */
export const ACTIVITY_OWN_SENTENCES = [
  'The loop has started. Waiting for the first step\u2026',
  'Sent. Nothing has come back yet.',
] as const;

export interface ActivitySource {
  /**
   * Lines already written from real journal entries, oldest first.
   *
   * `formatChatLiveLogLine` wrote them from what the runner recorded. Nothing here
   * adds to them, summarises them or guesses a next one.
   */
  readonly loopLines: readonly string[];
  /** A loop run is in flight. */
  readonly loopRunning: boolean;
  /**
   * What the open step is doing, from `stepStanding`, or `null` when none is open.
   *
   * DSP-87. The journal's last line is written when a node is *entered* and does not
   * move again until the next one is, so a step that streams for four minutes left
   * this line frozen on `Entered agent "…"` — true, and not activity. The step's own
   * standing is the thing that changes while a step works, and it is read for the run
   * and the step the events were addressed to.
   */
  readonly loopStepText?: string | null;
  /** `describeActivity`'s sentence for the ordinary path, or null when there is none. */
  readonly chatActivityText: string | null;
  /** An ordinary provider turn is in flight. */
  readonly chatRunning: boolean;
}

export interface ActivityLine {
  readonly text: string;
  /**
   * Where the sentence came from. `'dspatch'` is one of
   * {@link ACTIVITY_OWN_SENTENCES} and says only what DSpatch itself knows.
   */
  readonly source: 'loop-journal' | 'loop-step' | 'chat-events' | 'dspatch';
  /**
   * What the working step is doing, when one is open, and `null` otherwise.
   *
   * Beside {@link text} rather than instead of it, because they are two facts and a
   * window shows both: {@link text} says **where** the run is, which is the journal's
   * business and does not change while a step works, and this says **what that step
   * is doing**, which is the half that moves. The status beside the composer is the
   * second when there is one, and the ticker above the composer is always the first.
   *
   * Both come out of this one call deliberately. The defect DSP-87 was raised for was
   * two places in the window answering "is anything happening" from two different
   * sources — the loop's activity in one and the direct chat's send-wait clock in the
   * other — and disagreeing. Two fields of one value cannot drift; two computations
   * can, and did.
   */
  readonly stepText: string | null;
  /** The earlier real lines, oldest first, for whoever wants the whole live log. */
  readonly earlier: readonly string[];
}

/**
 * The subdued running line, or nothing at all.
 *
 * Two rules, and they are the whole point of the function.
 *
 * **It invents nothing.** The text is either a line already written from a
 * recorded event or one of {@link ACTIVITY_OWN_SENTENCES}. There is no branch that
 * describes what an agent is probably doing. An empty moment is better than a
 * confident fiction, and a product whose central claim is that work is traceable
 * to real code cannot narrate work it did not see.
 *
 * **It is transient.** Once nothing is running it returns `null`, and the live log
 * leaves the screen. That is DSP-27 #5, and it is safe precisely because the run's
 * history does not live here: the loop turn in the conversation carries the
 * mandate, every agent's reply and the recorded ending, and the run record on disk
 * outlives the window. What disappears is the ticker, not the history.
 */
export function activityLine(source: ActivitySource): ActivityLine | null {
  if (!source.loopRunning && !source.chatRunning) {
    return null;
  }
  // The open step's own line, forwarded rather than invented: `stepStanding` builds
  // it from the provider events that arrived for this step and this run, and says it
  // is waiting when none have.
  const step = source.loopStepText ?? null;
  const stepText = source.loopRunning && step !== null && step !== '' ? step : null;
  if (source.loopRunning) {
    const latest = source.loopLines[source.loopLines.length - 1];
    if (latest === undefined) {
      return {
        text: ACTIVITY_OWN_SENTENCES[0],
        source: stepText === null ? 'dspatch' : 'loop-step',
        stepText,
        earlier: [],
      };
    }
    return {
      text: latest,
      source: stepText === null ? 'loop-journal' : 'loop-step',
      stepText,
      earlier: source.loopLines.slice(0, -1),
    };
  }
  if (source.chatActivityText !== null && source.chatActivityText !== '') {
    return { text: source.chatActivityText, source: 'chat-events', stepText: null, earlier: [] };
  }
  return { text: ACTIVITY_OWN_SENTENCES[1], source: 'dspatch', stepText: null, earlier: [] };
}

/** One agent's own words in the history, with who said them and which time round. */
export interface TrailReply {
  readonly kind: 'reply';
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly text: string;
  /** 1 for the first time this node spoke in this run, 2 for the second, and so on. */
  readonly occurrence: number;
  /** Says which time round when it is not the first, and empty when it is. */
  readonly occurrenceNote: string;
  /**
   * What this call was sent, and which visit the **runner** says it was.
   *
   * DSP-94. Both halves travel together or neither does, because either alone is a
   * trap: a message with no visit number cannot be bound to a call on a node the run
   * entered twice, and a visit number with no message says nothing. `null` where the
   * reply carried no recorded prompt — an older record, or a turn the window built
   * before the field existed.
   *
   * `visit` is not {@link TrailReply.occurrence} above, which counts the replies in
   * this list. A step that answered with nothing is not in the list and is still a
   * visit, so the two can differ, and this is the one that addresses the call.
   */
  readonly sent: { readonly prompt: string; readonly visit: number | null } | null;
}

/** The step between two agents, drawn from the recorded order and nothing else. */
export interface TrailHandoff {
  readonly kind: 'handoff';
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly text: string;
}

/**
 * Why control moved, as the runner recorded it: the branch it took.
 *
 * DSP-53 #4 asks the handover to name the role **and say briefly why control
 * moved**, and the trail below could only ever do the first: it reads the replies,
 * and a reply says who spoke, not which edge was taken afterwards. The branch is a
 * fact the runner already writes into the journal as an `edge-taken` entry, so it
 * is carried here rather than guessed at from the reply's text.
 *
 * Optional throughout. A run whose journal is not to hand — and every record
 * written before today — still produces the trail it produced before, which is why
 * this is an extra clause on an existing sentence rather than a new required field.
 */
export interface TrailBranch {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /** The edge's own label from the drawing, such as `work succeeded`. */
  readonly label: string;
}

export type TrailItem = TrailReply | TrailHandoff;

/**
 * The history of one loop run as roles handing work to each other.
 *
 * Drawn from the record's own replies — their node ids and the order they were
 * appended in — rather than from a renderer's idea of what the graph does. That is
 * what makes it survive a restart: `loopTurnsFromRecords` rebuilds the same
 * replies from disk, so the same trail comes back.
 *
 * The occurrence number is the part that earns its keep. A loop that goes
 * implementer, verifier, implementer is the ordinary shape of rework, and two
 * entries both labelled "Implementer" leave a reader unable to tell the second
 * pass from the first. The count is a fact about the recorded replies, not a
 * judgement about them.
 *
 * It says "handed over to", not "approved" or "passed": what the record shows is
 * that one node stopped and another started, and the trail claims exactly that.
 *
 * `branches` adds the runner's own reason for each move — the edge it took — when
 * the caller has the journal to read it from. The sentence gains a clause and
 * loses nothing: the branch label is the drawing's word for why control moved, not
 * a verdict this function has formed about it. The first branch between two nodes
 * is the one used, matching the order the replies came in.
 */
export function handoffTrail(
  replies: readonly {
    readonly nodeId: string;
    readonly nodeLabel: string;
    readonly text: string;
    /** The runner's own visit count for this call, where the caller has it. */
    readonly occurrence?: number;
    /** The whole message this call was sent, where the record kept one. */
    readonly prompt?: string;
  }[],
  branches: readonly TrailBranch[] = [],
): readonly TrailItem[] {
  const items: TrailItem[] = [];
  const seen = new Map<string, number>();
  const unusedBranches = [...branches];
  let previous: { readonly nodeId: string; readonly nodeLabel: string } | null = null;
  for (const reply of replies) {
    const occurrence = (seen.get(reply.nodeId) ?? 0) + 1;
    seen.set(reply.nodeId, occurrence);
    if (previous !== null) {
      const from = previous.nodeId;
      const at = unusedBranches.findIndex(
        (branch) => branch.fromNodeId === from && branch.toNodeId === reply.nodeId,
      );
      const branch = at === -1 ? null : unusedBranches.splice(at, 1)[0] ?? null;
      const why =
        branch === null || branch.label.trim() === ''
          ? ''
          : ` The run took the branch “${branch.label.trim()}”.`;
      items.push({
        kind: 'handoff',
        fromNodeId: previous.nodeId,
        toNodeId: reply.nodeId,
        text:
          `${previous.nodeLabel} handed over to ${reply.nodeLabel}${
            occurrence > 1 ? `, for the ${ordinal(occurrence)} time` : ''
          }.${why}`,
      });
    }
    items.push({
      kind: 'reply',
      nodeId: reply.nodeId,
      nodeLabel: reply.nodeLabel,
      text: reply.text,
      occurrence,
      occurrenceNote: occurrence > 1 ? `${ordinal(occurrence)} time in this run` : '',
      sent:
        reply.prompt === undefined
          ? null
          : { prompt: reply.prompt, visit: reply.occurrence ?? null },
    });
    previous = { nodeId: reply.nodeId, nodeLabel: reply.nodeLabel };
  }
  return items;
}

function ordinal(value: number): string {
  if (value === 2) {
    return 'second';
  }
  if (value === 3) {
    return 'third';
  }
  if (value === 4) {
    return 'fourth';
  }
  return `${String(value)}th`;
}
