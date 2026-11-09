/**
 * DSP-185 (Niclas's quality correction of 9 November 2026): the step-explanation prompts for
 * the synthetic work-queue case, built through the same code a session uses.
 *
 * These check the prompts' content and structure only: which instructions and which context
 * each profile is given. Whether an explanation written from them makes the producer/worker
 * relation understandable is a qualitative judgement of a real model's answer, made outside
 * this suite (`scripts/explain-prompt.mjs` writes the prompts for it); no test here looks for
 * words such as the names of the synchronisation primitives in any answer.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { MECHANISM_RULES, PRESENTATION_INSTRUCTION_VERSION, PROFILES } from '../src/shared/presentation-profiles';
import { buildExplanationPrompts, type BuiltPrompts } from './support/explain-prompts';

let built: BuiltPrompts;

before(async () => {
  built = await buildExplanationPrompts({ stepId: 'W1.2' });
});

after(() => {
  built.dispose();
});

describe('the exact explanation prompts of the synthetic work-queue case (structure only)', () => {
  it('are built for every public profile, with the step\'s code, the walk outline and the revision folder', () => {
    assert.deepEqual(Object.keys(built.prompts).sort(), ['Essentials', 'Standard', 'Teacher']);
    for (const [name, prompt] of Object.entries(built.prompts)) {
      assert.match(prompt, new RegExp(`## How to present \\(${name}\\)`));
      assert.match(prompt, new RegExp(`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`));
      assert.match(prompt, /### focus · src\/work_queue\.cpp lines 14–24 · target @/);
      assert.match(prompt, /^2\. \[W1\.2\] .*<- this step$/m);
      assert.match(prompt, /^3\. \[W1\.3\] /m, 'the code that receives what this step hands over is in the outline');
      assert.match(prompt, /## The code, and how to read it/);
    }
  });

  it('every profile is told that code is treated only by explaining its mechanisms, from code it read, keeping what cannot be established apart', () => {
    for (const prompt of Object.values(built.prompts)) {
      for (const rule of MECHANISM_RULES) {
        assert.ok(prompt.includes(rule));
      }
    }
  });

  it('only Teacher is told how to find the concepts a reviewer needs; Essentials keeps its short guideline', () => {
    const teacher = built.prompts['Teacher'] ?? '';
    for (const rule of PROFILES.pedagog.manner) {
      assert.ok(teacher.includes(rule));
    }
    assert.ok(!(built.prompts['Essentials'] ?? '').includes(PROFILES.pedagog.manner[1] ?? '-'));
    assert.match(built.prompts['Essentials'] ?? '', /Length: About two sentences for a normal step/);
  });
});
