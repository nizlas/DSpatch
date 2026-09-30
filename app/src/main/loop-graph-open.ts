/**
 * What the editor is given when it opens something, and which of two things it opened.
 *
 * Before DSP-82 the editor could open exactly one kind of file — a `.graph.json`,
 * resolved against DSpatch's own working copy. That anchor is wrong for every drawing
 * that is not DSpatch's: a definition declares its own resource root, and a graph
 * carried from elsewhere looked for its roles inside this repository and found nothing.
 * So a definition opened here does not get a second reading of its own. It goes through
 * {@link ChosenLoopOutcome} — the value `openChosenLoop` returns and a run walks — and
 * the roles the editor draws come from **that value's** `resolveRole`.
 *
 * That is the whole of the reuse claim, and it is structural rather than promised:
 * {@link openedFromDefinition} cannot resolve a role at all except through the resolver
 * it was handed, because it has no filesystem of its own and no root to anchor one at.
 * A second parser reintroduced beside it would have to build its own resolver, and the
 * test that opens a definition rooted outside this repository would see the difference.
 *
 * The two kinds are told apart by what the file says it is, not by what it is called.
 * `.loop.json` is the convention discovery reads; a person choosing a file in a dialog
 * can point at anything, and `format` is the field that answers.
 */

import path from 'node:path';

import type { LoopGraphOpenOutcome, ResolvedRoleEntry } from '../shared/bridge';
import { LOOP_DEFINITION_FORMAT } from '../shared/loop-definition';
import { roleKey } from '../shared/loop-graph-editing';
import { detectNewline } from '../shared/loop-graph-write';
import type { RoleReference, RoleResolver } from '../shared/loop-graph';
import type { ChosenLoopOutcome } from './loop-definition-choice';

/**
 * A graph's role references, resolved once, keyed the way the renderer indexes them.
 *
 * Shared by the editor's `resolveLoopRoles` handler and by the announcement a run
 * makes about itself, because those have to agree. A run that announced its drawing
 * without its bindings is what made a graph view refuse to draw the loop it was
 * watching: the roles existed, had already been resolved in order to run the graph,
 * and simply never travelled — see `LiveRunAnnouncement.roles`.
 */
export function resolvedRolesWith(
  references: readonly RoleReference[],
  resolve: RoleResolver,
): readonly ResolvedRoleEntry[] {
  const seen = new Map<string, ResolvedRoleEntry>();
  for (const reference of references) {
    const key = roleKey(reference);
    if (!seen.has(key)) {
      seen.set(key, { key, role: resolve(reference) });
    }
  }
  return [...seen.values()];
}

/**
 * The role references in a graph file, read without validating it.
 *
 * An invalid graph still needs its roles resolved: the editor draws what it can and
 * the findings say what is wrong, and a broken reference is one of the things it must
 * be able to show. So this reads the shape rather than trusting it.
 */
export function referencedRoles(text: string): readonly RoleReference[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const nodes = (parsed as { readonly nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  const found: RoleReference[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const role = (node as { readonly role?: unknown }).role;
    if (typeof role !== 'object' || role === null) {
      continue;
    }
    const id = (role as { readonly id?: unknown }).id;
    const source = (role as { readonly source?: unknown }).source;
    if (typeof id !== 'string' || typeof source !== 'object' || source === null) {
      continue;
    }
    const kind = (source as { readonly kind?: unknown }).kind;
    const sourcePath = (source as { readonly path?: unknown }).path;
    if (typeof kind !== 'string' || typeof sourcePath !== 'string') {
      continue;
    }
    found.push({ id, source: { kind: kind as RoleReference['source']['kind'], path: sourcePath } });
  }
  return found;
}

/**
 * Whether this text declares itself a loop definition.
 *
 * By `format`, not by extension. A person picking a file in a dialog can point at
 * anything, and the two file kinds are both JSON: the declaration says what it is in
 * its first field, and that field is what every other reader of it already trusts.
 * Anything that is not a declaration — including text that is not JSON at all — is
 * handled as a graph, which is where the loader's own findings say what is wrong.
 */
export function isLoopDefinitionText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  return (parsed as Record<string, unknown>)['format'] === LOOP_DEFINITION_FORMAT;
}

/**
 * The graph a definition points at, as the editor's open outcome.
 *
 * Everything here comes out of the chosen loop and nothing is re-read. In particular:
 *
 * - `path` is the **graph's** path, because `path` is what a later save writes to. A
 *   save must land on the drawing, never on the declaration that names it.
 * - `newline` is detected in the graph's own text for the same reason. Reading it from
 *   the declaration would let a save rewrite every line of a file whose line endings
 *   were never looked at.
 * - `roles` are resolved by the chosen loop's resolver, anchored at the definition's
 *   resource root. This is the defect DSP-82 closes.
 */
export function openedFromDefinition(outcome: ChosenLoopOutcome): LoopGraphOpenOutcome {
  if (!outcome.ok) {
    return { kind: 'unavailable', note: outcome.note };
  }
  const chosen = outcome.chosen;
  return {
    kind: 'read',
    path: chosen.graphPath,
    displayPath: path.relative(chosen.resourceRoot, chosen.graphPath) || chosen.graphPath,
    text: chosen.graphText,
    newline: detectNewline(chosen.graphText),
    projectRoot: chosen.resourceRoot,
    roles: resolvedRolesWith(referencedRoles(chosen.graphText), chosen.resolveRole),
    definition: {
      id: chosen.definitionId,
      name: chosen.definitionName,
      path: chosen.definitionPath,
    },
  };
}

/**
 * A graph file opened directly, with no declaration behind it.
 *
 * Unchanged behaviour from before DSP-82, kept as its own function so the other path
 * cannot quietly borrow its anchor. There is no `definition` field: a graph opened this
 * way is a graph opened this way, and the window says so rather than presenting it as a
 * loop whose name nobody knows.
 */
export function openedFromGraphFile(input: {
  readonly path: string;
  readonly text: string;
  /** Where role paths are measured from. DSpatch's own copy, or the file's folder. */
  readonly projectRoot: string;
  readonly resolveRole: RoleResolver | null;
}): LoopGraphOpenOutcome {
  return {
    kind: 'read',
    path: input.path,
    displayPath: path.relative(input.projectRoot, input.path) || input.path,
    text: input.text,
    newline: detectNewline(input.text),
    projectRoot: input.projectRoot,
    // Without a root there is nothing to resolve against, and answering `null` for
    // each would report every role as broken. Unchecked is the honest answer, and the
    // loader reports it as a warning rather than an error.
    roles:
      input.resolveRole === null
        ? []
        : resolvedRolesWith(referencedRoles(input.text), input.resolveRole),
  };
}
