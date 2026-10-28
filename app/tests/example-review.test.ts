/**
 * The bundled example review (DSP-129): where *Open example review* finds it, the
 * refusal outside a clone, and that the bundled definition is the DSP-116 walk with
 * only its repository changed to the clone root.
 *
 *     node --test tests/example-review.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locateExampleReview } from '../src/main/example-review.ts';
import { ownRepositoryRoot } from '../src/main/own-repository.ts';
import { parseReviewDefinition } from '../src/shared/review-model.ts';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('outside a clone the example is refused, saying a DSpatch clone is needed', () => {
  const outcome = locateExampleReview(null, () => true);
  assert.equal(outcome.kind, 'unavailable');
  assert.match(outcome.kind === 'unavailable' ? outcome.note : '', /clone of the DSpatch repository/);
});

test('in a clone without the example file the refusal names where it was looked for', () => {
  const root = path.resolve('some', 'clone');
  const outcome = locateExampleReview(root, () => false);
  assert.equal(outcome.kind, 'unavailable');
  assert.match(outcome.kind === 'unavailable' ? outcome.note : '', /examples\/review\/dsp-116\.review\.json/);
});

test('in a clone the example is the file under examples/review, resolved from that clone', () => {
  const root = path.resolve('some', 'clone');
  const asked: string[] = [];
  const outcome = locateExampleReview(root, (file) => {
    asked.push(file);
    return true;
  });
  const expected = path.join(root, 'examples', 'review', 'dsp-116.review.json');
  assert.deepEqual(outcome, { kind: 'found', definitionPath: expected, repositoryRoot: root });
  assert.deepEqual(asked, [expected]);
});

test('the bundled definition is the DSP-116 walk and names the clone it is in as its repository', () => {
  const root = ownRepositoryRoot(appDir);
  assert.notEqual(root, null, 'these tests run from a DSpatch clone');
  const located = locateExampleReview(root);
  assert.equal(located.kind, 'found');
  const definitionPath = located.kind === 'found' ? located.definitionPath : '';
  const text = fs.readFileSync(definitionPath, 'utf8');

  // The content as bundled: the original (sha256 9c6119d8…) with `repository` changed
  // from "repo" to "../..", and the explanations reworked for readability in DSP-152
  // (README). Hashed with LF line ends, so a clone with either checkout convention gives
  // the same answer.
  assert.equal(
    createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex'),
    'e3743de0082ce699b101ad1a6e0bfd98a5f4eca112891c9018454cda4cee7d85',
  );

  const { definition, problems } = parseReviewDefinition(JSON.parse(text));
  assert.notEqual(definition, null, problems.map((entry) => entry.problem).join(' '));
  if (definition === null) {
    return;
  }
  assert.equal(definition.repository, '../..');
  assert.equal(path.resolve(path.dirname(definitionPath), definition.repository), path.resolve(root ?? ''));
  assert.equal(definition.base, '5e445c3305b019f43f3a319cc74d802bc748eae9');
  assert.equal(definition.target, '73aaddc1e7d69662159bab117feedfb92384f85c');
  assert.deepEqual(
    definition.walks.map((walk) => [walk.id, walk.steps.length]),
    [
      ['W1', 10],
      ['W2', 8],
      ['W3', 4],
    ],
  );
});
