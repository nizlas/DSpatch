/**
 * Which working copies share the repeat block (DSP-4 rework WS-1 #11, review 004 S8).
 *
 * `workingCopiesOverlap` is the unit of the repeat block: an unresolved attempt blocks
 * the same kind of work in its own folder, in any folder inside it and in any folder
 * that contains it, and nowhere else. A pure function of two paths and a platform, so
 * both platforms' rules are checked here on any machine; nothing is read from disk.
 *
 *     node scripts/run-tests.mjs chat        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { workingCopiesOverlap } from '../src/main/chat-service.ts';

test('the same folder, a nested one and a containing one share a working copy', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const root = platform === 'win32' ? 'C:\\work\\project' : '/work/project';
    const inside = platform === 'win32' ? 'C:\\work\\project\\app' : '/work/project/app';
    assert.equal(workingCopiesOverlap(root, root, platform), true, `${platform}: same`);
    assert.equal(workingCopiesOverlap(root, inside, platform), true, `${platform}: nested`);
    assert.equal(workingCopiesOverlap(inside, root, platform), true, `${platform}: containing`);
    const trailing = platform === 'win32' ? 'C:\\work\\project\\' : '/work/project/';
    assert.equal(workingCopiesOverlap(trailing, inside, platform), true, `${platform}: trailing separator`);
  }
});

test('a sibling whose name starts with the same letters is another working copy', () => {
  assert.equal(workingCopiesOverlap('C:\\work\\project', 'C:\\work\\project-two', 'win32'), false);
  assert.equal(workingCopiesOverlap('C:\\work\\project-two\\app', 'C:\\work\\project', 'win32'), false);
  assert.equal(workingCopiesOverlap('/work/project', '/work/project-two', 'linux'), false);
  assert.equal(workingCopiesOverlap('/work/a', '/work/b', 'linux'), false);
});

test('case decides on Linux and does not on Windows', () => {
  assert.equal(workingCopiesOverlap('C:\\Work\\Project', 'c:\\work\\project\\APP', 'win32'), true);
  assert.equal(workingCopiesOverlap('/work/Project', '/work/project', 'linux'), false);
  assert.equal(workingCopiesOverlap('/work/Project', '/work/Project/app', 'linux'), true);
});
