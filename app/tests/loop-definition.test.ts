/**
 * A loop you can choose, and a definition that resolves from itself.
 *
 * Two claims are checked here that are otherwise invisible until they are expensive.
 *
 * **Discovery costs one directory read per folder.** That is a statement about what
 * happens when somebody opens a large repository, and it is true or false long before
 * anyone would notice. So the filesystem is injected and the reads are counted, and the
 * test also asserts that every path touched is inside `.dspatch/loops/`.
 *
 * **A broken role path resolves to nothing rather than going unchecked.** The validator
 * already distinguishes the two — `role-does-not-resolve` is an error, `role-not-checked`
 * is a warning — and a test that could not tell them apart would pass for a resolver
 * that had quietly stopped looking. It is the one negative control here that earns its
 * cost, and it is used twice: once for a path that is simply absent, once for a path
 * that exists but sits outside the resource root.
 *
 * **The same declaration means the same thing wherever it sits.** Two identical files
 * two levels under one folder, one of them in that folder's standard `.dspatch/loops`
 * location and one of them not, reach the same graph and the same roles. This could not
 * be written before: a declaration in the standard location used to be read against a
 * different base, and an earlier version of this file had to assert the opposite as a
 * negative control. The rule is withdrawn (DSP-69, reopened) and the control is now
 * positive, which is the cheaper and more useful direction to state it in.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import {
  createDefinitionRoleResolver,
  describeDefinitionRow,
  discoverLoopDefinitions,
  loopDefinitionDirFor,
  openLoopDefinitionFile,
  resultRootFor,
  type DefinitionIo,
} from '../src/main/loop-definition-files';
import {
  listChoosableLoops,
  openChosenLoop,
  rowForKey,
} from '../src/main/loop-definition-choice';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { chatPromptFor, ROLE_BLOCK_OPEN } from '../src/shared/loop-chat';
import { parseLoopDefinition } from '../src/shared/loop-definition';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { createDryRunExecutor, runLoopGraph } from '../src/shared/loop-run';
import { workingRootsFrom } from '../src/shared/working-roots';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const chatGraphRel = path.join('docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');
const existingGraphs = [
  chatGraphRel,
  path.join('docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json'),
  path.join('docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json'),
];

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
 * The real chat-loop graph and the real project roles, laid out under one folder.
 *
 * `graphs/chat.graph.json` and `docs/loop/roles/project/…`, which is where that graph
 * expects its roles. A declaration anchored here reaches both.
 */
function resourcesUnder(folder: string): void {
  write(
    path.join(folder, 'graphs', 'chat.graph.json'),
    fs.readFileSync(path.join(repoRoot, chatGraphRel), 'utf8'),
  );
  for (const rel of ['project-work.role.md', 'project-check.role.md']) {
    write(
      path.join(folder, 'docs', 'loop', 'roles', 'project', rel),
      fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'roles', 'project', rel), 'utf8'),
    );
  }
}

/**
 * A definition that resolves entirely from its own folder, on disk.
 *
 * Nothing but the graph path is declared, because the folder a declaration sits in is
 * its resource root until the declaration says otherwise — so the case that needs no
 * field is the case where everything really is in one place.
 */
function selfContainedDefinition(): { readonly folder: string; readonly file: string } {
  const folder = temporaryDir('defA');
  resourcesUnder(folder);
  const file = path.join(folder, 'chat.loop.json');
  write(file, declaration({ id: 'chat', name: 'Chat loop', graph: 'graphs/chat.graph.json' }));
  return { folder, file };
}

/**
 * The same self-contained layout as above, at a directory the caller names.
 *
 * One body, two placements: the point of the pair that uses it is that the layout is
 * identical and only the directory's name differs, so the two cases cannot drift apart
 * into two different claims.
 */
function defaultAnchorCase(
  label: string,
  ...segments: readonly string[]
): { readonly dir: string; readonly file: string } {
  const dir = path.join(temporaryDir(label), ...segments);
  resourcesUnder(dir);
  const file = path.join(dir, 'mine.loop.json');
  write(file, declaration({ id: 'mine', name: 'Mine', graph: 'graphs/chat.graph.json' }));
  return { dir, file };
}

function declaration(fields: Record<string, unknown>): string {
  return JSON.stringify({
    format: 'dspatch-loop-definition',
    formatVersion: 1,
    ...fields,
  });
}

/**
 * What a project's own loop looks like once there is one base.
 *
 * Filed two levels down in `.dspatch/loops`, so it names the root it reads from rather
 * than having the directory it was filed in mean something. Every fixture below that
 * puts a declaration in the standard location and its graph in the project uses this,
 * because that is now the only way such a declaration reaches anything.
 */
function projectDeclaration(fields: Record<string, unknown>): string {
  return declaration({
    resourceRoot: '../..',
    resourceRootNote: 'The project this loop belongs to, two levels up from .dspatch/loops.',
    ...fields,
  });
}

/**
 * A filesystem that answers from a map and records every path it was asked about.
 *
 * The recording is the instrument. Anything not in the map throws `ENOENT`, which is
 * also what a folder with no loops of its own looks like.
 */
function countingIo(files: Readonly<Record<string, string>>): DefinitionIo & {
  readonly listed: string[];
  readonly read: string[];
} {
  const listed: string[] = [];
  const read: string[] = [];
  return {
    listed,
    read,
    listFiles(dir) {
      listed.push(dir);
      const prefix = `${dir}${path.sep}`;
      const names = Object.keys(files)
        .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes(path.sep))
        .map((file) => file.slice(prefix.length));
      if (names.length === 0 && !Object.keys(files).some((file) => file.startsWith(prefix))) {
        const error = new Error(`ENOENT: ${dir}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return names;
    },
    readText(file) {
      read.push(file);
      const text = files[file];
      if (text === undefined) {
        const error = new Error(`ENOENT: ${file}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return text;
    },
  };
}

describe('the declaration', () => {
  it('reads a definition that stands on its own', () => {
    const parsed = parseLoopDefinition(
      declaration({
        id: 'small-loop',
        name: 'Small loop',
        description: 'One writing turn and one checking turn.',
        graph: 'graphs/small.graph.json',
      }),
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.definition?.id, 'small-loop');
    assert.equal(parsed.definition?.description, 'One writing turn and one checking turn.');
    assert.equal(parsed.definition?.resourceRoot, undefined, 'its own folder is the default');
    assert.deepEqual(parsed.findings, [], 'a self-contained definition has nothing to report');
  });

  /**
   * A real file, written by a real tool, on the platform we build on first.
   *
   * `Set-Content -Encoding utf8` in Windows PowerShell writes a byte-order mark, and
   * the first run of this card's window trial wrote its declaration that way. What
   * came back was *this file is not valid JSON: unexpected token* over a character
   * nothing shows — a true sentence and a useless one. The mark is stripped, as
   * `role-source.ts` and `loop-graph-roles.ts` already strip it.
   */
  it('reads a declaration a Windows editor wrote, byte-order mark and all', () => {
    const parsed = parseLoopDefinition(
      `\uFEFF${declaration({ id: 'a', name: 'A', graph: 'g.graph.json' })}`,
    );
    assert.equal(parsed.ok, true, parsed.findings.map((finding) => finding.message).join('\n'));
    assert.equal(parsed.definition?.id, 'a');
  });

  it('refuses a graph path naming one machine', () => {
    const parsed = parseLoopDefinition(
      declaration({ id: 'a', name: 'A', graph: 'C:/elsewhere/x.graph.json' }),
    );

    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.code === 'graph-absolute'), true);
  });

  it('records the dependency when resources live somewhere else, and asks for it to be written down', () => {
    const withoutNote = parseLoopDefinition(
      declaration({ id: 'a', name: 'A', graph: 'g.json', resourceRoot: '../DSpatch' }),
    );
    assert.equal(withoutNote.ok, true, 'borrowing resources is allowed; it is a dependency, not an error');
    assert.equal(
      withoutNote.findings.some((finding) => finding.code === 'resource-root-elsewhere'),
      true,
    );
    assert.equal(
      withoutNote.findings.some((finding) => finding.code === 'resource-root-note-missing'),
      true,
    );

    const withNote = parseLoopDefinition(
      declaration({
        id: 'a',
        name: 'A',
        graph: 'g.json',
        resourceRoot: '../DSpatch',
        resourceRootNote: 'Roles are the live files in the DSpatch working copy.',
      }),
    );
    assert.equal(
      withNote.findings.some((finding) => finding.code === 'resource-root-note-missing'),
      false,
    );
  });

  it('refuses a relative resultRoot, because every anchor available to it is the wrong one', () => {
    const parsed = parseLoopDefinition(
      declaration({ id: 'a', name: 'A', graph: 'g.json', resultRoot: 'reports/' }),
    );

    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.code === 'result-root-not-absolute'), true);
  });
});

describe('discovery', () => {
  it('reads one directory per folder and nothing outside .dspatch/loops', () => {
    const folderA = path.join(os.tmpdir(), 'fake-a');
    const folderB = path.join(os.tmpdir(), 'fake-b');
    const loopsA = loopDefinitionDirFor(folderA);
    const loopsB = loopDefinitionDirFor(folderB);
    const io = countingIo({
      [path.join(loopsA, 'one.loop.json')]: declaration({ id: 'one', name: 'One', graph: 'g.json' }),
      [path.join(loopsA, 'two.loop.json')]: declaration({ id: 'two', name: 'Two', graph: 'g.json' }),
      [path.join(loopsA, 'notes.md')]: 'not a definition',
      [path.join(loopsB, 'three.loop.json')]: declaration({ id: 'three', name: 'Three', graph: 'g.json' }),
      // Deep in the tree and named like a definition. Nothing may go looking for it.
      [path.join(folderA, 'src', 'vendor', 'buried.loop.json')]: declaration({
        id: 'buried',
        name: 'Buried',
        graph: 'g.json',
      }),
    });

    const discovery = discoverLoopDefinitions([folderA, folderB], io);

    assert.deepEqual(io.listed, [loopsA, loopsB], 'one directory listing per folder, and only those');
    assert.equal(
      io.read.every((file) => path.dirname(file) === loopsA || path.dirname(file) === loopsB),
      true,
      `discovery read something outside .dspatch/loops: ${io.read.join(', ')}`,
    );
    assert.equal(io.read.length, 3, 'three .loop.json files, and the Markdown file is not opened');
    assert.deepEqual(
      discovery.rows.map((row) => row.definition?.id),
      ['one', 'two', 'three'],
      'the buried file is not found, because nothing walks the tree',
    );
  });

  it('keeps a folder with no loops of its own out of the way, and reports one it cannot list', () => {
    const empty = path.join(os.tmpdir(), 'fake-empty');
    const io = countingIo({});
    const quiet = discoverLoopDefinitions([empty], io);
    assert.equal(quiet.folders[0]?.problem, null, 'no .dspatch/loops is the ordinary case');
    assert.equal(quiet.rows.length, 0);

    const refusing: DefinitionIo = {
      listFiles: () => {
        const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
      readText: () => '',
    };
    const loud = discoverLoopDefinitions([empty], refusing);
    assert.match(String(loud.folders[0]?.problem), /could not be listed/);
  });

  it('leaves one bad definition on its own row and the others selectable', () => {
    const folder = path.join(os.tmpdir(), 'fake-mixed');
    const loops = loopDefinitionDirFor(folder);
    const io = countingIo({
      [path.join(loops, 'a-good.loop.json')]: declaration({ id: 'good', name: 'Good', graph: 'g.json' }),
      [path.join(loops, 'b-broken.loop.json')]: '{ this is not json',
      [path.join(loops, 'c-wrong.loop.json')]: JSON.stringify({ format: 'dspatch-loop-graph' }),
      [path.join(loops, 'd-good.loop.json')]: declaration({ id: 'also', name: 'Also', graph: 'g.json' }),
    });

    const rows = discoverLoopDefinitions([folder], io).rows;

    assert.equal(rows.length, 4, 'a definition that does not load still has a row, or its author never sees why');
    assert.deepEqual(
      rows.map((row) => row.definition !== null),
      [true, false, false, true],
    );
    assert.equal(describeDefinitionRow(rows[1] as never).error?.includes('not valid JSON'), true);
    assert.match(String(describeDefinitionRow(rows[2] as never).error), /loop definition says/);
    assert.equal(describeDefinitionRow(rows[3] as never).error, null, 'the good ones stay usable');
  });

  it('tells two definitions with the same name apart by where they came from', () => {
    const folderA = path.join(os.tmpdir(), 'alpha');
    const folderB = path.join(os.tmpdir(), 'beta');
    const same = declaration({ id: 'shared', name: 'Development loop', graph: 'g.json' });
    const io = countingIo({
      [path.join(loopDefinitionDirFor(folderA), 'x.loop.json')]: same,
      [path.join(loopDefinitionDirFor(folderB), 'x.loop.json')]: same,
    });

    const described = discoverLoopDefinitions([folderA, folderB], io).rows.map(describeDefinitionRow);

    assert.deepEqual(described.map((row) => row.name), ['Development loop', 'Development loop']);
    assert.notEqual(described[0]?.origin, described[1]?.origin, 'origin is what distinguishes them');
  });

  it('takes a definition from outside every open folder and gives it the same kind of row', () => {
    const elsewhere = temporaryDir('picked');
    const file = path.join(elsewhere, 'standalone.loop.json');
    write(file, declaration({ id: 'standalone', name: 'Standalone', graph: 'g.json' }));

    const row = openLoopDefinitionFile(file);

    assert.equal(row.definition?.id, 'standalone');
    assert.equal(row.origin.kind, 'picked');
    assert.match(describeDefinitionRow(row).origin, /chosen by hand/);
  });
});

describe('resolving from the definition', () => {
  /**
   * The default anchor, said twice, because the property is that it does not vary.
   *
   * A declaration naming no `resourceRoot` resolves from the directory its file is in,
   * and `.dspatch/loops` is a directory like any other. The second half is the gap the
   * withdrawn rule would fit back through: every other test here that resolves a
   * declaration filed in the standard location declares `../..` through
   * `projectDeclaration`, so reinstating a home-folder default would leave all of them
   * green. The two cases below are two calls of one body over one layout, so they make
   * the same assertions by construction rather than by two authors agreeing — which is
   * the only honest way to state *the location makes no difference*. The standard
   * location is the one that would fail.
   */
  for (const [where, segments] of [
    ['an ordinary directory', ['ordinary', 'directory']],
    ['a folder\u2019s standard location', ['.dspatch', 'loops']],
  ] as const) {
    it(`anchors a declaration naming no root at the directory it sits in, in ${where}`, () => {
      const { dir, file } = defaultAnchorCase('default-anchor', ...segments);
      const row = openLoopDefinitionFile(file);

      assert.equal(row.resourceRoot, dir, 'the directory holding the file, and nothing wider');
      assert.equal(
        path.relative(path.dirname(file), row.graphPath as string),
        path.join('graphs', 'chat.graph.json'),
        'the graph is named from the file\u2019s own directory, which is the whole default',
      );

      // Both layouts sit two levels under a directory this test owns, and that
      // directory is empty. An anchor that widened could therefore not pass by
      // reaching a second copy of the fixture: there is nothing up there to reach.
      assert.equal(
        fs.existsSync(path.join(dir, '..', '..', 'graphs')),
        false,
        'nothing two levels up, so a widened anchor fails rather than resolving elsewhere',
      );

      // Resolved, not compared. `openChosenLoop` reads the graph file, and the roles
      // must resolve through this row's own resolver or `loadLoopGraph` reports
      // `role-does-not-resolve` and refuses the graph.
      const opened = openChosenLoop(row);
      assert.equal(opened.ok, true, opened.ok ? '' : opened.note);
      const chosen = (opened as Extract<typeof opened, { ok: true }>).chosen;
      const loaded = loadLoopGraph(chosen.graphText, {
        resolveRole: chosen.resolveRole,
        connectedTargets: ['cursor'],
      });
      assert.equal(loaded.ok, true, formatErrors(loaded));

      // And the default is a default, not an absence: the declaration says nothing
      // about a root, and the row still has one.
      assert.equal(row.definition?.resourceRoot, undefined);
      assert.equal(describeDefinitionRow(row).dependency, null, 'nothing to depend on');
    });
  }

  /**
   * The refusal, and the one way to say what it refuses.
   *
   * A graph outside the root is not forbidden — it is a dependency, and `resourceRoot`
   * is how a declaration writes one down. So the same graph is reached by moving the
   * root rather than by exempting the path, which is why this is one rule and not two:
   * `graph` and a role path meet the same boundary and are let past it the same way.
   */
  it('refuses a graph that climbs out of the root, and takes a declared root as the answer', () => {
    const folder = temporaryDir('escape');
    const file = path.join(folder, 'inner', 'my.loop.json');
    write(file, declaration({ id: 'a', name: 'A', graph: '../outside/x.graph.json' }));

    const row = openLoopDefinitionFile(file);
    assert.equal(row.definition, null);
    assert.equal(row.findings.some((finding) => finding.code === 'graph-climbs-out'), true);

    // The refusal is decided from the text, so the renderer meets it on the same terms
    // as the main process — there is no path in it for a filesystem to supply.
    const fromTextAlone = parseLoopDefinition(
      declaration({ id: 'a', name: 'A', graph: '../outside/x.graph.json' }),
    );
    assert.equal(fromTextAlone.ok, false);
    assert.equal(
      fromTextAlone.findings.some((finding) => finding.code === 'graph-climbs-out'),
      true,
    );

    const declared = path.join(folder, 'inner', 'declared.loop.json');
    write(
      declared,
      declaration({
        id: 'a',
        name: 'A',
        resourceRoot: '..',
        resourceRootNote: 'The graph lives above this folder.',
        graph: 'outside/x.graph.json',
      }),
    );
    const moved = openLoopDefinitionFile(declared);
    assert.notEqual(moved.definition, null, 'declaring the root is how a graph elsewhere is reached');
    assert.equal(moved.graphPath, path.join(folder, 'outside', 'x.graph.json'));
  });

  it('resolves a definition\u2019s roles from the definition while another folder is the working folder', () => {
    const { file } = selfContainedDefinition();
    const workingFolder = temporaryDir('workB');

    const row = openLoopDefinitionFile(file);
    assert.equal(row.definition !== null, true, 'the declaration itself must load first');

    const fromDefinition = loadLoopGraph(fs.readFileSync(row.graphPath as string, 'utf8'), {
      resolveRole: createDefinitionRoleResolver(row) ?? undefined,
      connectedTargets: ['cursor'],
    });
    assert.equal(fromDefinition.ok, true, 'anchored at the definition, the roles are there');

    // The same graph, anchored the way it used to be. This is the defect, reproduced:
    // the working folder has no roles in it and never did.
    const fromWorkingFolder = loadLoopGraph(fs.readFileSync(row.graphPath as string, 'utf8'), {
      resolveRole: createFileRoleResolver(workingFolder),
      connectedTargets: ['cursor'],
    });
    assert.equal(fromWorkingFolder.ok, false);
    assert.equal(
      fromWorkingFolder.findings.some((finding) => finding.code === 'role-does-not-resolve'),
      true,
    );
  });

  it('resolves the five specialist roles through a resourceRoot pointing at the DSpatch working copy', () => {
    const folder = temporaryDir('borrower');
    const file = path.join(folder, 'my.loop.json');
    write(
      file,
      declaration({
        id: 'borrowed',
        name: 'Borrowed roles',
        graph: 'g.graph.json',
        resourceRoot: path.relative(folder, repoRoot),
        resourceRootNote: 'Roles are the live files in the DSpatch working copy.',
      }),
    );

    const row = openLoopDefinitionFile(file);
    const resolve = createDefinitionRoleResolver(row);
    assert.notEqual(resolve, null);

    const specialists = ['planner', 'researcher', 'implementer', 'verifier', 'reviewer'];
    for (const specialist of specialists) {
      const id = specialist === 'planner' ? 'dspatch-backlog-planner' : `dspatch-${specialist}`;
      const role = (resolve as NonNullable<typeof resolve>)({
        id,
        source: { kind: 'cursor-agent-file', path: `.cursor/agents/${id}.md` },
      });
      assert.notEqual(role, null, `${id} must resolve through the declared resource root`);
    }

    assert.match(String(describeDefinitionRow(row).dependency), /Reads its resources from/);
  });

  it('resolves a path above the resource root to nothing, not to unchecked', () => {
    const folder = temporaryDir('bounded');
    const outside = temporaryDir('outside');
    write(path.join(outside, 'secret.md'), '---\nname: secret\n---\n\nShould not be reachable.\n');
    write(path.join(folder, 'my.loop.json'), declaration({ id: 'b', name: 'B', graph: 'g.graph.json' }));

    const resolve = createDefinitionRoleResolver(openLoopDefinitionFile(path.join(folder, 'my.loop.json')));
    const climbing = (resolve as NonNullable<typeof resolve>)({
      id: 'secret',
      source: { kind: 'cursor-agent-file', path: `${path.relative(folder, outside)}/secret.md` },
    });

    assert.equal(climbing, null, 'the file exists; the point is that the reference does not reach it');
  });

  it('tells "resolves to nothing" from "unchecked", which is the whole reason the control is here', () => {
    const graphText = fs
      .readFileSync(path.join(repoRoot, chatGraphRel), 'utf8')
      .replace('docs/loop/roles/project/project-work.role.md', 'docs/loop/roles/project/absent.role.md');

    const checked = loadLoopGraph(graphText, {
      resolveRole: createFileRoleResolver(repoRoot),
      connectedTargets: ['cursor'],
    });
    assert.equal(checked.ok, false);
    assert.equal(checked.findings.some((finding) => finding.code === 'role-does-not-resolve'), true);

    const unchecked = loadLoopGraph(graphText, { connectedTargets: ['cursor'] });
    assert.equal(unchecked.ok, true, 'without a resolver nothing was established, which is not a failure');
    assert.equal(unchecked.findings.some((finding) => finding.code === 'role-not-checked'), true);
    assert.equal(
      unchecked.findings.some((finding) => finding.code === 'role-does-not-resolve'),
      false,
      'a validator with no resolver must not claim the role is missing',
    );
  });

  it('keeps the three existing graphs loading exactly as they did', () => {
    for (const rel of existingGraphs) {
      const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), {
        resolveRole: createFileRoleResolver(repoRoot),
        connectedTargets: ['cursor'],
      });
      assert.equal(loaded.ok, true, `${rel} must still load`);
    }
  });

  it('loads the runnable development-loop subset the standalone definition points at', () => {
    const rel = path.join('docs', 'loop', 'graphs', 'dspatch-development-loop-runnable.graph.json');
    const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), {
      resolveRole: createFileRoleResolver(repoRoot),
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, formatErrors(loaded));
    assert.equal(loaded.ok && loaded.graph.id, 'dspatch-development-loop-runnable');
    assert.equal(
      loaded.ok && loaded.graph.nodes.some((node) => node.kind === 'gate'),
      false,
      'a gate would start a command, not a reviewer',
    );
    assert.equal(
      loaded.ok && loaded.graph.nodes.find((node) => node.id === 'implementation-review')?.kind,
      'agent',
    );
  });
});

describe('where results go', () => {
  it('anchors results away from the resource root, by default and when declared', () => {
    const folder = temporaryDir('results');
    const file = path.join(folder, 'my.loop.json');
    write(
      file,
      declaration({
        id: 'borrowed',
        name: 'Borrowed roles',
        graph: 'g.graph.json',
        resourceRoot: path.relative(folder, repoRoot),
        resourceRootNote: 'Roles are the live files in the DSpatch working copy.',
      }),
    );
    const row = openLoopDefinitionFile(file);
    const definition = row.definition as NonNullable<typeof row.definition>;
    const runScopedRoot = path.join(temporaryDir('runs'), 'run-1');

    const byDefault = resultRootFor({ definition, runScopedRoot });
    assert.equal(byDefault.declared, false);
    assert.equal(byDefault.root, path.resolve(runScopedRoot));
    assert.equal(
      path.relative(row.resourceRoot as string, byDefault.root).startsWith('..'),
      true,
      'results must not land inside the repository whose roles this definition borrows',
    );

    const declaredRoot = path.join(temporaryDir('declared'), 'out');
    const chosen = resultRootFor({
      definition: { ...definition, resultRoot: declaredRoot },
      runScopedRoot,
    });
    assert.equal(chosen.declared, true);
    assert.equal(chosen.root, path.resolve(declaredRoot));
  });
});

/**
 * DSP-70: the definition you chose is the definition that runs.
 *
 * The regression that matters is that the simple chat loop behaves as it did once it
 * is an ordinary declaration — same graph, same roles — so that is checked against the
 * real file in this repository rather than a fixture. The new property is that the
 * value a run holds cannot be reached by editing the file afterwards, which is checked
 * by editing the file afterwards.
 */
describe('the definition that runs', () => {
  const chatLoopDeclaration = path.join(repoRoot, '.dspatch', 'loops', 'dspatch-chat-loop.loop.json');

  it('finds DSpatch\u2019s own chat loop where DSpatch looks, and reaches the same graph and roles as before', () => {
    const row = openLoopDefinitionFile(chatLoopDeclaration);
    assert.equal(row.findings.filter((finding) => finding.severity === 'error').length, 0);
    assert.equal(row.definition?.id, 'dspatch-chat-loop');

    // The declaration DSP-69's reopen was hardest on. Its graph is not in the
    // bookkeeping directory it is filed in, so under one base it has to say where it
    // reads from — and having said so, it reaches the repository root it always meant.
    assert.equal(row.definition?.resourceRoot, '../..');
    assert.equal(row.resourceRoot, repoRoot);
    assert.equal(row.graphPath, path.join(repoRoot, chatGraphRel));

    // And the climbing-out is not a quiet exemption. It is the visible dependency any
    // declared root is, shown on the row before anybody chooses the loop.
    assert.match(String(describeDefinitionRow(row).dependency), /Reads its resources from/);
    assert.equal(
      row.findings.some((finding) => finding.code === 'resource-root-note-missing'),
      false,
      'a root that climbs out must say what it depends on, and this one is ours',
    );

    // And the roles resolve exactly as `createFileRoleResolver(ownRoot)` used to make
    // them resolve, which is what "behaves as today" means for this graph.
    const loaded = loadLoopGraph(fs.readFileSync(row.graphPath as string, 'utf8'), {
      resolveRole: createDefinitionRoleResolver(row) as NonNullable<
        ReturnType<typeof createDefinitionRoleResolver>
      >,
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, formatErrors(loaded));
  });

  /**
   * The positive control the withdrawn rule made impossible to write.
   *
   * Two copies of one declaration, both two levels under the same folder, one of them
   * in that folder's standard `.dspatch/loops` location and one of them in a directory
   * nobody has heard of. Under the home-folder rule these resolved against different
   * bases and an earlier version of this test asserted exactly that, as a negative
   * control for a rule that had been invented rather than agreed. The rule is
   * withdrawn, so the claim is now the plain one: where DSpatch found a file does not
   * change what the paths inside it mean, and the two reach the same graph and the same
   * roles byte for byte.
   */
  it('reads the same declaration the same way in the standard location and out of it', () => {
    const base = temporaryDir('same-meaning');
    resourcesUnder(base);
    const text = projectDeclaration({ id: 'same', name: 'Same', graph: 'graphs/chat.graph.json' });
    const filed = path.join(base, '.dspatch', 'loops', 'mine.loop.json');
    const byHand = path.join(base, 'somewhere', 'else', 'mine.loop.json');
    write(filed, text);
    write(byHand, text);

    const rows = [openLoopDefinitionFile(filed), openLoopDefinitionFile(byHand)];
    assert.deepEqual(
      rows.map((row) => row.resourceRoot),
      [base, base],
      'two levels under a folder is two levels under a folder, whatever the directory is called',
    );
    assert.deepEqual(
      rows.map((row) => row.graphPath),
      [path.join(base, 'graphs', 'chat.graph.json'), path.join(base, 'graphs', 'chat.graph.json')],
    );

    // Resolved, not merely equal as strings: both must actually reach the graph and its
    // roles, or this would pass just as well for two declarations that reach nothing.
    const opened = rows.map((row) => openChosenLoop(row));
    for (const outcome of opened) {
      assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.note);
      const loaded = loadLoopGraph((outcome as Extract<typeof outcome, { ok: true }>).chosen.graphText, {
        resolveRole: (outcome as Extract<typeof outcome, { ok: true }>).chosen.resolveRole,
        connectedTargets: ['cursor'],
      });
      assert.equal(loaded.ok, true, formatErrors(loaded));
    }
    assert.equal(
      (opened[0] as Extract<(typeof opened)[number], { ok: true }>).chosen.graphVersionId,
      (opened[1] as Extract<(typeof opened)[number], { ok: true }>).chosen.graphVersionId,
    );
  });

  it('resolves the same key to the same value twice, and to a new one after an edit', () => {
    const folder = temporaryDir('chosen');
    const declarationFile = path.join(folder, '.dspatch', 'loops', 'mine.loop.json');
    const graphFile = path.join(folder, 'loop.graph.json');
    write(declarationFile, projectDeclaration({ id: 'mine', name: 'My loop', graph: 'loop.graph.json' }));
    write(graphFile, '{"first":true}');

    const first = openChosenLoop(openLoopDefinitionFile(declarationFile));
    assert.equal(first.ok, true);
    const held = first.ok ? first.chosen : null;
    assert.equal(held?.graphPath, graphFile, 'the root the declaration named is where its graph is');

    // The preview and the send each resolve the key for themselves, so what makes
    // them agree is that one key and one procedure give one answer.
    const again = openChosenLoop(openLoopDefinitionFile(declarationFile));
    assert.equal(again.ok && again.chosen.graphVersionId, held?.graphVersionId);

    // And what makes them disagree is a real edit, which must produce a different
    // version rather than the same one over different bytes. It is why the preview
    // re-reads instead of holding what it first saw.
    fs.writeFileSync(graphFile, '{"first":false}', 'utf8');
    const afterEdit = openChosenLoop(openLoopDefinitionFile(declarationFile));
    assert.notEqual(
      afterEdit.ok ? afterEdit.chosen.graphVersionId : null,
      held?.graphVersionId,
      'a different file is a different version',
    );
  });

  /**
   * DSP-70 #3 and #4, exercised rather than inspected.
   *
   * The first version of this test asserted that a captured string was unchanged
   * after the file changed, which is true of any copy and would still have passed if
   * someone later made the runner re-read its definition mid-run. So this walks the
   * graph with the runner **after deleting the definition, its graph and its roles**.
   * Anything on that path that went back to disk would find nothing, and the run
   * would either fail or lose the role prose it is asserted to still be sending.
   *
   * The deletion is checked, not assumed: a fresh resolver over the same root must
   * resolve the same reference to `null`. Without that line the whole test would pass
   * just as well over files that were never removed.
   */
  it('walks the drawing it pinned even when the definition is gone from disk', async () => {
    const { folder, file } = selfContainedDefinition();
    const opened = openChosenLoop(openLoopDefinitionFile(file));
    assert.equal(opened.ok, true, opened.ok ? '' : opened.note);
    const chosen = (opened as Extract<typeof opened, { ok: true }>).chosen;
    const pinnedVersion = chosen.graphVersionId;

    const loaded = loadLoopGraph(chosen.graphText, {
      resolveRole: chosen.resolveRole,
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, formatErrors(loaded));
    const graph = (loaded as Extract<typeof loaded, { ok: true }>).graph;

    // The entry step's role, read through a resolver of its own so that asking the
    // question does not warm the cache the test is about.
    const entryNode = graph.nodes.find((node) => node.id === graph.entry);
    const reference = entryNode?.role as NonNullable<typeof entryNode>['role'];
    assert.notEqual(reference, undefined, 'the entry step must name a role for this to prove anything');
    const expected = createFileRoleResolver(folder)(
      reference as NonNullable<typeof reference>,
    )?.instructions;
    assert.equal(typeof expected === 'string' && expected.length > 200, true);

    // Everything the run was given is now off the disk.
    fs.rmSync(folder, { recursive: true, force: true });
    assert.equal(fs.existsSync(file), false);
    assert.equal(
      createFileRoleResolver(folder)(reference as NonNullable<typeof reference>),
      null,
      'a resolver that went back to disk now would find nothing — which is the point',
    );

    const prompts: string[] = [];
    const dryRun = createDryRunExecutor({ decisions: [], unscripted: 'first-branch' });
    const result = await runLoopGraph(graph, {
      runId: 'pinned-run',
      dryRun: true,
      executor: async (context) => {
        if (context.node.kind === 'agent') {
          // The same three things the chat handler puts in a prompt, from the same
          // held value: the node, the mandate, and the role as this run resolved it.
          const reference = context.node.role;
          const role = reference === undefined ? null : chosen.resolveRole(reference);
          prompts.push(
            chatPromptFor(context.node, {
              entryId: graph.entry,
              mandate: 'Do the thing the mandate asks.',
              role:
                role === null
                  ? null
                  : {
                      id: role.id,
                      sourcePath: role.sourcePath,
                      instructions: role.instructions ?? null,
                    },
            }),
          );
        }
        return dryRun(context);
      },
    });

    assert.equal(result.status, 'completed', 'the run must walk the drawing it was handed');
    assert.equal(prompts.length > 0, true, 'no agent step ran, so nothing was proved');
    assert.equal(
      prompts.some(
        (prompt) => prompt.includes(ROLE_BLOCK_OPEN) && prompt.includes(expected as string),
      ),
      true,
      'the role prose the run started with must still reach the prompt',
    );
    assert.equal(chosen.graphVersionId, pinnedVersion);
  });

  it('offers one preselected row, lists each folder once, and follows a key it has never seen', () => {
    const project = path.join('C:', 'work', 'project');
    const own = path.join('C:', 'work', 'DSpatch');
    const loops = (folder: string): string => path.join(folder, '.dspatch', 'loops');
    const io = countingIo({
      [path.join(loops(project), 'ported.loop.json')]: declaration({
        id: 'ported-loop',
        name: 'Ported loop',
        graph: 'g.graph.json',
      }),
      [path.join(loops(project), 'broken.loop.json')]: '{ not json',
      [path.join(loops(own), 'dspatch-chat-loop.loop.json')]: declaration({
        id: 'dspatch-chat-loop',
        name: 'Simple chat loop',
        graph: 'g.graph.json',
      }),
    });

    const listing = listChoosableLoops([project, own, project], [], io);
    assert.equal(listing.choices.length, 3, 'a declaration that will not load is still listed');
    assert.equal(io.listed.length, 2, 'a folder named twice is still one directory read');

    const preselected = listing.choices.filter((choice) => choice.preselected);
    assert.equal(preselected.length, 1);
    assert.equal(preselected[0]?.definitionId, 'dspatch-chat-loop');

    const broken = listing.choices.find((choice) => !choice.usable);
    assert.notEqual(broken, undefined);
    assert.notEqual(broken?.display.error, null, 'its finding travels with its row');

    // A key from no folder's list is a definition someone pointed at by hand, read
    // through the same path rather than a second mechanism.
    const rows = discoverLoopDefinitions([project, own], io).rows;
    const byHand = path.join('C:', 'elsewhere', 'other.loop.json');
    assert.equal(rowForKey(rows, byHand, io).filePath, byHand);
    assert.equal(rowForKey(rows, rows[0]?.filePath as string, io), rows[0]);
  });

  /**
   * DSP-70, F4. The preview used to show our own development loop looking ready and
   * Send then refused it, so the person learned it could not run only after asking
   * for it. A row that cannot run says so where every other row that cannot run says
   * so — in the list, unselectable, with its reason — rather than in a second place
   * with a second wording.
   */
  it('lists our development loop as selectable: the refusal is no longer on the drawing', () => {
    // DSP-70 F4 marked this id unselectable in the list because Send then refused it
    // by id. DSP-78 removed that refusal: a drawing is not a folder, and the folder
    // guard is asked of every loop about the roots it was actually given. So the row
    // is now usable, and a second row that never had an id problem stays usable too.
    const folder = temporaryDir('now-choosable');
    write(
      path.join(folder, '.dspatch', 'loops', 'dev.loop.json'),
      projectDeclaration({ id: 'dev', name: 'DSpatch development loop', graph: 'dev.graph.json' }),
    );
    write(
      path.join(folder, 'dev.graph.json'),
      JSON.stringify({ id: 'dspatch-development-loop', name: 'DSpatch development loop' }),
    );
    write(
      path.join(folder, '.dspatch', 'loops', 'ok.loop.json'),
      projectDeclaration({ id: 'ok', name: 'Ordinary loop', graph: 'ok.graph.json' }),
    );
    write(path.join(folder, 'ok.graph.json'), JSON.stringify({ id: 'ordinary', name: 'Ordinary' }));

    const listing = listChoosableLoops([folder]);
    const development = listing.choices.find((choice) => choice.definitionId === 'dev');
    assert.equal(development?.usable, true);
    assert.equal(development?.display.error, null);

    const ordinary = listing.choices.find((choice) => choice.definitionId === 'ok');
    assert.equal(ordinary?.usable, true);
    assert.equal(ordinary?.display.error, null);
    assert.equal(
      listing.choices.filter((choice) => choice.preselected).length,
      1,
      'exactly one default among two usable rows',
    );
  });

  /**
   * DSP-68 #5. A definition from outside every folder is the case DSP-78's standalone
   * development loop arrives as, so it has to be reachable and it has to be one list:
   * two lists would be two wordings for the same row, and the origin is what tells a
   * hand-picked definition from a discovered one.
   */
  it('takes a definition from outside every folder into the same list, by origin', () => {
    const project = path.join('C:', 'work', 'project');
    const outside = path.join('C:', 'elsewhere', 'standalone.loop.json');
    const inProject = path.join(project, '.dspatch', 'loops', 'ours.loop.json');
    const io = countingIo({
      [inProject]: declaration({ id: 'ours', name: 'Ours', graph: 'g.graph.json' }),
      [outside]: declaration({ id: 'standalone', name: 'Standalone loop', graph: 'g.graph.json' }),
      [path.join('C:', 'elsewhere', 'broken.loop.json')]: '{ not json',
    });

    const listing = listChoosableLoops(
      [project],
      [outside, path.join('C:', 'elsewhere', 'broken.loop.json')],
      io,
    );
    assert.deepEqual(
      listing.choices.map((choice) => choice.definitionId),
      ['ours', 'standalone', null],
    );
    const picked = listing.choices[1];
    assert.match(picked?.display.origin ?? '', /chosen by hand$/);
    assert.equal(picked?.usable, true);

    // One that will not load is listed with its finding, like any other row. A dialog
    // error would be a second way of saying the same thing, in a place the row is not.
    const refused = listing.choices[2];
    assert.equal(refused?.usable, false);
    assert.notEqual(refused?.display.error, null);
    assert.match(refused?.display.origin ?? '', /chosen by hand$/);

    // And picking a file that a folder already offers is still one row, keeping the
    // origin that says where it lives.
    const both = listChoosableLoops([project], [inProject], io);
    assert.equal(both.choices.length, 1);
    assert.match(both.choices[0]?.display.origin ?? '', /ours\.loop\.json$/);
    assert.doesNotMatch(both.choices[0]?.display.origin ?? '', /chosen by hand/);
  });

  /**
   * DSP-78. A declaration sitting next to DSpatch, not inside it, that borrows
   * DSpatch's graph and roles through `resourceRoot`. The real file lives outside
   * this repository; this test plants the same shape so the property does not depend
   * on that folder still being there next month.
   */
  it('resolves a standalone definition from beside the repo, without making its folder a working root', () => {
    const beside = temporaryDir('dspatch-loop-definition');
    const file = path.join(beside, 'dspatch-development-loop.loop.json');
    const resourceRoot = path.relative(beside, repoRoot).split(path.sep).join('/');
    write(
      file,
      JSON.stringify({
        format: 'dspatch-loop-definition',
        formatVersion: 1,
        id: 'dspatch-development-loop-runnable',
        name: 'DSpatch development loop (runnable subset)',
        resourceRoot,
        resourceRootNote: 'The DSpatch working copy, referenced rather than copied.',
        graph: 'docs/loop/graphs/dspatch-development-loop-runnable.graph.json',
      }),
    );

    const row = openLoopDefinitionFile(file);
    assert.equal(row.findings.filter((finding) => finding.severity === 'error').length, 0);
    assert.equal(row.resourceRoot, repoRoot);
    assert.equal(
      row.graphPath,
      path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop-runnable.graph.json'),
    );
    assert.match(String(describeDefinitionRow(row).dependency), /Reads its resources from/);
    assert.match(describeDefinitionRow(row).origin, /chosen by hand/);

    const opened = openChosenLoop(row);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.note);
    if (!opened.ok) {
      return;
    }
    const loaded = loadLoopGraph(opened.chosen.graphText, {
      resolveRole: opened.chosen.resolveRole,
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, formatErrors(loaded));

    // Choosing a definition is not opening a folder. The declaration's own directory
    // — and the development directory above a sibling layout — are not working roots.
    const project = temporaryDir('a-project');
    const roots = workingRootsFrom([project], project, process.platform === 'win32');
    assert.deepEqual(
      roots.map((root) => root.path),
      [project],
    );
    assert.equal(
      roots.some((root) => root.path === beside || root.path === path.dirname(beside)),
      false,
    );
  });

  it('opens the real standalone definition outside this repository when it is there', () => {
    const file = path.join(
      repoRoot,
      '..',
      'dspatch-loop-definition',
      'dspatch-development-loop.loop.json',
    );
    if (!fs.existsSync(file)) {
      // The declaration is deliberately outside the repo. This machine has it; a
      // checkout that does not is not a product failure.
      return;
    }
    const row = openLoopDefinitionFile(file);
    assert.equal(row.findings.filter((finding) => finding.severity === 'error').length, 0);
    assert.equal(row.definition?.id, 'dspatch-development-loop-runnable');
    assert.equal(row.resourceRoot, repoRoot);
    assert.match(String(describeDefinitionRow(row).dependency), /Reads its resources from/);
    const opened = openChosenLoop(row);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.note);
    if (!opened.ok) {
      return;
    }
    const loaded = loadLoopGraph(opened.chosen.graphText, {
      resolveRole: opened.chosen.resolveRole,
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, formatErrors(loaded));
    assert.equal(loaded.ok && loaded.graph.id, 'dspatch-development-loop-runnable');
  });
});

function formatErrors(loaded: ReturnType<typeof loadLoopGraph>): string {
  return loaded.ok ? '' : loaded.findings.map((finding) => finding.message).join('\n');
}
