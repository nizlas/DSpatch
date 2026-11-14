/**
 * DSP-209 S23b: a loop graph the chat proposed, as a card the person decides on.
 *
 * It reads **Proposal — not applied** until it is applied. The top says what a person needs to
 * decide: the loop's name, the first sentence of its purpose, one sentence on what Apply would
 * change, the errors and warnings, and the agent's explanation labelled as the agent's words.
 * **Details** keeps the rest whole: **every full path it would write** — the graph, a new loop's
 * definition, each role file — the change line by line (S17's `describeChangeLines`), the
 * notices and the whole purpose. **Preview** opens the proposal itself in the editor before
 * anything is written. **Apply** asks the host to write the stored proposal, which it refuses
 * outside the open project folders, while a run of that loop is active, and over a file changed
 * since (then the card says so and the status is `conflict`). Applying starts no run.
 * **Discard** writes nothing. A proposal that is no longer open says what it is and offers no
 * Apply.
 *
 * Each proposal is drawn at the turn that made it, in the conversation's order (Niclas,
 * 15 November 2026). Open proposals and the newest one are shown; earlier ones are folded at
 * their own turn, where they can be opened and read, numbered in the order they were made
 * rather than by their ids.
 *
 * Every status, path, finding and refusal is visible text; hovers are short labels (R7).
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { GraphProposalsUpdate, StoredMessage } from '../shared/bridge';
import {
  AGENT_WORDS_LABEL,
  describeChangeLines,
  editorOpenFor,
  isNewLoopTarget,
  placeProposals,
  summariseProposal,
  type NumberedProposal,
  type ProposalPlacement,
  targetGraphPath,
  type GraphEditProposal,
  type ProposalStatus,
} from '../shared/graph-proposal';

const STATUS_WORDS: Readonly<Record<ProposalStatus, string>> = {
  proposed: 'Proposal — not applied',
  applied: 'Applied — written to disk',
  discarded: 'Discarded — nothing was written',
  superseded: 'Superseded by a later proposal — nothing was written',
  conflict: 'Not applied — the loop changed since',
};

/** The paths a proposal would write, graph first, in full. */
export function proposalPaths(proposal: GraphEditProposal): readonly { readonly what: string; readonly path: string }[] {
  return [
    { what: isNewLoopTarget(proposal.target) ? 'New graph file' : 'Graph file (replaced)', path: targetGraphPath(proposal.target) },
    ...(isNewLoopTarget(proposal.target) ? [{ what: 'New loop definition', path: proposal.target.newLoop.definitionPath }] : []),
    ...proposal.roleFiles.map((file) => ({ what: 'New role file', path: file.path })),
  ];
}

/** The conversation's proposals, restored from disk, then kept current by the host. */
export function useGraphProposals(restored: readonly StoredMessage[]): ProposalPlacement {
  const [live, setLive] = useState<GraphProposalsUpdate | null>(null);
  useEffect(() => window.dspatch.onGraphProposals(setLive), []);
  return placeProposals(restored, live);
}

/**
 * The proposals one turn made, drawn at that turn: those in view as cards, in the order they
 * were made, and the earlier versions folded below them, each still readable whole.
 */
export function GraphProposalGroup({
  entries,
  onApplied,
}: {
  readonly entries: readonly NumberedProposal[] | undefined;
  /** After an Apply, so the loop list can show a new loop. */
  readonly onApplied?: () => void;
}): JSX.Element | null {
  if (entries === undefined || entries.length === 0) {
    return null;
  }
  const current = entries.filter((entry) => entry.shown);
  const earlier = entries.filter((entry) => !entry.shown);
  const applied = onApplied === undefined ? {} : { onApplied };
  return (
    <div className="graph-proposals" data-ev="graph-proposals">
      {current.map((entry) => (
        <GraphProposalCard key={entry.proposal.id} proposal={entry.proposal} ordinal={entry.ordinal} {...applied} />
      ))}
      {earlier.length === 0 ? null : (
        <details className="graph-proposals__history" data-ev="graph-proposals-history">
          <summary>
            {earlier.length === 1
              ? `Earlier version: Proposal ${String(earlier[0]?.ordinal ?? '')} · ${earlier[0]?.proposal.status ?? ''}`
              : `Earlier versions (${String(earlier.length)}): ${earlier.map((entry) => `Proposal ${String(entry.ordinal)} · ${entry.proposal.status}`).join(', ')}`}
          </summary>
          {earlier.map((entry) => (
            <GraphProposalCard key={entry.proposal.id} proposal={entry.proposal} ordinal={entry.ordinal} {...applied} />
          ))}
        </details>
      )}
    </div>
  );
}

export function GraphProposalCard({
  proposal,
  ordinal,
  onApplied,
}: {
  readonly proposal: GraphEditProposal;
  /** Which proposal of the conversation this is, counted from the first. */
  readonly ordinal?: number;
  readonly onApplied?: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const open = proposal.status === 'proposed';
  const summary = summariseProposal(proposal);
  const act = (action: 'apply' | 'discard'): void => {
    setBusy(true);
    setNote(null);
    void window.dspatch
      .saveLoopGraph({
        path: targetGraphPath(proposal.target),
        text: proposal.graphText,
        proposal: { conversationId: proposal.conversationId, proposalId: proposal.id, action },
      })
      .then(
        (outcome) => {
          if (outcome.kind === 'written') {
            setNote(`Written to ${outcome.path}. No run was started.`);
            onApplied?.();
          } else if (outcome.kind === 'refused' || outcome.kind === 'failed') {
            setNote(outcome.note);
          }
        },
        (error: unknown) => setNote(`Nothing was written: ${error instanceof Error ? error.message : String(error)}`),
      )
      .finally(() => setBusy(false));
  };
  const openEditor = (asked: Parameters<typeof window.dspatch.openLoopEditor>[0]): void => {
    void window.dspatch.openLoopEditor(asked).then(
      (outcome) => setNote(outcome.kind === 'failed' ? outcome.note : null),
      (error: unknown) => setNote(error instanceof Error ? error.message : String(error)),
    );
  };
  const canOpen = !isNewLoopTarget(proposal.target) || proposal.status === 'applied';
  const paths = proposalPaths(proposal);
  return (
    <section className={`graph-proposal graph-proposal--${proposal.status}`} data-ev="graph-proposal" data-status={proposal.status}>
      <p className="graph-proposal__status" data-ev="graph-proposal-status">
        {ordinal === undefined ? '' : `Proposal ${String(ordinal)} · `}
        {STATUS_WORDS[proposal.status]}
      </p>
      <p className="graph-proposal__name" data-ev="graph-proposal-name">
        {summary.isNew ? 'New loop: ' : 'Change to '}
        <strong>{summary.loopName}</strong>
      </p>
      {summary.purpose === null ? null : <p className="graph-proposal__purpose">{summary.purpose}</p>}
      <p className="graph-proposal__change" data-ev="graph-proposal-change">
        {summary.change}
      </p>
      {proposal.status === 'conflict' ? (
        <p className="graph-proposal__problem">Changed in the editor since; ask the chat to revise from the current version.</p>
      ) : null}
      {summary.errors.length === 0 ? null : (
        <div className="graph-proposal__problem" data-ev="graph-proposal-errors">
          {summary.errors.length === 1 ? 'An error, so it cannot be applied as it is:' : `${String(summary.errors.length)} errors, so it cannot be applied as it is:`}
          <ul className="graph-proposal__findings">
            {summary.errors.map((finding, index) => (
              <li key={index}>{finding.message}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.warnings.length === 0 ? null : (
        <div className="graph-proposal__warnings" data-ev="graph-proposal-warnings">
          {summary.warnings.length === 1 ? 'A warning:' : `${String(summary.warnings.length)} warnings:`}
          <ul className="graph-proposal__findings">
            {summary.warnings.map((finding, index) => (
              <li key={index}>{finding.message}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="graph-proposal__label">{AGENT_WORDS_LABEL}:</p>
      <blockquote className="graph-proposal__explanation">{proposal.explanation.text}</blockquote>
      <p className="graph-proposal__actions">
        {open ? (
          <button type="button" className="button" data-ev="graph-proposal-apply" disabled={busy} title="Write these files" onClick={() => act('apply')}>
            Apply
          </button>
        ) : null}
        {/*
          DSP-209 S23b: the proposal itself in the editor, its new roles read from their own
          text, before anything is written. It chooses no loop and runs nothing.
        */}
        <button
          type="button"
          className="button"
          data-ev="graph-proposal-preview"
          disabled={busy}
          title="Look at this proposal in the editor; nothing is written or chosen"
          onClick={() => openEditor({ as: 'proposal', conversationId: proposal.conversationId, proposalId: proposal.id })}
        >
          Preview
        </button>
        {canOpen ? (
          <button
            type="button"
            className="button"
            data-ev="graph-proposal-open"
            disabled={busy}
            title="Choose this loop and open it as it is on disk"
            onClick={() => openEditor(editorOpenFor(proposal))}
          >
            Open in editor
          </button>
        ) : null}
        {open ? (
          <button type="button" className="button" data-ev="graph-proposal-discard" disabled={busy} title="Drop this proposal" onClick={() => act('discard')}>
            Discard
          </button>
        ) : null}
      </p>
      <p className="graph-proposal__hint">
        {open
          ? isNewLoopTarget(proposal.target)
            ? 'Preview shows it in the editor now; Open in editor works once it is applied. Apply never runs the loop.'
            : 'Preview shows this proposal; Open in editor chooses the loop and shows it as it is on disk. Neither runs it.'
          : 'This proposal is no longer open, so it cannot be applied. Preview still shows what it proposed.'}
      </p>
      {note === null ? null : (
        <p className="graph-proposal__note" data-ev="graph-proposal-note">
          {note}
        </p>
      )}
      <details className="graph-proposal__details" data-ev="graph-proposal-details">
        <summary>
          Details: {paths.length === 1 ? 'the file' : `${String(paths.length)} files`}, every change
          {summary.notices.length === 0 ? '' : `, ${String(summary.notices.length)} notice${summary.notices.length === 1 ? '' : 's'}`}
        </summary>
        {summary.wholePurpose === null ? null : (
          <>
            <p className="graph-proposal__label">The loop's purpose:</p>
            <p className="graph-proposal__purpose-whole">{summary.wholePurpose}</p>
          </>
        )}
        <p className="graph-proposal__label">{open ? 'Would write:' : 'Files:'}</p>
        <ul className="graph-proposal__paths" data-ev="graph-proposal-paths">
          {paths.map((entry) => (
            <li key={entry.path}>
              {entry.what}: <code>{entry.path}</code>
            </li>
          ))}
        </ul>
        <p className="graph-proposal__label">What changes:</p>
        <ul className="graph-proposal__changes">
          {proposal.change === null ? (
            <li>The change could not be described; the findings say why.</li>
          ) : (
            describeChangeLines(proposal.change).map((line, index) => <li key={index}>{line}</li>)
          )}
        </ul>
        {summary.notices.length === 0 ? null : (
          <>
            <p className="graph-proposal__label">Notices:</p>
            <ul className="graph-proposal__findings">
              {summary.notices.map((finding, index) => (
                <li key={index}>{finding.message}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
