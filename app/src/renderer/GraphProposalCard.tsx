/**
 * DSP-209 S23b: a loop graph the chat proposed, as a card the person decides on.
 *
 * It reads **Proposal — not applied** until it is applied. It shows what would change (S17's
 * `describeChangeLines`), the validation findings, the agent's explanation labelled as the
 * agent's words, and **every full path it would write** — the graph, a new loop's definition,
 * each role file — before anything is written. **Apply** asks the host to write the stored
 * proposal, which it refuses outside the open project folders, while a run of that loop is
 * active, and over a file changed since (then the card says so and the status is `conflict`).
 * Applying starts no run. **Discard** writes nothing. A proposal that is no longer open says
 * what it is and offers no Apply.
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

/** Every proposal in the conversation, newest first; restored from disk, then kept current by the host. */
export function GraphProposalCards({
  restored,
  onApplied,
}: {
  readonly restored: readonly StoredMessage[];
  /** After an Apply, so the loop list can show a new loop. */
  readonly onApplied?: () => void;
}): JSX.Element | null {
  const [live, setLive] = useState<GraphProposalsUpdate | null>(null);
  useEffect(() => window.dspatch.onGraphProposals(setLive), []);
  const fromDisk = restored.flatMap((message) => message.graphProposals ?? []);
  const proposals =
    live !== null && (fromDisk.length === 0 || fromDisk.some((each) => each.conversationId === live.conversationId)) ? live.proposals : fromDisk;
  if (proposals.length === 0) {
    return null;
  }
  return (
    <div className="graph-proposals" data-ev="graph-proposals">
      {[...proposals].reverse().map((proposal) => (
        <GraphProposalCard key={proposal.id} proposal={proposal} {...(onApplied === undefined ? {} : { onApplied })} />
      ))}
    </div>
  );
}

export function GraphProposalCard({
  proposal,
  onApplied,
}: {
  readonly proposal: GraphEditProposal;
  readonly onApplied?: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const open = proposal.status === 'proposed';
  const errors = proposal.findings.filter((finding) => finding.severity === 'error');
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
  const canOpen = !isNewLoopTarget(proposal.target) || proposal.status === 'applied';
  return (
    <section className={`graph-proposal graph-proposal--${proposal.status}`} data-ev="graph-proposal" data-status={proposal.status}>
      <p className="graph-proposal__status" data-ev="graph-proposal-status">
        {STATUS_WORDS[proposal.status]}
      </p>
      {proposal.status === 'conflict' ? (
        <p className="graph-proposal__problem">Changed in the editor since; ask the chat to revise from the current version.</p>
      ) : null}
      <p className="graph-proposal__label">Would write:</p>
      <ul className="graph-proposal__paths" data-ev="graph-proposal-paths">
        {proposalPaths(proposal).map((entry) => (
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
      {proposal.findings.length === 0 ? null : (
        <>
          <p className="graph-proposal__label">Findings{errors.length === 0 ? '' : ` (${String(errors.length)} error${errors.length === 1 ? '' : 's'})`}:</p>
          <ul className="graph-proposal__findings">
            {proposal.findings.map((finding, index) => (
              <li key={index}>
                {finding.severity}: {finding.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="graph-proposal__label">{AGENT_WORDS_LABEL}:</p>
      <blockquote className="graph-proposal__explanation">{proposal.explanation.text}</blockquote>
      <p className="graph-proposal__actions">
        {open ? (
          <button type="button" className="button" data-ev="graph-proposal-apply" disabled={busy} title="Write these files" onClick={() => act('apply')}>
            Apply
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          data-ev="graph-proposal-open"
          disabled={busy || !canOpen}
          title="Choose this loop and open it as it is on disk"
          onClick={() => {
            void window.dspatch.openLoopEditor(editorOpenFor(proposal)).then(
              (outcome) => setNote(outcome.kind === 'failed' ? outcome.note : null),
              (error: unknown) => setNote(error instanceof Error ? error.message : String(error)),
            );
          }}
        >
          Open in editor
        </button>
        {open ? (
          <button type="button" className="button" data-ev="graph-proposal-discard" disabled={busy} title="Drop this proposal" onClick={() => act('discard')}>
            Discard
          </button>
        ) : null}
      </p>
      <p className="graph-proposal__hint">
        {open
          ? isNewLoopTarget(proposal.target)
            ? 'Open in editor works once it is applied: the new loop has no file yet. Apply never runs the loop.'
            : 'Open in editor chooses the loop and shows it as it is on disk, without this proposal. Neither runs it.'
          : 'This proposal is no longer open, so it cannot be applied.'}
      </p>
      {note === null ? null : (
        <p className="graph-proposal__note" data-ev="graph-proposal-note">
          {note}
        </p>
      )}
    </section>
  );
}
