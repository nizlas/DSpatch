/**
 * DSP-227: the graph editor's forms for the two reusable sections — a choice made per task, and
 * a split that runs independent parts in parallel and integrates them.
 *
 * The forms read their settings from the graph and write them back through the same functions
 * the chat agent's `propose_graph_section` uses (`loop-graph-sections.ts`), so the editor, the
 * dialog, the loader and the run all read one definition. What DSpatch then writes for the
 * deciding and proposing steps is shown beside the settings, generated from them.
 */
import React, { useMemo, useState } from 'react';

import { describeVisitChoices } from '../shared/loop-choices';
import {
  MODEL_CLASSES,
  isModelClassChoice,
  type FanOutIsolation,
  type LoopGraph,
  type LoopNode,
  type ModelClass,
  type RoleReference,
  type VisitChoiceDef,
} from '../shared/loop-graph';
import { roleKey, uniqueId } from '../shared/loop-graph-editing';
import {
  DEFAULT_INTEGRATOR_OUTCOMES,
  applyChoiceSection,
  applyParallelSection,
  modelClassChoiceTemplate,
  readChoiceSection,
  readParallelSection,
  removeChoiceSection,
  reviewChoiceTemplate,
  type ChoiceSectionSettings,
  type ParallelSectionSettings,
} from '../shared/loop-graph-sections';
import { BRANCH_MEANING, describeSplitInstructions } from '../shared/loop-split-instructions';

const agentsOf = (graph: LoopGraph): readonly LoopNode[] => graph.nodes.filter((node) => node.kind === 'agent');
const nameOf = (node: Pick<LoopNode, 'id' | 'label'>): string => node.label ?? node.id;

// ---------------------------------------------------------------------------------------------
// Choices made per task

/** The graph's choices, each editable, and the buttons that add one. In the graph panel. */
export function ChoiceSections({ graph, onChange }: { readonly graph: LoopGraph; readonly onChange: (next: LoopGraph) => void }): React.JSX.Element {
  const [problems, setProblems] = useState<readonly string[]>([]);
  const add = (template: VisitChoiceDef): void => {
    const id = uniqueId(template.id, (graph.choices ?? []).map((choice) => choice.id));
    const applied = applyChoiceSection(graph, { choice: { ...template, id }, decidedBy: [], appliesTo: [] });
    setProblems([]);
    onChange(applied.graph);
  };
  return (
    <fieldset data-ev="graph-choices">
      <legend>Choices made per task</legend>
      <p className="muted">
        A step decides each choice on every visit, by the criteria written for its options, independently of its result. A model-class
        choice sets the class of the steps that follow it; the model of each class is the agent’s Model classes setting, never the
        graph’s. A review-route choice picks connections. DSpatch writes the deciding step’s instructions from these settings.
      </p>
      {(graph.choices ?? []).map((choice) => (
        <ChoiceForm key={choice.id} graph={graph} choiceId={choice.id} onChange={onChange} />
      ))}
      <div className="section-buttons">
        <button type="button" data-ev="add-model-class-choice" onClick={() => add(modelClassChoiceTemplate())}>
          Add model-class choice
        </button>
        <button type="button" data-ev="add-review-choice" onClick={() => add(reviewChoiceTemplate())}>
          Add review-route choice
        </button>
        <button
          type="button"
          data-ev="add-choice"
          onClick={() =>
            add({
              id: 'choice',
              label: 'A choice',
              meaning: 'What this choice decides.',
              options: [
                { id: 'one', meaning: 'When to choose it.' },
                { id: 'two', meaning: 'When to choose it.' },
              ],
              default: 'one',
            })
          }
        >
          Add a choice
        </button>
      </div>
      {problems.length === 0 ? null : <SectionProblems problems={problems} />}
    </fieldset>
  );
}

function ChoiceForm({ graph, choiceId, onChange }: { readonly graph: LoopGraph; readonly choiceId: string; readonly onChange: (next: LoopGraph) => void }): React.JSX.Element | null {
  const settings = readChoiceSection(graph, choiceId);
  const [problems, setProblems] = useState<readonly string[]>([]);
  if (settings === null) {
    return null;
  }
  const { choice } = settings;
  const classful = isModelClassChoice(choice);
  const ordered = choice.order === 'weakest-first';
  const put = (next: Partial<ChoiceSectionSettings> & { choice?: VisitChoiceDef }): void => {
    const applied = applyChoiceSection(graph, { ...settings, ...next });
    setProblems(applied.problems);
    onChange(applied.graph);
  };
  const putChoice = (next: Partial<VisitChoiceDef>): void => {
    const merged = { ...choice, ...next } as Record<string, unknown>;
    for (const key of ['order', 'joins', 'whenMissing'] as const) {
      if (merged[key] === undefined) delete merged[key];
    }
    // A join and a strongest fallback read the order; without one they go.
    if (merged.order === undefined) {
      delete merged.joins;
      if (merged.whenMissing === 'strongest') delete merged.whenMissing;
    }
    put({ choice: merged as unknown as VisitChoiceDef });
  };
  const putOption = (at: number, next: VisitChoiceDef['options'][number] | null): void => {
    const options = choice.options.flatMap((option, index) => (index !== at ? [option] : next === null ? [] : [next]));
    const renamed = next !== null && choice.options[at]?.id === choice.default ? next.id : choice.default;
    putChoice({ options, default: options.some((option) => option.id === renamed) ? renamed : (options[0]?.id ?? '') });
  };
  const agents = agentsOf(graph);
  const preview = describeVisitChoices(graph, { decides: [choice.id] }, {}).trim();
  return (
    <details className="section-form" data-ev="choice-form" open>
      <summary>
        <strong>{choice.label}</strong> <code>{choice.id}</code>
        {classful ? ' · model class' : ''}
      </summary>
      <label>
        Label
        <input value={choice.label} onChange={(event) => putChoice({ label: event.target.value })} />
      </label>
      <label>
        What it decides
        <textarea rows={2} value={choice.meaning} onChange={(event) => putChoice({ meaning: event.target.value })} />
      </label>
      <div data-ev="choice-options">
        {choice.options.map((option, at) => (
          <div key={at} className="setting section-option">
            <label>
              Option
              <input value={option.id} onChange={(event) => putOption(at, { ...option, id: event.target.value.replace(/\s+/g, '-') })} />
            </label>
            <label className="section-option-meaning">
              When to choose it
              <input value={option.meaning} onChange={(event) => putOption(at, { ...option, meaning: event.target.value })} />
            </label>
            <label title="Every option names a class, or none does">
              Model class
              <select
                data-ev="choice-option-class"
                value={option.modelClass ?? ''}
                onChange={(event) => {
                  const picked = MODEL_CLASSES.find((name) => name === event.target.value);
                  const { modelClass: _old, ...rest } = option;
                  putOption(at, picked === undefined ? rest : { ...rest, modelClass: picked as ModelClass });
                }}
              >
                <option value="">None</option>
                {MODEL_CLASSES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={choice.options.length <= 2} title="A choice keeps at least two options" onClick={() => putOption(at, null)}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            putChoice({
              options: [
                ...choice.options,
                {
                  id: uniqueId('option', choice.options.map((option) => option.id)),
                  meaning: 'When to choose it.',
                  ...(classful ? { modelClass: 'medium' as const } : {}),
                },
              ],
            })
          }
        >
          Add option
        </button>
      </div>
      <label>
        Default — before anything decides
        <select value={choice.default} onChange={(event) => putChoice({ default: event.target.value })}>
          {choice.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" data-ev="choice-ordered" checked={ordered} onChange={(event) => putChoice({ order: event.target.checked ? 'weakest-first' : undefined })} />
        The options are ordered, weakest first ({choice.options.map((option) => option.id).join(' < ')})
      </label>
      <label>
        When the deciding step states none, or one that is not an option
        <select
          data-ev="choice-when-missing"
          value={choice.whenMissing ?? 'default'}
          onChange={(event) => putChoice({ whenMissing: event.target.value === 'strongest' ? 'strongest' : undefined })}
        >
          <option value="default">Take the default ({choice.default})</option>
          <option value="strongest" disabled={!ordered}>
            Take the strongest ({choice.options[choice.options.length - 1]?.id ?? ''}){ordered ? '' : ' — needs an order'}
          </option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          data-ev="choice-joins"
          disabled={!ordered}
          checked={choice.joins === 'strongest'}
          onChange={(event) => putChoice({ joins: event.target.checked ? 'strongest' : undefined })}
        />
        After parallel branches, the work carries the strongest value any branch had{ordered ? '' : ' (needs an order)'}. Otherwise
        it carries the value its own step decided, whatever the branches ran.
      </label>
      <div className="section-nodes" data-ev="choice-decided-by">
        <span className="setting-name">Decided by</span>
        {agents.map((node) => (
          <label key={node.id} className="check">
            <input
              type="checkbox"
              checked={settings.decidedBy.includes(node.id)}
              onChange={(event) =>
                put({ decidedBy: event.target.checked ? [...settings.decidedBy, node.id] : settings.decidedBy.filter((id) => id !== node.id) })
              }
            />
            {nameOf(node)}
          </label>
        ))}
      </div>
      {classful ? (
        <div className="section-nodes" data-ev="choice-applies-to">
          <span className="setting-name">Steps whose model follows it, and the options each runs</span>
          {agents.map((node) => {
            const entry = settings.appliesTo.find((each) => each.nodeId === node.id);
            const allowed = entry === undefined ? [] : (entry.options ?? choice.options.map((option) => option.id));
            const putEntry = (next: { nodeId: string; options?: readonly string[] } | null): void =>
              put({ appliesTo: [...settings.appliesTo.filter((each) => each.nodeId !== node.id), ...(next === null ? [] : [next])] });
            return (
              <div key={node.id} className="section-applies">
                <label className="check">
                  <input type="checkbox" checked={entry !== undefined} onChange={(event) => putEntry(event.target.checked ? { nodeId: node.id } : null)} />
                  {nameOf(node)}
                </label>
                {entry === undefined
                  ? null
                  : choice.options.map((option) => (
                      <label key={option.id} className="check small">
                        <input
                          type="checkbox"
                          checked={allowed.includes(option.id)}
                          onChange={(event) => {
                            const next = event.target.checked ? [...allowed, option.id] : allowed.filter((id) => id !== option.id);
                            putEntry({ nodeId: node.id, ...(next.length === choice.options.length || next.length === 0 ? {} : { options: choice.options.map((each) => each.id).filter((id) => next.includes(id)) }) });
                          }}
                        />
                        {option.id}
                      </label>
                    ))}
              </div>
            );
          })}
          <p className="muted">A value a step does not run takes that step’s default, and the run records it.</p>
        </div>
      ) : null}
      {preview === '' ? null : (
        <details data-ev="choice-generated">
          <summary>What DSpatch writes for the deciding step</summary>
          <pre className="brief-text">{preview}</pre>
        </details>
      )}
      <button type="button" data-ev="choice-remove" onClick={() => onChange(removeChoiceSection(graph, choice.id))}>
        Remove this choice
      </button>
      {problems.length === 0 ? null : <SectionProblems problems={problems} />}
    </details>
  );
}

// ---------------------------------------------------------------------------------------------
// Split, run in parallel, integrate

/** The roles the graph's agent steps use, each once, to pick a branch's or an integrator's from. */
function rolesOf(graph: LoopGraph): readonly { readonly key: string; readonly role: RoleReference; readonly label: string }[] {
  const seen = new Map<string, { key: string; role: RoleReference; label: string }>();
  for (const node of agentsOf(graph)) {
    if (node.role !== undefined && !seen.has(roleKey(node.role))) {
      seen.set(roleKey(node.role), { key: roleKey(node.role), role: node.role, label: `${node.role.id} (as ${nameOf(node)})` });
    }
  }
  return [...seen.values()];
}

/** Settings for a new section, from what the graph has. */
function newParallelSettings(graph: LoopGraph): ParallelSectionSettings | null {
  const agents = agentsOf(graph).filter((node) => node.fanOut === undefined && node.role !== undefined);
  const proposer = agents.find((node) => (node.outcomes ?? []).length > 0) ?? agents[0];
  if (proposer?.role === undefined) {
    return null;
  }
  const ids = graph.nodes.map((node) => node.id);
  const branchesId = uniqueId('branches', ids);
  const integratorId = uniqueId('integrator', [...ids, branchesId]);
  const classChoice = (graph.choices ?? []).find((choice) => isModelClassChoice(choice));
  const after = agents.find((node) => node.id !== proposer.id) ?? proposer;
  return {
    proposer: proposer.id,
    splitOutcome: 'parallel',
    branches: { id: branchesId, label: 'Parallel branches', role: (after.role ?? proposer.role) as RoleReference },
    branchAs: [],
    sliceChoices: (graph.choices ?? []).map((choice) => choice.id),
    branchModelChoice: classChoice?.id ?? null,
    maxConcurrent: 3,
    isolation: 'worktree',
    integrator: { id: integratorId, label: 'Integrate the branches', role: proposer.role },
    outcomes: { ...DEFAULT_INTEGRATOR_OUTCOMES },
    afterIntegration: { to: after.id },
    onUnresolved: proposer.id,
    onLimit: null,
  };
}

/** The graph's parallel sections, and the form that adds one. In the graph panel. */
export function ParallelSections({
  graph,
  onChange,
  onSelectNode,
}: {
  readonly graph: LoopGraph;
  readonly onChange: (next: LoopGraph) => void;
  readonly onSelectNode: (id: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ParallelSectionSettings | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const fanOuts = graph.nodes.filter((node) => node.fanOut !== undefined);
  return (
    <fieldset data-ev="graph-parallel">
      <legend>Parallel sections</legend>
      <p className="muted">
        A step proposes a split; independent parts run as parallel branches, each with its own role, model class and review need; another step
        integrates them. Work that does not split keeps its sequential path. {BRANCH_MEANING}
      </p>
      {fanOuts.length === 0 ? <p className="muted">None.</p> : null}
      {fanOuts.map((node) => (
        <p key={node.id}>
          <button type="button" className="link-button" data-ev="parallel-section-open" onClick={() => onSelectNode(node.id)}>
            {nameOf(node)}
          </button>{' '}
          — proposed by {nameOf(graph.nodes.find((each) => each.id === node.fanOut?.slicesFrom) ?? { id: node.fanOut?.slicesFrom ?? '' })}
        </p>
      ))}
      {draft === null ? (
        <button
          type="button"
          data-ev="add-parallel-section"
          disabled={newParallelSettings(graph) === null}
          onClick={() => {
            setProblems([]);
            setDraft(newParallelSettings(graph));
          }}
        >
          Add parallel section…
        </button>
      ) : (
        <div className="section-form" data-ev="parallel-new">
          <ParallelForm graph={graph} settings={draft} creating onSettings={setDraft} />
          <div className="section-buttons">
            <button
              type="button"
              data-ev="parallel-add-confirm"
              onClick={() => {
                const applied = applyParallelSection(graph, draft);
                setProblems(applied.problems);
                if (applied.problems.length === 0) {
                  onChange(applied.graph);
                  setDraft(null);
                }
              }}
            >
              Add to the graph
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          {problems.length === 0 ? null : <SectionProblems problems={problems} />}
        </div>
      )}
    </fieldset>
  );
}

/** A fan-out step's section, edited where the step is selected. Each change is applied at once. */
export function ParallelSectionPanel({ graph, node, onChange }: { readonly graph: LoopGraph; readonly node: LoopNode; readonly onChange: (next: LoopGraph) => void }): React.JSX.Element | null {
  const settings = useMemo(() => readParallelSection(graph, node.id), [graph, node.id]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  if (settings === null) {
    return null;
  }
  return (
    <fieldset data-ev="node-parallel-section">
      <legend>Parallel section</legend>
      <p className="muted" data-ev="node-branch-meaning">
        {BRANCH_MEANING}
      </p>
      <ParallelForm
        graph={graph}
        settings={settings}
        creating={false}
        onSettings={(next) => {
          const applied = applyParallelSection(graph, next);
          setProblems(applied.problems);
          if (applied.problems.length === 0) {
            onChange(applied.graph);
          }
        }}
      />
      {problems.length === 0 ? null : <SectionProblems problems={problems} />}
    </fieldset>
  );
}

/** What DSpatch writes for a proposing step, generated from the graph; empty for any other step. */
export function SplitInstructionsPreview({ graph, node }: { readonly graph: LoopGraph; readonly node: LoopNode }): React.JSX.Element | null {
  const text = describeSplitInstructions(graph, node).trim();
  if (text === '') {
    return null;
  }
  return (
    <details className="section-generated" data-ev="node-split-instructions">
      <summary>This step proposes a split: what DSpatch writes for it</summary>
      <pre className="brief-text">{text}</pre>
    </details>
  );
}

function ParallelForm({
  graph,
  settings,
  creating,
  onSettings,
}: {
  readonly graph: LoopGraph;
  readonly settings: ParallelSectionSettings;
  readonly creating: boolean;
  readonly onSettings: (next: ParallelSectionSettings) => void;
}): React.JSX.Element {
  const agents = agentsOf(graph).filter((node) => node.id !== settings.branches.id && node.id !== settings.integrator.id);
  const steps = graph.nodes.filter((node) => node.id !== settings.branches.id && node.id !== settings.integrator.id);
  const roles = rolesOf(graph);
  const put = (next: Partial<ParallelSectionSettings>): void => onSettings({ ...settings, ...next });
  const choices = graph.choices ?? [];
  const classChoices = choices.filter((choice) => isModelClassChoice(choice));
  const after = settings.afterIntegration;
  const proposer = graph.nodes.find((node) => node.id === settings.proposer);
  const sequential = (proposer?.outcomes ?? []).filter((outcome) => outcome !== settings.splitOutcome);
  const roleSelect = (value: RoleReference, onPick: (role: RoleReference) => void, ev: string): React.JSX.Element => (
    <select data-ev={ev} value={roleKey(value)} onChange={(event) => {
      const picked = roles.find((each) => each.key === event.target.value);
      if (picked !== undefined) onPick(picked.role);
    }}>
      {roles.some((each) => each.key === roleKey(value)) ? null : <option value={roleKey(value)}>{value.id}</option>}
      {roles.map((each) => (
        <option key={each.key} value={each.key}>
          {each.label}
        </option>
      ))}
    </select>
  );
  const stepSelect = (value: string, onPick: (id: string) => void, ev: string, list: readonly LoopNode[] = steps): React.JSX.Element => (
    <select data-ev={ev} value={value} onChange={(event) => onPick(event.target.value)}>
      {list.some((node) => node.id === value) ? null : <option value={value}>{value}</option>}
      {list.map((node) => (
        <option key={node.id} value={node.id}>
          {nameOf(node)}
        </option>
      ))}
    </select>
  );
  return (
    <div className="parallel-form" data-ev="parallel-form">
      <h4>Proposing the split</h4>
      <label>
        Step that proposes it
        {stepSelect(settings.proposer, (id) => put({ proposer: id, onUnresolved: settings.onUnresolved === settings.proposer ? id : settings.onUnresolved }), 'parallel-proposer', agents)}
      </label>
      <label>
        Its outcome that splits
        <input data-ev="parallel-split-outcome" value={settings.splitOutcome} onChange={(event) => put({ splitOutcome: event.target.value.trim() })} />
      </label>
      <p className="muted" data-ev="parallel-sequential">
        {sequential.length === 0
          ? 'This step has no other outcome yet, so work that does not split has no sequential path. Give it one before adding the section.'
          : `Sequential path, kept as it is: ${sequential.join(', ')}.`}
      </p>
      <label>
        When to split, in this graph’s words (optional)
        <textarea rows={2} data-ev="parallel-split-when" value={settings.splitWhen ?? ''} onChange={(event) => put({ splitWhen: event.target.value })} />
      </label>

      <h4>The branches</h4>
      {creating ? (
        <label>
          Step id
          <input data-ev="parallel-branches-id" value={settings.branches.id} onChange={(event) => put({ branches: { ...settings.branches, id: event.target.value.trim() } })} />
        </label>
      ) : null}
      <label>
        Label
        <input data-ev="parallel-branches-label" value={settings.branches.label ?? ''} onChange={(event) => put({ branches: { ...settings.branches, label: event.target.value } })} />
      </label>
      <label>
        Role of a branch whose slice names no other
        {roleSelect(settings.branches.role, (role) => put({ branches: { ...settings.branches, role } }), 'parallel-branches-role')}
      </label>
      <div className="section-nodes" data-ev="parallel-branch-as">
        <span className="setting-name">A slice may run its branch as (that step’s role, purpose, requirements and model policy; not its routes)</span>
        {agents
          .filter((node) => node.id !== settings.proposer && node.fanOut === undefined)
          .map((node) => (
            <label key={node.id} className="check">
              <input
                type="checkbox"
                checked={settings.branchAs.includes(node.id)}
                onChange={(event) => put({ branchAs: event.target.checked ? [...settings.branchAs, node.id] : settings.branchAs.filter((id) => id !== node.id) })}
              />
              {nameOf(node)}
            </label>
          ))}
      </div>
      <div className="section-nodes" data-ev="parallel-slice-choices">
        <span className="setting-name">A slice may set for its own branch</span>
        {choices.length === 0 ? <span className="muted">No choices yet: add one under Choices made per task.</span> : null}
        {choices.map((choice) => (
          <label key={choice.id} className="check">
            <input
              type="checkbox"
              checked={settings.sliceChoices.includes(choice.id)}
              onChange={(event) => put({ sliceChoices: event.target.checked ? [...settings.sliceChoices, choice.id] : settings.sliceChoices.filter((id) => id !== choice.id) })}
            />
            {choice.label}
          </label>
        ))}
      </div>
      <label>
        Model of a branch that runs as this step
        <select data-ev="parallel-branch-model" value={settings.branchModelChoice ?? ''} onChange={(event) => put({ branchModelChoice: event.target.value === '' ? null : event.target.value })}>
          <option value="">The agent’s own model</option>
          {classChoices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              Follows “{choice.label}”
            </option>
          ))}
        </select>
      </label>
      <label>
        At most at the same time
        <select data-ev="parallel-max" value={settings.maxConcurrent} onChange={(event) => put({ maxConcurrent: Number(event.target.value) })}>
          {[1, 2, 3].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">The agent may allow fewer: Cursor runs one branch at a time, and the run then says so.</p>
      <label>
        Isolation
        <select data-ev="parallel-isolation" value={settings.isolation} onChange={(event) => put({ isolation: event.target.value as FanOutIsolation })}>
          <option value="worktree">Each branch in its own worktree from one base</option>
          <option value="shared-read-only">Read-only, in the shared working copy</option>
        </select>
      </label>
      <p className="muted">
        Each slice names the paths only it may change, the shared contracts it works against, what it must meet and its check. Overlapping
        paths and slices that depend on each other are refused before any branch starts.
      </p>

      <h4>Integrating</h4>
      {creating ? (
        <label>
          Step id (an existing step, or a new one)
          <input data-ev="parallel-integrator-id" value={settings.integrator.id} onChange={(event) => put({ integrator: { ...settings.integrator, id: event.target.value.trim() } })} />
        </label>
      ) : null}
      <label>
        Label
        <input value={settings.integrator.label ?? ''} onChange={(event) => put({ integrator: { ...settings.integrator, label: event.target.value } })} />
      </label>
      <label>
        Role
        {roleSelect(settings.integrator.role, (role) => put({ integrator: { ...settings.integrator, role } }), 'parallel-integrator-role')}
      </label>
      <label>
        Its model — its own policy; a branch’s class does not choose it
        <select
          data-ev="parallel-integrator-model"
          value={
            settings.integrator.model?.policy === 'select' && settings.integrator.model.chosenBy !== undefined
              ? `choice:${settings.integrator.model.chosenBy}`
              : settings.integrator.model?.policy === 'select' && settings.integrator.model.options?.length === 1 && settings.integrator.model.options[0]?.modelClass !== undefined
                ? `class:${settings.integrator.model.options[0].modelClass}`
                : 'inherit'
          }
          onChange={(event) => {
            const [kind, value] = event.target.value.split(':');
            const choice = classChoices.find((each) => each.id === value);
            put({
              integrator: {
                ...settings.integrator,
                model:
                  kind === 'class'
                    ? { policy: 'select', options: [{ id: value ?? 'medium', modelClass: value as ModelClass }], default: value ?? 'medium' }
                    : kind === 'choice' && choice !== undefined
                      ? { policy: 'select', options: choice.options.map((option) => ({ id: option.id, modelClass: option.modelClass })), default: choice.default, chosenBy: choice.id }
                      : { policy: 'inherit' },
              },
            });
          }}
        >
          <option value="inherit">The agent’s own model</option>
          {MODEL_CLASSES.map((name) => (
            <option key={name} value={`class:${name}`}>
              Always class {name}
            </option>
          ))}
          {classChoices.map((choice) => (
            <option key={choice.id} value={`choice:${choice.id}`}>
              Follows “{choice.label}”{choice.joins === 'strongest' ? ' (the strongest any branch had)' : ' (as the proposing step decided)'}
            </option>
          ))}
        </select>
      </label>
      <div className="setting section-outcomes">
        {(['integrated', 'rework', 'unresolved'] as const).map((key) => (
          <label key={key}>
            {key === 'integrated' ? 'Outcome: integrated' : key === 'rework' ? 'Outcome: another round' : 'Outcome: needs a decision'}
            <input value={settings.outcomes[key]} onChange={(event) => put({ outcomes: { ...settings.outcomes, [key]: event.target.value.trim() } })} />
          </label>
        ))}
      </div>
      <label>
        Integrated work goes to
        <select
          data-ev="parallel-after-kind"
          value={'byChoice' in after ? `choice:${after.byChoice}` : 'one'}
          onChange={(event) => {
            const [kind, id] = event.target.value.split(':');
            const choice = choices.find((each) => each.id === id);
            put({
              afterIntegration:
                kind === 'choice' && choice !== undefined
                  ? { byChoice: choice.id, to: Object.fromEntries(choice.options.map((option) => [option.id, 'byChoice' in after ? (after.to[option.id] ?? '') : after.to])) }
                  : { to: 'byChoice' in after ? (Object.values(after.to)[0] ?? '') : after.to },
            });
          }}
        >
          <option value="one">One step</option>
          {choices.map((choice) => (
            <option key={choice.id} value={`choice:${choice.id}`}>
              A step per “{choice.label}”
            </option>
          ))}
        </select>
      </label>
      {'byChoice' in after ? (
        (choices.find((choice) => choice.id === after.byChoice)?.options ?? []).map((option) => (
          <label key={option.id}>
            When {after.byChoice} is {option.id}
            {stepSelect(after.to[option.id] ?? '', (id) => put({ afterIntegration: { byChoice: after.byChoice, to: { ...after.to, [option.id]: id } } }), `parallel-after-${option.id}`)}
          </label>
        ))
      ) : (
        <label>
          Step
          {stepSelect(after.to, (id) => put({ afterIntegration: { to: id } }), 'parallel-after-one')}
        </label>
      )}
      <label>
        A failed branch, an open decision or a needed resplit goes to
        {stepSelect(settings.onUnresolved, (id) => put({ onUnresolved: id }), 'parallel-unresolved')}
      </label>
      <label>
        A reached run limit goes to
        <select data-ev="parallel-limit" value={settings.onLimit ?? ''} onChange={(event) => put({ onLimit: event.target.value === '' ? null : event.target.value })}>
          <option value="">Nowhere: the run stops there</option>
          {steps.map((node) => (
            <option key={node.id} value={node.id}>
              {nameOf(node)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">Another round of the branches is the integrator’s second outcome; it always returns to these branches, as a new round.</p>
    </div>
  );
}

function SectionProblems({ problems }: { readonly problems: readonly string[] }): React.JSX.Element {
  return (
    <ul className="findings" data-ev="section-problems">
      {problems.map((problem) => (
        <li key={problem} className="finding finding-warning">
          {problem}
        </li>
      ))}
    </ul>
  );
}
