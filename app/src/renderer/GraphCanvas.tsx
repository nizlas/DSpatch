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

import { useMemo, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';

import type { LoopEdge, LoopGraph, LoopNode, ResolvedRole } from '../shared/loop-graph';
import type { Finding } from '../shared/loop-graph-load';
import { roleKey } from '../shared/loop-graph-editing';
import {
  ANCHOR_DOT_RADIUS,
  GLINT_PATH_LENGTH,
  glintSegments,
  NODE_WIDTH,
  nodeCornerRadius,
  nodeOutlinePath,
  nodeSize,
} from '../shared/loop-edge-geometry';
import { routeExtent, routeLoopEdges, type EdgeRoute } from '../shared/loop-edge-routing';
import { NODE_RUN_STATE_MARKS, endingMarkFor, nodeRunStateFor, type EndingMark, type FinishedRunMarks, type NodeRunState } from '../shared/loop-run-view';

export type GraphSelection = { readonly kind: 'node' | 'edge'; readonly id: string } | null;

/**
 * The drawing's extent, with room around it — and, given the routes, room for the outer
 * lanes back edges run in.
 */
export function graphBounds(
  graph: LoopGraph | null,
  routes?: ReadonlyMap<string, EdgeRoute>,
): { readonly width: number; readonly height: number } {
  if (graph === null) {
    return { width: 900, height: 600 };
  }
  let maxX = 0;
  let maxY = 0;
  for (const node of graph.nodes) {
    const size = nodeSize(node);
    maxX = Math.max(maxX, (node.view?.x ?? 0) + size.width);
    maxY = Math.max(maxY, (node.view?.y ?? 0) + size.height);
  }
  const extent = routes === undefined ? { maxX: 0, maxY: 0 } : routeExtent(routes);
  return { width: Math.max(maxX + 120, extent.maxX + 60), height: Math.max(maxY + 120, extent.maxY + 60) };
}

/** The words an edge is labelled with on the canvas. */
function edgeText(edge: LoopEdge): string {
  return (
    edge.label ??
    (edge.when.on === 'outcome'
      ? edge.when.outcome
      : edge.when.on === 'declared-failure'
        ? edge.when.failure
        : 'success')
  );
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
  /** DSP-209 S10b: a fan-out node's branches in a few words, by node id. S20: drawn on the node. */
  readonly branchSummaries?: ReadonlyMap<string, string>;
  /** DSP-209 S20: the node's branch line was pressed; open its Branches list. */
  readonly onOpenBranches?: (nodeId: string) => void;
  readonly workingNodes: ReadonlySet<string>;
  readonly endingMarks: FinishedRunMarks | null;
  readonly severityOfNode?: (nodeId: string) => Finding['severity'] | null;
  readonly severityOfEdge?: (edgeId: string) => Finding['severity'] | null;
  /** The node's hover, given its resolved role (DSP-209 S26: a short description, whole). */
  readonly helpTitleOf?: (node: LoopNode, role: ResolvedRole | null) => string;
  readonly onSelectEdge: (edgeId: string) => void;
  readonly onNodeMouseDown: (event: ReactMouseEvent, node: LoopNode) => void;
}

export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  const { graph, selection } = props;
  /*
    DSP-209 S18a: the routes are derived from the drawing alone — positions, kinds, fan-out
    declarations and edge ends — so nothing a run changes can move one. Kept for as long as
    the graph object is the same, which is every run update.
  */
  const routes = useMemo(() => routeLoopEdges(graph, { labelOf: edgeText }), [graph]);
  const bounds = graphBounds(graph, routes);
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
        {/*
          DSP-209 S18a: a back edge's own arrowhead — an open chevron rather than a filled
          triangle, so a rework or return path is told apart by shape as well as by colour
          and dash.
        */}
        <marker id="arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9" className="arrow-head-back" />
        </marker>
        <marker id="arrow-back-failure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9" className="arrow-head-back-failure" />
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
          route={routes.get(edge.id) ?? null}
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
          helpTitle={props.helpTitleOf?.(node, node.role ? (props.roles.get(roleKey(node.role)) ?? null) : null)}
          branches={props.branchSummaries?.get(node.id) ?? null}
          {...(props.onOpenBranches === undefined ? {} : { onOpenBranches: () => props.onOpenBranches?.(node.id) })}
          onMouseDown={(event) => props.onNodeMouseDown(event, node)}
        />
      ))}
    </svg>
  );
}

/**
 * One edge, drawn along the route `loop-edge-routing.ts` found for it (DSP-209 S18a).
 *
 * The route is orthogonal with rounded corners, leaves and enters by ports on the nodes'
 * sides, and keeps clear of every other node. Parallel edges between one pair are kept
 * apart by their ports rather than by bowing. A back edge — rework or a return — runs in
 * an outer lane, dashed, with its own arrowhead. The hit path follows the same route, so
 * what can be clicked is what is drawn.
 */
function EdgeShape({
  edge,
  route,
  selected,
  highlighted,
  showLabel,
  taken,
  severity,
  onSelect,
}: {
  readonly edge: LoopEdge;
  readonly route: EdgeRoute | null;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly showLabel: boolean;
  readonly taken: boolean;
  readonly severity: Finding['severity'] | null;
  readonly onSelect: () => void;
}): React.JSX.Element | null {
  if (route === null || route.points.length < 2) {
    return null;
  }
  const start = route.points[0] as { readonly x: number; readonly y: number };
  const end = route.points[route.points.length - 1] as { readonly x: number; readonly y: number };
  const failure = edge.when.on === 'declared-failure';
  const marker = route.back
    ? failure
      ? 'url(#arrow-back-failure)'
      : 'url(#arrow-back)'
    : failure
      ? 'url(#arrow-failure)'
      : 'url(#arrow)';

  const classes = [
    'edge',
    failure ? 'edge-failure' : edge.when.on === 'outcome' ? 'edge-outcome' : 'edge-success',
    route.back ? 'edge-back' : '',
    selected ? 'edge-selected' : '',
    highlighted ? 'edge-highlighted' : '',
    taken ? 'edge-taken' : '',
    severity === null ? '' : `edge-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  return (
    <g
      className={classes}
      data-edge-id={edge.id}
      data-edge-back={route.back ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <path d={route.path} markerEnd={marker} />
      <path className="edge-hit" d={route.path} />
      <circle className="edge-dot" cx={start.x} cy={start.y} r={ANCHOR_DOT_RADIUS} />
      <circle className="edge-dot" cx={end.x} cy={end.y} r={ANCHOR_DOT_RADIUS} />
      {showLabel || selected || highlighted ? (
        <text x={route.label.x} y={route.label.y} className="edge-label">
          {edgeText(edge)}
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
  branches,
  onOpenBranches,
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
  readonly branches: string | null;
  /** DSP-209 S20: opens the node's Branches list; the branch line is its control. */
  readonly onOpenBranches?: () => void;
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
  // DSP-209 S18a: the height comes from the drawing (a fan-out is taller), never the run.
  const height = nodeSize(node).height;
  const outline = nodeOutlinePath(node.kind, height);

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
      data-run-branches={branches ?? ''}
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
        // DSP-209 S26 (R7): a short label. The state's word, the ending's mark and the branch
        // line are drawn on the node; the full help is in the node panel when it is selected.
        <title>{`${node.label ?? node.id}: ${mark.label}${
          ending === null ? '' : ending === 'success' ? ' — ended here, assignment met' : ' — ended here, not declared met'
        }${branches === null ? '' : ` — ${branches}`}${helpTitle === undefined ? '' : ` — ${helpTitle}`}`}</title>
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
          points={`${String(NODE_WIDTH / 2)},0 ${String(NODE_WIDTH)},${String(height / 2)} ${String(NODE_WIDTH / 2)},${String(height)} 0,${String(height / 2)}`}
          className="node-body"
        />
      ) : (
        <rect
          width={NODE_WIDTH}
          height={height}
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
      {/*
        DSP-209 S20 (R3, R7): the fan-out's branches on the node itself, in the room S18a
        made for them, so the count is read without hovering. Pressing it opens the node's
        Branches list, where every branch's task, state, model and messages are written out.
        A long line is fitted to the node rather than cut off.
      */}
      {branches === null || node.fanOut === undefined ? null : (
        <text
          x={NODE_WIDTH / 2}
          y={53}
          className={`node-branches${onOpenBranches === undefined ? '' : ' node-branches--control'}`}
          data-ev="node-branches"
          {...(branches.length > 30 ? { textLength: NODE_WIDTH - 12, lengthAdjust: 'spacingAndGlyphs' } : {})}
          {...(onOpenBranches === undefined
            ? {}
            : {
                role: 'button',
                tabIndex: 0,
                onMouseDown: (event: ReactMouseEvent) => event.stopPropagation(),
                onClick: (event: ReactMouseEvent) => {
                  event.stopPropagation();
                  onOpenBranches();
                },
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenBranches();
                  }
                },
              })}
        >
          {branches}
        </text>
      )}
      {isEntry ? (
        <text x={6} y={height - 5} className="node-entry">
          entry
        </text>
      ) : null}
      {/*
        A word, not only a border and never only a pulse. "running" and "done" are told
        apart here by reading, which is the whole of the accessibility clause: motion may
        add emphasis to the active node and carries no meaning by itself.
      */}
      {mark.mark === '' ? null : (
        <text x={NODE_WIDTH - 6} y={height - 5} className="node-run-mark" textAnchor="end">
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
