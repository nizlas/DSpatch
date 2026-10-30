/**
 * A repository for reading around a change (Niclas's trial of 30 October 2026, where a few
 * lines of context and "… 26 unchanged lines" were not enough to find one's way).
 *
 * `routing` has two commits. `src/domain/sessionRouting.ts` is long enough to need
 * scrolling and changes in three separate blocks ({@link ROUTING_BLOCKS}), far enough apart
 * that the unchanged runs between them fold. The changed lines call `lookupRoute`, defined in
 * `src/domain/routeTable.ts`, which the change does not touch; it calls `normaliseLane`,
 * defined in `src/domain/lanes.ts`, also untouched: a reference leads to an unchanged file,
 * and a further reference from there to another. `src/generated/catalog.ts` is large
 * ({@link CATALOG_LINES} lines) with one changed line, for showing a whole large file.
 *
 * The content is invented for the check. Only node built-ins and git.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RoutingFixture {
  readonly workspace: string;
  readonly routing: string;
  readonly base: string;
  readonly target: string;
  /** A third commit: a second review is `target` → `later`. */
  readonly later: string;
}

export const ROUTING_FILE = 'src/domain/sessionRouting.ts';
export const CATALOG_LINES = 5000;

/** The three changed blocks of {@link ROUTING_FILE}, by their first line at To. */
export const ROUTING_BLOCKS = { first: 42, second: 201, third: 383 } as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(folder: string, file: string, lines: readonly string[]): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${lines.join('\n')}\n`);
}

/** Small functions that read as code, numbered so every line is its own. */
function filler(prefix: string, from: number, count: number): string[] {
  const lines: string[] = [];
  for (let index = 0; lines.length < count; index += 1) {
    const n = from + index;
    lines.push(`/** ${prefix} rule ${String(n)}: how a session on lane ${String(n % 7)} is weighed. */`);
    lines.push(`export function ${prefix}Weight${String(n)}(load: number): number {`);
    lines.push(`  const share = load * ${String((n % 9) + 1)} / 10;`);
    lines.push(`  return share > ${String(n * 3)} ? ${String(n * 3)} : share;`);
    lines.push('}');
    lines.push('');
  }
  return lines.slice(0, count);
}

function routing(version: 'base' | 'target'): string[] {
  const head = [
    "import { lookupRoute, type RouteTable } from './routeTable';",
    '',
    '/** Which output a session is routed to, and why. */',
    'export interface SessionRoute {',
    '  readonly session: string;',
    '  readonly output: string;',
    '  readonly reason: string;',
    '}',
    '',
  ];
  // Lines 10–40: filler; block one at 41.
  const lines = [...head, ...filler('route', 1, 31)];
  if (version === 'base') {
    lines.push('export function routeSession(table: RouteTable, session: string, lane: string): SessionRoute {');
    lines.push("  return { session, output: table.fallback, reason: 'no lookup' };");
    lines.push('}');
  } else {
    lines.push('export function routeSession(table: RouteTable, session: string, lane: string): SessionRoute {');
    lines.push('  const route = lookupRoute(table, lane);');
    lines.push("  return { session, output: route === null ? table.fallback : route.output, reason: route === null ? 'no route' : 'lane' };");
    lines.push('}');
  }
  // Up to the second block, at To line 201.
  const toSecond = 200 - lines.length;
  lines.push(...filler('balance', 100, toSecond));
  if (version === 'target') {
    lines.push('/** A session that asks for a lane no table knows keeps its own output. */');
    lines.push("export const UNKNOWN_LANE_REASON = 'unknown lane';");
    lines.push('');
  }
  // Up to the third block: at To line 382.
  const toThird = (version === 'target' ? 381 : 378) - lines.length;
  lines.push(...filler('drain', 300, toThird));
  if (version === 'base') {
    lines.push('export function drainSessions(routes: readonly SessionRoute[]): number {');
    lines.push('  let drained = 0;');
    lines.push('  for (const route of routes) {');
    lines.push('    drained += route.output.length;');
    lines.push('  }');
    lines.push('  return drained;');
    lines.push('}');
  } else {
    lines.push('export function drainSessions(routes: readonly SessionRoute[]): number {');
    lines.push('  return routes.filter((route) => route.reason !== UNKNOWN_LANE_REASON).length;');
    lines.push('}');
  }
  lines.push('');
  lines.push(...filler('tail', 500, 42));
  return lines;
}

function routeTable(): string[] {
  const lines = [
    "import { normaliseLane } from './lanes';",
    '',
    '/** Where each lane goes, with the output used when none is found. */',
    'export interface RouteTable {',
    '  readonly lanes: ReadonlyMap<string, Route>;',
    '  readonly fallback: string;',
    '}',
    '',
    'export interface Route {',
    '  readonly output: string;',
    '}',
    '',
    ...filler('table', 1, 208),
  ];
  lines.push('/** The route for a lane, or null when the table has none for it. */');
  lines.push('export function lookupRoute(table: RouteTable, lane: string): Route | null {');
  lines.push('  const found = table.lanes.get(normaliseLane(lane));');
  lines.push('  if (found === undefined) {');
  lines.push('    return null;');
  lines.push('  }');
  lines.push('  return found;');
  lines.push('}');
  lines.push('');
  lines.push(...filler('index', 300, 80));
  return lines;
}

function lanes(): string[] {
  const lines = ['/** Lane names as the tables store them. */', '', ...filler('lane', 1, 190)];
  lines.push('/** A lane name without case or surrounding space, as tables store it. */');
  lines.push('export function normaliseLane(lane: string): string {');
  lines.push('  return lane.trim().toLowerCase();');
  lines.push('}');
  lines.push('');
  lines.push(...filler('alias', 400, 60));
  return lines;
}

function catalog(version: 'base' | 'target'): string[] {
  const lines: string[] = ['/** Generated: every output the router knows. Do not edit by hand. */'];
  for (let index = 1; lines.length < CATALOG_LINES; index += 1) {
    lines.push(`export const OUTPUT_${String(index).padStart(4, '0')} = { id: ${String(index)}, name: 'output ${String(index)}', channels: ${String((index % 8) + 1)} };`);
  }
  if (version === 'target') {
    lines[2500] = `export const OUTPUT_2500 = { id: 2500, name: 'output 2500 (main)', channels: 2 };`;
  }
  return lines;
}

export function makeRoutingFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-routing-'))): RoutingFixture {
  const repo = path.join(workspace, 'routing');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test Author');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, ROUTING_FILE, routing('base'));
  write(repo, 'src/domain/routeTable.ts', routeTable());
  write(repo, 'src/domain/lanes.ts', lanes());
  write(repo, 'src/generated/catalog.ts', catalog('base'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Route sessions to a fallback');
  const base = git(repo, 'rev-parse', 'HEAD');
  write(repo, ROUTING_FILE, routing('target'));
  write(repo, 'src/generated/catalog.ts', catalog('target'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Route sessions by lane through the route table');
  const target = git(repo, 'rev-parse', 'HEAD');
  // A later change, for a second review over the same repository: its own pair, its own discussion.
  write(repo, 'src/domain/lanes.ts', lanes().map((line) => (line === '  return lane.trim().toLowerCase();' ? "  return lane.trim().toLowerCase().replace(/_/g, '-');" : line)));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Lane names use dashes');
  const later = git(repo, 'rev-parse', 'HEAD');
  return { workspace, routing: repo, base, target, later };
}
