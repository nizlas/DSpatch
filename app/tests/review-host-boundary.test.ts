/**
 * Where the review host ends and the review client begins (DSP-111), read from the
 * source: the host module reaches no Electron and nothing of the renderer, however
 * deep its imports go, and the client files that bind it to windows run no git and
 * hold no `ReviewService` of their own.
 *
 * A reading of import statements, not a run: it says what the files can reach, which
 * is the property a separate host process will need. That the flows work through the
 * host is `review-host.test.ts`.
 *
 *     node --test tests/review-host-boundary.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every module specifier a file names: static imports, re-exports, `import()` and `require()`. */
function specifiersOf(file: string): string[] {
  // Comment lines are left out: prose such as "import it from the SDK" is not an import.
  const text = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/gms,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.push(match[1] ?? '');
    }
  }
  return found;
}

function resolveRelative(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`${path.relative(src, from)} imports ${specifier}, which does not resolve to a source file`);
}

/** Every source file reachable from the entries by relative imports, and every bare specifier on the way. */
function reach(entries: readonly string[]): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() ?? '';
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        queue.push(resolveRelative(file, specifier));
      } else if (!packages.has(specifier)) {
        packages.set(specifier, path.relative(src, file));
      }
    }
  }
  return { files, packages };
}

test('the review host reaches no Electron and nothing under renderer/, however deep its imports go', () => {
  const { files, packages } = reach([
    path.join(src, 'host', 'review-host.ts'),
    path.join(src, 'host', 'local-review-host.ts'),
    path.join(src, 'shared', 'review-host-contract.ts'),
  ]);
  // The walk did reach the service it wraps: a walk that stopped early would prove nothing.
  assert.ok(files.has(path.join(src, 'main', 'review-service.ts')), 'the walk reached review-service.ts');
  const electron = [...packages.keys()].filter((name) => name === 'electron' || name.startsWith('electron/') || name.startsWith('@electron/'));
  assert.deepEqual(
    electron.map((name) => `${name} (from ${packages.get(name) ?? '?'})`),
    [],
    'the host must not import Electron',
  );
  const renderer = [...files].filter((file) => path.relative(src, file).split(path.sep)[0] === 'renderer');
  assert.deepEqual(renderer.map((file) => path.relative(src, file)), [], 'the host must not import the renderer');
  // Only Node built-ins: the host is plain Node, which is what a separate process will be.
  const outside = [...packages.keys()].filter((name) => !name.startsWith('node:'));
  assert.deepEqual(outside, [], 'the host imports only Node built-ins');
});

test('the review client files run no git, read no records and hold no ReviewService', () => {
  for (const name of ['review-windows.ts', 'review-ipc.ts']) {
    const file = path.join(src, 'main', name);
    const specifiers = specifiersOf(file);
    assert.deepEqual(
      specifiers.filter((specifier) => specifier === 'node:child_process' || specifier === 'child_process'),
      [],
      `${name} must not start processes: git is the host's`,
    );
    assert.deepEqual(
      specifiers.filter((specifier) => /(^|\/)review-service$/.test(specifier) || specifier.startsWith('../host/')),
      [],
      `${name} reaches the host only through the ReviewHostApi it is given`,
    );
  }

  // The one file-system call allowed on the client: `fs.existsSync` on the chooser's
  // start folder, a path on the machine the window runs on that the native dialog opens
  // in. Records, the recent index and repository files are read by the host only.
  const windows = fs.readFileSync(path.join(src, 'main', 'review-windows.ts'), 'utf8');
  const fsCalls = [...windows.matchAll(/\bfs\.[A-Za-z]+\([^)]*\)/g)].map((match) => match[0]);
  assert.deepEqual(fsCalls, ['fs.existsSync(entry.startFolder)'], 'review-windows.ts uses fs only for the chooser start folder');
  const ipcSpecifiers = specifiersOf(path.join(src, 'main', 'review-ipc.ts'));
  assert.deepEqual(
    ipcSpecifiers.filter((specifier) => specifier === 'node:fs' || specifier === 'fs'),
    [],
    'review-ipc.ts uses no file system at all',
  );
});
