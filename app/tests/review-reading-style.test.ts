/**
 * DSP-181: one reading typography for every explanation and answer in the review. The profile
 * steers what the text says, never its CSS: the prepared explanation, a profile's alternative,
 * a deepening under a step and an answer in the discussion all carry `rv-reading`, and no
 * surface keeps a rule of its own for the Markdown it shows. This reads the sources, so it
 * holds whatever window the text is in, docked or standalone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const renderer = path.resolve(fileURLToPath(new URL('../src/renderer', import.meta.url)));
const css = fs.readFileSync(path.join(renderer, 'review.css'), 'utf8');
const view = fs.readFileSync(path.join(renderer, 'ReviewView.tsx'), 'utf8');
const answer = fs.readFileSync(path.join(renderer, 'DiscussionAnswer.tsx'), 'utf8');

/** The selectors of every rule in the stylesheet, one string per rule. */
function selectors(stylesheet: string): readonly string[] {
  return [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)].map((match) => (match[1] ?? '').trim()).filter((entry) => entry !== '' && !entry.startsWith('@'));
}

describe('one reading typography (DSP-181)', () => {
  it('the shared block sets paragraphs, lists, nested lists, headings, inline code, code blocks, quotes, tables and links', () => {
    for (const selector of [
      '.rv-reading .markdown__p',
      '.rv-reading .markdown__h',
      '.rv-reading .markdown__list li',
      '.rv-reading .markdown__list .markdown__list',
      '.rv-reading .markdown__code',
      '.rv-reading .markdown__pre',
      '.rv-reading .markdown__code-block',
      '.rv-reading .markdown__quote',
      '.rv-reading .markdown__table',
      '.rv-reading .markdown__link',
    ]) {
      assert.ok(selectors(css).some((entry) => entry.split(',').map((one) => one.trim()).includes(selector)), `missing: ${selector}`);
    }
    assert.match(css, /\.rv-prepared \.markdown__p \{\s*white-space: pre-line;/, 'only the prepared explanation keeps its hard line breaks');
  });

  it('no surface keeps Markdown typography of its own beside the shared block', () => {
    const own = selectors(css).filter((entry) =>
      entry
        .split(',')
        .map((one) => one.trim())
        .some((one) => /\.markdown/.test(one) && !one.startsWith('.rv-reading') && !one.startsWith('.rv-prepared') && !one.startsWith('.rv-place ') && !one.startsWith('.rv-evidence-detail')),
    );
    assert.deepEqual(own, [], `surfaces with Markdown rules of their own: ${own.join(' | ')}`);
  });

  it('every explanation and answer carries rv-reading, and only the prepared text is rv-prepared', () => {
    assert.match(view, /className="rv-profile-explanation rv-explanation rv-reading"/, 'the profile alternative');
    assert.match(view, /className="rv-explanation rv-reading rv-prepared" data-ev="step-prepared-explanation"/, 'the prepared body');
    assert.equal((view.match(/rv-explanation rv-reading rv-prepared/g) ?? []).length, 2, 'the prepared body and its why');
    assert.ok(!/rv-profile-explanation[^"]*rv-prepared/.test(view), 'an alternative never keeps hard line breaks');
    assert.match(answer, /className="rv-answer rv-reading"/, 'every discussion answer, under a step or in the thread');
  });
});
