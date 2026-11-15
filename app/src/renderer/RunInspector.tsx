/**
 * The loop editor's panel in Run mode (Niclas, 15 November 2026): one run, read, not edited.
 *
 * With nothing selected it names the run. With a node selected it says what the run did
 * there, in words ("Done", "Did not run", "Skipped", "Ending reached", …), and gives the way
 * to the step's output: every visit and rework attempt (`StepOutputActions`) and, for a
 * fan-out, each branch (`BranchList`). With an edge selected it says whether the run took it.
 * **Edit this step** goes to Edit mode with the same step selected, when the drawing being
 * edited has it. Nothing here changes the run or the drawing.
 */

import type { JSX } from 'react';

import { branchRows, branchSummaryLine } from '../shared/branch-presentation';
import type { LoopGraph } from '../shared/loop-graph';
import { endingMarkFor, type FinishedRunMarks, type NodeRunState, type RunView } from '../shared/loop-run-view';
import { runNodeStatus } from '../shared/run-inspection';
import type { BranchView } from '../shared/run-presentation';
import { BranchList } from './BranchList';
import { StepOutputActions } from './StepOutputActions';

export function RunInspector({
  run,
  graph,
  selection,
  states,
  marks,
  edgesTaken,
  branches,
  canEdit,
  onEdit,
}: {
  readonly run: RunView;
  readonly graph: LoopGraph;
  readonly selection: { readonly kind: 'node' | 'edge'; readonly id: string } | null;
  readonly states: ReadonlyMap<string, NodeRunState>;
  readonly marks: FinishedRunMarks | null;
  readonly edgesTaken: ReadonlySet<string>;
  readonly branches: readonly BranchView[];
  /** Whether the drawing being edited has this step, so Edit this step can select it there. */
  readonly canEdit: (nodeId: string) => boolean;
  readonly onEdit: (nodeId: string) => void;
}): JSX.Element {
  const node = selection?.kind === 'node' ? (graph.nodes.find((item) => item.id === selection.id) ?? null) : null;
  const edge = selection?.kind === 'edge' ? (graph.edges.find((item) => item.id === selection.id) ?? null) : null;
  if (node !== null) {
    const status = runNodeStatus({ kind: node.kind, state: states.get(node.id), ending: endingMarkFor(marks, node.id), runEnded: run.ended });
    const summary = branchSummaryLine(branches, node.id);
    return (
      <section className="run-inspector" data-ev="run-inspector-node" data-node-id={node.id}>
        <h2 className="run-inspector__title">{node.label ?? node.id}</h2>
        <p className="run-inspector__status" data-ev="run-inspector-status">
          <strong>{status.word}.</strong> {status.detail}
        </p>
        <StepOutputActions node={node} watch={run} />
        {summary === null ? null : (
          <BranchList
            rows={branchRows(branches, node.id)}
            activity={run.branchSteps}
            heading={`${node.label ?? node.id} — ${summary}`}
            conversationId={run.run.conversationId}
          />
        )}
        {node.purpose === undefined || node.purpose === '' ? null : (
          <details className="run-inspector__purpose">
            <summary>What this step was told to do</summary>
            <p>{node.purpose}</p>
          </details>
        )}
        <p className="run-inspector__actions">
          <button type="button" className="button" data-ev="run-inspector-edit" disabled={!canEdit(node.id)} onClick={() => onEdit(node.id)}>
            Edit this step
          </button>
          {canEdit(node.id) ? null : <span className="muted"> The drawing being edited has no step “{node.id}”.</span>}
        </p>
      </section>
    );
  }
  if (edge !== null) {
    return (
      <section className="run-inspector" data-ev="run-inspector-edge">
        <h2 className="run-inspector__title">
          {edge.from} → {edge.to}
        </h2>
        <p className="run-inspector__status">
          <strong>{edgesTaken.has(edge.id) ? 'Taken.' : 'Not taken.'}</strong>{' '}
          {edgesTaken.has(edge.id) ? 'The run went this way.' : 'The run did not go this way.'}
        </p>
      </section>
    );
  }
  return (
    <section className="run-inspector" data-ev="run-inspector-run">
      <h2 className="run-inspector__title">Run {run.run.runId}</h2>
      <p className="run-inspector__status">
        <strong>{run.ended ? 'Ended.' : 'Running.'}</strong> {run.ended && run.note !== '' ? run.note : ''}
      </p>
      <p className="muted">
        Click a step to see what the run did there; a step that ran opens its output in a window. Click empty space to clear the
        selection. The drawing is the one this run walked, not the one being edited.
      </p>
    </section>
  );
}
