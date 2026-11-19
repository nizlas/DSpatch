/**
 * DSP-229: the host's side of "Apply to repository…" and "Project instructions…".
 *
 * Templates are the definitions DSpatch ships in its own folder; a project graph is any definition
 * in an open folder that names project instructions. Applying writes only inside a folder of the
 * open workspace, never replaces a file, and makes the new graph this workspace's choice; it starts
 * nothing. Recommendations use the workspace's chosen agent, read-only, in the repository; a refused
 * agent is said, and the manual window works without one.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { ProviderId } from '../adapter/types';
import { createFileRoleResolver } from '../main/loop-graph-roles';
import { discoverLoopDefinitions, type LoopDefinitionRow } from '../main/loop-definition-files';
import { planProjectGraph, readProjectGraph, referenceProblems, writeProjectGraph } from '../main/project-graph';
import { ProjectDraftStore, type DraftAnswer, type DraftSource } from '../main/project-drafts';
import { runRecommendation } from '../main/project-recommend-run';
import type { LoopGraph, RoleResolver } from '../shared/loop-graph';
import { referencedRoles } from '../shared/loop-graph-editing';
import { parseLoopGraph } from '../shared/loop-graph-load';
import type { ProjectGraphAnswer, ProjectGraphDescription, ProjectGraphRequest, ProjectGraphSource } from '../shared/project-graph-bridge';
import type { ProjectDraftView } from '../shared/project-draft';
import { emptyProjectInstructions } from '../shared/project-instructions';
import { recommendationPrompt, targetKeys } from '../shared/project-recommendations';

export interface ProjectGraphHost {
  readonly workspaceFolders: () => readonly string[];
  /** DSpatch's own folder, whose definitions are the templates. */
  readonly ownRoot: () => string | null;
  readonly appVersion: string;
  /** Make a definition this workspace's choice, as the chooser does. Starts nothing. */
  readonly choose: (definitionPath: string) => void;
  readonly agent: () => { readonly provider: ProviderId | null; readonly model: string | null };
  /** Why the analysis purpose cannot be used with this agent, or `null`. */
  readonly recommendRefusal: (provider: ProviderId) => string | null;
  readonly createAnalysisAdapter: (provider: ProviderId) => Parameters<typeof runRecommendation>[0]['adapter'] & { dispose?: () => Promise<void> };
  readonly log?: (line: string) => void;
  /** DSP-230: where unsaved drafts are kept (DSpatch's data folder), `null` for memory only. */
  readonly draftsDir?: string | null;
  /** DSP-230: a draft changed; every window that shows it is told. */
  readonly onDraftChange?: (view: ProjectDraftView) => void;
}

export interface ProjectGraphService {
  readonly handle: (request: ProjectGraphRequest) => Promise<ProjectGraphAnswer>;
  /** DSP-230: the one draft store, also used by the chat's tools and the run start. */
  readonly drafts: ProjectDraftStore;
  /** The project graph a chat tool names by its definition id, as a definition key. */
  readonly definitionKeyFor: (loopId: string) => string | null;
}

export function projectGraphMethods(host: ProjectGraphHost): (request: ProjectGraphRequest) => Promise<ProjectGraphAnswer> {
  return projectGraphService(host).handle;
}

export function projectGraphService(host: ProjectGraphHost): ProjectGraphService {
  const running = new Map<string, AbortController>();
  const refused = (...problems: string[]): ProjectGraphAnswer => ({ kind: 'refused', problems });
  const templates = (): readonly LoopDefinitionRow[] => {
    const own = host.ownRoot();
    return own === null ? [] : discoverLoopDefinitions([own]).rows.filter((row) => row.definition !== null);
  };
  const projectRows = (): readonly LoopDefinitionRow[] => discoverLoopDefinitions(host.workspaceFolders()).rows;
  const rowFor = (source: ProjectGraphSource): LoopDefinitionRow | null =>
    'templateKey' in source
      ? (templates().find((row) => row.filePath === source.templateKey) ?? null)
      : (projectRows().find((row) => row.filePath === source.definitionKey) ?? null);

  /** The graph and its roles' generic text, from the row's own resources. */
  const graphOf = (row: LoopDefinitionRow): { readonly graph: LoopGraph; readonly resolve: RoleResolver } | null => {
    if (row.graphPath === null || row.resourceRoot === null) return null;
    try {
      const parsed = parseLoopGraph(fs.readFileSync(row.graphPath, 'utf8'));
      return parsed.ok ? { graph: parsed.graph, resolve: createFileRoleResolver(row.resourceRoot) } : null;
    } catch {
      return null;
    }
  };

  const describe = (source: ProjectGraphSource): ProjectGraphDescription | string => {
    const row = rowFor(source);
    if (row === null) return 'That graph is not offered here any more.';
    const opened = graphOf(row);
    if (opened === null) return 'That graph does not load.';
    const { graph, resolve } = opened;
    const roleTexts: Record<string, { sourcePath: string; instructions: string }> = {};
    const roles: { id: string; title: string; summary: string }[] = [];
    for (const reference of referencedRoles(graph)) {
      if (roleTexts[reference.id] !== undefined) continue;
      const resolved = resolve(reference);
      roleTexts[reference.id] = { sourcePath: reference.source.path, instructions: resolved?.instructions ?? '' };
      roles.push({ id: reference.id, title: reference.id, summary: resolved?.summary ?? '' });
    }
    const agents = graph.nodes.filter((node) => node.kind === 'agent');
    const reading = 'definitionKey' in source ? readProjectGraph(row) : null;
    const project = reading !== null && !('problem' in reading) ? reading : null;
    return {
      outline: {
        name: graph.name,
        roles,
        nodes: agents.map((node) => ({ id: node.id, label: node.label ?? node.id, roleId: node.role?.id ?? null, purpose: node.purpose ?? '' })),
      },
      roleTexts,
      fanOuts: agents.filter((node) => node.fanOut !== undefined).map((node) => ({ id: node.id, runsAs: node.fanOut?.branchAs ?? [node.id] })),
      repository: project?.repository ?? null,
      instructions: project?.instructions ?? emptyProjectInstructions(),
      instructionsFile: project === null ? null : path.relative(project.repository, project.instructionsPath).split(path.sep).join('/'),
      instructionsSha256: project?.instructionsSha256 ?? null,
      origin: project?.origin ?? null,
      problems: reading !== null && 'problem' in reading ? [reading.problem] : (project?.problems ?? []),
    };
  };

  const draftSource = (definitionKey: string): DraftSource | { readonly problem: string } => {
    const row = projectRows().find((candidate) => path.resolve(candidate.filePath) === path.resolve(definitionKey));
    if (row === undefined) return { problem: 'That project graph is not in this workspace any more.' };
    const reading = readProjectGraph(row);
    if ('problem' in reading) return { problem: reading.problem };
    const described = describe({ definitionKey: row.filePath });
    if (typeof described === 'string') return { problem: described };
    return {
      definitionKey: row.filePath,
      graphName: row.definition?.name ?? described.outline.name,
      repository: reading.repository,
      instructionsPath: reading.instructionsPath,
      outline: described.outline,
      graph: graphOf(row)?.graph ?? null,
    };
  };
  const drafts = new ProjectDraftStore({
    dir: host.draftsDir ?? null,
    source: draftSource,
    ...(host.onDraftChange === undefined ? {} : { onChange: host.onDraftChange }),
  });
  const answerOf = (answer: DraftAnswer): ProjectGraphAnswer => {
    if (!answer.ok) return { kind: 'refused', problems: [answer.problem], ...(answer.view === undefined ? {} : { view: answer.view }) };
    const row = projectRows().find((candidate) => candidate.filePath === answer.view.definitionKey);
    const graph = row === undefined ? null : (graphOf(row)?.graph ?? null);
    return { kind: 'draft', view: answer.view, note: answer.note ?? null, references: referenceProblems(answer.view.repository, answer.view.draft, graph) };
  };

  const handle = async (request: ProjectGraphRequest): Promise<ProjectGraphAnswer> => {
    switch (request.kind) {
      case 'options': {
        const agent = host.agent();
        return {
          kind: 'options',
          templates: templates().map((row) => ({ key: row.filePath, name: row.definition?.name ?? row.fileName, description: row.definition?.description ?? null })),
          repositories: host.workspaceFolders().map((folder) => ({ path: folder, name: path.basename(folder) })),
          agent: {
            provider: agent.provider,
            model: agent.model,
            recommendRefusal: agent.provider === null ? 'No agent is chosen for this workspace.' : host.recommendRefusal(agent.provider),
          },
        };
      }
      case 'describe': {
        const described = describe(request.source);
        return typeof described === 'string' ? refused(described) : { kind: 'described', description: described };
      }
      case 'plan':
      case 'apply': {
        const template = templates().find((row) => row.filePath === request.templateKey);
        if (template === undefined) return refused('That template is not offered any more.');
        const planned = planProjectGraph({
          template,
          repository: request.repository,
          workspaceFolders: host.workspaceFolders(),
          name: request.name,
          appVersion: host.appVersion,
          instructions: request.instructions,
        });
        if (!planned.ok) return refused(...planned.problems);
        const references = referenceProblems(planned.plan.repository, request.instructions, planned.plan.graph);
        if (request.kind === 'plan') {
          return { kind: 'planned', files: planned.plan.files.map((file) => ({ relative: file.relative, action: file.action, what: file.what })), references };
        }
        const written = writeProjectGraph(planned.plan);
        if (!written.ok) return refused(written.problem);
        host.log?.(`[project-graph] applied ${template.definition?.id ?? '?'} to ${planned.plan.repository} as ${planned.plan.id}`);
        host.choose(planned.plan.definitionPath);
        return { kind: 'applied', definitionKey: planned.plan.definitionPath, written: written.written, references };
      }
      case 'draft':
        return answerOf(drafts.view(request.definitionKey));
      case 'draftEdit':
        return answerOf(drafts.edit(request.definitionKey, request.edits));
      case 'draftSave': {
        const answer = drafts.save(request.definitionKey);
        if (answer.ok) host.log?.(`[project-graph] saved the project instructions of ${request.definitionKey}`);
        return answerOf(answer);
      }
      case 'draftDiscard':
        return answerOf(drafts.discard(request.definitionKey));
      case 'draftTakeDisk':
        return answerOf(drafts.takeDisk(request.definitionKey));
      case 'proposalApply':
        return answerOf(drafts.applyProposal(request.definitionKey, request.proposalId));
      case 'proposalReject':
        return answerOf(drafts.rejectProposal(request.definitionKey, request.proposalId));
      case 'proposals':
        return { kind: 'proposals', proposals: drafts.proposalsFor(request.conversationId) };
      case 'check': {
        const row = rowFor(request.source);
        const graph = row === null ? null : (graphOf(row)?.graph ?? null);
        return { kind: 'checked', references: referenceProblems(request.repository, request.instructions, graph) };
      }
      case 'recommend': {
        const agent = host.agent();
        if (agent.provider === null) return refused('No agent is chosen for this workspace. Choose one in the chat; the window works without one.');
        const refusal = host.recommendRefusal(agent.provider);
        if (refusal !== null) return refused(refusal);
        if (!host.workspaceFolders().some((folder) => path.resolve(folder) === path.resolve(request.repository))) {
          return refused('Recommendations read only a repository of this workspace.');
        }
        const described = describe(request.source);
        if (typeof described === 'string') return refused(described);
        const controller = new AbortController();
        running.set(request.requestId, controller);
        const adapter = host.createAnalysisAdapter(agent.provider);
        try {
          const result = await runRecommendation({
            adapter,
            provider: agent.provider,
            model: agent.model ?? '',
            repository: request.repository,
            prompt: recommendationPrompt({ outline: described.outline, target: request.target, current: request.instructions, inventory: request.inventory }),
            allowed: targetKeys(described.outline, request.target),
            sessionId: `dsp-session-recommend-${request.requestId}`,
            signal: controller.signal,
          });
          if (!result.ok) return result.cancelled === true ? { kind: 'cancelled' } : refused(result.problem);
          // An inventory made now is kept by the window; one handed in is kept as it was.
          const inventory = request.inventory ?? JSON.stringify(result.answer.inventory, null, 2);
          return { kind: 'recommended', answer: result.answer, inventory, dropped: result.dropped, agent: `${agent.provider}${agent.model === null || agent.model === '' ? '' : ` · ${agent.model}`}` };
        } finally {
          running.delete(request.requestId);
          await adapter.dispose?.().catch(() => undefined);
        }
      }
      case 'cancelRecommend': {
        running.get(request.requestId)?.abort();
        return { kind: 'cancelled' };
      }
    }
  };
  return {
    handle,
    drafts,
    definitionKeyFor: (loopId) =>
      projectRows().find((row) => row.definition?.id === loopId && row.definition.projectInstructions !== undefined)?.filePath ?? null,
  };
}
