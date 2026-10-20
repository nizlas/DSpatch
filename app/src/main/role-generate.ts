/**
 * Turning one provider-neutral role into the file a framework expects.
 *
 * The interesting part of DSP-23 is not the rendering; it is what happens to a
 * requirement the target cannot enforce. Three answers exist and they must stay three:
 * the framework enforces it, something else achieves it, or **nothing does**. The one
 * outcome the task forbids is a generated file that reads as though the requirement
 * holds when it does not, so every requirement produces a notice here — a note when
 * the target enforces it, a warning when it is honoured by other means or unestablished,
 * and an error that stops generation when it cannot be met at all.
 *
 * The capability table is DSP-21's {@link TARGET_CAPABILITIES}, not a second opinion
 * written here. Its Cursor row comes from this repository's own use of Cursor; its
 * Claude Code row comes from Claude Code's documentation and answers only for the file
 * written here (DSP-107); its Copilot row is deliberately unknown, and this module
 * refuses to generate for Copilot rather than emitting a file whose provenance would be
 * a guess.
 *
 * ## Two decisions worth knowing before reading
 *
 * **A generated file names its source and carries a digest.** Both are YAML comments
 * inside the front matter, so the prose a model reads is exactly the role's own words
 * and nothing else. The digest covers everything below those comments, which is what
 * lets {@link inspectGeneratedFile} tell a file nobody has touched from one somebody
 * edited by hand — and a hand edit is reported, never overwritten.
 *
 * **Cursor's file uses CRLF.** Not a platform default: the five live definitions in
 * `.cursor/agents/` use CRLF, and generating LF would rewrite all five files in their
 * entirety the first time anyone ran this. The convention is a stated option with a
 * stated default rather than something inherited from whoever runs the generator.
 * Claude Code's files had no predecessor, so they default to LF.
 */

import { createHash } from 'node:crypto';

import { TARGET_CAPABILITIES, capabilityAnswer } from '../shared/loop-graph';
import type { CapabilityAnswer, LoopTarget, RequirementId, TargetCapabilities } from '../shared/loop-graph';
import { sectionBodies } from './role-source';
import type { RoleSource } from './role-source';

/**
 * What generation has to say about a role, beyond the file itself.
 *
 * `error` stops generation. `warning` does not, and must not be silenced: a role that
 * is only *asked* to avoid subagents is running on an instruction, and the person
 * reading the run needs to know that is what they have.
 */
export interface RoleNotice {
  readonly level: 'error' | 'warning' | 'note';
  readonly message: string;
  readonly requirement?: RequirementId;
}

export interface GeneratedFile {
  /** Where this target keeps the file, relative to the project root. */
  readonly path: string;
  readonly text: string;
  /** The digest recorded inside the file, over everything below the provenance comments. */
  readonly digest: string;
}

export type GenerateResult =
  | { readonly ok: true; readonly file: GeneratedFile; readonly notices: readonly RoleNotice[] }
  | { readonly ok: false; readonly notices: readonly RoleNotice[] };

export interface GenerateOptions {
  /** Where the source file lives, relative to the project root, for the provenance line. */
  readonly sourcePath: string;
  /** Defaults to CRLF for Cursor and LF for Claude Code; see the note at the top of this file. */
  readonly newline?: '\r\n' | '\n';
  /** Injectable so a test can state a capability table instead of depending on today's. */
  readonly capabilities?: TargetCapabilities;
}

/**
 * Generate the file one target expects.
 *
 * Refuses, rather than approximating, in three situations: the role does not declare
 * the target, nothing here can emit for the target, or the target cannot meet a
 * requirement the role states.
 */
export function generateRoleFile(
  source: RoleSource,
  target: LoopTarget,
  options: GenerateOptions,
): GenerateResult {
  const notices: RoleNotice[] = [];

  if (!source.targets.includes(target)) {
    return {
      ok: false,
      notices: [
        {
          level: 'error',
          message:
            `\`${source.id}\` does not declare \`${target}\` as a target (it declares ` +
            `${source.targets.join(', ')}). Generating for an undeclared target would be a guess ` +
            'at content nobody has written, so it is refused. Add the target to the source when the ' +
            'role has actually been considered for it.',
        },
      ],
    };
  }

  const table = options.capabilities ?? TARGET_CAPABILITIES;
  for (const requirement of source.requirements) {
    // This module writes the framework's own agent definition, so the mechanisms in that
    // file are the ones in play — `readonly: true` really does enforce `no-file-writes`
    // for an agent Cursor starts from it. A run DSpatch walks itself loads no such file
    // and is answered separately; see `CapabilityPath`.
    const answer = capabilityAnswer(target, requirement.id, 'generated-agent-file', table);
    notices.push(requirementNotice(target, requirement.id, answer));
  }
  if (notices.some((notice) => notice.level === 'error')) {
    return { ok: false, notices };
  }

  if (target === 'cursor') {
    const newline = options.newline ?? '\r\n';
    return { ok: true, file: renderCursorFile(source, options.sourcePath, newline), notices };
  }
  if (target === 'claude-code') {
    notices.push(...claudeCodeLimits(source));
    const newline = options.newline ?? '\n';
    return { ok: true, file: renderClaudeCodeFile(source, options.sourcePath, newline), notices };
  }

  notices.push({
    level: 'error',
    message:
      `No emitter exists for \`${target}\`. It is on the map because the format has to be ` +
      'honest about more than one framework, but nothing has been run against it from this ' +
      'repository — whatever we believe about its role files is documentation somebody read, ' +
      'not behaviour anybody saw. Writing a file from that would be the degraded output DSP-23 ' +
      'forbids.',
  });
  return { ok: false, notices };
}

/** The targets {@link generateRoleFile} can write a file for. */
export const EMITTED_TARGETS: readonly LoopTarget[] = ['cursor', 'claude-code'];

/** How a target's answer to a requirement reads in a report. */
function requirementNotice(
  target: LoopTarget,
  requirement: RequirementId,
  answer: CapabilityAnswer,
): RoleNotice {
  const evidence =
    answer.evidence === 'observed'
      ? 'observed here'
      : answer.evidence === 'documentation'
        ? 'documentation only'
        : 'nothing established';
  switch (answer.status) {
    case 'enforced':
      return {
        level: 'note',
        requirement,
        message: `${requirement}: enforced by ${target} — ${answer.how} (${evidence})`,
      };
    case 'other-means':
      return {
        level: 'warning',
        requirement,
        message:
          `${requirement}: ${target} does not enforce it. Achieved another way — ${answer.how} ` +
          `(${evidence}) The generated file states the requirement as an instruction; it is not a ` +
          'restriction the platform applies.',
      };
    case 'unknown':
      return {
        level: 'warning',
        requirement,
        message:
          `${requirement}: whether ${target} can meet it is unestablished — ${answer.how} ` +
          `(${evidence}) Treat the requirement as unmet until someone runs it.`,
      };
    case 'unmet':
      return {
        level: 'error',
        requirement,
        message:
          `${requirement}: ${target} cannot meet it — ${answer.how} (${evidence}) Generation is ` +
          'refused; a file that omitted this would read as though the requirement held.',
      };
  }
}

// --- Cursor -----------------------------------------------------------------

/** Where Cursor keeps a project agent. */
export function cursorAgentPath(id: string): string {
  return `.cursor/agents/${id}.md`;
}

/**
 * Cursor's project-agent file.
 *
 * The field order is the order the five hand-written definitions already use, so that
 * a regenerated file is comparable to the one it replaces line by line rather than
 * only in meaning. Three fields are *mechanisms answering requirements*, and the
 * mapping is the whole of DSP-23's rule in four lines of code: `readonly` answers
 * `no-file-writes`, `is_background` answers `background-execution`, and `model`
 * answers `fixed-model-selection`. Where the role states no such requirement, the
 * field carries Cursor's own way of saying *no constraint*: `false`, `false` and
 * `inherit`. `inherit` is not a fixed-model requirement met — it is the absence of one.
 */
function renderCursorFile(source: RoleSource, sourcePath: string, newline: string): GeneratedFile {
  const required = new Map(source.requirements.map((requirement) => [requirement.id, requirement]));
  const fields = [
    `name: ${source.id}`,
    `description: "${source.summary}"`,
    `model: ${required.get('fixed-model-selection')?.value ?? 'inherit'}`,
    `readonly: ${String(required.has('no-file-writes'))}`,
    `is_background: ${String(required.has('background-execution'))}`,
  ];

  const blocks = source.targetBlocks
    .filter((block) => block.target === 'cursor')
    .map((block) => block.body);

  const belowProvenance = [
    ...fields,
    '---',
    '',
    `# ${source.title}`,
    '',
    ...interleave([...sectionBodies(source), ...blocks]),
    '',
  ].join(newline);

  const digest = digestOf(belowProvenance);
  const text = ['---', ...provenanceComments(sourcePath, digest), belowProvenance].join(newline);
  return { path: cursorAgentPath(source.id), text, digest };
}

// --- Claude Code --------------------------------------------------------------

/** Where Claude Code keeps a project sub-agent. */
export function claudeCodeAgentPath(id: string): string {
  return `.claude/agents/${id}.md`;
}

/** Reading and searching the project and the web; nothing that changes anything. */
const CLAUDE_READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'] as const;
/** What a role that changes files needs on top: editing, writing and a shell. */
const CLAUDE_WRITE_TOOLS = ['Edit', 'Write', 'Bash'] as const;
/** The tools through which a Claude Code agent starts other agents or loads skills. */
const CLAUDE_DELEGATION_TOOLS = ['Agent', 'Skill'] as const;

/**
 * The `tools` allowlist, which is the mechanism behind three requirements at once.
 *
 * It is always written. Claude Code gives a sub-agent with no `tools` field every tool
 * it has, `Agent` included, so leaving the field out would quietly grant delegation to
 * a role that forbids it. `no-file-writes` drops the writing tools *and the shell*:
 * Claude Code cannot hand an agent a shell that only reads, so a read-only role here
 * cannot run `git diff` either, and {@link claudeCodeLimits} says so.
 */
export function claudeCodeTools(source: RoleSource): readonly string[] {
  const required = new Set(source.requirements.map((requirement) => requirement.id));
  return [
    ...CLAUDE_READ_TOOLS,
    ...(required.has('no-file-writes') ? [] : CLAUDE_WRITE_TOOLS),
    ...(required.has('no-subagent-delegation') ? [] : CLAUDE_DELEGATION_TOOLS),
  ];
}

/**
 * What the Claude Code file cannot say, reported alongside the per-requirement notices.
 *
 * Both are true of every role that has them, and both would otherwise be invisible: the
 * file lists the tools it grants, not the guarantees those tools fail to give.
 */
function claudeCodeLimits(source: RoleSource): readonly RoleNotice[] {
  const required = new Set(source.requirements.map((requirement) => requirement.id));
  if (required.has('no-file-writes')) {
    return [
      {
        level: 'warning',
        requirement: 'no-file-writes',
        message:
          'claude-code: read-only is achieved by granting no shell at all, so this role cannot ' +
          'run any command, read-only ones such as `git diff` or `scripts/loop_snapshot.py` ' +
          'included. Material it needs from a command must be supplied by the coordinator.',
      },
    ];
  }
  return [
    {
      level: 'warning',
      message:
        'claude-code: this role gets Edit, Write and Bash without a path limit. Any narrower ' +
        'write scope in its prose is an instruction, not a restriction. Bash can also start ' +
        'any program, another agent CLI included, so leaving `Agent` out of the allowlist ' +
        'closes the delegation tool and not every route to delegation.',
    },
  ];
}

/**
 * Claude Code's project sub-agent file.
 *
 * Fields in the order Claude Code's documentation lists them. `model` is written as
 * `inherit` when the role fixes none, for the same reason Cursor's file says so: an
 * absent field would let Claude Code choose by its own order, which is a decision, not
 * the absence of one. `background` is written only when the role requires it, because
 * `false` is not a value Claude Code documents for it.
 */
function renderClaudeCodeFile(source: RoleSource, sourcePath: string, newline: string): GeneratedFile {
  const required = new Map(source.requirements.map((requirement) => [requirement.id, requirement]));
  const fields = [
    `name: ${source.id}`,
    `description: "${source.summary}"`,
    `tools: ${claudeCodeTools(source).join(', ')}`,
    `model: ${required.get('fixed-model-selection')?.value ?? 'inherit'}`,
    ...(required.has('background-execution') ? ['background: true'] : []),
  ];

  const blocks = source.targetBlocks
    .filter((block) => block.target === 'claude-code')
    .map((block) => block.body);

  const belowProvenance = [
    ...fields,
    '---',
    '',
    `# ${source.title}`,
    '',
    ...interleave([...sectionBodies(source), ...blocks]),
    '',
  ].join(newline);

  const digest = digestOf(belowProvenance);
  const text = ['---', ...provenanceComments(sourcePath, digest), belowProvenance].join(newline);
  return { path: claudeCodeAgentPath(source.id), text, digest };
}

/**
 * Prose blocks separated by one blank line, which is what Markdown paragraphs are.
 *
 * Blocks are split back into lines here rather than emitted as multi-line strings, so
 * that the caller's newline convention applies inside a block as well as between them.
 * A file that used CRLF between paragraphs and LF within one would look right in an
 * editor and differ from the original on every line of every long section.
 */
function interleave(blocks: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block === '') {
      continue;
    }
    if (out.length > 0) {
      out.push('');
    }
    out.push(...block.split('\n'));
  }
  return out;
}

// --- Provenance and hand edits ----------------------------------------------

const PROVENANCE_MARK = 'GENERATED FILE';

function provenanceComments(sourcePath: string, digest: string): readonly string[] {
  return [
    `# ${PROVENANCE_MARK} — do not edit. Written from ${sourcePath} (DSP-23).`,
    '# Regenerate from app/ with `npm run roles:generate`. Everything below these comment',
    '# lines is covered by the digest, so a hand edit is reported rather than overwritten.',
    `# digest: sha256:${digest}`,
  ];
}

/**
 * The digest, over line-ending-normalised text.
 *
 * Normalising means a file that travelled through a tool that rewrote CRLF to LF is
 * still recognised as untouched. A checkout convention is not a hand edit, and
 * reporting it as one would train people to ignore the warning that matters.
 */
function digestOf(belowProvenance: string): string {
  return createHash('sha256').update(belowProvenance.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export type ExistingFile =
  /** No such file. Writing one is not an overwrite. */
  | { readonly kind: 'absent' }
  /** Written by this generator and unchanged since. Safe to replace. */
  | { readonly kind: 'generated'; readonly sourcePath: string; readonly digest: string }
  /** Written by this generator and changed since. The edit is the finding. */
  | { readonly kind: 'hand-edited'; readonly sourcePath: string; readonly recordedDigest: string; readonly actualDigest: string }
  /** No provenance at all — somebody else's file, or the hand-written original. */
  | { readonly kind: 'foreign' };

/**
 * Read what a file on disk claims about itself.
 *
 * This is the answer to "is it safe to write here", and it has to be answered from the
 * file rather than from a manifest beside it: a manifest is one more thing that can be
 * stale, and the five files this replaces were hand-written with no manifest at all.
 * They come back `foreign`, which is correct — replacing them is a decision a person
 * makes once, not something a re-run does quietly.
 */
export function inspectGeneratedFile(text: string | null): ExistingFile {
  if (text === null) {
    return { kind: 'absent' };
  }
  const normalised = text.replace(/^\uFEFF/, '');
  const lines = normalised.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { kind: 'foreign' };
  }
  const comments: string[] = [];
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!line.startsWith('#')) {
      break;
    }
    comments.push(line);
  }
  const joined = comments.join('\n');
  if (!joined.includes(PROVENANCE_MARK)) {
    return { kind: 'foreign' };
  }
  const sourceMatch = /Written from (\S+)/.exec(joined);
  const digestMatch = /digest:\s*sha256:([0-9a-f]{64})/.exec(joined);
  if (!sourceMatch || !digestMatch) {
    return { kind: 'foreign' };
  }
  const sourcePath = sourceMatch[1] as string;
  const recordedDigest = digestMatch[1] as string;

  // The same slice the generator hashed: everything after the provenance comments,
  // with the file's own line endings preserved and then normalised by digestOf.
  const remainder = keepNewlines(normalised, index);
  const actualDigest = digestOf(remainder);
  if (actualDigest !== recordedDigest) {
    return { kind: 'hand-edited', sourcePath, recordedDigest, actualDigest };
  }
  return { kind: 'generated', sourcePath, digest: recordedDigest };
}

/** Everything from line `index` onwards, with the original line endings intact. */
function keepNewlines(text: string, index: number): string {
  const parts = text.split(/(\r\n|\n)/);
  // `parts` alternates content and separator, so line `index` starts at `index * 2`.
  return parts.slice(index * 2).join('');
}

/**
 * Whether a generated file may replace what is there, and why not when it may not.
 *
 * `--force` exists on the command line for the one case a person has decided about:
 * the hand-written originals. It does not exist for a hand-edited generated file,
 * because that edit is somebody's work and losing it silently is the failure this
 * whole mechanism is for.
 */
export function writeDecision(
  existing: ExistingFile,
  options: { readonly force: boolean } = { force: false },
): { readonly write: boolean; readonly reason: string } {
  switch (existing.kind) {
    case 'absent':
      return { write: true, reason: 'no file there yet' };
    case 'generated':
      return { write: true, reason: 'generated and unchanged since' };
    case 'hand-edited':
      return {
        write: false,
        reason:
          `edited by hand after generation (recorded sha256:${existing.recordedDigest.slice(0, 16)}, ` +
          `found sha256:${existing.actualDigest.slice(0, 16)}). Move the edit into ` +
          `${existing.sourcePath} first; regeneration will not overwrite it.`,
      };
    case 'foreign':
      return options.force
        ? { write: true, reason: 'no provenance, replaced because --force was given' }
        : {
            write: false,
            reason:
              'no provenance header, so this generator did not write it — the hand-written ' +
              'original, or somebody else\'s file. Replacing it is a decision: re-run with --force.',
          };
  }
}

export function formatNotices(notices: readonly RoleNotice[]): string {
  return notices
    .map((notice) => `  ${notice.level === 'error' ? 'ERROR' : notice.level === 'warning' ? 'WARN ' : 'note '} ${notice.message}`)
    .join('\n');
}
