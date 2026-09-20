/**
 * The small Markdown reader behind DSP-59.
 *
 * It produces a tree of named nodes and **never** produces HTML. That is the whole
 * of the safety property INTERACTION_MODEL §9.1 asks for: there is no string of
 * markup anywhere between the model's text and the screen, so there is nothing for
 * a renderer to be persuaded to execute. `<script>` in a reply parses to a text
 * node containing those characters, because text is the only thing a text node can
 * be. The renderer in `Markdown.tsx` maps this tree onto React elements, which
 * escape their children; nothing in this file or that one uses
 * `dangerouslySetInnerHTML`.
 *
 * A dependency was the obvious alternative and was rejected for two reasons rather
 * than one. The safety property would then rest on a sanitiser configured
 * correctly — `marked` plus `DOMPurify` is two dependencies and a configuration to
 * get wrong — and a reply *about* Markdown is exactly what this product shows, so
 * the rule that matters most here is the one about literal characters inside code,
 * which is easier to state and test in 400 lines than to verify in someone else's
 * 4 000.
 *
 * What it deliberately does not do: HTML blocks, tables, footnotes, reference
 * links, setext headings. An unsupported construct degrades to the literal text
 * the model wrote, which is the failure a reader can see and work around.
 *
 * Written to be parsed repeatedly during streaming: the input is re-read from the
 * start on every delta, so it holds no state between calls and an unterminated
 * construct at the end of the text is a normal case rather than an error.
 */

export type MarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'emphasis'; readonly children: readonly MarkdownInline[] }
  | { readonly kind: 'strong'; readonly children: readonly MarkdownInline[] }
  /** Literal, always. Nothing inside is parsed and no marker is removed. */
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'link';
      /** Sanitised. `null` means the target was refused and only the text remains. */
      readonly href: string | null;
      readonly children: readonly MarkdownInline[];
    };

export interface MarkdownListItem {
  readonly blocks: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly content: readonly MarkdownInline[] }
  | {
      readonly kind: 'heading';
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly content: readonly MarkdownInline[];
    }
  | {
      readonly kind: 'code';
      readonly language: string | null;
      readonly text: string;
      /**
       * Whether the closing fence had arrived.
       *
       * False is the ordinary state half way through a streaming reply, and it is
       * rendered as a code block rather than as three literal backticks: a fence
       * that flickers into prose and back is worse to read than one that opens a
       * block early.
       */
      readonly closed: boolean;
    }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly MarkdownListItem[];
    }
  | { readonly kind: 'quote'; readonly blocks: readonly MarkdownBlock[] }
  | { readonly kind: 'rule' };

/** Schemes a link may carry. Everything else keeps its text and loses its target. */
const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;

/**
 * A link target, or `null` when it is not one of the three safe schemes.
 *
 * `javascript:`, `data:` and `vbscript:` are the reason this exists, including
 * their obfuscations: the check is made after control characters and whitespace
 * have been removed, because `java\nscript:alert(1)` is a working URL in a browser
 * and a failing string comparison in a naive check.
 */
export function safeLinkHref(raw: string): string | null {
  const stripped = raw.replace(/[\u0000-\u0020\u007f]/g, '');
  if (stripped === '') {
    return null;
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped);
  if (scheme === null) {
    // No scheme at all: a relative or fragment target. Harmless, and the window
    // opens nothing by itself, but there is nothing useful to point a chat reply
    // at either, so it keeps its text and loses its target.
    return null;
  }
  const found = scheme[1]?.toLowerCase() ?? '';
  return ALLOWED_LINK_SCHEMES.includes(`${found}:` as (typeof ALLOWED_LINK_SCHEMES)[number])
    ? stripped
    : null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const EMPTY_HEADING = /^ {0,3}(#{1,6})[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})([.)])[ \t]+(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

function indentWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (character === '\t') {
      width += 4;
    } else if (character === ' ') {
      width += 1;
    } else {
      break;
    }
  }
  return width;
}

/** Remove up to `width` columns of leading whitespace, counting a tab as four. */
function stripIndent(line: string, width: number): string {
  let removed = 0;
  let at = 0;
  while (at < line.length && removed < width) {
    const character = line[at] ?? '';
    if (character === ' ') {
      removed += 1;
    } else if (character === '\t') {
      removed += 4;
    } else {
      break;
    }
    at += 1;
  }
  return line.slice(at);
}

/** Read Markdown into blocks. Never throws; unknown syntax stays as its own text. */
export function parseMarkdown(source: string): readonly MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: readonly string[]): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at] ?? '';

    if (line.trim() === '') {
      at += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? '```';
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      at += 1;
      let closed = false;
      while (at < lines.length) {
        const candidate = lines[at] ?? '';
        const closer = FENCE.exec(candidate);
        if (
          closer !== null &&
          (closer[1] ?? '').startsWith(marker[0] ?? '`') &&
          (closer[1] ?? '').length >= marker.length &&
          (closer[2] ?? '') === ''
        ) {
          closed = true;
          at += 1;
          break;
        }
        body.push(candidate);
        at += 1;
      }
      blocks.push({
        kind: 'code',
        language: language === '' ? null : language,
        text: body.join('\n'),
        closed,
      });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      at += 1;
      continue;
    }

    const heading = HEADING.exec(line) ?? EMPTY_HEADING.exec(line);
    if (heading !== null) {
      const level = Math.min((heading[1] ?? '#').length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      blocks.push({ kind: 'heading', level, content: parseInline(text) });
      at += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length) {
        const candidate = lines[at] ?? '';
        const inside = QUOTE.exec(candidate);
        if (inside === null) {
          break;
        }
        quoted.push(inside[1] ?? '');
        at += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet !== null || ordered !== null) {
      const consumed = readList(lines, at);
      blocks.push(consumed.block);
      at = consumed.next;
      continue;
    }

    // A paragraph: everything up to a blank line or the start of another block.
    const paragraph: string[] = [];
    while (at < lines.length) {
      const candidate = lines[at] ?? '';
      if (
        candidate.trim() === '' ||
        FENCE.test(candidate) ||
        HEADING.test(candidate) ||
        EMPTY_HEADING.test(candidate) ||
        RULE.test(candidate) ||
        QUOTE.test(candidate) ||
        BULLET.test(candidate) ||
        ORDERED.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      at += 1;
    }
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) });
  }

  return blocks;
}

interface ListReading {
  readonly block: MarkdownBlock;
  readonly next: number;
}

/**
 * One list, and the lists inside it.
 *
 * Items are collected by indentation and their content is parsed as blocks, so a
 * nested list, a second paragraph or a fenced block inside an item is read the way
 * the writer meant it. An item interrupted mid-stream is an item with what has
 * arrived in it.
 */
function readList(lines: readonly string[], from: number): ListReading {
  const first = lines[from] ?? '';
  const firstOrdered = ORDERED.exec(first);
  const isOrdered = firstOrdered !== null;
  const start = isOrdered ? Number.parseInt(firstOrdered[2] ?? '1', 10) : 1;
  const listIndent = indentWidth(first);

  const items: MarkdownListItem[] = [];
  let itemLines: string[] = [];
  let at = from;
  let itemContentIndent = 0;

  const flush = (): void => {
    if (itemLines.length > 0) {
      items.push({ blocks: parseBlocks(itemLines) });
      itemLines = [];
    }
  };

  while (at < lines.length) {
    const line = lines[at] ?? '';
    const bullet = BULLET.exec(line);
    const numbered = ORDERED.exec(line);
    const marker = bullet ?? numbered;

    if (marker !== null && indentWidth(line) <= listIndent) {
      const startsOrdered = numbered !== null;
      if (items.length > 0 && startsOrdered !== isOrdered) {
        break;
      }
      flush();
      const text = (startsOrdered ? numbered[4] : bullet?.[3]) ?? '';
      itemContentIndent =
        indentWidth(line) + ((startsOrdered ? `${numbered[2] ?? ''}${numbered[3] ?? ''}` : (bullet?.[2] ?? '-')).length + 1);
      itemLines.push(text);
      at += 1;
      continue;
    }

    if (line.trim() === '') {
      // A blank line belongs to the item until something at or left of the list's
      // own indentation proves the list is over.
      const following = lines[at + 1] ?? '';
      if (following.trim() !== '' && indentWidth(following) < itemContentIndent) {
        const nextMarker = BULLET.exec(following) ?? ORDERED.exec(following);
        if (nextMarker === null || indentWidth(following) > listIndent) {
          break;
        }
      }
      itemLines.push('');
      at += 1;
      continue;
    }

    if (indentWidth(line) >= itemContentIndent) {
      itemLines.push(stripIndent(line, itemContentIndent));
      at += 1;
      continue;
    }

    if (items.length > 0 || itemLines.length > 0) {
      // A lazy continuation line: ordinary prose wrapped under an item.
      if (
        !FENCE.test(line) &&
        !HEADING.test(line) &&
        !RULE.test(line) &&
        !QUOTE.test(line) &&
        (itemLines[itemLines.length - 1] ?? '') !== ''
      ) {
        itemLines.push(line.trim());
        at += 1;
        continue;
      }
    }
    break;
  }

  flush();
  return {
    block: { kind: 'list', ordered: isOrdered, start, items },
    next: at,
  };
}

const ESCAPABLE = '\\`*_{}[]()#+-.!>|~';

/**
 * Read one run of text into inline nodes.
 *
 * Unmatched delimiters stay as the characters the writer typed. That is the rule
 * that keeps a sentence like *use `**` for bold* readable: a marker only disappears
 * when its partner is there to make it mean something.
 */
export function parseInline(source: string): readonly MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let plain = '';
  let at = 0;

  const flush = (): void => {
    if (plain !== '') {
      nodes.push({ kind: 'text', text: plain });
      plain = '';
    }
  };

  while (at < source.length) {
    const character = source[at] ?? '';

    if (character === '\\') {
      const next = source[at + 1] ?? '';
      if (ESCAPABLE.includes(next) && next !== '') {
        plain += next;
        at += 2;
        continue;
      }
      plain += character;
      at += 1;
      continue;
    }

    if (character === '`') {
      const run = /^`+/.exec(source.slice(at))?.[0] ?? '`';
      const closeAt = source.indexOf(run, at + run.length);
      const closerIsExact =
        closeAt !== -1 && (source[closeAt + run.length] ?? '') !== '`';
      if (closeAt !== -1 && closerIsExact) {
        let text = source.slice(at + run.length, closeAt);
        if (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') {
          text = text.slice(1, -1);
        }
        flush();
        nodes.push({ kind: 'code', text });
        at = closeAt + run.length;
        continue;
      }
      plain += run;
      at += run.length;
      continue;
    }

    if (character === '[') {
      const link = readLink(source, at);
      if (link !== null) {
        flush();
        nodes.push(link.node);
        at = link.next;
        continue;
      }
      plain += character;
      at += 1;
      continue;
    }

    if (character === '*' || character === '_') {
      const emphasis = readEmphasis(source, at, character);
      if (emphasis !== null) {
        flush();
        nodes.push(emphasis.node);
        at = emphasis.next;
        continue;
      }
      plain += character;
      at += 1;
      continue;
    }

    plain += character;
    at += 1;
  }

  flush();
  return nodes;
}

interface InlineReading {
  readonly node: MarkdownInline;
  readonly next: number;
}

function readLink(source: string, at: number): InlineReading | null {
  let depth = 0;
  let closeAt = -1;
  for (let scan = at; scan < source.length; scan += 1) {
    const character = source[scan] ?? '';
    if (character === '\\') {
      scan += 1;
      continue;
    }
    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        closeAt = scan;
        break;
      }
    }
  }
  if (closeAt === -1 || (source[closeAt + 1] ?? '') !== '(') {
    return null;
  }
  const targetEnd = source.indexOf(')', closeAt + 2);
  if (targetEnd === -1) {
    return null;
  }
  const label = source.slice(at + 1, closeAt);
  const target = source.slice(closeAt + 2, targetEnd).trim();
  const withoutTitle = /^(\S*)(?:\s+["'(].*)?$/.exec(target)?.[1] ?? target;
  return {
    node: {
      kind: 'link',
      href: safeLinkHref(withoutTitle),
      children: parseInline(label),
    },
    next: targetEnd + 1,
  };
}

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

function readEmphasis(
  source: string,
  at: number,
  marker: '*' | '_',
): InlineReading | null {
  const run = new RegExp(`^\\${marker}{1,3}`).exec(source.slice(at))?.[0] ?? marker;
  const width = run.length >= 2 ? 2 : 1;
  const delimiter = marker.repeat(width);
  const contentFrom = at + width;
  if ((source[contentFrom] ?? '') === '' || /\s/.test(source[contentFrom] ?? ' ')) {
    return null;
  }
  // `snake_case` is not emphasis. An underscore inside a word never opens one.
  if (marker === '_' && at > 0 && isWordCharacter(source[at - 1] ?? '')) {
    return null;
  }

  let scan = contentFrom;
  while (scan < source.length) {
    const character = source[scan] ?? '';
    if (character === '\\') {
      scan += 2;
      continue;
    }
    if (character === '`') {
      // Skip a code span whole: a delimiter inside one is literal.
      const codeRun = /^`+/.exec(source.slice(scan))?.[0] ?? '`';
      const codeEnd = source.indexOf(codeRun, scan + codeRun.length);
      scan = codeEnd === -1 ? source.length : codeEnd + codeRun.length;
      continue;
    }
    if (source.startsWith(delimiter, scan)) {
      const before = source[scan - 1] ?? '';
      const after = source[scan + delimiter.length] ?? '';
      const closes = before !== '' && !/\s/.test(before);
      const insideWord = marker === '_' && isWordCharacter(after);
      if (closes && !insideWord) {
        const inner = source.slice(contentFrom, scan);
        if (inner.trim() === '') {
          return null;
        }
        return {
          node:
            width === 2
              ? { kind: 'strong', children: parseInline(inner) }
              : { kind: 'emphasis', children: parseInline(inner) },
          next: scan + delimiter.length,
        };
      }
    }
    scan += 1;
  }
  return null;
}

/**
 * The plain text of a parsed reply.
 *
 * Used by tests and by nothing in the window: it exists so a check can ask whether
 * rendering removed any character that was not a marker, which is the literal
 * question AC#3 asks.
 */
export function markdownPlainText(blocks: readonly MarkdownBlock[]): string {
  const parts: string[] = [];
  const inline = (nodes: readonly MarkdownInline[]): string =>
    nodes
      .map((node) =>
        node.kind === 'text' || node.kind === 'code'
          ? node.text
          : inline(node.children),
      )
      .join('');
  const walk = (list: readonly MarkdownBlock[]): void => {
    for (const block of list) {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
          parts.push(inline(block.content));
          break;
        case 'code':
          parts.push(block.text);
          break;
        case 'list':
          for (const item of block.items) {
            walk(item.blocks);
          }
          break;
        case 'quote':
          walk(block.blocks);
          break;
        case 'rule':
          break;
      }
    }
  };
  walk(blocks);
  return parts.join('\n');
}
