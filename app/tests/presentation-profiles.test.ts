/**
 * DSP-176, DSP-181: the presentation policy. One policy reaches every generation path: the
 * base text's grounding and the details contract are said once per prompt; Essentials,
 * Standard and Teacher differ in selection and manner, with length as a guideline; Explain
 * more simply reduces concepts per profile and asks for another way in when pressed again;
 * Tell me more and a follow-up keep the level and do not restart; Original is the prepared
 * explanation, kept and never asked for again. What the walk shows is chosen from the
 * discussion so that a late or failed answer never shows under the wrong step, version or
 * profile. Neutral examples only.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PROFILE,
  DETAILS_MARKER,
  DETAILS_PART_RULE,
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
  presentationPromptSection,
  profileInstructionText,
} from '../src/shared/presentation-profiles';
import { ANSWER_SHAPE_RULES, deepenFrom, type DiscussionMessage } from '../src/shared/review-discussion';
import { WORDS } from '../src/renderer/review-i18n';
import { alternativeFor, chosenProfile, deepeningsOf, shownChain } from '../src/renderer/presentation-choice';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('the profiles (DSP-181)', () => {
  it('are Essentials, Standard and Teacher in public, Original in legacy; Standard is the default', () => {
    assert.deepEqual(PUBLIC_PROFILES, ['essens', 'standard', 'pedagog']);
    assert.deepEqual(PRESENTATION_PROFILES, ['original', 'essens', 'standard', 'pedagog']);
    assert.equal(DEFAULT_PROFILE, 'standard');
    assert.ok(isProfile('original') && isProfile('standard') && !isProfile('essentials'));
    assert.ok(!isPublicProfile('original') && isPublicProfile('pedagog'));
    assert.equal(PRESENTATION_INSTRUCTION_VERSION, 3);
  });

  it('are named and described in the window\'s language over stable ids; prompts use the English names', () => {
    assert.deepEqual(PUBLIC_PROFILES.map((id) => WORDS.sv.profiles.name[id]), ['Essens', 'Standard', 'Pedagog']);
    assert.deepEqual(PUBLIC_PROFILES.map((id) => WORDS.en.profiles.name[id]), ['Essentials', 'Standard', 'Teacher']);
    assert.deepEqual(PUBLIC_PROFILES.map((id) => PROFILE_PROMPT_NAMES[id]), ['Essentials', 'Standard', 'Teacher']);
    for (const id of PUBLIC_PROFILES) {
      assert.ok(WORDS.sv.profiles.description[id].length > 40 && WORDS.en.profiles.description[id].length > 40);
    }
    assert.equal(WORDS.sv.profiles.presentQuestion('Essens'), 'Förklara det här steget i profilen Essens.');
    assert.equal(WORDS.en.profiles.presentQuestion('Teacher'), 'Explain this step in the Teacher profile.');
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
    assert.match(essentials, /Select the core/);
    assert.match(essentials, /About two sentences/);
    assert.match(standard, /developer of ordinary experience/);
    assert.match(standard, /About five sentences/);
    assert.match(teacher, /prerequisite knowledge/);
    assert.match(teacher, /declaring a build setting, reading it while configuring and using the result at run time/);
    assert.match(teacher, /About ten sentences/);
    for (const section of [essentials, standard, teacher]) {
      assert.match(section, /not what is said about the code/);
      assert.match(section, /State the relevant default values explicitly/);
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
    assert.match(more, /^## Going deeper \(Standard\)/);
    assert.ok(more.includes(MORE_RULES[0]) && more.includes(MORE_RULES[1]));
    assert.match(more, /Do not restart with the same base explanation/);
    assert.match(more, /### The Standard explanation of the step\nThe base\./);
    // Nothing shown yet in the profile: the prepared explanation is deepened, with the profile's manner.
    const first = presentationPromptSection({ profile: 'essens', mode: 'more', shown: [] }) ?? '';
    assert.match(first, /^## The reader's profile \(Essentials\)\n- The reader's profile: Essentials\. Its manner:/);
    assert.ok(!first.includes('below'), 'nothing is said to be below when nothing is');
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'more', shown: [] }), null);
  });

  it('a follow-up keeps the level of what it follows, says how many times it was simplified, and never points at an explanation that is not there', () => {
    const follow = presentationPromptSection({ profile: 'pedagog', mode: 'follow', shown: [{ label: 'Explain more simply', text: 'Like a door.' }] }) ?? '';
    assert.match(follow, /^## The explanation this question follows \(Teacher\)/);
    assert.match(follow, /same level of explanation/);
    assert.match(follow, /more simply 1 time\(s\)/);
    assert.match(follow, /### Explain more simply\nLike a door\./);
    const nothingShown = presentationPromptSection({ profile: 'standard', mode: 'follow', shown: [] }) ?? '';
    assert.match(nothingShown, /^## The reader's profile \(Standard\)/);
    assert.ok(!nothingShown.includes('follows the explanation below'));
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'follow', shown: [] }), null, 'Original with nothing shown asks as before the profiles');
    const legacyFollow = presentationPromptSection({ profile: 'original', mode: 'follow', shown: [{ label: 'Explain more simply', text: 'A.' }] }) ?? '';
    assert.match(legacyFollow, /^## The explanation this question follows \(Original\)/);
  });

  it('every profile\'s instruction can be read as the window shows it', () => {
    assert.match(profileInstructionText('original'), /kept for comparison and is not asked for again/);
    for (const id of PUBLIC_PROFILES) {
      const text = profileInstructionText(id);
      assert.match(text, new RegExp(`^${PROFILE_PROMPT_NAMES[id]}\nInstruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
      assert.match(text, /Every profile:/);
      assert.match(text, /After the marker \(Show more\):/);
      assert.match(text, /Tell me more:/);
      assert.match(text, /Explain more simply:/);
      assert.match(text, /A follow-up question:/);
      assert.ok(text.includes(PROFILES[id].guideline));
    }
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

// What the walk shows, from the discussion's messages.
let clock = 0;
function question(id: string, stepId: string, deepen: DiscussionMessage['deepen'], status: DiscussionMessage['status'] = 'sent', presentation?: DiscussionMessage['presentation']): DiscussionMessage {
  clock += 1;
  return {
    id,
    role: 'question',
    text: id,
    at: String(clock),
    subject: '',
    status,
    deepen,
    ...(presentation === undefined ? {} : { presentation }),
    envelope: { subject: { kind: 'point', walkId: 'W1', stepId, placeIndex: 0 } } as unknown as DiscussionMessage['envelope'],
  };
}
function answer(id: string, questionId: string, status: DiscussionMessage['status'] = 'done', text = `text of ${id}`): DiscussionMessage {
  return { id, role: 'answer', text, at: '', subject: '', status, questionId };
}

describe('what the walk shows', () => {
  const messages: DiscussionMessage[] = [
    // Before profiles: a Tell me more in Original, with no version.
    question('q-old', 'W1.1', { action: 'more' }),
    answer('a-old', 'q-old'),
    // An Essentials alternative written under the earlier instructions (version 2).
    question('q-e1', 'W1.1', { action: 'present', profile: 'essens', basis: 'h1' }, 'sent', { profile: 'essens', version: 2 }),
    answer('a-e1', 'q-e1'),
    // A retry that failed after a good one: the good one still shows.
    question('q-e2', 'W1.1', { action: 'present', profile: 'essens', basis: 'h1' }),
    answer('a-e2', 'q-e2', 'failed', ''),
    // A late answer for another step and for another profile.
    question('q-p', 'W1.2', { action: 'present', profile: 'pedagog', basis: 'h2' }),
    answer('a-p', 'q-p'),
    // A Standard alternative of this step, under the current instructions.
    question('q-st', 'W1.1', { action: 'present', profile: 'standard', basis: 'h1' }, 'sent', { profile: 'standard', version: PRESENTATION_INSTRUCTION_VERSION }),
    answer('a-st', 'q-st'),
    // An Essentials alternative of an older version of the step.
    question('q-e0', 'W1.1', { action: 'present', profile: 'essens', basis: 'h0' }),
    answer('a-e0', 'q-e0'),
    question('q-s1', 'W1.1', { action: 'simpler', profile: 'essens', basis: 'h1' }),
    answer('a-s1', 'q-s1'),
    question('q-m', 'W1.1', { action: 'more', basis: 'h1' }),
    answer('a-m', 'q-m'),
  ];

  it('an alternative is the one of this step, version and profile; a failed retry does not hide it; Standard and Essentials stay apart', () => {
    const shown = alternativeFor(messages, 'W1.1', 'h1', 'essens');
    assert.equal(shown.done?.answer?.id, 'a-e1');
    assert.equal(shown.latest?.question.id, 'q-e2');
    assert.equal(shown.done?.question.presentation?.version, 2, 'the version it was written under is kept, so the window can say it is older');
    assert.equal(alternativeFor(messages, 'W1.1', 'h1', 'standard').done?.answer?.id, 'a-st');
    assert.equal(alternativeFor(messages, 'W1.1', 'h1', 'pedagog').done, null, 'the Teacher answer is for another step');
    assert.equal(alternativeFor(messages, 'W1.2', 'h2', 'pedagog').done?.answer?.id, 'a-p');
    assert.equal(alternativeFor(messages, 'W1.1', 'h9', 'essens').done, null, 'a changed step reuses nothing');
    assert.equal(alternativeFor(messages, 'W1.1', 'h1', 'original').done, null, 'Original is the prepared explanation itself');
  });

  it('deepenings belong to their profile and version; older ones stay with Original', () => {
    assert.deepEqual(deepeningsOf(messages, 'W1.1', 'h1', 'essens').map((entry) => entry.question.id), ['q-s1']);
    assert.deepEqual(deepeningsOf(messages, 'W1.1', 'h1', 'original').map((entry) => entry.question.id), ['q-old', 'q-m']);
    assert.deepEqual(deepeningsOf(messages, 'W1.1', 'h1', 'standard'), []);
  });

  it('the chain shown is the alternative, then the deepenings, oldest first', () => {
    assert.deepEqual(shownChain(messages, 'W1.1', 'h1', 'essens'), ['a-e1', 'a-s1']);
    assert.deepEqual(shownChain(messages, 'W1.1', 'h1', 'standard'), ['a-st']);
    assert.deepEqual(shownChain(messages, 'W1.1', 'h1', 'original'), ['a-old', 'a-m']);
  });
});
