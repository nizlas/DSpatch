/**
 * SIMULATED answers to DSP-152's review tasks, for the presentation adapter only.
 *
 * The presentation adapter answers without a provider. For a walk preparation or a
 * delegated review it answers here, from the machine-readable sections of the prompt, so
 * the flow from the window through the host and back can be exercised end to end. These
 * answers say nothing about what a real model writes or how well it explains; that is for
 * a trial with a real provider.
 *
 * Fixed rules, so a scenario can rely on them:
 * - A walk preparation proposes one walk per changed file, a step per changed range, except
 *   that the last file is left out when there are three or more, so coverage gaps show.
 *   With `DSPATCH_REVIEW_SIM=bad-ref-first` its first answer also names a line that does not
 *   exist; the repair answer is the same walks without it.
 * - A delegated review reviews every changed line it is given. A line whose text contains
 *   `added2` is a problem and is not approved. A scope whose files are all Markdown is
 *   answered as insufficient. Everything else is approved.
 */

import { TASK_HEADER } from '../shared/review-agent';

interface SimRange {
  readonly path: string;
  readonly side: 'base' | 'target';
  readonly start: number;
  readonly end: number;
}

/** The walks of the last preparation, for the repair round (which carries no material). */
let lastWalks: unknown = null;

function jsonAfter(prompt: string, heading: string): unknown {
  const at = prompt.indexOf(heading);
  if (at < 0) {
    return null;
  }
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(prompt.slice(at));
  try {
    return fence === null ? null : (JSON.parse(fence[1] ?? '') as unknown);
  } catch {
    return null;
  }
}

function rangesAfter(prompt: string, heading: string): SimRange[] {
  const raw = jsonAfter(prompt, heading);
  return Array.isArray(raw) ? (raw as SimRange[]) : [];
}

/** The text of a numbered line in the material, from the To or From block of a file. */
function lineText(prompt: string, range: Pick<SimRange, 'path' | 'side'>, line: number): string {
  const marker = `${range.side === 'base' ? 'From' : 'To'} (${range.path}):`;
  const at = prompt.indexOf(marker);
  if (at < 0) {
    return '';
  }
  const block = /```\n([\s\S]*?)\n```/.exec(prompt.slice(at));
  for (const entry of (block?.[1] ?? '').split('\n')) {
    const match = /^\s*(\d+) \| (.*)$/.exec(entry);
    if (match !== null && Number(match[1]) === line) {
      return match[2] ?? '';
    }
  }
  return '';
}

function fence(value: unknown): string {
  return `Here is the result.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function base(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function prepareWalks(prompt: string): string {
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  const byFile = new Map<string, SimRange[]>();
  for (const range of changed) {
    byFile.set(range.path, [...(byFile.get(range.path) ?? []), range]);
  }
  const paths = [...byFile.keys()];
  const kept = paths.length >= 3 ? paths.slice(0, -1) : paths;
  const walks = kept.map((path) => ({
    title: `What changes in ${base(path)}`,
    question: `What does the change do to ${path}, and why?`,
    purpose: `You will see each change in ${base(path)} and what it means for the code around it. SIMULATED: written by the presentation adapter, not by a model.`,
    steps: (byFile.get(path) ?? []).map((range, index) => ({
      title: `${range.side === 'base' ? 'Removed' : 'Changed'} lines ${String(range.start)}–${String(range.end)}`,
      summary: `${range.side === 'base' ? 'The From version had' : 'The To version has'} these lines in ${base(path)}.`,
      body:
        `**What happens:** ${range.side === 'base' ? 'these lines were removed' : 'these lines were added or changed'} in \`${path}\`.\n\n` +
        `**Why:** a simulated answer cannot say; a real agent explains the reason from the code.\n\n` +
        `**Notice:** step ${String(index + 1)} of this file.`,
      places: [{ label: `${base(path)} lines ${String(range.start)}–${String(range.end)}`, path, side: range.side, start: range.start, end: range.end }],
    })),
  }));
  const answer = { overview: `SIMULATED walks over ${String(kept.length)} of ${String(paths.length)} changed file(s).`, walks };
  lastWalks = answer;
  if (process.env['DSPATCH_REVIEW_SIM'] === 'bad-ref-first' && walks[0] !== undefined) {
    const broken = JSON.parse(JSON.stringify(answer)) as typeof answer;
    const first = broken.walks[0];
    const firstStep = first?.steps[0];
    if (firstStep !== undefined) {
      firstStep.places.push({ label: 'A line that is not there', path: first?.steps[0]?.places[0]?.path ?? 'missing.ts', side: 'target', start: 9999, end: 9999 });
    }
    return fence(broken);
  }
  return fence(answer);
}

function delegatedReview(prompt: string): string {
  const scope = rangesAfter(prompt, '## The scope (machine-readable)');
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  const reviewed: SimRange[] = [];
  for (const range of scope) {
    for (const span of changed) {
      if (span.path === range.path && span.side === range.side) {
        const start = Math.max(span.start, range.start);
        const end = Math.min(span.end, range.end);
        if (start <= end) {
          reviewed.push({ path: range.path, side: range.side, start, end });
        }
      }
    }
  }
  if (scope.length > 0 && scope.every((range) => range.path.endsWith('.md'))) {
    return fence({
      assessment: 'SIMULATED: only removed text is supplied for this part, and nothing says what replaced it.',
      reviewed: [],
      approved: [],
      findings: [],
      uncertainties: ['Whether the removed document is still referred to elsewhere cannot be seen from this material.'],
      insufficient: true,
    });
  }
  const findings: { severity: string; text: string; path: string; side: string; start: number; end: number }[] = [];
  const approved: SimRange[] = [];
  for (const range of reviewed) {
    let from = range.start;
    for (let line = range.start; line <= range.end; line += 1) {
      if (lineText(prompt, range, line).includes('added2')) {
        findings.push({ severity: 'problem', text: 'SIMULATED: `added2` is exported but nothing uses it.', path: range.path, side: range.side, start: line, end: line });
        if (from < line) {
          approved.push({ ...range, start: from, end: line - 1 });
        }
        from = line + 1;
      }
    }
    if (from <= range.end) {
      approved.push({ ...range, start: from, end: range.end });
    }
  }
  return fence({
    assessment: `SIMULATED: reviewed ${String(reviewed.length)} changed range(s) in the delegated part against the supplied code.`,
    reviewed,
    approved,
    findings,
    uncertainties: findings.length > 0 ? ['Whether another module imports the unused export is outside the supplied material.'] : [],
    insufficient: false,
  });
}

/** The simulated answer to a review task prompt, or `null` for any other prompt. */
export function simulatedReviewTask(prompt: string): string | null {
  if (!prompt.startsWith(TASK_HEADER)) {
    return null;
  }
  const task = prompt.slice(TASK_HEADER.length).split('\n')[0]?.trim() ?? '';
  if (task === 'prepare-walks') {
    return prepareWalks(prompt);
  }
  if (task === 'repair-walks') {
    return fence(lastWalks ?? { overview: '', walks: [] });
  }
  if (task === 'delegated-review') {
    return delegatedReview(prompt);
  }
  return null;
}
