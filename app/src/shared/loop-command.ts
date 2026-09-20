/**
 * Where the command that checks a project came from, and whether it may run.
 *
 * DSP-45. The rule the product keeps is that **the exit code is DSpatch's own
 * observation rather than an agent's claim**, and that rule constrains *who runs* a
 * command — not who types it. So an agent may work out a command and propose it while
 * DSpatch still spawns it, still waits for it and still reads the code it exits with.
 * Nothing about the evidence weakens.
 *
 * Three sources, one field, one moment of truth:
 *
 * 1. DSpatch's own suggestion from the project (`suggestBuildCommand`).
 * 2. What the user typed — in the field, or in the conversation.
 * 3. What a step of the run worked out by looking at the project.
 *
 * ## The containment is provenance, and it is deliberately not a danger list
 *
 * DSpatch does not judge a command's content. `command-start.ts` already carries this
 * project's argument that half a shell parser is worse than none, and the argument is
 * stronger here: an incomplete list of dangerous commands that *passes* reads as DSpatch
 * having checked, and it will be incomplete. There is no list in this module and none
 * should be added to it.
 *
 * What replaces it is one rule — **a command DSpatch never showed the user never runs** —
 * expressed as {@link mayRunCommandOffer}. A rule is auditable and does not age; a list
 * of names ages the day it is written.
 *
 * `unrunnableScript` in `command-start.ts` is not an exception to this. It refuses a bare
 * `.ps1` on **runnability** — the shell accepts it and either returns 0 having executed
 * nothing or never returns — and it says nothing whatever about danger. It must not be
 * grown into a danger list.
 *
 * ## One confirmation, even when the run is autonomous
 *
 * Decision D3 of run `20260918-171500-shape`, taken in Niclas's absence and his to
 * reverse: a command a *step* proposed needs one confirmation before its first run, even
 * in autonomous mode. Autonomy is a standing answer about who decides the next **step**,
 * not consent to spawn a command nobody has read.
 *
 * It is one predicate — {@link commandNeedsConfirmation} — precisely so that reversing
 * D3 is an edit to one function rather than a design change to shipped behaviour.
 */

/** Which of the three sources an offer came from. DSP-45 #4's vocabulary. */
export type CommandProvenance =
  /** DSpatch worked it out from the project when it opened, and the field shows it. */
  | 'dspatch-suggestion'
  /** The user's own words — typed into the field, or given in the conversation. */
  | 'user'
  /** A named step of this run worked it out by looking at the project. */
  | 'step-proposal';

/**
 * Where within "the user" a command came from, when that is worth saying.
 *
 * DSP-45 #3 is about a command given in the conversation being used without retyping,
 * and a record that could not tell that from a command typed into the field would be
 * unable to show that the criterion was met.
 */
export type UserCommandSource = 'field' | 'conversation';

/** A command DSpatch might run, with everything that decides whether it may. */
export interface CommandOffer {
  /** The command line as it would be handed to the shell. */
  readonly command: string;
  readonly cwd: string;
  readonly provenance: CommandProvenance;
  /** For `user`, which way they gave it. `null` for the other two. */
  readonly userSource: UserCommandSource | null;
  /** The node that proposed it, for `step-proposal`. `null` otherwise. */
  readonly proposedByNodeId: string | null;
  /**
   * The user has been shown **this** command and said to run it.
   *
   * Meaningful only for a `step-proposal`: the other two are in the window's own field
   * before Send is pressed, so they are seen by construction rather than by a flag.
   */
  readonly confirmed: boolean;
  /** The user changed the proposal before confirming it. Recorded, never inferred. */
  readonly editedByUser: boolean;
}

export function suggestionOffer(command: string, cwd: string): CommandOffer {
  return {
    command,
    cwd,
    provenance: 'dspatch-suggestion',
    userSource: null,
    proposedByNodeId: null,
    confirmed: false,
    editedByUser: false,
  };
}

export function userOffer(
  command: string,
  cwd: string,
  source: UserCommandSource,
): CommandOffer {
  return {
    command,
    cwd,
    provenance: 'user',
    userSource: source,
    proposedByNodeId: null,
    confirmed: false,
    editedByUser: false,
  };
}

export function proposalOffer(
  command: string,
  cwd: string,
  nodeId: string,
): CommandOffer {
  return {
    command,
    cwd,
    provenance: 'step-proposal',
    userSource: null,
    proposedByNodeId: nodeId,
    confirmed: false,
    editedByUser: false,
  };
}

/**
 * The offer as the user confirmed it, which is not always the offer as it was made.
 *
 * The field is editable on purpose — *the user can see and change what will be run before
 * it runs* is the constraint the whole design is built on — so the confirmed command is
 * whatever the field held when they pressed the button, and `editedByUser` records
 * whether that differs from what the step proposed.
 */
export function confirmedOffer(
  offer: CommandOffer,
  confirmed: { readonly command: string; readonly cwd: string },
): CommandOffer {
  return {
    ...offer,
    command: confirmed.command,
    cwd: confirmed.cwd,
    confirmed: true,
    editedByUser:
      confirmed.command.trim() !== offer.command.trim() || confirmed.cwd.trim() !== offer.cwd.trim(),
  };
}

/**
 * **The one predicate that decides whether a proposed command waits for a person.**
 *
 * D3. Deliberately independent of the loop mode: an autonomous run does not get to spawn
 * a command nobody has read, because autonomy answers *who decides the next step* and not
 * *what may be executed unseen*.
 *
 * If Niclas reverses D3, this function is the whole of the change: give it the run's
 * {@link import('./loop-control').LoopMode} and return `false` for `autonomous`. Nothing
 * else in the product needs to move, which is why the rule is here and not spread across
 * the handler that happens to ask it.
 */
export function commandNeedsConfirmation(offer: CommandOffer): boolean {
  return offer.provenance === 'step-proposal' && !offer.confirmed;
}

export type CommandRunDecision =
  | { readonly ok: true; readonly why: string }
  | { readonly ok: false; readonly why: string };

/**
 * May DSpatch spawn this, on provenance alone.
 *
 * **Not a judgement about the command.** It says nothing about what the command does,
 * whether it is the right one, or whether it is safe — those are the user's to judge, and
 * a product that pretended otherwise would be claiming a check it had not made. It
 * answers one question: has the person had the chance to see this exact command.
 *
 * `checkRunRequest` in `test-command.ts` is the separate question of whether the command
 * *can* run at all, and both have to pass. One is about provenance and one is about
 * runnability, and merging them would produce a refusal whose reason nobody could read.
 */
export function mayRunCommandOffer(offer: CommandOffer): CommandRunDecision {
  if (!commandNeedsConfirmation(offer)) {
    return { ok: true, why: describeCommandProvenance(offer) };
  }
  return {
    ok: false,
    why:
      `"${offer.proposedByNodeId ?? 'a step of this run'}" worked this command out by looking ` +
      `at the project, and you have not seen it yet, so DSpatch did not run it. A command ` +
      `DSpatch has not shown you never runs — that is the rule, and it holds however the run ` +
      `is set, because letting the loop decide the next step is not the same as letting it ` +
      `start something you have not read.`,
  };
}

/** What happened at the door: the spawn ran and returned `result`, or it was never called. */
export type CommandRunAttempt<T> =
  | { readonly ran: true; readonly result: T }
  | { readonly ran: false; readonly why: string };

/**
 * **The door.** Spawn for this offer, or do not spawn at all.
 *
 * This exists because {@link mayRunCommandOffer} returning `false` only contains anything
 * if every caller asks it, and "every caller asks it" is a property of prose. The handler
 * did ask it, correctly, and `loop-chat.test.ts` asserts that the question appears in
 * `main.ts` — but a source-text assertion is evidence about a file, not about behaviour,
 * and the next handler to want a command has to remember a rule rather than pass through
 * a function that enforces it.
 *
 * So the rule is attacked from a second direction: the spawn is a parameter, and the only
 * way to reach it with an offer is through here. A caller that forgets the predicate no
 * longer gets an unchecked spawn — it gets `ran: false` and a sentence — and a test can
 * establish that by counting how many times the spawn was called rather than by reading
 * source. Nothing about the first direction is removed; two independent things now have to
 * fail before an unseen command runs.
 *
 * `T` is deliberately unconstrained: this module must not know what running a command
 * produces, or it would acquire an opinion about the result and the whole point is that
 * DSpatch's own observation of the exit code is untouched by anything here.
 */
export async function runCommandOffer<T>(
  offer: CommandOffer,
  spawn: (command: string, cwd: string) => Promise<T>,
): Promise<CommandRunAttempt<T>> {
  const may = mayRunCommandOffer(offer);
  if (!may.ok) {
    return { ran: false, why: may.why };
  }
  return { ran: true, result: await spawn(offer.command, offer.cwd) };
}

/**
 * Where the command came from, in the user's terms, for the record and the window.
 *
 * DSP-45 #4 asks the saved record to say this. Written once here so the chat column, the
 * record and the ending sentence cannot word the same fact three ways.
 */
export function describeCommandProvenance(offer: CommandOffer): string {
  switch (offer.provenance) {
    case 'dspatch-suggestion':
      return (
        'DSpatch suggested this command itself when the project was opened, by recognising ' +
        'how projects of this kind are usually built, and the Command field has shown it ' +
        'since. It is a starting point rather than a decision: you can change it.'
      );
    case 'user':
      return offer.userSource === 'conversation'
        ? 'You gave this command in the conversation, and DSpatch used it as you wrote it ' +
            'rather than asking you to type it into the field again.'
        : 'You put this command in the Command field yourself.';
    case 'step-proposal': {
      const by = offer.proposedByNodeId ?? 'a step of this run';
      if (!offer.confirmed) {
        return (
          `"${by}" proposed this command after reading the project. You have not confirmed ` +
          `it, so DSpatch did not run it.`
        );
      }
      return offer.editedByUser
        ? `"${by}" proposed a command after reading the project, you changed it, and DSpatch ` +
            `ran what you left in the field.`
        : `"${by}" proposed this command after reading the project, DSpatch showed it to you ` +
            `before running anything, and you confirmed it. DSpatch started it and read the ` +
            `exit code itself — the step that proposed it did not run it and did not report ` +
            `whether it passed.`;
    }
  }
}

/**
 * The three fields a run record keeps about where a command came from.
 *
 * A reduction of {@link CommandOffer} rather than the offer itself: `confirmed` and
 * `editedByUser` are inputs to a decision that has already been taken by the time
 * anything is written down, and a record carrying them would invite a later reader to
 * re-take it from stale data. What survives is the source, the step responsible when there
 * was one, and the sentence — which is the thing DSP-45 #4 actually asks for.
 */
export interface CommandProvenanceRecord {
  readonly provenance: CommandProvenance;
  readonly proposedByNodeId: string | null;
  readonly note: string;
}

export function provenanceRecordFor(offer: CommandOffer): CommandProvenanceRecord {
  return {
    provenance: offer.provenance,
    proposedByNodeId: offer.proposedByNodeId,
    note: describeCommandProvenance(offer),
  };
}

/* ------------------------------------------------------------------------- */
/* What a step proposed, read from what it wrote                              */
/* ------------------------------------------------------------------------- */

/** The token the role asks for, on the first line, followed by the command. */
export const COMMAND_PROPOSAL_TOKEN = 'COMMAND:';

/** The token for the honest answer that there is no check to run. */
export const NO_COMMAND_TOKEN = 'NO_COMMAND';

export type CommandProposal =
  /** A command line to put in the field. Never run from here. */
  | { readonly kind: 'command'; readonly command: string }
  /** The step looked and there is no check it could identify. A verdict, not a fault. */
  | { readonly kind: 'none' }
  /** The step replied and neither token opened it, so there is nothing to put in the field. */
  | { readonly kind: 'unreadable' };

/**
 * What the step proposed, read from how its reply opens.
 *
 * Deliberately close to `declaredFailureFrom`'s discipline — the decision is the opening
 * of the reply, not a search of the whole of it — with **one difference that is argued
 * rather than inherited**. That function refuses to look past a code fence, because a
 * fenced reply is most likely one quoting the instruction back and the cheap error there
 * is to miss a declaration. Here a leading fence marker is skipped, for two reasons:
 *
 * - `COMMAND:` is not an English word. `blocked` is, which is the whole of DSP-47; there
 *   is no ordinary sentence that opens with this token by accident.
 * - The expensive direction is reversed. A missed proposal ends the run having checked
 *   nothing, which is the state this card exists to remove. A false proposal is *shown to
 *   the user for confirmation before anything runs*, so the cost of reading one too
 *   eagerly is a sentence they decline — and they cannot be shown a command that was
 *   never in the reply, because the command is taken from the reply verbatim.
 *
 * Nothing here decides whether the command may run. That is {@link mayRunCommandOffer},
 * and it is a separate function so that neither question can quietly answer the other.
 */
export function proposedCommandFrom(text: string): CommandProposal {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    // A fence marker and nothing else: a formatting artifact around the answer, which is
    // what a model that was shown the form inside a fence will emit. Any other fenced
    // content still ends the search on the next line, so this skips decoration and not
    // prose.
    if (/^`{3,}[A-Za-z0-9_-]*$/.test(line)) {
      continue;
    }
    const opening = line.replace(/^[*_\s]+/, '');
    if (opening.startsWith(COMMAND_PROPOSAL_TOKEN)) {
      const command = stripWrappingBackticks(
        opening.slice(COMMAND_PROPOSAL_TOKEN.length).trim(),
      );
      // A token with nothing after it is not a proposal. Treated as unreadable rather
      // than as an empty command, which `checkRunRequest` would refuse a step later with
      // a message about the field the user never filled in.
      return command === '' ? { kind: 'unreadable' } : { kind: 'command', command };
    }
    if (
      opening.startsWith(NO_COMMAND_TOKEN) &&
      !/^\w/.test(opening.slice(NO_COMMAND_TOKEN.length))
    ) {
      return { kind: 'none' };
    }
    return { kind: 'unreadable' };
  }
  return { kind: 'unreadable' };
}

/** `` `npm test` `` is a command wearing Markdown. One pair only, and only a matched one. */
function stripWrappingBackticks(value: string): string {
  const match = /^`+(.*?)`+$/s.exec(value);
  return match === null ? value : (match[1] as string).trim();
}

/* ------------------------------------------------------------------------- */
/* The step's branch                                                          */
/* ------------------------------------------------------------------------- */

/**
 * The two names a check-choosing step declares.
 *
 * DSP-45 #6: *choosing the check is a visible step of the loop with its own record, not a
 * derivation hidden inside the run.* A node that declares both of these is that step, and
 * the branch it takes is in the drawing and in `edgesTaken` like every other branch.
 */
export const COMMAND_PROPOSED_OUTCOME = 'command-proposed';
export const NO_COMMAND_OUTCOME = 'no-command';

/**
 * Which branch a check-choosing step takes, or `null` when this node is not one.
 *
 * Declaration-gated in exactly the way `measuredWorkOutcome` and `notVerifiedOutcome` are,
 * and for the same reason: a node that draws neither name must keep finishing on plain
 * success, or every graph written before today would fault with `undeclared-product`.
 * Both names are required, not either — a node drawing only one would have a verdict with
 * nowhere to go half the time, and `loadLoopGraph` cannot catch a name that is absent.
 */
export function proposedCommandOutcome(
  declared: readonly string[],
  proposal: CommandProposal,
): { readonly outcome: string; readonly why: string } | null {
  if (!declared.includes(COMMAND_PROPOSED_OUTCOME) || !declared.includes(NO_COMMAND_OUTCOME)) {
    return null;
  }
  switch (proposal.kind) {
    case 'command':
      return {
        outcome: COMMAND_PROPOSED_OUTCOME,
        why:
          `This step read the project and proposed one command for DSpatch to run: ` +
          `${proposal.command}. Nothing has run yet. The command goes into the Command ` +
          `field, where it can be read and changed, and DSpatch starts it and reads its ` +
          `exit code itself — the step that proposed it does not run it and does not say ` +
          `whether it passed.`,
      };
    case 'none':
      return {
        outcome: NO_COMMAND_OUTCOME,
        why:
          `This step read the project and reported that there is no check it could ` +
          `identify, so DSpatch has no command to run. That is a verdict about the ` +
          `project and not a fault: nothing was run, and nothing about whether the ` +
          `project builds or its tests pass is known. What it looked at is in its reply.`,
      };
    case 'unreadable':
      return {
        outcome: NO_COMMAND_OUTCOME,
        why:
          `This step was asked to open its reply with a command to run or with ` +
          `${NO_COMMAND_TOKEN}, and it did neither, so DSpatch has no command from it. ` +
          `Its reply is in the conversation and may well say something useful; what it ` +
          `does not contain is a command in the form DSpatch reads, and DSpatch will not ` +
          `guess one out of prose. Nothing was run.`,
      };
  }
}
