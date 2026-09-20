import assert from 'node:assert/strict';
import test from 'node:test';

import {
  markdownPlainText,
  parseInline,
  parseMarkdown,
  safeLinkHref,
  type MarkdownBlock,
  type MarkdownInline,
} from '../src/shared/markdown';

/**
 * DSP-59's two non-negotiable properties, and enough of the ordinary formatting to
 * know the reader works at all.
 *
 * The safety property is checked here rather than only in the window because it is
 * a property of the parser's output type: there is no node that can carry markup,
 * so the test is that suspicious input lands in nodes whose content is text.
 */

function inlineKinds(nodes: readonly MarkdownInline[]): readonly string[] {
  return nodes.map((node) => node.kind);
}

function firstBlock(source: string): MarkdownBlock {
  const blocks = parseMarkdown(source);
  assert.ok(blocks.length > 0, `nothing parsed from ${JSON.stringify(source)}`);
  return blocks[0] as MarkdownBlock;
}

test('headings lose their markers and keep their text', () => {
  const block = firstBlock('### Where the run stands');
  assert.equal(block.kind, 'heading');
  assert.equal(block.kind === 'heading' ? block.level : 0, 3);
  assert.equal(markdownPlainText([block]), 'Where the run stands');
});

test('emphasis and strong are read, and their markers do not survive as text', () => {
  const nodes = parseInline('**bold** and *italic* and _also italic_');
  assert.deepEqual(inlineKinds(nodes), [
    'strong',
    'text',
    'emphasis',
    'text',
    'emphasis',
  ]);
  assert.equal(
    nodes.map((node) => (node.kind === 'text' ? node.text : '')).join(''),
    ' and  and ',
  );
});

test('an underscore inside a word is not emphasis', () => {
  const nodes = parseInline('call chat_service_options twice');
  assert.deepEqual(inlineKinds(nodes), ['text']);
  assert.equal(nodes[0]?.kind === 'text' ? nodes[0].text : '', 'call chat_service_options twice');
});

test('bullet and ordered lists become lists, with nesting', () => {
  const blocks = parseMarkdown('- one\n- two\n  - inner\n');
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list?.kind, 'list');
  if (list?.kind !== 'list') {
    return;
  }
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  const second = list.items[1]?.blocks ?? [];
  assert.ok(
    second.some((block) => block.kind === 'list'),
    'the indented bullet should be a list inside the second item',
  );

  const ordered = parseMarkdown('3. third\n4. fourth')[0];
  assert.equal(ordered?.kind, 'list');
  assert.equal(ordered?.kind === 'list' ? ordered.ordered : false, true);
  assert.equal(ordered?.kind === 'list' ? ordered.start : 0, 3);
});

/* ------------------------------------------------------------------------- */
/* AC#3: literal characters inside code and code-like content                 */
/* ------------------------------------------------------------------------- */

test('a fenced block keeps every character, markers included', () => {
  const source = [
    'Here is the syntax:',
    '',
    '```markdown',
    '### A heading',
    'Use **two asterisks** and `backticks`.',
    '  indented \\* escape * _under_',
    '```',
  ].join('\n');
  const blocks = parseMarkdown(source);
  const code = blocks.find((block) => block.kind === 'code');
  assert.ok(code !== undefined && code.kind === 'code');
  assert.equal(code.language, 'markdown');
  assert.equal(code.closed, true);
  assert.equal(
    code.text,
    '### A heading\nUse **two asterisks** and `backticks`.\n  indented \\* escape * _under_',
  );
});

test('a shell command keeps its quoting, pipes and asterisks', () => {
  const command = 'rg --glob "*.ts" -n "a && b" | head -n 5 # keep * and _ and **';
  const code = firstBlock(['```bash', command, '```'].join('\n'));
  assert.equal(code.kind === 'code' ? code.text : '', command);
});

test('an inline code span is literal and its neighbours are not', () => {
  const nodes = parseInline('write `**not bold**` but **this is**');
  assert.deepEqual(inlineKinds(nodes), ['text', 'code', 'text', 'strong']);
  assert.equal(nodes[1]?.kind === 'code' ? nodes[1].text : '', '**not bold**');
});

test('an unmatched marker stays as the character the writer typed', () => {
  const nodes = parseInline('the ** marker means bold, and * means italic');
  assert.deepEqual(inlineKinds(nodes), ['text']);
  assert.equal(
    nodes[0]?.kind === 'text' ? nodes[0].text : '',
    'the ** marker means bold, and * means italic',
  );
});

test('a backslash escape shows the marker and not the escape', () => {
  const nodes = parseInline('literal \\*asterisks\\* here');
  assert.equal(
    nodes.map((node) => (node.kind === 'text' ? node.text : '')).join(''),
    'literal *asterisks* here',
  );
});

/* ------------------------------------------------------------------------- */
/* AC#4: model output never becomes executable HTML or script                 */
/* ------------------------------------------------------------------------- */

test('HTML in a reply parses to text, not to a node that could be markup', () => {
  const source = '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">';
  const blocks = parseMarkdown(source);
  for (const block of blocks) {
    assert.ok(
      block.kind === 'paragraph',
      `expected plain paragraphs, got ${block.kind}`,
    );
  }
  const text = markdownPlainText(blocks);
  assert.ok(text.includes('<script>alert(1)</script>'));
  assert.ok(text.includes('<img src=x onerror="alert(2)">'));
  // Every node carrying that text is a text node. There is no other kind it
  // could be, which is the property the renderer relies on.
  const kinds = new Set(
    blocks.flatMap((block) =>
      block.kind === 'paragraph' ? inlineKinds(block.content) : [],
    ),
  );
  assert.deepEqual([...kinds], ['text']);
});

test('a link target that is not http, https or mailto keeps its text and loses its target', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    ' \u0001javascript:alert(1)',
  ]) {
    assert.equal(safeLinkHref(hostile), null, `${hostile} must be refused`);
    const node = parseInline(`[click](${hostile})`)[0];
    assert.equal(node?.kind, 'link');
    assert.equal(node?.kind === 'link' ? node.href : 'not-a-link', null);
    assert.equal(
      node?.kind === 'link' ? markdownPlainText([{ kind: 'paragraph', content: node.children }]) : '',
      'click',
    );
  }
});

test('ordinary links keep their target', () => {
  assert.equal(safeLinkHref('https://example.test/x?y=1'), 'https://example.test/x?y=1');
  assert.equal(safeLinkHref('mailto:someone@example.test'), 'mailto:someone@example.test');
  const node = parseInline('[docs](https://example.test/docs "title")')[0];
  assert.equal(node?.kind === 'link' ? node.href : null, 'https://example.test/docs');
});

/* ------------------------------------------------------------------------- */
/* AC#5: the same text, half way through arriving                             */
/* ------------------------------------------------------------------------- */

test('every prefix of a reply parses, and an open fence stays a code block', () => {
  const reply = [
    '## Result',
    '',
    'Two things changed:',
    '',
    '1. `scroll-follow.ts` decides',
    '2. the transcript is the **only** scroller',
    '',
    '```ts',
    'const x = a && b;',
    '```',
    '',
    'Done.',
  ].join('\n');

  for (let length = 1; length <= reply.length; length += 1) {
    const prefix = reply.slice(0, length);
    assert.doesNotThrow(() => parseMarkdown(prefix), `prefix of ${String(length)} threw`);
  }

  const halfway = reply.slice(0, reply.indexOf('const x') + 'const x = a &'.length);
  const open = parseMarkdown(halfway).find((block) => block.kind === 'code');
  assert.ok(open !== undefined && open.kind === 'code');
  assert.equal(open.closed, false);
  assert.equal(open.text, 'const x = a &');
});

test('nothing but markers is removed from an ordinary reply', () => {
  const reply = [
    '# Title',
    '',
    'A paragraph with **strong**, *stress* and a [link](https://example.test).',
    '',
    '- first',
    '- second',
  ].join('\n');
  const text = markdownPlainText(parseMarkdown(reply));
  for (const fragment of [
    'Title',
    'A paragraph with strong, stress and a link.',
    'first',
    'second',
  ]) {
    assert.ok(text.includes(fragment), `${fragment} is missing from ${text}`);
  }
  assert.ok(!text.includes('#'));
  assert.ok(!text.includes('**'));
});
