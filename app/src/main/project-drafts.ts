/**
 * DSP-230: the host's one editing draft per project graph, which the graph editor's panel, the
 * customization window and the chat's proposals all work on.
 *
 * The draft is never the file: Save writes it, refused when the file on disk is no longer the
 * version the draft was based on; Discard changes returns to the file as it is now. A draft with
 * no changes follows the file silently when it changes on disk; a draft with changes says so and
 * offers to take the change on disk in level by level, keeping the person's own levels.
 *
 * Kept in DSpatch's own data folder, never in the repository, so closing a window, switching
 * graphs or restarting DSpatch does not lose unsaved work. The chat's proposals are kept with the
 * draft they are for, with their status, until the person applies or rejects them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { LoopGraph } from '../shared/loop-graph';
import {
  applyProposal,
  changedLevels,
  levelKeysOf,
  sameSection,
  sectionAt,
  withSection,
  type DiskState,
  type LevelKey,
  type ProjectDraftView,
  type ProjectInstructionProposal,
} from '../shared/project-draft';
import { emptyProjectInstructions, parseProjectInstructions, type InstructionSection, type ProjectInstructions } from '../shared/project-instructions';
import type { GraphOutline } from '../shared/project-recommendations';
import { saveProjectInstructions } from './project-graph';

/** What the store needs to know of a project graph, read fresh each time. */
export interface DraftSource {
  readonly definitionKey: string;
  readonly graphName: string;
  readonly repository: string;
  readonly instructionsPath: string;
  readonly outline: GraphOutline;
  readonly graph: LoopGraph | null;
}

interface DraftRecord {
  readonly definitionKey: string;
  saved: ProjectInstructions;
  savedSha256: string | null;
  draft: ProjectInstructions;
  revision: number;
  proposals: ProjectInstructionProposal[];
  updatedAtUtc: string;
}

export interface ProjectDraftStoreOptions {
  /** Where drafts are kept; `null` keeps them in memory only (tests). */
  readonly dir: string | null;
  readonly source: (definitionKey: string) => DraftSource | { readonly problem: string };
  readonly onChange?: (view: ProjectDraftView) => void;
  readonly now?: () => Date;
}

export type DraftAnswer = { readonly ok: true; readonly view: ProjectDraftView; readonly note?: string } | { readonly ok: false; readonly problem: string; readonly view?: ProjectDraftView };

const STORE_FORMAT = 'dspatch-project-instruction-draft';
/** Applied and rejected proposals kept per graph, newest last. */
const HISTORY = 40;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readDisk(file: string): { readonly sha256: string | null; readonly value: ProjectInstructions | null } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { sha256: null, value: null };
  }
  const parsed = parseProjectInstructions(text);
  return { sha256: sha256(text), value: parsed.ok ? parsed.value : null };
}

function sameInstructions(left: ProjectInstructions, right: ProjectInstructions): boolean {
  return changedLevels(left, right).length === 0;
}

export class ProjectDraftStore {
  private readonly records = new Map<string, DraftRecord>();
  private loadedAll = false;

  private readonly options: ProjectDraftStoreOptions;

  constructor(options: ProjectDraftStoreOptions) {
    this.options = options;
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private fileFor(definitionKey: string): string | null {
    return this.options.dir === null ? null : path.join(this.options.dir, `${sha256(path.resolve(definitionKey)).slice(0, 24)}.json`);
  }

  private persist(record: DraftRecord): void {
    const file = this.fileFor(record.definitionKey);
    if (file === null) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${String(process.pid)}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ format: STORE_FORMAT, ...record }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, file);
    } catch {
      // The draft stays in memory; a failed write loses nothing until DSpatch quits.
    }
  }

  private restore(file: string): DraftRecord | null {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DraftRecord> & { format?: unknown };
      if (raw.format !== STORE_FORMAT || typeof raw.definitionKey !== 'string') return null;
      const saved = parseProjectInstructions(JSON.stringify(raw.saved));
      const draft = parseProjectInstructions(JSON.stringify(raw.draft));
      if (!saved.ok || !draft.ok) return null;
      return {
        definitionKey: raw.definitionKey,
        saved: saved.value,
        savedSha256: typeof raw.savedSha256 === 'string' ? raw.savedSha256 : null,
        draft: draft.value,
        revision: typeof raw.revision === 'number' ? raw.revision : 0,
        proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
        updatedAtUtc: typeof raw.updatedAtUtc === 'string' ? raw.updatedAtUtc : this.now(),
      };
    } catch {
      return null;
    }
  }

  private loadAll(): void {
    if (this.loadedAll || this.options.dir === null) return;
    this.loadedAll = true;
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.options.dir).filter((name) => name.endsWith('.json'));
    } catch {
      return;
    }
    for (const name of names) {
      const record = this.restore(path.join(this.options.dir, name));
      if (record !== null && !this.records.has(path.resolve(record.definitionKey))) this.records.set(path.resolve(record.definitionKey), record);
    }
  }

  /** The record, made from the file when there is none; synchronised with the disk where that loses nothing. */
  private recordFor(source: DraftSource): { readonly record: DraftRecord; readonly disk: DiskState } {
    this.loadAll();
    const key = path.resolve(source.definitionKey);
    const disk = readDisk(source.instructionsPath);
    let record = this.records.get(key);
    if (record === undefined) {
      const restored = this.fileFor(key) === null ? null : this.restore(this.fileFor(key) as string);
      const value = disk.value ?? emptyProjectInstructions();
      record = restored ?? { definitionKey: key, saved: value, savedSha256: disk.sha256, draft: value, revision: 0, proposals: [], updatedAtUtc: this.now() };
      this.records.set(key, record);
    }
    if (record.savedSha256 === disk.sha256) return { record, disk: 'same' };
    if (sameInstructions(record.draft, record.saved) && disk.value !== null) {
      // Nothing of the person's is at stake: follow the file.
      record.saved = disk.value;
      record.draft = disk.value;
      record.savedSha256 = disk.sha256;
      record.revision += 1;
      record.updatedAtUtc = this.now();
      this.persist(record);
      return { record, disk: 'same' };
    }
    return { record, disk: disk.sha256 === null ? 'missing' : 'changed' };
  }

  private viewOf(source: DraftSource, record: DraftRecord, disk: DiskState, problems: readonly string[] = []): ProjectDraftView {
    return {
      definitionKey: source.definitionKey,
      graphName: source.graphName,
      repository: source.repository,
      instructionsFile: path.relative(source.repository, source.instructionsPath).split(path.sep).join('/'),
      outline: source.outline,
      saved: record.saved,
      savedSha256: record.savedSha256,
      draft: record.draft,
      revision: record.revision,
      unsaved: changedLevels(record.saved, record.draft),
      disk,
      proposals: record.proposals,
      problems,
      updatedAtUtc: record.updatedAtUtc,
    };
  }

  private with(definitionKey: string, act: (record: DraftRecord, source: DraftSource, disk: DiskState) => DraftAnswer | { readonly changed: boolean; readonly note?: string; readonly refused?: string }): DraftAnswer {
    const source = this.options.source(definitionKey);
    if ('problem' in source) return { ok: false, problem: source.problem };
    const { record, disk } = this.recordFor(source);
    const outcome = act(record, source, disk);
    if ('ok' in outcome) return outcome;
    const now = this.recordFor(source);
    const view = this.viewOf(source, now.record, now.disk);
    if (outcome.changed) {
      now.record.updatedAtUtc = this.now();
      this.persist(now.record);
      this.options.onChange?.(view);
    }
    if (outcome.refused !== undefined) return { ok: false, problem: outcome.refused, view };
    return { ok: true, view, ...(outcome.note === undefined ? {} : { note: outcome.note }) };
  }

  view(definitionKey: string): DraftAnswer {
    return this.with(definitionKey, () => ({ changed: false }));
  }

  /** Whether the draft differs from the saved file: what a run start asks. */
  unsaved(definitionKey: string): readonly LevelKey[] {
    const answer = this.view(definitionKey);
    return answer.ok ? answer.view.unsaved : [];
  }

  /** Replace levels of the draft. Each edit is one level, so two places editing different levels never overwrite each other. */
  edit(definitionKey: string, edits: readonly { readonly level: LevelKey; readonly section: InstructionSection }[]): DraftAnswer {
    return this.with(definitionKey, (record) => {
      let draft = record.draft;
      for (const edit of edits) draft = withSection(draft, edit.level, edit.section);
      if (sameInstructions(draft, record.draft)) return { changed: false };
      record.draft = draft;
      record.revision += 1;
      return { changed: true };
    });
  }

  save(definitionKey: string): DraftAnswer {
    return this.with(definitionKey, (record, source, disk) => {
      if (disk !== 'same') {
        return {
          ok: false,
          problem:
            `${path.basename(source.instructionsPath)} was changed on disk since your draft was based on it, so nothing was saved. ` +
            'Take in the change on disk (your own changed levels are kept), look at the result, then save.',
          view: this.viewOf(source, record, disk),
        };
      }
      const saved = saveProjectInstructions({
        reading: { instructionsPath: source.instructionsPath, instructionsSha256: record.savedSha256 },
        instructions: record.draft,
        graph: source.graph,
      });
      if (!saved.ok) return { ok: false, problem: saved.problem, view: this.viewOf(source, record, disk) };
      record.saved = record.draft;
      record.savedSha256 = saved.sha256;
      return { changed: true, note: `Saved to ${path.relative(source.repository, source.instructionsPath).split(path.sep).join('/')}. The next run uses it.` };
    });
  }

  /** Back to the file as it is now. */
  discard(definitionKey: string): DraftAnswer {
    return this.with(definitionKey, (record, source) => {
      const disk = readDisk(source.instructionsPath);
      const value = disk.value ?? (disk.sha256 === null ? emptyProjectInstructions() : record.saved);
      record.saved = value;
      record.savedSha256 = disk.sha256;
      record.draft = value;
      record.revision += 1;
      return { changed: true, note: 'Your unsaved changes were discarded; the draft is the saved version again.' };
    });
  }

  /**
   * Take in a change made on disk: a level the person did not change takes the disk's version; a
   * level the person changed keeps theirs. A level both changed differently keeps the person's
   * and is named, so they can compare before saving.
   */
  takeDisk(definitionKey: string): DraftAnswer {
    return this.with(definitionKey, (record, source) => {
      const disk = readDisk(source.instructionsPath);
      if (disk.sha256 !== null && disk.value === null) {
        return { ok: false, problem: `${path.basename(source.instructionsPath)} on disk does not read as project instructions now; fix the file or save over it after Discard changes.` };
      }
      const theirs = disk.value ?? emptyProjectInstructions();
      let draft = record.draft;
      const both: LevelKey[] = [];
      for (const level of levelKeysOf(record.saved, record.draft, theirs)) {
        const base = sectionAt(record.saved, level);
        const mine = sectionAt(record.draft, level);
        const disks = sectionAt(theirs, level);
        if (sameSection(mine, base)) draft = withSection(draft, level, disks);
        else if (!sameSection(disks, base) && !sameSection(disks, mine)) both.push(level);
      }
      record.saved = theirs;
      record.savedSha256 = disk.sha256;
      record.draft = draft;
      record.revision += 1;
      return {
        changed: true,
        note:
          both.length === 0
            ? 'The change on disk was taken in; your own changes are still in the draft.'
            : `The change on disk was taken in. ${both.join(', ')} changed both on disk and in your draft: your version is kept; compare before saving.`,
      };
    });
  }

  /** Keep a proposal the chat made, against the draft as it is now. */
  record(proposal: ProjectInstructionProposal): DraftAnswer {
    return this.with(proposal.definitionKey, (record) => {
      record.proposals = [...record.proposals, proposal];
      return { changed: true };
    });
  }

  /** Apply a proposal to the draft — never to the file — unless a level it changes was edited since. */
  applyProposal(definitionKey: string, proposalId: string): DraftAnswer {
    return this.with(definitionKey, (record) => {
      const proposal = record.proposals.find((each) => each.id === proposalId);
      if (proposal === undefined) return { ok: false, problem: 'That proposal is not kept here any more.' };
      if (proposal.status !== 'proposed') return { ok: false, problem: `That proposal is ${proposal.status} already.` };
      const applied = applyProposal(record.draft, proposal);
      if (!applied.ok) {
        this.setStatus(record, proposalId, 'stale', `Not applied: ${applied.stale.join(', ')} changed in the draft since it was proposed. Ask the chat to propose again from the current draft.`);
        return { changed: true, refused: `Not applied: ${applied.stale.join(', ')} changed in the draft since the proposal was made, and your newer edit is kept.` };
      }
      record.draft = applied.draft;
      record.revision += 1;
      this.setStatus(record, proposalId, 'applied', 'Applied to the draft. Nothing is saved until you save.');
      return { changed: true, note: 'Applied to the draft. Nothing is saved until you save.' };
    });
  }

  rejectProposal(definitionKey: string, proposalId: string): DraftAnswer {
    return this.with(definitionKey, (record) => {
      const proposal = record.proposals.find((each) => each.id === proposalId);
      if (proposal === undefined || proposal.status !== 'proposed') return { ok: false, problem: 'That proposal is not open.' };
      this.setStatus(record, proposalId, 'rejected', 'Rejected; the draft was not changed.');
      return { changed: true };
    });
  }

  private setStatus(record: DraftRecord, id: string, status: ProjectInstructionProposal['status'], note: string): void {
    record.proposals = record.proposals.map((each) => (each.id === id ? { ...each, status, note } : each));
    const closed = record.proposals.filter((each) => each.status !== 'proposed');
    if (closed.length > HISTORY) {
      const drop = new Set(closed.slice(0, closed.length - HISTORY).map((each) => each.id));
      record.proposals = record.proposals.filter((each) => !drop.has(each.id));
    }
  }

  /** Every proposal a conversation made, oldest first, whatever graph it is for. */
  proposalsFor(conversationId: string): readonly ProjectInstructionProposal[] {
    this.loadAll();
    return [...this.records.values()]
      .flatMap((record) => record.proposals.filter((proposal) => proposal.conversationId === conversationId))
      .sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
  }
}
