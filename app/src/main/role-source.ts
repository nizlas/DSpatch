/**
 * The provider-neutral form of a role: what a role *is*, before any framework.
 *
 * DSP-23's premise, set with Niclas on 15 September 2026, is that nobody ports a role
 * often — so the goal is not write-once-run-anywhere. The goal is that a role can be
 * *targeted* at a framework and that nothing is quietly lost when it is. This module
 * holds the source form and its parser; `role-generate.ts` turns one into a provider
 * file, and neither touches a filesystem so both can be tested without one.
 *
 * **Requirements are portable; mechanisms are not.** A source says `no-file-writes`.
 * It never says `readonly: true`, which is Cursor's word for it, and the reason this
 * matters is not theoretical: that one field shaped this project's whole delivery
 * contract on 15 September 2026, when a read-only Researcher was asked to write files
 * it cannot write. A source that named the mechanism would be a source that silently
 * claimed enforcement on a framework that has none.
 *
 * The requirement vocabulary is DSP-21's {@link REQUIREMENTS}, imported rather than
 * restated. Two formats that disagreed about what `no-file-writes` means would be
 * worse than one format doing both jobs badly.
 *
 * ## The file
 *
 * A source is Markdown with a small leading field block, prose sections, and optional
 * per-target blocks copied out untranslated:
 *
 * ```
 * ---
 * role: dspatch-researcher
 * title: Researcher
 * summary: "Investigate a bounded uncertainty ... and return evidence for a decision."
 * targets: cursor
 * requires: no-file-writes, no-subagent-delegation
 * ---
 *
 * ## Purpose
 *
 * Answer the specific uncertainty blocking the next step. ...
 *
 * <!-- target: cursor -->
 * anything only Cursor understands, carried through byte for byte
 * <!-- end target -->
 * ```
 *
 * The field block is read as flat scalars on purpose. These are a handful of keys, a
 * YAML parser would be a dependency this project does not otherwise need, and the
 * moment a role needs real structure it belongs in a field of its own rather than in
 * a nested map nobody can diff.
 */

import { LOOP_TARGETS, REQUIREMENTS } from '../shared/loop-graph';
import type { LoopTarget, RequirementId } from '../shared/loop-graph';

/**
 * The sections a role's prose may be divided into.
 *
 * Closed, and in this order, because these are the four things AC#1 asks a source to
 * hold: what the role is for, what it does, what it may not do, and what it owes back.
 * An unrecognised heading is an error rather than a section that travels to one target
 * and is dropped by the next.
 */
export const ROLE_SECTIONS = ['purpose', 'responsibilities', 'boundaries', 'delivery'] as const;
export type RoleSectionId = (typeof ROLE_SECTIONS)[number];

export interface RoleSection {
  readonly id: RoleSectionId;
  /** The prose, verbatim, with the heading line removed and the ends trimmed. */
  readonly body: string;
}

/**
 * A requirement as a role states it, with the parameter it needs when it has one.
 *
 * `fixed-model-selection` is the only one today that means nothing without a value:
 * "must use a particular model" is not a requirement until it names the model. The
 * value is a provider's model identifier and is deliberately not validated here —
 * this module has no way to know which slugs an account can reach.
 */
export interface RoleRequirement {
  readonly id: RequirementId;
  readonly value?: string;
}

/** A block addressed to one target, copied out untouched. */
export interface RoleTargetBlock {
  readonly target: LoopTarget;
  /** Verbatim. No translation is attempted, which is the whole point of it. */
  readonly body: string;
}

export interface RoleSource {
  /** The provider-neutral identity. Cursor happens to use it as the agent name. */
  readonly id: string;
  /** The human title, rendered as the document heading by every target. */
  readonly title: string;
  /** One sentence on what the role is for, short enough for a provider's own summary field. */
  readonly summary: string;
  /**
   * The frameworks this role supports. A role may support exactly one, and Cursor-only
   * is the common and legitimate answer; generating for a target not listed here is
   * refused rather than guessed at.
   */
  readonly targets: readonly LoopTarget[];
  readonly requirements: readonly RoleRequirement[];
  readonly sections: readonly RoleSection[];
  readonly targetBlocks: readonly RoleTargetBlock[];
}

/** What went wrong, in terms of the file the author is looking at. */
export interface RoleSourceProblem {
  readonly message: string;
  /** 1-based, when the problem belongs to a line. */
  readonly line?: number;
}

export type RoleSourceResult =
  | { readonly ok: true; readonly source: RoleSource; readonly problems: readonly [] }
  | { readonly ok: false; readonly problems: readonly RoleSourceProblem[] };

const TARGET_OPEN = /^<!--\s*target:\s*([a-z0-9-]+)\s*-->$/;
const TARGET_CLOSE = /^<!--\s*end target\s*-->$/;
const HEADING = /^##\s+(.+?)\s*$/;

/**
 * Parse a role source.
 *
 * Every problem found is reported, not just the first: an author fixing a source one
 * error per run is an author who stops using the tool.
 */
export function parseRoleSource(text: string): RoleSourceResult {
  const problems: RoleSourceProblem[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  if (lines[0]?.trim() !== '---') {
    return {
      ok: false,
      problems: [{ message: 'A role source must start with a `---` field block.', line: 1 }],
    };
  }
  let cursor = 1;
  const fields = new Map<string, { value: string; line: number }>();
  let closed = false;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] as string;
    if (line.trim() === '---') {
      closed = true;
      cursor += 1;
      break;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      problems.push({ message: `Not a \`key: value\` field: ${line.trim()}`, line: cursor + 1 });
      continue;
    }
    const [, key, rawValue] = match;
    fields.set(key as string, { value: unquote((rawValue as string).trim()), line: cursor + 1 });
  }
  if (!closed) {
    return {
      ok: false,
      problems: [{ message: 'The `---` field block was never closed.', line: 1 }],
    };
  }

  const sections: RoleSection[] = [];
  const targetBlocks: RoleTargetBlock[] = [];
  let currentSection: { id: RoleSectionId; lines: string[] } | null = null;
  /** Set while inside a target block, so its contents are never read as prose. */
  let currentBlock: { target: LoopTarget; lines: string[]; line: number } | null = null;

  const flushSection = (): void => {
    if (currentSection) {
      sections.push({ id: currentSection.id, body: trimBlank(currentSection.lines).join('\n') });
      currentSection = null;
    }
  };

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] as string;
    const lineNumber = cursor + 1;

    if (currentBlock) {
      if (TARGET_CLOSE.test(line.trim())) {
        targetBlocks.push({
          target: currentBlock.target,
          body: trimBlank(currentBlock.lines).join('\n'),
        });
        currentBlock = null;
      } else {
        currentBlock.lines.push(line);
      }
      continue;
    }

    const opening = TARGET_OPEN.exec(line.trim());
    if (opening) {
      flushSection();
      const named = opening[1] as string;
      if (!isTarget(named)) {
        problems.push({
          message: `Unknown target \`${named}\` in a target block. Known targets: ${LOOP_TARGETS.join(', ')}.`,
          line: lineNumber,
        });
        // Consume the block anyway so its contents are not read as prose.
        currentBlock = { target: 'cursor', lines: [], line: lineNumber };
        continue;
      }
      currentBlock = { target: named, lines: [], line: lineNumber };
      continue;
    }
    if (TARGET_CLOSE.test(line.trim())) {
      problems.push({ message: 'A target block was closed without being opened.', line: lineNumber });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushSection();
      const named = (heading[1] as string).toLowerCase();
      if (!isSection(named)) {
        problems.push({
          message: `Unknown section \`${heading[1] as string}\`. A role source has: ${ROLE_SECTIONS.join(', ')}.`,
          line: lineNumber,
        });
        continue;
      }
      if (sections.some((section) => section.id === named)) {
        problems.push({ message: `Section \`${named}\` appears twice.`, line: lineNumber });
        continue;
      }
      currentSection = { id: named, lines: [] };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else if (line.trim() !== '') {
      problems.push({
        message: `Prose outside any section: ${line.trim().slice(0, 60)}`,
        line: lineNumber,
      });
    }
  }
  flushSection();
  if (currentBlock) {
    problems.push({
      message: `The \`${currentBlock.target}\` target block was never closed.`,
      line: currentBlock.line,
    });
  }

  const id = fields.get('role')?.value ?? '';
  const title = fields.get('title')?.value ?? '';
  const summary = fields.get('summary')?.value ?? '';
  if (id === '') {
    problems.push({ message: 'Missing `role`, the provider-neutral identity.' });
  }
  if (title === '') {
    problems.push({ message: 'Missing `title`, the heading a target renders.' });
  }
  if (summary === '') {
    problems.push({ message: 'Missing `summary`, one sentence on what the role is for.' });
  }

  const targetsField = fields.get('targets');
  const targets: LoopTarget[] = [];
  for (const name of splitList(targetsField?.value ?? '')) {
    if (!isTarget(name)) {
      problems.push({
        message: `Unknown target \`${name}\`. Known targets: ${LOOP_TARGETS.join(', ')}.`,
        ...(targetsField ? { line: targetsField.line } : {}),
      });
      continue;
    }
    if (!targets.includes(name)) {
      targets.push(name);
    }
  }
  if (targets.length === 0) {
    problems.push({
      message: 'Missing `targets`. A role must declare the frameworks it supports; one is enough.',
      ...(targetsField ? { line: targetsField.line } : {}),
    });
  }

  const requiresField = fields.get('requires');
  const requirements: RoleRequirement[] = [];
  for (const entry of splitList(requiresField?.value ?? '')) {
    const [name, ...rest] = entry.split('=');
    const trimmed = (name as string).trim();
    if (!isRequirement(trimmed)) {
      problems.push({
        message: `Unknown requirement \`${trimmed}\`. Known requirements: ${REQUIREMENTS.join(', ')}.`,
        ...(requiresField ? { line: requiresField.line } : {}),
      });
      continue;
    }
    const value = rest.join('=').trim();
    if (requirements.some((requirement) => requirement.id === trimmed)) {
      problems.push({
        message: `Requirement \`${trimmed}\` is stated twice.`,
        ...(requiresField ? { line: requiresField.line } : {}),
      });
      continue;
    }
    if (trimmed === 'fixed-model-selection' && value === '') {
      problems.push({
        message:
          '`fixed-model-selection` must name the model, as `fixed-model-selection=<slug>`. ' +
          '"Must use a particular model" is not a requirement until it says which.',
        ...(requiresField ? { line: requiresField.line } : {}),
      });
      continue;
    }
    requirements.push({ id: trimmed, ...(value === '' ? {} : { value }) });
  }

  for (const block of targetBlocks) {
    if (!targets.includes(block.target)) {
      problems.push({
        message:
          `There is a \`${block.target}\` block, but \`${block.target}\` is not in \`targets\`. ` +
          'A block for an undeclared target would never be generated and reads as though it would be.',
      });
    }
  }

  if (sections.length === 0) {
    problems.push({ message: 'A role source has no prose. At least `## Purpose` is required.' });
  } else if (!sections.some((section) => section.id === 'purpose')) {
    problems.push({ message: 'Missing `## Purpose`.' });
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    problems: [],
    source: { id, title, summary, targets, requirements, sections, targetBlocks },
  };
}

/** The portable prose, in the order the source declares it. */
export function sectionBodies(source: RoleSource): readonly string[] {
  return source.sections.map((section) => section.body);
}

export function formatRoleSourceProblems(problems: readonly RoleSourceProblem[]): string {
  return problems
    .map((problem) => (problem.line === undefined ? `- ${problem.message}` : `- line ${String(problem.line)}: ${problem.message}`))
    .join('\n');
}

function isTarget(value: string): value is LoopTarget {
  return (LOOP_TARGETS as readonly string[]).includes(value);
}

function isRequirement(value: string): value is RequirementId {
  return (REQUIREMENTS as readonly string[]).includes(value);
}

function isSection(value: string): value is RoleSectionId {
  return (ROLE_SECTIONS as readonly string[]).includes(value);
}

function splitList(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function trimBlank(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] as string).trim() === '') {
    start += 1;
  }
  while (end > start && (lines[end - 1] as string).trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}


function unquote(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0] as string;
    if (value.endsWith(quote)) {
      return value.slice(1, -1);
    }
  }
  return value;
}
