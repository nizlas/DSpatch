import { referenceRows, type DiffRow, type Place, type RevisionSide } from '../shared/review-model';
import { HIGHLIGHT_LIMIT, highlightLines, languageFamily, structureLanguage } from './syntax';

/**
 * The code a walk place lies in (DSP-207): the enclosing function or method with its
 * documentation, whole signature, body and end; outside functions a declaration, a class or
 * a configuration section; where the structure cannot be read, the lines around the place,
 * said to be no more than that. It is read from one revision's own text, with the comments
 * and strings the syntax colours found (syntax.ts) set aside, so a brace or a keyword in a
 * comment or a string never counts. It decides what a pane shows, never what Accept, a
 * delegation or the coverage include.
 */

export type StructureKind = 'function' | 'method' | 'constructor' | 'class' | 'declaration' | 'section' | 'nearby';

export interface CodeStructure {
  readonly kind: StructureKind;
  /** The function's, class's or section's name, when the code says it. */
  readonly name: string;
  /** Lines, from 1: the first (its documentation or decorators), the signature's last, and the last. */
  readonly start: number;
  readonly headEnd: number;
  readonly end: number;
  /** The innermost control structure (if, loop, try, …) around the place inside it, when there is one. */
  readonly control: { readonly start: number; readonly end: number } | null;
  /** False for the lines-around fallback: no boundary was found, and none is claimed. */
  readonly reliable: boolean;
}

/** A file's code with comments and strings blanked, and which lines are comment only. */
interface Masked {
  readonly code: readonly string[];
  readonly commentOnly: readonly boolean[];
  /**
   * False when the highlighter could not read the file (over its size limit): comments and strings
   * are then not set aside, and no boundary read from the code can be relied on.
   */
  readonly complete: boolean;
}

/** Languages whose preprocessor lines (`#define`, `#if`, …) are set aside: a brace in a macro is no block. */
const PREPROCESSED = new Set(['c', 'cpp', 'objectivec', 'csharp']);

const masks = new WeakMap<readonly string[], Map<string, Masked>>();

function masked(lines: readonly string[], path: string): Masked {
  const known = masks.get(lines)?.get(path);
  if (known !== undefined) {
    return known;
  }
  const tokens = highlightLines(lines, path);
  const code: string[] = [];
  const commentOnly: boolean[] = [];
  const preprocessed = PREPROCESSED.has(structureLanguage(path) ?? '');
  let continued = false;
  lines.forEach((line, index) => {
    // A preprocessor line, and the lines a trailing backslash continues it on, hold no code here.
    if (preprocessed && (continued || /^\s*#/.test(line))) {
      continued = /\\\s*$/.test(line);
      code.push(' '.repeat(line.length));
      commentOnly.push(false);
      return;
    }
    const parts = tokens[index] ?? [{ kind: 'plain' as const, text: line }];
    let text = '';
    let hasComment = false;
    for (const token of parts) {
      if (token.kind === 'comment' || token.kind === 'string') {
        hasComment ||= token.kind === 'comment';
        text += ' '.repeat(token.text.length);
      } else {
        text += token.text;
      }
    }
    code.push(text);
    commentOnly.push(hasComment && text.trim() === '');
  });
  const size = lines.reduce((total, line) => total + line.length + 1, 0);
  const result = { code, commentOnly, complete: size <= HIGHLIGHT_LIMIT };
  const byPath = masks.get(lines) ?? new Map<string, Masked>();
  byPath.set(path, result);
  masks.set(lines, byPath);
  return result;
}

/**
 * The structure around lines `start`–`end` of `lines` (one revision's whole file). Never null:
 * where nothing better is found, the lines around the place (`nearby`, not reliable).
 */
export function codeStructure(lines: readonly string[], path: string, start: number, end: number): CodeStructure {
  const family = languageFamily(path);
  if ((family === 'brace' || family === 'indent') && !masked(lines, path).complete) {
    return nearby(lines, start, end);
  }
  const found =
    family === 'brace' ? braceStructure(lines, path, start, end)
    : family === 'indent' ? indentStructure(lines, path, start, end)
    : family === 'yaml' ? yamlSection(lines, start)
    : family === 'ini' ? iniSection(lines, start)
    : family === 'markdown' ? markdownSection(lines, start)
    : null;
  return found ?? nearby(lines, start, end);
}

// --- Brace languages: C, C++, C#, Java, JavaScript, TypeScript, Go, Rust, Kotlin, Swift, PHP, … ---

interface Block {
  readonly open: number;
  readonly close: number;
  readonly headerStart: number;
  readonly header: string;
}

interface Blocks {
  readonly blocks: readonly Block[];
  /** Every brace closed one opened before it, and none left open: otherwise a macro or a conditional build broke them, and no boundary is relied on. */
  readonly balanced: boolean;
}

const blockCache = new WeakMap<readonly string[], Map<string, Blocks>>();

/** Every `{ … }` of the file, with the text before its brace back to the previous statement. */
function blocksOf(lines: readonly string[], path: string): Blocks {
  const known = blockCache.get(lines)?.get(path);
  if (known !== undefined) {
    return known;
  }
  const { code, commentOnly } = masked(lines, path);
  const blocks: Block[] = [];
  const stack: { line: number; column: number }[] = [];
  let balanced = true;
  code.forEach((text, index) => {
    for (let column = 0; column < text.length; column += 1) {
      const char = text[column];
      if (char === '{') {
        stack.push({ line: index + 1, column });
      } else if (char === '}') {
        const open = stack.pop();
        if (open === undefined) {
          balanced = false;
        } else {
          const { headerStart, header } = headerOf(code, commentOnly, open.line, open.column);
          blocks.push({ open: open.line, close: index + 1, headerStart, header });
        }
      }
    }
  });
  const result = { blocks, balanced: balanced && stack.length === 0 };
  const byPath = blockCache.get(lines) ?? new Map<string, Blocks>();
  byPath.set(path, result);
  blockCache.set(lines, byPath);
  return result;
}

const MAX_HEADER_LINES = 12;

/** A block's header: its line before the brace, and the lines above it back to the previous statement. */
function headerOf(code: readonly string[], commentOnly: readonly boolean[], line: number, column: number): { headerStart: number; header: string } {
  const parts = [(code[line - 1] ?? '').slice(0, column)];
  let headerStart = line;
  // A header that is only `}` or `} else` sits on the brace's line; one that is empty there
  // (a brace on a line of its own) goes on above.
  for (let above = line - 1; above >= Math.max(1, line - MAX_HEADER_LINES); above -= 1) {
    const text = code[above - 1] ?? '';
    const trimmed = text.trim();
    if (trimmed === '' || commentOnly[above - 1] === true || /[;{}]\s*$/.test(trimmed) || /^#/.test(trimmed) || /^(public|private|protected|signals|slots)\s*:\s*$/.test(trimmed)) {
      break;
    }
    parts.unshift(text);
    headerStart = above;
  }
  return { headerStart, header: parts.join(' ').replace(/\s+/g, ' ').trim() };
}

const CONTROL = /^(?:\}\s*)?(?:else\b|if\b|for\b|foreach\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|case\b|default\b|lock\b|using\s*\(|synchronized\b|unsafe\b|loop\b|match\b|when\b|select\b|defer\b|with\b|guard\b|repeat\b|@autoreleasepool\b)/;
const CLASS_LIKE = /(?:^|\s)(class|struct|union|enum|interface|trait|impl|object|record|protocol|extension)\b/;
const SCOPE_LIKE = /(?:^|\s)(namespace|module|package|extern\s*$)\b|^extern\b/;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'function', 'fn', 'func', 'fun', 'def', 'async', 'await', 'new', 'throw', 'typeof', 'decltype', 'alignof', 'noexcept', 'static_assert']);

type BlockKind = 'control' | 'function' | 'class' | 'scope' | 'other';

function blockKind(block: Block): { kind: BlockKind; name: string } {
  const header = block.header.replace(/^\}\s*/, '');
  if (header === '' || CONTROL.test(header)) {
    return { kind: header === '' ? 'other' : 'control', name: '' };
  }
  // A block opened inside an argument list (a lambda passed to a call, a callback, an initializer)
  // is no function of its own: its header leaves a parenthesis open.
  let depth = 0;
  for (const char of header) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
  }
  if (depth > 0) {
    return { kind: 'other', name: '' };
  }
  const paren = header.indexOf('(');
  const classWord = CLASS_LIKE.exec(header);
  if (classWord !== null && (paren === -1 || classWord.index < paren)) {
    const name = new RegExp(`${classWord[1] ?? ''}\\s+(?:\\[\\[[^\\]]*\\]\\]\\s*)?([A-Za-z_$][\\w$]*)`).exec(header)?.[1] ?? '';
    return { kind: 'class', name };
  }
  if (SCOPE_LIKE.test(header) && paren === -1) {
    return { kind: 'scope', name: /namespace\s+([\w:]+)/.exec(header)?.[1] ?? '' };
  }
  // An arrow function, or a function keyword: named by what it is assigned to, or anonymous.
  if (/=>\s*$/.test(header) || /\bfunction\b/.test(header)) {
    const named = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(header)?.[1] ?? /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.exec(header)?.[1] ?? '';
    return { kind: 'function', name: named };
  }
  if (paren > 0) {
    // The name right before the parameter list: an identifier, a qualified one, a destructor or an operator.
    const before = header.slice(0, paren).trimEnd();
    const name = /(operator\s*\S+|~?[A-Za-z_$][\w$]*(?:\s*::\s*~?[A-Za-z_$][\w$]*)*)\s*(?:<[^<>]*>)?$/.exec(before)?.[1]?.replace(/\s+/g, '') ?? '';
    const last = name.split('::').pop() ?? '';
    if (name !== '' && !KEYWORDS.has(last) && !/[=,(]\s*$/.test(before.slice(0, before.length - name.length))) {
      return { kind: 'function', name };
    }
  }
  return { kind: 'other', name: '' };
}

/** The documentation, attributes and decorators directly above line `line`, back to a blank line or code. */
function docStart(lines: readonly string[], commentOnly: readonly boolean[], line: number): number {
  let start = line;
  for (let above = line - 1; above >= 1; above -= 1) {
    const text = (lines[above - 1] ?? '').trim();
    if (text === '') {
      break;
    }
    if (commentOnly[above - 1] === true || /^(?:@\w|\[\[|#\[|\[[A-Z]\w*)/.test(text) || /^template\s*</.test(text)) {
      start = above;
      continue;
    }
    break;
  }
  return start;
}

const SHORT_CONTROL = 30;

function braceStructure(lines: readonly string[], path: string, start: number, end: number): CodeStructure | null {
  const { blocks, balanced } = blocksOf(lines, path);
  if (!balanced) {
    return null;
  }
  const { commentOnly } = masked(lines, path);
  // Innermost first: the blocks the place lies in.
  const around = blocks.filter((block) => block.headerStart <= start && block.close >= end).sort((a, b) => b.open - a.open || a.close - b.close);
  const kinds = around.map((block) => ({ block, ...blockKind(block) }));
  const fn = kinds.find((entry) => entry.kind === 'function');
  if (fn !== undefined) {
    const owner = kinds.find((entry) => entry.block.open < fn.block.open && entry.kind === 'class');
    const bare = fn.name.split('::').pop() ?? '';
    const kind: StructureKind = owner !== undefined || fn.name.includes('::') ? (bare === owner?.name || fn.name.split('::').at(-2) === bare ? 'constructor' : 'method') : 'function';
    const control = kinds.find((entry) => entry.kind === 'control' && entry.block.open > fn.block.open);
    return {
      kind,
      name: fn.name,
      start: docStart(lines, commentOnly, fn.block.headerStart),
      headEnd: fn.block.open,
      end: fn.block.close,
      control: control === undefined ? null : { start: control.block.headerStart, end: control.block.close },
      reliable: true,
    };
  }
  // A function the place itself begins: a new or rewritten function, whole.
  const begun = blocks
    .filter((block) => block.headerStart >= start && block.headerStart <= end)
    .map((block) => ({ block, ...blockKind(block) }))
    .filter((entry) => entry.kind === 'function' || entry.kind === 'class')
    .sort((a, b) => a.block.headerStart - b.block.headerStart)[0];
  if (begun !== undefined) {
    return {
      kind: begun.kind === 'class' ? 'class' : 'function',
      name: begun.name,
      start: Math.min(start, docStart(lines, commentOnly, begun.block.headerStart)),
      headEnd: begun.block.open,
      end: Math.max(end, begun.block.close),
      control: null,
      reliable: true,
    };
  }
  // In a class, but not in its methods: the class when it is short, else the member declaration.
  const owner = kinds.find((entry) => entry.kind === 'class');
  if (owner !== undefined && owner.block.close - owner.block.headerStart <= 60) {
    return { kind: 'class', name: owner.name, start: docStart(lines, commentOnly, owner.block.headerStart), headEnd: owner.block.open, end: owner.block.close, control: null, reliable: true };
  }
  const inside = kinds[0]?.block ?? null;
  const declaration = statementAround(lines, commentOnly, start, end, inside === null ? 1 : inside.open + 1, inside === null ? lines.length : inside.close - 1);
  return declaration === null ? null : { kind: 'declaration', name: owner?.name ?? '', ...declaration, control: null, reliable: true };
}

/** The statement or declaration around lines `start`–`end` within `[from, to]`: its lines up to a blank line, with its documentation. */
function statementAround(lines: readonly string[], commentOnly: readonly boolean[], start: number, end: number, from: number, to: number): { start: number; headEnd: number; end: number } | null {
  if (start < from || end > to) {
    return null;
  }
  let first = start;
  while (first > from && (lines[first - 2] ?? '').trim() !== '') {
    first -= 1;
  }
  let last = end;
  while (last < to && (lines[last] ?? '').trim() !== '') {
    last += 1;
  }
  const docFirst = docStart(lines, commentOnly, first);
  return { start: Math.min(first, docFirst), headEnd: first, end: last };
}

// --- Indentation: Python ---

const indentOf = (line: string): number => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
const blank = (line: string | undefined): boolean => (line ?? '').trim() === '';

function indentStructure(lines: readonly string[], path: string, start: number, end: number): CodeStructure | null {
  const { code, commentOnly } = masked(lines, path);
  const focusIndent = Math.min(...lines.slice(start - 1, end).filter((line) => !blank(line)).map(indentOf), Number.POSITIVE_INFINITY);
  const header = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;
  let defLine = -1;
  for (let line = start; line >= 1; line -= 1) {
    const text = code[line - 1] ?? '';
    const match = header.exec(text);
    if (match !== null && (line === start || indentOf(text) < focusIndent)) {
      defLine = line;
      break;
    }
  }
  if (defLine < 0) {
    return null;
  }
  const defText = lines[defLine - 1] ?? '';
  const [, word = 'def', name = ''] = header.exec(code[defLine - 1] ?? '') ?? [];
  const defIndent = indentOf(defText);
  let headEnd = defLine;
  while (headEnd < lines.length && !/:\s*(#.*)?$/.test((code[headEnd - 1] ?? '').trimEnd())) {
    headEnd += 1;
  }
  let last = headEnd;
  for (let line = headEnd + 1; line <= lines.length; line += 1) {
    const text = lines[line - 1] ?? '';
    if (blank(text)) {
      continue;
    }
    if (indentOf(text) <= defIndent) {
      break;
    }
    last = line;
  }
  if (last < end) {
    return null;
  }
  let first = defLine;
  for (let above = defLine - 1; above >= 1; above -= 1) {
    const text = (lines[above - 1] ?? '').trim();
    if (text.startsWith('@') || (commentOnly[above - 1] === true && indentOf(lines[above - 1] ?? '') === defIndent)) {
      first = above;
    } else {
      break;
    }
  }
  const inClass = (() => {
    for (let line = defLine - 1; line >= 1; line -= 1) {
      const text = code[line - 1] ?? '';
      if (!blank(text) && indentOf(text) < defIndent) {
        return /^\s*class\s/.test(text);
      }
    }
    return false;
  })();
  let control: { start: number; end: number } | null = null;
  for (let line = start - 1; line > headEnd; line -= 1) {
    const text = code[line - 1] ?? '';
    if (!blank(text) && indentOf(text) < focusIndent && /^\s*(if|elif|else|for|while|try|except|finally|with|match|case)\b/.test(text)) {
      const indent = indentOf(text);
      let close = line;
      for (let next = line + 1; next <= last; next += 1) {
        const following = lines[next - 1] ?? '';
        if (!blank(following) && indentOf(following) <= indent) {
          break;
        }
        if (!blank(following)) {
          close = next;
        }
      }
      control = close >= end ? { start: line, end: close } : null;
      break;
    }
  }
  return { kind: word === 'class' ? 'class' : inClass ? 'method' : 'function', name, start: first, headEnd, end: last, control, reliable: true };
}

// --- Configuration and documents: sections ---

function sectionBetween(lines: readonly string[], start: number, isHeader: (line: string) => boolean, closes: (header: string, line: string) => boolean, nameOf: (line: string) => string): CodeStructure | null {
  let first = -1;
  for (let line = start; line >= 1; line -= 1) {
    if (isHeader(lines[line - 1] ?? '')) {
      first = line;
      break;
    }
  }
  if (first < 0) {
    return null;
  }
  const header = lines[first - 1] ?? '';
  let last = lines.length;
  for (let line = first + 1; line <= lines.length; line += 1) {
    if (isHeader(lines[line - 1] ?? '') && closes(header, lines[line - 1] ?? '')) {
      last = line - 1;
      break;
    }
  }
  while (last > first && blank(lines[last - 1])) {
    last -= 1;
  }
  return { kind: 'section', name: nameOf(header), start: first, headEnd: first, end: last, control: null, reliable: true };
}

function yamlSection(lines: readonly string[], start: number): CodeStructure | null {
  const top = (line: string): boolean => /^[^\s#-][^:]*:/.test(line);
  return sectionBetween(lines, start, top, () => true, (line) => line.split(':')[0]?.trim() ?? '');
}

function iniSection(lines: readonly string[], start: number): CodeStructure | null {
  const header = (line: string): boolean => /^\s*\[[^\]]+\]\s*$/.test(line);
  return sectionBetween(lines, start, header, () => true, (line) => line.trim().slice(1, -1));
}

function markdownSection(lines: readonly string[], start: number): CodeStructure | null {
  const level = (line: string): number => /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0;
  return sectionBetween(lines, start, (line) => level(line) > 0, (header, line) => level(line) <= level(header), (line) => line.replace(/^#+\s*/, '').trim());
}

// --- No structure known ---

const NEARBY = 12;

/** The lines around the place up to blank lines, at most NEARBY on each side: no boundary is claimed. */
function nearby(lines: readonly string[], start: number, end: number): CodeStructure {
  let first = start;
  while (first > 1 && start - first < NEARBY && !blank(lines[first - 2])) {
    first -= 1;
  }
  let last = end;
  while (last < lines.length && last - end < NEARBY && !blank(lines[last])) {
    last += 1;
  }
  return { kind: 'nearby', name: '', start: first, headEnd: first, end: last, control: null, reliable: false };
}

/** Whether a control structure is short enough to show whole beside the change. */
export function shortControl(control: { readonly start: number; readonly end: number }): boolean {
  return control.end - control.start + 1 <= SHORT_CONTROL;
}

// --- A walk place's structure, from its file's diff rows ---

/** The lines a pane shows around a place's own, as walk panes do at every level. */
const PLACE_MARGIN = 4;

/** One revision's whole text, from a file's rows: each row carries its line of both sides (DSP-207). */
const sideTexts = new WeakMap<readonly DiffRow[], { readonly base: readonly string[]; readonly target: readonly string[] }>();
export function sideLines(rows: readonly DiffRow[], side: RevisionSide): readonly string[] {
  let texts = sideTexts.get(rows);
  if (texts === undefined) {
    const base: string[] = [];
    const target: string[] = [];
    for (const row of rows) {
      if (row.baseLine !== null) base[row.baseLine - 1] = row.text;
      if (row.targetLine !== null) target[row.targetLine - 1] = row.text;
    }
    texts = { base: Array.from(base, (line) => line ?? ''), target: Array.from(target, (line) => line ?? '') };
    sideTexts.set(rows, texts);
  }
  return side === 'base' ? texts.base : texts.target;
}

/** A place's lines at one side: its own where it has rows there, else the nearest line above it (an added block's place in the old file). */
function linesAt(rows: readonly DiffRow[], indexes: readonly number[], side: RevisionSide): { start: number; end: number } | null {
  const own = (row: DiffRow | undefined): number | null => (row === undefined ? null : side === 'base' ? row.baseLine : row.targetLine);
  const lines = indexes.map((index) => own(rows[index])).filter((line): line is number => line !== null);
  if (lines.length > 0) {
    return { start: Math.min(...lines), end: Math.max(...lines) };
  }
  for (let index = (indexes[0] ?? 0) - 1; index >= 0; index -= 1) {
    const line = own(rows[index]);
    if (line !== null) {
      return { start: line, end: line };
    }
  }
  for (let index = (indexes[indexes.length - 1] ?? 0) + 1; index < rows.length; index += 1) {
    const line = own(rows[index]);
    if (line !== null) {
      return { start: line, end: line };
    }
  }
  return null;
}

/**
 * DSP-207: the code a place lies in, at each side its file has, read from that revision's own
 * text: a function whose signature or ends changed is found at both, so Before, After and
 * Before → After each show it. What a pane shows; never what Accept or a delegation includes.
 */
const structureCache = new WeakMap<readonly DiffRow[], Map<string, readonly PlaceStructure[]>>();
export interface PlaceStructure {
  readonly side: RevisionSide;
  readonly structure: CodeStructure;
  /** The place's own lines at that side. */
  readonly focus: { readonly start: number; readonly end: number };
}
export function placeStructures(rows: readonly DiffRow[], focus: Place['focus']): readonly PlaceStructure[] {
  const key = `${focus.path}|${focus.side}|${String(focus.start)}|${String(focus.end)}`;
  const known = structureCache.get(rows)?.get(key);
  if (known !== undefined) {
    return known;
  }
  const indexes = referenceRows(rows, focus).indexes;
  const out: PlaceStructure[] = [];
  for (const side of ['base', 'target'] as const) {
    const lines = sideLines(rows, side);
    const at = indexes.length === 0 ? null : linesAt(rows, indexes, side);
    if (lines.length > 0 && at !== null) {
      out.push({ side, structure: codeStructure(lines, focus.path, at.start, at.end), focus: at });
    }
  }
  const byKey = structureCache.get(rows) ?? new Map<string, readonly PlaceStructure[]>();
  byKey.set(key, out);
  structureCache.set(rows, byKey);
  return out;
}

/** A unit up to this many lines is shown whole; a longer one keeps its head, the change and its end in view, with folds between. */
/*
 * A unit up to this many lines is shown whole (Niclas, 13 November 2026: the whole function is the
 * default). A walk pane shows about 30 to 40 lines at a time, so a unit this long is four to five
 * pane heights: its head and its change are then several screens apart, and the head is found by
 * scrolling a long way, which is the repeated expanding in another form. Only beyond it are the
 * parts between the head, the change and the end folded, each fold named and opened in one click.
 */
const WHOLE_UNIT = 150;
/** Lines between a long unit's head and its change, or its change and its end, still shown rather than folded. */
const UNIT_BRIDGE = 12;

/** The line ranges a structure shows at the unit level (DSP-207). */
export function structureLines(entry: PlaceStructure): readonly (readonly [number, number])[] {
  const { structure, focus } = entry;
  if (!structure.reliable || structure.end - structure.start + 1 <= WHOLE_UNIT) {
    return [[structure.start, structure.end]];
  }
  const control = structure.control;
  let regionStart = focus.start - PLACE_MARGIN;
  let regionEnd = focus.end + PLACE_MARGIN;
  const ranges: (readonly [number, number])[] = [[structure.start, structure.headEnd]];
  if (control !== null) {
    if (shortControl(control)) {
      regionStart = Math.min(regionStart, control.start);
      regionEnd = Math.max(regionEnd, control.end);
    } else {
      ranges.push([control.start, control.start]);
    }
  }
  regionStart = Math.max(regionStart, structure.headEnd + 1);
  regionEnd = Math.min(regionEnd, structure.end);
  ranges.push(regionStart - structure.headEnd - 1 <= UNIT_BRIDGE ? [structure.headEnd + 1, regionEnd] : [regionStart, regionEnd]);
  ranges.push(structure.end - regionEnd <= UNIT_BRIDGE ? [regionEnd, structure.end] : [structure.end, structure.end]);
  return ranges;
}
