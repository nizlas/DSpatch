/**
 * DSP-230: a project graph's instructions where the graph is edited — the editor's right panel —
 * and the chat's proposals for them, all on the one draft the host keeps.
 *
 * The panel, the customization window and the chat's proposal cards read and change the same
 * draft through {@link useProjectDraft}; every change is sent as the levels it touches, and every
 * window is told the result, so none of them holds a copy another can overwrite. The status line
 * says what is saved, what is only in the draft, and what the chat has proposed and nobody has
 * applied. Applying a proposal changes the draft; only Save writes the file, and the next run
 * reads the file.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  changedLevels,
  draftStatusLine,
  levelName,
  previewForStep,
  scopeLine,
  sectionAt,
  staleChanges,
  stepsAt,
  withSection,
  type LevelKey,
  type ProjectDraftView,
  type ProjectInstructionProposal,
} from '../shared/project-draft';
import type { ProjectGraphAnswer } from '../shared/project-graph-bridge';
import type { DocumentReference, InstructionSection, ProjectInstructions, ReferenceProblem } from '../shared/project-instructions';

export interface ProjectDraftHandle {
  readonly view: ProjectDraftView | null;
  /** The draft as this window shows it, its own edits included before the host has answered. */
  readonly draft: ProjectInstructions | null;
  readonly references: readonly ReferenceProblem[];
  readonly problems: readonly string[];
  readonly note: string | null;
  readonly edit: (change: (value: ProjectInstructions) => ProjectInstructions) => void;
  readonly act: (kind: 'draftSave' | 'draftDiscard' | 'draftTakeDisk') => Promise<boolean>;
  readonly onProposal: (kind: 'proposalApply' | 'proposalReject', proposalId: string) => Promise<void>;
}

/** The shared draft of one project graph, kept current from the host. */
export function useProjectDraft(definitionKey: string | null): ProjectDraftHandle {
  const [view, setView] = useState<ProjectDraftView | null>(null);
  const [draft, setDraft] = useState<ProjectInstructions | null>(null);
  const [references, setReferences] = useState<readonly ReferenceProblem[]>([]);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const pending = useRef(0);
  const latest = useRef<ProjectInstructions | null>(null);
  const keyRef = useRef(definitionKey);
  keyRef.current = definitionKey;

  const take = useCallback((answer: ProjectGraphAnswer): boolean => {
    if (answer.kind === 'draft') {
      setView(answer.view);
      setReferences(answer.references);
      setProblems(answer.view.problems);
      if (pending.current === 0) {
        latest.current = answer.view.draft;
        setDraft(answer.view.draft);
      }
      if (answer.note !== null) setNote(answer.note);
      return true;
    }
    if (answer.kind === 'refused') {
      if (answer.view !== undefined) {
        setView(answer.view);
        if (pending.current === 0) {
          latest.current = answer.view.draft;
          setDraft(answer.view.draft);
        }
      }
      setProblems(answer.problems);
    }
    return false;
  }, []);

  useEffect(() => {
    setView(null);
    setDraft(null);
    latest.current = null;
    setProblems([]);
    setNote(null);
    if (definitionKey === null) return undefined;
    const read = (): void => {
      if (pending.current === 0) void window.dspatch.projectGraph({ kind: 'draft', definitionKey }).then(take, () => undefined);
    };
    read();
    // A change on disk made outside DSpatch is noticed when the person comes back to the window.
    window.addEventListener('focus', read);
    const stop = window.dspatch.onProjectDraft((next) => {
      if (next.definitionKey !== keyRef.current) return;
      setView(next);
      if (pending.current === 0) {
        latest.current = next.draft;
        setDraft(next.draft);
      }
    });
    return () => {
      window.removeEventListener('focus', read);
      stop();
    };
  }, [definitionKey, take]);

  const edit = useCallback(
    (change: (value: ProjectInstructions) => ProjectInstructions): void => {
      const key = keyRef.current;
      const current = latest.current;
      if (key === null || current === null) return;
      const next = change(current);
      const levels = changedLevels(current, next);
      if (levels.length === 0) return;
      latest.current = next;
      setDraft(next);
      pending.current += 1;
      void window.dspatch
        .projectGraph({ kind: 'draftEdit', definitionKey: key, edits: levels.map((level) => ({ level, section: sectionAt(next, level) })) })
        .then(
          (answer) => {
            pending.current -= 1;
            take(answer);
          },
          () => {
            pending.current -= 1;
          },
        );
    },
    [take],
  );

  const act = useCallback(
    async (kind: 'draftSave' | 'draftDiscard' | 'draftTakeDisk'): Promise<boolean> => {
      const key = keyRef.current;
      if (key === null) return false;
      setProblems([]);
      return take(await window.dspatch.projectGraph({ kind, definitionKey: key }));
    },
    [take],
  );

  const onProposal = useCallback(
    async (kind: 'proposalApply' | 'proposalReject', proposalId: string): Promise<void> => {
      const key = keyRef.current;
      if (key === null) return;
      take(await window.dspatch.projectGraph({ kind, definitionKey: key, proposalId }));
    },
    [take],
  );

  return { view, draft, references, problems, note, edit, act, onProposal };
}

/** The status of a draft, and Save and Discard changes, as every place that edits it shows them. */
export function DraftStatus({ handle, compact = false }: { readonly handle: ProjectDraftHandle; readonly compact?: boolean }): React.JSX.Element | null {
  const { view } = handle;
  if (view === null) return null;
  const unsaved = view.unsaved.length > 0;
  return (
    <div className={`project-draft-status${unsaved ? ' project-draft-status--unsaved' : ''}`} data-ev="project-draft-status" data-unsaved={unsaved ? 'yes' : 'no'}>
      <p data-ev="project-draft-status-line">{draftStatusLine(view)}</p>
      {unsaved && !compact ? (
        <p className="muted" data-ev="project-draft-unsaved-levels">
          Unsaved: {view.unsaved.map((level) => levelName(view.outline, level)).join(', ')}
        </p>
      ) : null}
      {view.disk === 'changed' || view.disk === 'missing' ? (
        <p className="finding finding-warning" data-ev="project-draft-disk-changed">
          {view.disk === 'missing'
            ? `${view.instructionsFile} is gone from disk since your draft was based on it. Saving writes it again.`
            : `${view.instructionsFile} was changed on disk since your draft was based on it. Save is refused until you take the change in: levels you did not change take the disk's version, and yours are kept.`}
          {view.disk === 'changed' ? (
            <button type="button" className="link-button" data-ev="project-draft-take-disk" onClick={() => void handle.act('draftTakeDisk')}>
              Take in the change on disk
            </button>
          ) : null}
        </p>
      ) : null}
      <span className="section-buttons">
        <button type="button" data-ev="project-draft-save" disabled={!unsaved || view.disk === 'changed'} onClick={() => void handle.act('draftSave')}>
          Save
        </button>
        <button
          type="button"
          data-ev="project-draft-discard"
          disabled={!unsaved && view.disk === 'same'}
          onClick={() => {
            if (window.confirm(`Discard the unsaved changes to the project instructions of "${view.graphName}"? The draft returns to the file on disk.`)) void handle.act('draftDiscard');
          }}
        >
          Discard changes
        </button>
      </span>
      {handle.note !== null ? (
        <p className="muted" data-ev="project-draft-note">
          {handle.note}
        </p>
      ) : null}
      {handle.problems.length > 0 ? (
        <ul className="findings" data-ev="project-draft-problems">
          {handle.problems.map((problem) => (
            <li key={problem} className="finding finding-error">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One level's text and documents, edited in place, with who it reaches. */
export function LevelEditor({
  handle,
  level,
  inherited,
  open,
}: {
  readonly handle: ProjectDraftHandle;
  readonly level: LevelKey;
  /** What this level is for the step on screen: its own, or inherited from the project or a role. */
  readonly inherited: string | null;
  readonly open: boolean;
}): React.JSX.Element | null {
  const { view, draft } = handle;
  if (view === null || draft === null) return null;
  const section = sectionAt(draft, level);
  const put = (next: InstructionSection): void => handle.edit((value) => withSection(value, level, next));
  const putDocument = (index: number, next: DocumentReference | null): void =>
    put({ ...section, documents: section.documents.flatMap((doc, at) => (at !== index ? [doc] : next === null ? [] : [next])) });
  const unsaved = view.unsaved.includes(level);
  const empty = section.text.trim() === '' && section.documents.length === 0;
  const problems = handle.references.filter((problem) => section.documents.some((doc) => doc.path === problem.path));
  return (
    <details className={`project-level${unsaved ? ' project-level--unsaved' : ''}`} data-ev={`project-level-${level.replace(':', '-')}`} data-level={level} open={open}>
      <summary>
        <strong>{levelName(view.outline, level)}</strong>
        {inherited === null ? <span className="tag">this step</span> : <span className="tag tag--inherited">{inherited}</span>}
        {unsaved ? <span className="tag tag--unsaved">unsaved</span> : null}
        <span className="muted"> {empty ? '— nothing yet' : `— ${section.text.trim() === '' ? 'no text' : `${String(section.text.trim().split('\n').length)} line(s)`}, ${String(section.documents.length)} document(s)`}</span>
      </summary>
      <p className="muted project-level__scope" data-ev="project-level-scope">
        {scopeLine(view.outline, level)}
        {level.startsWith('role:') || level === 'common' ? `: ${stepsAt(view.outline, level).map((node) => node.label).join(', ') || 'none'}` : ''}. Editing here changes it for all of them.
      </p>
      <textarea
        className="project-level__text"
        data-ev="project-level-text"
        rows={4}
        placeholder="Instructions in your own words; no file is needed."
        value={section.text}
        onChange={(event) => put({ ...section, text: event.target.value })}
      />
      <div className="project-level__documents" data-ev="project-level-documents">
        <div className="setting-name">Documents at this level — named to the step, not attached</div>
        {section.documents.map((doc, index) => (
          <div key={index} className="project-document" data-ev="project-level-document">
            <input aria-label="Path" value={doc.path} onChange={(event) => putDocument(index, { ...doc, path: event.target.value })} />
            {doc.external === true ? <span className="tag">outside the repository</span> : null}
            <input aria-label="Why it matters" placeholder="Why it matters" value={doc.purpose} onChange={(event) => putDocument(index, { ...doc, purpose: event.target.value })} />
            <input aria-label="When to read it" placeholder="When to read it" value={doc.when} onChange={(event) => putDocument(index, { ...doc, when: event.target.value })} />
            <button type="button" data-ev="project-level-document-remove" onClick={() => putDocument(index, null)}>
              Remove
            </button>
          </div>
        ))}
        <span className="section-buttons">
          <button
            type="button"
            data-ev="project-level-document-pick"
            onClick={() =>
              void window.dspatch.pickProjectDocument(view.repository).then((picked) => {
                if (picked !== null) put({ ...section, documents: [...section.documents, { path: picked.path, purpose: '', when: '', ...(picked.external ? { external: true as const } : {}) }] });
              })
            }
          >
            Choose a document…
          </button>
          <button type="button" data-ev="project-level-document-add" onClick={() => put({ ...section, documents: [...section.documents, { path: '', purpose: '', when: '' }] })}>
            Add by path
          </button>
        </span>
        {problems.length > 0 ? (
          <ul className="findings">
            {problems.map((problem) => (
              <li key={problem.path} className="finding finding-warning">
                {problem.path} {problem.problem}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

const PROPOSAL_STATUS: Readonly<Record<ProjectInstructionProposal['status'], string>> = {
  proposed: 'Proposal — not applied to the draft',
  applied: 'Applied to the draft — not saved by that',
  rejected: 'Rejected — the draft was not changed',
  stale: 'Not applied — the draft changed since',
};

function SectionText({ section }: { readonly section: InstructionSection }): React.JSX.Element {
  return (
    <>
      <pre className="brief-text">{section.text.trim() === '' ? '(no text)' : section.text}</pre>
      {section.documents.length > 0 ? (
        <ul className="project-proposal__documents">
          {section.documents.map((doc) => (
            <li key={doc.path}>
              <code>{doc.path}</code> — {doc.purpose || 'no purpose given'}
              {doc.when === '' ? '' : `; read ${doc.when}`}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * A change the chat proposed, as the person decides on it: what is added, changed or removed, at
 * which level, which steps it reaches, why, and where it comes from. Apply changes the draft, never
 * the file; a level edited since the proposal was made is named, and Apply is refused there.
 */
export function ProjectProposalCard({ proposal, handle }: { readonly proposal: ProjectInstructionProposal; readonly handle: ProjectDraftHandle }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const view = handle.view;
  const open = proposal.status === 'proposed';
  const stale = open && handle.draft !== null ? staleChanges(handle.draft, proposal).map((change) => change.level) : [];
  const labelOf = (id: string): string => view?.outline.nodes.find((node) => node.id === id)?.label ?? id;
  const nameOf = (level: LevelKey): string => (view === null ? level : levelName(view.outline, level));
  return (
    <section className={`graph-proposal project-proposal-card graph-proposal--${proposal.status}`} data-ev="project-proposal-card" data-status={proposal.status} data-proposal={proposal.id}>
      <p className="graph-proposal__status" data-ev="project-proposal-status">
        {PROPOSAL_STATUS[proposal.status]}
      </p>
      <p className="graph-proposal__name">
        Project instructions of <strong>{proposal.graphName}</strong>
      </p>
      <p className="graph-proposal__label">The agent's words:</p>
      <blockquote className="graph-proposal__explanation">{proposal.explanation}</blockquote>
      {proposal.changes.map((change) => (
        <div key={change.level} className="project-proposal-change" data-ev="project-proposal-change" data-level={change.level}>
          <p>
            <strong>
              {change.action === 'add' ? 'Adds to' : change.action === 'remove' ? 'Removes' : 'Changes'} {nameOf(change.level)}
            </strong>{' '}
            <span className="muted" data-ev="project-proposal-steps">
              — reaches {change.steps.length === 1 ? '1 step' : `${String(change.steps.length)} steps`}: {change.steps.map(labelOf).join(', ')}
            </span>
          </p>
          <p data-ev="project-proposal-reason">Why: {change.reason}</p>
          {change.sources.length > 0 ? (
            <ul className="project-proposal__sources" data-ev="project-proposal-sources">
              {change.sources.map((source) => (
                <li key={source.path}>
                  From <code>{source.path}</code>
                  {source.note === '' ? '' : ` — ${source.note}`}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="project-diff">
            <div>
              <span className="muted">When proposed</span>
              <SectionText section={change.before} />
            </div>
            <div>
              <span className="muted">Proposed</span>
              <SectionText section={change.after} />
            </div>
          </div>
          {stale.includes(change.level) ? (
            <p className="finding finding-warning" data-ev="project-proposal-stale">
              {nameOf(change.level)} was edited in the draft after this was proposed; applying would overwrite that edit, so it is refused. Ask the chat to propose again from the current draft.
            </p>
          ) : null}
        </div>
      ))}
      {proposal.note !== undefined ? (
        <p className="graph-proposal__note" data-ev="project-proposal-note">
          {proposal.note}
        </p>
      ) : null}
      {open ? (
        <p className="graph-proposal__actions">
          <button
            type="button"
            className="button"
            data-ev="project-proposal-apply"
            disabled={busy || stale.length > 0 || handle.view === null}
            title="Change the draft; nothing is saved"
            onClick={() => {
              setBusy(true);
              void handle.onProposal('proposalApply', proposal.id).finally(() => setBusy(false));
            }}
          >
            Apply to draft
          </button>
          <button
            type="button"
            className="button"
            data-ev="project-proposal-reject"
            disabled={busy || handle.view === null}
            onClick={() => {
              setBusy(true);
              void handle.onProposal('proposalReject', proposal.id).finally(() => setBusy(false));
            }}
          >
            Reject
          </button>
        </p>
      ) : null}
      <p className="graph-proposal__hint">Applying changes the draft only. Save the draft in the graph editor when you want the next run to use it.</p>
    </section>
  );
}

/** A proposal in the chat, with its own view of the draft it is for. */
export function ChatProjectProposal({ proposal }: { readonly proposal: ProjectInstructionProposal }): React.JSX.Element {
  const handle = useProjectDraft(proposal.definitionKey);
  return (
    <>
      <ProjectProposalCard proposal={proposal} handle={handle} />
      {handle.view !== null && proposal.status !== 'proposed' && handle.view.unsaved.length > 0 ? <DraftStatus handle={handle} compact /> : null}
    </>
  );
}

/** A conversation's project instruction proposals, kept current. */
export function useProjectProposals(conversationId: string | null): readonly ProjectInstructionProposal[] {
  const [proposals, setProposals] = useState<readonly ProjectInstructionProposal[]>([]);
  useEffect(() => {
    if (conversationId === null) {
      setProposals([]);
      return undefined;
    }
    const read = (): void => {
      void window.dspatch.projectGraph({ kind: 'proposals', conversationId }).then(
        (answer) => {
          if (answer.kind === 'proposals') setProposals(answer.proposals);
        },
        () => undefined,
      );
    };
    read();
    return window.dspatch.onProjectDraft(read);
  }, [conversationId]);
  return proposals;
}

/**
 * The editor's right panel section. With a step selected: what the step inherits from the project
 * and its role, and its own additions, each editable, then a preview of what the step receives.
 * With no step: the common instructions and where each level has additions. For a built-in
 * workflow with no project instructions: the way to make it the project's own.
 */
export function ProjectInstructionsSection({
  handle,
  nodeId,
  onApplyToRepository,
  onOpenWindow,
}: {
  /** The project graph's shared draft, or `null` for a built-in workflow without project instructions. */
  readonly handle: ProjectDraftHandle | null;
  readonly nodeId: string | null;
  readonly onApplyToRepository: () => void;
  readonly onOpenWindow: () => void;
}): React.JSX.Element {
  const [sent, setSent] = useState<string | null>(null);
  if (handle === null) {
    return (
      <section className="node-panel-section project-panel" data-ev="project-panel-template">
        <h3>Project instructions</h3>
        <p className="muted">
          This workflow has no project instructions: it is used as DSpatch ships it, and is not changed from here. To add your project's own rules
          and documents, make a copy in your repository.
        </p>
        <button type="button" data-ev="project-panel-apply" onClick={onApplyToRepository}>
          Apply to repository…
        </button>
      </section>
    );
  }
  const { view, draft } = handle;
  const node = nodeId === null || view === null ? null : (view.outline.nodes.find((candidate) => candidate.id === nodeId) ?? null);
  const discuss = (): void => {
    if (view === null) return;
    const label = `Project instructions of ${view.graphName}${node === null ? '' : ` · step ${node.label}`}`;
    const request = { definitionKey: view.definitionKey, nodeId: node?.id ?? null, label };
    void window.dspatch.discussProjectInstructions(request).then(() => setSent('The main chat has this as context for your next message.'));
    if (!isDedicatedEditor()) {
      try {
        window.sessionStorage.setItem('dspatch.projectDiscussion', JSON.stringify(request));
      } catch {
        // The event reaches a chat that is mounted; this only helps one that is not yet.
      }
      window.location.hash = '';
    }
  };
  const open = view?.proposals.filter((proposal) => proposal.status === 'proposed') ?? [];
  const relevant = node === null ? open : open.filter((proposal) => proposal.changes.some((change) => change.steps.includes(node.id)));
  const preview =
    node === null || view === null || draft === null
      ? null
      : previewForStep(draft, view.outline, node.id, { file: view.instructionsFile, repositoryRoot: view.repository });
  return (
    <section className="node-panel-section project-panel" data-ev="project-panel" data-node={nodeId ?? ''}>
      <h3>Project instructions</h3>
      <p className="muted">
        This project's own additions to the generic role, from <code>{view?.instructionsFile ?? '…'}</code>. They are kept apart from the role text above.
      </p>
      <DraftStatus handle={handle} />
      {view === null ? null : node !== null ? (
        <>
          <LevelEditor handle={handle} level="common" inherited="inherited from the project" open={false} />
          {node.roleId === null ? null : <LevelEditor handle={handle} level={`role:${node.roleId}`} inherited={`inherited from the role ${node.roleId}`} open={false} />}
          <LevelEditor handle={handle} level={`node:${node.id}`} inherited={null} open />
        </>
      ) : (
        <>
          <LevelEditor handle={handle} level="common" inherited="every step" open />
          <ul className="project-panel__levels" data-ev="project-panel-levels">
            {view.outline.roles.map((role) => (
              <li key={role.id}>
                {levelName(view.outline, `role:${role.id}`)}: {sectionSummary(sectionAt(draft ?? view.draft, `role:${role.id}`))} · {scopeLine(view.outline, `role:${role.id}`)}
              </li>
            ))}
            {view.outline.nodes
              .filter((each) => (draft ?? view.draft).nodes[each.id] !== undefined)
              .map((each) => (
                <li key={each.id}>
                  {levelName(view.outline, `node:${each.id}`)}: {sectionSummary(sectionAt(draft ?? view.draft, `node:${each.id}`))}
                </li>
              ))}
          </ul>
          <p className="muted">Select a step on the canvas to edit its role's and its own additions.</p>
        </>
      )}
      <span className="section-buttons">
        <button type="button" data-ev="project-panel-discuss" disabled={view === null} onClick={discuss}>
          Discuss project instructions
        </button>
        <button type="button" data-ev="project-panel-window" onClick={onOpenWindow}>
          Project instructions…
        </button>
      </span>
      {sent !== null ? (
        <p className="muted" data-ev="project-panel-discuss-note">
          {sent}
        </p>
      ) : null}
      {relevant.length > 0 ? (
        <div className="project-panel__proposals" data-ev="project-panel-proposals">
          <div className="setting-name">
            {relevant.length === 1 ? 'A proposal from the chat' : `${String(relevant.length)} proposals from the chat`}, not applied
          </div>
          {relevant.map((proposal) => (
            <ProjectProposalCard key={proposal.id} proposal={proposal} handle={handle} />
          ))}
        </div>
      ) : null}
      {preview !== null && view !== null ? (
        <details className="project-preview" data-ev="project-panel-preview">
          <summary data-ev="project-panel-preview-label">
            {view.unsaved.length > 0
              ? 'Preview of unsaved changes: what this step would receive once saved'
              : 'Preview: what this step receives from the saved project instructions'}
          </summary>
          <p className="muted">The run's own assembly. A run in progress keeps the instructions it started with.</p>
          <pre className="brief-text" data-ev="project-panel-preview-text">
            {preview === '' ? '(No project instructions reach this step.)' : preview}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

function sectionSummary(section: InstructionSection): string {
  if (section.text.trim() === '' && section.documents.length === 0) return 'nothing yet';
  return `${section.text.trim() === '' ? 'no text' : 'text'}, ${String(section.documents.length)} document(s)`;
}

function isDedicatedEditor(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'editor';
}
