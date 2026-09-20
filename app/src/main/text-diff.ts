import { createTwoFilesPatch } from 'diff';

/**
 * The text diff DSpatch shows for review.
 *
 * Two rules shape this module, and both come from AC#7.
 *
 * **It diffs bytes.** Every side is a `Buffer` that came from disk or from the
 * session baseline, never from an agent's account of what it did. The snapshot
 * identities are carried into the patch header so the reader can see which two
 * states are being compared.
 *
 * **Nothing is skipped silently.** A file that cannot be shown as text still
 * appears, with the specific reason: too large, binary, not valid UTF-8, or its
 * baseline content was not kept. Quietly dropping such a file is the failure
 * mode this is written to avoid — a review that omits a change without saying so
 * is worse than no review, because it reads as completeness.
 */

/** One side of a comparison. */
export type DiffSide =
  /** The file did not exist on this side. Normal for an addition or deletion. */
  | { readonly kind: 'absent' }
  | { readonly kind: 'bytes'; readonly bytes: Buffer }
  /** The file exists but its bytes are not available, and this says why. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface DiffLimits {
  /** Above this, a side is described rather than diffed. */
  readonly maxFileBytes: number;
  /** Above this many patch lines the diff is cut off and says so. */
  readonly maxPatchLines: number;
}

export const DEFAULT_DIFF_LIMITS: DiffLimits = {
  maxFileBytes: 1024 * 1024,
  maxPatchLines: 4_000,
};

export interface DiffResult {
  /** Unified diff text, or `null` when one could not be produced. */
  readonly unifiedDiff: string | null;
  /** Why there is no diff text, or why the one above is partial. */
  readonly limitation: string | null;
  /** `null` when no diff was produced — unknown, not zero. */
  readonly addedLines: number | null;
  readonly removedLines: number | null;
  readonly truncated: boolean;
}

export type TextReading =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'not-text'; readonly reason: string };

/** How much of a file is examined for NUL bytes. git uses the same rule. */
const BINARY_SNIFF_BYTES = 8_000;

/**
 * Decode a file as text, or say precisely why it is not text.
 *
 * `ignoreBOM: true` keeps a leading U+FEFF in the string instead of dropping it.
 * Dropping it would make a file that gained or lost its byte-order mark look
 * unchanged, and the hashes above the diff would then disagree with the diff.
 */
export function readAsText(
  bytes: Buffer,
  limits: DiffLimits = DEFAULT_DIFF_LIMITS,
): TextReading {
  if (bytes.byteLength > limits.maxFileBytes) {
    return {
      kind: 'not-text',
      reason:
        `${String(bytes.byteLength)} bytes, above the ` +
        `${String(Math.round(limits.maxFileBytes / 1024))} kB per-file limit for ` +
        'diff text. The hashes and sizes above still describe it.',
    };
  }
  const nul = bytes.subarray(0, BINARY_SNIFF_BYTES).indexOf(0);
  if (nul !== -1) {
    return {
      kind: 'not-text',
      reason:
        `binary: a NUL byte at offset ${String(nul)}. A line-by-line text diff ` +
        'of it would be meaningless, so only the hashes and sizes are shown.',
    };
  }
  try {
    return {
      kind: 'text',
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
    };
  } catch {
    return {
      kind: 'not-text',
      reason:
        'not valid UTF-8. DSpatch will not guess an encoding, because a wrong ' +
        'guess produces a diff that looks real and is not.',
    };
  }
}

function describeSide(side: DiffSide, limits: DiffLimits): TextReading | null {
  switch (side.kind) {
    case 'absent':
      return { kind: 'text', text: '' };
    case 'unavailable':
      return { kind: 'not-text', reason: side.reason };
    case 'bytes':
      return readAsText(side.bytes, limits);
    default:
      return null;
  }
}

export interface DiffRequest {
  readonly relPath: string;
  readonly before: DiffSide;
  readonly after: DiffSide;
  /** Written into the patch header, so the diff states what it is between. */
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly limits?: DiffLimits;
}

/**
 * Produce the unified diff for one file, or the reason there is none.
 *
 * A deleted file is diffed against `/dev/null` in the conventional direction, so
 * its whole content appears as removed lines rather than as a bare mention. The
 * same holds for an added file. AC#7 asks for added and deleted text files to be
 * **included**, and a list entry is not an inclusion.
 */
export function buildUnifiedDiff(request: DiffRequest): DiffResult {
  const limits = request.limits ?? DEFAULT_DIFF_LIMITS;
  const before = describeSide(request.before, limits);
  const after = describeSide(request.after, limits);

  if (before === null || after === null) {
    return unavailable('DSpatch could not read either side of this comparison.');
  }
  if (before.kind === 'not-text' || after.kind === 'not-text') {
    const parts: string[] = [];
    if (before.kind === 'not-text') {
      parts.push(`at the session baseline it is ${before.reason}`);
    }
    if (after.kind === 'not-text') {
      parts.push(`on disk now it is ${after.reason}`);
    }
    return unavailable(`No text diff: ${parts.join(' And ')}`);
  }

  const absentBefore = request.before.kind === 'absent';
  const absentAfter = request.after.kind === 'absent';
  const patch = createTwoFilesPatch(
    absentBefore ? '/dev/null' : `a/${request.relPath}`,
    absentAfter ? '/dev/null' : `b/${request.relPath}`,
    before.text,
    after.text,
    request.beforeLabel,
    request.afterLabel,
    { context: 3 },
  );

  // jsdiff prefixes the patch with a bare `====…` separator. It carries no
  // information and is not part of the unified format git produces, so the
  // header shown starts at `---`, which is what a reader expects.
  const lines = patch.split('\n').filter((line, index) => !(index === 0 && /^=+$/.test(line)));
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  let addedLines = 0;
  let removedLines = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines += 1;
    }
  }

  if (lines.length > limits.maxPatchLines) {
    const kept = lines.slice(0, limits.maxPatchLines);
    return {
      unifiedDiff: `${kept.join('\n')}\n`,
      limitation:
        `This diff is ${String(lines.length)} lines long and is cut off after ` +
        `${String(limits.maxPatchLines)}. The counts beside it cover the whole ` +
        'diff; the text below does not.',
      addedLines,
      removedLines,
      truncated: true,
    };
  }

  return {
    unifiedDiff: `${lines.join('\n')}\n`,
    limitation: null,
    addedLines,
    removedLines,
    truncated: false,
  };
}

function unavailable(reason: string): DiffResult {
  return {
    unifiedDiff: null,
    limitation: reason,
    addedLines: null,
    removedLines: null,
    truncated: false,
  };
}
