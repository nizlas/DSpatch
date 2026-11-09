/**
 * DSP-176, DSP-181: the presentation policy. One policy reaches every generation path: the
 * base text's grounding and the details contract are said once per prompt; Essentials,
 * Standard and Teacher differ in selection and manner, with length as a guideline; Explain
 * more simply reduces concepts per profile and asks for another way in when pressed again;
 * Tell me more and a follow-up keep the level and do not restart; Original is the prepared
 * explanation, kept and never asked for again. DSP-184: what a step shows is chosen from the
 * step explanations' own store, so a late or failed answer never shows under the wrong step,
 * version or profile; the discussion carries no profile. Neutral examples only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PROFILE,
  DETAILS_MARKER,
  DETAILS_PART_RULE,
  EXPLANATORY_VALUE_RULES,
  GROUNDING_RULES,
  LENGTH_GUIDELINE_RULES,
  MORE_RULES,
  PRESENTATION_INSTRUCTION_VERSION,
  PRESENTATION_PROFILES,
  PROFILES,
  PROFILE_PROMPT_NAMES,
  PUBLIC_PROFILES,
  SHORT_PART_RULE,
  SIMPLER_AGAIN_RULES,
  SIMPLER_RULES,
  effectiveProfile,
  isProfile,
  isPublicProfile,
  presentationFrom,
  WALK_WRITING_RULES,
  outlineFrom,
  presentationPromptSection,
  readingContextSection,
  walkExplanationSection,
} from '../src/shared/presentation-profiles';
import { ANSWER_SHAPE_RULES, deepenFrom, isAutomaticProfileEntry, recapFor, type DiscussionMessage } from '../src/shared/review-discussion';
import { WORDS } from '../src/renderer/review-i18n';
import { chosenProfile } from '../src/renderer/presentation-choice';
import { WALK_TEXT, adoptStepExplanations, chainTo, historyOf, shownItem, wantsExplanation, type StepExplanation } from '../src/shared/step-explanations';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('the profiles (DSP-181)', () => {
  it('are Essentials, Standard and Teacher in public, Original in legacy; Standard is the default', () => {
    assert.deepEqual(PUBLIC_PROFILES, ['essens', 'standard', 'pedagog']);
    assert.deepEqual(PRESENTATION_PROFILES, ['original', 'essens', 'standard', 'pedagog']);
    assert.equal(DEFAULT_PROFILE, 'standard');
    assert.ok(isProfile('original') && isProfile('standard') && !isProfile('essentials'));
    assert.ok(!isPublicProfile('original') && isPublicProfile('pedagog'));
    assert.equal(PRESENTATION_INSTRUCTION_VERSION, 5);
  });

  it('are named and described in the window\'s language over stable ids; prompts use the English names', () => {
    assert.deepEqual(PUBLIC_PROFILES.map((id) => WORDS.sv.profiles.name[id]), ['Essens', 'Standard', 'Pedagog']);
    assert.deepEqual(PUBLIC_PROFILES.map((id) => WORDS.en.profiles.name[id]), ['Essentials', 'Standard', 'Teacher']);
    assert.deepEqual(PUBLIC_PROFILES.map((id) => PROFILE_PROMPT_NAMES[id]), ['Essentials', 'Standard', 'Teacher']);
    // Ids, prompt names and display names are three things, never mixed: the ids are not shown,
    // the Swedish names are not prompt names, and the prompt names are English.
    for (const id of PUBLIC_PROFILES) {
      assert.ok(id === 'standard' || (!Object.values(WORDS.sv.profiles.name).includes(id) && !Object.values(WORDS.en.profiles.name).includes(id)), `the id ${id} is not shown`);
      assert.equal(WORDS.en.profiles.name[id], PROFILE_PROMPT_NAMES[id], 'the English display name is the prompt name');
      assert.ok(WORDS.sv.profiles.description[id].length > 20 && WORDS.en.profiles.description[id].length > 20, 'a short plain tooltip per option');
      assert.ok(WORDS.sv.profiles.description[id].length < 120 && WORDS.en.profiles.description[id].length < 120, 'a tooltip, not the instructions');
    }
    assert.ok(!Object.values(PROFILE_PROMPT_NAMES).includes('Pedagog') && !Object.values(PROFILE_PROMPT_NAMES).includes('Essens'));
    // The chooser is the step explanation's.
    assert.equal(WORDS.en.profiles.label, 'Explanation');
    assert.equal(WORDS.sv.profiles.label, 'Förklaring');
  });

  it('the review view says nothing of the instructions (DSP-184): no "What it asks for", no instruction text, no version', () => {
    for (const lang of ['sv', 'en'] as const) {
      const words = JSON.stringify(WORDS[lang].profiles, (_key, value: unknown) => (typeof value === 'function' ? String((value as (...args: unknown[]) => unknown)('X', 'Y')) : value));
      assert.ok(!/What it asks for|Vad profilen ber om|Instruction version|instruktionerna|instructions/i.test(words), `${lang}: ${words.slice(0, 200)}`);
      assert.ok(!('about' in WORDS[lang].profiles));
    }
  });

  it('a saved Essentials or Teacher is kept; a saved Original, nothing or nonsense means Standard', () => {
    assert.equal(effectiveProfile('essens'), 'essens');
    assert.equal(effectiveProfile('pedagog'), 'pedagog');
    assert.equal(effectiveProfile('original'), 'standard');
    assert.equal(effectiveProfile(undefined), 'standard');
    assert.equal(effectiveProfile('other'), 'standard');
    // The walk's own choice first, then the review state's, then the computer's last choice.
    assert.equal(chosenProfile('pedagog', 'essens', 'essens'), 'pedagog');
    assert.equal(chosenProfile(null, 'essens', 'pedagog'), 'essens');
    assert.equal(chosenProfile(null, 'original', 'pedagog'), 'pedagog');
    assert.equal(chosenProfile(null, 'original', 'original'), 'standard');
    assert.equal(chosenProfile(null, null, null), 'standard');
  });
});

describe('one policy in the prompt (DSP-181)', () => {
  it('presenting a step says the grounding, the profile\'s manner and the length guideline with what it is not, once each', () => {
    for (const id of PUBLIC_PROFILES) {
      const section = presentationPromptSection({ profile: id, mode: 'present', shown: [] }) ?? '';
      assert.match(section, new RegExp(`^## How to present \\(${PROFILE_PROMPT_NAMES[id]}\\)`));
      assert.match(section, new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
      for (const rule of GROUNDING_RULES) {
        assert.equal(count(section, rule), 1, `grounding once: ${rule.slice(0, 40)}`);
      }
      for (const rule of PROFILES[id].manner) {
        assert.equal(count(section, rule), 1);
      }
      assert.equal(count(section, PROFILES[id].guideline), 1);
      assert.equal(count(section, LENGTH_GUIDELINE_RULES[0]), 1);
      // The contract of the marker is the answer format's business: said there, once, not here again.
      assert.ok(!section.includes(DETAILS_MARKER), 'the marker is named by the answer format, not twice');
      assert.ok(!/Then the line that starts Show more/.test(section), 'no instruction to write a "Show more" line');
      assert.ok(!/Answer three things/.test(section) && !/60–100 words/.test(section), 'no three-part mandate, no word budget');
    }
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'present', shown: [] }), null, 'Original is never asked for');
  });

  it('the profiles differ in selection and manner, not in facts', () => {
    const essentials = presentationPromptSection({ profile: 'essens', mode: 'present', shown: [] }) ?? '';
    const standard = presentationPromptSection({ profile: 'standard', mode: 'present', shown: [] }) ?? '';
    const teacher = presentationPromptSection({ profile: 'pedagog', mode: 'present', shown: [] }) ?? '';
    // Essentials: the purpose and the most important events, above the statements; about two sentences.
    assert.match(essentials, /purpose of the code and its most important events, at a level above the individual statements/);
    assert.match(essentials, /concrete identifiers only where they help/);
    assert.match(essentials, /Leave out mechanical details \(indexes, loop bounds, every single call\)/);
    assert.match(essentials, /About two sentences for a normal step/);
    // Standard: also how and why the parts connect, for a developer new to this code; understanding, not words.
    assert.match(standard, /knows programming but not this code/);
    assert.match(standard, /develop the connections: why the conditions exist, how the parts work together, and which consequences matter/);
    assert.match(standard, /Not a line-by-line account/);
    assert.match(standard, /Do not teach general programming concepts/);
    assert.match(standard, /About four to six sentences/);
    // Teacher: concepts first, the reasoning, examples where they help; not shortened.
    assert.match(teacher, /Build the concepts the reader needs/);
    assert.match(teacher, /Explain the reasoning step by step/);
    assert.match(teacher, /example, or an analogy/);
    assert.match(teacher, /Do not shorten it to resemble the other profiles/);
    // Generic: no hard-coded example of a particular kind of project.
    assert.ok(!/build setting|build system/.test(teacher));
    for (const section of [essentials, standard, teacher]) {
      // Every profile: understanding beyond the code and its comments, no invented intentions, and the self-check.
      for (const rule of EXPLANATORY_VALUE_RULES) {
        assert.equal(count(section, rule), 1);
      }
      assert.match(section, /not already plain from the code or its comments/);
      assert.match(section, /not what is said about the code/);
      assert.match(section, /default value explicitly when it is decisive/);
      assert.match(section, /not a count to hit, not a cap/);
      assert.match(section, /do not start a new broad review/);
    }
  });

  it('the answer format says the short part and the marker in the policy\'s own words', () => {
    assert.equal(ANSWER_SHAPE_RULES[0], SHORT_PART_RULE);
    assert.equal(ANSWER_SHAPE_RULES[1], DETAILS_PART_RULE);
    assert.ok(DETAILS_PART_RULE.includes(DETAILS_MARKER));
    assert.match(DETAILS_PART_RULE, /do not write "Show more" yourself/);
  });

  it('Explain more simply reduces concepts, per profile, and asks for another way in when pressed again', () => {
    const once = presentationPromptSection({ profile: 'essens', mode: 'simpler', shown: [{ label: 'The Essentials explanation of the step', text: 'A.' }] }) ?? '';
    assert.match(once, /^## Explaining more simply \(attempt 1, Essentials\)/);
    assert.match(once, /less conceptual complexity, not more detail/);
    assert.match(once, /In Essentials: Plainer language and less jargon/);
    assert.ok(!once.includes(SIMPLER_AGAIN_RULES[0]));
    const twice = presentationPromptSection({ profile: 'pedagog', mode: 'simpler', shown: [{ label: 'One', text: 'A.' }, { label: 'Two', text: 'B.' }] }) ?? '';
    assert.match(twice, /attempt 2, Teacher/);
    assert.ok(twice.includes(SIMPLER_AGAIN_RULES[0]) && twice.includes(SIMPLER_AGAIN_RULES[1]));
    assert.match(twice, /In Teacher: Try a simpler way in/);
    assert.match(twice, /### Shown 1: One\nA\.\n\n### Shown 2: Two\nB\./);
    assert.match(twice, /one short, directed question/);
    const standard = presentationPromptSection({ profile: 'standard', mode: 'simpler', shown: [{ label: 'X', text: 'A.' }] }) ?? '';
    assert.match(standard, /In Standard: Break the difficult connection into its parts/);
    for (const rule of SIMPLER_RULES) {
      assert.ok(!/more background/.test(rule), 'simpler never asks for more background');
    }
    // Legacy: a chain begun before the profiles.
    const legacy = presentationPromptSection({ profile: 'original', mode: 'simpler', shown: [{ label: 'The prepared explanation of the step', text: 'A.' }] }) ?? '';
    assert.match(legacy, /^## Explaining more simply \(attempt 1\)\n/);
    assert.ok(!legacy.includes('The reader\'s profile'));
  });

  it('Tell me more goes deeper from what was shown and does not restart', () => {
    const more = presentationPromptSection({ profile: 'standard', mode: 'more', shown: [{ label: 'The Standard explanation of the step', text: 'The base.' }] }) ?? '';
    assert.match(more, /^## Going deeper \(Standard\)\nInstruction version: \d+\n/);
    assert.ok(more.includes(MORE_RULES[0]) && more.includes(MORE_RULES[1]));
    assert.match(more, /Do not restart with the same base explanation/);
    assert.match(more, /### The Standard explanation of the step\nThe base\./);
    // Nothing shown yet in the profile: the prepared explanation is deepened, with the profile's manner.
    const first = presentationPromptSection({ profile: 'essens', mode: 'more', shown: [] }) ?? '';
    assert.match(first, /^## The reader's profile \(Essentials\)\nInstruction version: \d+\n- The reader's profile: Essentials\. Its manner:/);
    assert.ok(!first.includes('below'), 'nothing is said to be below when nothing is');
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'more', shown: [] }), null);
  });

  it('the same rules reach walk generation, a profile\'s explanation, regeneration and the deepenings, with the walk-relative rules', () => {
    for (const id of PUBLIC_PROFILES) {
      const walk = walkExplanationSection(id);
      const present = presentationPromptSection({ profile: id, mode: 'present', shown: [], walk: null }) ?? '';
      const regenerate = presentationPromptSection({ profile: id, mode: 'regenerate', shown: [{ label: 'Before', text: 'A.' }], walk: null }) ?? '';
      for (const section of [walk, present, regenerate]) {
        for (const rule of [...GROUNDING_RULES, ...EXPLANATORY_VALUE_RULES, ...PROFILES[id].manner, ...WALK_WRITING_RULES]) {
          assert.equal(count(section, rule), 1, `${id}: ${rule.slice(0, 40)}`);
        }
        assert.match(section, new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
      }
      assert.match(regenerate, /## Regenerating[\s\S]*### Before\nA\./);
      for (const mode of ['more', 'simpler', 'explain'] as const) {
        const section = presentationPromptSection({ profile: id, mode, shown: [{ label: 'Shown', text: 'A.' }], walk: null }) ?? '';
        assert.ok(section.includes(PROFILES[id].manner[0] ?? '-'), `${mode} keeps the profile's manner`);
        assert.ok(section.includes(EXPLANATORY_VALUE_RULES[2]), `${mode} keeps the self-check`);
        for (const rule of WALK_WRITING_RULES) {
          assert.equal(count(section, rule), 1, `${mode}: the walk-relative rules`);
        }
      }
    }
  });

  it('an explanation prompt carries the walk\'s order and coverage; an outline from a window is bounded', () => {
    const outline = outlineFrom({ walkTitle: 'Greeting a visitor', steps: [{ title: 'Read the name', places: ['src/a.ts 1–3 (To)'] }, { title: 'Build the greeting', places: ['src/b.ts 4–9 (To)', 7] }], current: 1 });
    assert.ok(outline !== null);
    const section = presentationPromptSection({ profile: 'standard', mode: 'present', shown: [], walk: outline }) ?? '';
    assert.match(section, /## Where this step is in the walk\nWalk: Greeting a visitor\n1\. Read the name \(code: src\/a\.ts 1–3 \(To\)\)\n2\. Build the greeting \(code: src\/b\.ts 4–9 \(To\)\)  <- this step/);
    assert.match(section, /"in the next step"/);
    assert.match(section, /Do not explain in advance what a later step covers/);
    assert.equal(outlineFrom({ steps: [], current: 0 }), null);
    assert.equal(outlineFrom({ steps: [{ title: 'x' }], current: 3 }), null);
    assert.equal(outlineFrom({ steps: Array.from({ length: 100 }, () => ({ title: 'x'.repeat(500) })), current: 0 })?.steps.length, 40);
  });

  it('a discussion question\'s context is the explanation shown, without a profile or its manner', () => {
    const section = readingContextSection({ text: 'It returns the greeting.' }) ?? '';
    assert.match(section, /^## The explanation of this step the person is reading/);
    assert.match(section, /It returns the greeting\./);
    for (const id of PUBLIC_PROFILES) {
      assert.ok(!section.includes(PROFILES[id].manner[0] ?? '-'));
    }
    assert.ok(!/Essentials|Teacher|profile/.test(section));
    assert.equal(readingContextSection(null), null);
  });

  it('a request names a known profile and only answer-like ids, a few of them', () => {
    assert.equal(presentationFrom({ profile: 'other' }), null);
    assert.deepEqual(presentationFrom({ profile: 'standard', shown: ['a-1', '../x', 7, 'a-2'] }), { profile: 'standard', shown: ['a-1', 'a-2'] });
    assert.equal(presentationFrom({ profile: 'pedagog', shown: Array.from({ length: 10 }, (_, i) => `a-${String(i)}`) })?.shown?.length, 6);
    assert.deepEqual(presentationFrom({ profile: 'essens', version: PRESENTATION_INSTRUCTION_VERSION }), { profile: 'essens', version: PRESENTATION_INSTRUCTION_VERSION });
    assert.deepEqual(presentationFrom({ profile: 'original' }), { profile: 'original' }, 'a legacy record still reads');
  });

  it('a present deepening needs a public profile and the step version it was asked from', () => {
    assert.equal(deepenFrom({ action: 'present', profile: 'standard' }), null);
    assert.equal(deepenFrom({ action: 'present', profile: 'original', basis: 'h' }), null);
    assert.deepEqual(deepenFrom({ action: 'present', profile: 'standard', basis: 'h1' }), { action: 'present', profile: 'standard', basis: 'h1' });
    // Older deepenings read as they were.
    assert.deepEqual(deepenFrom({ action: 'more' }), { action: 'more' });
    assert.deepEqual(deepenFrom({ action: 'simpler', profile: 'essens', basis: 'h1' }), { action: 'simpler', profile: 'essens', basis: 'h1' });
  });
});

// DSP-184: what a step shows, from the step explanations' own store.
let clock = 0;
function entry(id: string, overrides: Partial<StepExplanation> = {}): StepExplanation {
  clock += 1;
  return {
    id,
    walkId: 'W1',
    stepId: 'W1.1',
    basis: 'h1',
    profile: 'essens',
    action: 'present',
    parent: null,
    text: `text of ${id}`,
    status: 'done',
    at: String(clock),
    instructionVersion: PRESENTATION_INSTRUCTION_VERSION,
    language: 'en',
    trigger: 'person',
    ...overrides,
  };
}

describe('what a step shows (DSP-184)', () => {
  const slot = { walkId: 'W1', stepId: 'W1.1', basis: 'h1', profile: 'essens' } as const;
  const entries: StepExplanation[] = [
    entry('x-e1'),
    // A late answer for another step and for another profile.
    entry('x-p', { stepId: 'W1.2', profile: 'pedagog' }),
    entry('x-st', { profile: 'standard' }),
    // An older version of the step.
    entry('x-e0', { basis: 'h0' }),
    entry('x-m', { action: 'more', parent: 'x-e1' }),
    entry('x-s', { action: 'simpler', parent: 'x-m' }),
    // A regeneration that failed: what was there stays shown, and the failure waits for Try again.
    entry('x-r', { action: 'regenerate', parent: 'x-s', status: 'failed', text: '', error: 'provider error' }),
  ];

  it('a history per review, walk, step, version and profile: the walk text first, finished explanations in order, the latest shown', () => {
    const history = historyOf(entries, slot);
    assert.deepEqual(history.items, [WALK_TEXT, 'x-e1', 'x-m', 'x-s']);
    assert.equal(shownItem(history, undefined), 'x-s');
    assert.equal(shownItem(history, 'x-e1'), 'x-e1', 'gone back to an earlier one');
    assert.equal(shownItem(history, WALK_TEXT), WALK_TEXT, 'the walk text can always be returned to');
    assert.equal(shownItem(history, 'x-st'), 'x-s', 'an item of another profile is not this history\'s');
    assert.equal(history.failed?.id, 'x-r');
    assert.equal(history.pending, null);
    assert.deepEqual(historyOf(entries, { ...slot, profile: 'standard' }).items, [WALK_TEXT, 'x-st']);
    assert.deepEqual(historyOf(entries, { ...slot, basis: 'h9' }).items, [WALK_TEXT], 'a changed step reuses nothing');
    assert.deepEqual(historyOf(entries, { ...slot, profile: 'pedagog' }).items, [WALK_TEXT], 'the Teacher answer is for another step');
  });

  it('what an action builds on follows the parent links, finished ones only, oldest first', () => {
    assert.deepEqual(chainTo(entries, 'x-s').map((item) => item.id), ['x-e1', 'x-m', 'x-s']);
    assert.deepEqual(chainTo(entries, null), []);
  });

  it('asked for on arrival only when nothing is there, nothing is on its way and nothing failed; never in the walk\'s own profile', () => {
    const empty = historyOf([], slot);
    assert.equal(wantsExplanation('standard', 'essens', empty), true);
    assert.equal(wantsExplanation('essens', 'essens', empty), false, 'the walk\'s own profile');
    assert.equal(wantsExplanation(null, 'essens', empty), true, 'an older walk (Original) has no profile of its own');
    assert.equal(wantsExplanation('standard', 'essens', historyOf([entry('a')], slot)), false, 'one is there');
    assert.equal(wantsExplanation('standard', 'essens', historyOf([entry('b', { status: 'streaming', text: '' })], slot)), false, 'one is on its way');
    assert.equal(wantsExplanation('standard', 'essens', historyOf([entry('c', { status: 'failed', text: '' })], slot)), false, 'the last attempt failed: it waits for Try again');
    assert.equal(wantsExplanation('standard', 'essens', historyOf([entry('d', { status: 'unknown', text: '' })], slot)), false, 'an unknown end waits too');
  });

  it('a stored record is read as it is; a newer one is left alone', () => {
    const identity = { key: 'k', repository: 'r', base: 'b', target: 't', definitionPath: 'd' };
    const adopted = adoptStepExplanations({ version: 1, entries: [entries[0], { id: 'broken' }], savedAt: 'x' }, identity);
    assert.equal(adopted.kind === 'adopted' ? adopted.record.entries.length : -1, 1);
    assert.equal(adoptStepExplanations({ version: 2, entries: [] }, identity).kind, 'newer');
    assert.equal(adoptStepExplanations('nonsense', identity).kind, 'unusable');
  });
});

describe('older automatic profile entries in the discussion (DSP-184)', () => {
  const question = (id: string, deepen: DiscussionMessage['deepen'], text = id): DiscussionMessage => ({ id, role: 'question', text, at: id, subject: 's', status: 'sent', ...(deepen === undefined ? {} : { deepen }) });
  const answer = (id: string, questionId: string, text: string): DiscussionMessage => ({ id, role: 'answer', text, at: id, subject: 's', status: 'done', questionId });
  const messages: DiscussionMessage[] = [
    question('q1', { action: 'present', profile: 'pedagog', basis: 'h1' }),
    answer('a1', 'q1', 'An automatic Teacher text.'),
    question('q2', { action: 'more', basis: 'h1' }, 'Tell me more about this step.'),
    answer('a2', 'q2', 'More, asked by the person.'),
    question('q3', undefined, 'Why is the default kept?'),
    answer('a3', 'q3', 'Because the caller relies on it.'),
  ];

  it('only a question with a present deepening is identified, with certainty; person-initiated deepenings stay', () => {
    assert.deepEqual(messages.filter(isAutomaticProfileEntry).map((message) => message.id), ['q1']);
  });

  it('the recap leaves them out, and keeps the rest', () => {
    const recap = recapFor(messages);
    assert.ok(!recap.includes('An automatic Teacher text.'));
    assert.match(recap, /More, asked by the person\./);
    assert.match(recap, /Because the caller relies on it\./);
  });
});
