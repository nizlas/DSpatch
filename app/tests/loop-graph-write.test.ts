/**
 * The round-trip DSP-22 criterion #3 asks for, tested against the real file.
 *
 * "Not silently reformatted or reordered" is a claim about bytes, so it is tested
 * as one: the hand-written development-loop graph is loaded, written back, and the
 * result must equal what is on disk. If someone later reaches for
 * `JSON.stringify(graph, null, 2)`, this fails immediately rather than after the
 * first unreadable diff.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { detectNewline, serialiseLoopGraph } from '../src/shared/loop-graph-write';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');

function readGraphFile(): string {
  return fs.readFileSync(graphPath, 'utf8');
}

describe('serialiseLoopGraph', () => {
  it('writes our own development loop back byte for byte', () => {
    const original = readGraphFile();
    const loaded = loadLoopGraph(original, {
      resolveRole: createFileRoleResolver(repoRoot),
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, 'the example graph must load before it can be written');
    assert.ok(loaded.ok);

    const written = serialiseLoopGraph(loaded.graph, { newline: detectNewline(original) });
    assert.equal(
      written,
      original,
      'writing the hand-written graph unchanged must reproduce the file exactly',
    );
  });

  it('is stable across a second save', () => {
    const original = readGraphFile();
    const newline = detectNewline(original);
    const first = parseLoopGraph(original);
    assert.ok(first.ok);
    const once = serialiseLoopGraph(first.graph, { newline });
    const second = parseLoopGraph(once);
    assert.ok(second.ok);
    assert.equal(serialiseLoopGraph(second.graph, { newline }), once);
  });

  it('changes one line when one node is moved', () => {
    const original = readGraphFile();
    const parsed = parseLoopGraph(original);
    assert.ok(parsed.ok);
    const moved = {
      ...parsed.graph,
      nodes: parsed.graph.nodes.map((node) =>
        node.id === 'implementer' ? { ...node, view: { x: 640, y: 410 } } : node,
      ),
    };
    const written = serialiseLoopGraph(moved, { newline: detectNewline(original) });
    assert.match(written, /"view": \{ "x": 640, "y": 410 \}/);

    const before = original.split(/\r?\n/);
    const after = written.split(/\r?\n/);
    assert.equal(before.length, after.length);
    const changed = before.filter((line, index) => line !== after[index]);
    assert.equal(changed.length, 1, `expected one changed line, got: ${changed.join(' | ')}`);
  });

  it("writes an added node in the format's key order regardless of object order", () => {
    const original = readGraphFile();
    const parsed = parseLoopGraph(original);
    assert.ok(parsed.ok);
    const added = {
      ...parsed.graph,
      nodes: [
        ...parsed.graph.nodes,
        // Deliberately built in the wrong order, the way a form fills an object.
        {
          view: { x: 40, y: 40 },
          label: 'Publisher',
          kind: 'agent' as const,
          id: 'publisher',
        },
      ],
    };
    const written = serialiseLoopGraph(added, { newline: '\n' });
    const block = written.slice(written.indexOf('"id": "publisher"'), written.length);
    assert.match(
      block.slice(0, 200),
      /"id": "publisher",\n {6}"kind": "agent",\n {6}"label": "Publisher",\n {6}"view": \{ "x": 40, "y": 40 \}/,
    );
  });
});
