/**
 * DSP-209 S11: messages between the branches of one fan-out visit.
 *
 * The vision's *communication during execution*: a message names its sender, recipient and
 * purpose; delivery and the recipient's acknowledgement are separate events; a proposed
 * contract change is not binding when sent; nothing waits without bound; a branch is never
 * restarted because a message arrives; and messages carry a revision reference.
 *
 * One mailbox per fan-out visit, in memory, recorded through the run's journal. **Delivery
 * happens only when the recipient calls `check`** (mission decision 23; Q3 stays open):
 * nothing is pushed into a running turn, and there is no wait. Every call returns at once.
 * Pure: the runner hands in how to journal and how to take the person's instructions.
 */

/** The longest body a message may have, in characters. */
export const MAX_MESSAGE_BODY = 4_000;
/** How many messages one branch may send in one fan-out visit. */
export const MAX_MESSAGES_PER_BRANCH = 20;

export const MESSAGE_PURPOSES = ['finding', 'question', 'contract-change', 'instruction'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

/** Who a message is from: a slice id, or the person. */
export const FROM_THE_PERSON = 'the person';

export interface MailboxMessage {
  readonly id: string;
  readonly from: string;
  /** A slice id, `all` (every other running branch) or `integrator`. */
  readonly to: string;
  readonly purpose: MessagePurpose;
  readonly body: string;
  readonly contractRef: string | null;
  readonly critical: boolean;
  /** The sender's revision: its base commit and branch, or `null` for the person. */
  readonly base: string | null;
  readonly branch: string | null;
  /** The branches it is addressed to, fixed when it is sent. Empty for `integrator`. */
  readonly recipients: readonly string[];
}

export type JournalPost = (
  kind: 'message-sent' | 'message-delivered' | 'message-acknowledged' | 'message-undelivered',
  detail: string,
  data: Readonly<Record<string, string | number | boolean>>,
) => void;

/** What one branch may do with the mailbox. Every call returns at once. */
export interface MailboxPort {
  send(input: {
    readonly to: string;
    readonly purpose: string;
    readonly body: string;
    readonly contractRef?: string | null;
    readonly critical?: boolean;
  }): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: string };
  /** The undelivered messages for this branch, now marked delivered to it. */
  check(): readonly MailboxMessage[];
  acknowledge(id: string): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

export interface RunMailbox {
  /** The port for one branch, bound to its slice and its revision. */
  portFor(sliceId: string, revision: { readonly base: string | null; readonly branch: string | null }): MailboxPort;
  /** This branch has started; it can now receive. */
  branchStarted(sliceId: string): void;
  /** This branch has ended: what it never checked is recorded undelivered, and it receives nothing more. */
  branchEnded(sliceId: string): void;
  /** Every message, in the order sent. */
  messages(): readonly MailboxMessage[];
  /** Messages the integrator must resolve or reject: contract changes and messages to `integrator`. */
  openProposals(): readonly MailboxMessage[];
  /** Counts for the run view. */
  counts(): { readonly sent: number; readonly delivered: number; readonly acknowledged: number; readonly undelivered: number };
}

export function createRunMailbox(input: {
  readonly visitId: string;
  readonly sliceIds: readonly string[];
  readonly post: JournalPost;
  /** The person's instructions to the run that have arrived since the last ask; none when left out. */
  readonly takeInstructions?: () => readonly { readonly id: string; readonly text: string }[];
}): RunMailbox {
  const known = new Set(input.sliceIds);
  const running = new Set<string>();
  const ended = new Set<string>();
  const all: MailboxMessage[] = [];
  const delivered = new Map<string, Set<string>>();
  const acknowledged = new Map<string, Set<string>>();
  const sentBy = new Map<string, number>();
  let undeliveredCount = 0;
  let sequence = 0;

  const deliveredTo = (id: string): Set<string> => {
    const set = delivered.get(id) ?? new Set<string>();
    delivered.set(id, set);
    return set;
  };

  const record = (message: MailboxMessage): void => {
    all.push(message);
    input.post(
      'message-sent',
      `${message.from === FROM_THE_PERSON ? 'The person' : `Branch "${message.from}"`} sent a ${message.purpose} to ` +
        `${message.to === 'all' ? 'every running branch' : message.to === 'integrator' ? 'the integrator' : `branch "${message.to}"`}` +
        `${message.critical ? ' (critical)' : ''}. It is delivered when the recipient next checks its messages.`,
      {
        messageId: message.id,
        from: message.from,
        to: message.to,
        purpose: message.purpose,
        body: message.body,
        critical: message.critical,
        recipients: message.recipients.join(', '),
        ...(message.contractRef === null ? {} : { contractRef: message.contractRef }),
        ...(message.base === null ? {} : { base: message.base }),
        ...(message.branch === null ? {} : { branch: message.branch }),
      },
    );
  };

  // The person's instructions become messages to every branch that has not ended when they are
  // taken — running ones, and slices still waiting for a free place — never to one that ended.
  const takeInstructions = (): void => {
    for (const instruction of input.takeInstructions?.() ?? []) {
      sequence += 1;
      record({
        id: `${input.visitId}/m${String(sequence)}`,
        from: FROM_THE_PERSON,
        to: 'all',
        purpose: 'instruction',
        body: instruction.text,
        contractRef: null,
        critical: false,
        base: null,
        branch: null,
        recipients: [...known].filter((id) => !ended.has(id)),
      });
    }
  };

  return {
    portFor(sliceId, revision) {
      return {
        send(message) {
          const body = message.body.trim();
          if (body === '') {
            return { ok: false, reason: 'A message needs a body.' };
          }
          if (body.length > MAX_MESSAGE_BODY) {
            return { ok: false, reason: `A message body may be at most ${String(MAX_MESSAGE_BODY)} characters; this one has ${String(body.length)}.` };
          }
          if (!(MESSAGE_PURPOSES as readonly string[]).includes(message.purpose)) {
            return { ok: false, reason: `Purpose must be one of ${MESSAGE_PURPOSES.join(', ')}.` };
          }
          const to = message.to.trim();
          if (to !== 'all' && to !== 'integrator' && !known.has(to)) {
            return { ok: false, reason: `There is no branch "${to}" in this fan-out. Send to a slice id, "all" or "integrator".` };
          }
          if (to === sliceId) {
            return { ok: false, reason: 'A branch does not send messages to itself.' };
          }
          const count = sentBy.get(sliceId) ?? 0;
          if (count >= MAX_MESSAGES_PER_BRANCH) {
            return { ok: false, reason: `This branch has sent its ${String(MAX_MESSAGES_PER_BRANCH)} messages for this fan-out.` };
          }
          if (to !== 'all' && to !== 'integrator' && ended.has(to)) {
            // Refused, and recorded, so the sender knows and the run's account shows it.
            undeliveredCount += 1;
            input.post('message-undelivered', `Branch "${sliceId}" sent a message to "${to}", which had already ended, so it was not delivered.`, {
              from: sliceId,
              to,
              purpose: message.purpose,
              body,
              reason: 'recipient-ended',
            });
            return { ok: false, reason: `Branch "${to}" has already ended, so it cannot receive this. It is not restarted for a message.` };
          }
          sentBy.set(sliceId, count + 1);
          sequence += 1;
          const recipients =
            to === 'integrator' ? [] : to === 'all' ? [...known].filter((id) => id !== sliceId && !ended.has(id)) : [to];
          const id = `${input.visitId}/m${String(sequence)}`;
          record({
            id,
            from: sliceId,
            to,
            purpose: message.purpose as MessagePurpose,
            body,
            contractRef: message.contractRef?.trim() || null,
            critical: message.critical === true,
            base: revision.base,
            branch: revision.branch,
            recipients,
          });
          return { ok: true, id };
        },
        check() {
          takeInstructions();
          const now = all.filter((message) => message.recipients.includes(sliceId) && !deliveredTo(message.id).has(sliceId));
          for (const message of now) {
            deliveredTo(message.id).add(sliceId);
            input.post('message-delivered', `Branch "${sliceId}" received ${message.id} from ${message.from === FROM_THE_PERSON ? 'the person' : `"${message.from}"`}.`, {
              messageId: message.id,
              from: message.from,
              to: sliceId,
              purpose: message.purpose,
            });
          }
          return now;
        },
        acknowledge(id) {
          if (!deliveredTo(id).has(sliceId)) {
            return { ok: false, reason: `Message ${id} has not been delivered to this branch.` };
          }
          const acks = acknowledged.get(id) ?? new Set<string>();
          if (acks.has(sliceId)) {
            return { ok: false, reason: `Message ${id} is already acknowledged.` };
          }
          acks.add(sliceId);
          acknowledged.set(id, acks);
          const message = all.find((item) => item.id === id);
          input.post('message-acknowledged', `Branch "${sliceId}" acknowledged ${id}${message === undefined ? '' : ` from ${message.from === FROM_THE_PERSON ? 'the person' : `"${message.from}"`}`}.`, {
            messageId: id,
            by: sliceId,
            ...(message === undefined ? {} : { from: message.from, purpose: message.purpose }),
          });
          return { ok: true };
        },
      };
    },
    branchStarted(sliceId) {
      running.add(sliceId);
    },
    branchEnded(sliceId) {
      if (ended.has(sliceId)) {
        return;
      }
      running.delete(sliceId);
      ended.add(sliceId);
      for (const message of all) {
        if (message.recipients.includes(sliceId) && !deliveredTo(message.id).has(sliceId)) {
          undeliveredCount += 1;
          input.post('message-undelivered', `Branch "${sliceId}" ended without checking ${message.id} from ${message.from === FROM_THE_PERSON ? 'the person' : `"${message.from}"`}, so it was never delivered to it.`, {
            messageId: message.id,
            from: message.from,
            to: sliceId,
            purpose: message.purpose,
            reason: 'recipient-ended-unchecked',
          });
        }
      }
    },
    messages: () => all,
    openProposals: () => all.filter((message) => message.purpose === 'contract-change' || message.to === 'integrator'),
    counts: () => ({
      sent: all.length,
      delivered: [...delivered.values()].reduce((sum, set) => sum + set.size, 0),
      acknowledged: [...acknowledged.values()].reduce((sum, set) => sum + set.size, 0),
      undelivered: undeliveredCount,
    }),
  };
}
