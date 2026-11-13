/**
 * Syntax colours for the review surface's code (DSP-206): highlight.js over a revision's
 * whole file, read back as tokens per line. The code view must still draw the exact text,
 * so every test also checks that each line's tokens join to the line itself.
 *
 *     node --test tests/syntax.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HIGHLIGHT_LIMIT, highlightLines, languageOf, tokensOfHtml, type Token, type TokenKind } from '../src/renderer/syntax.ts';

function exact(lines: readonly string[], tokens: readonly (readonly Token[])[]): void {
  assert.equal(tokens.length, lines.length);
  tokens.forEach((line, index) => {
    assert.equal(line.map((token) => token.text).join(''), lines[index], `line ${String(index + 1)}`);
  });
}

/** The coloured pieces of a line, as [kind, text]. */
const coloured = (line: readonly Token[] | undefined): [TokenKind, string][] =>
  (line ?? []).filter((token) => token.kind !== 'plain').map((token) => [token.kind, token.text]);

const kindsOf = (line: readonly Token[] | undefined): Set<TokenKind> => new Set((line ?? []).map((token) => token.kind));

const CPP = [
  '#include <vector>',
  '/* Box keeps one value.',
  '   It is copied, never shared. */',
  'template <typename T> class Box {',
  'public:',
  '  explicit Box(T value) : value_(value) {}',
  '  const char *label() const { return "box"; } // the name',
  '  static constexpr int kSize = 0x10;',
  '};',
  'int add(int a, int b) { return a + b; }',
  'void run() { auto x = add(1, 2); printf("%d\\n", x); }',
];

test('C++: comments, strings, keywords, types, function names and preprocessor lines are told apart', () => {
  const tokens = highlightLines(CPP, 'src/box.cpp');
  exact(CPP, tokens);
  assert.deepEqual(coloured(tokens[0]), [
    ['meta', '#'],
    ['keyword', 'include'],
    ['meta', ' '],
    ['string', '<vector>'],
  ]);
  assert.deepEqual(coloured(tokens[1]), [['comment', '/* Box keeps one value.']]);
  assert.deepEqual(coloured(tokens[2]), [['comment', '   It is copied, never shared. */']]);
  assert.deepEqual(coloured(tokens[3]), [
    ['keyword', 'template'],
    ['keyword', 'typename'],
    ['keyword', 'class'],
    ['type', 'Box'],
  ]);
  assert.ok(coloured(tokens[6]).some(([kind, text]) => kind === 'string' && text === '"box"'));
  assert.ok(coloured(tokens[6]).some(([kind, text]) => kind === 'comment' && text === '// the name'));
  assert.ok(coloured(tokens[6]).some(([kind, text]) => kind === 'function' && text === 'label'));
  assert.ok(coloured(tokens[7]).some(([kind, text]) => kind === 'number' && text === '0x10'));
  assert.deepEqual(coloured(tokens[9]).slice(0, 3), [
    ['type', 'int'],
    ['function', 'add'],
    ['type', 'int'],
  ]);
  // A call is a function name too (C++'s grammar calls it built_in).
  assert.ok(coloured(tokens[10]).some(([kind, text]) => kind === 'function' && text === 'printf'));
  // The enclosing scopes of a declaration colour nothing themselves: the parameters stay plain.
  assert.ok(tokens[9]?.some((token) => token.kind === 'plain' && token.text.includes(' a, ')));
});

test('C: a header and a source file are highlighted; a struct name is a type', () => {
  const lines = ['typedef struct node { int value; } node_t;', 'static int count(const node_t *n);', '#define LIMIT 10'];
  for (const path of ['list.c', 'list.h']) {
    const tokens = highlightLines(lines, path);
    exact(lines, tokens);
    assert.ok(kindsOf(tokens[0]).has('keyword'), path);
    assert.ok(kindsOf(tokens[1]).has('type'), path);
    assert.ok(kindsOf(tokens[2]).has('keyword'), path);
  }
});

test('a visible place that starts inside a block comment is coloured as the comment it is in', () => {
  const file = ['int a = 1;', '/*', ' * int b = 2; "not a string"', ' * return a;', ' */', 'int c = 3;'];
  const tokens = highlightLines(file, 'x.cpp');
  exact(file, tokens);
  // A pane that shows only lines 3–4 shows these tokens: the whole file decided them.
  assert.deepEqual(coloured(tokens[2]), [['comment', ' * int b = 2; "not a string"']]);
  assert.deepEqual(coloured(tokens[3]), [['comment', ' * return a;']]);
  assert.ok(kindsOf(tokens[5]).has('type'));
});

test('base and target are each coloured from their own file', () => {
  const base = ['int f() {', '  return 1; /* old', '  still old */', '}'];
  const target = ['int f() {', '  return 1;', '  int still = 0; // new', '}'];
  const left = highlightLines(base, 'f.cpp');
  const right = highlightLines(target, 'f.cpp');
  exact(base, left);
  exact(target, right);
  assert.deepEqual(coloured(left[2]), [['comment', '  still old */']]);
  assert.ok(kindsOf(right[2]).has('type'));
  assert.ok(coloured(right[2]).some(([kind, text]) => kind === 'comment' && text === '// new'));
});

test('common project languages are highlighted, and every character is kept', () => {
  const samples: Record<string, string[]> = {
    'a.ts': ['export function f(a: number): string {', '  return `x${a}` + "y"; // t', '}'],
    'a.tsx': ['const A = () => <div className="a">{1}</div>;'],
    'a.py': ['def f(a):', '    """doc', '    more"""', '    return len(a)  # c'],
    'a.rs': ['fn main() { let s = "x"; } // c'],
    'a.go': ['func main() { fmt.Println("x") } // c'],
    'A.java': ['public class A { int f() { return 1; } }'],
    'a.cs': ['public class A { string S => "x"; }'],
    'a.sh': ['echo "$HOME" # c'],
    'a.json': ['{"a": [1, true, null]}'],
    'a.yml': ['a: "b" # c'],
    'Makefile': ['all:', '\tcc -o a a.c # c'],
    'CMakeLists.txt': ['add_executable(a a.c) # c'],
  };
  for (const [path, lines] of Object.entries(samples)) {
    assert.notEqual(languageOf(path), null, path);
    const tokens = highlightLines(lines, path);
    exact(lines, tokens);
    assert.ok(tokens.some((line) => line.some((token) => token.kind !== 'plain')), path);
  }
});

test('an unknown language, an empty file and a file without an extension are shown plain', () => {
  for (const path of ['notes.unknownext', 'LICENSE', 'readme.txt', '']) {
    assert.equal(languageOf(path), null, path);
    const lines = ['a /* b', 'c "d'];
    assert.deepEqual(highlightLines(lines, path), [[{ kind: 'plain', text: 'a /* b' }], [{ kind: 'plain', text: 'c "d' }]]);
  }
  assert.deepEqual(highlightLines([], 'x.cpp'), []);
  assert.deepEqual(highlightLines([''], 'x.cpp'), [[]]);
});

test('text the highlighter escapes, tabs, carriage returns, non-ASCII and unclosed constructs come back exact', () => {
  const lines = [
    '\tif (a < b && c > d) { s = "<tag> & \'q\'"; }\r',
    '  // ÅÄÖ 😀 &amp; &lt;',
    'char *p = "unterminated',
    '/* never closed',
    'x &= y;',
  ];
  for (const path of ['x.cpp', 'x.ts', 'x.py', 'x.html']) {
    exact(lines, highlightLines(lines, path));
  }
});

test('the HTML reader keeps nesting and splits spans that cross lines', () => {
  const tokens = tokensOfHtml('<span class="hljs-comment">/* a\nb */</span> <span class="hljs-meta">#<span class="hljs-keyword">if</span> X</span>&amp;&lt;');
  assert.deepEqual(tokens, [
    [{ kind: 'comment', text: '/* a' }],
    [
      { kind: 'comment', text: 'b */' },
      { kind: 'plain', text: ' ' },
      { kind: 'meta', text: '#' },
      { kind: 'keyword', text: 'if' },
      { kind: 'meta', text: ' X' },
      { kind: 'plain', text: '&<' },
    ],
  ]);
});

test("a file's tokens are worked out once while its lines are the same", () => {
  const lines = ['int a = 1;'];
  assert.equal(highlightLines(lines, 'a.cpp'), highlightLines(lines, 'a.cpp'));
  assert.notEqual(highlightLines([...lines], 'a.cpp'), highlightLines(lines, 'a.cpp'));
});

test('a file over the limit is shown plain rather than holding the window up', () => {
  const lines = Array.from({ length: Math.ceil(HIGHLIGHT_LIMIT / 20) + 10 }, (_, index) => `int v${String(index)} = 0; // x`);
  const tokens = highlightLines(lines, 'big.cpp');
  exact(lines, tokens);
  assert.ok(tokens.every((line) => line.every((token) => token.kind === 'plain')));
});
