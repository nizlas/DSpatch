import assert from 'node:assert/strict';
import test from 'node:test';

import { ordinal } from '../src/shared/ordinal';

test('ordinals read as words to four and take the right suffix after', () => {
  assert.deepEqual(
    [2, 3, 4, 5, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal),
    ['second', 'third', 'fourth', '5th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th'],
  );
});
