/**
 * The chat window's loop: choose one, type as usual, walk the one you chose.
 *
 * Editor Run stays bound to the duration graph. This module is the other binding:
 * composer text is the entry mandate, later nodes use their purpose, and the
 * conversation column shows short sentences rather than the debug journal. Which
 * drawing is walked is a definition the person selected — `loop-definition-choice.ts`
 * resolves it — rather than the constant path this module used to name.
 */

import { REPORT_WRITTEN_BY_SELF, undeclaredOutcomeOf } from './loop-graph';
import type { LoopEdge, LoopGraph, LoopNode, NodeKind, ResultForm } from './loop-graph';
import { kindEffect } from './loop-node-help';
import { type LiveBinding } from './loop-editor-run';
import type { RunJournalEntry } from './loop-run';
import { describeWorkingRootsForAgent, type WorkingRoot } from './working-roots';

/**
 * DSpatch's own simple chat loop, by graph id.
 *
 * Still named — a window lookup below spells out its labels, and it is the loop a
 * fresh window offers when the person has chosen nothing. **It is no longer a
 * whitelist.** Until DSP-70 this id was the only one `Use loop` would walk and the
 * graph itself was loaded from a constant path inside DSpatch's own repository, so
 * what ran was never what was chosen. The chat loop is now an ordinary declaration in
 * `.dspatch/loops/`, found the same way any other is.
 */
export const CHAT_LOOP_GRAPH_ID = 'dspatch-chat-loop';

/**
 * Whether the chosen definition's graph may be walked from chat.
 *
 * **No drawing is refused here any more, and that is DSP-78.** Until now one was: the
 * id `dspatch-development-loop` was refused whatever folder was open, on the ground
 * that a live writing turn must not use DSpatch as a workspace. The behaviour was safe
 * and the reasoning did not survive being written down — the thing that must not happen
 * is a run *over DSpatch's working copy*, and a drawing is not a folder. Refusing the
 * picture meant our own development loop could not be chosen even to run somewhere it
 * was perfectly safe to run, which is exactly what the standalone definition exists to
 * do.
 *
 * So the question this function asks is now only *is this a graph Use loop can walk*,
 * and the answer is yes for every graph a person chose by name. **Which folders may be
 * worked in is a different question and is still asked**, of every loop, by
 * `refuseLiveWorkingRoots` before the walk starts: a run whose roots are, contain or
 * sit inside DSpatch is refused with the offending folder named. That refusal is
 * untouched by this card and is the one carrying the weight.
 */
export function describeChosenLoopBinding(
  graph: { readonly id: string; readonly name: string },
  definitionName?: string,
): LiveBinding {
  const called = definitionName === undefined ? `"${graph.name}"` : `"${definitionName}"`;
  return {
    ready: true,
    state: 'ready',
    reason:
      `Use loop is ready for ${called} (${graph.id}). Send walks this graph on the ` +
      `project already open in chat. The composer's text is the mandate for the entry ` +
      `node; later nodes use their purpose. Switching Use loop off cancels without ` +
      `resetting files.`,
  };
}

/* ------------------------------------------------------------------------- */
/* What the run measured, as corroboration — not as the branch                */
/* ------------------------------------------------------------------------- */

/**
 * Historical names from the file-diff branch. Kept so old records and tests that
 * still describe a measurement can name them. The chat loop no longer routes on
 * them: a successful work step always goes to check.
 */
export const CHANGED_FILES_OUTCOME = 'changed-files';
export const CHANGED_NOTHING_OUTCOME = 'changed-nothing';

/** The token a step writes as a whole line to name its declared outcome. */
export const RESULT_TOKEN = 'RESULT:';

/**
 * A node's routing, reduced to the two fields that decide what a reply means.
 *
 * DSP-103. The helpers below used to take a bare `readonly string[]` of declared
 * outcomes, which was the whole defect in one parameter: with only the names to hand,
 * the only thing left to read was how they were spelled. Taking the node instead is
 * what lets `whenUndeclared` be the answer, and it is deliberately a `Pick` rather
 * than a whole `LoopNode` so that the node panel can ask the same question about a
 * node it is still editing.
 */
export type UndeclaredRouting = Pick<LoopNode, 'outcomes' | 'whenUndeclared'>;

/** What DSpatch's two snapshots differ by. Counts decide the branch; paths tell the user which. */
export interface MeasuredChange {
  readonly changedFiles: number;
  readonly addedFiles: number;
  readonly removedFiles: number;
  /**
   * The relative paths behind those counts, when the caller has them.
   *
   * DSP-48 #1. Optional because the branch does not need them and every caller
   * written before today passes counts alone; the sentence a person reads does need
   * them. Changed, added and removed together, in the order the comparison produced.
   */
  readonly paths?: readonly string[];
}

/**
 * How many paths a sentence a person reads may name before it stops being readable.
 *
 * A run that genuinely changed four hundred files must not paste four hundred paths
 * into the conversation, and a bound that is not counted out loud is a lie by
 * omission — so `boundedPathList` returns the remainder rather than dropping it.
 */
export const MAX_NAMED_PATHS = 8;

export function boundedPathList(
  paths: readonly string[],
  limit: number = MAX_NAMED_PATHS,
): { readonly named: readonly string[]; readonly notListed: number } {
  return {
    named: paths.slice(0, limit),
    notListed: Math.max(0, paths.length - limit),
  };
}

/**
 * The paths a run moved, as a clause for a sentence a person reads, or `''`.
 *
 * DSP-48 #1 and #2. Naming the paths is the whole fix, and it is a fix for something
 * the measurement cannot be made to do: the comparison is of the **tree**, and the
 * agent is not the only thing that writes into a project while a turn runs. The
 * Verifier demonstrated a read-only mandate reaching a real spawned command by
 * having a separate OS process append one line to `build/CMakeCache.txt`. A person
 * who reads *`build/CMakeCache.txt`* recognises that at once; one who reads *1
 * changed file* cannot. So the clause says both the paths and where they come from.
 *
 * `notListed` belongs to `paths` and is the remainder `boundedPathList` cut, so a
 * remainder without a single named path is not a state either caller can produce.
 */
export function describeMovedPaths(
  paths: readonly string[],
  notListed = 0,
): string {
  if (paths.length === 0) {
    return '';
  }
  const listed = paths.join(', ');
  return (
    `The files DSpatch measured as changed, added or removed: ${listed}` +
    `${notListed === 0 ? '' : `, and ${String(notListed)} more this sentence does not list`}. ` +
    `That is a comparison of the whole project folder before this step and after it, so ` +
    `anything else that wrote there while the loop was working — a build server, an editor ` +
    `saving, an indexer, or you in another window — is in this list too, and a path you did ` +
    `not expect is more likely to be one of those than something the agent did.`
  );
}

/**
 * What DSpatch's two snapshots differ by, as a sentence for the record — never as
 * a branch. A successful work step always goes to check; this text sits beside
 * that fact so a person can see what the trees actually did.
 */
export function describeSnapshotChange(change: MeasuredChange): string {
  const touched = change.changedFiles + change.addedFiles + change.removedFiles;
  if (touched === 0) {
    return (
      `DSpatch compared the project before this step with the project after it and found ` +
      `no file changed, added or removed. That is DSpatch's own comparison of the two ` +
      `trees, not the agent's account of what it did, and it does not choose the branch.`
    );
  }
  const bounded = boundedPathList(change.paths ?? []);
  const named = describeMovedPaths(bounded.named, bounded.notListed);
  return (
    `DSpatch compared the project before this step with the project after it and found ` +
    `${describeMeasuredChange(change)}. That is DSpatch's own comparison of the two ` +
    `trees, not the agent's account of what it did, and it does not choose the branch.` +
    `${named === '' ? '' : ` ${named}`}`
  );
}

/* ------------------------------------------------------------------------- */
/* What the run changed, told to the step that judges what was delivered      */
/* ------------------------------------------------------------------------- */

/**
 * What this run has changed in its working folders, as the run itself measured it.
 *
 * Three states and not two, because "we did not measure" is a real state and rendering
 * it as "nothing changed" would be worse than the defect DSP-99 exists to fix: an
 * absence would arrive at a reviewer as an authoritative-sounding falsehood. A drawing
 * where {@link import('./loop-graph').writeReachOf} skipped the hashing, and a step
 * before any two snapshots exist, are both `not-measured` — and the tag is what a caller
 * has to choose rather than something inferred from three empty lists, which is exactly
 * what an unhashed run produces.
 *
 * `measured` carries both snapshot identities because they are what the journal line for
 * the same comparison names, so a person holding the record can line the two up.
 */
export type RunChangeAccount =
  | {
      readonly kind: 'not-measured';
      /** Why, in the run's own words. Never omitted: an unexplained absence invites a guess. */
      readonly why: string;
    }
  | {
      readonly kind: 'measured';
      readonly snapshotBefore: string;
      readonly snapshotAfter: string;
      /**
       * When each of the two observations was actually taken, as an ISO instant.
       *
       * A snapshot identity says *what* was there and nothing about *when* anybody
       * looked, and the second moment is **not the run's end** — it is the walk taken
       * after the most recently finished step. Niclas edits these projects himself while
       * a run is in flight, so the two instants are what let him line this account up
       * against his own activity and against the journal, which stamps the same way.
       */
      readonly observedFromUtc: string;
      readonly observedToUtc: string;
      /**
       * Every path that differs between the two observations, qualified by root name
       * where the run has more than one. Empty means **observed and nothing differs**.
       */
      readonly paths: readonly string[];
    };

/**
 * How many paths the account names before it stops and counts the rest.
 *
 * Larger than {@link MAX_NAMED_PATHS}, which bounds a sentence in a window: this one is
 * read by a step that is about to judge a delivery, and forty paths is still a fraction
 * of a message that already carries a whole role. The bound exists so that a run over a
 * generated tree cannot put four thousand paths into a prompt.
 */
export const MAX_NAMED_RUN_PATHS = 40;

/**
 * What the account is, and what it is not, in the words the step is sent.
 *
 * Written once and shared by all three states, so no state can be given a friendlier
 * version of it — and exported for {@link briefParts}, which shows these lines rather
 * than a paraphrase of them (DSP-94).
 *
 * **Every sentence here has to be true in the `not-measured` state as well.** The one the
 * reviewer of run `chat-loop-2026-09-22T19-50-58-359Z` needed — *a file this account does
 * not name did not change, so this run did not change it* — is therefore **not** here. It
 * is a claim only a measurement can make, so it is made in the measured branch of
 * {@link describeRunChange} and nowhere else.
 *
 * **The second paragraph exists because the section could otherwise be read as a
 * reproach.** A correct run can change nothing — which is the premise of the very run
 * this card comes from — and a reviewer already inclined to find fault must not be handed
 * an empty measurement in DSpatch's voice as a hook to hang one on.
 *
 * The last paragraph is what keeps this evidence rather than a verdict, and its closing
 * sentence is the important one. The account and the working copy *can* disagree:
 * something outside the run writes, a root goes unmeasured, a step is replayed. That
 * disagreement is the most useful thing a judging step could notice, so it is asked for
 * out loud instead of being designed away.
 */
export const RUN_CHANGE_NOTE: readonly string[] = [
  'The measurement above, where there is one, is DSpatch\u2019s own comparison of the working ' +
    'folders between two moments rather than any step\u2019s account of itself. It says which ' +
    'files differ and never whether the work was right. It covers this run\u2019s own working ' +
    'folders and nothing outside them, and anything else that wrote there between those two ' +
    'moments \u2014 a build, an editor saving, an indexer, or the person in another window ' +
    '\u2014 is in it too.',
  'Unchanged content is not evidence that nothing was read or that the task was not done. A ' +
    'run can be correct and change nothing at all: a question answered, a check that passed, ' +
    'a review whose verdict was that the work stands, a pass through the loop\u2019s own ' +
    'steps. Read an empty measurement as an empty measurement.',
  'It is evidence for you to use and not a limit on what you may read: read the code, the ' +
    'history and the folders as your step needs. What it is good for is ruling work out ' +
    'rather than crediting it \u2014 these folders can hold uncommitted work from earlier ' +
    'sessions and from other people, so nothing you find there is this run\u2019s delivery ' +
    'merely because it is there or because it was touched recently. Where what you read ' +
    'disagrees with this account, in either direction, say so in your reply as a finding of ' +
    'its own rather than settling quietly on one of the two.',
];

/**
 * Whether this step's message carries the run's account of what it changed.
 *
 * **The question DSP-99 asks is which steps are assembled for judging delivered work,
 * and the drawing's answer to it is `consumes`.** A step that has been handed an earlier
 * step's account of its own work is exactly the step that has to relate that account to
 * the folders, and it is the only kind of step that can make the mistake this card is
 * about. A step that consumes nothing has been handed nobody's work: the entry step is
 * being told what the run is *for*, and telling it what the run has changed so far —
 * nothing, necessarily — would be noise at the one moment noise costs a whole run.
 *
 * **Three alternatives were considered and each states less than this one.** A node id
 * (`implementation-review`) is the special-casing DSP-91 forbade and would not survive
 * anybody drawing their own loop. A declared verdict (`outcomes`) would give it to the
 * reviewer and withhold it from the verifier, and the drawing separated those two for an
 * unrelated reason — the verifier's PASS/FAIL lives in its report, not in its outcome
 * list — so the one step that runs real commands against the folders would be the one
 * left guessing. DSP-102 has since given three of the runnable loop's steps outcomes for
 * a third unrelated reason, whether they named a result at all, and that only makes the
 * point twice over: it would now hand the account to the `coordinator`, the one step the
 * test below asserts must not get it, because it is being told what the run is *for*.
 * Role text is not the drawing and is out of scope here by instruction.
 *
 * **Beyond the two obvious judges this reaches three more steps, and each is wanted or
 * harmless.** `coordinator-report` needs it for precisely the reviewer's reason: a report
 * that credited somebody else's uncommitted files to this run is the same failure told to
 * Niclas rather than to an agent. The `implementer` on a rework round is being asked to
 * go again at work the run has already done, and what the run has changed so far is its
 * own first attempt. For the `researcher`, handed the coordinator's brief, it is a true
 * sentence about the run it is working inside and nothing more.
 */
export function carriesRunChange(
  node: Pick<LoopNode, 'consumes'>,
  /**
   * What this step is actually being handed, where the caller knows it (DSP-100).
   *
   * The question above is *has this step been handed somebody's account of their own
   * work*, and since an arriving edge can decide that, the node's standing list is no
   * longer the only answer to it. A caller inside a run knows the real one and passes it;
   * the node panel, describing a drawing rather than a run, does not and falls back to
   * the declaration — which is what it can honestly say about a step nobody has walked to.
   */
  receivedIds?: readonly string[],
): boolean {
  return (receivedIds ?? node.consumes ?? []).length > 0;
}

/**
 * The run's account of what it changed, as the step reading it is sent it.
 *
 * Never the empty string: a run that changed nothing has an account and it is the whole
 * point of this card (DSP-99 #4). Whether the section is appended at all is
 * {@link carriesRunChange}'s decision, taken by the caller — the same arrangement as
 * {@link import('./loop-results').describeReceivedResults}, so that what the head of the
 * message promises and what the message carries stay one decision (DSP-91 #5).
 *
 * The three states are worded so that no two of them can be read as each other. "Not
 * established" opens by saying it is not "nothing", because a step skim-reading a
 * section that mentions no files would otherwise take the absence for a measurement.
 */
export function describeRunChange(account: RunChangeAccount): string {
  const subject = 'What changed in this run\u2019s working folders';
  if (account.kind === 'not-measured') {
    return (
      `\n\n---\n\n${subject} is not established, and that is not the same as nothing: from ` +
      `this message a run that changed a hundred files and a run that changed none look ` +
      `identical. ${account.why}\n\n${RUN_CHANGE_NOTE.join('\n\n')}\n`
    );
  }
  // Both moments and both identities, because neither answers the other's question: the
  // identity says what was there, the instant says when anybody looked. The second is
  // named for what it is rather than called the end of the run, which it is not.
  const moments =
    `DSpatch looked at those folders at ${account.observedFromUtc} ` +
    `(snapshot ${account.snapshotBefore}) and again at ${account.observedToUtc} ` +
    `(snapshot ${account.snapshotAfter}). The second look was taken after the most recently ` +
    `finished step of this run, not at the run\u2019s end.`;
  // No "what this run changed" and no "as DSpatch measured it rather than as any step
  // described it" in the heading: the first attributes, and the second is said in the
  // standing note below, which is sent in every state.
  const opening = `${subject} between two moments DSpatch observed them`;
  if (account.paths.length === 0) {
    return (
      `\n\n---\n\n${opening}: nothing. No file in them differs between the two. ${moments} So ` +
      `anything you find changed or uncommitted in those folders was already like that before ` +
      `the first of those moments, and is not this run\u2019s delivery.\n\n` +
      `${RUN_CHANGE_NOTE.join('\n\n')}\n`
    );
  }
  const bounded = boundedPathList(account.paths, MAX_NAMED_RUN_PATHS);
  const counted = `${String(account.paths.length)} file${account.paths.length === 1 ? '' : 's'}`;
  return (
    // **An observation, not an attribution, and the difference is load-bearing here.**
    // The heading is the part that gets skimmed, and the first version of it read "what
    // this run has changed" — which the standing note below then contradicted by saying a
    // build, an editor saving or the person in another window is in the measurement too.
    // A difference between two observations does not establish who made it, and on this
    // machine that is a live case rather than a hypothetical: Niclas edits these projects
    // himself while runs are in flight. The **negative** claim survives the correction and
    // is kept, because a file that did not change cannot have been changed by anybody.
    `\n\n---\n\n${opening}: ${counted} differ${account.paths.length === 1 ? 's' : ''}. ` +
    `${moments} What differs: ${bounded.named.join(', ')}` +
    `${bounded.notListed === 0 ? '' : `, and ${String(bounded.notListed)} more this account does not list`}. ` +
    `That the files differ is established; who changed them is not, and other work may have ` +
    `been going on in those folders between those two moments. A file in them that is not ` +
    `named here did not change between them, and so was not changed by this run either.\n\n` +
    `${RUN_CHANGE_NOTE.join('\n\n')}\n`
  );
}

/**
 * Historical helper: which file-diff name a measurement would have taken.
 *
 * The chat loop no longer uses this to choose an edge. Kept so a node that still
 * draws those two names — none of ours now does — and so tests of the description
 * can name the old pair. `null` when the node does not declare both names, which
 * is what leaves `dspatch-live-duration` on plain success.
 */
export function measuredWorkOutcome(
  declared: readonly string[],
  change: MeasuredChange,
): { readonly outcome: string; readonly why: string } | null {
  if (!declared.includes(CHANGED_FILES_OUTCOME) || !declared.includes(CHANGED_NOTHING_OUTCOME)) {
    return null;
  }
  const touched = change.changedFiles + change.addedFiles + change.removedFiles;
  return {
    outcome: touched === 0 ? CHANGED_NOTHING_OUTCOME : CHANGED_FILES_OUTCOME,
    why: describeSnapshotChange(change),
  };
}

function describeMeasuredChange(change: MeasuredChange): string {
  const parts = [
    change.changedFiles === 0 ? '' : `${String(change.changedFiles)} changed`,
    change.addedFiles === 0 ? '' : `${String(change.addedFiles)} added`,
    change.removedFiles === 0 ? '' : `${String(change.removedFiles)} removed`,
  ].filter((part) => part !== '');
  return `${parts.join(', ')} file${
    change.changedFiles + change.addedFiles + change.removedFiles === 1 ? '' : 's'
  }`;
}

/**
 * The gate's third verdict: there was no command to run.
 *
 * DSP-44. `no-command-configured` used to arrive at the runner as a runtime fault,
 * which stops the run under `stop-and-reconcile` — the right answer while the gate
 * was mandatory and the run had sold a check it could not deliver, and the wrong
 * one as general behaviour. A project whose check nobody has worked out is an
 * ordinary state, not a broken machine, and reconciliation is what a person does
 * when something might have half-happened. Nothing half-happened here.
 *
 * **Exactly one state moves.** `could-not-start` and `did-not-finish` stay faults,
 * because in those two something really did break and the run's outcome really is
 * unknown. The five states DSP-26 #2 keeps distinct all survive: this changes how
 * the run *ends*, not what the command record says about itself.
 *
 * Declaration-gated for the same reason as above: a gate that does not draw this
 * outcome keeps the fault, so the duration fixture and every graph written before
 * today behave exactly as they did.
 */
export const NOT_VERIFIED_OUTCOME = 'not-verified';

export function notVerifiedOutcome(declared: readonly string[]): string | null {
  return declared.includes(NOT_VERIFIED_OUTCOME) ? NOT_VERIFIED_OUTCOME : null;
}

/* ------------------------------------------------------------------------- */
/* What the agent declared about the task, as opposed to mentioned in prose   */
/* ------------------------------------------------------------------------- */

/** The two things only the agent can say about the task it was given. */
export type DeclaredFailure = 'spec-error' | 'blocked';

/** The token the prompt asks for, and the failure name it routes as. */
export const DECLARATION_TOKENS: Readonly<Record<string, DeclaredFailure>> = {
  SPEC_ERROR: 'spec-error',
  BLOCKED: 'blocked',
};

/**
 * A declared failure named on a whole line `RESULT: <name>`, or `null`.
 *
 * DSP-91 D3. The 21 September run ended `RESULT: BLOCKED` and was routed as **success**:
 * {@link declaredFailureFrom} reads only the opening of the first line, which was prose,
 * and the node declared no outcomes, so nothing else could read it either. A refusal that
 * a graph can route and does not is the most expensive miss in the product — the run took
 * the success edge and handed a refusal to the next step as its brief.
 *
 * It is safe where a bare word is not, and for the reason `declaredFailureFrom`'s comment
 * gives: this is a **whole line in the form the prompt asked for**, so `RESULT: blocked`
 * cannot be the ordinary English word in a sentence about mutexes. Case is therefore not
 * load-bearing here and is folded — the prompt lists the names as the graph spells them
 * and the model may shout them back.
 *
 * Only names the node actually declares. A failure this graph does not draw has nowhere
 * to go, and reading one would stop a run on a word the drawing never offered.
 */
export function declaredFailureLineFrom(
  text: string,
  declaredFailures: readonly string[],
): string | null {
  if (declaredFailures.length === 0) {
    return null;
  }
  const found = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const opening = raw.trim().replace(/^[*_\s]+/, '');
    if (!opening.startsWith(RESULT_TOKEN)) {
      continue;
    }
    const token = (opening.slice(RESULT_TOKEN.length).trim().split(/\s+/)[0] ?? '').replace(
      /[*_]+$/,
      '',
    );
    const match = declaredFailures.find(
      (failure) => failure.toLowerCase() === token.toLowerCase(),
    );
    if (match !== undefined) {
      found.add(match);
    }
  }
  // One readable name, as everywhere else. Two contradictory ones are not a declaration.
  return found.size === 1 ? ([...found][0] as string) : null;
}

/**
 * Whether the reply *declares* a failure, rather than mentioning one of the words.
 *
 * DSP-47. This used to be `/\bBLOCKED\b/i` against the whole reply, which is the
 * ordinary English word with a word boundary round it and no case to tell it apart.
 * The Verifier measured three plausible C++ review sentences — *"the render thread
 * is blocked on a mutex held by the loader"*, *"Nothing is Blocked and nothing
 * failed"*, *"The build is not blocked"* — each routing a successful read-only run
 * to the `stopped` ending, whose own purpose sentence says the work was not done.
 * On a C++ project *blocked* is a term of art for threads, mutexes, sockets and
 * queues, so that is not an edge case there; it is the expected reply.
 *
 * `chatPromptFor` below asks the agent to reply with the token as the first word,
 * so the contract is about how the reply **opens**. This reads it that way:
 *
 * - The **first non-blank line** only. A leading blank line is not content.
 * - Leading markdown emphasis is stripped, because providers add it and
 *   `**BLOCKED** — the workspace is read-only` is unmistakably the declaration.
 * - A leading code fence is **not** stripped. A fence is quoted material, and the
 *   likeliest fenced reply is one quoting this very instruction back.
 * - The token must be **upper case**. Case is the only thing that separates the
 *   token from the word: `Blocked threads are the problem here` opens with the word
 *   and declares nothing, and the prompt asks for `BLOCKED`.
 *
 * What stays possible, stated rather than hidden: a reply that opens with the
 * literal all-caps word `BLOCKED` in prose is still read as a declaration. There is
 * no way to tell that from the declaration without asking the agent for something
 * more than a word, and the prompt asks for a word.
 *
 * A miss here is far cheaper than a false hit. A missed declaration continues to
 * the measured branch and — the agent having written nothing — ends at
 * `nothing-changed`, where the reply *is* the result and reaches the conversation
 * whole. A false hit ends at `stopped` and tells the user the work was not done.
 */
export function declaredFailureFrom(text: string): DeclaredFailure | null {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '');
  if (firstLine === undefined) {
    return null;
  }
  // Emphasis only. Not `` ` `` and not `>`: a fenced or quoted opening is the agent
  // showing something, and what it is most likely to show is the instruction.
  const opening = firstLine.trim().replace(/^[*_\s]+/, '');
  for (const [token, failure] of Object.entries(DECLARATION_TOKENS)) {
    if (opening.startsWith(token) && !/^\w/.test(opening.slice(token.length))) {
      return failure;
    }
  }
  return null;
}

/**
 * Named verdicts the reply declared, read from whole lines `RESULT: <name>`.
 *
 * A declared failure still wins: this is only consulted when the opening is not
 * SPEC_ERROR or BLOCKED. One readable name that the node declared is a verdict.
 * Missing, contradictory, or undeclared names are `null` so the caller can route
 * `unclear` / `could-not-check` rather than guess or fault the run.
 */
export function declaredOutcomeFrom(
  text: string,
  allowed: readonly string[],
): { readonly outcome: string; readonly why: string } | null {
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const opening = line.replace(/^[*_\s]+/, '');
    if (!opening.startsWith(RESULT_TOKEN)) {
      continue;
    }
    const name = opening.slice(RESULT_TOKEN.length).trim();
    if (name === '') {
      continue;
    }
    const token = (name.split(/\s+/)[0] ?? '').replace(/[*_]+$/, '');
    if (token !== '') {
      found.push(token);
    }
  }
  if (found.length === 0) {
    return null;
  }
  const unique = [...new Set(found)];
  if (unique.length !== 1) {
    return null;
  }
  const outcome = unique[0];
  if (outcome === undefined || !allowed.includes(outcome)) {
    return null;
  }
  return {
    outcome,
    why:
      `The step declared RESULT: ${outcome}. That is its named verdict for this step, ` +
      `not DSpatch's comparison of the project tree.`,
  };
}

/**
 * What an agent step that produced no text at all should be read as.
 *
 * DSP-57 #1: **an empty reply must never be reported as a successful result.**
 * Until now it could be, and the path was short enough to miss. A provider turn
 * that reached `finished` with no assistant text fell through `declaredFailureFrom`
 * (nothing to read), `declaredOutcomeFrom` (no RESULT line) and
 * {@link undeclaredReadableOutcome} (which only helped a node whose outcome list
 * happened to contain one of two particular words) and landed on plain `success` — the
 * same product a step that did the work and said so produces. On the chat loop that was
 * survivable by accident, because both its agent nodes happen to state a readable
 * fallback; on any drawing that does not, silence routed as success down the success edge.
 *
 * An accident is not a guarantee, so the rule is stated here rather than left to
 * each graph's outcome list. Silence is never success. Where the node **states** a name
 * for "we could not establish this", silence takes it — that is a real ending the
 * drawing provides and it is honest. Where it states none, `null` says so and the
 * caller raises a runtime fault, because a step that was asked a question and
 * answered nothing has delivered no outcome, and the run has nothing to route on.
 *
 * **DSP-103 changed where that name comes from and not what silence means.** It used to
 * be found by spelling and is now read off `whenUndeclared`. A node that declares no
 * outcomes at all still cannot have one — the field is refused there, because such a
 * node's ordinary reply is its result and there is nothing to fall back to — so silence
 * at such a node is still the fault it has always been. That is the half of DSP-57 a
 * graceful route must never quietly undo, and it is the same answer before and after.
 *
 * `null` from a *non-empty* reply would be wrong and is impossible: this is only
 * consulted for text that is empty once trimmed.
 */
export function emptyReplyOutcome(
  node: UndeclaredRouting,
): { readonly outcome: string; readonly why: string } | null {
  const readable = undeclaredReadableOutcome(node);
  if (readable === null) {
    return null;
  }
  return {
    outcome: readable.outcome,
    why:
      `The step finished its provider turn without writing anything at all. An empty ` +
      `reply is not a result, so the run takes "${readable.outcome}" rather than reading ` +
      `silence as work done.`,
  };
}

/**
 * The route a reply that declared nothing readable takes, as the node states it.
 *
 * DSP-103, and the change is the whole card. This used to ask whether the node's
 * outcome list contained the literal `unclear`, and failing that the literal
 * `could-not-check` — so a drawing got the graceful route by spelling a word, a
 * drawing that spelled the same idea `not-established` stopped the run as a fault
 * instead, and the node panel said neither. **No outcome name carries behaviour now**:
 * {@link undeclaredOutcomeOf} reads one declared field, and a node that states nothing
 * keeps the stop it already had.
 *
 * The decision is in the format so that the panel, the prompt and the runner cannot
 * drift apart; the sentence is here, because it is written for the run journal and for
 * the person reading it. A node whose reply declares nothing and which states no route
 * is `null`, and the caller turns that into `undeclared-product`.
 */
export function undeclaredReadableOutcome(
  node: UndeclaredRouting,
): { readonly outcome: string; readonly why: string } | null {
  const outcome = undeclaredOutcomeOf(node);
  if (outcome === null) {
    return null;
  }
  return {
    outcome,
    why:
      `The reply did not declare a readable RESULT for this step, and this node says a ` +
      `missing declaration is routed as "${outcome}". That is the drawing's own choice ` +
      `for a result nobody established, not DSpatch reading anything into the reply.`,
  };
}

/**
 * The role a step is performed as, reduced to what a prompt needs.
 *
 * Not `ResolvedRole`: that type carries targets, requirement provenance and the two
 * `…Declared` flags, none of which an agent should be told, and it lives behind a
 * resolver that reads the filesystem. This module is shared with the renderer, so it
 * takes the three fields the prompt uses and nothing that would drag `node:fs` in.
 */
export interface ChatRoleText {
  readonly id: string;
  /** Where the role came from, named to the agent so a wrong role is recognisable. */
  readonly sourcePath: string;
  /** The role's own prose, or `null` when the reference resolved without any. */
  readonly instructions: string | null;
}

/**
 * The markers around role prose, so the agent can tell the role from the task.
 *
 * Fenceless and deliberately unusual: a role file is Markdown and may contain any
 * heading, list or code fence, and a delimiter a role could itself contain is a
 * delimiter that ends the role early. These are also what a test asserts the prompt
 * contains, which is how *the role reached the provider* stops being a claim.
 */
export const ROLE_BLOCK_OPEN = '===== role, as written =====';
export const ROLE_BLOCK_CLOSE = '===== end of role =====';

/**
 * What the prompt says about where the role came from — and never a path.
 *
 * DSP-91 #1, and it is a five-line defect with a long consequence. This preamble used to
 * print `role.sourcePath`, which is the path **relative to the loop definition's resource
 * root**: `docs/loop/roles/run/dspatch-run-coordinator.role.md`. The resource root is
 * resolved inside the main process and never reaches the agent, whose `cwd` is the
 * project. So from where the agent stands that path resolves *into the project*, and on
 * 21 September 2026 a coordinator went looking for it in MiniDAWLab, did not find it, and
 * concluded its own assignment was mistaken — "(which doesn't exist in this project), I
 * believe there's a spec error".
 *
 * So no path is emitted, and what replaces it is the three things the agent actually needs
 * to know: the text between the markers **is** the role and is complete; it came from the
 * loop's own definition rather than from the project; and it is not in the working folders,
 * so its absence there is not a finding. The identity is still named, because a wrong role
 * has to stay recognisable — and the path is still in the run record on
 * `RecordedAgentReply.role`, where a person reading afterwards can see it and an agent
 * cannot mistake it for somewhere to go.
 */
const ROLE_PROVENANCE =
  'It reached you from the loop definition\u2019s own resources, which are a different ' +
  'place from the folders you are working in: there is no role file, agent file or ' +
  'document about this loop inside those folders, do not look for one, and do not read ' +
  'its absence there as a fault in your assignment.';

/**
 * The sentence above the role block, as the agent receives it.
 *
 * Its own function so that {@link briefParts} can put the literal string on the screen
 * instead of a description of it (DSP-94, from DSP-92's F4). The panel and the prompt
 * therefore call the same code: a change to this wording moves both, and neither can
 * be edited into disagreeing with the other.
 */
export function roleHeadlineFor(role: ChatRoleText): string {
  const instructions = role.instructions?.trim() ?? '';
  if (instructions === '') {
    // Said rather than omitted. A step whose role resolved to no prose is a step whose
    // drawing claims something its role file does not supply, and the agent is the one
    // party that can notice the role it was handed is not the one the work needs.
    return (
      `You are performing the role "${role.id}", declared for this step in the loop ` +
      `drawing. DSpatch read no instructions for it beyond the name, so this is all ` +
      `the role says. ${ROLE_PROVENANCE}`
    );
  }
  return (
    `You are performing the role "${role.id}", declared for this step in the loop ` +
    `drawing. Everything between the markers below is that role, whole, as its author ` +
    `wrote it \u2014 the role is this text and not a file you have to find. ` +
    `${ROLE_PROVENANCE} It governs how you work, and the task follows it.`
  );
}

/**
 * The role, as the opening of the prompt, or `[]` when there is nothing to say.
 *
 * Before the mandate rather than after it. The role is who is doing the work and the
 * mandate is the work; a model reading the task first and its own boundaries second has
 * already started planning against the wrong constraints.
 */
function rolePreamble(role: ChatRoleText | null | undefined): readonly string[] {
  if (role === null || role === undefined) {
    return [];
  }
  const instructions = role.instructions?.trim() ?? '';
  if (instructions === '') {
    return [roleHeadlineFor(role), ''];
  }
  return [
    roleHeadlineFor(role),
    '',
    ROLE_BLOCK_OPEN,
    instructions,
    ROLE_BLOCK_CLOSE,
    '',
  ];
}

/**
 * The names this step may answer with: its verdicts, and the failures it may declare.
 *
 * DSP-91 D3's other half. `declaredFailures` used to appear nowhere in the prompt except
 * as the two opening words below, so a graph declaring a third — the runnable loop's
 * `research-needed`, which has a whole edge drawn for it — was asking for a name it never
 * told anybody. Listing both here means every branch the drawing can take has a form the
 * agent was actually taught, and {@link declaredFailureLineFrom} reads the failure half
 * back. A failure that is also an outcome name is listed once, as the outcome.
 *
 * **The two lists are introduced separately, and that is not a stylistic choice.** The
 * first version of this put them under one "use one of these names" sentence, and walk 1
 * of DSP-91's verification showed what that does to a node with failures and no verdicts:
 * the implementer, which declares three failures and no outcome, was told that finishing
 * meant writing `RESULT: spec-error`, `research-needed` or `blocked`. It had succeeded, so
 * it invented `RESULT: change` — harmless only because a node with no outcomes branches on
 * its success edge regardless. A prompt that leaves an agent no true answer gets an
 * invented one, which is the failure mode the whole card is about.
 */
function outcomeInstructions(
  node: Pick<LoopNode, 'outcomes' | 'whenUndeclared' | 'declaredFailures'>,
): readonly string[] {
  const verdicts = node.outcomes ?? [];
  const failures = (node.declaredFailures ?? []).filter((name) => !verdicts.includes(name));
  if (verdicts.length === 0 && failures.length === 0) {
    return [];
  }
  const failureLines =
    failures.length === 0
      ? []
      : [
          verdicts.length === 0
            ? 'This step has no verdict to name: doing the work is the answer, and a step that ' +
              'finished writes no such line. Write one only if you could not complete the step ' +
              'at all, in the same form, using one of these names:'
            : 'If instead you could not complete the step at all, write the line with one of ' +
              'these names, which the loop routes differently from a verdict:',
          ...failures.map((name) => `${RESULT_TOKEN} ${name}`),
        ];
  return [
    '',
    ...(verdicts.length === 0
      ? []
      : [
          'When you finish this step, write a whole line exactly in this form, using one of these names and nothing else on that line:',
          ...verdicts.map((name) => `${RESULT_TOKEN} ${name}`),
        ]),
    ...failureLines,
    resultLineSentence(node),
  ];
}

/**
 * What a `RESULT:` line this node cannot route actually does, said to the step.
 *
 * **DSP-104 is the first case.** A node with no verdicts was told *"Do not invent a name:
 * any other name on such a line is read as a result nobody can route."* Nothing reads it
 * as anything. `declaredOutcomeFrom` refuses a name the node does not declare, a node
 * declaring none can state no `whenUndeclared` to fall back to, and the reply falls
 * through to plain success — so the run treats an invented name exactly as it treats a
 * reply with no such line, which is what DSP-91's first walk recorded when an implementer
 * wrote `RESULT: change` and was carried onward as having finished. The message promised a
 * stricter reader than the one that exists. **The sentence moves and the routing does
 * not**: nothing about how an unrecognised name is read changes here.
 *
 * **DSP-103 #2 is the other two.** The sentence they replaced read *"A missing or
 * contradictory name is read as you could not establish the result"*, true where the
 * node's outcome list happened to contain `unclear` or `could-not-check` and false
 * everywhere else, where a missing name stopped the run. They ask
 * {@link undeclaredReadableOutcome}, which reads the node's own `whenUndeclared`.
 *
 * One function for all three because the node panel shows the string this returns rather
 * than an account of it ({@link briefParts}), which is how the panel came to be still
 * describing a missing name as *read as a result it could not establish* after the prompt
 * had stopped saying so. Two texts about one reader can disagree; one cannot.
 */
function resultLineSentence(node: UndeclaredRouting): string {
  if ((node.outcomes ?? []).length === 0) {
    return (
      `Do not invent a name: any other name on such a line is not read as a result at ` +
      `all. The run takes this step to have finished its work and carries on exactly as ` +
      `it would for a reply with no such line, so writing one tells the run nothing.`
    );
  }
  const fallback = undeclaredReadableOutcome(node);
  return fallback === null
    ? `A missing or contradictory name is not a result this step can end on: this node ` +
        `names no outcome for one, so the run stops for a person rather than choosing a ` +
        `name for you. Do not invent a name.`
    : `A missing or contradictory name is read as "${fallback.outcome}", which is what ` +
        `this node names for a result that was not established. Do not invent a name.`;
}

/**
 * The two opening words, asked for only where the drawing can route them.
 *
 * DSP-91 #6. This used to be emitted unconditionally, which is how the 21 September run
 * asked its coordinator for SPEC_ERROR and BLOCKED while the `coordinator` node declared
 * no failures at all: there was no edge either word could take, so a coordinator that
 * correctly refused the work was read as having done it. A prompt must not ask for
 * something the graph cannot act on — that is the same defect as promising an attachment
 * the message does not carry, one field along.
 *
 * Keyed off {@link DECLARATION_TOKENS} so the words asked for and the words read back
 * cannot drift apart.
 */
function declarationInstructions(
  declaredFailures: readonly string[] | undefined,
): readonly string[] {
  const declared = declaredFailures ?? [];
  const lines: string[] = [];
  for (const [token, failure] of Object.entries(DECLARATION_TOKENS)) {
    if (!declared.includes(failure)) {
      continue;
    }
    lines.push(
      failure === 'spec-error'
        ? `If the premise is wrong, begin your reply with the word ${token}, then a sentence.`
        : `If you cannot do the work, begin your reply with the word ${token}, then a sentence.`,
    );
  }
  return lines;
}

/**
 * Which step of which run this brief is for.
 *
 * DSP-79. With one provider session per agent node, the step receiving work is a
 * different agent that has seen nothing of the run, so its own address in the run is
 * something it has to be told rather than something it can look back at.
 */
export interface ChatStepIdentity {
  readonly runId: string;
  /** 1-based visit to this node. */
  readonly occurrence: number;
  /** The journal's sequence number for this call — the handoff's call-id. */
  readonly callId: number;
  /** False on a revisit, where this node's own agent already has its earlier context. */
  readonly freshSession: boolean;
  /**
   * The route the run took to reach this step, or `null`/absent at the entry.
   *
   * DSP-100. Used for one thing only, and it is the sentence a revisit needs most:
   * *coming back here is not an answer to what you asked last time*. The 22 September
   * implementer was re-prompted at its own unanswered question, treated the arrival of
   * the prompt as the reply — "I understand the clarification." — and went on. Naming the
   * route says what actually happened, and the drawing is where it is written.
   */
  readonly arrivedBy?: {
    readonly edgeId: string;
    readonly from: string;
    readonly label: string | null;
  } | null;
  /**
   * What the caller is going to append after this text, and nothing it might append.
   *
   * DSP-91 #5. The preamble used to announce *"At the end of this message you will find
   * what you must leave behind"* whenever the node produced anything at all, while the
   * section that says so is only written for a `markdown-file` the step files itself. The
   * coordinator produces a `stored-result` and the implementer's file is filed by the
   * coordinator, so in the 21 September run **both** messages promised a closing section
   * and both ended without one — and the implementer said so, asking for "a report path
   * (named in the assignment)". An agent told to look for something that is not there is
   * an agent that goes looking.
   *
   * Two booleans rather than a rule, because the rule is not knowable here: the sections
   * are appended by the executor from a result store and an archive placement this module
   * has never seen. The executor builds both strings first and reports whether they came
   * out empty, so what is promised and what is carried are one decision.
   *
   * **Absent promises nothing.** A caller that does not say what it will append — the
   * editor's fixture run, and every test written before this — gets no announcement at
   * all, which is the honest direction to fail in.
   */
  readonly attachments?: {
    readonly receivedResults: boolean;
    readonly requiredResult: boolean;
    /**
     * Whether the run's own account of what it changed is appended (DSP-99).
     *
     * Optional, so a caller written before this card promises what it always promised.
     * The same direction of failure the two above take: absent announces nothing.
     */
    readonly runChange?: boolean;
  };
}

/**
 * That the agent is one step of a walk somebody else is driving.
 *
 * DSP-91 #3, and it belongs here rather than in a role file. The paragraph existed — in
 * `dspatch-run-coordinator.role.md`, for one node out of six — and every other step of
 * the 21 September run was told only that it had no history, never who was driving. So
 * the implementer asked for "a run manifest", and both agents behaved like someone who
 * had been handed a description of a loop and told to build it.
 *
 * It is one sentence per thing an agent would otherwise try to do for itself, because each
 * of those attempts spends a bounded call on work that is already done.
 *
 * Exported for the same reason {@link TASK_PRECEDENCE} is: DSP-94 puts this literal text
 * in the node panel, so what a reader is shown is the string that is sent.
 */
export const ENGINE_PREAMBLE: readonly string[] = [
  'You are one step inside a loop DSpatch is already walking. Its run engine \u2014 ' +
    'Maestro \u2014 opened this session, sent you this message, and will file what you ' +
    'reply, pick the next step from the drawing, call it, and stop the run when the ' +
    'drawing says to. The loop is running: it is not something for you to design, build ' +
    'or demonstrate.',
  'So you do not call other agents, do not choose what runs next, do not pass anything on ' +
    'yourself and do not keep the run\u2019s journal. All of that is being done for you, ' +
    'and attempting any of it spends calls this run is bounded by. Do your own step and ' +
    'hand back the result.',
];

/**
 * Which text governs when two texts in one message disagree.
 *
 * DSP-96 part 3, from DSP-92's F8 and F9. Both halves of the problem were already
 * carried and neither was ranked: a fresh step receives the person's own mandate *and*
 * an earlier agent's brief about it (`chatPromptFor`'s mandate block and the executor's
 * `describeReceivedResults`), and a person's mid-run message arrives ahead of both
 * (`instructionPreamble`) saying only that it "may add context, correct a
 * misunderstanding or change what is wanted". Nothing said which won, so the agent
 * decided — and 029's W2 is what deciding wrongly looks like: *do not read the project*
 * arriving at the next step as *do not read the whole project*.
 *
 * **What a later correction may change, and what it may not.** The first wording of this
 * said a later message leaves "every limit the assignment states" standing, which read
 * together with the sentence above it locked the one limit the person was in the middle of
 * changing: *"Läs inte projektet."* followed by *"Du får läsa README för att kontrollera
 * detta."* would have left README unreadable. A person may loosen, tighten or withdraw a
 * limit of their own; what stands is every *other* limit, and what a message from the
 * person cannot move is technical permission and the run's bounds. {@link
 * import('./loop-instruction').instructionPreamble} says the same thing from the message's
 * own side, in the same message, and the two are checked against each other in
 * `loop-chat.test.ts`.
 *
 * **This is four sentences and not a mechanism.** Nothing in the runner can notice a
 * weakening, because `loop-results.ts` refuses to open a result body to judge it, which
 * is right and stays right: a runtime that read one agent's prose to grade another's
 * would be inventing a verdict nobody could check. So precedence is stated to the party
 * that can act on it, in the message where both texts already are.
 *
 * Sent to every agent step, and the rework round is the one it was written for: that is
 * where a reviewer's account of the assignment arrives.
 *
 * **When this was written, neither of the two texts it ranks arrived there.** The
 * reasoning above was sound and the wiring under it was not: the reviewer's account did
 * not reach the rework round, because `received` was built from the node's static
 * `consumes` whatever edge arrived, and the person's own words did not either, because
 * `chatPromptFor` withheld the mandate from a revisit. So the round this paragraph
 * describes was a re-prompt with nothing new in it, and the implementer of 22 September
 * 2026 read the re-prompt itself as the answer to the question it had asked. DSP-100
 * made the sentence true from both sides rather than removing it: an edge now says what
 * it delivers, and a revisit is sent the mandate again.
 *
 * Exported as its own constant so DSP-94 can put this literal text on the screen rather
 * than a paraphrase of it, which is §3's "a separately maintained summary must not
 * replace the actual instructions".
 */
export const TASK_PRECEDENCE: readonly string[] = [
  '',
  'Where two things you have been given disagree, this is the order. The person\u2019s ' +
    'own words for this run are the assignment. Another step\u2019s brief, summary or ' +
    'quotation of them is that step\u2019s account of the work and does not replace them: ' +
    'where an account states a limit more narrowly than the person did, the person\u2019s ' +
    'wording is the one that holds, and the difference is worth saying plainly in your ' +
    'reply rather than quietly working to the narrower one.',
  'A later message from the same person is later on purpose. It updates the part of the ' +
    'assignment it actually concerns and leaves the rest of it standing \u2014 it is a ' +
    'correction, not a new assignment replacing the old one, unless it says so itself. ' +
    'What it concerns may be a limit: the person can loosen, tighten or withdraw a limit ' +
    'their own earlier wording set, and where they do, their later wording is the limit, ' +
    'for exactly what it names and no further. The other limits, the ones it does not ' +
    'touch, stand as they were.',
  'A limit the assignment states is part of it and not a preamble to it. Your role ' +
    'describes how you ordinarily work; where an ordinary routine of yours would cross a ' +
    'limit this task states, the limit governs and the routine is not performed on this ' +
    'step. Where you believe a limit cannot be honoured, say so and stop rather than ' +
    'softening it.',
  'None of this \u2014 a later message from the person included \u2014 widens what you may ' +
    'actually do. What you are permitted to reach, and the calls, time and rounds this run ' +
    'is bounded by, hold whatever any text here says about precedence.',
];

/**
 * The opening of a brief to an agent that has seen nothing of this run.
 *
 * Modelled on `docs/loop/HANDOFF.md`'s **Assignment** — identity, role, goal,
 * material — because that document was written for exactly this situation and is the
 * only description we have of a handover that has been used in anger. What is taken
 * from it is what a receiving party cannot work out for itself, and the omissions are
 * as deliberate as the inclusions: mandate and boundaries beyond the folders, initial
 * state, and the candidate snapshot are the development loop's own arrangements, not
 * the runner's, and a graph that wants them says so with `consumes` and its role text.
 *
 * **The one sentence that matters most is the third.** An agent that does not know it
 * has no shared history will assume one, and will answer as though the earlier steps
 * are behind it. Saying so is cheaper than every consequence of not saying it.
 */
/**
 * The sentence a revisited step is owed, and the principle behind it.
 *
 * DSP-100, and it is settled independently of anything about the mandate: **returning to
 * a node is not by itself an answer to a question the step asked.** The walk brought the
 * run back along an edge the drawing draws; nobody replied to anybody. On 22 September
 * 2026 an implementer that had ended its first visit with *"Please confirm which
 * reading … applies to this step"* was sent back by the review's rework edge with no new
 * material at all, opened its second reply with *"I understand the clarification."* and
 * then decided the question for itself in the narrower direction.
 *
 * The route is named where the caller knows it, because *which* arrival this is says more
 * than that there was one — a rework edge and a research answer coming back are different
 * situations and the drawing already distinguishes them. Where the caller does not know
 * it, the principle is still stated: it is the part that matters and it does not depend
 * on the route.
 */
function returningIsNotAnAnswer(step: ChatStepIdentity): string {
  const arrival = step.arrivedBy ?? null;
  const route =
    arrival === null
      ? 'The run has come back to this step along a route the drawing draws'
      : `The run has come back to this step along "${arrival.edgeId}"${
          arrival.label === null ? '' : ` (${arrival.label})`
        } from "${arrival.from}", which is a route the drawing draws`;
  return (
    `${route} — it is not a reply to you. Arriving here again is not by itself an answer to ` +
    `anything you asked on an earlier visit: if you asked a question and its answer is not ` +
    `somewhere in this message, it has not been answered, and the honest move is to say so ` +
    `rather than to decide it for yourself and carry on.`
  );
}

function stepIdentityPreamble(
  node: Pick<LoopNode, 'id' | 'label' | 'consumes' | 'produces'>,
  step: ChatStepIdentity,
): readonly string[] {
  const named = node.label === undefined ? `"${node.id}"` : `"${node.id}" (${node.label})`;
  // Promised only where the caller has said it will actually be written. See
  // `ChatStepIdentity.attachments` for the run this cost.
  const attached: string[] = [];
  if (step.attachments?.receivedResults === true) {
    attached.push(
      (node.consumes?.length ?? 0) > 1
        ? 'what earlier steps left for you'
        : 'what an earlier step left for you',
    );
  }
  if (step.attachments?.runChange === true) {
    attached.push('what this run has changed in the working folders so far');
  }
  if (step.attachments?.requiredResult === true) {
    attached.push('what you must leave behind');
  }
  const closing =
    attached.length === 0
      ? []
      : [
          `At the end of this message you will find ${
            // "a, and b" for two, "a, b, and c" for three. The plain join reads
            // "a, and b, and c" once there is a third section, which the run's account
            // of itself made reachable.
            attached.length < 3
              ? attached.join(', and ')
              : `${attached.slice(0, -1).join(', ')}, and ${attached[attached.length - 1] ?? ''}`
          }.`,
        ];
  if (!step.freshSession) {
    return [
      ...ENGINE_PREAMBLE,
      `You are continuing at step ${named} of DSpatch loop run ${step.runId}. This is ` +
        `visit ${String(step.occurrence)} to this step and call ${String(step.callId)} of the ` +
        `run, and you are the same agent that made the earlier visit${
          step.occurrence > 2 ? 's' : ''
        } — what you did then is above in this conversation.`,
      returningIsNotAnAnswer(step),
      ...closing,
      '',
    ];
  }
  return [
    ...ENGINE_PREAMBLE,
    `You are step ${named} of DSpatch loop run ${step.runId}, call ${String(step.callId)}.`,
    `You have not seen the rest of this run and there is no conversation behind this ` +
      `message: everything you have been given is in it. Other steps of this run are ` +
      `other agents, and they cannot see this either.`,
    ...closing,
    '',
  ];
}

export function chatPromptFor(
  node: Pick<
    LoopNode,
    'id' | 'kind' | 'purpose' | 'outcomes' | 'declaredFailures' | 'label' | 'consumes' | 'produces'
  >,
  options: {
    readonly entryId: string;
    readonly mandate: string;
    /**
     * The folders this run works with (DSP-72).
     *
     * Named in the prompt so an assignment about two repositories can say which is
     * which. `undefined` or a single root adds nothing, so every prompt written before
     * this card is unchanged. See {@link describeWorkingRootsForAgent} for why this
     * states where things are and says nothing about staying inside them.
     */
    readonly workingRoots?: readonly WorkingRoot[];
    /**
     * The role the graph names for this node, resolved. `undefined` from a caller that
     * does not resolve roles, which keeps every prompt written before DSP-46 byte for
     * byte what it was.
     */
    readonly role?: ChatRoleText | null;
    /**
     * Which step of which run this is (DSP-79).
     *
     * Left out by a caller that does not know — the editor's fixture run, and every
     * test written before per-node sessions — and then the prompt is byte for byte
     * what it was: one conversation's worth of turns, where a step's address is
     * implicit because the agent was there for the previous one.
     */
    readonly step?: ChatStepIdentity;
  },
): string {
  const preamble = rolePreamble(options.role);
  const declared = declarationInstructions(node.declaredFailures);
  const results = outcomeInstructions(node);
  // After the role and before the mandate, for the reason `rolePreamble` gives about
  // order: where the folders are is part of understanding the work, and a model that
  // reads the task before it knows there are two folders has already started planning
  // against one.
  const folders = describeWorkingRootsForAgent(options.workingRoots ?? []);
  const identity =
    options.step === undefined ? [] : stepIdentityPreamble(node, options.step);
  if (node.id === options.entryId) {
    const purpose = node.purpose?.trim() ?? '';
    return [
      ...preamble,
      ...identity,
      ...folders,
      'This is the entry step of a DSpatch chat loop. The text under Mandate is the work to do.',
      '',
      'Mandate:',
      options.mandate.trim(),
      ...(purpose === '' ? [] : ['', 'Standing purpose for this node:', purpose]),
      ...TASK_PRECEDENCE,
      '',
      // The first word, not somewhere in the reply. `declaredFailureFrom` reads only
      // the opening of the first line, so the instruction has to ask for the opening
      // of the first line. Mentioning either word later in a sentence is ordinary
      // English and must stay ordinary English.
      ...declared,
      ...results,
    ].join('\n');
  }
  const purpose = node.purpose?.trim();
  const task =
    purpose === undefined || purpose === ''
      ? `Continue the loop at "${node.id}".`
      : purpose;
  // The mandate, to every step and not only the entry.
  //
  // **This is the change that makes a handover a handover.** While every step shared
  // one conversation, the mandate was in the history and repeating it would have been
  // noise; a later step read its node's purpose and knew what the run was for because
  // it had watched the run. Its own agent has watched nothing. Sending it a purpose
  // with no mandate is the shape of handover the card warns about — one that passes
  // nothing and looks identical to one that works — because the step would answer a
  // generic instruction with no idea what was asked for.
  //
  // **A revisit is sent it too, which reverses DSP-79's decision on the strength of what
  // that decision cost** (DSP-100 #10). The reasoning for withholding it was that the
  // same agent already has it from its first visit, and that is true: the session is the
  // node's own. What the reasoning missed is what else is in the revisit message.
  // `TASK_PRECEDENCE` — sent on every visit, and its own comment says so in as many
  // words — tells the step that the person's wording is the assignment and that another
  // step's account of it is only an account, *"where an account states a limit more
  // narrowly than the person did, the person's wording is the one that holds"*. A rework
  // round is exactly where that account arrives. Ranking two texts against each other
  // while only one of them is in front of you is not a judgement anyone can make, and on
  // 22 September 2026 it was not made: the implementer took a reviewer's demands as the
  // assignment and narrowed the person's own limit to fit them.
  //
  // So the cost of sending it is one paragraph the agent has read before, and the cost of
  // withholding it is the one failure the whole precedence rule exists to prevent. The
  // wording says which visit it is, so a repeat is not mistaken for a new assignment —
  // the other direction this could fail in, and the reason it is not sent silently as
  // though it were the first time.
  const mandate =
    options.step === undefined
      ? []
      : [
          options.step.freshSession
            ? 'The run was started with this mandate. It is what the whole run is for:'
            : 'The run was started with this mandate, and it is repeated here unchanged so ' +
              'that it stands beside anything else in this message that describes the work. ' +
              'It is the same assignment as on your earlier visit, not a new one:',
          '',
          'Mandate:',
          options.mandate.trim(),
          '',
        ];
  return [
    ...preamble,
    ...identity,
    ...folders,
    ...mandate,
    ...(mandate.length === 0 ? [] : ['Your step:']),
    task,
    ...TASK_PRECEDENCE,
    '',
    ...declared,
    ...results,
  ].join('\n');
}

/* ------------------------------------------------------------------------- */
/* The same brief, described for a person                                      */
/* ------------------------------------------------------------------------- */

/**
 * One part of the brief a step is sent, named for whoever is reading the panel.
 *
 * DSP-83 asks the node panel to present *the material the agent is given*, and the
 * only honest way to do that is to describe the thing `chatPromptFor` above actually
 * builds. So this lives here rather than in the window: the function that assembles
 * the brief and the function that describes it are side by side, and
 * `loop-node-panel.test.ts` checks that every part described as carried really does
 * appear in the assembled text for the same node.
 *
 * `carried` is the distinction Niclas asked for — content that travels inside the call
 * against a file the agent is merely pointed at. A result left as a Markdown file is
 * **named, not quoted** (`describeReceivedResults`), and a role's own prose *is* quoted
 * whole. Both are "given to the step" and only one of them is in the message.
 */
export interface BriefPart {
  readonly id:
    | 'role'
    | 'provenance'
    | 'engine'
    | 'address'
    | 'folders'
    | 'mandate'
    | 'task'
    | 'precedence'
    | 'received'
    | 'run-change'
    | 'required-result'
    | 'declarations'
    | 'outcomes';
  /** What to call it in the window. */
  readonly heading: string;
  /** Whether the text itself is inside the message the agent receives. */
  readonly carried: boolean;
  /** What it is, and — when it is not carried, or not there at all — what happens instead. */
  readonly detail: string;
  /** False when this node's brief has no such part at all. */
  readonly present: boolean;
  /**
   * The exact lines this part puts in the message, where DSpatch is the author of them.
   *
   * DSP-94, from DSP-92's F4: three of the strongest sentences in the message are the
   * engine's own — {@link ENGINE_PREAMBLE}, the role headline carrying `ROLE_PROVENANCE`
   * and {@link TASK_PRECEDENCE} — and what the panel showed of them was a separately
   * written paraphrase, which §3 of the agent-behaviour guideline says must not stand in
   * for the instruction. These are read off the constants the prompt builder uses, so the
   * panel cannot drift from what is sent: `loop-node-help.test.ts` asserts every line
   * here appears verbatim in the assembled prompt for the same node.
   *
   * Absent for every part whose words come from the drawing, the person or another step
   * — those are shown elsewhere in the panel, or are not knowable before a run. The
   * `outcomes` part is the mixed case and carries only its engine-authored half (DSP-104
   * #2): the `RESULT:` lines are the drawing's names, the sentence about a name the run
   * cannot route is DSpatch's, and describing that one rather than showing it is how the
   * panel came to outlive the prompt it was describing.
   */
  readonly text?: readonly string[];
}

/**
 * What the message to this step contains, part by part.
 *
 * Only meaningful for an agent node: `loop-live.ts` builds a prompt for that kind and
 * for no other, which is why the panel asks {@link kindEffect} first and only shows
 * this where something is actually sent.
 */
export function briefParts(
  node: Pick<
    LoopNode,
    | 'id'
    | 'purpose'
    | 'outcomes'
    | 'whenUndeclared'
    | 'declaredFailures'
    | 'consumes'
    | 'produces'
    | 'role'
  >,
  options: {
    readonly entryId: string;
    /** The role as resolved, or `null` when the node names none or it resolves to nothing. */
    readonly role: ChatRoleText | null;
    /**
     * How many folders the run works with, or `null` where that is not yet known.
     *
     * `null` is the editor's honest answer: the roots come from the folders a person has
     * open when the run starts, and a drawing has no way to know them. Not `1`, which
     * would state a fact nobody established.
     */
    readonly workingRootCount: number | null;
    /** For each consumed id, what that node leaves — which decides quoted against named. */
    readonly producedBy: (nodeId: string) => { readonly form: ResultForm; readonly label: string } | null;
    /** The archive path this step's own result would land at, when the graph names one. */
    readonly archivePath: string | null;
    /** `report.writtenBy`: `self`, another node's id, or `null` when the graph says nothing. */
    readonly reportWrittenBy: string | null;
    /**
     * Every edge that leads to this node, so the panel can say what each arrival brings.
     *
     * DSP-100 #4 and #7. What a step receives can now differ by the route that reached
     * it, and a panel that showed one list would be showing one arrival's answer as
     * though it were the step's. Omitted — by a caller that has only the node — the
     * section describes the node's own `consumes` exactly as it did before, which is
     * still true of every arrival that declares nothing.
     */
    readonly arrivals?: readonly Pick<LoopEdge, 'id' | 'from' | 'label' | 'delivers'>[];
  },
): readonly BriefPart[] {
  const isEntry = node.id === options.entryId;
  const purpose = node.purpose?.trim() ?? '';
  const consumed = node.consumes ?? [];
  const roleInstructions = options.role?.instructions?.trim() ?? '';
  // Read off the same two functions the prompt uses, so the panel cannot describe a
  // question the message does not ask.
  const declarationWords = Object.entries(DECLARATION_TOKENS)
    .filter(([, failure]) => (node.declaredFailures ?? []).includes(failure))
    .map(([token]) => token);
  const answerableNames = [
    ...(node.outcomes ?? []),
    ...(node.declaredFailures ?? []).filter((name) => !(node.outcomes ?? []).includes(name)),
  ];

  const describeHandover = (id: string): string => {
    const produced = options.producedBy(id);
    if (produced === null || produced.form === 'none') {
      return (
        `“${id}” — that step leaves no result, so there is nothing to hand over. The run refuses ` +
        `to start rather than sending this step an empty handover.`
      );
    }
    return produced.form === 'markdown-file'
      ? `“${produced.label}” — its report is named by path. The agent opens the file itself; the ` +
        `message does not contain it, because the file is the result and a copy could disagree with it.`
      : `“${produced.label}” — its account is reproduced whole inside the message. There is no file ` +
        `to point at, so the text travels.`;
  };
  const received = consumed.map(describeHandover);

  // Which arrivals decide for themselves and which leave it to the node. Split rather
  // than listed together, because the two answer different questions: the first is *this
  // route brings this*, the second is *and every other route brings what the node says*.
  const arrivals = options.arrivals ?? [];
  const arrivalsThatDecide = arrivals.filter((edge) => edge.delivers !== undefined);
  const arrivalsThatDefer = arrivals.filter((edge) => edge.delivers === undefined);
  const describeArrival = (
    edge: Pick<LoopEdge, 'id' | 'from' | 'label' | 'delivers'>,
  ): string => {
    const named = `Arriving on “${edge.label ?? edge.id}” from “${edge.from}”`;
    const delivers = edge.delivers ?? [];
    return delivers.length === 0
      ? `${named}: nothing is handed over, which this arrival says for itself rather than ` +
        `leaving to the step’s own declaration.`
      : `${named}: ${delivers.map(describeHandover).join(' ')}`;
  };
  const receivedDetail = ((): string => {
    if (arrivalsThatDecide.length === 0) {
      return consumed.length === 0
        ? 'Nothing. This step is given no earlier step’s result, so everything it knows is the ' +
            'mandate, its role and its task.'
        : `The same on every route to this step, because no arrival says otherwise. ${received.join(' ')}`;
    }
    const otherwise =
      arrivalsThatDefer.length === 0
        ? 'Every arrival at this step says what it brings, so the step’s own “consumes” decides ' +
          'nothing here.'
        : `Arriving any other way (${arrivalsThatDefer
            .map((edge) => `“${edge.label ?? edge.id}”`)
            .join(', ')}): ${
            consumed.length === 0
              ? 'nothing is handed over, because the step declares no “consumes” of its own.'
              : received.join(' ')
          }`;
    return (
      `What this step receives depends on the route that reached it. ` +
      `${arrivalsThatDecide.map(describeArrival).join(' ')} ${otherwise}`
    );
  })();

  // Whether the run's own measurement can reach this step at all, and whether it reaches
  // it always or only on some arrivals. See the `run-change` part below.
  const handedOnSomeArrival = arrivalsThatDecide.some((edge) => (edge.delivers ?? []).length > 0);
  const carriesOnSomeRoute = carriesRunChange(node) || handedOnSomeArrival;
  const onlyOnSomeRoutes =
    carriesRunChange(node) || !handedOnSomeArrival
      ? ''
      : 'Only on the arrivals that hand this step something, which is where the run’s own ' +
        'measurement has an account to sit beside. Arriving any other way, the step declares ' +
        'no “consumes” and this section is not sent.';

  return [
    {
      id: 'role',
      heading: 'The role, as its author wrote it',
      carried: roleInstructions !== '',
      present: options.role !== null,
      detail:
        options.role === null
          ? 'This node names no role, or the reference resolves to nothing. Nothing about who is ' +
            'doing the work reaches the agent.'
          : roleInstructions === ''
            ? `${options.role.sourcePath} was read and holds no instructions beyond its name, so the ` +
              `message says the role was named and nothing more. That is worth fixing in the file.`
            : `Every word of ${options.role.sourcePath} goes into the message, between markers, before ` +
              `the task — because who is doing the work has to be read before what the work is. The ` +
              `path is not in the message: it is relative to the definition’s resources, which means ` +
              `something else from where the agent is standing, and one that was sent it went looking ` +
              `in the project and called the assignment mistaken.`,
    },
    {
      id: 'provenance',
      heading: 'What the message says about where the role came from',
      carried: options.role !== null,
      present: options.role !== null,
      // A statement about where the line sits, not about what it says: what it says is
      // below it, word for word, because that is the whole point of this part.
      detail:
        options.role === null
          ? 'No role, so no such sentence is written and the agent is told nothing about one.'
          : 'Written immediately above the role, and the reason there is no path in it is that a ' +
            'path measured from the definition’s resources means somewhere else entirely from ' +
            'where the agent is standing. As sent:',
      ...(options.role === null ? {} : { text: [roleHeadlineFor(options.role)] }),
    },
    {
      id: 'engine',
      heading: 'What DSpatch says about the run, on its own account',
      carried: true,
      present: true,
      detail:
        'Added to every agent step of every run, from the engine rather than from the drawing or ' +
        'the role. It is the answer to what an agent would otherwise try to work out for itself. ' +
        'As sent:',
      text: ENGINE_PREAMBLE,
    },
    {
      id: 'address',
      heading: 'Which step of which run this is',
      carried: true,
      present: true,
      detail:
        'The run id, this step’s name, which visit it is and which call of the run. Each agent node ' +
        'has its own session, so a step is told it has not seen the rest of the run and that the ' +
        'other steps are other agents.',
    },
    {
      id: 'folders',
      heading: 'The folders the run works with',
      carried: true,
      present: true,
      detail:
        options.workingRootCount === null
          ? 'Decided when the run starts, from the folders the person has open — a drawing cannot ' +
            'know them. All of them are named, working folder first, so an assignment about two ' +
            'repositories can say which is which — and so can one about a single repository, which ' +
            'is why the one-folder case is named too rather than left implicit in the agent’s cwd.'
          : options.workingRootCount > 1
            ? `All ${String(options.workingRootCount)} folders are named, working folder first, so an ` +
              `assignment about more than one repository can say which is which.`
            : 'The one folder is named, with the note that it is an address rather than an ' +
              'instruction: whether the assignment needs anything read or changed there is decided ' +
              'by the task.',
    },
    {
      id: 'mandate',
      heading: 'The mandate the run was started with',
      carried: true,
      present: true,
      detail: isEntry
        ? 'The text a person typed is the task of this step. It is the whole of what the run was ' +
          'asked for, and how it ranks against everything else in the message is stated below in ' +
          'the words the step is sent.'
        : 'Repeated to every step, fresh or revisited, because its own session has no history of ' +
          'the run and a task with no mandate is a handover that passes nothing. A revisit is sent ' +
          'it too, said to be the same assignment rather than a new one: the revisit is where ' +
          'another step’s account of the assignment arrives, and ranking that account against the ' +
          'person’s own words cannot be done when only one of them is in the message. What holds ' +
          'when the two disagree is stated below, in the words the step is sent.',
    },
    {
      id: 'task',
      heading: isEntry ? 'This node’s standing purpose' : 'This step’s task',
      carried: true,
      present: true,
      detail:
        purpose === ''
          ? isEntry
            ? 'Nothing written, so the message carries the mandate alone.'
            : `Nothing written, so the message says only “Continue the loop at "${node.id}".” That ` +
              `is the whole instruction this step would get. Write one.`
          : isEntry
            ? 'Sent after the mandate as this node’s standing purpose, so a person’s own words lead.'
            : 'The purpose of this node, sent as the task. It is the only thing telling this agent ' +
              'what its step is for.',
    },
    {
      id: 'precedence',
      heading: 'Which of them governs where two disagree',
      carried: true,
      present: true,
      detail:
        'Sent to every agent step, after the task: the entry step, a fresh later step, and a ' +
        'revisit — which is the round where an earlier step’s account of the assignment arrives, ' +
        'and the reason both that account and the person’s own words have to be in the same ' +
        'message for this to be a ranking anyone could make. As sent:',
      // The blank line that separates it from the task in the prompt is not part of what
      // it says, so it is not shown as though it were.
      text: TASK_PRECEDENCE.filter((line) => line !== ''),
    },
    {
      id: 'received',
      heading: 'What earlier steps left for it',
      carried: false,
      present: consumed.length > 0 || arrivalsThatDecide.some((edge) => (edge.delivers ?? []).length > 0),
      detail: receivedDetail,
    },
    {
      id: 'run-change',
      heading: 'What the run has changed in the working folders',
      // The measurement itself travels inside the message, which is the whole of DSP-99:
      // the figures were already computed for the journal, and the journal is in nobody's
      // prompt.
      //
      // Asked of every route and not only of `consumes` (DSP-100), because the run asks
      // it of what the step was actually handed. A step that declares no `consumes` and
      // is handed a review by its rework edge does get this section on that round, and a
      // panel saying otherwise would be describing a rule the runner stopped following.
      carried: carriesOnSomeRoute,
      present: carriesOnSomeRoute,
      detail: carriesOnSomeRoute
        ? `${onlyOnSomeRoutes === '' ? '' : `${onlyOnSomeRoutes} `}Because this step is handed an earlier step\u2019s account of its own work, it is also ` +
          'handed DSpatch\u2019s own comparison of the folders between two moments \u2014 the same ' +
          'computation the run journal\u2019s "Changed:" line is written from, with both moments it ' +
          'looked named as instants and the later one said to be the walk after the most recently ' +
          'finished step rather than the end of the run. It is put as an observation and not as an ' +
          'attribution: a difference between two looks does not establish who made it. Which files, ' +
          'or that none differ, is known only while a run is happening; what is fixed is that the ' +
          'message says which of three things it is. A run that changed nothing says so, and a run ' +
          'whose changes were not measured \u2014 no snapshot yet, or a drawing where nothing could ' +
          'write and the hashing was skipped \u2014 says that instead, never "nothing". As sent, in ' +
          'every one of the three:'
        : 'This step is given no earlier step\u2019s result on any route to it, so there is no ' +
          'account of anybody\u2019s work for the run\u2019s measurement to sit beside, and none is ' +
          'sent. The entry step is being told what the run is for, before it has changed anything.',
      ...(carriesOnSomeRoute ? { text: RUN_CHANGE_NOTE } : {}),
    },
    {
      id: 'required-result',
      heading: 'What it must leave behind',
      // A file the agent has to write is named in the message; a reply the runner files
      // needs nothing said to the agent at all, which is why this is not always carried.
      carried:
        node.produces?.form === 'markdown-file' &&
        (options.reportWrittenBy === null || options.reportWrittenBy === REPORT_WRITTEN_BY_SELF),
      present: node.produces !== undefined && node.produces.form !== 'none',
      detail:
        node.produces === undefined || node.produces.form === 'none'
          ? 'Nothing is required of this step, so nothing is said about it.'
          : node.produces.form === 'markdown-file'
            ? options.reportWrittenBy !== null && options.reportWrittenBy !== REPORT_WRITTEN_BY_SELF
              ? `The graph names “${options.reportWrittenBy}” as the writer, so the runner files this ` +
                `step’s reply itself and the message asks the agent for no file. A step told to write ` +
                `a report it is not responsible for is how one assignment ends up with two reports ` +
                `that can disagree.`
              : `The message names the file to write${
                  options.archivePath === null ? '' : ` — ${options.archivePath}`
                }, and says the run checks that it arrived${
                  node.produces.required ? '' : ', though this one is not required'
                }.`
            : 'The step’s own reply is the result. The run keeps it in the record and hands it to ' +
              'whichever step consumes this node.',
    },
    {
      id: 'declarations',
      heading: 'How to say the premise is wrong, or that it is blocked',
      carried: declarationWords.length > 0,
      present: declarationWords.length > 0,
      detail:
        declarationWords.length === 0
          ? 'This node declares neither spec-error nor blocked, so the message does not ask for ' +
            'either word. Asking for one the drawing cannot route is how a step that correctly ' +
            'refused its work came to be read as having done it.'
          : `${declarationWords.join(' and ')} as the opening of the reply — and only ` +
            `${declarationWords.length === 1 ? 'that one' : 'those'}, because a failure this node ` +
            `does not declare has no edge to take.`,
    },
    {
      id: 'outcomes',
      heading: 'The names it may answer with',
      carried: answerableNames.length > 0,
      present: answerableNames.length > 0,
      detail:
        answerableNames.length === 0
          ? 'This node declares none, so an ordinary reply leaves on plain success.'
          : `The message asks for a whole line “${RESULT_TOKEN} <name>” using one of ${answerableNames
              .map((name) => `“${name}”`)
              .join(', ')}. The failure names are listed with the verdicts so that every branch the ` +
            `drawing can take has a form the agent was actually taught. What the run does with a ` +
            `name it cannot route is the message’s own sentence rather than a description of one:`,
      // DSP-104 #2. This part described the sentence instead of showing it, and the
      // description outlived what it described: it still said a missing name was "read as
      // a result it could not establish" after DSP-103 had made that the node's own
      // `whenUndeclared` and the prompt had stopped saying it. The names come from the
      // drawing, which is why the lines listing them stay out of `text`; the reader they
      // describe is DSpatch's, so its sentence is read off the builder.
      ...(answerableNames.length === 0 ? {} : { text: [resultLineSentence(node)] }),
    },
  ];
}

/**
 * What the brief never contains, whatever the graph says.
 *
 * Stated rather than computed, because it is a property of how the brief is built: the
 * role text is copied in whole, and everything the role text *mentions* is a path the
 * agent has to open with its own tools. A panel that showed the role and said nothing
 * about this would imply the agent had already read `AGENTS.md`.
 */
export const BRIEF_EXCLUSIONS: readonly string[] = [
  'Any file the role text links to or names — AGENTS.md, a contract, a document under docs/. ' +
    'The agent is told to read them and has to open them itself with its own tools.',
  'The project’s code. The session is opened in the working folder and the agent reads what it ' +
    'needs; nothing is pasted in ahead of time.',
  'Anything other steps of this run said. Each agent node has its own session, so only a result ' +
    'this node consumes crosses between them.',
];

export function modelForChatNode(
  node: Pick<LoopNode, 'model'> | undefined,
  inherited: string,
): string {
  if (node?.model?.policy === 'fixed' && node.model.model !== undefined && node.model.model !== '') {
    return node.model.model;
  }
  return inherited;
}

export interface ChatLiveNode {
  readonly kind: NodeKind | string;
  readonly label: string;
}

export interface ChatLiveLookup {
  node(id: string): ChatLiveNode | null;
  edge(id: string): Pick<LoopEdge, 'label' | 'to'> | null;
}

/**
 * Labels the chat window can show without loading the graph file.
 *
 * Kept in the same module as the graph id so a test can check they still match
 * the file. Not a second source of routing — only names for the live log.
 */
export const CHAT_LOOP_WINDOW_LOOKUP: ChatLiveLookup = {
  node(id) {
    const known: Record<string, ChatLiveNode> = {
      work: { kind: 'agent', label: 'Do what was asked' },
      check: { kind: 'agent', label: 'Check the work' },
      done: { kind: 'terminal', label: 'Assignment met' },
      'not-met': { kind: 'terminal', label: 'Assignment not met' },
      'not-established': { kind: 'terminal', label: 'Could not establish' },
      stopped: { kind: 'terminal', label: 'Stopped without doing the work' },
    };
    return known[id] ?? null;
  },
  edge(id) {
    const known: Record<string, { readonly label: string; readonly to: string }> = {
      'e-succeeded': { label: 'work succeeded', to: 'check' },
      'e-unclear': { label: 'work unclear', to: 'not-established' },
      'e-spec': { label: 'spec-error', to: 'stopped' },
      'e-blocked': { label: 'blocked', to: 'stopped' },
      'e-met': { label: 'assignment met', to: 'done' },
      'e-not-met': { label: 'assignment not met', to: 'not-met' },
      'e-could-not-check': { label: 'could not check', to: 'not-established' },
      'e-check-spec': { label: 'spec-error while checking', to: 'not-established' },
      'e-check-blocked': { label: 'blocked while checking', to: 'not-established' },
    };
    return known[id] ?? null;
  },
};

export function lookupFromGraph(graph: Pick<LoopGraph, 'nodes' | 'edges'>): ChatLiveLookup {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  return {
    node: (id) => {
      const found = nodes.get(id);
      return found === undefined ? null : { kind: found.kind, label: found.label ?? found.id };
    },
    edge: (id) => edges.get(id) ?? null,
  };
}

/**
 * The endings that have to say why, when the journal recorded no reason.
 *
 * Exported for `loop-transcript.ts`, which needs the same three sentences for the
 * same three endings. Reused rather than reworded: the window saying two different
 * things about one ending in two places is a defect the previous run already found.
 */
export function endingWithoutDetail(
  kind: 'runtime-fault' | 'limit-reached' | 'awaiting-human',
): string {
  switch (kind) {
    case 'runtime-fault':
      return (
        'The run stopped on a runtime fault and recorded no reason for it. Treat the outcome ' +
        'as unknown and check the project before anything is repeated.'
      );
    case 'limit-reached':
      return (
        'The run spent one of its bounds and recorded no reason for it. Check the run journal ' +
        'for which bound before anything is repeated.'
      );
    case 'awaiting-human':
      return (
        'The run is waiting for a person and recorded no question. Check the run journal for ' +
        'what it stopped on before anything is repeated.'
      );
  }
}

/**
 * One short English sentence for the conversation column, or null to skip.
 *
 * Entered node (kind + label), produced outcome, taken branch, run ended.
 * The debug journal stays in the editor — with three exceptions. A fault, a spent
 * bound and a pending human decision are the endings where the status word alone
 * tells the user nothing, and `detail` on those entries is already written for
 * whoever has to reconcile the run: the cause, and what must be established
 * before anything is repeated. It is passed through whole. A reconciliation
 * instruction that has been summarised is worse than none.
 */
export function formatChatLiveLogLine(
  entry: RunJournalEntry,
  lookup: ChatLiveLookup,
): string | null {
  switch (entry.kind) {
    case 'node-entered': {
      const node = entry.nodeId === undefined ? null : lookup.node(entry.nodeId);
      const kind = node?.kind ?? (typeof entry.data?.['kind'] === 'string' ? entry.data['kind'] : 'node');
      const label = node?.label ?? entry.nodeId ?? 'a node';
      return `Entered ${kind} “${label}”.`;
    }
    case 'node-produced': {
      const product =
        typeof entry.data?.['product'] === 'string' ? entry.data['product'] : 'an outcome';
      return `Produced ${product}.`;
    }
    case 'edge-taken': {
      const edge = entry.edgeId === undefined ? null : lookup.edge(entry.edgeId);
      const toId =
        typeof entry.data?.['to'] === 'string' ? entry.data['to'] : (edge?.to ?? null);
      const dest = toId === null ? null : lookup.node(toId);
      const branch =
        edge?.label ??
        (typeof entry.data?.['outcome'] === 'string'
          ? entry.data['outcome']
          : typeof entry.data?.['failure'] === 'string'
            ? entry.data['failure']
            : (entry.edgeId ?? 'a branch'));
      return `Took branch “${branch}” to ${dest?.label ?? toId ?? 'the next node'}.`;
    }
    case 'run-ended': {
      const status = typeof entry.data?.['status'] === 'string' ? entry.data['status'] : 'ended';
      return `Run ended: ${status}.`;
    }
    case 'runtime-fault':
    case 'limit-reached':
    case 'awaiting-human': {
      const detail = entry.detail.trim();
      return detail === '' ? endingWithoutDetail(entry.kind) : detail;
    }
    // DSP-51. The one moment in a run where DSpatch needs something from the person
    // and the only one that had no line here, so the conversation sat on `Entered
    // gate "…"` for up to ten minutes while the question waited in another column.
    // Passed through whole for the reason a fault is: the side that decided to wait
    // is the side that knows what it is waiting for and where the answer goes, and a
    // summary of that written here would be this module guessing at it.
    case 'waiting-for-person':
      return entry.detail.trim() === ''
        ? 'DSpatch is waiting for you before this step can go on.'
        : entry.detail.trim();
    case 'person-answered':
      return entry.detail.trim() === ''
        ? 'DSpatch has your answer and is going on.'
        : entry.detail.trim();
    // DSP-74. One line, because a result the run checked for and found is a fact about
    // the step that the outcome alone does not carry — and because the alternative is a
    // conversation that never mentions the thing the step was required to leave.
    case 'result-filed': {
      const ref = typeof entry.data?.['archiveRef'] === 'string' ? entry.data['archiveRef'] : null;
      return ref === null ? null : `Left its result: ${ref}.`;
    }
    // Recorded, and deliberately not narrated here. The run's start and its bookkeeping
    // are the editor's journal; a held and released step is the pause control's own
    // business and the window shows it elsewhere; and a refusal is reported by the
    // ending sentence — `describeLoopEnding` passes the runner's reason through whole —
    // rather than as a line in the middle of a log for a run that never began.
    case 'run-started':
    case 'refused':
    case 'run-held':
    case 'run-released':
      return null;
    default: {
      // Every journal kind, listed. This is what the switch was missing on 20 September
      // 2026, when an edit that appeared only to *add* a case silently removed
      // `person-answered` and `default: return null` swallowed it — the conversation
      // simply stopped mentioning that a person had answered, and a test caught it
      // rather than the compiler. Adding a kind to JOURNAL_KINDS now fails to compile
      // here until somebody decides what the conversation should say about it, and
      // deleting a case fails the same way. A silent kind above is a decision; a silent
      // kind by omission was an accident waiting to repeat.
      const unhandled: never = entry.kind;
      void unhandled;
      return null;
    }
  }
}

/**
 * Which canceller a stop action has to reach.
 *
 * `chat-loop` asks the main process to stop the walk; `agent-run` is the ordinary
 * single-agent path — cancel the run, or abandon the send that has not produced
 * one yet.
 */
export type ChatCancelTarget = 'chat-loop' | 'agent-run';

export interface ChatCancelPlan {
  readonly target: ChatCancelTarget;
  /**
   * Whether this action has to clear the loop-busy flag itself.
   *
   * True for an action that abandons the send. Abandoning bumps the send
   * generation, so the send's own generation-guarded cleanup no longer matches
   * and never runs; if nothing clears the flag here it stays true after the loop
   * run has ended, and the next stop action is routed at a loop that is no longer
   * there while a real run continues uncancelled.
   */
  readonly clearLoopBusy: boolean;
}

export function planChatCancel(state: {
  /** Whether a chat-loop walk belongs to the send being stopped. */
  readonly loopBusy: boolean;
  /** True for Stop waiting, which gives up on the send; false for Cancel, which does not. */
  readonly abandonsSend: boolean;
}): ChatCancelPlan {
  return {
    target: state.loopBusy ? 'chat-loop' : 'agent-run',
    clearLoopBusy: state.abandonsSend,
  };
}

/** The loop-busy flag the window is left holding after acting on `plan`. */
export function loopBusyAfterChatCancel(loopBusy: boolean, plan: ChatCancelPlan): boolean {
  return plan.clearLoopBusy ? false : loopBusy;
}

/**
 * The window's send state, as far as the loop-busy flag is concerned.
 *
 * `generation` names the send the window is waiting on; `loopBusy` says whether
 * that send walks the chat loop. Both live in refs in the chat window, and this
 * module is the one place that decides how they move together.
 */
export interface ChatSendState {
  readonly generation: number;
  readonly loopBusy: boolean;
}

export type ChatSendEvent =
  /** Send pressed. `walksLoop` is the Use loop toggle at the moment of the press. */
  | { readonly kind: 'send-started'; readonly walksLoop: boolean }
  /** A send's own cleanup, naming the generation it belongs to. */
  | { readonly kind: 'send-settled'; readonly generation: number };

/**
 * How a send event moves the send generation and the loop-busy flag.
 *
 * The invariant this exists to hold: **no path may leave the loop-busy flag true
 * once the send that set it can no longer clear it.** A send stops being able to
 * clear its own flag as soon as something bumps the generation past it, and only
 * two things do — another send, and *Stop waiting*. Both write the flag as they
 * go: a send through `send-started` here, *Stop waiting* through
 * `loopBusyAfterChatCancel` above. *Cancel* bumps nothing, so the send it
 * interrupts keeps its own cleanup and clears the flag there.
 */
export function chatSendAfter(state: ChatSendState, event: ChatSendEvent): ChatSendState {
  switch (event.kind) {
    case 'send-started':
      // Every send establishes the flag, an ordinary one included. Cancel clears
      // `busy` while the aborted walk is still outstanding, so a new send can begin
      // before the old walk settles; establishing the flag here is what stops that
      // walk's flag from being left true underneath the new send, where Cancel
      // would route at a loop that has already been asked to stop.
      return { generation: state.generation + 1, loopBusy: event.walksLoop };
    case 'send-settled':
      // Guarded, because a send that settles late must not clear a flag a newer
      // send has set — two sends in a row would otherwise have the older one turn
      // the newer one's flag off. Skipping is safe precisely because
      // `send-started` has already established the flag for the newer send.
      return event.generation === state.generation ? { ...state, loopBusy: false } : state;
  }
}

export function newChatLoopRunId(): string {
  return `chat-loop-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
}

export function requiredForKind(kind: NodeKind): string {
  switch (kind) {
    case 'agent':
      return 'A role description.';
    case 'gate':
      return 'At least two outcomes.';
    case 'router':
      return 'At least two outcomes.';
    case 'human':
      return 'A purpose the person can act on.';
    case 'external':
      return 'A label; this loop does not run it.';
    case 'terminal':
      return 'Nothing further; the run stops here.';
  }
}

/**
 * The tooltip: what this step is for, and what the runner does when it gets there.
 *
 * DSP-83 #4. It still reads `purpose` and deliberately adds no second field for the
 * same information — a tooltip field beside a purpose field is two texts about one
 * step, and the one that is wrong is whichever nobody edited. What it adds is the part
 * a purpose cannot know about itself: what actually happens at this kind of node, which
 * is read off the executor in {@link kindEffect} rather than guessed from the format.
 *
 * A missing purpose says so as a gap to fill rather than as a bare absence, because for
 * an agent step it is the whole of what that agent will be told its step is.
 */
export function nodeHelpText(node: Pick<LoopNode, 'kind' | 'purpose' | 'label' | 'id'>): string {
  const written = node.purpose?.trim() ?? '';
  const opening =
    written === ''
      ? `Nothing is written about what "${node.label ?? node.id}" is for.`
      : written;
  return `${opening} ${kindEffect(node.kind).whatTheRunnerDoes} Required: ${requiredForKind(node.kind)}`;
}
