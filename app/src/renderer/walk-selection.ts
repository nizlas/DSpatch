import type { QuoteSegment, SelectionQuote } from '../shared/review-discussion';

/**
 * What the person has selected in the walk window to ask about (30 October 2026), read
 * from the window's text selection.
 *
 * In a code pane every row says where its text is (`data-sel-side`, `data-sel-path`,
 * `data-sel-line`) and holds the line's text, as drawn, in `.rv-text`; a selection becomes
 * runs of lines with the characters it starts and ends at on them, and the text selected.
 * Line numbers and marks are not text and are left out. The host checks every run against
 * the commit before anything is sent, so a wrong reading here is refused there, not guessed
 * at. A selection in an explanation or an answer (`data-quote-source`) is text with no
 * place in the code, and none is made up for it. Anything else is not something to ask about.
 */
export function readQuote(root: HTMLElement): { readonly quote: SelectionQuote; readonly rect: DOMRect; readonly range: Range } | null {
  // The selection of the window the root is in: the walk window, or the explanation on its own.
  const chosen = root.ownerDocument.getSelection();
  if (chosen === null || chosen.rangeCount === 0 || chosen.isCollapsed) {
    return null;
  }
  const range = chosen.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? (rects[rects.length - 1] as DOMRect) : range.getBoundingClientRect();
  const quote = codeQuote(range) ?? textQuote(range);
  return quote === null ? null : { quote, rect, range: range.cloneRange() };
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

/** The characters of `code`'s text before `node` at `offset`. */
function offsetIn(code: Element, node: Node, offset: number): number {
  const part = code.ownerDocument.createRange();
  part.setStart(code, 0);
  part.setEnd(node, offset);
  return part.toString().length;
}

function codeQuote(range: Range): SelectionQuote | null {
  // The rows of the pane the selection starts in: a drag never spans two panes' code.
  const startRow = elementOf(range.startContainer)?.closest('[data-sel-line]') ?? null;
  const pane = startRow?.parentElement ?? elementOf(range.commonAncestorContainer)?.querySelector('[data-sel-line]')?.parentElement ?? null;
  if (pane === null || pane === undefined) {
    return null;
  }
  const picked: { side: 'base' | 'target'; path: string; line: number; from: number; to: number; text: string }[] = [];
  for (const row of pane.querySelectorAll<HTMLElement>(':scope > [data-sel-line]')) {
    const code = row.querySelector('.rv-text');
    const line = Number(row.dataset['selLine']);
    if (code === null || !Number.isInteger(line) || line < 1 || !range.intersectsNode(code)) {
      continue;
    }
    const full = code.textContent ?? '';
    const from = code.contains(range.startContainer) ? offsetIn(code, range.startContainer, range.startOffset) : 0;
    const to = code.contains(range.endContainer) ? offsetIn(code, range.endContainer, range.endOffset) : full.length;
    if (to <= from) {
      continue;
    }
    picked.push({ side: row.dataset['selSide'] === 'base' ? 'base' : 'target', path: row.dataset['selPath'] ?? '', line, from, to, text: full.slice(from, to) });
  }
  if (picked.length === 0 || picked.every((entry) => entry.text.trim() === '')) {
    return null;
  }
  const segments: (QuoteSegment & { text: string[] })[] = [];
  for (const entry of picked) {
    const last = segments.at(-1);
    if (last !== undefined && last.side === entry.side && last.path === entry.path && last.end + 1 === entry.line) {
      segments[segments.length - 1] = { ...last, end: entry.line, to: entry.to, text: [...last.text, entry.text] };
    } else {
      segments.push({ side: entry.side, path: entry.path, start: entry.line, end: entry.line, from: entry.from, to: entry.to, text: [entry.text] });
    }
  }
  return {
    kind: 'code',
    text: segments.map((segment) => segment.text.join('\n')).join('\n'),
    segments: segments.map(({ text: _text, ...segment }) => segment),
  };
}

function textQuote(range: Range): SelectionQuote | null {
  const source = elementOf(range.commonAncestorContainer)?.closest<HTMLElement>('[data-quote-source]') ?? null;
  const text = range.toString().trim();
  if (source === null || text === '') {
    return null;
  }
  return {
    kind: 'text',
    text,
    source: source.dataset['quoteSource'] === 'answer' ? 'answer' : 'explanation',
    context: (source.innerText || source.textContent || '').replace(/\s+\n/g, '\n').trim().slice(0, 1_500),
  };
}

/** The characters `from` to `to` of an element's text, as a range over its text nodes. */
export function rangeInCell(cell: HTMLElement, from: number, to: number): Range | null {
  const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const range = cell.ownerDocument.createRange();
  let at = 0;
  let started = false;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && from <= at + length) {
      range.setStart(node, from - at);
      started = true;
    }
    if (started && to <= at + length) {
      range.setEnd(node, to - at);
      return range;
    }
    at += length;
  }
  return null;
}

/**
 * Where a kept code quote is drawn now (30 October 2026): its characters on every row that
 * shows its lines under `root`, so it stays marked when the window's own selection is gone
 * (the focus in the question field) and when rows are drawn again.
 */
export function quoteRanges(root: ParentNode, quote: Extract<SelectionQuote, { kind: 'code' }>): Range[] {
  const ranges: Range[] = [];
  for (const segment of quote.segments) {
    for (let line = segment.start; line <= segment.end; line += 1) {
      const selector = `[data-sel-side="${segment.side}"][data-sel-path="${CSS.escape(segment.path)}"][data-sel-line="${String(line)}"] .rv-text`;
      for (const code of root.querySelectorAll<HTMLElement>(selector)) {
        const length = code.textContent?.length ?? 0;
        const found = rangeInCell(code, line === segment.start ? segment.from : 0, line === segment.end ? Math.min(segment.to, length) : length);
        if (found !== null && !found.collapsed) {
          ranges.push(found);
        }
      }
    }
  }
  return ranges;
}
