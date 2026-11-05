/**
 * What a question in the review discussion is checked against and given, read from a
 * revision pair's two commits (30 October 2026): the selection, checked character by
 * character, and ranges of code. One mechanism for every window the discussion is asked
 * from: a walk reads through its review, the diff through its revision pair.
 */

import {
  ENVELOPE_LIMITS,
  QUOTE_LIMITS,
  type EnvelopeQuote,
  type EnvelopeRange,
  type EnvelopeRangeRole,
  type QuoteSegment,
  quoteOriginFrom,
} from './review-discussion';
import type { CodeLocation, ReviewFileOutcome, RevisionSide } from './review-model';

/** A file of one commit of the pair, as git holds it. */
export type RevisionReader = (side: RevisionSide, filePath: string) => Promise<ReviewFileOutcome>;

/**
 * What the person selected to ask about (30 October 2026). Code is checked against the
 * commit it was selected at: every run must lie on lines that exist there, and the text read
 * from the commit must be the text the window showed, or nothing is sent. The text sent is
 * the commit's. Text from an explanation or an answer is kept as it is, with no place.
 */
export async function checkedQuote(raw: unknown, read: RevisionReader, shaOf: (side: RevisionSide) => string): Promise<EnvelopeQuote | { readonly error: string } | null> {
  if (raw === null || raw === undefined) {
    return null;
  }
  const value = typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof value['text'] === 'string' ? value['text'] : '';
  if (text.trim() === '' || text.length > QUOTE_LIMITS.characters) {
    return { error: text.trim() === '' ? 'The selection is empty; nothing was sent.' : 'The selection is too long to ask about; select less. Nothing was sent.' };
  }
  if (value['kind'] === 'text') {
    const source = value['source'] === 'answer' ? 'answer' : value['source'] === 'thread' ? 'thread' : 'explanation';
    const context = typeof value['context'] === 'string' ? value['context'].slice(0, QUOTE_LIMITS.contextChars) : '';
    const origin = quoteOriginFrom(value['origin']);
    return { kind: 'text', text, source, context, ...(origin === undefined ? {} : { origin }) };
  }
  if (value['kind'] !== 'code' || !Array.isArray(value['segments']) || value['segments'].length === 0 || value['segments'].length > QUOTE_LIMITS.segments) {
    return { error: 'The selection is not one DSpatch can read; nothing was sent.' };
  }
  const segments: (QuoteSegment & { sha: string; text: string })[] = [];
  for (const entry of value['segments'] as unknown[]) {
    const segment = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const side = segment['side'];
    const path = segment['path'];
    const [start, end, from, to] = [segment['start'], segment['end'], segment['from'], segment['to']];
    if (
      (side !== 'base' && side !== 'target') ||
      typeof path !== 'string' ||
      ![start, end, from, to].every((number) => Number.isInteger(number) && (number as number) >= 0) ||
      (start as number) < 1 ||
      (end as number) < (start as number)
    ) {
      return { error: 'A part of the selection does not name a side, a file and lines; nothing was sent.' };
    }
    const content = await read(side, path);
    const lines = content.kind === 'text' ? content.lines : null;
    const first = lines?.[(start as number) - 1];
    const last = lines?.[(end as number) - 1];
    if (lines === null || first === undefined || last === undefined || (from as number) > first.length || (to as number) > last.length) {
      return { error: `The selection in ${path} is not at those lines in the ${side === 'base' ? 'From' : 'To'} revision; nothing was sent.` };
    }
    const run = lines.slice((start as number) - 1, end as number);
    const selected =
      start === end
        ? first.slice(from as number, to as number)
        : [first.slice(from as number), ...run.slice(1, -1), last.slice(0, to as number)].join('\n');
    segments.push({ side, path, start: start as number, end: end as number, from: from as number, to: to as number, sha: shaOf(side), text: selected });
  }
  // The window's text, and the commit's, must agree (line ends and runs of spaces aside).
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();
  if (flat(segments.map((segment) => segment.text).join('\n')) !== flat(text)) {
    return { error: 'The selected text is not what the revision has at that place; nothing was sent. Select it again.' };
  }
  return { kind: 'code', segments };
}

/** One range of code at its commit, bounded to `ENVELOPE_LIMITS.rangeLines` lines. */
export async function envelopeRange(read: RevisionReader, shaOf: (side: RevisionSide) => string, role: EnvelopeRangeRole, location: CodeLocation): Promise<EnvelopeRange> {
  const sha = shaOf(location.side);
  const base = { role, path: location.path, side: location.side, sha, start: location.start, end: location.end };
  const content = await read(location.side, location.path);
  if (content.kind !== 'text') {
    const problem =
      content.kind === 'missing'
        ? `${location.path} does not exist at ${location.side} (${sha.slice(0, 7)}).`
        : content.kind === 'binary'
          ? `${location.path} is a binary file.`
          : content.error;
    return { ...base, lines: [], omittedLines: 0, problem };
  }
  const wanted = content.lines.slice(location.start - 1, location.end);
  if (wanted.length === 0) {
    return {
      ...base,
      lines: [],
      omittedLines: 0,
      problem: `${location.path} has ${String(content.lines.length)} lines at ${location.side}; lines ${String(location.start)}–${String(location.end)} are not there.`,
    };
  }
  const kept = wanted.slice(0, ENVELOPE_LIMITS.rangeLines);
  return { ...base, lines: kept, omittedLines: wanted.length - kept.length, problem: null };
}
