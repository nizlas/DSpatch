/**
 * What a source file can reach, read from its import statements (DSP-111).
 *
 * A reading of the source, not a run: it says what a process that loads a file can
 * load, which is the property a process boundary needs. Shared by the review host's
 * boundary test and the project host's.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * Every module specifier a file names: static imports, re-exports, `import()` and
 * `require()`. With `runtimeOnly`, `import type` and `export type` are left out: they
 * are erased by the compiler and load nothing.
 */
export function specifiersOf(file: string, runtimeOnly = false): string[] {
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
      if (runtimeOnly && /^\s*(?:import|export)\s+type\s/.test(match[0])) {
        continue;
      }
      found.push(match[1] ?? '');
    }
  }
  return found;
}

export function resolveRelative(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`${path.relative(src, from)} imports ${specifier}, which does not resolve to a source file`);
}

/** Every source file reachable from the entries by relative imports, and every bare specifier on the way. */
export function reach(
  entries: readonly string[],
  runtimeOnly = false,
): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() ?? '';
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of specifiersOf(file, runtimeOnly)) {
      if (specifier.startsWith('.')) {
        queue.push(resolveRelative(file, specifier));
      } else if (!packages.has(specifier)) {
        packages.set(specifier, path.relative(src, file));
      }
    }
  }
  return { files, packages };
}
