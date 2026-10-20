/**
 * The role source form, and the four ways generation is supposed to refuse.
 *
 * The rendering is the easy half and the tests below spend little time on it. What can
 * fail invisibly is the *honesty*: a file that reads as though a requirement is enforced
 * when the target has no way to enforce it. That is the one outcome DSP-23 forbids, so
 * most of this file is about requirements the target cannot meet, targets the role never
 * declared, targets nobody has run, and a hand edit that must not be overwritten.
 *
 *     node --test tests/role-generate.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  claudeCodeAgentPath,
  claudeCodeTools,
  cursorAgentPath,
  generateRoleFile,
  inspectGeneratedFile,
  writeDecision,
} from '../src/main/role-generate.ts';
import { parseRoleSource } from '../src/main/role-source.ts';
import { REQUIREMENTS, capabilityAnswer } from '../src/shared/loop-graph.ts';
import type { TargetCapabilities } from '../src/shared/loop-graph.ts';

const SOURCE = [
  '---',
  'role: probe-role',
  'title: Probe',
  'summary: "One sentence on what it is for."',
  'targets: cursor',
  'requires: no-file-writes',
  '---',
  '',
  '## Purpose',
  '',
  'Answer the question.',
  '',
  '## Delivery',
  '',
  'Return the answer.',
  '',
].join('\n');

function parsed(text: string = SOURCE) {
  const result = parseRoleSource(text);
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.problems, null, 2));
  assert.ok(result.ok);
  return result.source;
}

function generate(text: string = SOURCE, target: 'cursor' | 'copilot' | 'claude-code' = 'cursor') {
  return generateRoleFile(parsed(text), target, { sourcePath: 'docs/loop/roles/probe-role.role.md' });
}

// --- The source holds requirements, and the target supplies the mechanism ----

test('a requirement Cursor enforces becomes the Cursor field, and the source never names it', () => {
  assert.ok(!SOURCE.includes('readonly'), 'the source must not name the mechanism');
  const result = generate();
  assert.ok(result.ok);
  assert.match(result.file.text, /^readonly: true$/m);
  assert.match(result.file.text, /^model: inherit$/m);
  assert.match(result.file.text, /^is_background: false$/m);
  assert.equal(result.file.path, cursorAgentPath('probe-role'));
  // Enforced natively, so it is a note rather than a warning — but it is still said.
  const answer = result.notices.find((notice) => notice.requirement === 'no-file-writes');
  assert.equal(answer?.level, 'note');
  assert.match(answer?.message ?? '', /enforced by cursor/);

  // DSP-96 part 2, and the direction that is easy to break while fixing the other one.
  // `readonly: true` is a real restriction **for an agent Cursor starts from this file**,
  // and correcting what a run DSpatch walks says about itself must not make this false.
  // The two paths are asked separately and answer differently on purpose.
  assert.equal(capabilityAnswer('cursor', 'no-file-writes', 'generated-agent-file').status, 'enforced');
  assert.equal(capabilityAnswer('cursor', 'no-file-writes', 'dspatch-walked-run').status, 'other-means');
});

test('a role stating no requirement gets Cursor\u2019s way of saying "no constraint"', () => {
  const result = generate(SOURCE.replace('requires: no-file-writes\n', ''));
  assert.ok(result.ok);
  assert.match(result.file.text, /^readonly: false$/m);
  assert.match(result.file.text, /^model: inherit$/m);
  assert.equal(result.notices.length, 0);
});

test('`model: inherit` is the absence of a fixed-model requirement, not one that was met', () => {
  const withModel = generate(
    SOURCE.replace('requires: no-file-writes', 'requires: fixed-model-selection=claude-opus-5-thinking-high'),
  );
  assert.ok(withModel.ok);
  assert.match(withModel.file.text, /^model: claude-opus-5-thinking-high$/m);

  const missingValue = parseRoleSource(SOURCE.replace('requires: no-file-writes', 'requires: fixed-model-selection'));
  assert.equal(missingValue.ok, false);
  assert.ok(!missingValue.ok);
  assert.match(missingValue.problems[0]?.message ?? '', /must name the model/);
});

test('a requirement the target only honours by instruction warns and names the requirement', () => {
  const result = generate(SOURCE.replace('requires: no-file-writes', 'requires: no-subagent-delegation'));
  assert.ok(result.ok, 'other means is not a refusal');
  const warning = result.notices.find((notice) => notice.requirement === 'no-subagent-delegation');
  assert.equal(warning?.level, 'warning');
  assert.match(warning?.message ?? '', /does not enforce it/);
  // And nothing in the file may suggest the platform is applying it.
  assert.ok(!/subagent/i.test(result.file.text.split('---')[2] ?? ''));
});

test('a requirement nobody has established here warns rather than passing', () => {
  const result = generate(SOURCE.replace('requires: no-file-writes', 'requires: tool-restriction'));
  assert.ok(result.ok);
  const warning = result.notices.find((notice) => notice.requirement === 'tool-restriction');
  assert.equal(warning?.level, 'warning');
  assert.match(warning?.message ?? '', /unestablished|until someone runs it/);
});

test('a requirement the target cannot meet stops generation and says which requirement', () => {
  // Stated here rather than taken from today's table: the point is the *handling* of
  // `unmet`, and a table change must not be able to silently delete this test's subject.
  const cannot: TargetCapabilities = {
    cursor: {
      'no-file-writes': {
        status: 'unmet',
        how: 'this hypothetical Cursor has no read-only mode.',
        evidence: 'documentation',
      },
      'background-execution': { status: 'enforced', how: 'x', evidence: 'observed' },
      'fixed-model-selection': { status: 'enforced', how: 'x', evidence: 'observed' },
      'no-subagent-delegation': { status: 'enforced', how: 'x', evidence: 'observed' },
      'tool-restriction': { status: 'enforced', how: 'x', evidence: 'observed' },
    },
    copilot: {
      'no-file-writes': { status: 'unknown', how: 'x', evidence: 'none' },
      'background-execution': { status: 'unknown', how: 'x', evidence: 'none' },
      'fixed-model-selection': { status: 'unknown', how: 'x', evidence: 'none' },
      'no-subagent-delegation': { status: 'unknown', how: 'x', evidence: 'none' },
      'tool-restriction': { status: 'unknown', how: 'x', evidence: 'none' },
    },
    'claude-code': {
      'no-file-writes': { status: 'unknown', how: 'x', evidence: 'none' },
      'background-execution': { status: 'unknown', how: 'x', evidence: 'none' },
      'fixed-model-selection': { status: 'unknown', how: 'x', evidence: 'none' },
      'no-subagent-delegation': { status: 'unknown', how: 'x', evidence: 'none' },
      'tool-restriction': { status: 'unknown', how: 'x', evidence: 'none' },
    },
  };
  const result = generateRoleFile(parsed(), 'cursor', {
    sourcePath: 'docs/loop/roles/probe-role.role.md',
    capabilities: cannot,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  const error = result.notices.find((notice) => notice.level === 'error');
  assert.match(error?.message ?? '', /no-file-writes/);
  assert.match(error?.message ?? '', /cannot meet it/);
});

// --- Targets ----------------------------------------------------------------

test('generating for a target the role does not declare is refused, not attempted', () => {
  const result = generate(SOURCE, 'copilot');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.notices[0]?.message ?? '', /does not declare `copilot`/);
});

test('a declared target with no emitter is refused, and says what we actually know about it', () => {
  const result = generate(SOURCE.replace('targets: cursor', 'targets: cursor, copilot'), 'copilot');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  const error = result.notices.find((notice) => notice.level === 'error');
  assert.match(error?.message ?? '', /No emitter exists for `copilot`/);
  assert.match(error?.message ?? '', /documentation somebody read/);
});

// --- Claude Code (DSP-107) ---------------------------------------------------

const CLAUDE_SOURCE = SOURCE.replace('targets: cursor', 'targets: cursor, claude-code').replace(
  'requires: no-file-writes',
  'requires: no-file-writes, no-subagent-delegation',
);

function frontMatterOf(text: string): string {
  return text.replace(/\r\n/g, '\n').split('\n---')[0] ?? '';
}

test('a read-only Claude Code agent gets reading tools only: no writing tool, no shell, no delegation', () => {
  const result = generate(CLAUDE_SOURCE, 'claude-code');
  assert.ok(result.ok);
  assert.equal(result.file.path, claudeCodeAgentPath('probe-role'));
  assert.match(result.file.text, /^tools: Read, Grep, Glob, WebFetch, WebSearch$/m);
  assert.match(result.file.text, /^model: inherit$/m);
  const fields = frontMatterOf(result.file.text);
  for (const tool of ['Edit', 'Write', 'Bash', 'Agent', 'Skill', 'NotebookEdit']) {
    assert.ok(!new RegExp(`\\b${tool}\\b`).test(fields.split('tools:')[1] ?? ''), `${tool} must not be granted`);
  }
  assert.ok(!/^background:/m.test(fields), 'background is written only when required');
  assert.ok(!/^readonly:/m.test(fields), 'Cursor’s field means nothing to Claude Code');
  assert.ok(!/[^\r]\n/.test(result.file.text), 'CRLF throughout, as the checkout writes it');

  // The price of read-only here is said, not left for a run to discover.
  const shell = result.notices.find((notice) => /no shell/.test(notice.message));
  assert.equal(shell?.level, 'warning');
});

test('a Claude Code agent that may write still gets no Agent tool, and its unlimited write scope is reported', () => {
  const result = generate(
    CLAUDE_SOURCE.replace('requires: no-file-writes, no-subagent-delegation', 'requires: no-subagent-delegation'),
    'claude-code',
  );
  assert.ok(result.ok);
  assert.match(result.file.text, /^tools: Read, Grep, Glob, WebFetch, WebSearch, Edit, Write, Bash$/m);
  const scope = result.notices.find((notice) => /without a path limit/.test(notice.message));
  assert.equal(scope?.level, 'warning');
  assert.match(scope?.message ?? '', /not every route to delegation/);
});

test('the tools field is always written, because leaving it out would grant Agent', () => {
  const result = generate(CLAUDE_SOURCE.replace('requires: no-file-writes, no-subagent-delegation\n', ''), 'claude-code');
  assert.ok(result.ok);
  assert.match(result.file.text, /^tools: .*\bAgent\b.*$/m, 'a role that permits delegation is given it explicitly');
  assert.equal(claudeCodeTools(parsed(CLAUDE_SOURCE)).includes('Agent'), false);
});

test('background is written for Claude Code only when the role requires it', () => {
  const result = generate(
    CLAUDE_SOURCE.replace('no-subagent-delegation', 'no-subagent-delegation, background-execution'),
    'claude-code',
  );
  assert.ok(result.ok);
  assert.match(result.file.text, /^background: true$/m);
});

test('a claude-code block reaches the Claude Code file and never the Cursor one', () => {
  const text = `${CLAUDE_SOURCE}\n<!-- target: claude-code -->\nOnly Claude hears this.\n<!-- end target -->\n`;
  const claude = generate(text, 'claude-code');
  const cursor = generate(text, 'cursor');
  assert.ok(claude.ok && cursor.ok);
  assert.ok(claude.file.text.includes('Only Claude hears this.'));
  assert.ok(!cursor.file.text.includes('Only Claude hears this.'));
});

test('generated Claude Code files carry provenance, and a hand edit to the allowlist is caught', () => {
  const result = generate(CLAUDE_SOURCE, 'claude-code');
  assert.ok(result.ok);
  assert.equal(inspectGeneratedFile(result.file.text).kind, 'generated');
  const widened = result.file.text.replace('WebSearch\r\n', 'WebSearch, Bash\r\n');
  assert.notEqual(widened, result.file.text);
  assert.equal(inspectGeneratedFile(widened).kind, 'hand-edited');
});

test('Claude Code answers for the generated file, and stays unknown on the path DSpatch walks', () => {
  for (const requirement of REQUIREMENTS) {
    const file = capabilityAnswer('claude-code', requirement, 'generated-agent-file');
    assert.equal(file.evidence, 'documentation', `${requirement}: read, not run`);
    const walked = capabilityAnswer('claude-code', requirement, 'dspatch-walked-run');
    assert.equal(walked.status, 'unknown', `${requirement}: no Claude Code adapter exists`);
    assert.equal(walked.evidence, 'none');
  }
});

test('a target block for an undeclared target is a source error, not dead prose', () => {
  const result = parseRoleSource(
    `${SOURCE}\n<!-- target: claude-code -->\nsomething\n<!-- end target -->\n`,
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.problems[0]?.message ?? '', /not in `targets`/);
});

test('a per-target block is carried through verbatim, including what the format never heard of', () => {
  const exotic = [
    '<!-- target: cursor -->',
    '## Some heading the format knows nothing about',
    '',
    '    indented block with  double  spaces',
    '| a | table |',
    '<!-- end target -->',
  ].join('\n');
  const result = generate(`${SOURCE}\n${exotic}\n`);
  assert.ok(result.ok);
  const body = result.file.text.replace(/\r\n/g, '\n');
  assert.ok(
    body.includes(
      '## Some heading the format knows nothing about\n\n    indented block with  double  spaces\n| a | table |',
    ),
    body,
  );
});

// --- Regeneration is safe to re-run ------------------------------------------

test('a generated file names its source and is recognised as untouched', () => {
  const result = generate();
  assert.ok(result.ok);
  assert.match(result.file.text, /GENERATED FILE/);
  assert.match(result.file.text, /docs\/loop\/roles\/probe-role\.role\.md/);
  const existing = inspectGeneratedFile(result.file.text);
  assert.equal(existing.kind, 'generated');
  assert.equal(writeDecision(existing).write, true);
});

test('a hand edit to a generated file is detected and refused, naming where to move it', () => {
  const result = generate();
  assert.ok(result.ok);
  const edited = result.file.text.replace('Return the answer.', 'Return the answer, and also do this.');
  const existing = inspectGeneratedFile(edited);
  assert.equal(existing.kind, 'hand-edited');
  const decision = writeDecision(existing, { force: true });
  assert.equal(decision.write, false, '--force must not override somebody\u2019s edit');
  assert.match(decision.reason, /docs\/loop\/roles\/probe-role\.role\.md/);
});

test('changing a front-matter field by hand counts, because that is where the mechanisms are', () => {
  const result = generate();
  assert.ok(result.ok);
  const relaxed = result.file.text.replace('readonly: true', 'readonly: false');
  assert.equal(inspectGeneratedFile(relaxed).kind, 'hand-edited');
});

test('a rewritten line ending is not a hand edit', () => {
  const result = generate();
  assert.ok(result.ok);
  assert.equal(inspectGeneratedFile(result.file.text.replace(/\r\n/g, '\n')).kind, 'generated');
});

test('a file with no provenance is foreign, and replacing it takes a decision', () => {
  const handWritten = '---\nname: dspatch-researcher\nreadonly: true\n---\n\n# Researcher\n\nProse.\n';
  assert.equal(inspectGeneratedFile(handWritten).kind, 'foreign');
  assert.equal(writeDecision(inspectGeneratedFile(handWritten)).write, false);
  assert.equal(writeDecision(inspectGeneratedFile(handWritten), { force: true }).write, true);
  assert.equal(writeDecision(inspectGeneratedFile(null)).write, true);
});

// --- The source form refuses what it cannot carry ----------------------------

test('an unknown section or requirement is an error, not a silently dropped line', () => {
  const unknownSection = parseRoleSource(SOURCE.replace('## Delivery', '## Miscellany'));
  assert.ok(!unknownSection.ok);
  assert.match(unknownSection.problems[0]?.message ?? '', /Unknown section `Miscellany`/);

  const unknownRequirement = parseRoleSource(SOURCE.replace('no-file-writes', 'must-be-nice'));
  assert.ok(!unknownRequirement.ok);
  assert.match(unknownRequirement.problems[0]?.message ?? '', /Unknown requirement `must-be-nice`/);
});

test('a role with no declared target is refused at the source, before any generation', () => {
  const result = parseRoleSource(SOURCE.replace('targets: cursor\n', ''));
  assert.ok(!result.ok);
  assert.match(
    result.problems.map((problem) => problem.message).join('\n'),
    /must declare the frameworks it supports/,
  );
});

test('every problem is reported at once, so an author fixes a source in one pass', () => {
  const broken = parseRoleSource(
    ['---', 'title: Probe', '---', '', 'stray prose', ''].join('\n'),
  );
  assert.ok(!broken.ok);
  assert.ok(broken.problems.length >= 4, JSON.stringify(broken.problems));
});

// --- The five real specialists ----------------------------------------------

/**
 * The claim this whole task rests on: the sources lose nothing.
 *
 * Written so that it holds both before and after Niclas swaps the generated files in.
 * Beforehand the live file is the hand-written original and has no provenance comments;
 * afterwards it has them. Stripping the comments from both sides compares the part that
 * has to survive — every field and every word of prose — and nothing else.
 */
test('each real role source reproduces its live Cursor definition byte for byte', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const sourceDir = path.join(repoRoot, 'docs', 'loop', 'roles');
  const names = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.role.md'));
  assert.equal(names.length, 5, 'the five specialists');

  for (const name of names) {
    const relativeSource = `docs/loop/roles/${name}`;
    const source = parseRoleSource(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
    assert.ok(source.ok, `${name}: ${source.ok ? '' : JSON.stringify(source.problems)}`);
    const result = generateRoleFile(source.source, 'cursor', { sourcePath: relativeSource });
    assert.ok(result.ok, name);
    const live = fs.readFileSync(path.join(repoRoot, result.file.path));
    assert.equal(
      withoutProvenance(result.file.text),
      withoutProvenance(live.toString('utf8')),
      `${result.file.path} differs from what ${relativeSource} generates`,
    );
  }
});

test('each real role source reproduces its Claude Code agent byte for byte', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const sourceDir = path.join(repoRoot, 'docs', 'loop', 'roles');
  const names = fs.readdirSync(sourceDir).filter((name) => name.endsWith('.role.md'));
  assert.equal(names.length, 5, 'the five specialists');

  for (const name of names) {
    const relativeSource = `docs/loop/roles/${name}`;
    const source = parseRoleSource(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
    assert.ok(source.ok, name);
    assert.ok(source.source.targets.includes('claude-code'), `${name} declares claude-code`);
    const result = generateRoleFile(source.source, 'claude-code', { sourcePath: relativeSource });
    assert.ok(result.ok, name);
    const live = fs.readFileSync(path.join(repoRoot, result.file.path), 'utf8');
    assert.equal(result.file.text, live, `${result.file.path} differs from what ${relativeSource} generates`);
    assert.ok(!/^tools: .*\bAgent\b/m.test(live), `${result.file.path} must not be able to delegate`);
  }
});

/** The front matter with its leading comment lines removed, line endings intact. */
function withoutProvenance(text: string): string {
  const lines = text.split(/(\r\n|\n)/);
  if (lines[0] !== '---') {
    return text;
  }
  let index = 1;
  while ((lines[index * 2] ?? '').startsWith('#')) {
    index += 1;
  }
  return [lines[0], lines[1] ?? '', ...lines.slice(index * 2)].join('');
}
