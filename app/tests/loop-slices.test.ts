/**
 * DSP-209 S10a: the `dspatch-slices` block a fan-out is made from.
 *
 * Pure: the specification's example is accepted, and each refusal names its own problem.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseOwnedPath, pathsOverlap, readSlices } from '../src/shared/loop-slices';

const FENCE = '```';

function slice(id: string, ownedPaths: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    result: `The ${id} part is done.`,
    ownedPaths,
    allowedActions: ['edit-owned', 'run-targeted-tests'],
    contractRefs: [],
    verification: 'tests/markdown.test.ts',
    ...extra,
  };
}

function block(body: unknown): string {
  return `Here are the slices.\n\n${FENCE}dspatch-slices\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}\n${FENCE}\n`;
}

function codes(text: string, isolation: 'worktree' | 'shared-read-only' = 'worktree'): string[] {
  const read = readSlices(text, { isolation });
  return read.ok ? [] : read.problems.map((problem) => problem.code);
}

describe('the slice block (DSP-209 S10a)', () => {
  it('accepts the specification\'s example, with paths in their one written form', () => {
    const read = readSlices(
      block({
        slices: [
          slice('frontend', ['app/src/renderer/markdown.ts', './app/src/renderer/styles.css'], {
            contractRefs: ['docs/contracts/highlight-tokens.md@v1'],
          }),
          slice('tools', ['app\\src\\main\\tools/']),
        ],
      }),
      { isolation: 'worktree' },
    );
    assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.problems));
    assert.deepEqual(read.slices.map((item) => item.id), ['frontend', 'tools']);
    assert.deepEqual(read.slices[0]?.ownedPaths, ['app/src/renderer/markdown.ts', 'app/src/renderer/styles.css']);
    assert.deepEqual(read.slices[1]?.ownedPaths, ['app/src/main/tools']);
    assert.deepEqual(read.slices[0]?.contractRefs, ['docs/contracts/highlight-tokens.md@v1']);
  });

  it('refuses each malformed block with its own problem', () => {
    assert.deepEqual(codes('No block at all.'), ['no-slice-block']);
    assert.deepEqual(codes(block({ slices: [slice('a', ['x'])] }) + block({ slices: [slice('b', ['y'])] })), ['several-slice-blocks']);
    assert.deepEqual(codes(block('{ not json')), ['bad-slice-json']);
    assert.deepEqual(codes(block({ notSlices: [] })), ['bad-slice-json']);
    assert.deepEqual(codes(block({ slices: [] })), ['no-slices']);
    const seven = Array.from({ length: 7 }, (_, index) => slice(`s${String(index)}`, [`p${String(index)}`]));
    assert.deepEqual(codes(block({ slices: seven })), ['too-many-slices']);
  });

  it('refuses a slice with a missing field, an unsafe or duplicate id, or an unsafe path', () => {
    const { verification: _v, ...noVerification } = slice('a', ['x']);
    assert.deepEqual(codes(block({ slices: [noVerification] })), ['bad-slice']);
    assert.deepEqual(codes(block({ slices: [slice('../escape', ['x'])] })), ['unsafe-slice-id']);
    assert.deepEqual(codes(block({ slices: [slice('has space', ['x'])] })), ['unsafe-slice-id']);
    assert.deepEqual(codes(block({ slices: [slice('a.lock', ['x'])] })), ['unsafe-slice-id']);
    assert.deepEqual(codes(block({ slices: [slice('a', ['x']), slice('A', ['y'])] })), ['duplicate-slice-id']);
    for (const unsafe of ['.git/hooks/pre-commit', '.GIT', '/etc/passwd', 'C:/Windows', 'C:\\Windows', '../outside', 'app/../../outside', 'app/*.ts', '', 'a//b']) {
      assert.deepEqual(codes(block({ slices: [slice('a', [unsafe])] })), ['unsafe-owned-path'], unsafe);
    }
  });

  it('refuses overlapping write ownership: the same path, or one inside the other, whatever the case', () => {
    assert.deepEqual(codes(block({ slices: [slice('a', ['app/src']), slice('b', ['app/src/a.ts'])] })), ['overlapping-ownership']);
    assert.deepEqual(codes(block({ slices: [slice('a', ['app/src/A.ts']), slice('b', ['app/src/a.ts'])] })), ['overlapping-ownership']);
    assert.deepEqual(codes(block({ slices: [slice('a', ['app/src']), slice('b', ['app/srcx'])] })), [], 'a shared prefix is not a directory');
    assert.equal(pathsOverlap('docs', 'docs/loop/GRAPH_FORMAT.md'), true);
    assert.equal(pathsOverlap('docs/a.md', 'docs/b.md'), false);
  });

  it('needs owned paths for a writing branch, and not for a read-only one', () => {
    assert.deepEqual(codes(block({ slices: [slice('research', [])] }), 'worktree'), ['no-owned-paths']);
    assert.deepEqual(codes(block({ slices: [slice('research', [])] }), 'shared-read-only'), []);
  });

  it('writes an owned path in one form, or refuses it', () => {
    assert.equal(normaliseOwnedPath('./app\\src/'), 'app/src');
    assert.equal(normaliseOwnedPath('\\\\server\\share'), null);
    assert.equal(normaliseOwnedPath('app/./x'), null);
  });
});
