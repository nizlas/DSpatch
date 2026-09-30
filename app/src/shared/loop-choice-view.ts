/**
 * How a window says which loop the next mandate will use.
 *
 * DSP-84. Niclas opened a definition in the editor, pressed `Use loop`, and something
 * else ran under a view that changed graph. Three of the things that went wrong there
 * are wording rather than wiring: nothing said which loop was selected, nothing said
 * that opening is not choosing, and nothing said that the file on disk — not the
 * drawing in the window — is what a run reads.
 *
 * So the sentences live here, pure and shared, rather than in the two components that
 * would otherwise word the same state differently. The editor and the chat are looking
 * at one selection; they must not be able to describe it in two ways.
 *
 * DSP-85 removed the second and third of those sentences by removing what they were
 * about. Choosing and drawing are one act now: the graph editor's dropdown *is* the
 * selection, so there is no longer an opened-but-unchosen definition to explain and no
 * `Use this loop` to describe. What is left is the wording for the two things a
 * dropdown cannot say by itself — that a choice took and started nothing, and that a
 * choice was refused and the previous one stands.
 *
 * Nothing here decides anything. Every function takes the state and returns text.
 */

import type { LoopDefinitionListing, OpenedLoopDefinition } from './bridge';

/** The definition a window believes the next mandate will walk. */
export interface NextMandateLoop {
  /** The declaration file, which is the selection key everywhere else too. */
  readonly key: string;
  readonly name: string;
}

/**
 * Read the next mandate's loop out of the list, rather than out of a second variable.
 *
 * This is the "one source" constraint made into a function. The editor has no selection
 * of its own and asks the main process for the list; the chat has the key its own
 * `<select>` is showing. Both end up here, and both end up naming a row of the one
 * list — so the two windows cannot hold different answers about which loop is next.
 *
 * `key` is the caller's current selection when it has one. Falling back to the row the
 * listing marks `preselected` is not a guess: that flag is `defaultChoiceFrom`'s answer
 * including the workspace's remembered key, which is the same answer a mandate sent
 * with no explicit key would resolve.
 */
export function nextMandateLoopFrom(
  listing: LoopDefinitionListing | null,
  key: string | null = null,
): NextMandateLoop | null {
  if (listing === null) {
    return null;
  }
  const row =
    (key === null ? undefined : listing.choices.find((choice) => choice.key === key)) ??
    listing.choices.find((choice) => choice.preselected);
  return row === undefined ? null : { key: row.key, name: row.display.name };
}

/*
 * There is no `describeNextMandateLoop` any more (DSP-87).
 *
 * DSP-84 added it for a sentence under the chat's composer naming the loop and its
 * declaration path. DSP-85 then moved the choosing into the graph editor's header,
 * where the chooser shows that name permanently and as a control — so the sentence
 * became a paragraph repeating a dropdown in another window, under a box whose
 * business is the message being typed now. The chat was its only caller.
 *
 * {@link nextMandateLoopFrom} above stays: reading the selection out of the one list
 * is the constraint DSP-84 was really about, and the editor uses it.
 */

/**
 * The hover on the editor's loop chooser.
 *
 * It has to say the two things a dropdown full of names does not: that picking one
 * both draws it and makes it what runs, and that neither of those starts anything.
 * Since DSP-85 this control is the only way to choose a loop, so it is also the only
 * place those two facts can be read.
 */
export function describeLoopChooser(): string {
  return (
    'Which loop the next mandate walks. Picking one draws it here and selects it for ' +
    'running, in one act. It starts nothing: a run begins when a mandate is sent with ' +
    'Use loop ticked.'
  );
}

/**
 * What the window says once a definition has been chosen and drawn.
 *
 * `runInProgress` carries DSP-84 #7: a run already walking holds the definition and
 * version it started with, so a choice made now is about the next one and says so
 * rather than looking as though it took effect.
 *
 * `unsaved` is what became of a drawing that was in the window, edited and not saved,
 * when the person picked a different loop — and **DSP-88 changed it from a statement into
 * a report**. DSP-85 wrote *your unsaved changes left the window with it; the file on disk
 * is unchanged and was never written*, which was accurate and was the defect: the window
 * announced the loss after causing it. Choosing now asks Save, Discard changes or Cancel
 * before anything switches, so by the time this sentence is written the person has
 * answered and the answer is what it reports. `null` when there was no unsaved drawing.
 */
export function describeChoiceMade(input: {
  readonly name: string;
  readonly runInProgress: boolean;
  readonly unsaved: {
    readonly displayPath: string;
    readonly answer: 'save' | 'discard';
  } | null;
}): string {
  const head = `"${input.name}" is now the loop the next mandate will use, and it is on the canvas. Nothing was started.`;
  const running = input.runInProgress
    ? ' A run is walking now and keeps the definition and version it started with, so ' +
      'this applies to the next run.'
    : '';
  const unsaved =
    input.unsaved === null
      ? ''
      : input.unsaved.answer === 'save'
        ? ` Your changes to ${input.unsaved.displayPath} were saved first, as you asked, ` +
          `so nothing was lost when the canvas changed.`
        : // Named as a thing the person did, because they did it: they were asked and they
          // answered Discard changes. The file is still worth naming — it is the one that
          // was *not* written, and a reader a minute later may want to be sure of that.
          ` You chose to discard your unsaved changes to ${input.unsaved.displayPath}, so ` +
          `they are gone and the file on disk was never written.`;
  return `${head}${running}${unsaved}`;
}

/**
 * What the window says when a definition cannot be selected.
 *
 * `note` is the main process's own sentence, passed through rather than reworded: the
 * reasons a loop cannot run are written where a run refuses one, and a second
 * vocabulary here is how a person ends up with two accounts of one file. Since DSP-85
 * the caller is a dropdown, so what arrives is `judgeChosenLoop`'s **brief** — a
 * fifteen-line finding list is not something that belongs beside a chooser, and the
 * full list is in the editor where a person reads a file.
 *
 * The second half is the part DSP-84 #5 is really about, and DSP-85 #8 repeats it. A
 * refusal that only explained the broken definition would leave the person to assume
 * something had been selected; this states that nothing changed and names what the next
 * mandate still walks, so there is no room for a silent fall back to another loop.
 */
export function describeChoiceRefused(input: {
  readonly note: string;
  readonly stillChosen: NextMandateLoop | null;
}): string {
  const unchanged =
    input.stillChosen === null
      ? 'Nothing was selected, and no loop is selected for the next mandate.'
      : `Nothing was selected. The next mandate still walks "${input.stillChosen.name}".`;
  return `${input.note}\n\n${unchanged}`;
}

/**
 * The standing line while the selected loop is open with unsaved edits.
 *
 * Separate from {@link describeChoiceMade} because the two answer different questions.
 * That one is about a press; this one is about a window that has been sitting there for
 * ten minutes with an edited drawing and a `Use loop` tick. `null` when there is
 * nothing to say.
 *
 * **DSP-86 turned this from a warning into a statement of what will happen.** It used
 * to read *the next run reads the file as saved on disk, not the drawing in this
 * window*, which was true and left the person holding the problem: the only way to
 * avoid running an older version was to remember this line and press Save. Starting a
 * run now asks — save these edits and run them, or cancel — so the honest sentence is
 * the one that says so. A run can no longer walk an older version of the drawing in
 * front of you without being told to.
 *
 * **DSP-88 extended the promise to the other three ways in.** Choosing another loop,
 * **Open loop…** and **File → Open Graph File…** each draw over this canvas and each now
 * asks first. One clause covers all four, because a person reading a standing line wants
 * to know whether their work is safe, not an inventory of the controls that respect it.
 */
export function describeUnsavedAgainstChoice(input: {
  readonly definition: OpenedLoopDefinition | null;
  readonly chosenKey: string | null;
  readonly dirty: boolean;
  readonly graphDisplayPath: string;
}): string | null {
  if (!input.dirty || input.definition === null || input.definition.path !== input.chosenKey) {
    return null;
  }
  return (
    `Unsaved changes to ${input.graphDisplayPath}, which is the file a run reads. Starting a ` +
    `run, choosing another loop or opening another drawing will ask what to do with them ` +
    `first; nothing runs an older version of this drawing, or throws it away, without you ` +
    `saying so.`
  );
}
