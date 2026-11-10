/**
 * DSP-181: four neutral examples through the whole chain, with the simulated provider. The
 * window's request becomes the prompt the discussion builds; the simulated provider answers it
 * as the presentation sections ask; the window splits the answer at the marker and reads the
 * references. SIMULATED answers verify the interface, the prompt and the data flow, never a
 * real model's teaching: nothing here reaches a model.
 *
 * - a trivial change: short in every profile, nothing behind Show more;
 * - a normal change with a default and a fallback: every profile names them in the base text;
 * - a complex change over several code places: every place reaches the prompt;
 * - a step where Teacher must explain an unfamiliar tool: the prompt asks for the needed concepts.
 *
 * DSP-184: the simulated answers can only show that the instructions reach the prompt and the
 * data flow; whether a model follows them is not shown here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { simulatedReviewTask } from '../src/main/presentation-review-tasks';
import { DETAILS_MARKER, PROFILE_PROMPT_NAMES, PUBLIC_PROFILES, presentationPromptSection, type PublicProfile } from '../src/shared/presentation-profiles';
import { PROVIDER_ADDED_CONTEXT_LINE, buildEnvelopePrompt, splitCodeAnswer, splitDetails, type ContextEnvelope, type EnvelopeRange } from '../src/shared/review-discussion';
import { TASK_HEADER } from '../src/shared/review-task';
import { parseMarkdown } from '../src/shared/markdown';

const BASE = 'b'.repeat(40);
const TARGET = 'c'.repeat(40);

function range(overrides: Partial<EnvelopeRange> = {}): EnvelopeRange {
  return {
    role: 'focus',
    path: 'src/greeting.ts',
    side: 'target',
    sha: TARGET,
    start: 10,
    end: 14,
    lines: ['export function greet(name: string): string {', '  if (name.trim() === "") {', '    return "Hello!";', '  }', '  return `Hello, ${name}!`;'],
    omittedLines: 0,
    problem: null,
    ...overrides,
  };
}

function envelope(stepTitle: string, ranges: readonly EnvelopeRange[] = [range()]): ContextEnvelope {
  return {
    version: 1,
    identity: {
      title: 'Greeting by name',
      definitionPath: 'C:/defs/greeting.review.json',
      definitionHash: 'e'.repeat(64),
      repository: 'C:/work/sample-repo',
      base: { sha: BASE, subject: 'before' },
      target: { sha: TARGET, subject: 'after' },
    },
    language: 'en',
    subject: { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 },
    selection: null,
    explanation: {
      walkNumber: 1,
      walkTitle: 'Greeting a visitor',
      stepTitle,
      summary: 'greet builds the greeting from the name.',
      body: 'The function returns the default when the name is empty.',
      why: 'Every caller gets the same rule.',
      placeLabel: 'greet',
      evidence: [],
    },
    overview: null,
    ranges: [...ranges],
    notes: [],
    providerContext: PROVIDER_ADDED_CONTEXT_LINE,
    builtAt: '2026-11-08T10:00:00.000Z',
  };
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-181-chain-'));

/** The window asks for the step in a profile; the discussion builds the prompt; the simulated provider answers. */
function present(stepTitle: string, profile: PublicProfile, ranges?: readonly EnvelopeRange[]): { readonly prompt: string; readonly short: string; readonly details: string | null; readonly references: unknown } {
  const section = { profile, mode: 'present' as const, shown: [] };
  const prompt = buildEnvelopePrompt(envelope(stepTitle, ranges), `Explain this step in the ${PROFILE_PROMPT_NAMES[profile]} profile.`, null, { folder: '## Reading the code\n(the two revisions, as files)' }, null, section);
  const answered = simulatedReviewTask(prompt, folder);
  assert.ok(answered !== null, 'the simulated provider answers a review question');
  const { shown, block } = splitCodeAnswer(answered.answer);
  const parts = splitDetails(shown);
  return { prompt, short: parts.short, details: parts.details, references: block };
}

const sentences = (text: string): number => (text.replace(/`[^`]*`|“[^”]*”/g, 'x').match(/[.!?](\s|$)/g) ?? []).length;

describe('the chain, with the simulated provider (DSP-181)', () => {
  it('a normal change with a default and a fallback: every profile names them in the base text, with the deepening behind the marker', () => {
    for (const profile of PUBLIC_PROFILES) {
      const got = present('Return the greeting by name', profile);
      assert.ok(got.prompt.startsWith(`${TASK_HEADER} review-question`), 'the turn is recognisable as one that reads code');
      assert.match(got.prompt, /^Language: English\./m);
      assert.ok(got.prompt.includes(presentationPromptSection({ profile, mode: 'present', shown: [] }) ?? '-'), 'the profile section is in the prompt as built');
      assert.equal(got.prompt.split(DETAILS_MARKER).length - 1, 1, 'the marker is named once');
      assert.match(got.short, /`greet\(name\)`/, `${profile}: the concrete name`);
      assert.match(got.short, /“Hello!”/, `${profile}: the default`);
      assert.ok(!/Show more/i.test(got.short), `${profile}: the base text does not say Show more`);
      assert.ok(got.details !== null && /SIMULATED deepening/.test(got.details), `${profile}: the deepening is behind the marker`);
      assert.ok(!/SIMULATED (Essentials|Standard|Teacher) for/.test(got.details ?? ''), `${profile}: the base text is not repeated behind the marker`);
      assert.deepEqual((got.references as { references: { path: string }[] }).references.map((entry) => entry.path), ['src/greeting.ts'], `${profile}: the code it rests on`);
    }
    const essentials = present('Return the greeting by name', 'essens');
    const standard = present('Return the greeting by name', 'standard');
    const teacher = present('Return the greeting by name', 'pedagog');
    // DSP-188: the profiles differ in manner, not by a count; these texts are the simulated adapter's own.
    assert.notEqual(essentials.short, standard.short);
    assert.notEqual(standard.short, teacher.short);
    assert.match(teacher.short, /First the idea[\s\S]*Now the code/, 'Teacher builds the prerequisite first, then connects it to the code');
  });

  it('a trivial change is short in every profile, with nothing behind Show more', () => {
    for (const profile of PUBLIC_PROFILES) {
      const got = present('Trivial: a full stop becomes an exclamation mark', profile);
      assert.ok(sentences(got.short) <= 2, `${profile}: ${got.short}`);
      assert.equal(got.details, null, `${profile}: nothing to deepen`);
      assert.match(got.short, /`greet\(\)`/);
    }
  });

  it('a complex change over several code places: every place reaches the prompt, apart by file and revision', () => {
    const places = [
      range(),
      range({ role: 'context', path: 'src/request.ts', start: 40, end: 42, lines: ['const name = request.query.name ?? "";', 'const text = greet(name);', 'reply(text);'] }),
      range({ role: 'counterpart', path: 'src/greeting.ts', side: 'base', sha: BASE, start: 10, end: 12, lines: ['export function greet(): string {', '  return "Hello.";', '}'] }),
    ];
    const got = present('Move the decision into greet', 'standard', places);
    assert.match(got.prompt, /### focus · src\/greeting\.ts lines 10–14 · target @/);
    assert.match(got.prompt, /### context · src\/request\.ts lines 40–42 · target @/);
    assert.match(got.prompt, /### counterpart · src\/greeting\.ts lines 10–12 · base @/);
    assert.match(got.short, /`greet\(name\)`/);
    assert.ok(got.details !== null);
  });

  it('a step about an unfamiliar tool: the Teacher prompt asks for the prerequisite knowledge, and the answer builds it before the code', () => {
    const got = present('Declare the build option that switches the greeting on', 'pedagog');
    assert.match(got.prompt, /build the understanding the reasoning presupposes/);
    assert.ok(!/build setting/.test(got.prompt), 'no hard-coded example (DSP-184)');
    assert.ok(got.short.indexOf('First the idea') < got.short.indexOf('Now the code'));
  });

  it('the same answer parses to the same blocks whatever profile asked for it: the profile changes words, not rendering', () => {
    const text = `A paragraph with \`code\`.\n\n- one\n  - nested\n\n## Heading\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const blocks = parseMarkdown(text);
    assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'list', 'heading', 'table', 'code']);
    // The window renders an alternative and a discussion answer through the same component over the same blocks;
    // review-reading-style.test.ts holds that no surface adds typography of its own.
    assert.deepEqual(parseMarkdown(text), blocks);
  });
});
