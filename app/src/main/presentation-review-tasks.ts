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
 *   approved. With `DSPATCH_REVIEW_SIM=rich-review` it adds a repeated question and a note.
 * - A step question reads the step's places, follows the first imported function they call
 *   to its definition, and answers with both as references.
 * - An explanation of selected code reads each selected part at its side and answers only
 *   if the selected text is there; it names each part's kind and the definition it calls.
 * - DSP-175: when such changed lines instead call a function imported from a package (not a
 *   relative path) that a context repository the host wrote (`context/<name>/`) defines,
 *   the step gets a context place there instead: `repository`, path and lines, no side.
 * - A walk preparation also proposes points worth checking: one linked to the first code
 *   walk's first step, and one with its own tour for a changed file no walk covers.
 * - A question in the review discussion that can read the code (30 October 2026) takes the
 *   first name it asks about — in backticks, or a CamelCase word — searches both revisions
 *   for its definition (`struct`, `class`, `interface`, `type`, `enum`, `function`), reads
 *   the file it is in and one use of it, and answers with what it found at each side,
 *   as references. Asked to compare, it answers with a table. When the name is defined at
 *   neither side, it looks in the other repositories of the workspace the host wrote as
 *   context (`context/<name>/`, DSP-175) and, when one defines it, answers with a context
 *   reference (`repository`, no side), saying at which commit it read it and, from the
 *   prompt, whether that is the version the reviewed build uses. Else it says so, with no
 *   reference. It says how many questions came before it
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

/** A side of the revisions, or a context repository's folder (DSP-175). */
type ReaderSide = 'base' | 'target' | `context/${string}`;

/** The simulated agent's reading, confined to its folder and recorded as tool calls. */
class Reader {
  readonly tools: SimulatedToolCall[] = [];

  private readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  folderPath(): string {
    return this.folder;
  }

  /** A file's lines at one side, or `null` when it is not in the folder. */
  read(side: ReaderSide, repoPath: string): string[] | null {
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
  files(side: ReaderSide): string[] {
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

  /** The context repositories in the folder (DSP-175), by name. */
  contextNames(): string[] {
    try {
      return fs
        .readdirSync(path.join(this.folder, 'context'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** A context repository's files as a search goes through them, and one read, confined to it. */
  contextFiles(name: string): string[] {
    return this.files(`context/${name}`);
  }

  readContext(name: string, repoPath: string): string[] | null {
    return this.read(`context/${name}`, repoPath);
  }

  scanContext(name: string, repoPath: string): string[] | null {
    return this.scan(`context/${name}`, repoPath);
  }

  /** A text file's lines without recording a read: what a search tool scans. */
  scan(side: ReaderSide, repoPath: string): string[] | null {
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

/**
 * DSP-175: the definition of a function a line calls, when the file imports it from a package
 * (not a relative path) and a context repository of the workspace defines it: searched for in
 * each context repository in name order, its files in path order, so the answer is the same
 * every time.
 */
function followCallIntoContext(
  reader: Reader,
  fileLines: readonly string[],
  line: string,
): { readonly repository: string; readonly name: string; readonly path: string; readonly start: number; readonly end: number } | null {
  for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1] ?? '';
    const imported = fileLines
      .map((entry) => /import\s*\{([^}]*)\}\s*from\s*['"]([^'"./][^'"]*)['"]/.exec(entry))
      .find((found) => found !== null && (found[1] ?? '').split(',').map((part) => part.trim().split(/\s+as\s+/)[0]).includes(name));
    if (imported === undefined || imported === null) {
      continue;
    }
    const pattern = new RegExp(`\\b(function\\s+${name}\\b|const\\s+${name}\\s*=)`);
    for (const repository of reader.contextNames()) {
      reader.tools.push({ name: 'Grep', subject: `function ${name} in ${path.join(reader.folderPath(), 'context', repository)}`, ok: true });
      for (const filePath of reader.contextFiles(repository).sort()) {
        const scanned = reader.scanContext(repository, filePath);
        const at = scanned?.findIndex((entry) => pattern.test(entry)) ?? -1;
        if (scanned === null || at < 0) {
          continue;
        }
        const lines = reader.readContext(repository, filePath) ?? scanned;
        let end = at;
        while (end < lines.length - 1 && end - at < 30 && !/^\}/.test(lines[end] ?? '')) {
          end += 1;
        }
        return { repository, name, path: filePath, start: at + 1, end: end + 1 };
      }
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

/** A proposed step as the simulated provider writes it; `details` only with a profile (DSP-181). */
interface SimStep {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly details?: string;
  /** DSP-185: why several places are shown together, on the one comparison step. */
  readonly together?: string;
  /** DSP-185: what is new at a place shown again. */
  readonly revisit?: string;
  readonly places: unknown[];
}

interface SimWalk {
  readonly kind: 'walk' | 'reading';
  readonly title: string;
  readonly question: string;
  readonly purpose: string;
  readonly steps: SimStep[];
}

/**
 * DSP-181, SIMULATED: a step's explanation in the profile the prompt asks for, over the same
 * places and facts as the legacy text. The three profiles differ in selection and length; a
 * real agent writes from the code. Nothing but "body" and "details" changes with the profile.
 */
function stepExplanation(
  profile: string | null,
  legacyBody: string,
  filePath: string,
  range: { readonly side: 'base' | 'target'; readonly start: number; readonly end: number },
  definition: { readonly name: string; readonly path: string; readonly start: number; readonly end: number; readonly returnsNull: boolean } | null,
): { readonly body: string; readonly details?: string } {
  if (profile === null) {
    return { body: legacyBody };
  }
  const where = `\`${filePath}\` lines ${String(range.start)}–${String(range.end)}`;
  const change = range.side === 'base' ? 'were removed' : 'were added or changed';
  const call = definition === null ? null : `\`${definition.name}\``;
  const nullNote = definition?.returnsNull === true ? ` It can return \`null\`, and the caller decides what that means.` : '';
  if (profile === 'Essentials') {
    return {
      body: `SIMULATED Essentials: the lines in ${where} ${change}${call === null ? '' : `, and they call ${call}`}.${nullNote}`,
      details: `SIMULATED deepening (Essentials): what each of the lines in ${where} does, in order${call === null ? '' : `, and where ${call} is defined`}.`,
    };
  }
  if (profile === 'Teacher') {
    return {
      body:
        `SIMULATED Teacher. First the idea: a change to a file is read as a difference between two versions, From and To, and a walk follows what the changed lines do rather than listing them. ` +
        `A call is where one function hands work to another; following it shows where a value comes from. ` +
        `Think of reading a recipe step that says "make the sauce": the sauce has its own recipe elsewhere, and you turn to it to understand the step.\n\n` +
        `Now the code: the lines in ${where} ${change}.${call === null ? '' : ` They call ${call}, which is defined in \`${definition?.path ?? ''}\` and is not touched by this change.`}${nullNote} ` +
        `The consequence is that the behaviour at these lines now follows${call === null ? ' this code alone' : ` what ${call} returns`}.`,
      details: `SIMULATED deepening (Teacher): in the same plain words, each line of ${where} and the case${call === null ? ' the change does not cover' : ` where ${call} gives nothing back`}.`,
    };
  }
  return {
    body:
      `SIMULATED Standard: the lines in ${where} ${change}. ` +
      (call === null ? 'Nothing else is reached from these lines, so their effect is local to this file. ' : `They call ${call}, defined in \`${definition?.path ?? ''}\` lines ${String(definition?.start ?? 0)}–${String(definition?.end ?? 0)}, which this change does not touch. `) +
      `The value the lines work with comes from the caller of this code and is handed on unchanged.${nullNote} ` +
      'A real agent explains the reason for the change from the code; this text only shows the shape of a Standard explanation.',
    details: `SIMULATED deepening (Standard): the mechanism step by step in ${where}, the special case${call === null ? '' : ` of ${call} giving nothing back`}, and the test that covers it.`,
  };
}

/**
 * DSP-185, SIMULATED: the changed ranges of one file in the order a walk follows them. A range
 * that calls a function defined in another changed range of the same file and side is followed
 * by that range, in call order, which records the call it is reached from; the rest keep their
 * order. Stands in for a real agent's judgement that the implementations are central.
 */
function callOrder(
  ranges: readonly SimRange[],
  linesOf: (side: 'base' | 'target') => string[] | null,
): { readonly range: SimRange; readonly from: { readonly name: string; readonly range: SimRange } | null }[] {
  const defines = (range: SimRange): string | null => {
    const text = (linesOf(range.side) ?? []).slice(range.start - 1, range.end).join('\n');
    return /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(text)?.[1] ?? null;
  };
  const calls = (range: SimRange): string[] => {
    const text = (linesOf(range.side) ?? []).slice(range.start - 1, range.end).join('\n');
    return [...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1] ?? '').filter((name) => name !== '' && !/^(function|if|for|while|switch|return)$/.test(name));
  };
  const out: { range: SimRange; from: { name: string; range: SimRange } | null }[] = [];
  const placed = new Set<SimRange>();
  const visit = (range: SimRange, from: { name: string; range: SimRange } | null): void => {
    if (placed.has(range)) {
      return;
    }
    placed.add(range);
    out.push({ range, from });
    const own = defines(range);
    for (const name of calls(range)) {
      if (name === own) {
        continue;
      }
      const callee = ranges.find((other) => other !== range && other.side === range.side && !placed.has(other) && defines(other) === name);
      if (callee !== undefined) {
        visit(callee, { name, range });
      }
    }
  };
  for (const range of ranges) {
    visit(range, null);
  }
  return out;
}

function prepareWalks(prompt: string, reader: Reader): string {
  // DSP-181: the profile the step explanations are written in, when the person chose one before preparing.
  const profile = /^## How to explain the steps \((Essentials|Standard|Teacher)\)$/m.exec(prompt)?.[1] ?? null;
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
  const walks: SimWalk[] = kept.flatMap((filePath): SimWalk[] => {
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
        // DSPATCH_REVIEW_SIM=threads (DSP-175): in line order, a change's old and new lines
        // one after the other, as an agent explains a change from both sides.
        // DSP-185: one place per step; a called function's definition is a step of its own after the call.
        // DSP-185: a function the change calls and defines in another changed part of the same
        // file is visited right after its caller, in call order, reached from the call.
        steps: callOrder(process.env['DSPATCH_REVIEW_SIM'] === 'threads' ? [...ranges].sort((a, b) => a.start - b.start || (a.side === 'base' ? -1 : 1)) : ranges, linesOf).flatMap(({ range, from: calledFrom }, index): SimStep[] => {
          const lines = linesOf(range.side);
          const changedText = (lines ?? []).slice(range.start - 1, range.end).join('\n');
          const definition = lines === null ? null : followCall(reader, range.side, filePath, lines, changedText);
          // DSP-175: a call into a package another repository of the workspace defines.
          const inContext = definition !== null || lines === null ? null : followCallIntoContext(reader, lines, changedText);
          const places: unknown[] = [
            {
              label: calledFrom === null ? `${base(filePath)} lines ${String(range.start)}–${String(range.end)}` : `${calledFrom.name}, as the change adds it`,
              path: filePath,
              side: range.side,
              start: range.start,
              end: range.end,
              ...(calledFrom === null ? {} : { from: { label: `The call of ${calledFrom.name}`, path: filePath, side: range.side, start: calledFrom.range.start, end: calledFrom.range.end } }),
            },
          ];
          if (inContext !== null) {
            places.push({
              label: `Where ${inContext.name} is defined, in ${inContext.repository} (context)`,
              repository: inContext.repository,
              path: inContext.path,
              start: inContext.start,
              end: inContext.end,
              anchor: inContext.name,
              note: `SIMULATED: ${inContext.repository} is another repository of the workspace, read as context at the commit the analysis recorded. It is not under review.`,
            });
          }
          const legacyBody =
              (calledFrom === null ? '' : `**Where this comes from:** the caller calls \`${calledFrom.name}\` (the step before); here is what it does.\n\n`) +
              `**What happens:** ${range.side === 'base' ? 'these lines were removed' : 'these lines were added or changed'} in \`${filePath}\`.\n\n` +
              (inContext === null
                ? ''
                : `**What it depends on:** \`${inContext.name}\`, defined in \`${inContext.repository}\` (another repository of the workspace, read as context) in \`${inContext.path}\` lines ${String(inContext.start)}–${String(inContext.end)}.\n\n`) +
              (definition === null
                ? ''
                : `**What it depends on:** \`${definition.name}\`, which this change does not touch; the next step shows where it is defined.` +
                  (definition.returnsNull ? ' It can return `null`.' : '') +
                  '\n\n') +
              `**Why:** a simulated answer cannot say; a real agent explains the reason from the code.\n\n` +
              `**Notice:** step ${String(index + 1)} of this file.`;
          const change: SimStep = {
            title: calledFrom === null ? `${range.side === 'base' ? 'Removed' : 'Changed'} lines ${String(range.start)}–${String(range.end)}` : `What ${calledFrom.name} does`,
            summary: `${range.side === 'base' ? 'The From version had' : 'The To version has'} these lines in ${base(filePath)}.`,
            ...stepExplanation(profile, legacyBody, filePath, range, definition),
            places,
          };
          if (definition === null) {
            return [change];
          }
          // The definition the change calls, reached from the call: its own step, building on the one before.
          return [
            change,
            {
              title: `Where ${definition.name} is defined`,
              summary: `The definition the previous step calls, unchanged by this change.`,
              body:
                `${profile === null ? '' : `SIMULATED ${profile}: `}**What happens:** in the previous step the changed lines call \`${definition.name}\`; here is its definition, which this change does not touch.` +
                (definition.returnsNull ? ' It can return `null`, and the caller decides what that means.' : '') +
                '\n\n**Why:** a simulated answer cannot say; a real agent explains what the definition means for the change.',
              places: [
                {
                  label: `Where ${definition.name} is defined`,
                  path: definition.path,
                  side: range.side,
                  start: definition.start,
                  end: definition.end,
                  anchor: definition.name,
                  from: { label: `The call of ${definition.name}`, path: filePath, side: range.side, start: range.start, end: range.end },
                },
              ],
            },
          ];
        }),
      },
    ];
  });
  // DSPATCH_REVIEW_SIM=threads (DSP-175): the first walk ends by coming back to its first
  // change, after the others, so the same code is in two separate panes of the map.
  if (process.env['DSPATCH_REVIEW_SIM'] === 'threads') {
    const walk = walks.find((entry) => entry.kind === 'walk' && entry.steps.length >= 3) as { steps: { places: unknown[] }[] } | undefined;
    const firstPlace = walk?.steps[0]?.places[0];
    if (walk !== undefined && firstPlace !== undefined) {
      walk.steps.push({
        title: 'Back to the first change',
        summary: 'The first change again, now that the rest has been read.',
        body: '**What happens:** the walk returns to where it began. SIMULATED: a later return to the same code, in a pane of its own.',
        revisit: 'Now that the rest has been read, the first change reads as the start of everything that follows.',
        places: [{ ...(firstPlace as Record<string, unknown>), label: 'The first change, again' }],
      } as never);
    }
  }
  // DSP-185: in the default scenario, one justified exception: two changed places of the first
  // code walk shown side by side, with the reason why seeing them together helps.
  if (process.env['DSPATCH_REVIEW_SIM'] === undefined || process.env['DSPATCH_REVIEW_SIM'] === '') {
    for (const walk of walks) {
      const ownPlaces = walk.kind === 'walk' ? walk.steps.map((step) => step.places[0] as { path?: string; side?: string; start?: number; end?: number; label?: string } | undefined) : [];
      const changed = ownPlaces.filter((place) => place !== undefined && place.side === 'target' && !('from' in place));
      const [first, second] = changed;
      if (first === undefined || second === undefined || isData(String(first.path)) || first.path !== second.path) {
        continue;
      }
      walk.steps.push({
        title: 'The two changes side by side',
        summary: 'Two of the changed places of this file, compared.',
        body: `${profile === null ? '' : `SIMULATED ${profile}: `}**What to compare:** the earlier steps explained each of these places on its own; side by side they show whether the file changes in the same way in both. SIMULATED: a real agent says what the comparison shows.`,
        together: 'Seeing both changed places at once lets the reader compare how the two parts of the file change.',
        places: [first, second].map((place) => ({ ...place, label: `${String(place?.label ?? '')} (compared)` })),
      } as SimStep);
      break;
    }
  }
  const readings = walks.filter((walk) => walk.kind === 'reading').length;
  const answer = {
    summary: `SIMULATED: ${String(walks.length - readings)} code walk(s) and ${String(readings)} reading(s) over ${String(kept.length)} of ${String(paths.length)} changed file(s).`,
    background:
      'SIMULATED background, shown only on request.\n\nThe presentation adapter proposes one item per changed file: a code walk for code and readings for text. A real agent chooses the form from what changed.',
    walks,
  };
  lastWalks = answer;
  // DSP-185: DSPATCH_REVIEW_SIM=crowded puts two places that each need their own explanation in
  // one step with no reason, and answers the repair round the same way; crowded-once corrects it
  // in the repair round; crowded-worse splits it in the repair round but drops a step, losing
  // places and covered lines, so the first answer is to be kept.
  const crowdedMode = process.env['DSPATCH_REVIEW_SIM'];
  if (crowdedMode === 'crowded' || crowdedMode === 'crowded-once' || crowdedMode === 'crowded-worse') {
    const crowded = JSON.parse(JSON.stringify(answer)) as { walks: { steps: { title: string; body: string; places: { path?: string }[] }[] }[] };
    const at = crowded.walks.flatMap((walk, walkIndex) => walk.steps.map((step, stepIndex) => ({ walkIndex, stepIndex, path: step.places[0]?.path ?? '' })));
    const first = at[0];
    const second = at.find((entry) => first !== undefined && entry.path !== first.path);
    const into = first === undefined ? undefined : crowded.walks[first.walkIndex]?.steps[first.stepIndex];
    const from = second === undefined ? undefined : crowded.walks[second.walkIndex]?.steps[second.stepIndex];
    if (first !== undefined && second !== undefined && into !== undefined && from !== undefined) {
      into.places = [...into.places, ...from.places];
      into.title = `${into.title} and ${from.title}`;
      into.body = `${into.body}\n\nSIMULATED: one shared text for two places.`;
      crowded.walks[second.walkIndex]?.steps.splice(second.stepIndex, 1);
      crowded.walks = crowded.walks.filter((walk) => walk.steps.length > 0);
    }
    if (crowdedMode === 'crowded') {
      lastWalks = crowded;
    }
    if (crowdedMode === 'crowded-worse') {
      const worse = JSON.parse(JSON.stringify(answer)) as { walks: { steps: unknown[] }[] };
      worse.walks.at(-1)?.steps.pop();
      worse.walks = worse.walks.filter((walk) => walk.steps.length > 0);
      lastWalks = worse;
    }
    return fence(crowded);
  }
  if (process.env['DSPATCH_REVIEW_SIM'] === 'bad-ref-first' && walks[0] !== undefined) {
    const broken = JSON.parse(JSON.stringify(answer)) as { walks: { steps: { places: unknown[] }[] }[] };
    const firstPlace = (broken.walks[0]?.steps[0]?.places[0] ?? {}) as { path?: string };
    broken.walks[0]?.steps[0]?.places.push({ label: 'A line that is not there', path: firstPlace.path ?? 'missing.ts', side: 'target', start: 9999, end: 9999 });
    return fence({ ...answer, walks: broken.walks });
  }
  return fence(answer);
}

/**
 * DSP-189, SIMULATED: the planner's answer is the same walks the one call gives, without the
 * explanation texts and with a brief per step; the repair round answers from it as before.
 */
function planWalks(prompt: string, reader: Reader): string {
  const fenced = prepareWalks(prompt, reader);
  const raw = /```json\s*\n([\s\S]*?)\n```/.exec(fenced)?.[1] ?? '{}';
  let parsed: { summary?: string; background?: string; walks?: { steps?: Record<string, unknown>[] }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    parsed = {};
  }
  const walks = (parsed.walks ?? []).map((walk) => ({
    ...walk,
    steps: (walk.steps ?? []).map(({ body: _body, details: _details, ...step }) => ({
      ...step,
      brief: `SIMULATED brief: explain ${String(step['title'] ?? 'this step')} here, how it is reached and what the reader takes to the next step.`,
    })),
  }));
  const plan = { summary: parsed.summary ?? '', background: parsed.background ?? '', walks };
  lastWalks = plan;
  return fence(plan);
}

/** The profile the writer was last told, since only its first turn in the session names it. */
let lastWriteProfile: string | null = null;

/** DSP-189, SIMULATED: the writer's text for one step, in the profile its session was given. */
function writeStep(prompt: string): string {
  const profile = /^## How to explain the step \((Essentials|Standard|Teacher)\)$/m.exec(prompt)?.[1] ?? null;
  if (profile !== null) {
    lastWriteProfile = profile;
  }
  const named = lastWriteProfile ?? 'Standard';
  const step = /^## This step: (\S+) (.*)$/m.exec(prompt);
  const id = step?.[1] ?? '?';
  const title = step?.[2] ?? '';
  const place = /^- [^:\n]+: (\S+) \((From|To)\) lines (\d+)–(\d+)/m.exec(prompt.slice(prompt.indexOf('## This step')));
  const where = place === null ? 'the step\'s place' : `\`${place[1] ?? ''}\` lines ${place[3] ?? ''}–${place[4] ?? ''}`;
  const rework = prompt.includes("## The reviewer's findings about this step");
  const simFailAt = process.env['DSPATCH_REVIEW_SIM_FAIL_WRITE_STEP'];
  if (simFailAt !== undefined && simFailAt === id) {
    // Nothing readable: the executor records an empty answer and goes on.
    return '';
  }
  return [
    `SIMULATED ${named} explanation of ${id} ${title}${rework ? ' (written again from the reviewer\'s finding)' : ''}: what the code at ${where} does here and why it matters for the change, at the ${named} reader's level.`,
    '',
    DETAILS_MARKER_LINE,
    `SIMULATED deepening (${named}) for ${id}: the mechanism behind the first part, and the special case that changes the outcome.`,
  ].join('\n');
}

const DETAILS_MARKER_LINE = '<!-- dspatch:details -->';

/**
 * DSP-189, SIMULATED: the reviewer accepts, or with `DSPATCH_REVIEW_SIM=loop-rework` asks once
 * for the first step's explanation to be written again and then leaves one objection on
 * record; `loop-replan` sends a structural finding to the planner instead and then accepts.
 */
function reviewWalks(prompt: string): string {
  const final = prompt.includes('## The final assessment');
  const firstStep = /^#### (\S+) /m.exec(prompt)?.[1] ?? 'W1.1';
  const variant = process.env['DSPATCH_REVIEW_SIM'];
  if (variant === 'loop-rework' && !final) {
    return fence({
      assessment: 'SIMULATED: the walks follow the change, but the first step names its function without explaining what decides its outcome.',
      verdict: 'rework',
      findings: [{ kind: 'explanation', steps: [firstStep], problem: 'SIMULATED: the step does not say what decides the outcome at this place.', why: 'The reader cannot judge the change without it.', evidence: 'The lines the step shows.', reference: 'section 2' }],
    });
  }
  if (variant === 'loop-rework' && final) {
    return fence({
      assessment: 'SIMULATED final assessment: the first step now says what decides its outcome; one objection remains.',
      verdict: 'objections',
      findings: [{ kind: 'explanation', steps: [firstStep], problem: 'SIMULATED remaining objection: the deepening still repeats the first part.', why: 'Show more should continue the first part.', evidence: '', reference: 'section 4' }],
    });
  }
  if (variant === 'loop-replan' && !final) {
    return fence({
      assessment: 'SIMULATED: a central function is left behind its name.',
      verdict: 'rework',
      findings: [{ kind: 'structure', steps: [firstStep], problem: 'SIMULATED: the function this step calls is central and needs a step of its own.', why: 'Important new implementation must not disappear behind a name.', evidence: 'The call on the shown lines.', reference: 'section 2' }],
    });
  }
  return fence({ assessment: `SIMULATED ${final ? 'final assessment' : 'review'}: the reader can follow the course and each shown place is explained.`, verdict: 'accept', findings: [] });
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
  const findings: { severity: string; title?: string; text: string; details?: string; evidence?: string; recommendation?: Record<string, string>; path: string; side: string; start: number; end: number }[] = [];
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
                title: `SIMULATED: the result of ${definition.name} is used unchecked`,
                text: `SIMULATED: \`${definition.name}\` can return null, and this line uses its result without a check, so it can fail at run time.`,
                details: `SIMULATED: the definition is in ${definition.path}, line ${String(definition.start)}.`,
                evidence: `SIMULATED: read ${range.path} line ${String(line)} and the definition in ${definition.path}.`,
                recommendation: {
                  kind: 'change',
                  action: `SIMULATED: check the result of ${definition.name} for null before using it.`,
                  rationale: 'SIMULATED: the definition shows a null return on a reachable path.',
                  uncertainty: 'SIMULATED: callers may already guard against it; none was found.',
                  nextStep: '',
                },
                path: range.path,
                side: range.side,
                start: line,
                end: line,
              }
            : {
                severity: 'problem',
                title: 'SIMULATED: added2 is unused',
                text: 'SIMULATED: `added2` is exported but nothing uses it, so it is code nobody exercises.',
                evidence: 'SIMULATED: searched the To revision for added2; only its definition matched.',
                recommendation: {
                  kind: 'investigate',
                  action: 'SIMULATED: find out whether another repository imports added2 before removing it.',
                  rationale: 'SIMULATED: an export can be used outside this repository.',
                  uncertainty: 'SIMULATED: other repositories were not searched.',
                  nextStep: 'SIMULATED: search the workspace for "added2".',
                },
                path: range.path,
                side: range.side,
                start: line,
                end: line,
              },
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
  // DSPATCH_REVIEW_SIM=rich-review: several findings and a repeat, to look at how they read.
  // DSPATCH_REVIEW_SIM=mixed (DSP-193): rich-review and threads together, with long headings
  // and a long path, open questions beside assessed lines and gaps of both kinds.
  const sim = process.env['DSPATCH_REVIEW_SIM'];
  const first = reviewed[0];
  if ((sim === 'rich-review' || sim === 'mixed') && first !== undefined) {
    const at = { path: first.path, side: first.side };
    const question = { severity: 'question', title: 'SIMULATED: is this value meant to be public?', text: 'SIMULATED: the export widens what callers can reach, and later changes to it then break them.' };
    findings.push({ ...question, ...at, start: first.start, end: first.start });
    findings.push({ ...question, ...at, start: first.end, end: first.end });
    findings.push({ severity: 'note', title: 'SIMULATED: the naming differs from its neighbours', text: 'SIMULATED: nothing breaks, but the next reader has to look twice.', ...at, start: first.start, end: first.start });
  }
  // DSPATCH_REVIEW_SIM=threads (DSP-175): what review threads must hold, deterministically: a
  // question on a removed (From) line, a place that does not exist at its commit, a question
  // whose recommendation is to keep the code, and gaps tied to a finding and of their own.
  const gaps: Record<string, unknown>[] = [];
  if ((sim === 'threads' || sim === 'mixed') && first !== undefined) {
    const removed = changed.find((span) => span.side === 'base' && scope.some((range) => range.path === span.path));
    if (removed !== undefined) {
      findings.push({
        severity: 'question',
        title: 'SIMULATED: why was this line removed?',
        text: 'SIMULATED: the removed line handled a case that nothing in the To revision handles.',
        evidence: `SIMULATED: read ${removed.path} line ${String(removed.start)} at From and the whole file at To.`,
        recommendation: { kind: 'ask-author', action: 'SIMULATED: ask the author whether the case is handled elsewhere.', rationale: 'SIMULATED: the change gives no reason.', uncertainty: '', nextStep: '' },
        path: removed.path,
        side: 'base',
        start: removed.start,
        end: removed.start,
      });
    }
    findings.push({
      severity: 'problem',
      title: 'SIMULATED: a place that is not there',
      text: 'SIMULATED: this finding names a line the file does not have, to show an anchor that cannot be found.',
      path: first.path,
      side: first.side,
      start: 9999,
      end: 9999,
    });
    findings.push({
      severity: 'question',
      title: 'SIMULATED: is the greeting meant to end with an exclamation mark?',
      text: 'SIMULATED: the punctuation changed in the greeting.',
      evidence: `SIMULATED: read ${first.path} line ${String(first.start)}.`,
      recommendation: { kind: 'keep', action: 'SIMULATED: keep the code as it is.', rationale: 'SIMULATED: the commit message says the punctuation is intended.', uncertainty: '', nextStep: '' },
      ...{ path: first.path, side: first.side },
      start: first.start,
      end: first.start,
    });
    if (findings[0] !== undefined && findings[0].title !== undefined) {
      gaps.push({ text: 'SIMULATED: whether any caller depends on the old behaviour was not established.', finding: findings[0].title, recommendation: { kind: 'test', action: 'SIMULATED: add a test over the callers.', rationale: 'SIMULATED: no test covers them.', nextStep: 'SIMULATED: list the callers with a search.' } });
    }
    gaps.push({ text: 'SIMULATED: how the module behaves under load was not established.', evidence: 'SIMULATED: no benchmark is in the repository.', recommendation: { kind: 'measure', action: 'SIMULATED: measure the call under load.', rationale: 'SIMULATED: nothing in the code says.', nextStep: 'SIMULATED: time 10 000 calls.' } });
  }
  if (sim === 'mixed' && first !== undefined) {
    const last = reviewed[reviewed.length - 1] ?? first;
    findings.push({
      severity: 'problem',
      title: 'SIMULATED: the retry count is reset by every caller, so two overlapping calls can make more attempts than the configured maximum allows',
      text: 'SIMULATED: a long heading, to see that it stays readable beside its status, kind and reply count in a narrow panel.',
      evidence: `SIMULATED: read ${last.path} lines ${String(last.start)}–${String(last.end)} and src/very/deeply/nested/folder/structure/with/a/long/path/to/the/module/implementation.ts lines 1–40.`,
      recommendation: { kind: 'change', action: 'SIMULATED: keep the attempt count per call, not per instance.', rationale: 'SIMULATED: the field is shared by every call on the instance.', uncertainty: 'SIMULATED: whether callers overlap in practice was not established.', nextStep: 'SIMULATED: find the callers.' },
      path: last.path,
      side: last.side,
      start: last.end,
      end: last.end,
    });
    findings.push({
      severity: 'question',
      title: 'SIMULATED: should the pause after the last failed attempt be skipped?',
      text: 'SIMULATED: the loop waits once more after the final failure, which delays the gave-up report by the longest pause.',
      evidence: `SIMULATED: read ${last.path} lines ${String(last.start)}–${String(last.end)}.`,
      recommendation: { kind: 'ask-author', action: 'SIMULATED: ask whether the trailing pause is intended.', rationale: 'SIMULATED: nothing in the change says.', uncertainty: '', nextStep: '' },
      path: last.path,
      side: last.side,
      start: last.start,
      end: last.start,
    });
    gaps.push({ text: 'SIMULATED: whether the timer callback can run after the test harness has torn the module down was not established.', evidence: 'SIMULATED: no test drives the timers.', recommendation: { kind: 'test', action: 'SIMULATED: add a test with fake timers.', rationale: 'SIMULATED: the order is only read from the code.', nextStep: 'SIMULATED: write the test.' } });
  }
  return fence({
    summary: findings.length > 0 ? 'SIMULATED: the lines without a problem are approved; the lines with one are not.' : 'SIMULATED: every delegated line is approved.',
    assessment: `SIMULATED: reviewed ${String(reviewed.length)} changed range(s) in the delegated part, reading them and what they call in the revision folder.`,
    reviewed,
    approved,
    findings,
    ...(gaps.length > 0
      ? { gaps }
      : { uncertainties: findings.length > 0 ? ['No test was run; whether a caller already guards against null was not established.'] : [] }),
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
      evidence: `SIMULATED: read the step's places in ${base(last?.path ?? '')} at To.`,
      recommendation: {
        kind: 'investigate',
        action: 'SIMULATED: look at every caller of the changed function.',
        rationale: 'SIMULATED: the change alters what callers receive.',
        uncertainty: 'SIMULATED: whether a caller already guards against it was not established.',
        nextStep: 'SIMULATED: search the To revision for the callers.',
      },
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
      evidence: 'SIMULATED: the walks given in the prompt list no place in that file.',
      recommendation: { kind: 'test', action: 'SIMULATED: add or run a test over the file no walk shows.', rationale: 'SIMULATED: nothing in the walks covers it.', uncertainty: '', nextStep: 'SIMULATED: run the tests that import it.' },
    });
  }
  // DSPATCH_REVIEW_SIM=threads (DSP-175): a finding that says the same as the delegated review's
  // keep-the-code question, so it joins that thread instead of making a second one, and a finding
  // point of its own whose recommendation is a change.
  const target = changed.find((entry) => entry.side === 'target');
  if (process.env['DSPATCH_REVIEW_SIM'] === 'threads' && target !== undefined) {
    checks.push({
      kind: 'finding',
      title: 'SIMULATED: is the greeting meant to end with an exclamation mark?',
      reasoning: 'SIMULATED reasoning: the same point a delegated review raises.',
      places: [{ label: `${base(target.path)} line ${String(target.start)}`, path: target.path, side: 'target', start: target.start, end: target.start }],
      evidence: `SIMULATED: read ${target.path} line ${String(target.start)}.`,
      recommendation: { kind: 'keep', action: 'SIMULATED: keep the code as it is.', rationale: 'SIMULATED: the punctuation is intended.', uncertainty: '', nextStep: '' },
    });
    checks.push({
      kind: 'finding',
      title: 'SIMULATED: the changed line is not covered by a test',
      detail: 'SIMULATED: a finding point with a recommended change.',
      reasoning: 'SIMULATED reasoning: no test in the To revision reads this line.',
      places: [{ label: `${base(target.path)} lines ${String(target.start)}–${String(target.end)}`, path: target.path, side: 'target', start: target.start, end: target.end }],
      evidence: 'SIMULATED: searched the test folder at To for the function name.',
      recommendation: { kind: 'change', action: 'SIMULATED: add a test that exercises the changed line.', rationale: 'SIMULATED: a regression would go unnoticed.', uncertainty: '', nextStep: 'SIMULATED: write one test case.' },
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

/**
 * A definition of `name` in a context repository of the workspace (DSP-175): searched for
 * in each, read, and cited with its repository. The commit and how it was chosen are taken
 * from what the prompt says of that repository, so the answer says what was read.
 */
function contextDefinition(reader: Reader, name: string, prompt: string): { readonly text: string; readonly reference: unknown } | null {
  const pattern = new RegExp(`\\b(?:struct|class|interface|type|enum|function)\\s+${name}\\b`);
  for (const repository of reader.contextNames()) {
    reader.tools.push({ name: 'Grep', subject: `(struct|class|interface|type|enum|function) ${name} in ${path.join(reader.folderPath(), 'context', repository)}`, ok: true });
    for (const filePath of reader.contextFiles(repository)) {
      const scanned = reader.scanContext(repository, filePath);
      const at = scanned?.findIndex((line) => pattern.test(line)) ?? -1;
      if (scanned === null || at < 0) {
        continue;
      }
      const lines = reader.readContext(repository, filePath) ?? scanned;
      let end = at;
      while (end < lines.length - 1 && end - at < 40 && !/^\}/.test(lines[end] ?? '')) {
        end += 1;
      }
      const said = new RegExp(`\`context/${repository}/\`: repository ${repository} at commit ([0-9a-f]{40})\\. ([^\\n]*)`).exec(prompt);
      const commit = said?.[1] ?? '';
      const note = said?.[2] ?? '';
      const established = !/not established|path dependency/i.test(note);
      const text = [
        `\`${name}\` is not defined in the reviewed revisions. It is defined in \`${repository}\`, another repository of the workspace read as context at ${commit.slice(0, 7)}: \`${filePath}\` lines ${String(at + 1)}–${String(end + 1)}. That repository is not under review.`,
        established
          ? `That commit is the version the reviewed To commit uses: ${note}`
          : `Which version the reviewed build uses is not established (${note}), so this shows ${repository} at that commit, not necessarily what the reviewed build runs.`,
      ].join('\n\n');
      return { text, reference: { label: `${name}, defined in ${repository} (context)`, repository, path: filePath, start: at + 1, end: end + 1 } };
    }
  }
  return null;
}

/** A question in the review discussion, answered by searching and reading both revisions. */
/**
 * DSP-176, SIMULATED: answers shaped by the prompt's presentation sections, so a window trial
 * can tell the profiles, Explain more simply and follow-ups apart and see what each was given.
 * They show the data flow, never a real model's teaching.
 */
function presentationAnswer(prompt: string, question: string): string | null {
  const answer = presentationAnswerText(prompt, question);
  // DSP-184: a regeneration is told apart from the explanation it replaces, so a trial can see
  // each entry of a profile's history; the walk's outline, when sent, is named.
  if (answer === null || !/^## Regenerating$/m.test(prompt)) {
    return answer;
  }
  regenerations += 1;
  return answer.replace(/^SIMULATED (Essentials|Standard|Teacher)/, `SIMULATED regenerated #${String(regenerations)} $1`);
}

let regenerations = 0;

/**
 * DSP-185, SIMULATED: from the walk's outline in the prompt, a reference to a neighbouring step
 * by its id, and a reference to lines of the step's own file that no step of the walk shows
 * (in the diff, outside the walk). Nothing when the outline carries no ids.
 */
function walkLinks(prompt: string, focus: { readonly path: string; readonly side: 'base' | 'target'; readonly end: number } | null): unknown[] {
  const section = /^## Where this step is in the walk\n([\s\S]*?)(?:\n## |(?![\s\S]))/m.exec(prompt)?.[1] ?? '';
  const steps = [...section.matchAll(/^(\d+)\. \[([^\]]+)\] (.*?)(?: \(code: (.*)\))?(  <- this step)?$/gm)];
  const here = steps.findIndex((match) => match[5] !== undefined);
  if (here < 0) {
    return [];
  }
  const links: unknown[] = [];
  const other = steps[here + 1] ?? steps[here - 1];
  if (other !== undefined) {
    links.push({ label: here + 1 < steps.length ? 'What the next step shows' : 'What the previous step showed', step: other[2] ?? '' });
  }
  // A step of another walk of the review, when the outline names one.
  const elsewhere = /^Other walks of this review:\n- [^\n]*?\[([^\]]+)\]/m.exec(section)?.[1];
  if (elsewhere !== undefined) {
    links.push({ label: 'Where another walk explains a related part', step: elsewhere });
  }
  if (focus !== null) {
    const shown = steps.flatMap((match) =>
      [...(match[4] ?? '').matchAll(/(\S+) (\d+)(?:–(\d+))? \((From|To)\)/g)].map((place) => ({
        path: place[1] ?? '',
        side: place[4] === 'From' ? 'base' : 'target',
        start: Number(place[2] ?? '0'),
        end: Number(place[3] ?? place[2] ?? '0'),
      })),
    );
    for (let line = 1; line <= focus.end; line += 1) {
      if (!shown.some((place) => place.path === focus.path && place.side === focus.side && line >= place.start && line <= place.end)) {
        links.push({ label: 'The surrounding code, outside the walk', path: focus.path, side: focus.side, start: line, end: line });
        break;
      }
    }
  }
  return links;
}

function presentationAnswerText(prompt: string, question: string): string | null {
  const step = /^Step: (.*)$/m.exec(prompt)?.[1]?.trim() ?? 'this step';
  const focus = /^### focus · (.+?) lines (\d+)(?:–(\d+))? · (base|target) @/m.exec(prompt);
  const references: unknown[] =
    focus === null ? [] : [{ label: `The code of ${step}`, path: focus[1] ?? '', side: focus[4] === 'base' ? 'base' : 'target', start: Number(focus[2] ?? '1'), end: Number(focus[3] ?? focus[2] ?? '1') }];
  // DSP-185: one step reference and one reference into the diff outside the walk, so a trial can follow both.
  references.push(...walkLinks(prompt, focus === null ? null : { path: focus[1] ?? '', side: focus[4] === 'base' ? 'base' : 'target', end: Number(focus[3] ?? focus[2] ?? '1') }));
  const refs = `\n\n\`\`\`dspatch-references\n${JSON.stringify({ references, insufficient: false })}\n\`\`\``;
  const where = focus === null ? 'the code of this step' : `\`${focus[1] ?? ''}\` lines ${focus[2] ?? ''}–${focus[3] ?? focus[2] ?? ''}`;
  // DSP-181: the three public profiles, each in its own shape and length, over one neutral
  // example (a greeting function with a default); the deepening after the marker, never before it.
  const present = /^## How to present \((Essentials|Standard|Teacher)\)$/m.exec(prompt)?.[1];
  // A step whose title says it is trivial is explained in one sentence in every profile, with
  // nothing behind Show more: length follows the material, not the profile.
  if (present !== undefined && /\btrivial\b/i.test(step)) {
    return `SIMULATED ${present} for “${step}”: \`greet()\` in ${where} now ends its text with an exclamation mark instead of a full stop; nothing else changes.` + refs;
  }
  if (present === 'Essentials') {
    return (
      [
        `SIMULATED Essentials for “${step}”: \`greet(name)\` in ${where} now returns “Hello, <name>!” instead of the fixed “Hello!”; with no name the default “Hello!” stays.`,
        '- SIMULATED: check the callers that compared the old fixed text.',
        DETAILS_MARKER,
        `SIMULATED deepening (Essentials): the branch in ${where} tests the name for emptiness before it builds the text; an empty string and a missing value both fall back to the default.`,
        '- SIMULATED: the test that covers the fallback.',
      ].join('\n\n') + refs
    );
  }
  if (present === 'Standard') {
    return (
      [
        `SIMULATED Standard for “${step}”: \`greet(name)\` in ${where} builds the greeting from its argument. The caller passes the name it read from the request, and when that is empty the function keeps the default “Hello!”. The change moves the decision from the callers into \`greet\`, so every caller follows the same rule. The default is “Hello!” and is used for an empty or missing name. Nothing else about the request handling changes.`,
        DETAILS_MARKER,
        `SIMULATED deepening (Standard): the mechanism step by step in ${where}, the special case of a name that is only spaces, and the test that covers the default.`,
      ].join('\n\n') + refs
    );
  }
  if (present === 'Teacher') {
    return (
      [
        `SIMULATED Teacher for “${step}”. First the idea: a function can take a value, decide something about it and give back a text; here the value is a name. A default is the answer a function gives when it gets nothing useful. Think of a greeter at a door who says “Hello, Ada!” when they know the name and plain “Hello!” when they do not.`,
        `Now the code: \`greet(name)\` in ${where} tests whether the name is empty. If it is, it returns the default “Hello!”; otherwise it builds “Hello, <name>!”. The change puts that decision inside \`greet\`, so the callers no longer decide it one by one. The consequence is one rule for every caller, and the default stays “Hello!”.`,
        DETAILS_MARKER,
        'SIMULATED deepening (Teacher): in the same plain words, the case of a name that is only spaces, and how the test exercises both branches.',
      ].join('\n\n') + refs
    );
  }
  const more = /^## Going deeper \((\w+)\)$/m.exec(prompt);
  if (more !== null) {
    const follows = /^## Going deeper[\s\S]*?^### (.*)$/m.exec(prompt)?.[1] ?? '';
    return [`SIMULATED deeper (${more[1] ?? ''}), from “${follows}”: how the branch in ${where} is reached from the caller, and the case it does not cover.`, 'SIMULATED: the base explanation is not repeated here.'].join('\n\n') + refs;
  }
  const simpler = /^## Explaining more simply \(attempt (\d+)(?:, (\w+))?\)$/m.exec(prompt);
  if (simpler !== null) {
    const attempt = Number(simpler[1] ?? '1');
    const profile = simpler[2] ?? 'Original';
    const shown = [...prompt.matchAll(/^### Shown \d+: (.*)$/gm)].map((match) => match[1] ?? '');
    const basis = `Built on ${String(shown.length)} explanation(s) already shown: ${shown.map((label) => `“${label}”`).join(', ')}.`;
    const angles = [
      'SIMULATED simpler, attempt 1 (the effect first): this code decides the greeting.',
      'SIMULATED simpler, attempt 2 (a concrete case instead): give it “Ada” and you get “Hello, Ada!”.',
      'SIMULATED simpler, attempt 3: which part is unclear — the greeting itself, when it is chosen, or what the caller does with it?',
    ];
    return [angles[Math.min(attempt, 3) - 1] ?? angles[0], `${basis} Profile: ${profile}.`].join('\n\n') + refs;
  }
  // DSP-184: Explain this on a selection of the step's explanation, in the profile, in Step.
  const selected = /^## Explaining a selection \((\w+)\)$/m.exec(prompt);
  if (selected !== null) {
    const follows = /^## Explaining a selection[\s\S]*?^### (.*)$/m.exec(prompt)?.[1] ?? 'the prepared explanation';
    return [`SIMULATED explain-this (${selected[1] ?? ''}), within “${follows}”: ${question.slice(0, 120)}`, 'SIMULATED: only the selection is explained, not the whole step again.'].join('\n\n') + refs;
  }
  const follow = /^## The explanation this question follows \((\w+)\)$/m.exec(prompt);
  if (follow !== null) {
    const profile = follow[1] ?? 'Original';
    const follows = /^## The explanation this question follows[\s\S]*?^### (.*)$/m.exec(prompt)?.[1] ?? '';
    const simplerLevel = /asked for it more simply (\d+) time/.exec(prompt)?.[1];
    return [
      `SIMULATED follow-up at the ${profile} level, following “${follows}”${simplerLevel === undefined ? '' : ` after ${simplerLevel} simpler explanation(s)`}: ${question.slice(0, 120)}`,
      'SIMULATED: it picks between the two cases by whether a name was given — same plain words, a little more detail.',
    ].join('\n\n') + refs;
  }
  const reader = /^## The reader's profile \((\w+)\)$/m.exec(prompt);
  if (reader !== null) {
    return [`SIMULATED answer at the ${reader[1] ?? ''} level, with nothing of it shown before: ${question.slice(0, 120)}`, 'SIMULATED: the same names and the same facts.'].join('\n\n') + refs;
  }
  return null;
}

/** How slowly a step presented in a profile streams, per 40 characters; 0 when not set (DSP-176). */
export function presentMs(): number {
  return Math.max(0, Number(process.env['DSPATCH_REVIEW_SIM_PRESENT_MS'] ?? '0') || 0);
}

const presentationsFailed = new Set<string>();
const tasksFailed = new Set<string>();

/**
 * DSP-190, SIMULATED: `DSPATCH_PRESENTATION_FAIL_TASK=<task>` makes the first turn of that review
 * task (for instance `write-step`) end as a provider error does, once per process; later turns of
 * the task succeed. For the walk loop that is a turn that does not finish: the run ends without a
 * resend, which is what the window that follows it is to show.
 */
export function failsTask(prompt: string): boolean {
  const marker = process.env['DSPATCH_PRESENTATION_FAIL_TASK'] ?? '';
  if (marker === '' || !prompt.startsWith(`${TASK_HEADER} ${marker}`) || tasksFailed.has(marker)) {
    return false;
  }
  tasksFailed.add(marker);
  return true;
}

/**
 * DSPATCH_REVIEW_SIM_FAIL_PRESENT_STEP=<text>: the first time a step whose title holds that text
 * is presented in a profile, the turn fails as a provider error does; a retry succeeds (DSP-176).
 */
export function failsPresentation(prompt: string): boolean {
  const marker = process.env['DSPATCH_REVIEW_SIM_FAIL_PRESENT_STEP'] ?? '';
  const step = /^Step: (.*)$/m.exec(prompt)?.[1] ?? '';
  if (marker === '' || !prompt.includes('## How to present (') || !step.includes(marker) || presentationsFailed.has(step)) {
    return false;
  }
  presentationsFailed.add(step);
  return true;
}

function reviewQuestion(prompt: string, reader: Reader, asked: string[]): string {
  const question = /## Question\n([\s\S]*?)(?:\n\n## |\n*$)/.exec(prompt)?.[1]?.trim() ?? '';
  const presented = presentationAnswer(prompt, question);
  if (presented !== null) {
    asked.push(question);
    return presented;
  }
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
  const reading = /^## The explanation of this step the person is reading\n[\s\S]*?\n\n([^\n]*)/m.exec(prompt)?.[1];
  const sessionWords =
    (before === 0 ? 'This is the first question in this session.' : `This session has had ${String(before)} question(s) before this one; the last was “${(asked[before - 1] ?? '').slice(0, 60)}”.`) +
    // DSP-184: the step explanation shown in Step came along as hidden context.
    (reading === undefined ? '' : ` SIMULATED: the explanation shown in Step came along as context, beginning “${reading.slice(0, 60)}”.`);
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
    const inContext = contextDefinition(reader, name, prompt);
    if (inContext !== null) {
      return `SIMULATED answer about \`${name}\`.\n\n${session}\n\n${inContext.text}${refs([inContext.reference], false)}`;
    }
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
  } else if (task === 'plan-walks') {
    answer = planWalks(prompt, reader);
  } else if (task === 'write-step') {
    answer = writeStep(prompt);
  } else if (task === 'review-walks') {
    answer = reviewWalks(prompt);
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
  // DSPATCH_REVIEW_SIM_STREAM_MS (DSP-175): an answer to a question long enough to stream
  // for several seconds at that pace, so a trial can scroll away while it still arrives.
  if (answer !== null && streamMs() > 0 && (task === 'review-question' || task === 'explain-selection' || task === 'step-question')) {
    const filler = Array.from(
      { length: 16 },
      (_, index) => `SIMULATED streamed paragraph ${String(index + 1)} of 16: a real agent would go on explaining here, one sentence after another, while the reader decides whether to follow.`,
    ).join('\n\n');
    answer = answer.replace('\n\n', `\n\n${filler}\n\n`);
  }
  return answer === null ? null : { answer, tools: reader.tools };
}

/** How slowly the simulated answers to review questions stream, per 40 characters; 0 when not set. */
export function streamMs(): number {
  return Math.max(0, Number(process.env['DSPATCH_REVIEW_SIM_STREAM_MS'] ?? '0') || 0);
}
