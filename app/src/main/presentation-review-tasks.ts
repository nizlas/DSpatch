/**
 * SIMULATED answers to DSP-152's analysis tasks, for the presentation adapter only.
 *
 * The presentation adapter answers without a provider. For a walk preparation, a delegated
 * review or a step question it answers here, so the flow from the window through the host
 * and back can be exercised end to end. These answers say nothing about what a real model
 * writes or how well it explains; that is for a trial with a real provider.
 *
 * **It reads the folder the host prepared, from disk.** Like the real agent, the simulated
 * one gets the revisions as files in its working folder (`base/`, `target/`) and nothing
 * of them in the prompt but the diff. It reads the changed files there, follows a called
 * function to the file it is imported from, and reports each read and search as a tool
 * call (`Read`, `Grep`) with the path it used, as Claude's adapter reports them. So a
 * scenario can check that the right revision's files were there and were what the answer
 * rests on. It never reads outside its folder. What it does with what it reads is fixed:
 *
 * - A walk preparation proposes one walk per changed file, a step per changed range, except
 *   that the last file is left out when there are three or more, so coverage gaps show. A
 *   step whose changed lines call a function imported from another file gets a second place
 *   at that function's definition, at the To side, found by reading that file. With
 *   `DSPATCH_REVIEW_SIM=bad-ref-first` its first answer also names a line that does not
 *   exist; the repair answer is the same walks without it.
 * - A delegated review reviews every changed line it is given, reading it from the folder.
 *   A line whose text contains `added2` is a problem. A line that uses the result of an
 *   imported function directly (`name(...).`) whose definition can return `null` is a
 *   problem too, with a note at the definition. A scope whose files are all Markdown, or
 *   whose files are not in the folder, is answered as insufficient. Everything else is
 *   approved.
 * - A step question reads the step's places, follows the first imported function they call
 *   to its definition, and answers with both as references.
 * - An explanation of selected code reads each selected part at its side and answers only
 *   if the selected text is there; it names each part's kind and the definition it calls.
 */

import fs from 'node:fs';
import path from 'node:path';

import { TASK_HEADER } from '../shared/review-agent';

interface SimRange {
  readonly path: string;
  readonly side: 'base' | 'target';
  readonly start: number;
  readonly end: number;
}

/** A tool call the simulated agent made, reported as the real adapter reports one. */
export interface SimulatedToolCall {
  readonly name: 'Read' | 'Grep';
  readonly subject: string;
  readonly ok: boolean;
}

export interface SimulatedTaskAnswer {
  readonly answer: string;
  readonly tools: readonly SimulatedToolCall[];
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

function fence(value: unknown): string {
  return `Here is the result.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function base(filePath: string): string {
  return filePath.split('/').at(-1) ?? filePath;
}

/** The simulated agent's reading, confined to its folder and recorded as tool calls. */
class Reader {
  readonly tools: SimulatedToolCall[] = [];

  private readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  /** A file's lines at one side, or `null` when it is not in the folder. */
  read(side: 'base' | 'target', repoPath: string): string[] | null {
    const file = path.resolve(this.folder, side, ...repoPath.split('/'));
    if (!file.startsWith(path.resolve(this.folder) + path.sep)) {
      return null;
    }
    try {
      const text = fs.readFileSync(file, 'utf8');
      this.tools.push({ name: 'Read', subject: file, ok: true });
      const lines = text.split('\n');
      if (lines.at(-1) === '') {
        lines.pop();
      }
      return lines.map((line) => line.replace(/\r$/, ''));
    } catch {
      this.tools.push({ name: 'Read', subject: file, ok: false });
      return null;
    }
  }

  /** Record a search; the simulation decides what it found by reading. */
  searched(pattern: string, side: 'base' | 'target'): void {
    this.tools.push({ name: 'Grep', subject: `${pattern} in ${path.join(this.folder, side)}`, ok: true });
  }
}

interface Definition {
  readonly name: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly returnsNull: boolean;
}

/**
 * The definition of a function a line calls, when the file imports it from another file
 * of the same revision: read that file and find `function <name>` or `const <name> =`.
 */
function followCall(reader: Reader, side: 'base' | 'target', filePath: string, fileLines: readonly string[], line: string): Definition | null {
  for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1] ?? '';
    const imported = fileLines
      .map((entry) => new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"](\\.{1,2}/[^'"]+)['"]`).exec(entry))
      .find((found) => found !== null && (found[1] ?? '').split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).includes(name));
    if (imported === undefined || imported === null) {
      continue;
    }
    const from = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), imported[2] ?? ''));
    reader.searched(`function ${name}`, side);
    for (const candidate of [`${from}.ts`, `${from}.tsx`, `${from}.js`, `${from}/index.ts`, from]) {
      const lines = reader.read(side, candidate);
      if (lines === null) {
        continue;
      }
      const start = lines.findIndex((entry) => new RegExp(`\\b(function\\s+${name}\\b|const\\s+${name}\\s*=)`).test(entry));
      if (start < 0) {
        return null;
      }
      let end = start;
      while (end < lines.length - 1 && end - start < 30 && !/^\}/.test(lines[end] ?? '')) {
        end += 1;
      }
      const body = lines.slice(start, end + 1).join('\n');
      return { name, path: candidate, start: start + 1, end: end + 1, returnsNull: /return null\b/.test(body) };
    }
  }
  return null;
}

function prepareWalks(prompt: string, reader: Reader): string {
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  const byFile = new Map<string, SimRange[]>();
  for (const range of changed) {
    byFile.set(range.path, [...(byFile.get(range.path) ?? []), range]);
  }
  const paths = [...byFile.keys()];
  const kept = paths.length >= 3 ? paths.slice(0, -1) : paths;
  const walks = kept.map((filePath) => {
    const ranges = byFile.get(filePath) ?? [];
    const sideLines = new Map<string, string[] | null>();
    const linesOf = (side: 'base' | 'target'): string[] | null => {
      if (!sideLines.has(side)) {
        sideLines.set(side, reader.read(side, filePath));
      }
      return sideLines.get(side) ?? null;
    };
    return {
      title: `What changes in ${base(filePath)}`,
      question: `What does the change do to ${filePath}, and why?`,
      purpose: `You will see each change in ${base(filePath)} and what it means for the code around it. SIMULATED: written by the presentation adapter, not by a model.`,
      steps: ranges.map((range, index) => {
        const lines = linesOf(range.side);
        const changedText = (lines ?? []).slice(range.start - 1, range.end).join('\n');
        const definition = lines === null ? null : followCall(reader, range.side, filePath, lines, changedText);
        const places: unknown[] = [
          { label: `${base(filePath)} lines ${String(range.start)}–${String(range.end)}`, path: filePath, side: range.side, start: range.start, end: range.end },
        ];
        if (definition !== null) {
          places.push({
            label: `Where ${definition.name} is defined`,
            path: definition.path,
            side: range.side,
            start: definition.start,
            end: definition.end,
            anchor: definition.name,
          });
        }
        return {
          title: `${range.side === 'base' ? 'Removed' : 'Changed'} lines ${String(range.start)}–${String(range.end)}`,
          summary: `${range.side === 'base' ? 'The From version had' : 'The To version has'} these lines in ${base(filePath)}.`,
          body:
            `**What happens:** ${range.side === 'base' ? 'these lines were removed' : 'these lines were added or changed'} in \`${filePath}\`.\n\n` +
            (definition === null
              ? ''
              : `**What it depends on:** \`${definition.name}\`, defined in \`${definition.path}\` lines ${String(definition.start)}–${String(definition.end)}, which this change does not touch.` +
                (definition.returnsNull ? ' It can return `null`.' : '') +
                '\n\n') +
            `**Why:** a simulated answer cannot say; a real agent explains the reason from the code.\n\n` +
            `**Notice:** step ${String(index + 1)} of this file.`,
          places,
        };
      }),
    };
  });
  const answer = { overview: `SIMULATED walks over ${String(kept.length)} of ${String(paths.length)} changed file(s).`, walks };
  lastWalks = answer;
  if (process.env['DSPATCH_REVIEW_SIM'] === 'bad-ref-first' && walks[0] !== undefined) {
    const broken = JSON.parse(JSON.stringify(answer)) as { walks: { steps: { places: unknown[] }[] }[] };
    const firstPlace = (broken.walks[0]?.steps[0]?.places[0] ?? {}) as { path?: string };
    broken.walks[0]?.steps[0]?.places.push({ label: 'A line that is not there', path: firstPlace.path ?? 'missing.ts', side: 'target', start: 9999, end: 9999 });
    return fence({ ...answer, walks: broken.walks });
  }
  return fence(answer);
}

function delegatedReview(prompt: string, reader: Reader): string {
  const scope = rangesAfter(prompt, '## The scope (machine-readable)');
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  if (scope.length > 0 && scope.every((range) => range.path.endsWith('.md'))) {
    return fence({
      assessment: 'SIMULATED: only removed text is in this part, and nothing says what replaced it.',
      reviewed: [],
      approved: [],
      findings: [],
      uncertainties: ['Whether the removed document is still referred to elsewhere was not established.'],
      insufficient: true,
    });
  }
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
  const unreadable = [...new Set(reviewed.map((range) => `${range.side}/${range.path}`))].filter((entry) => {
    const [side, ...rest] = entry.split('/');
    return reader.read(side as 'base' | 'target', rest.join('/')) === null;
  });
  if (unreadable.length > 0) {
    return fence({
      assessment: 'SIMULATED: the delegated lines could not be read in the revision folder.',
      reviewed: [],
      approved: [],
      findings: [],
      uncertainties: unreadable.map((entry) => `${entry} was not in the folder.`),
      insufficient: true,
    });
  }
  const findings: { severity: string; text: string; path: string; side: string; start: number; end: number }[] = [];
  const approved: SimRange[] = [];
  for (const range of reviewed) {
    const lines = reader.read(range.side, range.path) ?? [];
    let from = range.start;
    for (let line = range.start; line <= range.end; line += 1) {
      const text = lines[line - 1] ?? '';
      const definition = followCall(reader, range.side, range.path, lines, text);
      const unchecked = definition !== null && definition.returnsNull && new RegExp(`\\b${definition.name}\\s*\\([^)]*\\)\\s*\\.`).test(text);
      if (text.includes('added2') || unchecked) {
        findings.push(
          unchecked && definition !== null
            ? {
                severity: 'problem',
                text: `SIMULATED: \`${definition.name}\` can return null (${definition.path} line ${String(definition.start)}), and this line uses its result without a check.`,
                path: range.path,
                side: range.side,
                start: line,
                end: line,
              }
            : { severity: 'problem', text: 'SIMULATED: `added2` is exported but nothing uses it.', path: range.path, side: range.side, start: line, end: line },
        );
        if (unchecked && definition !== null) {
          findings.push({
            severity: 'note',
            text: `SIMULATED: the null comes from here, in code this change does not touch.`,
            path: definition.path,
            side: range.side,
            start: definition.start,
            end: definition.end,
          });
        }
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
    assessment: `SIMULATED: reviewed ${String(reviewed.length)} changed range(s) in the delegated part, reading them and what they call in the revision folder.`,
    reviewed,
    approved,
    findings,
    uncertainties: findings.length > 0 ? ['No test was run; whether a caller already guards against null was not established.'] : [],
    insufficient: false,
  });
}

function stepQuestion(prompt: string, reader: Reader): string {
  const places = rangesAfter(prompt, '## The code the step points at (machine-readable)');
  const question = /## The question\n([\s\S]*?)\n\n## /.exec(prompt)?.[1]?.trim() ?? '';
  const references: unknown[] = [];
  let definition: Definition | null = null;
  for (const place of places) {
    const lines = reader.read(place.side, place.path);
    if (lines === null) {
      continue;
    }
    references.push({ label: `The step's code in ${base(place.path)}`, path: place.path, side: place.side, start: place.start, end: place.end });
    definition ??= followCall(reader, place.side, place.path, lines, lines.slice(place.start - 1, place.end).join('\n'));
    if (definition !== null) {
      references.push({ label: `${definition.name}, where it is defined`, path: definition.path, side: place.side, start: definition.start, end: definition.end });
      break;
    }
  }
  if (process.env['DSPATCH_REVIEW_SIM'] === 'bad-ref-first') {
    references.push({ label: 'A line that is not there', path: places[0]?.path ?? 'missing.ts', side: 'target', start: 9999, end: 9999 });
  }
  if (references.length === 0) {
    return fence({ answer: 'SIMULATED: the code this step points at was not in the revision folder.', references: [], insufficient: true });
  }
  const answer =
    definition === null
      ? `SIMULATED answer to “${question.slice(0, 80)}”: the step's code calls nothing defined in another file of this revision.`
      : `SIMULATED answer to “${question.slice(0, 80)}”.\n\n` +
        `The step's code calls \`${definition.name}\`, which is defined in \`${definition.path}\` (lines ${String(definition.start)}–${String(definition.end)}), outside the change.` +
        (definition.returnsNull ? ' That function can return `null`, so the caller must handle it.' : '');
  return fence({ answer, references, insufficient: false });
}

interface SimSegment extends SimRange {
  readonly kind: 'removed' | 'added' | 'unchanged';
}

const SIM_KIND: Record<SimSegment['kind'], string> = {
  removed: 'removed: only in From',
  added: 'added: only in To',
  unchanged: 'unchanged in both',
};

/**
 * An explanation of selected code: each part is read at its side in the folder and its
 * selected text must be there, or the answer is "insufficient" (so a part sent with the
 * wrong side shows). It follows the first imported function a part calls to its definition.
 * A follow-up says what it was asked and how many earlier answers it was given.
 */
function explainSelection(prompt: string, reader: Reader): string {
  const parts = rangesAfter(prompt, '## The selection (machine-readable)') as SimSegment[];
  const texts = [...prompt.matchAll(/Selected text, exactly:\n```\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '');
  const asked = /## What the person asks now\n([\s\S]*?)\n\n## /.exec(prompt)?.[1]?.trim() ?? '';
  const earlier = (/## Earlier in this explanation\n([\s\S]*?)\n\n## What the person asks now/.exec(prompt)?.[1] ?? '').match(/^### \d+\. Asked:/gm)?.length ?? 0;
  const references: unknown[] = [];
  const found: string[] = [];
  let definition: Definition | null = null;
  for (const [index, part] of parts.entries()) {
    const lines = reader.read(part.side, part.path);
    const selected = texts[index] ?? '';
    const there = lines === null ? '' : lines.slice(part.start - 1, part.end).join('\n');
    if (lines === null || !there.includes(selected)) {
      return fence({
        answer: `SIMULATED: the selected text of part ${String(index + 1)} is not at ${part.path} lines ${String(part.start)}–${String(part.end)} on the ${part.side} side of the folder.`,
        references: [],
        insufficient: true,
      });
    }
    found.push(`- \`${selected.split('\n')[0]?.trim().slice(0, 60) ?? ''}\` (${part.path} line ${String(part.start)}, ${SIM_KIND[part.kind]}, read at ${part.side})`);
    references.push({ label: `The selected code (${SIM_KIND[part.kind]})`, path: part.path, side: part.side, start: part.start, end: part.end });
    definition ??= followCall(reader, part.side, part.path, lines, there);
  }
  if (definition !== null) {
    const side = parts.find((part) => part.side === 'target')?.side ?? parts[0]?.side ?? 'target';
    references.push({ label: `${definition.name}, where it is defined`, path: definition.path, side, start: definition.start, end: definition.end });
  }
  const opening =
    asked === 'Explain the selected code.'
      ? 'SIMULATED explanation of the selected code.'
      : `SIMULATED follow-up: “${asked.slice(0, 90)}”, building on ${String(earlier)} earlier answer(s) about the same selection.`;
  const dependency =
    definition === null
      ? 'It calls nothing defined in another file of this revision.'
      : `It calls \`${definition.name}\`, defined in \`${definition.path}\` lines ${String(definition.start)}–${String(definition.end)}, outside the change.` +
        (definition.returnsNull ? ' That function can return `null`.' : '');
  return fence({ answer: `${opening}\n\nWhat was selected:\n${found.join('\n')}\n\n${dependency}`, references, insufficient: false });
}

/**
 * The simulated answer to an analysis task prompt, reading the revisions in `folder` (the
 * session's working folder), or `null` for any other prompt.
 */
export function simulatedReviewTask(prompt: string, folder: string): SimulatedTaskAnswer | null {
  if (!prompt.startsWith(TASK_HEADER)) {
    return null;
  }
  const task = prompt.slice(TASK_HEADER.length).split('\n')[0]?.trim() ?? '';
  const reader = new Reader(folder);
  let answer: string | null = null;
  if (task === 'prepare-walks') {
    answer = prepareWalks(prompt, reader);
  } else if (task === 'repair-walks') {
    answer = fence(lastWalks ?? { overview: '', walks: [] });
  } else if (task === 'delegated-review') {
    answer = delegatedReview(prompt, reader);
  } else if (task === 'step-question') {
    answer = stepQuestion(prompt, reader);
  } else if (task === 'explain-selection') {
    answer = explainSelection(prompt, reader);
  }
  return answer === null ? null : { answer, tools: reader.tools };
}
