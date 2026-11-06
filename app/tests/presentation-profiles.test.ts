/**
 * DSP-176: presentation profiles. The instructions are one readable set; Original adds nothing
 * to today's prompts; Explain more simply builds on what was shown and asks for another way in;
 * a follow-up keeps the level; and what the walk shows is chosen from the discussion so that a
 * late or failed answer never shows under the wrong step, version or profile.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PRESENTATION_INSTRUCTION_VERSION,
  PRESENTATION_PROFILES,
  PROFILES,
  SIMPLER_AGAIN_RULES,
  presentationFrom,
  presentationPromptSection,
  profileInstructionText,
} from '../src/shared/presentation-profiles';
import { deepenFrom, type DiscussionMessage } from '../src/shared/review-discussion';
import { alternativeFor, deepeningsOf, shownChain } from '../src/renderer/presentation-choice';

describe('the profiles', () => {
  it('are Original, Essens and Pedagog, each with a description, Original the first', () => {
    assert.deepEqual(PRESENTATION_PROFILES, ['original', 'essens', 'pedagog']);
    assert.deepEqual(PRESENTATION_PROFILES.map((id) => PROFILES[id].name), ['Original', 'Essens', 'Pedagog']);
    for (const id of PRESENTATION_PROFILES) {
      assert.ok(PROFILES[id].description.length > 30);
    }
  });

  it('Original adds nothing to a presentation or a plain follow-up; the others say how to present', () => {
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'present', shown: [] }), null);
    assert.equal(presentationPromptSection({ profile: 'original', mode: 'follow', shown: [] }), null);
    const essens = presentationPromptSection({ profile: 'essens', mode: 'present', shown: [] }) ?? '';
    assert.match(essens, /^## How to present \(Essens\)/);
    assert.match(essens, new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
    assert.match(essens, /What changes\? Why does it matter\? What does the reader need to understand or check here\?/);
    assert.match(essens, /not what is said about the code/);
    const pedagog = presentationPromptSection({ profile: 'pedagog', mode: 'present', shown: [] }) ?? '';
    assert.match(pedagog, /simple mental model/);
    assert.match(pedagog, /concrete example/);
  });

  it('Explain more simply numbers its attempts, builds on what was shown, and asks for another way in when pressed again', () => {
    const once = presentationPromptSection({ profile: 'original', mode: 'simpler', shown: [{ label: 'The prepared explanation of the step', text: 'A.' }] }) ?? '';
    assert.match(once, /attempt 1/);
    assert.ok(!once.includes(SIMPLER_AGAIN_RULES[0]));
    const twice = presentationPromptSection({ profile: 'pedagog', mode: 'simpler', shown: [{ label: 'One', text: 'A.' }, { label: 'Two', text: 'B.' }] }) ?? '';
    assert.match(twice, /attempt 2/);
    assert.ok(twice.includes(SIMPLER_AGAIN_RULES[0]) && twice.includes(SIMPLER_AGAIN_RULES[1]));
    assert.match(twice, /### Shown 1: One\nA\.\n\n### Shown 2: Two\nB\./);
    assert.match(twice, /Pedagog profile/);
    assert.ok(!/cannot be (?:explained|made) (?:any )?simpler/i.test(twice.replace("do not say that it cannot be explained more simply", '')));
  });

  it('a follow-up keeps the level of what it follows, and says how many times it was simplified', () => {
    const follow = presentationPromptSection({ profile: 'original', mode: 'follow', shown: [{ label: 'Explain more simply', text: 'Like a door.' }] }) ?? '';
    assert.match(follow, /same level of explanation/);
    assert.match(follow, /more simply 1 time\(s\)/);
    assert.match(follow, /### Explain more simply\nLike a door\./);
  });

  it('every profile\'s instruction can be read as the window shows it', () => {
    assert.match(profileInstructionText('original'), /Explain more simply follows these rules in every profile/);
    assert.match(profileInstructionText('essens'), /The first presentation:/);
    assert.match(profileInstructionText('pedagog'), /A follow-up question:/);
    assert.match(profileInstructionText('essens'), new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
  });

  it('a request names a known profile and only answer-like ids, a few of them', () => {
    assert.equal(presentationFrom({ profile: 'other' }), null);
    assert.deepEqual(presentationFrom({ profile: 'essens', shown: ['a-1', '../x', 7, 'a-2'] }), { profile: 'essens', shown: ['a-1', 'a-2'] });
    assert.equal(presentationFrom({ profile: 'pedagog', shown: Array.from({ length: 10 }, (_, i) => `a-${String(i)}`) })?.shown?.length, 6);
    assert.deepEqual(presentationFrom({ profile: 'essens', version: PRESENTATION_INSTRUCTION_VERSION }), { profile: 'essens', version: PRESENTATION_INSTRUCTION_VERSION });
  });

  it('a present deepening needs a profile other than Original and the step version it was asked from', () => {
    assert.equal(deepenFrom({ action: 'present', profile: 'essens' }), null);
    assert.equal(deepenFrom({ action: 'present', profile: 'original', basis: 'h' }), null);
    assert.deepEqual(deepenFrom({ action: 'present', profile: 'essens', basis: 'h1' }), { action: 'present', profile: 'essens', basis: 'h1' });
    // Older deepenings read as they were.
    assert.deepEqual(deepenFrom({ action: 'more' }), { action: 'more' });
  });
});

// What the walk shows, from the discussion's messages.
let clock = 0;
function question(id: string, stepId: string, deepen: DiscussionMessage['deepen'], status: DiscussionMessage['status'] = 'sent'): DiscussionMessage {
  clock += 1;
  return { id, role: 'question', text: id, at: String(clock), subject: '', status, deepen, envelope: { subject: { kind: 'point', walkId: 'W1', stepId, placeIndex: 0 } } as unknown as DiscussionMessage['envelope'] };
}
function answer(id: string, questionId: string, status: DiscussionMessage['status'] = 'done', text = `text of ${id}`): DiscussionMessage {
  return { id, role: 'answer', text, at: '', subject: '', status, questionId };
}

describe('what the walk shows', () => {
  const messages: DiscussionMessage[] = [
    // Before profiles: a Tell me more in Original, with no version.
    question('q-old', 'W1.1', { action: 'more' }),
    answer('a-old', 'q-old'),
    question('q-e1', 'W1.1', { action: 'present', profile: 'essens', basis: 'h1' }),
    answer('a-e1', 'q-e1'),
    // A retry that failed after a good one: the good one still shows.
    question('q-e2', 'W1.1', { action: 'present', profile: 'essens', basis: 'h1' }),
    answer('a-e2', 'q-e2', 'failed', ''),
    // A late answer for another step and for another profile.
    question('q-p', 'W1.2', { action: 'present', profile: 'pedagog', basis: 'h2' }),
    answer('a-p', 'q-p'),
    // An Essens alternative of an older version of the step.
    question('q-e0', 'W1.1', { action: 'present', profile: 'essens', basis: 'h0' }),
    answer('a-e0', 'q-e0'),
    question('q-s1', 'W1.1', { action: 'simpler', profile: 'essens', basis: 'h1' }),
    answer('a-s1', 'q-s1'),
    question('q-m', 'W1.1', { action: 'more', basis: 'h1' }),
    answer('a-m', 'q-m'),
  ];

  it('an alternative is the one of this step, version and profile; a failed retry does not hide it', () => {
    const shown = alternativeFor(messages, 'W1.1', 'h1', 'essens');
    assert.equal(shown.done?.answer?.id, 'a-e1');
    assert.equal(shown.latest?.question.id, 'q-e2');
    assert.equal(alternativeFor(messages, 'W1.1', 'h1', 'pedagog').done, null, 'the Pedagog answer is for another step');
    assert.equal(alternativeFor(messages, 'W1.2', 'h2', 'pedagog').done?.answer?.id, 'a-p');
    assert.equal(alternativeFor(messages, 'W1.1', 'h9', 'essens').done, null, 'a changed step reuses nothing');
    assert.equal(alternativeFor(messages, 'W1.1', 'h1', 'original').done, null);
  });

  it('deepenings belong to their profile and version; older ones stay with Original', () => {
    assert.deepEqual(deepeningsOf(messages, 'W1.1', 'h1', 'essens').map((entry) => entry.question.id), ['q-s1']);
    assert.deepEqual(deepeningsOf(messages, 'W1.1', 'h1', 'original').map((entry) => entry.question.id), ['q-old', 'q-m']);
  });

  it('the chain shown is the alternative, then the deepenings, oldest first', () => {
    assert.deepEqual(shownChain(messages, 'W1.1', 'h1', 'essens'), ['a-e1', 'a-s1']);
    assert.deepEqual(shownChain(messages, 'W1.1', 'h1', 'original'), ['a-old', 'a-m']);
  });
});
