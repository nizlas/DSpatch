/**
 * The drawing of a loop graph: edges, nodes, their run states and the motion that goes with
 * them. One component for the graph editor's canvas and for a view of a run (DSP-190).
 *
 * Moved out of `LoopEditor.tsx` so a window that only looks at a run — the walk preparation's
 * *Follow preparation* — draws the same shapes, the same run marks and the same animations as
 * the editor, with nothing copied. The difference between the two is the `mode`: the editor's
 * canvas is armed for placing and connecting and offers the help titles; a view is locked,
 * offers selection and nothing that changes the drawing. Everything about what a node looks
 * like while a run walks is in `shared/loop-run-view.ts` and `loop-editor.css`, unchanged.
 */

import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';

import type { LoopEdge, LoopGraph, LoopNode, ResolvedRole } from '../shared/loop-graph';
import type { Finding } from '../shared/loop-graph-load';
import { nodeById, roleKey } from '../shared/loop-graph-editing';
import {
  ANCHOR_DOT_RADIUS,
  GLINT_PATH_LENGTH,
  glintSegments,
  NODE_HEIGHT,
  NODE_WIDTH,
  attachPoint,
  boxCentre,
  nodeBox,
  nodeCornerRadius,
  nodeOutlinePath,
} from '../shared/loop-edge-geometry';
import { NODE_RUN_STATE_MARKS, endingMarkFor, nodeRunStateFor, type EndingMark, type FinishedRunMarks, type NodeRunState } from '../shared/loop-run-view';

export type GraphSelection = { readonly kind: 'node' | 'edge'; readonly id: string } | null;

/** The drawing's extent, with room around it. */
export function graphBounds(graph: LoopGraph | null): { readonly width: number; readonly height: number } {
  if (graph === null) {
    return { width: 900, height: 600 };
  }
  let maxX = 0;
  let maxY = 0;
  for (const node of graph.nodes) {
    maxX = Math.max(maxX, (node.view?.x ?? 0) + NODE_WIDTH);
    maxY = Math.max(maxY, (node.view?.y ?? 0) + NODE_HEIGHT);
  }
  return { width: maxX + 120, height: maxY + 120 };
}

export interface GraphCanvasProps {
  readonly graph: LoopGraph;
  readonly roles: ReadonlyMap<string, ResolvedRole | null>;
  readonly zoom: number;
  /** `edit`: the author's canvas; `view`: a run on screen, with nothing that changes the drawing. */
  readonly mode: 'edit' | 'view';
  /** A placing or connecting tool is armed (the editor). */
  readonly armed?: boolean;
  /** Editing is locked while a run walks (the editor); a view is always locked. */
  readonly locked?: boolean;
  readonly svgRef?: RefObject<SVGSVGElement | null>;
  readonly onCanvasClick?: (event: ReactMouseEvent) => void;
  readonly onCanvasMouseMove?: (event: ReactMouseEvent) => void;
  readonly selection: GraphSelection;
  readonly connectingFrom?: string | null;
  readonly showLabels: boolean;
  readonly edgesTaken: ReadonlySet<string>;
  readonly runStates: ReadonlyMap<string, NodeRunState>;
  readonly workingNodes: ReadonlySet<string>;
  readonly endingMarks: FinishedRunMarks | null;
  readonly severityOfNode?: (nodeId: string) => Finding['severity'] | null;
  readonly severityOfEdge?: (edgeId: string) => Finding['severity'] | null;
  readonly helpTitleOf?: (node: LoopNode) => string;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onNodeMouseDown: (event: ReactMouseEvent, node: LoopNode) => void;
}

export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  const { graph, selection } = props;
  const bounds = graphBounds(graph);
  const classes = [props.mode === 'view' ? 'view' : '', props.armed === true && props.locked !== true ? 'armed' : '', props.locked === true || props.mode === 'view' ? 'locked' : '']
    .filter((entry) => entry !== '')
    .join(' ');
  return (
    <svg
      ref={props.svgRef}
      width={bounds.width * props.zoom}
      height={bounds.height * props.zoom}
      viewBox={`0 0 ${String(bounds.width)} ${String(bounds.height)}`}
      className={classes}
      data-mode={props.mode}
      onClick={props.onCanvasClick}
      onMouseMove={props.onCanvasMouseMove}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
        </marker>
        <marker id="arrow-failure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-failure" />
        </marker>
      </defs>

      {/*
        Selection and severity are **not** suppressed while a run walks, which DSP-28 did
        because the drawing then belonged to the run rather than to the author. It is the
        author's own drawing throughout now, and DSP-86 #3 asks for exactly this: selecting a
        node and reading what it is told still works while the run is going. Editing is what
        the lock holds, and the lock is enforced where a change would be made — not by taking
        the highlighting away.
      */}
      {graph.edges.map((edge) => (
        <EdgeShape
          key={edge.id}
          edge={edge}
          graph={graph}
          selected={selection?.kind === 'edge' && selection.id === edge.id}
          highlighted={selection?.kind === 'node' && (edge.from === selection.id || edge.to === selection.id)}
          showLabel={props.showLabels}
          taken={props.edgesTaken.has(edge.id)}
          severity={props.severityOfEdge?.(edge.id) ?? null}
          onSelect={() => {
            props.onSelectEdge(edge.id);
          }}
        />
      ))}

      {graph.nodes.map((node) => (
        <NodeShape
          key={node.id}
          node={node}
          role={node.role ? (props.roles.get(roleKey(node.role)) ?? null) : null}
          isEntry={graph.entry === node.id}
          selected={selection?.kind === 'node' && selection.id === node.id}
          connecting={props.connectingFrom === node.id}
          runState={nodeRunStateFor(props.runStates, node.id)}
          working={props.workingNodes.has(node.id)}
          ending={endingMarkFor(props.endingMarks, node.id)}
          severity={props.severityOfNode?.(node.id) ?? null}
          helpTitle={props.helpTitleOf?.(node)}
          onMouseDown={(event) => props.onNodeMouseDown(event, node)}
        />
      ))}
    </svg>
  );
}

function centreOf(node: LoopNode): { readonly x: number; readonly y: number } {
  return boxCentre(nodeBox(node.view));
}

function EdgeShape({
  edge,
  graph,
  selected,
  highlighted,
  showLabel,
  taken,
  severity,
  onSelect,
}: {
  readonly edge: LoopEdge;
  readonly graph: LoopGraph;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly showLabel: boolean;
  readonly taken: boolean;
  readonly severity: Finding['severity'] | null;
  readonly onSelect: () => void;
}): React.JSX.Element | null {
  const source = nodeById(graph, edge.from);
  const target = nodeById(graph, edge.to);
  if (source === null || target === null) {
    return null;
  }
  const a = centreOf(source);
  const b = centreOf(target);
  const sourceBox = nodeBox(source.view);
  const targetBox = nodeBox(target.view);

  // Parallel edges are bowed apart so two arrows between the same pair stay two.
  const siblings = graph.edges.filter(
    (other) =>
      (other.from === edge.from && other.to === edge.to) ||
      (other.from === edge.to && other.to === edge.from),
  );
  const position = siblings.findIndex((other) => other.id === edge.id);
  const spread = (position - (siblings.length - 1) / 2) * 30;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const control = {
    x: (a.x + b.x) / 2 + normal.x * spread,
    y: (a.y + b.y) / 2 + normal.y * spread,
  };

  const start = attachPoint(control, sourceBox);
  const end = attachPoint(control, targetBox);
  const failure = edge.when.on === 'declared-failure';
  const midpoint = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };

  const classes = [
    'edge',
    failure ? 'edge-failure' : edge.when.on === 'outcome' ? 'edge-outcome' : 'edge-success',
    selected ? 'edge-selected' : '',
    highlighted ? 'edge-highlighted' : '',
    taken ? 'edge-taken' : '',
    severity === null ? '' : `edge-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  const text =
    edge.label ??
    (edge.when.on === 'outcome'
      ? edge.when.outcome
      : edge.when.on === 'declared-failure'
        ? edge.when.failure
        : 'success');

  return (
    <g
      className={classes}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <path
        d={`M ${String(start.x)} ${String(start.y)} Q ${String(control.x)} ${String(control.y)} ${String(end.x)} ${String(end.y)}`}
        markerEnd={failure ? 'url(#arrow-failure)' : 'url(#arrow)'}
      />
      <path
        className="edge-hit"
        d={`M ${String(start.x)} ${String(start.y)} Q ${String(control.x)} ${String(control.y)} ${String(end.x)} ${String(end.y)}`}
      />
      <circle className="edge-dot" cx={start.x} cy={start.y} r={ANCHOR_DOT_RADIUS} />
      <circle className="edge-dot" cx={end.x} cy={end.y} r={ANCHOR_DOT_RADIUS} />
      {showLabel || selected || highlighted ? (
        <text x={midpoint.x} y={midpoint.y - 4} className="edge-label">
          {text}
        </text>
      ) : null}
    </g>
  );
}

function NodeShape({
  node,
  role,
  isEntry,
  selected,
  connecting,
  runState,
  working,
  ending,
  severity,
  helpTitle,
  onMouseDown,
}: {
  readonly node: LoopNode;
  readonly role: ResolvedRole | null;
  readonly isEntry: boolean;
  readonly selected: boolean;
  readonly connecting: boolean;
  readonly runState: NodeRunState;
  /**
   * Whether the glint runs on this node (DSP-80).
   *
   * Passed in rather than derived from `runState`, because the two are different
   * questions: a node held at a pause is still `active` and is not working, and
   * `nodeIsWorking` in `shared/loop-run-view.ts` is where the difference is decided.
   */
  readonly working: boolean;
  /** The ending this run reached, on the one node that reached it (DSP-36). */
  readonly ending: EndingMark | null;
  readonly severity: Finding['severity'] | null;
  readonly helpTitle?: string;
  readonly onMouseDown: (event: ReactMouseEvent) => void;
}): React.JSX.Element {
  const x = node.view?.x ?? 0;
  const y = node.view?.y ?? 0;
  const mark = NODE_RUN_STATE_MARKS[runState];
  const classes = [
    'node',
    `kind-${node.kind}`,
    selected ? 'node-selected' : '',
    connecting ? 'node-connecting' : '',
    runState === 'not-reached' ? '' : 'node-on-path',
    mark.className,
    working ? 'node-working' : '',
    ending === null ? '' : 'node-ended-here',
    ending === 'success' ? 'node-ended-met' : '',
    severity === null ? '' : `node-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  const broken = node.role !== undefined && role === null;
  /*
    The node's own outline, as a path, for the halo and the glint (DSP-80).

    A path and not a second `<rect>`, because the glint is a dash travelling the outline
    and a dash needs a length: `pathLength={GLINT_PATH_LENGTH}` makes the browser measure
    this shape and scale every dash and offset to it, so one stylesheet rule works for a
    54-pixel pill, a 6-pixel-cornered box and a diamond without any of them being
    measured here. It also means the corners are not a special case — a dash following a
    path follows it round an arc, which is what "including around the corners" asks for.

    `nodeOutlinePath` shares its corner radius with the `<rect>` below, so the glint
    traces the border rather than something near it.
  */
  const outline = nodeOutlinePath(node.kind);

  return (
    <g
      className={classes}
      // The state as a word, beside the class that colours it. A trial reading the
      // liveness off class names would be asserting the stylesheet's vocabulary; this
      // is the same value `nodeRunStateFor` returned, which is the thing that decides.
      data-node-id={node.id}
      data-run-state={runState}
      // Read by the window trial, and each of these is a decision rather than a class
      // name: whether the working animation is running, and which ending this node is.
      // `data-run-ending` is `success` only where the *graph* declares it, so a trial can
      // establish that renaming a terminal does not earn a tick.
      data-run-working={working ? 'true' : 'false'}
      data-run-ending={ending ?? ''}
      transform={`translate(${String(x)} ${String(y)})`}
      onMouseDown={onMouseDown}
      // Selection happens on mousedown, and the click that follows would otherwise
      // reach the canvas and clear it again — which made a node impossible to select
      // and was found by clicking one.
      onClick={(event) => event.stopPropagation()}
    >
      {/*
        The run state is the first thing the accessibility tree should reach, and it is
        a title rather than only a colour because DSP-28 #3 asks for states that are
        distinguishable when the animation is absent, ignored or unwanted.
      */}
      {runState === 'not-reached' ? (
        helpTitle === undefined ? null : (
          <title>{helpTitle}</title>
        )
      ) : (
        <title>{`${node.label ?? node.id}: ${mark.label}${
          ending === null
            ? ''
            : ending === 'success'
              ? ' — the run ended here, at the terminal this loop declares as the assignment being met'
              : ' — the run ended here, and this loop does not declare arriving here as the assignment being met'
        }${helpTitle === undefined ? '' : ` — ${helpTitle}`}`}</title>
      )}
      {/*
        The halo, under the body so only its outer half shows (DSP-80).

        This is the strengthened pulse. The old one dimmed the whole body between 1 and
        0.55 opacity, which on a 168×54 box a person is not looking at reads as almost
        nothing — and the obvious way to make it clearer, more opacity swing or a heavier
        border, is the way to make it flicker. So the amplitude went into a soft ring of
        the state's own colour instead: a wide, low-opacity stroke on the node's own
        outline, breathing between two opacities and drawn *before* the body so the body's
        fill covers the inner half and what is left is a glow outside the border. The
        border itself and the word beside it do not move.

        **Opacity only, and never the width.** A ring that grew and shrank would be the
        clearer pulse and it would also be the node appearing to change size, which is
        the one thing the card forbids. It is off entirely for a node that is neither
        ready nor on the run's path, so an ordinary drawing carries no extra ink.
      */}
      <path className="node-halo" d={outline} pathLength={GLINT_PATH_LENGTH} />
      {node.kind === 'router' ? (
        <polygon
          points={`${String(NODE_WIDTH / 2)},0 ${String(NODE_WIDTH)},${String(NODE_HEIGHT / 2)} ${String(NODE_WIDTH / 2)},${String(NODE_HEIGHT)} 0,${String(NODE_HEIGHT / 2)}`}
          className="node-body"
        />
      ) : (
        <rect
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx={nodeCornerRadius(node.kind)}
          className="node-body"
        />
      )}
      {/*
        The glint: one continuous gradient travelling the outline.

        Niclas tried the four-dash version and read it as what it was — separate bright
        marks of differing intensity. The motion was right and is untouched; what changed is
        how the light is distributed along it. `glintSegments()` cuts one ramp into pieces
        that touch end to end, cut at equal steps of brightness rather than of length, so
        the seams fall where the eye is least able to find them. Its doc comment carries the
        reasoning; the numbers are there and not here so they can be unit-tested.

        Each piece carries its own dash pattern, width, colour and alpha as **attributes**,
        which is deliberate: a presentation attribute loses to any stylesheet rule, so the
        reduced-motion block can still take the whole gradient away and put a still ring in
        its place without needing `!important`.

        Rendered only while the node is working. The pieces are many and they mean exactly
        one thing — *an agent is doing something now* — so a drawing where nothing is
        working carries none of them. The halo is drawn unconditionally and traces the same
        path, so the group's bounding box does not move either way.

        Drawn after the body, because the head is meant to read as light on the border
        rather than under it; `pointer-events: none` keeps them from changing what a click
        on a node hits.
      */}
      {working
        ? glintSegments().map((segment, index) => (
            <path
              key={index}
              className={`node-glint node-glint-${String(index)}`}
              d={outline}
              pathLength={GLINT_PATH_LENGTH}
              strokeDasharray={segment.dashArray}
              strokeWidth={segment.width}
              stroke={segment.colour}
              opacity={segment.alpha}
            />
          ))
        : null}
      <text x={NODE_WIDTH / 2} y={21} className="node-label">
        {truncate(node.label ?? node.id, 24)}
      </text>
      <text x={NODE_WIDTH / 2} y={38} className="node-kind">
        {node.kind}
        {node.role === undefined ? '' : broken ? ' · role broken' : ` · ${node.role.id}`}
      </text>
      {isEntry ? (
        <text x={6} y={NODE_HEIGHT - 5} className="node-entry">
          entry
        </text>
      ) : null}
      {/*
        A word, not only a border and never only a pulse. "running" and "done" are told
        apart here by reading, which is the whole of the accessibility clause: motion may
        add emphasis to the active node and carries no meaning by itself.
      */}
      {mark.mark === '' ? null : (
        <text x={NODE_WIDTH - 6} y={NODE_HEIGHT - 5} className="node-run-mark" textAnchor="end">
          {mark.mark}
        </text>
      )}
      {/*
        Where the run ended, and whether this loop calls that the assignment being met.

        Both endings are marked and only one of them is a tick, which is the whole of
        DSP-36's second half. The tick is the graph's `ending: "success"` and nothing else:
        `endingMarkFor` reached it through the run's recorded terminal and the terminal's
        own declaration, so a drawing that renames *Assignment not met* to *Delivered* gets
        the ring, and one whose success terminal is labelled `x7` gets the tick.

        A ring rather than a cross for the other endings, because the run ending somewhere
        else is not a failure to report — *could not establish* is an honest outcome, and a
        red cross on it would say something the run did not. The word beside it already
        says which: `done`, `failed` or `stopped` from the state's own mark.

        Top left, where nothing else is drawn: the state's word is bottom right, the
        findings dot is top right, `entry` is bottom left, and both labels are centred.
      */}
      {ending === null ? null : ending === 'success' ? (
        <path className="node-ending-tick" d="M 9 10.5 L 12.6 14.5 L 19.5 4.5" />
      ) : (
        <circle className="node-ending-ring" cx={14} cy={9.5} r={5} />
      )}
      {severity === null ? null : <circle cx={NODE_WIDTH - 9} cy={9} r={4} className="node-mark" />}
    </g>
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
