/**
 * DSP-189: the walk loop's executor, and the run around it.
 *
 * The drawing `docs/loop/graphs/dspatch-walk-loop.graph.json` is walked by the run engine
 * (`runLoopGraph`): which role runs next, what it is handed, the one correction round and
 * the journal are the engine's. What this module adds is the executor for review work, which
 * is what the engine injects: for the planner one provider turn and the same mechanical checks
 * and single repair turn today's one call gets; for the writer one turn per step in its own
 * session; for the reviewer one turn whose JSON verdict is the node's declared outcome. Every
 * prompt and answer goes into a run record in the loop's own format, and the engine's journal
 * with it, under the review's generated folder; the job keeps a summary.
 *
 * Nothing here routes. An outcome the executor returns is one the drawing declares, and the
 * drawing says where it leads; a turn that does not finish ends the run as a runtime fault,
 * and nothing is resent.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createFileResultStore } from '../main/loop-result-store';
import { resolvedRolesWith } from '../main/loop-graph-open';
import { RunRecordWriter, graphVersionIdFor } from '../main/run-record-store';
import type { LoopNode, ResolvedRole, RoleReference, RoleResolver } from '../shared/loop-graph';
import { loadLoopGraph } from '../shared/loop-graph-load';
import type { RecordedRunEnding } from '../shared/loop-record';
import type { WalkLoopFollow } from './walk-loop-follow';
import { runLoopGraph, type RunResult, type StepContext, type StepExecution } from '../shared/loop-run';
import type { PublicProfile } from '../shared/presentation-profiles';
import {
  answerJson,
  crowdedStepProblems,
  repairPrompt,
  repairedIsKept,
  repeatedStepProblems,
  walkPlaceProblems,
  walkYield,
  type AnalysisMaterial,
  type ContextReader,
  type LineReader,
  type ProposedWalks,
} from '../shared/review-agent';
import type { AgentMaterial, PairFile } from '../shared/review-pair';
import {
  WALK_LOOP_GRAPH_ID,
  WALK_LOOP_LIMIT_FAILURE,
  WALK_LOOP_NODES,
  WALK_LOOP_REWORK_OUTCOMES,
  planPrompt,
  readPlanAnswer,
  readReviewAnswer,
  readStepText,
  reviewOutcomeOf,
  reviewPrompt,
  stepRefsOf,
  stepSignature,
  withTexts,
  writeStepPrompt,
  type PlannedStepRef,
  type StepText,
  type WalkFinding,
  type WalkLoopStatus,
  type WalkLoopSummary,
  type WalkLoopTurn,
  type WalkLoopUsage,
  type WalkPlan,
  type WalkReview,
} from '../shared/walk-loop';

export interface WalkLoopTurnResult {
  readonly status: 'finished' | 'failed' | 'cancelled' | 'unconfirmed';
  readonly text: string;
  readonly error: string | null;
  /** The provider session the turn ran in, for the record. */
  readonly sessionId: string | null;
}

/** What the job service lends the run: one analysis session per role, and the turns in it. */
export interface WalkLoopSessions {
  /** Open the role's session in the revision folder. Called once per node, before its first turn. */
  open(nodeId: string): Promise<void>;
  /** One provider turn in the node's session, awaited to the provider's own end. */
  turn(nodeId: string, prompt: string): Promise<WalkLoopTurnResult>;
  /** The usage readings the provider reported since the last call. Empty is "reported nothing". */
  usageSinceLast(): readonly WalkLoopUsage[];
}

export interface WalkLoopIdentity {
  readonly projectPath: string;
  readonly mandate: string;
  readonly modelRequested: string;
  readonly provider: 'cursor' | 'claude' | 'copilot';
  readonly appVersion: string;
}

export interface WalkLoopInput {
  readonly graphText: string;
  /** For the record: where the drawing is, relative to DSpatch's resources. */
  readonly graphPath: string;
  readonly resolveRole: RoleResolver;
  readonly material: AnalysisMaterial;
  readonly folder: AgentMaterial;
  readonly language: 'sv' | 'en';
  readonly profile: PublicProfile;
  /** The pair's files, for the yield comparison of the planner's repair turn. */
  readonly files: readonly PairFile[];
  /** Lines at a side, from Git, for the mechanical check of every place. */
  readonly read: LineReader;
  readonly context: ContextReader | null;
  readonly sessions: WalkLoopSessions;
  /** Where the run's record and results go: `<generated>/<review>/<job>.walk-loop/`. */
  readonly recordDir: string;
  readonly identity: WalkLoopIdentity;
  readonly signal: AbortSignal;
  readonly activity: (text: string) => void;
  readonly log: (message: string) => void;
  readonly now?: () => number;
  /** DSP-190: where the run announces itself, its journal, its turns and its verdicts, for the windows that follow it. */
  readonly follow?: WalkLoopFollow;
}

export type WalkLoopOutcome =
  | {
      readonly kind: 'delivered';
      readonly walks: ProposedWalks;
      /** Places that do not exist at their commit, by `w.s.p`, found by the planner's mechanical check. */
      readonly invalid: ReadonlyMap<string, string>;
      readonly repairNote: string | null;
      readonly objections: boolean;
      readonly summary: WalkLoopSummary;
    }
  /** A provider turn did not finish: cancelled, failed or unconfirmed. The job service says which. */
  | { readonly kind: 'ended-early'; readonly turn: WalkLoopTurnResult; readonly summary: WalkLoopSummary }
  | { readonly kind: 'failed'; readonly note: string; readonly detail: string; readonly summary: WalkLoopSummary | null };

/** Thrown inside the executor when a turn did not finish, so the engine records the fault and stops. */
class TurnEnded extends Error {
  readonly turn: WalkLoopTurnResult;

  constructor(turn: WalkLoopTurnResult) {
    super(`The provider turn ended ${turn.status}${turn.error === null ? '' : `: ${turn.error}`}`);
    this.turn = turn;
  }
}

const EMPTY_SNAPSHOTS = { beforeId: null, beforeFileCount: 0, afterId: null, afterFileCount: 0, changed: [], added: [], removed: [], truncated: null } as const;

export const WALK_LOOP_RECORD_FILE = 'record.jsonl';
export const WALK_LOOP_SUMMARY_FILE = 'summary.json';

export async function runWalkLoop(input: WalkLoopInput): Promise<WalkLoopOutcome> {
  const now = input.now ?? (() => Date.now());
  const loaded = loadLoopGraph(input.graphText, { resolveRole: input.resolveRole, connectedTargets: null });
  if (!loaded.ok || loaded.graph === null) {
    const errors = loaded.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message);
    return { kind: 'failed', note: 'The walk loop\'s drawing could not be loaded, so nothing was sent.', detail: errors.join(' '), summary: null };
  }
  const graph = loaded.graph;
  const roles = new Map<string, ResolvedRole>();
  for (const node of graph.nodes) {
    if (node.kind === 'agent' && node.role !== undefined) {
      const role = input.resolveRole(node.role);
      if (role === null) {
        return { kind: 'failed', note: `The role of the "${node.id}" step could not be read, so nothing was sent.`, detail: node.role.source.path, summary: null };
      }
      roles.set(node.id, role);
    }
  }
  const runId = `walk-${randomUUID()}`;
  const graphVersionId = graphVersionIdFor(input.graphText);
  fs.mkdirSync(input.recordDir, { recursive: true });
  const recordPath = path.join(input.recordDir, WALK_LOOP_RECORD_FILE);
  const resultsDir = path.join(input.recordDir, 'results');
  const writer = new RunRecordWriter(recordPath);
  const startedAtUtc = new Date().toISOString();
  const startedMs = now();
  writer.start({
    runId,
    projectPath: input.identity.projectPath,
    conversationId: null,
    mandate: input.identity.mandate,
    graphId: graph.id,
    graphPath: input.graphPath,
    graphVersionId,
    modelRequested: input.identity.modelRequested,
    provider: input.identity.provider,
    appVersion: input.identity.appVersion,
    startedAtUtc,
  });
  // DSP-190: the run announces itself to the windows that follow it, with the drawing it walks
  // and the roles as resolved, so a window draws this run's picture from this run's bindings.
  const references = graph.nodes.flatMap((node): RoleReference[] => (node.role === undefined ? [] : [node.role]));
  input.follow?.announce({
    runId,
    graphVersionId,
    graphId: graph.id,
    graphName: graph.name,
    binding: 'walk-loop',
    graphText: input.graphText,
    startedAtUtc,
    roles: resolvedRolesWith(references, input.resolveRole),
    phase: 'running',
    agent: `${input.identity.provider}/${input.identity.modelRequested === '' ? 'default' : input.identity.modelRequested}`,
  });

  // --- The run's state, kept across steps by the executor's closure ------------------------
  const opened = new Set<string>();
  const turns: WalkLoopTurn[] = [];
  const usage: WalkLoopUsage[] = [];
  let plan: WalkPlan | null = null;
  let planRaw: unknown = null;
  let previousRefs: readonly PlannedStepRef[] = [];
  let invalid = new Map<string, string>();
  let repairNote: string | null = null;
  let texts = new Map<string, StepText>();
  const reviews: WalkReview[] = [];
  let replanned = false;
  const rewritten: string[] = [];
  let lastTurn: WalkLoopTurnResult | null = null;

  /** One provider turn in the node's session. `what` is DSpatch's sentence about it, for the job line and the run view. */
  async function turn(context: StepContext, prompt: string, what: string, stepId?: string): Promise<WalkLoopTurnResult> {
    const nodeId = context.node.id;
    const role = roles.get(nodeId);
    input.activity(what);
    if (!opened.has(nodeId)) {
      await input.sessions.open(nodeId);
      opened.add(nodeId);
    }
    input.follow?.turnStarted({ nodeId, occurrence: context.occurrence }, stepId ?? null, role?.id ?? null, what);
    const startedAt = new Date().toISOString();
    const t0 = now();
    const result = await input.sessions.turn(nodeId, prompt);
    const endedAt = new Date().toISOString();
    turns.push({ node: nodeId, occurrence: context.occurrence, ...(stepId === undefined ? {} : { stepId }), startedAt, endedAt, durationMs: Math.max(0, now() - t0) });
    usage.push(...input.sessions.usageSinceLast());
    input.follow?.turnEnded(result.status, result.error, result.text.length);
    writer.reply({
      atUtc: endedAt,
      nodeId,
      nodeLabel: context.node.label ?? nodeId,
      occurrence: context.occurrence,
      text: result.text,
      terminalStatus: result.status,
      prompt,
      ...(role === undefined ? {} : { roleId: role.id, roleSourcePath: role.sourcePath }),
      ...(result.sessionId === null ? {} : { sessionId: result.sessionId }),
    });
    lastTurn = result;
    if (result.status !== 'finished') {
      throw new TurnEnded(result);
    }
    return result;
  }

  function stepIds(): ReadonlySet<string> {
    return new Set(plan === null ? [] : stepRefsOf(plan.walks).map((ref) => ref.stepId));
  }

  async function planStep(context: StepContext, role: ResolvedRole): Promise<StepExecution> {
    const revisit = context.occurrence > 1;
    const findings = revisit ? (reviews.at(-1)?.findings.filter((finding) => finding.kind === 'structure') ?? []) : [];
    const first = await turn(
      context,
      planPrompt({ role, material: input.material, folder: input.folder, language: input.language, rework: revisit ? { findings, earlierPlan: JSON.stringify(planRaw, null, 2) } : null }),
      revisit ? 'Planning the walks again from the reviewer\'s findings' : 'Planning the walks',
    );
    let providerTurns = 1;
    let raw = answerJson(first.text);
    let parsed = readPlanAnswer(raw);
    say('Checking every place against the commits');
    let places = parsed.plan === null ? new Map<string, string>() : await walkPlaceProblems(parsed.plan.walks, input.read, input.context);
    const crowded = parsed.plan === null ? new Map<string, string>() : new Map([...crowdedStepProblems(parsed.plan.walks), ...[...repeatedStepProblems(parsed.plan.walks)].map(([at, problem]) => [`r${at}`, problem] as const)]);
    // The same one repair turn today's single call gets, inside the planner's step. Never a loop.
    if (parsed.plan === null || parsed.problems.length > 0 || places.size > 0 || crowded.size > 0) {
      const problems = [...parsed.problems, ...places.values(), ...crowded.values()];
      input.follow?.note(`DSpatch found ${String(problems.length)} problem(s) in the plan: ${problems.join(' ')}`);
      const second = await turn(context, repairPrompt(problems), `Asking the planner to correct ${String(problems.length)} problem(s) DSpatch found`);
      providerTurns += 1;
      const againRaw = answerJson(second.text);
      const again = readPlanAnswer(againRaw);
      if (again.plan !== null) {
        const againPlaces = await walkPlaceProblems(again.plan.walks, input.read, input.context);
        if (parsed.plan === null || repairedIsKept(walkYield(parsed.plan.walks, places, input.files), walkYield(again.plan.walks, againPlaces, input.files))) {
          parsed = again;
          raw = againRaw;
          places = againPlaces;
        } else {
          repairNote = 'The planner was asked once to correct its plan; its correction kept fewer valid places or covered fewer changed lines, so its first plan is kept as written.';
          input.follow?.note(repairNote);
        }
      }
    }
    if (parsed.plan === null) {
      input.follow?.note('The planner gave no plan DSpatch could read, even when asked again: the step declares itself blocked.');
      return { product: { kind: 'declared-failure', failure: 'blocked' }, summary: 'The planner gave no plan DSpatch could read, even when asked again.', providerTurns };
    }
    previousRefs = plan === null ? [] : stepRefsOf(plan.walks);
    plan = parsed.plan;
    planRaw = raw;
    invalid = places;
    replanned = revisit;
    const refs = stepRefsOf(plan.walks);
    const summary = `${String(plan.walks.walks.length)} walk(s), ${String(refs.length)} step(s)${places.size === 0 ? '' : `, ${String(places.size)} place(s) not at their commit`}${revisit ? ', planned again from the reviewer\'s findings' : ''}.`;
    input.follow?.note(`Plan read: ${summary}`);
    return {
      product: { kind: 'outcome', outcome: revisit ? 'replanned' : 'planned' },
      summary,
      providerTurns,
      resultBody: JSON.stringify(raw, null, 2),
    };
  }

  /** DSpatch's own status between turns: on the job line and in the run view. */
  function say(text: string): void {
    input.activity(text);
    input.follow?.note(text);
  }

  /** The findings about one step, by its id in the plan the findings were written against. */
  function findingsFor(stepId: string, idMap: ReadonlyMap<string, string>): readonly WalkFinding[] {
    const review = reviews.at(-1);
    if (review === undefined) {
      return [];
    }
    return review.findings.filter((finding) => finding.kind === 'explanation' && finding.steps.some((named) => (idMap.get(named) ?? named) === stepId));
  }

  async function writeStep(context: StepContext, role: ResolvedRole): Promise<StepExecution> {
    if (plan === null) {
      throw new Error('The writer was reached without a plan.');
    }
    const current = plan;
    const refs = stepRefsOf(current.walks);
    const revisit = context.occurrence > 1;
    // After a replan, a step keeps its text when its places and title are unchanged, whatever
    // its new id; the reviewer's findings named the old ids and are mapped the same way.
    const idMap = new Map<string, string>();
    let toWrite: readonly PlannedStepRef[];
    if (!revisit) {
      toWrite = refs;
    } else {
      const bySignature = new Map(previousRefs.map((ref) => [stepSignature(ref.step), ref.stepId] as const));
      const carried = new Map<string, StepText>();
      for (const ref of refs) {
        const oldId = bySignature.get(stepSignature(ref.step));
        const old = oldId === undefined ? undefined : texts.get(oldId);
        if (oldId !== undefined) {
          idMap.set(oldId, ref.stepId);
        }
        if (old !== undefined) {
          carried.set(ref.stepId, old);
        }
      }
      if (previousRefs.length === 0) {
        // The plan did not change: the ids are the same ids.
        for (const ref of refs) {
          const old = texts.get(ref.stepId);
          if (old !== undefined) {
            carried.set(ref.stepId, old);
          }
        }
      }
      texts = carried;
      toWrite = refs.filter((ref) => !carried.has(ref.stepId) || findingsFor(ref.stepId, idMap).length > 0);
    }
    let providerTurns = 0;
    let fresh = !opened.has(context.node.id);
    let unreadable = 0;
    for (const [index, ref] of toWrite.entries()) {
      const findings = revisit ? findingsFor(ref.stepId, idMap) : [];
      const earlier = texts.get(ref.stepId);
      const result = await turn(
        context,
        writeStepPrompt({
          role,
          plan: current,
          stepId: ref.stepId,
          profile: input.profile,
          language: input.language,
          material: input.material,
          folder: input.folder,
          fresh,
          rework: findings.length === 0 ? null : { findings, earlierText: earlier === undefined ? '' : `${earlier.body}${earlier.details === '' ? '' : `\n\n${earlier.details}`}` },
        }),
        `${revisit ? 'Writing again' : 'Writing'} step ${ref.stepId} (${String(index + 1)} of ${String(toWrite.length)})`,
        ref.stepId,
      );
      fresh = false;
      providerTurns += 1;
      const text = readStepText(result.text);
      if (text === null) {
        unreadable += 1;
        texts.set(ref.stepId, { body: '', details: '' });
      } else {
        texts.set(ref.stepId, text);
      }
      if (revisit) {
        rewritten.push(ref.stepId);
      }
    }
    const summary = `${String(toWrite.length)} step(s) written${revisit ? ` again, ${String(refs.length - toWrite.length)} kept` : ''}${unreadable === 0 ? '' : `, ${String(unreadable)} answer(s) empty`}.`;
    input.follow?.note(summary);
    return {
      product: { kind: 'outcome', outcome: 'written' },
      summary,
      providerTurns,
      resultBody: JSON.stringify({ steps: Object.fromEntries([...texts.entries()].map(([id, text]) => [id, text])) }, null, 2),
    };
  }

  async function reviewStep(context: StepContext, role: ResolvedRole): Promise<StepExecution> {
    if (plan === null) {
      throw new Error('The reviewer was reached without a plan.');
    }
    const final = context.occurrence > 1;
    const result = await turn(
      context,
      reviewPrompt({
        role,
        plan,
        texts,
        profile: input.profile,
        language: input.language,
        material: input.material,
        folder: input.folder,
        final,
        earlier: final ? (reviews[0] ?? null) : null,
        fresh: !opened.has(context.node.id) || context.occurrence === 1,
      }),
      final ? 'The reviewer gives its final assessment' : 'The reviewer reads the walks against the code',
    );
    const parsed = readReviewAnswer(answerJson(result.text), stepIds(), final);
    const review: WalkReview =
      parsed.review ??
      { assessment: `The reviewer's answer could not be read (${parsed.problems.join(' ')}); the walks are kept as written.`, verdict: 'accept', findings: [] };
    reviews.push(review);
    const outcome = reviewOutcomeOf(review);
    input.follow?.verdict(review, final);
    const summary = `${final ? 'Final assessment' : 'Review'}: ${outcome}${review.findings.length === 0 ? '' : `, ${String(review.findings.length)} finding(s) about ${[...new Set(review.findings.flatMap((finding) => finding.steps))].join(', ') || 'the walks'}`}.`;
    input.follow?.note(`${summary}${parsed.review === null ? ' (the answer could not be read; accepted by the engine\'s fallback)' : ''}`);
    return {
      product: { kind: 'outcome', outcome, source: parsed.review === null ? 'engine-fallback' : 'step-declared' },
      summary,
      providerTurns: 1,
      resultBody: JSON.stringify(review, null, 2),
    };
  }

  const executor = async (context: StepContext): Promise<StepExecution> => {
    const node: LoopNode = context.node;
    const role = roles.get(node.id);
    if (node.kind !== 'agent' || role === undefined) {
      return { product: { kind: 'runtime-fault', fault: 'executor-threw', detail: `The walk loop's executor has no work for a "${node.kind}" step called "${node.id}".` }, summary: 'Not a step this executor runs.', providerTurns: 0 };
    }
    if (node.id === WALK_LOOP_NODES.plan) {
      return planStep(context, role);
    }
    if (node.id === WALK_LOOP_NODES.write) {
      return writeStep(context, role);
    }
    if (node.id === WALK_LOOP_NODES.review) {
      return reviewStep(context, role);
    }
    return { product: { kind: 'runtime-fault', fault: 'executor-threw', detail: `The walk loop's executor knows no step called "${node.id}".` }, summary: 'Not a step this executor runs.', providerTurns: 0 };
  };

  let result: RunResult;
  try {
    result = await runLoopGraph(graph, {
      runId,
      executor,
      signal: input.signal,
      dryRun: false,
      now,
      reworkOutcomes: [...WALK_LOOP_REWORK_OUTCOMES],
      routeLimitAs: WALK_LOOP_LIMIT_FAILURE,
      resultStore: createFileResultStore(resultsDir),
      onJournalEntry: (entry) => {
        writer.journal(entry);
        input.follow?.journal(entry);
      },
    });
  } catch (error) {
    // The engine records an executor that throws as a fault; this is for anything outside it.
    const detail = error instanceof Error ? error.message : String(error);
    writer.finish(ending({ endedAtUtc: new Date().toISOString(), kind: 'failed', status: null, terminalNodeId: null, note: detail, cancelled: false }));
    input.follow?.ended({ status: null, note: detail, terminalNodeId: null });
    input.follow?.close();
    return { kind: 'failed', note: 'The walk loop stopped before it could deliver walks.', detail, summary: null };
  }

  const durationMs = Math.max(0, now() - startedMs);
  const terminal = result.terminalNodeId;
  // Read through functions: the executor's closures assigned these, which the narrowing above does not see.
  const ended = ((): WalkLoopTurnResult | null => lastTurn)();
  const planAtEnd = ((): WalkPlan | null => plan)();
  const endedEarly = ended !== null && ended.status !== 'finished';
  const status: WalkLoopStatus =
    result.status === 'completed' && terminal === 'delivered'
      ? 'delivered'
      : result.status === 'completed' && terminal === 'delivered-with-objections'
        ? 'delivered-with-objections'
        : result.status === 'completed' && terminal === 'stopped'
          ? 'stopped'
          : endedEarly
            ? ended.status === 'cancelled'
              ? 'cancelled'
              : ended.status === 'unconfirmed'
                ? 'unknown'
                : 'failed'
            : 'failed';
  const summary: WalkLoopSummary = {
    runId,
    graphId: graph.id,
    graphVersionId,
    roles: [...roles.values()].map((role) => ({ id: role.id, sourcePath: role.sourcePath })),
    recordPath,
    resultsDir,
    status,
    path: result.path,
    first: reviews[0] ?? null,
    final: reviews.length > 1 ? (reviews.at(-1) ?? null) : null,
    rounds: result.usage.reworkRounds > 0 ? 1 : 0,
    replanned,
    rewritten,
    turns,
    durationMs,
    usage: usage.length === 0 ? 'unknown' : usage,
  };
  const note =
    status === 'delivered'
      ? 'The reviewer accepted the walks.'
      : status === 'delivered-with-objections'
        ? 'The walks are delivered with the reviewer\'s remaining objections on record.'
        : status === 'stopped'
          ? 'The planner gave no walks DSpatch could read.'
          : status === 'cancelled'
            ? 'Stopped.'
            : (result.fault?.detail ?? result.refusal ?? 'The run did not reach an end DSpatch can name.');
  writer.finish(
    ending({
      endedAtUtc: new Date().toISOString(),
      kind: status === 'cancelled' ? 'cancelled' : status === 'delivered' || status === 'delivered-with-objections' || status === 'stopped' ? 'finished' : 'failed',
      status: result.status,
      terminalNodeId: terminal,
      note,
      cancelled: status === 'cancelled',
    }),
  );
  try {
    fs.writeFileSync(path.join(input.recordDir, WALK_LOOP_SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  } catch (error) {
    input.log(`walk loop ${runId}: the summary could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
  input.follow?.ended({ status: result.status, note, terminalNodeId: terminal });
  input.follow?.close();
  for (const failure of writer.failures()) {
    input.log(`walk loop ${runId}: ${failure}`);
  }
  if (endedEarly && ended !== null) {
    return { kind: 'ended-early', turn: ended, summary };
  }
  if ((status === 'delivered' || status === 'delivered-with-objections') && planAtEnd !== null) {
    return { kind: 'delivered', walks: withTexts(planAtEnd.walks, texts), invalid, repairNote, objections: status === 'delivered-with-objections', summary };
  }
  if (status === 'stopped') {
    return { kind: 'failed', note: 'The planner did not answer with walks DSpatch could read, even when asked again.', detail: '', summary };
  }
  return {
    kind: 'failed',
    note: 'The walk loop did not deliver walks.',
    detail: result.fault === null ? (result.refusal ?? `The run ended ${result.status} at ${terminal ?? 'no terminal'}.`) : `${result.fault.kind}: ${result.fault.detail}`,
    summary,
  };

  function ending(parts: { endedAtUtc: string; kind: 'finished' | 'cancelled' | 'failed'; status: RunResult['status'] | null; terminalNodeId: string | null; note: string; cancelled: boolean }): RecordedRunEnding {
    return {
      endedAtUtc: parts.endedAtUtc,
      kind: parts.kind,
      status: parts.status,
      terminalNodeId: parts.terminalNodeId,
      outcome: 'verification-not-performed',
      outcomeText: 'Code walks were prepared; this loop runs no command and verifies nothing of the code.',
      modelRequested: input.identity.modelRequested,
      modelReported: null,
      commands: [],
      snapshots: EMPTY_SNAPSHOTS,
      note: parts.note,
      cancelled: parts.cancelled,
      cost: 'unknown',
    };
  }
}

export { WALK_LOOP_GRAPH_ID };
