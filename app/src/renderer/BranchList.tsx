/**
 * DSP-209 S20: a fan-out node's branches as a list a person reads without hovering.
 *
 * Used under the node in the loop editor and under the run's entry in the chat, so both
 * show one branch the same way. Every word comes from `shared/branch-presentation.ts`. Each
 * row says its task, state, model and messages in visible text; its live output opens in
 * place, and **Open in window** follows it in a window of its own.
 *
 * The actions are plain buttons outside any `fieldset`: the editor locks its inspector
 * during a run, and following a branch is reading, not editing.
 */

import { useState } from 'react';
import type { JSX } from 'react';

import type { BranchActivityState } from '../shared/loop-activity';
import {
  BRANCH_MESSAGES_NOTE,
  branchActivityFor,
  branchOutputLines,
  type BranchRow,
} from '../shared/branch-presentation';

export function BranchList({
  rows,
  activity,
  heading,
}: {
  readonly rows: readonly BranchRow[];
  readonly activity: readonly BranchActivityState[] | undefined;
  /** What the list is of, e.g. the node's label. */
  readonly heading: string;
}): JSX.Element | null {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  if (rows.length === 0) {
    return null;
  }
  const toggle = (key: string): void => {
    setShown((before) => {
      const next = new Set(before);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  return (
    <section className="branch-list" data-ev="branch-list" aria-label={`Branches of ${heading}`}>
      <h3 className="branch-list__heading">Branches of {heading}</h3>
      <ul className="branch-list__rows">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`branch-list__row${row.current ? '' : ' branch-list__row--earlier'}`}
            data-ev="branch-row"
            data-slice-id={row.sliceId}
          >
            <p className="branch-list__title">
              <strong>{row.sliceId}</strong> · {row.state} · <span className="branch-list__visit">{row.visitLabel}</span>
            </p>
            <dl className="branch-list__facts">
              <dt>Task</dt>
              <dd>{row.task}</dd>
              <dt>Model</dt>
              <dd>{row.model}</dd>
              <dt>Messages</dt>
              <dd>{row.messages}</dd>
            </dl>
            <p className="branch-list__actions">
              <button type="button" className="button" data-ev="branch-output-toggle" aria-expanded={shown.has(row.key)} onClick={() => toggle(row.key)}>
                {shown.has(row.key) ? 'Hide output' : 'Show output'}
              </button>
              <button
                type="button"
                className="button"
                data-ev="branch-output-window"
                onClick={() => {
                  void window.dspatch.openBranchOutput(row.address).then(
                    (outcome) => setNote(outcome.opened ? null : outcome.note),
                    (error: unknown) => setNote(`The window could not be opened: ${error instanceof Error ? error.message : String(error)}`),
                  );
                }}
              >
                Open in window
              </button>
            </p>
            {shown.has(row.key) && (
              <pre className="branch-list__output" data-ev="branch-output">
                {branchOutputLines(branchActivityFor(activity, row.address)).join('\n')}
              </pre>
            )}
          </li>
        ))}
      </ul>
      <p className="branch-list__note">{BRANCH_MESSAGES_NOTE}</p>
      {note === null ? null : <p className="branch-list__note branch-list__note--problem">{note}</p>}
    </section>
  );
}
