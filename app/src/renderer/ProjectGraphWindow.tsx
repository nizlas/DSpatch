/**
 * DSP-229: "Apply to repository…" and "Project instructions…" — one window.
 *
 * Applying: choose a built-in workflow, a repository of the workspace and a name; fit the
 * instructions to the project; review the files; save. Maintaining a project workflow opens the
 * same window on its saved instructions. Three layers are edited: common to every step, per role
 * (shared by every step that has the role, so nothing is repeated), and per step. Each layer has
 * free text, which steps are sent, and document references, which steps are pointed at and read
 * themselves. The preview of a step is the run's own assembly. The agent's recommendations are
 * proposals beside the person's text: they change nothing until a person takes one, and a stop or
 * a failure leaves every edit as it was.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ProjectGraphAnswer, ProjectGraphDescription, ProjectGraphSource, PlannedFileView } from '../shared/project-graph-bridge';
import {
  EMPTY_SECTION,
  emptyProjectInstructions,
  projectInstructionsText,
  type DocumentReference,
  type InstructionSection,
  type ProjectInstructions,
  type ReferenceProblem,
} from '../shared/project-instructions';
import type { RecommendationAnswer, RecommendationTarget } from '../shared/project-recommendations';

export type ProjectWindowMode = { readonly mode: 'apply' } | { readonly mode: 'edit'; readonly definitionKey: string };

type Options = Extract<ProjectGraphAnswer, { kind: 'options' }>;
type SectionKey = string; // 'common' | `role:${id}` | `node:${id}`

function sectionOf(value: ProjectInstructions, key: SectionKey): InstructionSection {
  if (key === 'common') return value.common;
  if (key.startsWith('role:')) return value.roles[key.slice(5)] ?? EMPTY_SECTION;
  return value.nodes[key.slice(5)] ?? EMPTY_SECTION;
}

function withSection(value: ProjectInstructions, key: SectionKey, section: InstructionSection): ProjectInstructions {
  if (key === 'common') return { ...value, common: section };
  if (key.startsWith('role:')) return { ...value, roles: { ...value.roles, [key.slice(5)]: section } };
  return { ...value, nodes: { ...value.nodes, [key.slice(5)]: section } };
}

let requestCounter = 0;

export function ProjectGraphWindow({
  mode,
  onClose,
  onApplied,
}: {
  readonly mode: ProjectWindowMode;
  readonly onClose: () => void;
  /** The new project graph's key, chosen for this workspace by the host. */
  readonly onApplied: (definitionKey: string) => void;
}): React.JSX.Element {
  const bridge = window.dspatch;
  const [options, setOptions] = useState<Options | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const [repository, setRepository] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'setup' | 'customize' | 'review'>(mode.mode === 'apply' ? 'setup' : 'customize');
  const [description, setDescription] = useState<ProjectGraphDescription | null>(null);
  const [instructions, setInstructions] = useState<ProjectInstructions>(emptyProjectInstructions());
  const [saved, setSaved] = useState<string>(JSON.stringify(emptyProjectInstructions()));
  const [sha, setSha] = useState<string | null>(null);
  const [selected, setSelected] = useState<SectionKey>('common');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [references, setReferences] = useState<readonly ReferenceProblem[]>([]);
  const [files, setFiles] = useState<readonly PlannedFileView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [inventory, setInventory] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ readonly answer: RecommendationAnswer; readonly agent: string; readonly dropped: readonly string[] } | null>(null);
  const [recommending, setRecommending] = useState<string | null>(null);
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const source: ProjectGraphSource | null = mode.mode === 'edit' ? { definitionKey: mode.definitionKey } : templateKey === '' ? null : { templateKey };
  const repositoryNow = mode.mode === 'edit' ? (description?.repository ?? '') : repository;
  const dirty = JSON.stringify(instructions) !== saved;

  useEffect(() => {
    void bridge.projectGraph({ kind: 'options' }).then((answer) => {
      if (answer.kind !== 'options') return;
      setOptions(answer);
      setTemplateKey((key) => key || (answer.templates.find((t) => /generic/i.test(t.key))?.key ?? answer.templates[0]?.key ?? ''));
      setRepository((current) => current || (answer.repositories[0]?.path ?? ''));
    });
  }, [bridge]);

  const describe = useCallback(
    async (from: ProjectGraphSource): Promise<boolean> => {
      setBusy('Reading the workflow…');
      const answer = await bridge.projectGraph({ kind: 'describe', source: from });
      setBusy(null);
      if (answer.kind !== 'described') {
        setProblems(answer.kind === 'refused' ? answer.problems : ['The workflow could not be read.']);
        return false;
      }
      setDescription(answer.description);
      setProblems(answer.description.problems);
      if (mode.mode === 'edit') {
        setInstructions(answer.description.instructions);
        setSaved(JSON.stringify(answer.description.instructions));
        setSha(answer.description.instructionsSha256);
      }
      return true;
    },
    [bridge, mode.mode],
  );
  useEffect(() => {
    if (mode.mode === 'edit') void describe({ definitionKey: mode.definitionKey });
  }, [mode, describe]);

  // The references, checked as they change, against the repository.
  useEffect(() => {
    if (source === null || repositoryNow === '' || step === 'setup') return;
    const timer = setTimeout(() => {
      void bridge.projectGraph({ kind: 'check', repository: repositoryNow, source, instructions }).then((answer) => {
        if (answer.kind === 'checked') setReferences(answer.references);
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instructions, repositoryNow, step, templateKey]);

  const outline = description?.outline ?? null;
  const nodeOf = (id: string) => outline?.nodes.find((node) => node.id === id) ?? null;
  const selectedNode = selected.startsWith('node:') ? nodeOf(selected.slice(5)) : null;
  const selectedRole = selected.startsWith('role:') ? selected.slice(5) : (selectedNode?.roleId ?? null);
  const section = sectionOf(instructions, selected);
  const putSection = (next: InstructionSection): void => setInstructions((value) => withSection(value, selected, next));
  const putDocument = (index: number, next: DocumentReference | null): void =>
    putSection({ ...section, documents: section.documents.flatMap((doc, at) => (at !== index ? [doc] : next === null ? [] : [next])) });
  const moveDocument = (index: number, by: -1 | 1): void => {
    const documents = [...section.documents];
    const [doc] = documents.splice(index, 1);
    if (doc === undefined) return;
    documents.splice(Math.max(0, Math.min(documents.length, index + by)), 0, doc);
    putSection({ ...section, documents });
  };
  const roleUsers = useMemo(() => (selectedRole === null || outline === null ? [] : outline.nodes.filter((node) => node.roleId === selectedRole)), [outline, selectedRole]);

  const recommend = async (target: RecommendationTarget, label: string): Promise<void> => {
    if (source === null || repositoryNow === '') return;
    requestCounter += 1;
    const requestId = `${String(Date.now())}-${String(requestCounter)}`;
    setRecommending(requestId);
    setNote(`Asking ${options?.agent.provider ?? 'the agent'} ${label}… It reads the repository and changes nothing.`);
    const result = await bridge.projectGraph({ kind: 'recommend', requestId, repository: repositoryNow, source, target, instructions, inventory });
    setRecommending((current) => (current === requestId ? null : current));
    if (result.kind === 'recommended') {
      setInventory(result.inventory);
      setAnswer({ answer: result.answer, agent: result.agent, dropped: result.dropped });
      setTaken(new Set());
      setNote(`${String(result.answer.recommendations.length)} proposal(s) from ${result.agent}. Nothing is applied until you take it.`);
    } else {
      setNote(result.kind === 'cancelled' ? 'Stopped. Your text is as it was.' : `No recommendations: ${result.kind === 'refused' ? result.problems.join(' ') : 'unexpected answer'}. Your text is as it was.`);
    }
  };

  const take = (key: string, change: (value: ProjectInstructions) => ProjectInstructions): void => {
    setInstructions(change);
    setTaken((before) => new Set([...before, key]));
  };

  const plan = async (): Promise<void> => {
    if (mode.mode === 'edit') {
      setFiles([{ relative: description?.instructionsFile ?? 'the project instructions file', action: 'change', what: 'the project\'s instructions' }]);
      setStep('review');
      return;
    }
    setBusy('Checking what would be written…');
    const answer = await bridge.projectGraph({ kind: 'plan', templateKey, repository, name, instructions });
    setBusy(null);
    if (answer.kind === 'planned') {
      setFiles(answer.files);
      setReferences(answer.references);
      setProblems([]);
      setStep('review');
    } else {
      setProblems(answer.kind === 'refused' ? answer.problems : ['Nothing could be planned.']);
    }
  };

  const save = async (): Promise<void> => {
    setBusy('Saving…');
    const answer =
      mode.mode === 'edit'
        ? await bridge.projectGraph({ kind: 'save', definitionKey: mode.definitionKey, instructions, expectedSha256: sha })
        : await bridge.projectGraph({ kind: 'apply', templateKey, repository, name, instructions });
    setBusy(null);
    if (answer.kind === 'saved') {
      setSha(answer.sha256);
      setSaved(JSON.stringify(instructions));
      setReferences(answer.references);
      setNote('Saved. The next run reads these; a run in progress keeps the instructions it started with. Nothing was committed.');
      setStep('customize');
    } else if (answer.kind === 'applied') {
      onApplied(answer.definitionKey);
    } else {
      setProblems(answer.kind === 'refused' ? answer.problems : ['Nothing was saved.']);
      setStep('customize');
    }
  };

  const preview =
    selectedNode === null || outline === null
      ? null
      : projectInstructionsText(
          instructions,
          { nodeId: selectedNode.id, nodeLabel: selectedNode.label, roleId: selectedNode.roleId },
          { file: description?.instructionsFile ?? `.dspatch/loops/${name === '' ? '<name>' : name}.project.json`, repositoryRoot: repositoryNow || '(the repository)' },
        );
  const sectionLabel = (key: SectionKey): string =>
    key === 'common' ? 'Common to this project' : key.startsWith('role:') ? `Role ${key.slice(5)}` : `Step ${nodeOf(key.slice(5))?.label ?? key.slice(5)}`;

  return (
    <div className="dialog-backdrop">
      <div className="dialog project-window" role="dialog" aria-label={mode.mode === 'apply' ? 'Apply to repository' : 'Project instructions'} data-ev="project-window">
        <h2>{mode.mode === 'apply' ? 'Apply a workflow to a repository' : 'Project instructions'}</h2>
        {step === 'setup' ? (
          <div className="project-setup" data-ev="project-setup">
            <p className="muted">
              The workflow is copied into the repository's <code>.dspatch/loops/</code> as an ordinary graph of this project: its graph, its
              generic roles as they are in this version of DSpatch, and the project's own instructions beside them. It goes into Git like
              any file; nothing is committed. Updating DSpatch later does not change the copy.
            </p>
            <label>
              Workflow to start from
              <select data-ev="project-template" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                {(options?.templates ?? []).map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repository
              <select data-ev="project-repository" value={repository} onChange={(event) => setRepository(event.target.value)}>
                {(options?.repositories ?? []).map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.name} — {folder.path}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name of the project's workflow
              <input data-ev="project-name" value={name} placeholder="For example: Our development workflow" onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
        ) : null}

        {step !== 'setup' && outline !== null ? (
          <div className="project-body">
            <nav className="project-sections" aria-label="Sections" data-ev="project-sections">
              <button type="button" className={selected === 'common' ? 'on' : ''} data-ev="project-section-common" onClick={() => setSelected('common')}>
                Common to this project
              </button>
              <div className="project-sections__head">Roles, shared by their steps</div>
              {outline.roles.map((role) => (
                <button key={role.id} type="button" className={selected === `role:${role.id}` ? 'on' : ''} data-ev={`project-section-role-${role.id}`} onClick={() => setSelected(`role:${role.id}`)}>
                  {role.id}
                  {(instructions.roles[role.id]?.text ?? '') !== '' || (instructions.roles[role.id]?.documents.length ?? 0) > 0 ? ' •' : ''}
                </button>
              ))}
              <div className="project-sections__head">Steps</div>
              {outline.nodes.map((node) => (
                <button key={node.id} type="button" className={selected === `node:${node.id}` ? 'on' : ''} data-ev={`project-section-node-${node.id}`} onClick={() => setSelected(`node:${node.id}`)}>
                  {node.label}
                  {(instructions.nodes[node.id]?.text ?? '') !== '' || (instructions.nodes[node.id]?.documents.length ?? 0) > 0 ? ' •' : ''}
                </button>
              ))}
            </nav>

            <section className="project-section" data-ev="project-section">
              <h3>{sectionLabel(selected)}</h3>
              {selectedNode !== null ? (
                <p className="muted" data-ev="project-section-node">
                  Role <strong>{selectedNode.roleId ?? 'none'}</strong>. Its task: {selectedNode.purpose || 'none written'}.
                </p>
              ) : selected.startsWith('role:') ? (
                <p className="muted" data-ev="project-section-role-users">
                  Used by {roleUsers.map((node) => node.label).join(', ') || 'no step'}: what you write here reaches each of them once.
                </p>
              ) : (
                <p className="muted">Reaches every step. Put rules here once rather than in each role or step.</p>
              )}
              <label>
                Instructions — sent to the step, after its role
                <textarea data-ev="project-text" rows={6} value={section.text} onChange={(event) => putSection({ ...section, text: event.target.value })} />
              </label>
              <div className="project-documents" data-ev="project-documents">
                <div className="setting-name">Documents — the step is told where they are and reads them itself; they are not attached</div>
                {section.documents.map((doc, index) => (
                  <div key={index} className="project-document" data-ev="project-document">
                    <input aria-label="Path" value={doc.path} onChange={(event) => putDocument(index, { ...doc, path: event.target.value })} />
                    {doc.external === true ? <span className="tag" title="Outside the repository: not portable, never copied">outside the repository</span> : null}
                    <input aria-label="Why it matters" placeholder="Why it matters" value={doc.purpose} onChange={(event) => putDocument(index, { ...doc, purpose: event.target.value })} />
                    <input aria-label="When to read it" placeholder="When to read it" value={doc.when} onChange={(event) => putDocument(index, { ...doc, when: event.target.value })} />
                    <span className="project-document__buttons">
                      <button type="button" title="Up" disabled={index === 0} onClick={() => moveDocument(index, -1)}>↑</button>
                      <button type="button" title="Down" disabled={index === section.documents.length - 1} onClick={() => moveDocument(index, 1)}>↓</button>
                      <button type="button" data-ev="project-document-remove" onClick={() => putDocument(index, null)}>Remove</button>
                    </span>
                  </div>
                ))}
                <div className="section-buttons">
                  <button
                    type="button"
                    data-ev="project-document-pick"
                    disabled={repositoryNow === ''}
                    onClick={() =>
                      void bridge.pickProjectDocument(repositoryNow).then((picked) => {
                        if (picked !== null) putSection({ ...section, documents: [...section.documents, { path: picked.path, purpose: '', when: '', ...(picked.external ? { external: true as const } : {}) }] });
                      })
                    }
                  >
                    Choose a document…
                  </button>
                  <button type="button" data-ev="project-document-add" onClick={() => putSection({ ...section, documents: [...section.documents, { path: '', purpose: '', when: '' }] })}>
                    Add by path
                  </button>
                </div>
              </div>
              {references.filter((problem) => problem.layer.toLowerCase().includes(selected === 'common' ? 'common' : selected.slice(5).toLowerCase())).length > 0 ? (
                <ul className="findings" data-ev="project-reference-problems">
                  {references
                    .filter((problem) => problem.layer.toLowerCase().includes(selected === 'common' ? 'common' : selected.slice(5).toLowerCase()))
                    .map((problem) => (
                      <li key={`${problem.layer}${problem.path}`} className="finding finding-warning">
                        {problem.path} {problem.problem}
                      </li>
                    ))}
                </ul>
              ) : null}

              <div className="section-buttons project-recommend" data-ev="project-recommend">
                {options?.agent.recommendRefusal !== null && options?.agent.recommendRefusal !== undefined ? (
                  <span className="muted" data-ev="project-recommend-refused">
                    Recommendations: {options.agent.recommendRefusal} You can fit everything by hand.
                  </span>
                ) : (
                  <>
                    <button type="button" data-ev="project-recommend-all" disabled={recommending !== null} onClick={() => void recommend({ kind: 'all' }, 'for every role and step')}>
                      Recommend for all
                    </button>
                    {selectedRole !== null ? (
                      <button type="button" data-ev="project-recommend-role" disabled={recommending !== null} onClick={() => void recommend({ kind: 'role', roleId: selectedRole }, `for the role ${selectedRole}`)}>
                        Recommend for this role
                      </button>
                    ) : null}
                    {selectedNode !== null ? (
                      <button type="button" data-ev="project-recommend-step" disabled={recommending !== null} onClick={() => void recommend({ kind: 'node', nodeId: selectedNode.id }, `for the step ${selectedNode.label}`)}>
                        Recommend for this step
                      </button>
                    ) : null}
                    {recommending !== null ? (
                      <button type="button" data-ev="project-recommend-stop" onClick={() => void bridge.projectGraph({ kind: 'cancelRecommend', requestId: recommending })}>
                        Stop
                      </button>
                    ) : null}
                    <span className="muted">
                      Uses {options?.agent.provider ?? 'the chosen agent'}
                      {options?.agent.model ? ` · ${options.agent.model}` : ''}, read-only, in this repository.{inventory === null ? '' : ' Its inventory of the repository is reused.'}
                    </span>
                  </>
                )}
              </div>

              {answer !== null ? (
                <div className="project-proposals" data-ev="project-proposals">
                  <h3>Proposals from {answer.agent}</h3>
                  {answer.answer.recommendations.length === 0 ? <p className="muted">None.</p> : null}
                  {answer.answer.recommendations.map((rec) => {
                    const current = sectionOf(instructions, rec.target);
                    return (
                      <div key={rec.target} className="project-proposal" data-ev="project-proposal" data-target={rec.target}>
                        <div className="setting-name">
                          <button type="button" className="link-button" onClick={() => setSelected(rec.target)}>
                            {sectionLabel(rec.target)}
                          </button>
                        </div>
                        {rec.text !== '' ? (
                          <div className="project-diff">
                            <div>
                              <span className="muted">Now</span>
                              <pre className="brief-text">{current.text === '' ? '(nothing)' : current.text}</pre>
                            </div>
                            <div>
                              <span className="muted">Proposed — {rec.textWhy}</span>
                              <pre className="brief-text">{rec.text}</pre>
                            </div>
                            <span className="section-buttons">
                              <button type="button" data-ev="project-take-append" disabled={taken.has(`${rec.target}:append`)} onClick={() => take(`${rec.target}:append`, (value) => withSection(value, rec.target, { ...sectionOf(value, rec.target), text: [sectionOf(value, rec.target).text.trim(), rec.text].filter((part) => part !== '').join('\n\n') }))}>
                                {taken.has(`${rec.target}:append`) ? 'Added' : 'Add to the text'}
                              </button>
                              <button type="button" data-ev="project-take-replace" disabled={taken.has(`${rec.target}:replace`)} onClick={() => take(`${rec.target}:replace`, (value) => withSection(value, rec.target, { ...sectionOf(value, rec.target), text: rec.text }))}>
                                Replace the text
                              </button>
                            </span>
                          </div>
                        ) : null}
                        {rec.documents.map((doc) => {
                          const already = current.documents.some((existing) => existing.path === doc.path);
                          const key = `${rec.target}:doc:${doc.path}`;
                          return (
                            <div key={doc.path} className="project-proposal-doc">
                              <code>{doc.path}</code> — {doc.purpose}
                              {doc.when === '' ? '' : `; read ${doc.when}`}
                              <span className="muted"> ({doc.why})</span>{' '}
                              <button type="button" data-ev="project-take-document" disabled={already || taken.has(key)} onClick={() => take(key, (value) => withSection(value, rec.target, { ...sectionOf(value, rec.target), documents: [...sectionOf(value, rec.target).documents, { path: doc.path, purpose: doc.purpose, when: doc.when }] }))}>
                                {already || taken.has(key) ? 'Referenced' : 'Add reference'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {[
                    ['Missing information', answer.answer.missing],
                    ['Conflicts', answer.answer.conflicts],
                    ['Uncertain', answer.answer.uncertain],
                    ['Not shown', answer.dropped],
                  ].map(([title, list]) =>
                    (list as readonly string[]).length === 0 ? null : (
                      <div key={title as string} data-ev={`project-proposals-${String(title).toLowerCase().replace(/\s+/g, '-')}`}>
                        <div className="setting-name">{title as string}</div>
                        <ul>
                          {(list as readonly string[]).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}
                  {answer.answer.inventory.governing.length > 0 ? (
                    <details>
                      <summary>The agent's inventory</summary>
                      <ul>
                        {(['governing', 'agentDefinitions', 'history', 'examples'] as const).flatMap((kind) =>
                          answer.answer.inventory[kind].map((entry) => (
                            <li key={`${kind}${entry.path}`}>
                              {kind}: <code>{entry.path}</code> — {entry.why}
                            </li>
                          )),
                        )}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {selectedNode !== null ? (
                <details className="project-preview" data-ev="project-preview" open>
                  <summary>What this step is sent, in order</summary>
                  <ol className="muted">
                    <li>
                      The generic role <strong>{selectedNode.roleId}</strong>, from <code>{description?.roleTexts[selectedNode.roleId ?? '']?.sourcePath ?? '?'}</code>
                      {mode.mode === 'apply' ? ' (copied into the repository when you save)' : ''}.
                    </li>
                    <li>The project's instructions below: common, role, this step — the same text the run assembles.</li>
                    <li>DSpatch's own account of the run, the person's assignment and the results handed to this step, which exist only when a run does.</li>
                  </ol>
                  <pre className="brief-text" data-ev="project-preview-text">{preview === '' ? '(No project instructions reach this step.)' : preview}</pre>
                  {(description?.fanOuts ?? []).some((fan) => fan.runsAs.includes(selectedNode.id)) ? (
                    <p className="muted">A parallel branch that runs as this step gets this step's additions, with its own worktree as the repository root.</p>
                  ) : null}
                </details>
              ) : null}
            </section>
          </div>
        ) : null}

        {step === 'review' && files !== null ? (
          <div className="project-review" data-ev="project-review">
            <h3>{mode.mode === 'apply' ? 'These files will be created' : 'This file will change'}</h3>
            <ul data-ev="project-files">
              {files.map((file) => (
                <li key={file.relative}>
                  <code>{file.relative}</code> — {file.action === 'create' ? 'new' : 'changed'}: {file.what}
                </li>
              ))}
            </ul>
            {references.length > 0 ? (
              <>
                <h3>Document references to look at</h3>
                <ul className="findings" data-ev="project-review-references">
                  {references.map((problem) => (
                    <li key={`${problem.layer}${problem.path}`} className="finding finding-warning">
                      {problem.layer}: {problem.path} {problem.problem}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="muted">Nothing is committed: the files are left for you to review and commit with Git.</p>
          </div>
        ) : null}

        {problems.length > 0 ? (
          <ul className="findings" data-ev="project-problems">
            {problems.map((problem) => (
              <li key={problem} className="finding finding-error">
                {problem}
              </li>
            ))}
          </ul>
        ) : null}
        {busy !== null || note !== null ? <p className="muted" data-ev="project-note">{busy ?? note}</p> : null}

        <div className="dialog-actions">
          {step === 'setup' ? (
            <button
              type="button"
              data-ev="project-next"
              disabled={templateKey === '' || repository === '' || name.trim() === '' || busy !== null}
              onClick={() => void describe({ templateKey }).then((ok) => ok && setStep('customize'))}
            >
              Next: fit it to the project
            </button>
          ) : null}
          {step === 'customize' ? (
            <button type="button" data-ev="project-review-files" disabled={busy !== null || outline === null || (mode.mode === 'edit' && !dirty)} onClick={() => void plan()}>
              Review and save…
            </button>
          ) : null}
          {step === 'review' ? (
            <>
              <button type="button" data-ev="project-save" disabled={busy !== null} onClick={() => void save()}>
                Save
              </button>
              <button type="button" onClick={() => setStep('customize')}>
                Back
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-ev="project-close"
            onClick={() => {
              if (recommending !== null) void bridge.projectGraph({ kind: 'cancelRecommend', requestId: recommending });
              if (!dirty || window.confirm('Close without saving these instructions?')) onClose();
            }}
          >
            {dirty ? 'Close without saving' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

