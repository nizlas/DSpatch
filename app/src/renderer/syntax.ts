import hljs from 'highlight.js/lib/common';
import cmake from 'highlight.js/lib/languages/cmake';
import dockerfile from 'highlight.js/lib/languages/dockerfile';

/**
 * Syntax colours for the review surface's code (DSP-206): highlight.js, an established
 * highlighter with grammars for C, C++ and the other common project languages, run over a
 * revision's whole file so that a visible place starting inside a block comment or a string
 * is coloured as one. Its output is turned back into each line's tokens, every character of
 * the line kept, so the code view draws exact text and only the token colours are new.
 * A file whose language is not known here is shown plain.
 */

hljs.registerLanguage('cmake', cmake);
hljs.registerLanguage('dockerfile', dockerfile);

/** What a token's colour says. The view's palette names one colour for each. */
export type TokenKind = 'plain' | 'keyword' | 'type' | 'function' | 'string' | 'comment' | 'number' | 'meta';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

/** Larger files are shown plain: highlighting them would hold the window up. */
export const HIGHLIGHT_LIMIT = 1_000_000;

/** File names that say their language where their extension does not. */
const BY_NAME: Readonly<Record<string, string>> = {
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'cmake',
  dockerfile: 'dockerfile',
};

/**
 * Extensions highlight.js names differently, or not at all. A header is read as C++, a
 * superset for colouring purposes, since C++ projects use `.h` as often as C projects do.
 */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  h: 'cpp',
  ipp: 'cpp',
  tpp: 'cpp',
  inl: 'cpp',
  cu: 'cpp',
  mts: 'typescript',
  cts: 'typescript',
  pyi: 'python',
  htm: 'xml',
  txt: 'plaintext',
};

/** The highlight.js language for a path, or null when it has none (shown plain). */
export function languageOf(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
  const known = BY_NAME[name];
  if (known !== undefined) {
    return known;
  }
  const dot = name.lastIndexOf('.');
  if (dot === -1) {
    return null;
  }
  const extension = name.slice(dot + 1);
  const language = BY_EXTENSION[extension] ?? extension;
  // Only a language that highlight.js knows by this name or alias; a language is never guessed.
  return language !== 'plaintext' && hljs.getLanguage(language) !== undefined ? language : null;
}

/** How a language's code is structured, for finding the function or section a place lies in (DSP-207). */
export type LanguageFamily = 'brace' | 'indent' | 'yaml' | 'ini' | 'markdown';

const FAMILIES: Readonly<Record<string, LanguageFamily>> = {
  c: 'brace',
  cpp: 'brace',
  csharp: 'brace',
  java: 'brace',
  javascript: 'brace',
  typescript: 'brace',
  go: 'brace',
  rust: 'brace',
  kotlin: 'brace',
  swift: 'brace',
  php: 'brace',
  objectivec: 'brace',
  css: 'brace',
  scss: 'brace',
  less: 'brace',
  python: 'indent',
  yaml: 'yaml',
  ini: 'ini',
  markdown: 'markdown',
};

/** The name of a path's language among those whose structure is read (DSP-207), or null. */
export function structureLanguage(path: string): string | null {
  const language = languageOf(path);
  const grammar = language === null ? undefined : hljs.getLanguage(language);
  if (grammar === undefined) {
    return null;
  }
  return Object.keys(FAMILIES).find((name) => hljs.getLanguage(name) === grammar) ?? null;
}

/** The structure family of a path's language, or null where none is known (DSP-207). */
export function languageFamily(path: string): LanguageFamily | null {
  const name = structureLanguage(path);
  return name === null ? null : (FAMILIES[name] ?? null);
}

/**
 * A highlight.js scope's colour. The first part of a scope names it (`title.function` is a
 * title); the rest refines it. Scopes not listed are plain: operators, punctuation,
 * variables, properties and parameters keep the text colour, and so do the scopes that
 * only enclose others (`function`, `class`, `params`). A diff language's `addition` and
 * `deletion` are plain too, so that only the row backgrounds say what changed.
 *
 * Two scopes depend on where they are. A bare `title` names a class inside a `class`
 * scope and a function elsewhere. `built_in` is a built-in type in most grammars, but C's
 * and C++'s use it for called functions (`malloc`, `std::move`, `obj.method`).
 */
function kindOfScope(scope: string, enclosing: string, builtInCalls: boolean): TokenKind | null {
  const [head = '', ...rest] = scope.split('.');
  switch (head) {
    case 'comment':
    case 'doctag':
    case 'quote':
      return 'comment';
    case 'string':
    case 'regexp':
    case 'char':
    case 'link':
    case 'code':
      return 'string';
    case 'keyword':
    case 'tag':
    case 'name':
    case 'section':
    case 'bullet':
    case 'selector-tag':
      return 'keyword';
    case 'built_in':
      return builtInCalls ? 'function' : 'type';
    case 'type':
    case 'attr':
    case 'attribute':
    case 'selector-class':
    case 'selector-id':
      return 'type';
    case 'title':
      return rest[0] === 'class' || (rest.length === 0 && enclosing.split('.')[0] === 'class') ? 'type' : 'function';
    case 'number':
    case 'literal':
    case 'symbol':
      return 'number';
    case 'meta':
    case 'template-variable':
    case 'template-tag':
      return rest[0] === 'string' ? 'string' : rest[0] === 'keyword' ? 'keyword' : 'meta';
    case 'variable':
      return rest[0] === 'language' ? 'keyword' : null;
    default:
      return null;
  }
}

/**
 * A highlight.js `class` attribute's scope: `hljs-title function_` is `title.function`,
 * `hljs-meta hljs-keyword`... are nested scopes and carry the last one.
 */
function scopeOfClass(className: string): string {
  const parts = className.split(/\s+/).filter((part) => part !== '');
  let scope = '';
  for (const part of parts) {
    if (part.startsWith('hljs-')) {
      scope = part.slice(5);
    } else if (part.endsWith('_')) {
      scope += `.${part.replace(/_+$/, '')}`;
    }
  }
  return scope;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * highlight.js's HTML, read back as tokens per line. Its output is escaped text and
 * `<span class="…">` elements only; a span that crosses a line break colours both lines.
 */
export function tokensOfHtml(html: string, builtInCalls = false): Token[][] {
  const lines: Token[][] = [[]];
  const stack: (TokenKind | null)[] = [];
  const scopes: string[] = [];
  const push = (text: string): void => {
    let kind: TokenKind = 'plain';
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const scoped = stack[index];
      if (scoped !== null && scoped !== undefined) {
        kind = scoped;
        break;
      }
    }
    const pieces = text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (piece === '') {
        return;
      }
      const line = lines[lines.length - 1] as Token[];
      const last = line[line.length - 1];
      if (last !== undefined && last.kind === kind) {
        line[line.length - 1] = { kind, text: last.text + piece };
      } else {
        line.push({ kind, text: piece });
      }
    });
  };
  const tag = /<span class="([^"]*)">|<\/span>/g;
  let at = 0;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    if (match.index > at) {
      push(decode(html.slice(at, match.index)));
    }
    if (match[1] === undefined) {
      stack.pop();
      scopes.pop();
    } else {
      const scope = scopeOfClass(match[1]);
      stack.push(kindOfScope(scope, scopes[scopes.length - 1] ?? '', builtInCalls));
      scopes.push(scope);
    }
    at = tag.lastIndex;
  }
  if (at < html.length) {
    push(decode(html.slice(at)));
  }
  return lines;
}

const plain = (lines: readonly string[]): Token[][] => lines.map((line) => (line === '' ? [] : [{ kind: 'plain', text: line }]));

/**
 * One revision's file, as tokens per line. The lines are one side's whole file, never a
 * place cut out of it and never the other side's. Each file's tokens are worked out once
 * per language and kept while its lines are: panes, scrolling and re-renders ask again.
 */
const remembered = new WeakMap<readonly string[], Map<string, Token[][]>>();

export function highlightLines(lines: readonly string[], path: string): Token[][] {
  const language = languageOf(path);
  const key = language ?? '';
  let byLanguage = remembered.get(lines);
  const known = byLanguage?.get(key);
  if (known !== undefined) {
    return known;
  }
  const tokens = language === null ? plain(lines) : highlighted(lines, language);
  if (byLanguage === undefined) {
    byLanguage = new Map();
    remembered.set(lines, byLanguage);
  }
  byLanguage.set(key, tokens);
  return tokens;
}

function highlighted(lines: readonly string[], language: string): Token[][] {
  const text = lines.join('\n');
  if (text.length > HIGHLIGHT_LIMIT) {
    return plain(lines);
  }
  try {
    const grammar = hljs.getLanguage(language);
    const builtInCalls = grammar === hljs.getLanguage('c') || grammar === hljs.getLanguage('cpp');
    const tokens = tokensOfHtml(hljs.highlight(text, { language, ignoreIllegals: true }).value, builtInCalls);
    // Every character is kept, or the file is shown plain: the view must draw exact code.
    const exact = tokens.length === lines.length && tokens.every((line, index) => line.map((token) => token.text).join('') === lines[index]);
    return exact ? tokens : plain(lines);
  } catch {
    return plain(lines);
  }
}
