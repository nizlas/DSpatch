/**
 * The chat window's one loop: activate it, type as usual, walk dspatch-chat-loop.
 *
 * Editor Run stays bound to the duration graph. This module is the other binding:
 * composer text is the entry mandate, later nodes use their purpose, and the
 * conversation column shows short sentences rather than the debug journal.
 */

import type { LoopEdge, LoopGraph, LoopNode, NodeKind } from './loop-graph';
import { FORBIDDEN_LIVE_GRAPH_ID, type LiveBinding } from './loop-editor-run';
import type { RunJournalEntry } from './loop-run';

export const CHAT_LOOP_GRAPH_ID = 'dspatch-chat-loop';
export const CHAT_LOOP_GRAPH_REL = 'docs/loop/graphs/dspatch-chat-loop.graph.json';

export function describeChatLoopBinding(graph: {
  readonly id: string;
  readonly name: string;
}): LiveBinding {
  if (graph.id === FORBIDDEN_LIVE_GRAPH_ID) {
    return {
      ready: false,
      state: 'forbidden',
      reason:
        `Refusing to walk "${graph.name}" (${graph.id}) from chat. That drawing is the ` +
        `external DSpatch development loop. A live writing turn must not use DSpatch ` +
        `itself as a workspace. Use loop walks ${CHAT_LOOP_GRAPH_ID} on the project ` +
        `already open in chat.`,
    };
  }
  if (graph.id !== CHAT_LOOP_GRAPH_ID) {
    return {
      ready: false,
      state: 'unbound',
      reason:
        `Use loop walks ${CHAT_LOOP_GRAPH_ID} only. "${graph.name}" (${graph.id}) has no ` +
        `chat binding. Editor Run stays bound to dspatch-live-duration; Dry-run still ` +
        `walks whatever is on the canvas.`,
    };
  }
  return {
    ready: true,
    state: 'ready',
    reason:
      `Use loop is ready for ${CHAT_LOOP_GRAPH_ID}. Send walks this graph on the project ` +
      `already open in chat. The composer's text is the mandate for the entry node; ` +
      `later nodes use their purpose. Switching Use loop off cancels without resetting files.`,
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

/** Cheap fallbacks when a reply declares nothing readable. */
export const UNCLEAR_OUTCOME = 'unclear';
export const COULD_NOT_CHECK_OUTCOME = 'could-not-check';

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
 * {@link undeclaredReadableOutcome} (only helps a node that draws `unclear` or
 * `could-not-check`) and landed on plain `success` — the same product a step that
 * did the work and said so produces. On the chat loop that was survivable by
 * accident, because both its agent nodes happen to draw a readable fallback; on
 * any drawing that does not, silence routed as success down the success edge.
 *
 * An accident is not a guarantee, so the rule is stated here rather than left to
 * each graph's outcome list. Silence is never success. Where the node draws a name
 * for "we could not establish this", silence takes it — that is a real ending the
 * drawing provides and it is honest. Where it draws none, `null` says so and the
 * caller raises a runtime fault, because a step that was asked a question and
 * answered nothing has delivered no outcome, and the run has nothing to route on.
 *
 * `null` from a *non-empty* reply would be wrong and is impossible: this is only
 * consulted for text that is empty once trimmed.
 */
export function emptyReplyOutcome(
  declared: readonly string[],
): { readonly outcome: string; readonly why: string } | null {
  const readable = undeclaredReadableOutcome(declared);
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
 * The cheap fallback when a reply declared nothing readable.
 *
 * `unclear` if the node draws it, otherwise `could-not-check` if it draws that.
 * A node that draws neither — `dspatch-live-duration`'s implementer — keeps plain
 * success. The expensive error is a false `met`; finishing as unclear is cheap.
 */
export function undeclaredReadableOutcome(
  declared: readonly string[],
): { readonly outcome: string; readonly why: string } | null {
  if (declared.includes(UNCLEAR_OUTCOME)) {
    return {
      outcome: UNCLEAR_OUTCOME,
      why:
        `The reply did not declare a readable RESULT for this step, so the run treats ` +
        `the work as unclear rather than guessing.`,
    };
  }
  if (declared.includes(COULD_NOT_CHECK_OUTCOME)) {
    return {
      outcome: COULD_NOT_CHECK_OUTCOME,
      why:
        `The reply did not declare a readable RESULT for this step, so the run treats ` +
        `the check as not established rather than guessing.`,
    };
  }
  return null;
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
    // Said rather than omitted. A step whose role resolved to no prose is a step whose
    // drawing claims something its role file does not supply, and the agent is the one
    // party that can notice the role it was handed is not the one the work needs.
    return [
      `You are performing the role "${role.id}", declared for this step in the loop ` +
        `drawing and written in ${role.sourcePath}. DSpatch read no instructions from ` +
        `that file beyond its name, so this is all the role says.`,
      '',
    ];
  }
  return [
    `You are performing the role "${role.id}", declared for this step in the loop ` +
      `drawing and written in ${role.sourcePath}. Everything between the markers below ` +
      `is that role as its author wrote it. It governs how you work, and the task ` +
      `follows it.`,
    '',
    ROLE_BLOCK_OPEN,
    instructions,
    ROLE_BLOCK_CLOSE,
    '',
  ];
}

function outcomeInstructions(outcomes: readonly string[] | undefined): readonly string[] {
  if (outcomes === undefined || outcomes.length === 0) {
    return [];
  }
  return [
    '',
    'When you finish this step, write a whole line exactly in this form, using one of these names and nothing else on that line:',
    ...outcomes.map((name) => `${RESULT_TOKEN} ${name}`),
    'A missing or contradictory name is read as you could not establish the result. Do not invent a name.',
  ];
}

function declarationInstructions(): readonly string[] {
  return [
    'If the premise is wrong, begin your reply with the word SPEC_ERROR, then a sentence.',
    'If you cannot do the work, begin your reply with the word BLOCKED, then a sentence.',
  ];
}

export function chatPromptFor(
  node: Pick<LoopNode, 'id' | 'kind' | 'purpose' | 'outcomes'>,
  options: {
    readonly entryId: string;
    readonly mandate: string;
    /**
     * The role the graph names for this node, resolved. `undefined` from a caller that
     * does not resolve roles, which keeps every prompt written before DSP-46 byte for
     * byte what it was.
     */
    readonly role?: ChatRoleText | null;
  },
): string {
  const preamble = rolePreamble(options.role);
  const declared = declarationInstructions();
  const results = outcomeInstructions(node.outcomes);
  if (node.id === options.entryId) {
    const purpose = node.purpose?.trim() ?? '';
    return [
      ...preamble,
      'This is the entry step of a DSpatch chat loop. The text under Mandate is the work to do.',
      '',
      'Mandate:',
      options.mandate.trim(),
      ...(purpose === '' ? [] : ['', 'Standing purpose for this node:', purpose]),
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
  return [...preamble, task, '', ...declared, ...results].join('\n');
}

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
    default:
      return null;
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

export function nodeHelpText(node: Pick<LoopNode, 'kind' | 'purpose' | 'label' | 'id'>): string {
  const purpose = node.purpose?.trim() || `No purpose written for ${node.label ?? node.id}.`;
  return `${purpose} Required: ${requiredForKind(node.kind)}`;
}
