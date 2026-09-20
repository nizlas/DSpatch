/**
 * Writing a loop graph back out, in the shape a person wrote it in.
 *
 * DSP-22's third criterion is that a graph written by hand opens, round-trips and
 * is **not silently reformatted or reordered**. `JSON.stringify(graph, null, 2)`
 * fails that in three separate ways: it would put every key in whatever order the
 * object happened to have, explode every small object such as `view` and `when`
 * over four lines each, and turn thirty-one one-line edges into a hundred and
 * fifty. The file would still mean the same thing, and the diff would be
 * unreadable — which is the same problem as losing a hand-made arrangement, one
 * level down.
 *
 * So this module writes the format's own layout rather than a generic one:
 *
 * - **Key order is the format's**, not the object's. It follows how
 *   `docs/loop/GRAPH_FORMAT.md` presents each shape, so two authors editing the
 *   same graph produce the same file and a diff shows what changed.
 * - **Small attributes stay on one line.** `model`, `limits` on a node, `report`,
 *   `view`, `role.source`, an edge's `when`, and every list of names.
 * - **An edge is one line**, because the example graph is readable precisely
 *   because its thirty-one edges are thirty-one lines.
 *
 * The test that keeps this honest is byte equality against the hand-written
 * `docs/loop/graphs/dspatch-development-loop.graph.json`: load it, write it, and
 * the bytes must be the ones already on disk. That is the only form of "not
 * silently reformatted" that cannot quietly stop being true.
 *
 * Nothing here validates. `loop-graph-load.ts` does that, and a graph that fails
 * validation is refused before it reaches a writer.
 */

import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION } from './loop-graph';
import type { LoopGraph } from './loop-graph';

/** What a graph looks like once it is plain data, before it is text. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * The order each shape's keys are written in.
 *
 * Keyed by a path with `*` for an array index, so a node's `limits` and the
 * graph's `limits` can be treated differently — they are laid out differently in
 * the hand-written file, and the file is the specification here.
 */
const KEY_ORDER: Readonly<Record<string, readonly string[]>> = {
  '': [
    'format',
    'formatVersion',
    'id',
    'name',
    'purpose',
    'target',
    'entry',
    'onRuntimeFault',
    'notes',
    'limits',
    'archive',
    'failureKinds',
    'nodes',
    'edges',
  ],
  '/limits': ['maxTasks', 'maxCalls', 'maxReworkRounds', 'maxMinutes', 'note'],
  '/archive': ['path', 'entryPerNode', 'referenceReturned', 'notes'],
  '/failureKinds/*': ['id', 'label', 'meaning'],
  '/nodes/*': [
    'id',
    'kind',
    'label',
    'purpose',
    'role',
    'model',
    'limits',
    'requirements',
    'outcomes',
    'declaredFailures',
    'report',
    'notes',
    'view',
  ],
  '/nodes/*/role': ['id', 'source'],
  '/nodes/*/role/source': ['kind', 'path'],
  '/nodes/*/model': ['policy', 'model', 'description'],
  '/nodes/*/limits': ['maxTasks', 'maxCalls', 'maxReworkRounds', 'maxMinutes', 'note'],
  '/nodes/*/report': ['writtenBy', 'path'],
  '/nodes/*/view': ['x', 'y'],
  '/edges/*': ['id', 'from', 'to', 'when', 'label', 'notes'],
  '/edges/*/when': ['on', 'outcome', 'failure'],
};

/**
 * The objects and arrays that stay on one line.
 *
 * These are the attributes a person reads as a single fact — where a node is, what
 * a model policy is, when an edge is taken — and breaking each of them over four
 * lines is what makes a generic writer's output unreadable.
 */
const INLINE_PATHS: ReadonlySet<string> = new Set([
  '/nodes/*/role/source',
  '/nodes/*/model',
  '/nodes/*/limits',
  '/nodes/*/report',
  '/nodes/*/view',
  '/nodes/*/requirements',
  '/nodes/*/outcomes',
  '/nodes/*/declaredFailures',
  '/edges/*',
  '/edges/*/when',
]);

function canonicalPath(path: readonly (string | number)[]): string {
  return path.map((step) => (typeof step === 'number' ? '/*' : `/${step}`)).join('');
}

/** Written on one line: everything in {@link INLINE_PATHS}, plus any list of names. */
function isInline(value: JsonValue, path: readonly (string | number)[]): boolean {
  if (INLINE_PATHS.has(canonicalPath(path))) {
    return true;
  }
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function orderedEntries(
  value: { readonly [key: string]: JsonValue },
  path: readonly (string | number)[],
): readonly (readonly [string, JsonValue])[] {
  const order = KEY_ORDER[canonicalPath(path)];
  const keys = Object.keys(value);
  const ordered =
    order === undefined
      ? keys
      : [...order.filter((key) => keys.includes(key)), ...keys.filter((key) => !order.includes(key))];
  return ordered.map((key) => [key, value[key] as JsonValue] as const);
}

function writeValue(
  value: JsonValue,
  path: readonly (string | number)[],
  indent: string,
): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  const inline = isInline(value, path);
  const inner = inline ? indent : `${indent}  `;
  const open = inline ? ' ' : `\n${inner}`;
  const separator = inline ? ', ' : `,\n${inner}`;
  const close = inline ? ' ' : `\n${indent}`;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const parts = value.map((entry, index) =>
      writeValue(entry, [...path, index], inner),
    );
    return inline
      ? `[${parts.join(', ')}]`
      : `[\n${inner}${parts.join(`,\n${inner}`)}\n${indent}]`;
  }

  const entries = orderedEntries(value as { readonly [key: string]: JsonValue }, path);
  if (entries.length === 0) {
    return '{}';
  }
  const parts = entries.map(
    ([key, entry]) => `${JSON.stringify(key)}: ${writeValue(entry, [...path, key], inner)}`,
  );
  return `{${open}${parts.join(separator)}${close}}`;
}

/**
 * Drop the keys a graph does not set, so an absent attribute is absent rather than
 * `null`.
 *
 * The loader treats a missing attribute and an explicit `null` differently, and the
 * editor produces objects with `undefined` fields all the time — every optional
 * field the inspector has ever touched and then cleared.
 */
function withoutAbsent(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => withoutAbsent(entry));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        result[key] = withoutAbsent(entry);
      }
    }
    return result;
  }
  return value as JsonValue;
}

/**
 * The line ending a file already uses, so saving it does not rewrite every line.
 *
 * `docs/loop/graphs/dspatch-development-loop.graph.json` is CRLF on this machine,
 * as everything Git checks out here is. A writer that emitted LF would produce a
 * two-hundred-and-fifty-four-line diff for a node moved twenty pixels, which is
 * the same failure as reordering the keys and just as silent.
 */
export function detectNewline(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * A graph as text, in the format's own layout, with a trailing newline.
 *
 * The format markers are written from this build's constants rather than copied
 * from the graph: a file this build is allowed to save is a file of this version,
 * and `loop-graph-load.ts` already refuses to load a newer one.
 */
export function serialiseLoopGraph(
  graph: LoopGraph,
  options: { readonly newline?: '\n' | '\r\n' } = {},
): string {
  const value = withoutAbsent({
    ...graph,
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
  });
  const text = `${writeValue(value, [], '')}\n`;
  const newline = options.newline ?? '\n';
  return newline === '\n' ? text : text.replace(/\n/g, '\r\n');
}
