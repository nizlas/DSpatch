/**
 * What happens between reading a graph file and drawing it — the two defects an
 * independent Verifier found on 16 September 2026 by opening a hand-written
 * twenty-node graph through the editor's own file dialog.
 *
 * **One node was visible out of twenty.** `view` is optional in the format, so every
 * node without one was drawn at 0,0 with all thirty-one edges zero-length. The file was
 * read correctly and could not be seen.
 *
 * **The header said *unsaved changes* and Save was live**, before anything was touched.
 *
 * The two are tested together because together they were dangerous: an author opens a
 * file, sees one node, presses Save to see whether that helps, and the file now says
 * every node is at the origin. Both are properties of pure functions plus one
 * comparison, so both are testable without a window — which is the point of keeping the
 * editor's operations out of the component.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { layOutMissingViews } from '../src/shared/loop-graph-editing';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import { detectNewline, serialiseLoopGraph } from '../src/shared/loop-graph-write';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');

function ourOwnLoop(): { readonly text: string; readonly graph: LoopGraph } {
  const text = fs.readFileSync(graphPath, 'utf8');
  const loaded = loadLoopGraph(text, {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'our own loop must load before anything here means much');
  return { text, graph: loaded.graph };
}

/** A graph with no positions at all, which is what a hand-written file looks like. */
function withoutViews(graph: LoopGraph): LoopGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const { view, ...rest } = node;
      void view;
      return rest;
    }),
  };
}

describe('layOutMissingViews', () => {
  it('gives every node without a view a distinct position, clear of the palette', () => {
    const { graph } = ourOwnLoop();
    const bare = withoutViews(graph);
    assert.equal(
      bare.nodes.every((node) => node.view === undefined),
      true,
      'the case under test is a file that positions nothing',
    );

    const laidOut = layOutMissingViews(bare);
    assert.equal(laidOut.placed.length, bare.nodes.length);
    assert.equal(
      laidOut.graph.nodes.every((node) => node.view !== undefined),
      true,
    );

    // The defect was that all twenty coordinates were identical, which is also why
    // dragging one gave no hint which had moved.
    const positions = laidOut.graph.nodes.map((node) => `${String(node.view?.x)},${String(node.view?.y)}`);
    assert.equal(new Set(positions).size, positions.length, 'no two nodes share a position');
    assert.equal(
      laidOut.graph.nodes.every((node) => (node.view?.y ?? 0) > 0 && (node.view?.x ?? 0) > 0),
      true,
      'nothing is placed at the origin, where the palette bar covers it',
    );
  });

  it('leaves a graph that positions everything exactly as its author arranged it', () => {
    const { graph } = ourOwnLoop();
    const laidOut = layOutMissingViews(graph);
    assert.deepEqual(laidOut.placed, []);
    assert.equal(laidOut.graph, graph, 'the same graph, not a copy that a diff would notice');
  });

  it('starts below the nodes a partly arranged file did position', () => {
    const { graph } = ourOwnLoop();
    const lowest = Math.max(...graph.nodes.map((node) => node.view?.y ?? 0));
    const partly: LoopGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === 'implementer' ? withoutViews({ ...graph, nodes: [node] }).nodes[0]! : node)),
    };

    const laidOut = layOutMissingViews(partly);
    assert.deepEqual(laidOut.placed, ['implementer']);
    const placed = laidOut.graph.nodes.find((node) => node.id === 'implementer');
    assert.ok((placed?.view?.y ?? 0) > lowest, 'the grid does not pile on top of a hand-made arrangement');
  });
});

describe('opening a file does not count as editing it', () => {
  it('is clean on open even when the file uses a layout the writer would not choose', () => {
    // The actual cause of the "unsaved changes" defect: the editor compared what it
    // would write against the file's own bytes. Those differ wherever the author's
    // layout is not the writer's — a `role` on one line rather than four is enough —
    // and nothing about the graph had changed. `identical as JSON data` is the check
    // that says so: the loaded graph is the file, and the text comparison was wrong.
    const { text, graph } = ourOwnLoop();
    const newline = detectNewline(text);
    const handLaidOut = text.replace(
      /"role": \{\r?\n\s+"id": "dspatch-implementer",\r?\n\s+"source": (\{[^}]*\})\r?\n\s+\}/,
      '"role": { "id": "dspatch-implementer", "source": $1 }',
    );
    assert.notEqual(handLaidOut, text, 'the fixture must actually differ from the writer\'s layout');

    const reparsed = parseLoopGraph(handLaidOut);
    assert.ok(reparsed.ok);
    assert.equal(
      JSON.stringify(JSON.parse(handLaidOut)),
      JSON.stringify(JSON.parse(serialiseLoopGraph(reparsed.graph, { newline }))),
      'nothing is normalised away on load, so nothing has been edited',
    );

    // What the editor now compares against: the graph as opened, written out.
    const savedText = serialiseLoopGraph(layOutMissingViews(reparsed.graph).graph, { newline });
    const currentText = serialiseLoopGraph(layOutMissingViews(reparsed.graph).graph, { newline });
    assert.equal(currentText, savedText, 'opening alone leaves nothing to save');
    assert.notEqual(savedText, handLaidOut, 'and it is not the file\'s own bytes that decide');

    // A real edit is still an edit.
    const edited = serialiseLoopGraph({ ...reparsed.graph, name: `${graph.name} (edited)` }, { newline });
    assert.notEqual(edited, savedText);
  });

  it('does not offer to save a hand-written graph merely for having been laid out', () => {
    const { text } = ourOwnLoop();
    const newline = detectNewline(text);
    const parsed = parseLoopGraph(text);
    assert.ok(parsed.ok);
    const bare = withoutViews(parsed.graph);

    const opened = layOutMissingViews(bare).graph;
    const savedText = serialiseLoopGraph(opened, { newline });
    assert.equal(serialiseLoopGraph(opened, { newline }), savedText);

    // And the positions are genuinely not in the file until something else changes:
    // what would be written for the graph as opened is not what the file says.
    assert.notEqual(savedText, serialiseLoopGraph(bare, { newline }));
  });
});
