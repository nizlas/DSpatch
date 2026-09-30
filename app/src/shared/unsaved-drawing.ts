/**
 * The one question DSpatch asks about a drawing it is about to lose.
 *
 * DSP-86 built it for the start of a run: the editor registers its unsaved drawing with
 * the main process, and a run that would read that same file from disk stops and asks
 * *save these edits and run them, or cancel* rather than quietly walking the older
 * version. DSP-88 found the other half of the same hazard. Choosing another loop in the
 * editor's dropdown, opening a definition through **Open loop...** and opening a graph
 * through **File > Open Graph File...** all draw something else over the canvas, and all
 * three used to *state* that the drawing had never been written and then discard it
 * anyway. Informing is not preserving.
 *
 * So the question is here, as text, with one caller per occasion. It could have stayed
 * inline in `main.ts`, where DSP-86 left it, but two dialogues about one fact is how a
 * person ends up with two vocabularies for one situation, and the switch's question is
 * the run's question plus one button. Holding it in one function is what makes that a
 * fact rather than an intention, and it is what lets the buttons and the default be
 * tested without a window: a native message box cannot be driven from a renderer, so a
 * walk can provoke this dialog and answer it but can never read its wording.
 *
 * **It decides nothing and writes nothing.** It takes the drawing and the occasion and
 * returns what to put on screen.
 */

/**
 * Why the question is being asked.
 *
 * `run` is DSP-86's: a run is about to read the file this drawing is not in yet, so the
 * choice is between walking the drawing and starting nothing. There is no third answer,
 * because discarding the edits and running the file behind them is not something a
 * person would mean by pressing one button in a dialog they did not ask for.
 *
 * `switch` is DSP-88's: the canvas is about to be drawn with something else, so what is
 * at stake is the drawing rather than what runs. Here *discard* is a real answer, since a
 * half-finished experiment a person wants rid of is ordinary, and it is the only thing
 * this question has that the run's does not.
 */
export type UnsavedDrawingOccasion = 'run' | 'switch';

/** What the person answered. `discard` is only ever offered for a switch. */
export type UnsavedDrawingAnswer = 'save' | 'discard' | 'cancel';

/**
 * What the dialog shows, and what each of its buttons means.
 *
 * `answers` runs parallel to `buttons`, so the caller reads the response index straight
 * out of it instead of matching on a label. A button list and a separate decision about
 * which index means what are two statements of one mapping, and the one that drifts is
 * the one that destroys a file.
 */
export interface UnsavedDrawingQuestion {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly answers: readonly UnsavedDrawingAnswer[];
  /** Also the default button: a mis-pressed dialog must not be the one that writes. */
  readonly cancelId: number;
}

/**
 * The question, for one drawing and one occasion.
 *
 * Cancel is last, is the default and is the escape key's answer, in both shapes. DSP-86
 * chose that for the run because the destructive reading of a mis-pressed dialog is the
 * one that writes a file. For a switch there are now two destructive readings, writing a
 * file and throwing a drawing away, which makes the same choice more clearly right rather
 * than less.
 */
export function describeUnsavedDrawingQuestion(input: {
  /** The graph file, which is what a run reads and what Save writes. */
  readonly path: string;
  /** For the person. A path alone does not say which loop this is. */
  readonly graphName: string;
  readonly occasion: UnsavedDrawingOccasion;
}): UnsavedDrawingQuestion {
  if (input.occasion === 'run') {
    return {
      title: 'Unsaved changes to the loop that is about to run',
      message: `Save your changes to "${input.graphName}" and run them?`,
      detail:
        `A run reads ${input.path} from disk, and the drawing in the loop editor has ` +
        `changes that are not in that file yet.\n\n` +
        `Save and run writes those changes and walks them. Cancel starts nothing and ` +
        `leaves both the file and your drawing exactly as they are.`,
      buttons: ['Save and run', 'Cancel'],
      answers: ['save', 'cancel'],
      cancelId: 1,
    };
  }
  return {
    title: 'Unsaved changes to the drawing on screen',
    message: `Save your changes to "${input.graphName}" before drawing something else?`,
    detail:
      `The loop editor is holding changes to ${input.path} that are not in that file ` +
      `yet, and the canvas is about to be drawn with something else.\n\n` +
      `Save writes those changes and then switches. Discard changes switches without ` +
      `writing, and your edits are gone. Cancel switches nothing and leaves the file, ` +
      `your drawing and the loop selected for the next run exactly as they are.`,
    buttons: ['Save', 'Discard changes', 'Cancel'],
    answers: ['save', 'discard', 'cancel'],
    cancelId: 2,
  };
}

/**
 * What the window says when a switch was cancelled at the question above.
 *
 * Here rather than in the renderer because the main process is the only thing that knows
 * what it did: it asked, it was told to keep the drawing, and it stopped before recording
 * a choice or redrawing anything. A sentence assembled in the window out of its own
 * `dirty` flag would be a second account of an event it did not witness.
 *
 * Both halves, because both are what a person needs: the drawing is still here and still
 * unsaved, and the selection did not move. A cancel that said only "nothing happened"
 * would leave open the question this card is about.
 */
export function describeSwitchKept(path: string): string {
  return (
    `Nothing was switched. The loop editor is holding unsaved changes to ${path}, and you ` +
    `chose to keep them, so your drawing is still on the canvas and the loop selected for ` +
    `the next run has not moved. Save in the editor, or choose again and answer Save or ` +
    `Discard changes.`
  );
}
