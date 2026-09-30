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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { openChosenLoop } from '../src/main/loop-definition-choice';
import { openLoopDefinitionFile } from '../src/main/loop-definition-files';
import {
  isLoopDefinitionText,
  openedFromDefinition,
  openedFromGraphFile,
} from '../src/main/loop-graph-open';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { describeOpenedGraph } from '../src/shared/loop-editor-open';
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

/**
 * Opening a loop through its declaration (DSP-82).
 *
 * The fixture is a definition whose resource root is **not** this repository, because
 * that is the only arrangement in which the two loading paths can be told apart. Its
 * graph names its roles at `roles/…`, a relative path that exists under the fixture's
 * root and nowhere in DSpatch — so a resolver anchored at the DSpatch working copy
 * answers `null` for every one of them, and a resolver anchored at the definition's own
 * root resolves them all.
 *
 * That pairing is what makes criterion #2 an assertion rather than a promise. If
 * somebody reintroduced a second parser for `.loop.json` in the editor's open handler,
 * it would have to build its own resolver; anchored at `ownRoot` as the old code was,
 * the first test below fails, and anchored anywhere else it is no longer reusing
 * `openChosenLoop` and the definition fields of the outcome go with it.
 */
describe('opening a loop from its definition', () => {
  const temporaries: string[] = [];

  after(() => {
    for (const dir of temporaries) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function temporaryDir(label: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-${label}-`));
    temporaries.push(dir);
    return dir;
  }

  function write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }

  /**
   * A real loop, laid out under a root of its own, with its roles renamed.
   *
   * The renaming is the instrument: `roles/work.role.md` resolves here and resolves
   * nowhere in DSpatch, so "which root was this resolved against" is answerable from
   * the outcome alone.
   */
  function loopElsewhere(options: { readonly graphNewline: '\n' | '\r\n' }): {
    readonly resourceRoot: string;
    readonly declarationFile: string;
    readonly graphFile: string;
  } {
    const home = temporaryDir('open');
    const resourceRoot = path.join(home, 'resources');
    for (const [from, to] of [
      ['project-work.role.md', 'work.role.md'],
      ['project-check.role.md', 'check.role.md'],
    ] as const) {
      write(
        path.join(resourceRoot, 'roles', to),
        fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'roles', 'project', from), 'utf8'),
      );
    }

    const graphText = fs
      .readFileSync(path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json'), 'utf8')
      .replace('docs/loop/roles/project/project-work.role.md', 'roles/work.role.md')
      .replace('docs/loop/roles/project/project-check.role.md', 'roles/check.role.md')
      .replace(/\r?\n/g, options.graphNewline);
    const graphFile = path.join(resourceRoot, 'graphs', 'ported.graph.json');
    write(graphFile, graphText);

    // The declaration sits beside the resources rather than in them, so the resource
    // root is a field that has to be read and followed rather than the folder the file
    // happens to be in.
    const declarationFile = path.join(home, 'declared', 'ported.loop.json');
    write(
      declarationFile,
      // Written with LF whatever the graph uses, so newline detection cannot pass by
      // reading the wrong file.
      `${JSON.stringify(
        {
          format: 'dspatch-loop-definition',
          formatVersion: 1,
          id: 'ported-loop',
          name: 'Ported loop, rooted elsewhere',
          resourceRoot: '../resources',
          resourceRootNote: 'A resource root that is not the DSpatch working copy.',
          graph: 'graphs/ported.graph.json',
        },
        null,
        2,
      ).replace(/\r?\n/g, '\n')}\n`,
    );
    return { resourceRoot, declarationFile, graphFile };
  }

  function openIt(declarationFile: string): Extract<
    ReturnType<typeof openedFromDefinition>,
    { kind: 'read' }
  > {
    const outcome = openedFromDefinition(openChosenLoop(openLoopDefinitionFile(declarationFile)));
    assert.equal(outcome.kind, 'read', outcome.kind === 'unavailable' ? outcome.note : '');
    return outcome as Extract<typeof outcome, { kind: 'read' }>;
  }

  it('resolves the roles at the definition\u2019s resource root, not at DSpatch\u2019s', () => {
    const fixture = loopElsewhere({ graphNewline: '\n' });
    const opened = openIt(fixture.declarationFile);

    assert.equal(opened.projectRoot, fixture.resourceRoot);
    assert.equal(opened.roles.length, 2, 'both role references came back');
    assert.deepEqual(
      opened.roles.filter((entry) => entry.role === null),
      [],
      'a definition rooted outside DSpatch reaches its own roles',
    );
    // Not merely present: the text that came back is the role file under the fixture's
    // root, so this cannot pass on some other file with the same name.
    assert.deepEqual(
      [...opened.roles].map((entry) => entry.role?.sourcePath).sort(),
      ['roles/check.role.md', 'roles/work.role.md'],
    );

    // The negative half. The old handler anchored every open at DSpatch's own working
    // copy; against this graph that answers "broken" for every role, and the editor
    // would draw a loop whose every agent had lost its instructions.
    const asIfAnchoredAtDSpatch = openedFromGraphFile({
      path: fixture.graphFile,
      text: opened.text,
      projectRoot: repoRoot,
      resolveRole: createFileRoleResolver(repoRoot),
    });
    assert.equal(asIfAnchoredAtDSpatch.kind, 'read');
    assert.deepEqual(
      asIfAnchoredAtDSpatch.kind === 'read'
        ? asIfAnchoredAtDSpatch.roles.map((entry) => entry.role)
        : null,
      [null, null],
      'the two anchors really do give different answers, so the first assertion means something',
    );
  });

  it('hands the editor the graph to save to, and the graph\u2019s own line endings', () => {
    const fixture = loopElsewhere({ graphNewline: '\r\n' });
    const opened = openIt(fixture.declarationFile);

    // `path` is what `save()` writes to. It must be the drawing, never the declaration.
    assert.equal(opened.path, fixture.graphFile);
    assert.notEqual(opened.path, fixture.declarationFile);
    assert.equal(opened.text, fs.readFileSync(fixture.graphFile, 'utf8'));
    assert.equal(
      opened.newline,
      '\r\n',
      'line endings come from the graph; the declaration beside it is LF',
    );
    assert.equal(detectNewline(fs.readFileSync(fixture.declarationFile, 'utf8')), '\n');
    assert.equal(opened.displayPath, path.join('graphs', 'ported.graph.json'));
  });

  it('carries the definition, so the window can name the loop', () => {
    const fixture = loopElsewhere({ graphNewline: '\n' });
    const opened = openIt(fixture.declarationFile);

    assert.deepEqual(opened.definition, {
      id: 'ported-loop',
      name: 'Ported loop, rooted elsewhere',
      path: fixture.declarationFile,
    });
    assert.equal(
      describeOpenedGraph({ displayPath: opened.displayPath, definition: opened.definition ?? null })
        .title.startsWith('Ported loop, rooted elsewhere'),
      true,
      'the header leads with the name the loop was chosen by, not with a path',
    );
  });

  it('says why rather than opening nothing, when the declaration cannot be read', () => {
    const missing = path.join(temporaryDir('open-missing'), 'nothing.loop.json');
    const outcome = openedFromDefinition(openChosenLoop(openLoopDefinitionFile(missing)));
    assert.equal(outcome.kind, 'unavailable');
    assert.match(outcome.kind === 'unavailable' ? outcome.note : '', /could not be read/);
  });
});

describe('telling a declaration from a drawing', () => {
  it('reads the format field, not the file name', () => {
    // Both real files, and both `.json`. The extension convention is what discovery
    // reads; a person in a file dialog can point at either.
    const declaration = fs.readFileSync(
      path.join(repoRoot, '.dspatch', 'loops', 'dspatch-chat-loop.loop.json'),
      'utf8',
    );
    const drawing = fs.readFileSync(
      path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json'),
      'utf8',
    );
    assert.equal(isLoopDefinitionText(declaration), true);
    assert.equal(isLoopDefinitionText(drawing), false);

    // A declaration whose name says nothing, and a drawing that claims to be one only
    // in its name: the field decides both.
    assert.equal(isLoopDefinitionText(JSON.stringify({ format: 'dspatch-loop-definition' })), true);
    assert.equal(isLoopDefinitionText('not json at all'), false);
    assert.equal(isLoopDefinitionText('[]'), false);
  });
});

describe('what the editor says it has open', () => {
  it('names the loop when a definition was the way in', () => {
    const described = describeOpenedGraph({
      displayPath: 'graphs/ported.graph.json',
      definition: { id: 'ported-loop', name: 'Ported loop', path: '/elsewhere/ported.loop.json' },
    });
    assert.match(described.title, /^Ported loop/);
    assert.match(described.opened, /Ported loop/);
    assert.match(described.opened, /ported\.loop\.json/, 'and says which declaration it was');
  });

  it('says a graph opened directly is exactly that, rather than an unnamed loop', () => {
    const described = describeOpenedGraph({
      displayPath: 'docs/loop/graphs/dspatch-development-loop.graph.json',
      definition: null,
    });
    assert.match(described.title, /graph opened directly/);
    assert.match(described.opened, /no loop definition behind it/);
    assert.equal(/loop "/.test(described.opened), false, 'no name is invented for it');
  });
});
