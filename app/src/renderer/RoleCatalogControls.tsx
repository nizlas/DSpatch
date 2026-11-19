/**
 * DSP-231: the node panel's view of a shared role — its name, identity, version and origin — and the
 * explicit ways to change it: pick another catalog role or version, make a project role of one's own
 * (a new identity, or the next version of the project's own role), and the graph panel's reviewable
 * upgrade from legacy roles. Nothing here edits a published role version; every change to a graph is
 * an ordinary unsaved edit until the person saves, and every file written is said first.
 */
import React, { useEffect, useState } from 'react';

import type { LoopGraph, LoopNode, ResolvedRole } from '../shared/loop-graph';
import type { CatalogRoleView, ProjectGraphAnswer, RoleUpgradeView } from '../shared/project-graph-bridge';
import { catalogReference } from '../shared/role-catalog';

type Catalog = { readonly roles: readonly CatalogRoleView[]; readonly catalogDir: string; readonly legacy: readonly string[] };

function problemsOf(answer: ProjectGraphAnswer): string {
  return answer.kind === 'refused' ? answer.problems.join(' ') : 'Unexpected answer.';
}

/** The roles a graph at `resourceRoot` can use, fetched once per root. */
export function useRoleCatalog(resourceRoot: string | null): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let live = true;
    void window.dspatch.projectGraph({ kind: 'roleCatalog', resourceRoot }).then((answer) => {
      if (live && answer.kind === 'roleCatalog') setCatalog({ roles: answer.roles, catalogDir: answer.catalogDir, legacy: answer.legacy });
    });
    return () => {
      live = false;
    };
  }, [resourceRoot]);
  return catalog;
}

function originName(origin: string | undefined): string {
  return origin === 'dspatch' ? 'DSpatch catalog' : origin === 'project' ? 'this project' : (origin ?? 'unknown origin');
}

/** The heading line: "Implementer · implementer v1 · DSpatch catalog", or a local role said as such. */
export function RoleIdentity({
  graph,
  node,
  role,
  resourceRoot,
  onGraphChange,
  onNote,
}: {
  readonly graph: LoopGraph;
  readonly node: LoopNode;
  readonly role: ResolvedRole | null;
  readonly resourceRoot: string | null;
  readonly onGraphChange: (next: LoopGraph) => void;
  readonly onNote: (note: string) => void;
}): React.JSX.Element | null {
  const catalog = useRoleCatalog(resourceRoot);
  const [picking, setPicking] = useState(false);
  const [editor, setEditor] = useState<{ readonly text: string; readonly kind: 'new' | 'version' } | null>(null);
  const [saved, setSaved] = useState<{ readonly id: string; readonly version: number; readonly reference: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (node.role === undefined) return null;
  const reference = node.role;
  const sharing = graph.nodes.filter((other) => other.role?.id === reference.id && other.role.version === reference.version && other.role.source.path === reference.source.path);
  const listed = catalog?.roles.find((candidate) => candidate.id === reference.id) ?? null;
  const newer = listed !== null && reference.version !== undefined ? listed.versions.filter((version) => version > (reference.version as number)) : [];
  const legacy = reference.source.kind !== 'role-catalog' && (catalog?.legacy.includes(reference.id) ?? false);

  /** Point `targets` at `id@version`, copying a shared role into the repository first when it needs one. */
  const use = async (id: string, version: number, targets: readonly LoopNode[], origin: string): Promise<void> => {
    if (resourceRoot === null || catalog === null) return;
    setBusy(true);
    try {
      if (origin === 'dspatch' && catalog.catalogDir !== 'docs/loop/roles/catalog') {
        const copied = await window.dspatch.projectGraph({ kind: 'copyCatalogRoles', resourceRoot, roles: [{ id, version }] });
        if (copied.kind !== 'rolesCopied') {
          onNote(problemsOf(copied));
          return;
        }
        if (copied.written.length > 0) onNote(`Copied the shared role ${id} v${String(version)} into ${catalog.catalogDir}, as written in DSpatch's catalog.`);
      }
      const next = catalogReference(id, version, origin === 'project' ? '.dspatch/roles' : catalog.catalogDir);
      const ids = new Set(targets.map((target) => target.id));
      onGraphChange({ ...graph, nodes: graph.nodes.map((each) => (ids.has(each.id) ? { ...each, role: next } : each)) });
      setPicking(false);
    } finally {
      setBusy(false);
    }
  };

  const startEditor = async (kind: 'new' | 'version'): Promise<void> => {
    if (resourceRoot === null) return;
    const answer = await window.dspatch.projectGraph({ kind: 'roleSource', resourceRoot, path: reference.source.path });
    const text = answer.kind === 'roleSource' ? answer.text : '';
    const from = reference.version === undefined ? reference.id : `${reference.id}@${String(reference.version)}`;
    const seeded =
      kind === 'version'
        ? text
        : text
            .replace(/^role\s*:.*$/m, `role: ${reference.id}-project`)
            .replace(/^(version|origin|derivedFrom)\s*:.*\n/gm, '')
            .replace(/^---\n/, `---\nderivedFrom: ${from}\n`);
    setEditor({ text: seeded, kind });
  };

  const save = async (): Promise<void> => {
    if (resourceRoot === null || editor === null) return;
    setBusy(true);
    try {
      const answer = await window.dspatch.projectGraph({ kind: 'projectRoleSave', resourceRoot, text: editor.text });
      if (answer.kind !== 'roleSaved') {
        onNote(problemsOf(answer));
        return;
      }
      setSaved({ id: answer.id, version: answer.version, reference: answer.reference });
      setEditor(null);
      onNote(`Saved the project role ${answer.id} v${String(answer.version)} at ${answer.reference}. No node uses it until you choose so below.`);
    } finally {
      setBusy(false);
    }
  };

  const status = role?.catalog;
  return (
    <div className="role-identity" data-ev="role-identity">
      <p className="role-identity__line" data-ev="role-identity-line">
        <strong>{role?.title ?? listed?.title ?? reference.id}</strong>
        <span className="muted">
          {' · '}
          {reference.id}
          {reference.version === undefined ? ' · local role, not versioned' : ` v${String(reference.version)} · ${originName(role?.origin ?? listed?.origin)}`}
          {role?.derivedFrom === undefined ? '' : ` · made from ${role.derivedFrom}`}
        </span>
      </p>
      <p className="muted" data-ev="role-identity-scope">
        {sharing.length === 1
          ? 'Only this node uses this role in this graph.'
          : `${String(sharing.length)} nodes of this graph use this role: ${sharing.map((each) => each.label ?? each.id).join(', ')}. Each runs in its own session; sharing a role shares its instructions, not a conversation.`}
      </p>
      {status === undefined || status.status === 'listed' ? null : (
        <p className="broken-note" data-ev="role-identity-status">
          {status.status === 'unlisted' ? 'Not found in any role catalog DSpatch can read: ' : 'Refused: '}
          {status.detail}.
        </p>
      )}
      {legacy ? (
        <p className="muted" data-ev="role-identity-legacy">
          A role from before the shared catalog. The graph panel offers <em>Upgrade to shared roles…</em>, which shows the mapping before anything changes.
        </p>
      ) : null}
      {newer.length > 0 ? (
        <p data-ev="role-identity-newer">
          Version {String(Math.max(...newer))} of this role is available; this graph keeps v{String(reference.version)} until you choose.{' '}
          <button type="button" disabled={busy} onClick={() => void use(reference.id, Math.max(...newer), sharing, listed?.origin ?? 'dspatch')}>
            Use v{String(Math.max(...newer))} for {sharing.length === 1 ? 'this node' : `these ${String(sharing.length)} nodes`}
          </button>
        </p>
      ) : null}
      <span className="section-buttons">
        <button type="button" data-ev="role-change" disabled={resourceRoot === null || catalog === null} onClick={() => setPicking(!picking)}>
          Change role…
        </button>
        {reference.version !== undefined && (role?.origin ?? listed?.origin) === 'project' ? (
          <button type="button" data-ev="role-new-version" disabled={busy} onClick={() => void startEditor('version')}>
            New version…
          </button>
        ) : null}
        <button type="button" data-ev="role-make-project-role" disabled={busy || resourceRoot === null} onClick={() => void startEditor('new')}>
          Make a project role from this…
        </button>
      </span>
      {picking && catalog !== null ? (
        <div className="role-picker" data-ev="role-picker">
          <p className="muted">
            Choose a shared role by what the step is responsible for. Additions under <em>All nodes with this role</em> stay with the role they were written for; any that no
            longer reach a node are shown under Project instructions to move or remove.
          </p>
          <ul>
            {catalog.roles.map((candidate) => {
              const version = Math.max(...candidate.versions);
              return (
                <li key={candidate.id} data-ev="role-picker-option" data-role={candidate.id}>
                  <button type="button" disabled={busy} onClick={() => void use(candidate.id, version, [node], candidate.origin)}>
                    {candidate.title}
                  </button>{' '}
                  <span className="muted">
                    {candidate.id} v{String(version)} · {originName(candidate.origin)} — {candidate.summary}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {editor !== null ? (
        <div className="role-editor" data-ev="role-editor">
          <p className="muted">
            {editor.kind === 'version'
              ? 'A new version of this project role. The current version stays as it is for every graph that uses it.'
              : 'A role of this project, with an identity of its own. The shared role it was made from is not changed.'}{' '}
            It is saved in <code>.dspatch/roles/</code> with its version and digest.
          </p>
          <textarea className="role-editor__text" data-ev="role-editor-text" rows={14} value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} />
          <span className="section-buttons">
            <button type="button" data-ev="role-editor-save" disabled={busy} onClick={() => void save()}>
              Save role
            </button>
            <button type="button" onClick={() => setEditor(null)}>
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {saved !== null ? (
        <p data-ev="role-saved">
          Saved {saved.id} v{String(saved.version)}.{' '}
          <button type="button" data-ev="role-saved-use-node" disabled={busy} onClick={() => void use(saved.id, saved.version, [node], 'project').then(() => setSaved(null))}>
            Use it for this node
          </button>
          {sharing.length > 1 ? (
            <button type="button" data-ev="role-saved-use-all" disabled={busy} onClick={() => void use(saved.id, saved.version, sharing, 'project').then(() => setSaved(null))}>
              Use it for all {String(sharing.length)} nodes with {reference.id}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The graph panel's upgrade from legacy roles: the mapping per node, with the alternatives a legacy
 * role offers, the requirements and task text that move to each node, how the project additions are
 * moved so each reaches the same nodes, the conflicts, and every file it would write. Applied only
 * when the person says so, and refused when the graph changed in between.
 */
export function RoleUpgradeSection({
  definitionKey,
  dirty,
  onApplied,
}: {
  readonly definitionKey: string;
  /** The editor has unsaved changes to the graph: the upgrade works on the saved file. */
  readonly dirty: boolean;
  readonly onApplied: (note: string) => void;
}): React.JSX.Element | null {
  const [plan, setPlan] = useState<{ readonly view: RoleUpgradeView; readonly sha: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  // Asked again after an apply, so a graph with nothing left to upgrade no longer offers it.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    void window.dspatch.projectGraph({ kind: 'roleUpgrade', definitionKey, choices }).then((answer) => {
      if (!live) return;
      if (answer.kind === 'roleUpgrade') {
        setPlan({ view: answer.plan, sha: answer.graphSha256 });
        setProblem(null);
      } else {
        setPlan(null);
      }
    });
    return () => {
      live = false;
    };
  }, [definitionKey, choices, asked]);
  if (plan === null || plan.view.mappings.length === 0) return null;
  const view = plan.view;
  return (
    <section className="node-panel-section role-upgrade" data-ev="role-upgrade">
      <h3>Shared roles</h3>
      <p className="muted">
        {String(view.mappings.length)} node(s) of this graph use roles from before DSpatch's shared role catalog. They keep working as they are. An upgrade points them at
        the shared roles by identity and version, and moves what was specific to this graph into the nodes' tasks.
      </p>
      <button type="button" data-ev="role-upgrade-open" onClick={() => setOpen(!open)}>
        Upgrade to shared roles…
      </button>
      {open ? (
        <div className="role-upgrade__plan" data-ev="role-upgrade-plan">
          <table className="role-upgrade__table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Before</th>
                <th>After</th>
                <th>Moved to the node</th>
              </tr>
            </thead>
            <tbody>
              {view.mappings.map((mapping) => (
                <tr key={mapping.nodeId} data-ev="role-upgrade-row" data-node={mapping.nodeId}>
                  <td>{mapping.nodeLabel}</td>
                  <td>
                    <code>{mapping.from}</code>
                  </td>
                  <td>
                    {mapping.alternatives.length === 0 ? (
                      <code>
                        {mapping.to} v{String(mapping.version)}
                      </code>
                    ) : (
                      <select
                        aria-label={`Shared role for ${mapping.nodeLabel}`}
                        data-ev="role-upgrade-choice"
                        value={choices[mapping.nodeId] ?? mapping.to}
                        onChange={(event) => setChoices({ ...choices, [mapping.nodeId]: event.target.value })}
                      >
                        <option value={mapping.to}>{mapping.to}</option>
                        {mapping.alternatives.map((alternative) => (
                          <option key={alternative.role} value={alternative.role} title={alternative.when}>
                            {alternative.role}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="muted">{mapping.reason}</div>
                  </td>
                  <td>
                    {[
                      mapping.requirementsMovedToNode.length === 0 ? '' : `requirements: ${mapping.requirementsMovedToNode.join(', ')}`,
                      mapping.taskAddition === '' ? '' : `${String(mapping.taskAddition.split(/\s+/).length)} words of task text`,
                    ]
                      .filter((part) => part !== '')
                      .join('; ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.kept.length > 0 ? (
            <ul data-ev="role-upgrade-kept">
              {view.kept.map((kept) => (
                <li key={kept.nodeId}>
                  {kept.nodeId} keeps <code>{kept.roleId}</code>: {kept.reason}.
                </li>
              ))}
            </ul>
          ) : null}
          {view.additions.length > 0 ? (
            <ul data-ev="role-upgrade-additions">
              {view.additions.map((move) => (
                <li key={move.fromRole}>
                  Additions for <code>{move.fromRole}</code>: {move.kind === 'role' ? `kept for all nodes with ${move.toRole ?? ''}` : `placed on ${move.nodes?.join(', ') ?? ''}`} — {move.reason}.
                </li>
              ))}
            </ul>
          ) : null}
          {view.conflicts.length > 0 ? (
            <div className="broken-note" data-ev="role-upgrade-conflicts">
              {view.conflicts.map((conflict) => (
                <p key={conflict}>{conflict}</p>
              ))}
            </div>
          ) : null}
          <div className="setting-name">Files it writes</div>
          <ul data-ev="role-upgrade-files">
            {view.files.map((file) => (
              <li key={file.relative}>
                {file.action === 'create' ? 'Creates' : 'Changes'} <code>{file.relative}</code> — {file.what}
              </li>
            ))}
          </ul>
          {view.blocked !== null ? <p className="broken-note">{view.blocked}</p> : null}
          {dirty ? <p className="broken-note">The graph has unsaved changes. Save or reload it first: the upgrade works on the saved file.</p> : null}
          {problem !== null ? <p className="broken-note">{problem}</p> : null}
          <button
            type="button"
            data-ev="role-upgrade-apply"
            disabled={view.blocked !== null || dirty}
            onClick={() =>
              void window.dspatch.projectGraph({ kind: 'roleUpgradeApply', definitionKey, choices, graphSha256: plan.sha }).then((answer) => {
                if (answer.kind === 'roleUpgraded') {
                  setOpen(false);
                  setAsked((count) => count + 1);
                  onApplied(`Upgraded to shared roles. Wrote ${answer.written.length} file(s): ${answer.written.map((file) => file.split(/[\\/]/).slice(-2).join('/')).join(', ')}.`);
                } else {
                  setProblem(problemsOf(answer));
                }
              })
            }
          >
            Apply upgrade
          </button>
        </div>
      ) : null}
    </section>
  );
}
