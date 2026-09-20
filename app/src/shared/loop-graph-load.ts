/**
 * Reading a loop graph, and refusing one that is not a loop graph.
 *
 * Two rules shape this file.
 *
 * **An invalid graph is refused, not partially loaded.** A half-loaded graph is worse
 * than none: the editor would draw a picture that is not the file, and the runner would
 * execute a loop nobody drew. So {@link parseLoopGraph} returns a graph or it returns
 * findings, never both.
 *
 * **A finding says what is wrong and where, in terms a person can act on.** Each one
 * carries the node or edge it is about so the editor can point at it, and a message
 * written for the author rather than for whoever wrote the validator. "invalid edge" is
 * not a finding; "edge `e12` routes on outcome `rewrite`, which `implementation-review`
 * does not declare — it declares accept, rework, needs-decision" is.
 *
 * Validation happens in two passes for a reason. The first is structural and works on
 * unknown JSON; if it fails there is nothing coherent to check further. The second is
 * semantic and works on an already-typed graph, which is what the editor needs while
 * the author is still typing — it can revalidate an in-memory graph without writing a
 * file first.
 */

import {
  ATTRIBUTE_SUPPORT,
  EDGE_CONDITIONS,
  LOOP_GRAPH_FORMAT,
  LOOP_GRAPH_FORMAT_VERSION,
  LOOP_TARGETS,
  NODE_KINDS,
  REPORT_WRITTEN_BY_SELF,
  REQUIREMENTS,
  ROLE_SOURCE_KINDS,
  RUNTIME_FAULT_POLICIES,
  TARGET_CAPABILITIES,
  capabilityAnswer,
  effectiveRequirements,
  namesARuntimeFault,
  runnableHere,
} from './loop-graph';
import type {
  ArchivePolicy,
  EdgeCondition,
  FailureKind,
  LoopEdge,
  LoopGraph,
  LoopNode,
  LoopTarget,
  ModelPolicy,
  NodeKind,
  ReportPolicy,
  RequirementId,
  ResolvedRole,
  RoleReference,
  RoleResolver,
  RunnableHere,
  StepLimits,
  TargetCapabilities,
} from './loop-graph';

export type FindingSeverity = 'error' | 'warning' | 'notice';

export interface Finding {
  readonly severity: FindingSeverity;
  /** A stable identifier for the rule, for tests and for the editor to group by. */
  readonly code: string;
  /** What is wrong and what to do about it, addressed to the author. */
  readonly message: string;
  /** Where in the file, as a JSON pointer, so the editor can navigate to it. */
  readonly pointer: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

export type ParseResult =
  | { readonly ok: true; readonly graph: LoopGraph }
  | { readonly ok: false; readonly findings: readonly Finding[] };

export type LoadResult =
  | {
      readonly ok: true;
      readonly graph: LoopGraph;
      /** Warnings and notices only. Any error means `ok` is false. */
      readonly findings: readonly Finding[];
      readonly runnable: RunnableHere;
    }
  | { readonly ok: false; readonly graph: null; readonly findings: readonly Finding[] };

export interface CheckOptions {
  /**
   * How to reach a role description. Without one, role references are reported as
   * *unchecked* rather than passed: "not checked" and "resolves to nothing" are
   * different answers and the second is an error.
   */
  readonly resolveRole?: RoleResolver;
  /** Which frameworks this machine is connected to. `null` means it was not established. */
  readonly connectedTargets?: readonly LoopTarget[] | null;
  /** Overridable so a test can exercise a target that cannot meet a requirement. */
  readonly targetCapabilities?: TargetCapabilities;
}

class Findings {
  private readonly items: Finding[] = [];

  add(finding: Finding): void {
    this.items.push(finding);
  }

  error(code: string, pointer: string, message: string, ids: Ids = {}): void {
    this.items.push({ severity: 'error', code, pointer, message, ...ids });
  }

  warning(code: string, pointer: string, message: string, ids: Ids = {}): void {
    this.items.push({ severity: 'warning', code, pointer, message, ...ids });
  }

  notice(code: string, pointer: string, message: string, ids: Ids = {}): void {
    this.items.push({ severity: 'notice', code, pointer, message, ...ids });
  }

  get all(): readonly Finding[] {
    return this.items;
  }

  get hasError(): boolean {
    return this.items.some((item) => item.severity === 'error');
  }
}

interface Ids {
  readonly nodeId?: string;
  readonly edgeId?: string;
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}

/**
 * One finding per line, worst first, in a form that reads the same in a terminal and
 * in a dialogue box. The editor is free to render its own; this is what a person gets
 * when something else has to explain the refusal.
 */
export function formatFindings(findings: readonly Finding[]): string {
  const order: Record<FindingSeverity, number> = { error: 0, warning: 1, notice: 2 };
  return [...findings]
    .sort((left, right) => order[left.severity] - order[right.severity])
    .map((finding) => {
      const where = finding.nodeId
        ? `node "${finding.nodeId}"`
        : finding.edgeId
          ? `edge "${finding.edgeId}"`
          : finding.pointer === '' ? 'the graph' : finding.pointer;
      return `${finding.severity}: ${where}: ${finding.message} [${finding.code}]`;
    })
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function quoteList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

/**
 * Read a graph from text, checking only what the file can be judged on by itself.
 *
 * Role references, target capabilities and reachability are not judged here — they
 * need a resolver, an environment or the whole graph, and they are {@link checkLoopGraph}'s
 * work. What is judged here is whether this text is a loop graph at all.
 */
export function parseLoopGraph(text: string): ParseResult {
  const findings = new Findings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    findings.error(
      'not-json',
      '',
      `This file is not valid JSON, so it cannot be read as a loop graph and has not ` +
        `been changed: ${describe(error)}`,
    );
    return { ok: false, findings: findings.all };
  }

  if (!isRecord(parsed)) {
    findings.error(
      'not-an-object',
      '',
      'A loop graph is a JSON object. This file contains something else, so there is ' +
        'nothing to load.',
    );
    return { ok: false, findings: findings.all };
  }

  if (parsed['format'] !== LOOP_GRAPH_FORMAT) {
    findings.error(
      'wrong-format',
      '/format',
      `This does not look like a loop graph: its "format" is ` +
        `${JSON.stringify(parsed['format']) ?? 'absent'}, and a loop graph says ` +
        `"${LOOP_GRAPH_FORMAT}". If this is a graph, add that field; if it is something ` +
        `else, it has not been touched.`,
    );
    return { ok: false, findings: findings.all };
  }

  const version = parsed['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    findings.error(
      'bad-format-version',
      '/formatVersion',
      `"formatVersion" must be a whole number from 1 upwards; this file has ` +
        `${JSON.stringify(version)}. Without it there is no way to know which rules ` +
        `this file was written against.`,
    );
    return { ok: false, findings: findings.all };
  }
  if (version > LOOP_GRAPH_FORMAT_VERSION) {
    findings.error(
      'newer-format-version',
      '/formatVersion',
      `This graph is format version ${String(version)} and this build understands ` +
        `${String(LOOP_GRAPH_FORMAT_VERSION)}. It has not been loaded and must not be ` +
        `saved by this build: a newer DSpatch may have written fields this one would ` +
        `drop. Open it in the DSpatch that wrote it, or upgrade.`,
    );
    return { ok: false, findings: findings.all };
  }

  const id = nonEmptyString(parsed['id']);
  if (id === null) {
    findings.error(
      'missing-id',
      '/id',
      'A graph needs its own "id". There will be more than one loop — a small one and ' +
        'a large one, or one per kind of task — and a graph without an identity cannot ' +
        'be referred to, compared or chosen.',
    );
  } else if (/\s/.test(id)) {
    findings.error('bad-id', '/id', `The graph id "${id}" contains whitespace. Use a short slug.`);
  }

  const name = nonEmptyString(parsed['name']);
  if (name === null) {
    findings.error('missing-name', '/name', 'A graph needs a "name" a person can read in a list.');
  }

  const purpose = nonEmptyString(parsed['purpose']);
  if (purpose === null) {
    findings.error(
      'missing-purpose',
      '/purpose',
      '"purpose" must say what kind of work this loop is for, in a sentence. It is what ' +
        'tells a set of loops apart when there are several, and what makes choosing one ' +
        'a decision rather than a guess.',
    );
  }

  const target = parsed['target'];
  if (typeof target !== 'string' || !(LOOP_TARGETS as readonly string[]).includes(target)) {
    findings.error(
      'bad-target',
      '/target',
      `"target" must be one of ${quoteList(LOOP_TARGETS)}; this file has ` +
        `${JSON.stringify(target)}. The target is stored in the file and chosen by the ` +
        `author: it is never taken from whoever opens it, because then the same file ` +
        `would mean different things on two machines.`,
    );
  }

  const onRuntimeFault = parsed['onRuntimeFault'];
  if (
    typeof onRuntimeFault !== 'string' ||
    !(RUNTIME_FAULT_POLICIES as readonly string[]).includes(onRuntimeFault)
  ) {
    findings.error(
      'bad-runtime-fault-policy',
      '/onRuntimeFault',
      `"onRuntimeFault" must be one of ${quoteList(RUNTIME_FAULT_POLICIES)}; this file ` +
        `has ${JSON.stringify(onRuntimeFault)}. It records what happens when the runner ` +
        `gives up on a step that never finished. That is not something the graph routes ` +
        `on, which is why it is one field here instead of an edge on every node.`,
    );
  }

  const failureKinds = parseFailureKinds(parsed['failureKinds'], findings);
  const limits = parseLimits(parsed['limits'], '/limits', findings);
  const archive = parseArchive(parsed['archive'], findings);
  const nodes = parseNodes(parsed['nodes'], findings);
  const edges = parseEdges(parsed['edges'], findings);

  const entry = nonEmptyString(parsed['entry']);
  if (entry === null) {
    findings.error(
      'missing-entry',
      '/entry',
      '"entry" must name the node the run starts at. Without it a runner would have to ' +
        'guess, and the guess would differ from the editor\'s.',
    );
  }

  if (findings.hasError) {
    return { ok: false, findings: findings.all };
  }

  const graph: LoopGraph = {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: version,
    id: id as string,
    name: name as string,
    purpose: purpose as string,
    target: target as LoopTarget,
    entry: entry as string,
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds,
    ...(limits ? { limits } : {}),
    ...(archive ? { archive } : {}),
    nodes,
    edges,
    ...(nonEmptyString(parsed['notes']) ? { notes: parsed['notes'] as string } : {}),
  };
  return { ok: true, graph };
}

function parseFailureKinds(value: unknown, findings: Findings): readonly FailureKind[] {
  if (value === undefined) {
    findings.error(
      'missing-failure-kinds',
      '/failureKinds',
      '"failureKinds" must be present, even as an empty list. It is the vocabulary the ' +
        'graph routes failures on, and declaring it is what lets an edge naming a ' +
        'failure that does not exist be caught rather than silently never taken.',
    );
    return [];
  }
  if (!Array.isArray(value)) {
    findings.error('bad-failure-kinds', '/failureKinds', '"failureKinds" must be a list.');
    return [];
  }
  const kinds: FailureKind[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const pointer = `/failureKinds/${String(index)}`;
    if (!isRecord(entry)) {
      findings.error('bad-failure-kind', pointer, 'Each failure kind must be an object.');
      return;
    }
    const kindId = nonEmptyString(entry['id']);
    if (kindId === null) {
      findings.error('bad-failure-kind-id', `${pointer}/id`, 'A failure kind needs an "id".');
      return;
    }
    if (seen.has(kindId)) {
      findings.error(
        'duplicate-failure-kind',
        `${pointer}/id`,
        `Failure kind "${kindId}" is declared more than once.`,
      );
      return;
    }
    seen.add(kindId);

    const runtimeWord = namesARuntimeFault(kindId);
    if (runtimeWord !== null) {
      findings.error(
        'runtime-fault-as-failure-kind',
        `${pointer}/id`,
        `Failure kind "${kindId}" names a runtime fault ("${runtimeWord}"), which the ` +
          `graph deliberately cannot route on. A declared failure is an outcome the loop ` +
          `understands and acts on; a hung call, an undelivered report or a dead process ` +
          `is the machinery breaking, and it is handled by the runner through timeouts, ` +
          `the journal and resumption. Giving every node a "what if this hangs" edge ` +
          `would make the graph unreadable and still not fix it. What happens instead is ` +
          `recorded once, in "onRuntimeFault".`,
      );
      return;
    }

    const label = nonEmptyString(entry['label']) ?? kindId;
    const meaning = nonEmptyString(entry['meaning']);
    if (meaning === null) {
      findings.error(
        'failure-kind-without-meaning',
        `${pointer}/meaning`,
        `Failure kind "${kindId}" needs a "meaning": what it means when a node declares ` +
          `it, so an author can tell it from the neighbouring kind.`,
      );
      return;
    }
    kinds.push({ id: kindId, label, meaning });
  });
  return kinds;
}

function parseLimits(value: unknown, pointer: string, findings: Findings): StepLimits | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    findings.error('bad-limits', pointer, '"limits" must be an object.');
    return null;
  }
  const limits: Record<string, number | string> = {};
  for (const field of ['maxCalls', 'maxReworkRounds', 'maxMinutes', 'maxTasks'] as const) {
    const raw = value[field];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      findings.error(
        'bad-limit',
        `${pointer}/${field}`,
        `"${field}" must be a number of at least 0; it is ${JSON.stringify(raw)}. A limit ` +
          `nobody can read as a number is not a limit.`,
      );
      continue;
    }
    limits[field] = raw;
  }
  const note = nonEmptyString(value['note']);
  if (note !== null) {
    limits['note'] = note;
  }
  return limits as StepLimits;
}

function parseArchive(value: unknown, findings: Findings): ArchivePolicy | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    findings.error('bad-archive', '/archive', '"archive" must be an object.');
    return null;
  }
  const archivePath = nonEmptyString(value['path']);
  if (archivePath === null) {
    findings.error(
      'archive-without-path',
      '/archive/path',
      'An archive needs a "path" for the reports to land in. It may contain <run-id>, ' +
        'which the runner substitutes.',
    );
    return null;
  }
  return {
    path: archivePath,
    entryPerNode: value['entryPerNode'] !== false,
    referenceReturned: value['referenceReturned'] !== false,
    ...(nonEmptyString(value['notes']) ? { notes: value['notes'] as string } : {}),
  };
}

function parseNodes(value: unknown, findings: Findings): readonly LoopNode[] {
  if (!Array.isArray(value) || value.length === 0) {
    findings.error(
      'no-nodes',
      '/nodes',
      '"nodes" must be a list with at least one node in it.',
    );
    return [];
  }
  const nodes: LoopNode[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const pointer = `/nodes/${String(index)}`;
    if (!isRecord(entry)) {
      findings.error('bad-node', pointer, 'Each node must be an object.');
      return;
    }
    const nodeId = nonEmptyString(entry['id']);
    if (nodeId === null) {
      findings.error('node-without-id', `${pointer}/id`, 'Every node needs an "id".');
      return;
    }
    if (/\s/.test(nodeId)) {
      findings.error(
        'bad-node-id',
        `${pointer}/id`,
        `Node id "${nodeId}" contains whitespace. Use a short slug; the label is where ` +
          `the readable name goes.`,
        { nodeId },
      );
      return;
    }
    if (nodeId === REPORT_WRITTEN_BY_SELF) {
      findings.error(
        'reserved-node-id',
        `${pointer}/id`,
        `"${REPORT_WRITTEN_BY_SELF}" is reserved: it is what a node's "report.writtenBy" ` +
          `says when the node files its own report. A node with that id would make every ` +
          `such statement ambiguous.`,
        { nodeId },
      );
      return;
    }
    if (seen.has(nodeId)) {
      findings.error(
        'duplicate-node-id',
        `${pointer}/id`,
        `Node id "${nodeId}" is used more than once. Edges name nodes by id, so a ` +
          `duplicate makes the graph mean two different things.`,
        { nodeId },
      );
      return;
    }
    seen.add(nodeId);

    const kind = entry['kind'];
    if (typeof kind !== 'string' || !(NODE_KINDS as readonly string[]).includes(kind)) {
      findings.error(
        'bad-node-kind',
        `${pointer}/kind`,
        `Node "${nodeId}" has kind ${JSON.stringify(kind)}. It must be one of ` +
          `${quoteList(NODE_KINDS)}.`,
        { nodeId },
      );
      return;
    }

    const role = parseRole(entry['role'], `${pointer}/role`, nodeId, findings);
    const model = parseModel(entry['model'], `${pointer}/model`, nodeId, findings);
    const limits = parseLimits(entry['limits'], `${pointer}/limits`, findings);
    const requirements = parseRequirements(
      entry['requirements'],
      `${pointer}/requirements`,
      nodeId,
      findings,
    );
    const outcomes = parseStringList(entry['outcomes'], `${pointer}/outcomes`, nodeId, findings);
    const declaredFailures = parseStringList(
      entry['declaredFailures'],
      `${pointer}/declaredFailures`,
      nodeId,
      findings,
    );
    const report = parseReport(entry['report'], `${pointer}/report`, nodeId, findings);
    const view = parseView(entry['view'], `${pointer}/view`, nodeId, findings);

    nodes.push({
      id: nodeId,
      kind: kind as NodeKind,
      ...(nonEmptyString(entry['label']) ? { label: entry['label'] as string } : {}),
      ...(nonEmptyString(entry['purpose']) ? { purpose: entry['purpose'] as string } : {}),
      ...(role ? { role } : {}),
      ...(model ? { model } : {}),
      ...(limits ? { limits } : {}),
      ...(requirements ? { requirements } : {}),
      ...(outcomes ? { outcomes } : {}),
      ...(declaredFailures ? { declaredFailures } : {}),
      ...(report ? { report } : {}),
      ...(nonEmptyString(entry['notes']) ? { notes: entry['notes'] as string } : {}),
      ...(view ? { view } : {}),
    });
  });
  return nodes;
}

function parseRole(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): RoleReference | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    findings.error(
      'bad-role',
      pointer,
      `Node "${nodeId}" has a "role" that is not an object. A role is a reference — an ` +
        `id and where the description lives — never the description itself.`,
      { nodeId },
    );
    return null;
  }
  const roleId = nonEmptyString(value['id']);
  const source = value['source'];
  if (roleId === null) {
    findings.error('role-without-id', `${pointer}/id`, `Node "${nodeId}" has a role with no "id".`, {
      nodeId,
    });
    return null;
  }
  if (!isRecord(source)) {
    findings.error(
      'role-without-source',
      `${pointer}/source`,
      `Role "${roleId}" on node "${nodeId}" has no "source". A reference that says only ` +
        `which role it wants cannot be checked, and an unresolvable role is the one thing ` +
        `an agent node must not have.`,
      { nodeId },
    );
    return null;
  }
  const kind = source['kind'];
  if (typeof kind !== 'string' || !(ROLE_SOURCE_KINDS as readonly string[]).includes(kind)) {
    findings.error(
      'bad-role-source-kind',
      `${pointer}/source/kind`,
      `Role "${roleId}" on node "${nodeId}" has source kind ${JSON.stringify(kind)}; it ` +
        `must be one of ${quoteList(ROLE_SOURCE_KINDS)}.`,
      { nodeId },
    );
    return null;
  }
  const sourcePath = nonEmptyString(source['path']);
  if (sourcePath === null) {
    findings.error(
      'bad-role-source-path',
      `${pointer}/source/path`,
      `Role "${roleId}" on node "${nodeId}" has no source "path". Paths are relative to ` +
        `the project root, not to the graph file.`,
      { nodeId },
    );
    return null;
  }
  return { id: roleId, source: { kind: kind as RoleReference['source']['kind'], path: sourcePath } };
}

function parseModel(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): ModelPolicy | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    findings.error(
      'bad-model',
      pointer,
      `Node "${nodeId}" has a "model" that is not an object. Use ` +
        `{"policy":"inherit"}, {"policy":"fixed","model":"..."} or ` +
        `{"policy":"described","description":"..."}.`,
      { nodeId },
    );
    return null;
  }
  const policy = value['policy'];
  if (policy !== 'inherit' && policy !== 'fixed' && policy !== 'described') {
    findings.error(
      'bad-model-policy',
      `${pointer}/policy`,
      `Node "${nodeId}" has model policy ${JSON.stringify(policy)}; it must be inherit, ` +
        `fixed or described.`,
      { nodeId },
    );
    return null;
  }
  if (policy === 'fixed') {
    const model = nonEmptyString(value['model']);
    if (model === null) {
      findings.error(
        'fixed-model-without-model',
        `${pointer}/model`,
        `Node "${nodeId}" pins its model but does not say which one. A pinned model with ` +
          `no name silently becomes whatever the caller was using.`,
        { nodeId },
      );
      return null;
    }
    return { policy, model };
  }
  if (policy === 'described') {
    const description = nonEmptyString(value['description']);
    if (description === null) {
      findings.error(
        'described-model-without-description',
        `${pointer}/description`,
        `Node "${nodeId}" says its model choice is described, but gives no description. ` +
          `Say what should decide, so a person can apply it while nothing automates it.`,
        { nodeId },
      );
      return null;
    }
    return { policy, description };
  }
  return { policy };
}

function parseRequirements(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): readonly RequirementId[] | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    findings.error('bad-requirements', pointer, `Node "${nodeId}" has "requirements" that are not a list.`, {
      nodeId,
    });
    return null;
  }
  const requirements: RequirementId[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !(REQUIREMENTS as readonly string[]).includes(entry)) {
      findings.error(
        'unknown-requirement',
        `${pointer}/${String(index)}`,
        `Node "${nodeId}" requires ${JSON.stringify(entry)}, which is not a requirement ` +
          `this format knows. Known requirements: ${quoteList(REQUIREMENTS)}. A ` +
          `requirement nothing recognises cannot be checked against a target, and an ` +
          `unchecked requirement is exactly the silent loss this format exists to prevent.`,
        { nodeId },
      );
      return;
    }
    requirements.push(entry as RequirementId);
  });
  return requirements;
}

function parseStringList(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): readonly string[] | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    findings.error('bad-string-list', pointer, `Node "${nodeId}": this must be a list of names.`, {
      nodeId,
    });
    return null;
  }
  const items: string[] = [];
  value.forEach((entry, index) => {
    const item = nonEmptyString(entry);
    if (item === null) {
      findings.error(
        'bad-name',
        `${pointer}/${String(index)}`,
        `Node "${nodeId}": ${JSON.stringify(entry)} is not a usable name.`,
        { nodeId },
      );
      return;
    }
    if (items.includes(item)) {
      findings.error(
        'duplicate-name',
        `${pointer}/${String(index)}`,
        `Node "${nodeId}" lists "${item}" twice.`,
        { nodeId },
      );
      return;
    }
    items.push(item);
  });
  return items;
}

function parseReport(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): ReportPolicy | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    findings.error('bad-report', pointer, `Node "${nodeId}" has a "report" that is not an object.`, {
      nodeId,
    });
    return null;
  }
  const writtenBy = nonEmptyString(value['writtenBy']);
  if (writtenBy === null) {
    findings.error(
      'report-without-writer',
      `${pointer}/writtenBy`,
      `Node "${nodeId}" has a report with no "writtenBy". Say "self", or name the node ` +
        `that files it.`,
      { nodeId },
    );
    return null;
  }
  return {
    writtenBy,
    ...(nonEmptyString(value['path']) ? { path: value['path'] as string } : {}),
  };
}

function parseView(
  value: unknown,
  pointer: string,
  nodeId: string,
  findings: Findings,
): { readonly x: number; readonly y: number } | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value) || typeof value['x'] !== 'number' || typeof value['y'] !== 'number') {
    findings.warning(
      'bad-view',
      pointer,
      `Node "${nodeId}" has a "view" without numeric x and y, so the editor will place it ` +
        `itself. Nothing about the loop's meaning is affected.`,
      { nodeId },
    );
    return null;
  }
  return { x: value['x'], y: value['y'] };
}

function parseEdges(value: unknown, findings: Findings): readonly LoopEdge[] {
  if (!Array.isArray(value)) {
    findings.error(
      'no-edges',
      '/edges',
      '"edges" must be a list. A graph with no edges is allowed while it is being drawn, ' +
        'but the field has to be there.',
    );
    return [];
  }
  const edges: LoopEdge[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const pointer = `/edges/${String(index)}`;
    if (!isRecord(entry)) {
      findings.error('bad-edge', pointer, 'Each edge must be an object.');
      return;
    }
    const edgeId = nonEmptyString(entry['id']);
    if (edgeId === null) {
      findings.error(
        'edge-without-id',
        `${pointer}/id`,
        'Every edge needs an "id", so a finding about it can point at one edge rather ' +
          'than at a pair of nodes that may be joined more than once.',
      );
      return;
    }
    if (seen.has(edgeId)) {
      findings.error('duplicate-edge-id', `${pointer}/id`, `Edge id "${edgeId}" is used more than once.`, {
        edgeId,
      });
      return;
    }
    seen.add(edgeId);

    const from = nonEmptyString(entry['from']);
    const to = nonEmptyString(entry['to']);
    if (from === null || to === null) {
      findings.error(
        'edge-without-ends',
        pointer,
        `Edge "${edgeId}" needs both "from" and "to".`,
        { edgeId },
      );
      return;
    }
    const when = parseCondition(entry['when'], `${pointer}/when`, edgeId, findings);
    if (when === null) {
      return;
    }
    edges.push({
      id: edgeId,
      from,
      to,
      when,
      ...(nonEmptyString(entry['label']) ? { label: entry['label'] as string } : {}),
      ...(nonEmptyString(entry['notes']) ? { notes: entry['notes'] as string } : {}),
    });
  });
  return edges;
}

function parseCondition(
  value: unknown,
  pointer: string,
  edgeId: string,
  findings: Findings,
): EdgeCondition | null {
  if (!isRecord(value)) {
    findings.error(
      'edge-without-condition',
      pointer,
      `Edge "${edgeId}" has no "when". Every edge says when it is taken: ` +
        `{"on":"success"}, {"on":"outcome","outcome":"..."} or ` +
        `{"on":"declared-failure","failure":"..."}.`,
      { edgeId },
    );
    return null;
  }
  const on = value['on'];
  if (typeof on !== 'string' || !(EDGE_CONDITIONS as readonly string[]).includes(on)) {
    findings.error(
      'bad-edge-condition',
      `${pointer}/on`,
      `Edge "${edgeId}" is taken on ${JSON.stringify(on)}, which is not a condition this ` +
        `format has. It must be one of ${quoteList(EDGE_CONDITIONS)}. There is ` +
        `deliberately no condition for a step that never finished: that is a runtime ` +
        `fault, and "onRuntimeFault" records what happens instead.`,
      { edgeId },
    );
    return null;
  }
  if (on === 'success') {
    return { on: 'success' };
  }
  if (on === 'outcome') {
    const outcome = nonEmptyString(value['outcome']);
    if (outcome === null) {
      findings.error(
        'outcome-edge-without-outcome',
        `${pointer}/outcome`,
        `Edge "${edgeId}" routes on an outcome but does not say which one.`,
        { edgeId },
      );
      return null;
    }
    return { on: 'outcome', outcome };
  }
  const failure = nonEmptyString(value['failure']);
  if (failure === null) {
    findings.error(
      'failure-edge-without-failure',
      `${pointer}/failure`,
      `Edge "${edgeId}" routes on a declared failure but does not say which kind.`,
      { edgeId },
    );
    return null;
  }
  return { on: 'declared-failure', failure };
}

/**
 * Everything that can only be judged with the whole graph, an environment, or a way to
 * reach a role.
 *
 * Safe to call on an in-memory graph the author is halfway through editing, which is
 * how the editor should use it: warnings for work in progress, errors for what would
 * make the file mean something nobody drew.
 */
export function checkLoopGraph(graph: LoopGraph, options: CheckOptions = {}): readonly Finding[] {
  const findings = new Findings();
  const table = options.targetCapabilities ?? TARGET_CAPABILITIES;
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const failureKindIds = new Set(graph.failureKinds.map((kind) => kind.id));
  const outgoing = new Map<string, LoopEdge[]>();
  const pointerOf = new Map<string, string>();
  graph.nodes.forEach((node, index) => pointerOf.set(node.id, `/nodes/${String(index)}`));
  const edgePointerOf = new Map<string, string>();
  graph.edges.forEach((edge, index) => edgePointerOf.set(edge.id, `/edges/${String(index)}`));

  if (!byId.has(graph.entry)) {
    findings.error(
      'entry-not-a-node',
      '/entry',
      `The run is said to start at "${graph.entry}", which is not a node in this graph. ` +
        `Nodes present: ${quoteList([...byId.keys()])}.`,
    );
  }

  // Edges first: their endpoints and conditions decide what the node checks can assume.
  for (const edge of graph.edges) {
    const pointer = edgePointerOf.get(edge.id) ?? '/edges';
    const source = byId.get(edge.from);
    if (!source) {
      findings.error(
        'edge-from-missing-node',
        `${pointer}/from`,
        `Edge "${edge.id}" starts at "${edge.from}", which is not a node in this graph.`,
        { edgeId: edge.id },
      );
    }
    if (!byId.has(edge.to)) {
      findings.error(
        'edge-to-missing-node',
        `${pointer}/to`,
        `Edge "${edge.id}" leads to "${edge.to}", which is not a node in this graph.`,
        { edgeId: edge.id },
      );
    }
    if (source) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }

    if (!source) {
      continue;
    }
    if (edge.when.on === 'outcome') {
      const declared = source.outcomes ?? [];
      if (!declared.includes(edge.when.outcome)) {
        findings.error(
          'undeclared-outcome',
          `${pointer}/when/outcome`,
          `Edge "${edge.id}" is taken when "${edge.from}" produces outcome ` +
            `"${edge.when.outcome}", which that node does not declare. It declares ` +
            `${quoteList(declared)}. An edge routing on an outcome that cannot happen is ` +
            `a branch the runner will never take and the author believes it will.`,
          { edgeId: edge.id, nodeId: source.id },
        );
      }
    }
    if (edge.when.on === 'declared-failure') {
      const runtimeWord = namesARuntimeFault(edge.when.failure);
      if (runtimeWord !== null) {
        findings.error(
          'runtime-fault-as-edge',
          `${pointer}/when/failure`,
          `Edge "${edge.id}" routes on "${edge.when.failure}", which names a runtime fault ` +
            `("${runtimeWord}") rather than a declared failure. The graph routes on ` +
            `outcomes the loop understands; a step that hangs, dies or never delivers its ` +
            `report is the runner's problem, handled by timeouts and the journal and ` +
            `recorded once in "onRuntimeFault". Draw the outcome, not the malfunction.`,
          { edgeId: edge.id },
        );
      } else if (!failureKindIds.has(edge.when.failure)) {
        findings.error(
          'undeclared-failure-kind',
          `${pointer}/when/failure`,
          `Edge "${edge.id}" routes on failure "${edge.when.failure}", which the graph does ` +
            `not declare in "failureKinds". Declared kinds: ${quoteList([...failureKindIds])}.`,
          { edgeId: edge.id },
        );
      } else if (!(source.declaredFailures ?? []).includes(edge.when.failure)) {
        findings.error(
          'failure-not-declared-by-node',
          `${pointer}/when/failure`,
          `Edge "${edge.id}" carries failure "${edge.when.failure}" away from "${edge.from}", ` +
            `but that node does not declare it. A node lists the failures it can report in ` +
            `"declaredFailures"; it declares ${quoteList(source.declaredFailures ?? [])}.`,
          { edgeId: edge.id, nodeId: source.id },
        );
      }
    }
  }

  for (const node of graph.nodes) {
    const pointer = pointerOf.get(node.id) ?? '/nodes';
    const out = outgoing.get(node.id) ?? [];
    checkNodeShape(node, pointer, out, findings);
    checkNodeRouting(node, pointer, out, findings);
    checkNodeRole(node, pointer, graph, table, options, findings);
  }

  checkReachability(graph, byId, outgoing, pointerOf, findings);
  reportNotYetHonoured(graph, findings);

  const connected = options.connectedTargets;
  if (connected !== undefined) {
    const runnable = runnableHere(graph, connected ?? null);
    if (!runnable.runnable) {
      findings.notice('not-runnable-here', '/target', runnable.reason);
    }
  }

  return findings.all;
}

function checkNodeShape(
  node: LoopNode,
  pointer: string,
  out: readonly LoopEdge[],
  findings: Findings,
): void {
  const ids: Ids = { nodeId: node.id };

  if (node.kind === 'agent' && !node.role) {
    findings.error(
      'agent-without-role',
      `${pointer}/role`,
      `Node "${node.id}" is an agent with no role. An agent node is a role doing work, ` +
        `so a reference to that role is the one thing it cannot be without.`,
      ids,
    );
  }
  if (node.role && node.kind !== 'agent' && node.kind !== 'gate' && node.kind !== 'external') {
    findings.error(
      'role-on-wrong-kind',
      `${pointer}/role`,
      `Node "${node.id}" is a ${node.kind} and carries a role. Only agent, gate and ` +
        `external nodes are performed by a role; a ${node.kind} node would silently ignore ` +
        `it. If a role does this work, make it an agent.`,
      ids,
    );
  }
  if (node.kind === 'router') {
    if ((node.outcomes ?? []).length < 2) {
      findings.error(
        'router-without-branches',
        `${pointer}/outcomes`,
        `Router "${node.id}" declares ${String((node.outcomes ?? []).length)} outcome(s). A ` +
          `router chooses between branches, so it needs at least two; with one, make it a ` +
          `plain edge instead.`,
        ids,
      );
    }
  }
  if (node.kind === 'gate' && (node.outcomes ?? []).length < 2) {
    findings.error(
      'gate-without-verdicts',
      `${pointer}/outcomes`,
      `Gate "${node.id}" must declare its verdicts in "outcomes" — at least two, since a ` +
        `gate that cannot reject admits everything. Our own review gate declares accept, ` +
        `rework and needs-decision.`,
      ids,
    );
  }
  if (node.kind === 'terminal') {
    if (out.length > 0) {
      findings.error(
        'terminal-with-outgoing-edge',
        pointer,
        `Node "${node.id}" ends the run, but ${String(out.length)} edge(s) leave it ` +
          `(${quoteList(out.map((edge) => edge.id))}). Either it is not the end, or those ` +
          `edges belong to the step before it.`,
        ids,
      );
    }
    if ((node.outcomes ?? []).length > 0) {
      findings.warning(
        'terminal-with-outcomes',
        `${pointer}/outcomes`,
        `Node "${node.id}" ends the run and also declares outcomes, which nothing can act ` +
          `on.`,
        ids,
      );
    }
  }
  if (node.model && node.kind !== 'agent' && node.kind !== 'gate') {
    findings.warning(
      'model-on-wrong-kind',
      `${pointer}/model`,
      `Node "${node.id}" is a ${node.kind} and names a model. Nothing runs a model for a ` +
        `${node.kind} node, so this will be ignored rather than honoured.`,
      ids,
    );
  }
}

function checkNodeRouting(
  node: LoopNode,
  pointer: string,
  out: readonly LoopEdge[],
  findings: Findings,
): void {
  const ids: Ids = { nodeId: node.id };
  const outcomes = node.outcomes ?? [];
  const successEdges = out.filter((edge) => edge.when.on === 'success');

  if (outcomes.length > 0 && successEdges.length > 0) {
    findings.error(
      'success-edge-on-a-branching-node',
      pointer,
      `Node "${node.id}" declares named outcomes (${quoteList(outcomes)}) and also has ` +
        `edge(s) taken on plain success (${quoteList(successEdges.map((edge) => edge.id))}). ` +
        `That is ambiguous: a node that produces named outcomes routes on them, so give ` +
        `those edges an outcome or drop the node's outcomes.`,
      ids,
    );
  }
  if (successEdges.length > 1) {
    findings.error(
      'two-success-edges',
      pointer,
      `Node "${node.id}" has ${String(successEdges.length)} edges taken on success ` +
        `(${quoteList(successEdges.map((edge) => edge.id))}). Only one can be followed, and ` +
        `nothing in the file says which. If the step really chooses, declare outcomes and ` +
        `route on them.`,
      ids,
    );
  }
  for (const outcome of outcomes) {
    const routed = out.some((edge) => edge.when.on === 'outcome' && edge.when.outcome === outcome);
    if (!routed) {
      findings.error(
        'unrouted-outcome',
        `${pointer}/outcomes`,
        `Node "${node.id}" declares outcome "${outcome}" and no edge leaves it for that ` +
          `outcome. The runner would reach a dead end the graph claims is reachable. Route ` +
          `it, or stop declaring it.`,
        ids,
      );
    }
  }
  for (const failure of node.declaredFailures ?? []) {
    const routed = out.some(
      (edge) => edge.when.on === 'declared-failure' && edge.when.failure === failure,
    );
    if (!routed) {
      findings.error(
        'unrouted-declared-failure',
        `${pointer}/declaredFailures`,
        `Node "${node.id}" can report failure "${failure}" and there is no edge for it. A ` +
          `declared failure with nowhere to go is what turns a loop back into a flowchart: ` +
          `the run would stop where the author expected it to recover.`,
        ids,
      );
    }
  }
  if (out.length === 0 && node.kind !== 'terminal') {
    if (node.kind === 'human') {
      findings.warning(
        'human-node-ends-the-run',
        pointer,
        `Nothing follows node "${node.id}", so the run ends when the person is done. If ` +
          `that is intended, a terminal node says so explicitly.`,
        ids,
      );
    } else {
      findings.error(
        'nothing-follows',
        pointer,
        `Nothing follows node "${node.id}" and it is not a terminal node. Either route its ` +
          `result somewhere or say the run ends there.`,
        ids,
      );
    }
  }
}

function checkNodeRole(
  node: LoopNode,
  pointer: string,
  graph: LoopGraph,
  table: TargetCapabilities,
  options: CheckOptions,
  findings: Findings,
): void {
  const ids: Ids = { nodeId: node.id };
  let role: ResolvedRole | null = null;

  if (node.role) {
    if (!options.resolveRole) {
      findings.warning(
        'role-not-checked',
        `${pointer}/role`,
        `Role "${node.role.id}" on node "${node.id}" was not checked, because this ` +
          `validation ran without a way to reach role descriptions. Whether it exists, and ` +
          `whether it supports ${graph.target}, is unknown — not confirmed.`,
        ids,
      );
    } else {
      role = options.resolveRole(node.role);
      if (!role) {
        findings.error(
          'role-does-not-resolve',
          `${pointer}/role`,
          `Node "${node.id}" references role "${node.role.id}" at ` +
            `${node.role.source.path}, and nothing is there. A reference that resolves to ` +
            `nothing is an error rather than an empty role: an agent with no description is ` +
            `an agent that will be handed whatever the runner happens to have.`,
          ids,
        );
      } else if (!role.targets.includes(graph.target)) {
        findings.error(
          'role-does-not-support-target',
          `${pointer}/role`,
          `This graph is drawn for ${graph.target}, and role "${node.role.id}" at ` +
            `${role.sourcePath} supports ${quoteList(role.targets)}. Give the role a ` +
            `${graph.target} form, or draw this loop for a framework the role supports.`,
          ids,
        );
      } else if (role.id !== node.role.id) {
        findings.warning(
          'role-id-mismatch',
          `${pointer}/role/id`,
          `Node "${node.id}" asks for role "${node.role.id}", and the description at ` +
            `${role.sourcePath} calls itself "${role.id}". One of them has been renamed. ` +
            `The file is what will be used.`,
          ids,
        );
      } else if (!role.targetsDeclared) {
        findings.notice(
          'role-target-inferred',
          `${pointer}/role`,
          `Role "${node.role.id}" does not declare which frameworks it supports; support ` +
            `for ${graph.target} was inferred from the kind of file it is ` +
            `(${role.sourcePath}). DSP-23 is what makes that declaration explicit.`,
          ids,
        );
      }
    }
  }

  const effective = effectiveRequirements(node, role);
  for (const entry of effective) {
    const answer = capabilityAnswer(graph.target, entry.requirement, table);
    const origin = entry.from === 'role' ? `role "${node.role?.id ?? ''}"` : 'this node';
    if (answer.status === 'unmet') {
      findings.error(
        'requirement-target-cannot-meet',
        `${pointer}/requirements`,
        `Node "${node.id}" requires ${entry.requirement} (from ${origin}) and ${graph.target} ` +
          `cannot meet it: ${answer.how} Running this graph there would produce a step that ` +
          `reads as though the requirement held.`,
        ids,
      );
    } else if (answer.status === 'unknown') {
      findings.warning(
        'requirement-unestablished',
        `${pointer}/requirements`,
        `Node "${node.id}" requires ${entry.requirement} (from ${origin}) and whether ` +
          `${graph.target} can meet it is unestablished: ${answer.how}`,
        ids,
      );
    } else if (answer.status === 'other-means') {
      findings.notice(
        'requirement-not-enforced',
        `${pointer}/requirements`,
        `Node "${node.id}" requires ${entry.requirement} (from ${origin}). ${graph.target} ` +
          `does not enforce it: ${answer.how}`,
        ids,
      );
    }
  }

  const cannotWrite = effective.some((entry) => entry.requirement === 'no-file-writes');
  if (cannotWrite) {
    const writer = node.report?.writtenBy ?? REPORT_WRITTEN_BY_SELF;
    if (writer === REPORT_WRITTEN_BY_SELF) {
      findings.error(
        'report-written-by-a-node-that-cannot-write',
        `${pointer}/report`,
        `Node "${node.id}" must not be able to write files, and its report is written by ` +
          `itself. It cannot be: that is the mistake made on 15 September 2026, when a ` +
          `read-only Researcher was asked to write both its survey and its report and could ` +
          `write neither. Name the node that files this one's report in ` +
          `"report": {"writtenBy": "..."}.`,
        ids,
      );
    }
  }

  const writer = node.report?.writtenBy;
  if (writer !== undefined && writer !== REPORT_WRITTEN_BY_SELF) {
    const other = graph.nodes.find((candidate) => candidate.id === writer);
    if (!other) {
      findings.error(
        'report-writer-missing',
        `${pointer}/report/writtenBy`,
        `Node "${node.id}" says its report is written by "${writer}", which is not a node ` +
          `in this graph.`,
        ids,
      );
    }
  }
}

function checkReachability(
  graph: LoopGraph,
  byId: ReadonlyMap<string, LoopNode>,
  outgoing: ReadonlyMap<string, readonly LoopEdge[]>,
  pointerOf: ReadonlyMap<string, string>,
  findings: Findings,
): void {
  if (!byId.has(graph.entry)) {
    return;
  }
  const reached = new Set<string>([graph.entry]);
  const queue = [graph.entry];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of outgoing.get(current) ?? []) {
      if (!reached.has(edge.to) && byId.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  for (const node of graph.nodes) {
    if (!reached.has(node.id)) {
      findings.warning(
        'unreachable-node',
        pointerOf.get(node.id) ?? '/nodes',
        `Node "${node.id}" cannot be reached from the start of the run ("${graph.entry}"). ` +
          `That is normal while a graph is being drawn and a mistake once it is finished.`,
        { nodeId: node.id },
      );
    }
  }
  const endsSomewhere = graph.nodes.some(
    (node) => reached.has(node.id) && (node.kind === 'terminal' || (outgoing.get(node.id) ?? []).length === 0),
  );
  if (!endsSomewhere) {
    findings.warning(
      'no-way-out',
      '/nodes',
      'No reachable node ends the run. A loop is meant to come back around, but something ' +
        'has to be able to finish, or the run only ever stops at a limit.',
    );
  }
}

function reportNotYetHonoured(graph: LoopGraph, findings: Findings): void {
  const setters = new Map<string, string[]>();
  const note = (attribute: string, where: string): void => {
    const list = setters.get(attribute) ?? [];
    list.push(where);
    setters.set(attribute, list);
  };

  if (graph.limits) {
    note('limits', 'the graph');
  }
  if (graph.archive) {
    note('archive', 'the graph');
  }
  note('onRuntimeFault', 'the graph');
  for (const node of graph.nodes) {
    if (node.role) {
      note('role', node.id);
    }
    if (node.model) {
      note('model', node.id);
    }
    if (node.limits) {
      note('limits', node.id);
    }
    if (node.requirements && node.requirements.length > 0) {
      note('requirements', node.id);
    }
    if (node.report) {
      note('report', node.id);
    }
  }

  for (const support of ATTRIBUTE_SUPPORT) {
    const where = setters.get(support.attribute);
    if (!where || where.length === 0) {
      continue;
    }
    if (!support.honoured) {
      findings.notice(
        'not-yet-honoured',
        '',
        `"${support.attribute}" is recorded but nothing honours it yet — that waits on ` +
          `${support.by}. It is set on: ${quoteList(where)}. Recorded and unhonoured is the ` +
          `honest state; silently ignored is not.`,
      );
      continue;
    }
    // Honoured, but not everywhere. DSP-46 #3 is about an attribute the runner does not
    // act on saying so, and `role` is why one boolean was not enough to say it: the chat
    // loop now sends the role's text and two other paths through the same runner do not.
    // Reporting only `honoured: false` would have left this graph claiming a role is in
    // force on a path where it is not — which is the same silence the criterion exists to
    // end, one step further in.
    if (support.caveat !== undefined) {
      findings.notice(
        'partly-honoured',
        '',
        `"${support.attribute}" is honoured by ${support.by} — but not everywhere. ` +
          `${support.caveat} It is set on: ${quoteList(where)}.`,
      );
    }
  }
}

/**
 * Read a graph and check it. The single entry point for anything that has a file.
 *
 * An `ok: false` result carries every finding and no graph at all — nothing is drawn
 * and nothing is run from a file we could not read.
 */
export function loadLoopGraph(text: string, options: CheckOptions = {}): LoadResult {
  const parsed = parseLoopGraph(text);
  if (!parsed.ok) {
    return { ok: false, graph: null, findings: parsed.findings };
  }
  const findings = checkLoopGraph(parsed.graph, options);
  if (hasErrors(findings)) {
    return { ok: false, graph: null, findings };
  }
  return {
    ok: true,
    graph: parsed.graph,
    findings,
    runnable: runnableHere(parsed.graph, options.connectedTargets ?? null),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
