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
 * - A walk preparation proposes one item per changed file, except that the last file is
 *   left out when there are three or more, so coverage gaps show. A code file gets a code
 *   walk with a step per changed range; a step whose changed lines call a function imported
 *   from another file gets a second place at that function's definition, at the To side,
 *   found by reading that file, reached `from` the call. A Markdown or text file gets
 *   readings instead: one per group of changes that lie within twelve lines of each other
 *   (a coherent change), so independent changes are separate readings. Data files (JSON,
 *   YAML, TOML, CSV) of one folder share one walk with a step per file. With
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
 * - A walk preparation also proposes points worth checking: one linked to the first code
 *   walk's first step, and one with its own tour for a changed file no walk covers.
 * - A question in the review discussion that can read the code (30 October 2026) takes the
 *   first name it asks about — in backticks, or a CamelCase word — searches both revisions
 *   for its definition (`struct`, `class`, `interface`, `type`, `enum`, `function`), reads
 *   the file it is in and one use of it, and answers with what it found at each side,
 *   as references. Asked to compare, it answers with a table. When the name is defined at
 *   neither side, it says so, with no reference. It says how many questions came before it
 *   in the same session, as a session that remembers them would.
 */

import fs from 'node:fs';
import path from 'node:path';

import { TASK_HEADER } from '../shared/review-agent';
import { DETAILS_MARKER } from '../shared/review-discussion';

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

  /** The repository paths of every file at one side, as a search would go through them. */
  files(side: 'base' | 'target'): string[] {
    const root = path.join(this.folder, side);
    const found: string[] = [];
    const walk = (folder: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && found.length < 2000) {
          found.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(root);
    return found;
  }

  /** A text file's lines without recording a read: what a search tool scans. */
  scan(side: 'base' | 'target', repoPath: string): string[] | null {
    try {
      return fs.readFileSync(path.join(this.folder, side, ...repoPath.split('/')), 'utf8').split('\n').map((line) => line.replace(/\r$/, ''));
    } catch {
      return null;
    }
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

/** Markdown and text, where a reading fits rather than a code walk. */
function isProse(filePath: string): boolean {
  return /\.(md|markdown|txt|rst|adoc)$/i.test(filePath);
}

/** Data and configuration, whose files of one folder the simulation takes together. */
function isData(filePath: string): boolean {
  return /\.(json|ya?ml|toml|csv)$/i.test(filePath);
}

/** Changed ranges of one file grouped into coherent changes: within twelve lines of each other. */
function coherent(ranges: readonly SimRange[]): SimRange[][] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const groups: SimRange[][] = [];
  for (const range of sorted) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (last !== undefined && previous !== undefined && range.start - previous.end <= 12) {
      last.push(range);
    } else {
      groups.push([range]);
    }
  }
  return groups;
}

function lineWords(start: number, end: number): string {
  return start === end ? `line ${String(start)}` : `lines ${String(start)}–${String(end)}`;
}

function prepareWalks(prompt: string, reader: Reader): string {
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  const byFile = new Map<string, SimRange[]>();
  for (const range of changed) {
    byFile.set(range.path, [...(byFile.get(range.path) ?? []), range]);
  }
  const paths = [...byFile.keys()];
  const kept = paths.length >= 3 ? paths.slice(0, -1) : paths;
  const dataFolders = new Map<string, string[]>();
  for (const filePath of kept.filter(isData)) {
    const folder = path.posix.dirname(filePath);
    dataFolders.set(folder, [...(dataFolders.get(folder) ?? []), filePath]);
  }
  const walks = kept.flatMap((filePath) => {
    const ranges = byFile.get(filePath) ?? [];
    if (isData(filePath)) {
      const folder = path.posix.dirname(filePath);
      const together = dataFolders.get(folder) ?? [];
      if (together[0] !== filePath) {
        return [];
      }
      return [
        {
          kind: 'walk',
          title: `What changes in the data in ${folder}/`,
          question: `What do the changed values in ${folder}/ change for the code that reads them?`,
          purpose: `The changed values, file by file. SIMULATED: written by the presentation adapter, not by a model.`,
          steps: together.map((dataPath) => {
            const first = (byFile.get(dataPath) ?? [])[0] ?? { path: dataPath, side: 'target' as const, start: 1, end: 1 };
            reader.read(first.side, dataPath);
            return {
              title: base(dataPath),
              summary: `The changed values in ${base(dataPath)}.`,
              body: `**What changes:** values in \`${dataPath}\`.`,
              places: [{ label: `${base(dataPath)} lines ${String(first.start)}–${String(first.end)}`, path: dataPath, side: first.side, start: first.start, end: first.end }],
            };
          }),
        },
      ];
    }
    const sideLines = new Map<string, string[] | null>();
    const linesOf = (side: 'base' | 'target'): string[] | null => {
      if (!sideLines.has(side)) {
        sideLines.set(side, reader.read(side, filePath));
      }
      return sideLines.get(side) ?? null;
    };
    if (isProse(filePath)) {
      return coherent(ranges).map((group, index) => ({
        kind: 'reading',
        title: `${index === 0 ? 'The change' : 'A further change'} to ${base(filePath)}, ${lineWords(Math.min(...group.map((range) => range.start)), Math.max(...group.map((range) => range.end)))}`,
        question: `What changes in this part of ${filePath}, and what does it mean?`,
        purpose: `What this part of ${base(filePath)} now says. SIMULATED: written by the presentation adapter, not by a model.`,
        steps: group.map((range) => ({
          title: `${range.side === 'base' ? 'Removed' : 'Changed'} text, lines ${String(range.start)}–${String(range.end)}`,
          summary: `${range.side === 'base' ? 'The From version said' : 'The To version says'} this in ${base(filePath)}.`,
          body:
            `**What changes:** ${range.side === 'base' ? 'this text was removed' : 'this text was added or rewritten'} in \`${filePath}\`.\n\n` +
            '- A simulated answer cannot say what it means.\n- A real agent reads the text in its context.',
          places: [{ label: `${base(filePath)} lines ${String(range.start)}–${String(range.end)}`, path: filePath, side: range.side, start: range.start, end: range.end }],
        })),
      }));
    }
    return [
      {
        kind: 'walk',
        title: `What changes in ${base(filePath)}`,
        question: `What does the change do to ${filePath}, and why?`,
        purpose: `You will see each change in ${base(filePath)} and what it calls. SIMULATED: written by the presentation adapter, not by a model.`,
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
              from: { label: `The call of ${definition.name}`, path: filePath, side: range.side, start: range.start, end: range.end },
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
      },
    ];
  });
  const readings = walks.filter((walk) => walk.kind === 'reading').length;
  const answer = {
    summary: `SIMULATED: ${String(walks.length - readings)} code walk(s) and ${String(readings)} reading(s) over ${String(kept.length)} of ${String(paths.length)} changed file(s).`,
    background:
      'SIMULATED background, shown only on request.\n\nThe presentation adapter proposes one item per changed file: a code walk for code and readings for text. A real agent chooses the form from what changed.',
    walks,
  };
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
 * What is worth checking beyond the walks, asked for on its own (30 October 2026): a question
 * at the first code walk's first step, with its places, and an uncertainty with a tour of its
 * own for a changed file no step shows. Read from the walks and changed lines in the prompt.
 */
function worthChecking(prompt: string): string {
  const changed = rangesAfter(prompt, '## Changed lines (machine-readable)');
  const steps = [...prompt.matchAll(/^- ((?:W|R)\d+\.\d+) (.*?) \(([^\n]*)\)$/gm)].map((match) => ({
    id: match[1] ?? '',
    places: (match[3] ?? '').split('; ').flatMap((part) => {
      const found = /^(.+) (From|To) (\d+)–(\d+)$/.exec(part);
      return found === null ? [] : [{ path: found[1] ?? '', side: found[2] === 'From' ? 'base' : 'target', start: Number(found[3]), end: Number(found[4]) }];
    }),
  }));
  const checks: unknown[] = [];
  const first = steps.find((step) => step.id.startsWith('W') && step.places.length > 0);
  if (first !== undefined) {
    const last = first.places[first.places.length - 1];
    checks.push({
      kind: 'question',
      title: `SIMULATED: Does every caller handle what ${base(last?.path ?? '')} returns?`,
      detail: 'SIMULATED: a question to look into at this step.',
      reasoning: 'SIMULATED reasoning: the changed lines depend on code outside the change. A real agent explains why that is worth checking.',
      places: first.places.map((place) => ({ label: `${base(place.path)} lines ${String(place.start)}–${String(place.end)}`, ...place })),
      step: first.id,
    });
  }
  const shown = new Set(steps.flatMap((step) => step.places.map((place) => place.path)));
  const missing = [...new Set(changed.map((range) => range.path))].filter((filePath) => !shown.has(filePath));
  const range = changed.find((entry) => entry.path === missing[0]);
  if (range !== undefined) {
    checks.push({
      kind: 'uncertainty',
      title: `SIMULATED: ${String(missing.length)} changed file(s) are in no walk, among them ${base(range.path)}.`,
      detail: 'SIMULATED: no step shows it, so it has its own tour.',
      reasoning: `SIMULATED reasoning: \`${range.path}\` changes, and no walk goes through it.`,
      places: [{ label: `${base(range.path)} lines ${String(range.start)}–${String(range.end)}`, path: range.path, side: range.side, start: range.start, end: range.end }],
    });
  }
  return fence({ checks });
}

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
  return fence({
    answer: `${opening}\n\nWhat was selected:\n${found.join('\n')}`,
    // The short part says what was selected; the dependency is the detail behind it.
    details: `SIMULATED details. ${dependency}`,
    references,
    insufficient: false,
  });
}

interface Found {
  readonly side: 'base' | 'target';
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly use: { readonly path: string; readonly line: number } | null;
}

/** The definition of `name` at one side, found by a search and read; and one place it is used. */
function definitionAt(reader: Reader, side: 'base' | 'target', name: string): Found | null {
  reader.searched(`(struct|class|interface|type|enum|function) ${name}`, side);
  const pattern = new RegExp(`\\b(?:struct|class|interface|type|enum|function)\\s+${name}\\b`);
  for (const filePath of reader.files(side)) {
    const scanned = reader.scan(side, filePath);
    const at = scanned?.findIndex((line) => pattern.test(line)) ?? -1;
    if (scanned === null || at < 0) {
      continue;
    }
    const lines = reader.read(side, filePath) ?? scanned;
    let end = at;
    while (end < lines.length - 1 && end - at < 40 && !/^\s*};?\s*$/.test(lines[end] ?? '') && !(end > at && /^\S/.test(lines[end] ?? ''))) {
      end += 1;
    }
    reader.searched(`${name}`, side);
    let use: Found['use'] = null;
    for (const usePath of reader.files(side)) {
      const useLines = reader.scan(side, usePath) ?? [];
      const line = useLines.findIndex((text, index) => text.includes(name) && !(usePath === filePath && index >= at && index <= end));
      if (line >= 0) {
        use = { path: usePath, line: line + 1 };
        break;
      }
    }
    return { side, path: filePath, start: at + 1, end: end + 1, text: lines.slice(at, end + 1).join('\n'), use };
  }
  return null;
}

/** A question in the review discussion, answered by searching and reading both revisions. */
function reviewQuestion(prompt: string, reader: Reader, asked: string[]): string {
  const question = /## Question\n([\s\S]*?)(?:\n\n## |\n*$)/.exec(prompt)?.[1]?.trim() ?? '';
  // An earlier answer to explain more simply (30 October 2026): say which, from what was sent.
  const simpler = /## The answer to explain more simply\n[\s\S]*?\nThe person asked: ([^\n]*)\n\nThe answer was:\n([\s\S]*?)\n\n## Question/.exec(prompt);
  if (simpler !== null) {
    asked.push(question);
    const selection = /Selected code, ([^\n]*?) @ \w+:\n(`{3,})\n([\s\S]*?)\n\2/.exec(prompt);
    return [
      `SIMULATED simpler explanation of the answer to “${(simpler[1] ?? '').slice(0, 120)}”.`,
      `The answer it explains began: “${(simpler[2] ?? '').replace(/\s+/g, ' ').slice(0, 80)}”.`,
      selection === null ? 'It was about no selection.' : `It was about the selection \`${selection[3] ?? ''}\` (${selection[1] ?? ''}).`,
      `Subject: ${/## Subject\n([^\n]*)/.exec(prompt)?.[1] ?? ''}`,
      DETAILS_MARKER,
      'SIMULATED details of the simpler explanation: a real agent gives the background and an example here.',
    ].join('\n\n');
  }
  const before = asked.length;
  asked.push(question);
  const sessionWords = before === 0 ? 'This is the first question in this session.' : `This session has had ${String(before)} question(s) before this one; the last was “${(asked[before - 1] ?? '').slice(0, 60)}”.`;
  // What the person selected, when the question is about a selection (30 October 2026).
  const selectedCode = /Selected code, (\S+) lines? (\d+)[^\n]*?· (base|target) \((?:From|To)\) @ \w+:\n(`{3,})\n([\s\S]*?)\n\4/.exec(prompt);
  const selectedText = /Selected text from [^\n]*\n(`{3,})\n([\s\S]*?)\n\1/.exec(prompt);
  let selectedName: string | null = null;
  let said = '';
  if (selectedCode !== null) {
    const [, selectedPath = '', line = '1', side = 'target', , text = ''] = selectedCode;
    said = `You selected \`${text}\` in \`${selectedPath}\` line ${line}, at ${side === 'base' ? 'From' : 'To'}.`;
    // A selected variable: its type, from the line it is declared on, is what to look up.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
      const lines = reader.read(side === 'base' ? 'base' : 'target', selectedPath) ?? [];
      const typed = new RegExp(`\\b${text}\\s*:\\s*([A-Z][A-Za-z0-9_]*)`).exec(lines.join('\n'));
      selectedName = typed?.[1] ?? text;
      if (typed !== null) {
        said += ` It is declared as \`${typed[1] ?? ''}\`.`;
      }
    }
  } else if (selectedText !== null) {
    said = `You selected this text, not code: “${(selectedText[2] ?? '').slice(0, 80)}”.`;
  }
  const name = selectedName ?? /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(question)?.[1] ?? /\b([A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+)\b/.exec(question)?.[1] ?? null;
  const session = [said, sessionWords].filter((part) => part !== '').join('\n\n');
  const refs = (references: unknown[], insufficient: boolean): string => `\n\n\`\`\`dspatch-references\n${JSON.stringify({ references, insufficient })}\n\`\`\``;
  if (name === null) {
    // No name to look up: the code the question is about, and the first function it calls.
    const focus = /^### focus · (.+?) lines (\d+)(?:–(\d+))? · (base|target) @/m.exec(prompt);
    const references: unknown[] = [];
    let found = 'The question names no type or function to look up, so this answer rests on the code sent with it.';
    if (focus !== null) {
      const [, focusPath = '', start = '1', end, side = 'target'] = focus;
      const focusSide = side === 'base' ? 'base' : 'target';
      const lines = reader.read(focusSide, focusPath);
      const first = Number(start);
      const last = Number(end ?? start);
      const definition = lines === null ? null : followCall(reader, focusSide, focusPath, lines, lines.slice(first - 1, last).join('\n'));
      references.push({ label: `The code asked about in ${base(focusPath)}`, path: focusPath, side: focusSide, start: first, end: last });
      const defined = /\b(?:function|class|interface|type|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec((lines ?? []).slice(first - 1, last).join('\n'))?.[1] ?? null;
      if (definition !== null) {
        references.push({ label: `${definition.name}, where it is defined`, path: definition.path, side: focusSide, start: definition.start, end: definition.end });
        found = `The code asked about calls \`${definition.name}\`, defined in \`${definition.path}\` lines ${String(definition.start)}–${String(definition.end)}, outside the change.` + (definition.returnsNull ? ' It can return `null`.' : '');
      } else if (defined !== null) {
        found = `The code asked about is where \`${defined}\` is defined, in \`${focusPath}\` lines ${String(first)}–${String(last)}.`;
      }
    }
    return `SIMULATED answer to “${question.slice(0, 90)}”.\n\n${session}\n\n${found}${refs(references, false)}`;
  }
  const fromDefinition = definitionAt(reader, 'base', name);
  const toDefinition = definitionAt(reader, 'target', name);
  if (fromDefinition === null && toDefinition === null) {
    return (
      `SIMULATED: I could not find a definition of \`${name}\` in either revision. I searched both From (\`base/\`) and To (\`target/\`) for a struct, class, interface, type, enum or function of that name.\n\n` +
      `What it is cannot be said from the code I could read, so I do not describe it.\n\n${session}${refs([], true)}`
    );
  }
  const references: unknown[] = [];
  const parts: string[] = [`SIMULATED answer about \`${name}\`.`, session];
  const describe = (found: Found, word: string): void => {
    references.push({ label: `${name}, defined in ${word}`, path: found.path, side: found.side, start: found.start, end: found.end });
    if (found.use !== null) {
      references.push({ label: `${name} in use, in ${word}`, path: found.use.path, side: found.side, start: found.use.line, end: found.use.line });
    }
  };
  if (fromDefinition !== null) {
    describe(fromDefinition, 'From');
  }
  if (toDefinition !== null) {
    describe(toDefinition, 'To');
  }
  const members = (found: Found | null): number => (found === null ? 0 : found.text.split('\n').length - 2);
  if (fromDefinition !== null && toDefinition !== null && fromDefinition.text === toDefinition.text) {
    parts.push(`\`${name}\` is defined in \`${toDefinition.path}\` lines ${String(toDefinition.start)}–${String(toDefinition.end)}, the same in From and To.`);
  } else if (fromDefinition !== null && toDefinition !== null) {
    parts.push(
      `\`${name}\` is defined in both revisions, **differently**: in From in \`${fromDefinition.path}\` lines ${String(fromDefinition.start)}–${String(fromDefinition.end)}, in To in \`${toDefinition.path}\` lines ${String(toDefinition.start)}–${String(toDefinition.end)}.`,
    );
  } else if (toDefinition !== null) {
    parts.push(`\`${name}\` is defined only in To, in \`${toDefinition.path}\` lines ${String(toDefinition.start)}–${String(toDefinition.end)}: the change adds it.`);
  } else if (fromDefinition !== null) {
    parts.push(`\`${name}\` is defined only in From, in \`${fromDefinition.path}\` lines ${String(fromDefinition.start)}–${String(fromDefinition.end)}: the change removes it.`);
  }
  const use = toDefinition?.use ?? fromDefinition?.use ?? null;
  // A table asked for is part of the answer itself; the rest is the detail behind it.
  const details: string[] = [];
  if (use !== null) {
    details.push(`It is used in \`${use.path}\` line ${String(use.line)}.`);
  }
  if (/\b(compare|table|jämför|tabell)\b/i.test(question)) {
    parts.push(
      [
        '| Revision | File | Lines | Members |',
        '| --- | --- | ---: | ---: |',
        `| From | ${fromDefinition === null ? '–' : `\`${fromDefinition.path}\``} | ${fromDefinition === null ? '–' : `${String(fromDefinition.start)}–${String(fromDefinition.end)}`} | ${String(members(fromDefinition))} |`,
        `| To | ${toDefinition === null ? '–' : `\`${toDefinition.path}\``} | ${toDefinition === null ? '–' : `${String(toDefinition.start)}–${String(toDefinition.end)}`} | ${String(members(toDefinition))} |`,
      ].join('\n'),
    );
  }
  details.push('What it means for the change is for a real agent to explain; this answer only shows where it is.');
  return `${parts.join('\n\n')}\n\n${DETAILS_MARKER}\n\n${details.join('\n\n')}${refs(references, false)}`;
}

/**
 * The simulated answer to an analysis task prompt, reading the revisions in `folder` (the
 * session's working folder), or `null` for any other prompt. `asked` is what this session
 * was asked before, kept by the adapter as a session keeps its history.
 */
export function simulatedReviewTask(prompt: string, folder: string, asked: string[] = []): SimulatedTaskAnswer | null {
  if (!prompt.startsWith(TASK_HEADER)) {
    return null;
  }
  const task = prompt.slice(TASK_HEADER.length).split('\n')[0]?.trim() ?? '';
  const reader = new Reader(folder);
  let answer: string | null = null;
  if (task === 'prepare-walks') {
    answer = prepareWalks(prompt, reader);
  } else if (task === 'repair-walks') {
    answer = fence(lastWalks ?? { summary: '', walks: [] });
  } else if (task === 'delegated-review') {
    answer = delegatedReview(prompt, reader);
  } else if (task === 'step-question') {
    answer = stepQuestion(prompt, reader);
  } else if (task === 'worth-checking') {
    answer = worthChecking(prompt);
  } else if (task === 'explain-selection') {
    answer = explainSelection(prompt, reader);
  } else if (task === 'review-question') {
    answer = reviewQuestion(prompt, reader, asked);
  }
  return answer === null ? null : { answer, tools: reader.tools };
}
