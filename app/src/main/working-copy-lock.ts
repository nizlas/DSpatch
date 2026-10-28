/**
 * DSP-147: agent work and a separate manual command exclude each other in one working
 * copy, in both directions (INTERACTION_MODEL.md §3.1, Niclas's decision of 27 October
 * 2026). Whichever starts later is refused with a reason until the earlier one has ended.
 *
 * - **Agent work** is a chat turn or a loop run, held from the moment DSpatch starts it
 *   until its run has ended. A turn cancelled without a confirmed end keeps holding,
 *   because its local work may still be going (DSP-116); the caller releases it when the
 *   session it belongs to is closed.
 * - **A manual command** is the Run button's command, held while it runs.
 *
 * Folders overlap when one is the other or contains it, so a workspace of several folders
 * is excluded wherever any of its folders meets the command's folder.
 *
 * What this does not do: it never looks inside agent work. The agent's own tool calls,
 * its shell commands and its internal parallelism are its runtime's business, and
 * steering a running turn is part of the work already holding the lock, not a new claim.
 * Two pieces of agent work, or two manual commands, are not this lock's question: each
 * has its own rule (one turn per session, one loop run at a time, one Run command per
 * working copy).
 */

import path from 'node:path';

export type WorkingCopyHolderKind = 'agent-work' | 'manual-command';

export interface WorkingCopyHolder {
  readonly kind: WorkingCopyHolderKind;
  /** The folders it works in, as given. */
  readonly folders: readonly string[];
  /** What it is, for the refusal: "a loop run", "the agent's turn", the command line. */
  readonly label: string;
}

export type WorkingCopyClaim =
  | { readonly ok: true; release(): void }
  | { readonly ok: false; readonly holder: WorkingCopyHolder; readonly reason: string };

function normalised(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** One folder is the other, or contains it. */
export function foldersOverlap(a: string, b: string): boolean {
  const left = normalised(a);
  const right = normalised(b);
  if (left === right) {
    return true;
  }
  const inside = (outer: string, inner: string): boolean => {
    const relative = path.relative(outer, inner);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  return inside(left, right) || inside(right, left);
}

/** Why the later start is refused, in words that say what to do. */
export function describeWorkingCopyRefusal(wanted: WorkingCopyHolderKind, holder: WorkingCopyHolder): string {
  return wanted === 'manual-command'
    ? `The agent is working in this folder (${holder.label}). Run your command when that ` +
        'work has ended, or stop it first: a command beside it would interleave with its ' +
        'file changes.'
    : `Your command is running in this folder (${holder.label}). Start the agent when it ` +
        'has finished, or stop it first: the agent would work on files the command is changing.';
}

export class WorkingCopyLock {
  private readonly held = new Set<WorkingCopyHolder>();

  /** The holder of the other kind whose folders overlap these, or `null`. */
  conflictFor(kind: WorkingCopyHolderKind, folders: readonly string[]): WorkingCopyHolder | null {
    for (const holder of this.held) {
      if (holder.kind === kind) {
        continue;
      }
      if (holder.folders.some((theirs) => folders.some((ours) => foldersOverlap(theirs, ours)))) {
        return holder;
      }
    }
    return null;
  }

  /** Take the lock for this work, or say who holds it. `release` is idempotent. */
  claim(holder: WorkingCopyHolder): WorkingCopyClaim {
    const conflict = this.conflictFor(holder.kind, holder.folders);
    if (conflict !== null) {
      return { ok: false, holder: conflict, reason: describeWorkingCopyRefusal(holder.kind, conflict) };
    }
    this.held.add(holder);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (!released) {
          this.held.delete(holder);
        }
        released = true;
      },
    };
  }

  /** Everything holding the lock now, for a test or a diagnostic. */
  holders(): readonly WorkingCopyHolder[] {
    return [...this.held];
  }
}

/** The process-wide lock the project host uses. Tests make their own. */
export const WORKING_COPY_LOCK = new WorkingCopyLock();
