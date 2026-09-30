/**
 * Choosing a loop, and saying which one was chosen.
 *
 * DSP-84. Niclas opened the development loop's declaration in the editor, pressed
 * `Use loop`, and a different loop ran under a view that changed graph. DSP-85 then
 * removed the shape that made it possible: there is no opened-but-unchosen definition any
 * more, because the graph editor's dropdown is the selection and picking a row draws it.
 * The wiring is tested where the wiring is — `main.ts` routes every choice through
 * `judgeChosenLoop` and `noteChosenLoopDefinition`, and a window trial walks it — so what
 * is here is the part that can be stated without a window and that a later change could
 * break silently:
 *
 * **A refusal at the point of choosing is the run's own refusal.** `judgeChosenLoop`
 * exists so that the preview, the chooser and anything later ask one function; a second
 * copy of those three checks is how one file comes to have two accounts of itself. The
 * tests here drive real declarations on disk through it, including a graph that does
 * not validate, and read the sentence.
 *
 * **A refusal beside a dropdown is short, and is the same refusal.** DSP-85 #8. `brief`
 * is `note` with the finding list folded to the first error and a count — not a summary
 * and not a second vocabulary — because DSP-84's window trial put fifteen lines next to a
 * chooser and a reason nobody finishes reading is not a reason.
 *
 * **Nothing falls back to another loop.** The refusal wording has to say that the
 * selection did not move and name what it still is. That is a property of the sentence
 * and is worth a test because it is exactly the sort of clause a later edit drops.
 *
 * **The next mandate's loop is read out of the one list.** `nextMandateLoopFrom` is the
 * "one source" constraint as a function, and since DSP-85 it is also what the editor's
 * `<select>` shows: the dropdown's value is the row the listing marks, not a copy of it
 * the window keeps, so the control cannot drift from what a mandate would resolve.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { judgeChosenLoop } from '../src/main/loop-choice-check';
import { openChosenLoop, listChoosableLoops } from '../src/main/loop-definition-choice';
import { openLoopDefinitionFile } from '../src/main/loop-definition-files';
import type { LoopDefinitionListing } from '../src/shared/bridge';
import {
  describeChoiceMade,
  describeChoiceRefused,
  describeLoopChooser,
  describeUnsavedAgainstChoice,
  nextMandateLoopFrom,
} from '../src/shared/loop-choice-view';
import {
  describeSwitchKept,
  describeUnsavedDrawingQuestion,
} from '../src/shared/unsaved-drawing';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const chatLoopDefinition = path.join(repoRoot, '.dspatch', 'loops', 'dspatch-chat-loop.loop.json');

const temporaries: string[] = [];

after(() => {
  for (const dir of temporaries) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temporaryDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-${label}-`));
  temporaries.push(dir);
  return dir;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

describe('judging a definition at the point of choosing', () => {
  it('accepts DSpatch\u2019s own chat loop and answers with the graph it read', () => {
    const judged = judgeChosenLoop(
      openChosenLoop(openLoopDefinitionFile(chatLoopDefinition)),
      'it was not chosen',
    );
    assert.ok(judged.runnable, 'the chat loop declared in this repository must be choosable');
    assert.equal(judged.chosen.definitionId, 'dspatch-chat-loop');
    // The graph the declaration points at, not the declaration. A choice that recorded
    // the wrong one of those is the whole family of defects this card is in.
    assert.notEqual(judged.chosen.graphPath, chatLoopDefinition);
    assert.ok(judged.chosen.graphPath.endsWith('dspatch-chat-loop.graph.json'));
    assert.equal(judged.graph.id, 'dspatch-chat-loop');
    assert.ok(judged.binding.ready);
  });

  it('refuses a declaration that will not parse, with the file\u2019s own finding', () => {
    const dir = temporaryDir('choice-bad-declaration');
    const file = path.join(dir, 'broken.loop.json');
    write(file, '{ this is not json');

    const judged = judgeChosenLoop(
      openChosenLoop(openLoopDefinitionFile(file)),
      'it was not chosen',
    );
    assert.equal(judged.runnable, false);
    assert.ok(
      judged.runnable === false && judged.note.includes(file),
      'the refusal has to name the file it is about',
    );
  });

  it('refuses a declaration whose graph does not validate, and says so at choosing time', () => {
    const dir = temporaryDir('choice-bad-graph');
    write(
      path.join(dir, 'loop.loop.json'),
      JSON.stringify({
        format: 'dspatch-loop-definition',
        formatVersion: 1,
        id: 'half-drawn',
        name: 'Half a drawing',
        graph: 'graphs/half.graph.json',
      }),
    );
    // An edge to a node that is not there. The row in the list says nothing about this
    // — `bindingRefusalFor` reads the graph for its id alone — so before DSP-84 the
    // person found out only after sending a mandate to it.
    write(
      path.join(dir, 'graphs', 'half.graph.json'),
      JSON.stringify({
        format: 'dspatch-loop-graph',
        formatVersion: 1,
        id: 'half-drawn',
        name: 'Half a drawing',
        // Whole in every other respect, deliberately. A fixture broken in four ways
        // proves only that something was refused; this one is refused for the reason
        // the test is named after, which is what makes the sentence worth reading.
        purpose: 'A drawing with one edge that goes nowhere, for testing the refusal.',
        target: 'cursor',
        entry: 'work',
        onRuntimeFault: 'stop-and-reconcile',
        failureKinds: [],
        nodes: [
          { id: 'work', kind: 'agent', label: 'Work', purpose: 'Do the thing.' },
          { id: 'done', kind: 'terminal', label: 'Done' },
        ],
        edges: [{ id: 'e1', from: 'work', to: 'nowhere-at-all', when: { on: 'success' } }],
      }),
    );

    const judged = judgeChosenLoop(
      openChosenLoop(openLoopDefinitionFile(path.join(dir, 'loop.loop.json'))),
      'it was not chosen',
    );
    assert.equal(judged.runnable, false);
    assert.ok(
      judged.runnable === false &&
        judged.note.includes('Half a drawing') &&
        judged.note.includes('it was not chosen'),
      'the refusal names the loop and what did not happen to it',
    );
    const note = judged.runnable === false ? judged.note : '';
    assert.ok(
      note.includes('nowhere-at-all'),
      'the reason a person can act on is which edge goes nowhere',
    );
    // The real chat loop with one edge redirected produced fifteen lines here, thirteen
    // of them notices about features recorded and not yet honoured. A reason nobody
    // finishes reading is not a reason, so they are counted and left in the editor.
    assert.ok(
      !note.includes('notice:'),
      'a refusal lists what makes it a refusal, not every remark the file attracts',
    );
    assert.ok(
      !note.includes('warning:'),
      'warnings do not stop a run and so do not belong in the sentence saying one was stopped',
    );
    assert.ok(
      note.includes('loop editor'),
      'the findings that were not listed have to be reachable, and the editor is where they are',
    );

    // DSP-85 #8. The same refusal at the length that fits beside a dropdown: the loop, the
    // one error a person can act on, and a count. It is not a different reason — the
    // fifteen-line version was the thing that made the chooser unreadable, not the facts
    // in it — so this asserts that it is shorter and still names the fault.
    const brief = judged.runnable === false ? judged.brief : '';
    assert.ok(brief.length < note.length, 'the brief has to be shorter than what it folds');
    assert.ok(brief.includes('Half a drawing'));
    assert.ok(
      brief.includes('nowhere-at-all'),
      'folding the list must not fold away the fault, which is the only actionable part',
    );
    assert.ok(
      !brief.includes('\n'),
      'a reason beside a dropdown is one line; a finding list there is what DSP-84 measured ' +
        'and what this card removes',
    );
  });

  it('gives the caller its own consequence clause rather than one wording for all', () => {
    const dir = temporaryDir('choice-consequence');
    write(
      path.join(dir, 'loop.loop.json'),
      JSON.stringify({
        format: 'dspatch-loop-definition',
        formatVersion: 1,
        id: 'no-graph-here',
        name: 'Points at nothing',
        graph: 'graphs/absent.graph.json',
      }),
    );
    const outcome = openChosenLoop(openLoopDefinitionFile(path.join(dir, 'loop.loop.json')));
    // An unreadable graph is `openChosenLoop`'s own note, which is deliberately the
    // same whichever caller asked: the file could not be read is not a fact about who
    // was asking.
    const asPreview = judgeChosenLoop(outcome, 'there is nothing to show');
    const asChoice = judgeChosenLoop(outcome, 'it was not chosen');
    assert.equal(asPreview.runnable, false);
    assert.equal(asChoice.runnable, false);
    assert.equal(
      asPreview.runnable === false ? asPreview.note : '',
      asChoice.runnable === false ? asChoice.note : ' different',
    );
    // Nothing to fold down, so the brief is the note rather than a shortened copy of it
    // that a later edit could let drift.
    assert.equal(
      asChoice.runnable === false ? asChoice.brief : '',
      asChoice.runnable === false ? asChoice.note : ' different',
    );
  });
});

describe('what the window says about a choice', () => {
  const definition = { id: 'a-loop', name: 'A loop', path: 'C:\\elsewhere\\a.loop.json' };

  /*
   * DSP-84's three `describeUseThisLoop` tests are gone with the button they were about.
   *
   * They asserted that `Use this loop` was offered for an open definition, refused for the
   * one already selected, and refused for a graph opened directly. The first two describe a
   * state that no longer exists: a definition cannot be open in the editor without being the
   * selection, because picking it in the chooser is what draws it. The third — that a graph
   * with no declaration behind it is not a choosable loop — is still true and still tested,
   * by `describeOpenedGraph` in `loop-graph-open.test.ts` for the wording and by the window
   * trial for the chooser's displayed state, which is where DSP-85 #6 puts it: such a file
   * is drawn without the chooser moving off the loop that was chosen.
   */

  it('says that picking a loop both draws it and selects it, and starts nothing', () => {
    // The only place those two facts can be read, now that the chooser is the only way to
    // choose. A hover that said merely "which loop" would leave a person to discover that
    // picking one redraws the canvas.
    const title = describeLoopChooser();
    assert.ok(title.includes('draws it'));
    assert.ok(title.includes('selects it'));
    assert.ok(title.includes('starts nothing'));
  });

  it('states that choosing drew the loop and started nothing', () => {
    const said = describeChoiceMade({
      name: 'A loop',
      runInProgress: false,
      unsaved: null,
    });
    assert.ok(said.includes('next mandate'));
    assert.ok(
      said.includes('on the canvas'),
      'choosing and drawing are one act in DSP-85, so the sentence about one says the other',
    );
    assert.ok(said.includes('Nothing was started'));
    assert.ok(!said.includes('unsaved'));
  });

  /*
   * DSP-85's single "where the unsaved drawing went" test became these two, and the split
   * is the card rather than a rewording.
   *
   * That test asserted the sentence named the file and said it was *never written*, which
   * was the whole of what DSP-85 could offer: the drawing had already gone by the time
   * anything was said about it. DSP-88 asks first, so there are two outcomes to report and
   * the old assertion is true of exactly one of them. Asserting `never written` for both
   * would now be asserting that Save does not save.
   */
  it('says the drawing was saved first when that is what the person chose', () => {
    const said = describeChoiceMade({
      name: 'A loop',
      runInProgress: false,
      unsaved: { displayPath: 'C:\\elsewhere\\graphs\\previous.graph.json', answer: 'save' },
    });
    assert.ok(said.includes('C:\\elsewhere\\graphs\\previous.graph.json'));
    assert.ok(said.includes('saved'), 'the person pressed Save, so the sentence says it saved');
    assert.ok(
      !said.includes('never written'),
      'the file was written; DSP-85\u2019s clause is the one thing this must not still say',
    );
  });

  it('says the drawing was discarded on the person\u2019s say-so, not that it vanished', () => {
    const said = describeChoiceMade({
      name: 'A loop',
      runInProgress: false,
      unsaved: { displayPath: 'C:\\elsewhere\\graphs\\previous.graph.json', answer: 'discard' },
    });
    assert.ok(said.includes('C:\\elsewhere\\graphs\\previous.graph.json'));
    assert.ok(said.includes('never written'), 'the file really was not written in this case');
    // The difference between DSP-85's behaviour and this one is entirely in who decided,
    // so the sentence has to attribute it. "Your changes left the window" and "you chose
    // to discard your changes" describe the same end state and not the same product.
    assert.match(
      said,
      /You chose to discard/,
      'the loss was answered for, and a sentence that hid that would describe DSP-85',
    );
  });

  it('says a run already walking keeps what it started with', () => {
    const said = describeChoiceMade({
      name: 'A loop',
      runInProgress: true,
      unsaved: null,
    });
    assert.ok(said.includes('applies to the next run'));
  });

  it('warns while the selected loop is open with unsaved edits, and not otherwise', () => {
    assert.equal(
      describeUnsavedAgainstChoice({
        definition,
        chosenKey: definition.path,
        dirty: false,
        graphDisplayPath: 'g.graph.json',
      }),
      null,
      'a saved drawing cannot disagree with the file',
    );
    assert.equal(
      describeUnsavedAgainstChoice({
        definition,
        chosenKey: 'C:\\other\\b.loop.json',
        dirty: true,
        graphDisplayPath: 'g.graph.json',
      }),
      null,
      'editing a loop nobody chose changes nothing about what would run',
    );
    const warned = describeUnsavedAgainstChoice({
      definition,
      chosenKey: definition.path,
      dirty: true,
      graphDisplayPath: 'g.graph.json',
    });
    assert.ok(warned !== null, 'an edited drawing of the chosen loop is worth a standing line');
    assert.match(warned, /g\.graph\.json/, 'the line has to name the file a run reads');
  });

  /*
   * DSP-86 changed what this line is allowed to say, and the change is the point rather
   * than a rewording. DSP-84 wrote *the next run reads the file as saved on disk, not the
   * drawing in this window* — true, and it left the person holding the problem: the only
   * way to avoid walking an older version was to remember the line and press Save.
   * Starting a run now asks. A line still claiming the old behaviour would be the window
   * describing something DSpatch no longer does.
   *
   * DSP-88 extended it. A line that promised the protection for a run alone would now be
   * true and misleading in the same way: a person reading it would conclude that the other
   * three ways of drawing over this canvas are the unprotected ones, which is what DSpatch
   * did until this card and no longer does. So the assertion on *will ask* is kept and
   * joined by one that the promise covers choosing another loop.
   */
  it('says every way of losing the drawing asks first, not only a run', () => {
    const said = describeUnsavedAgainstChoice({
      definition,
      chosenKey: definition.path,
      dirty: true,
      graphDisplayPath: 'g.graph.json',
    });
    assert.ok(said !== null);
    assert.match(said, /will ask/, `it has to say the start asks. It said: ${said}`);
    assert.match(
      said,
      /choosing another loop/,
      `the switch asks too, and the standing line is where that is read. It said: ${said}`,
    );
    assert.doesNotMatch(
      said,
      /not the drawing in this window/,
      'the claim that a run silently prefers the file is no longer true of DSpatch',
    );
  });

  it('keeps the refusal from implying that anything else was selected instead', () => {
    const said = describeChoiceRefused({
      note: '"Half a drawing" points at a graph that does not validate, so it was not chosen.',
      stillChosen: { key: 'C:\\other\\b.loop.json', name: 'The other loop' },
    });
    assert.ok(said.includes('Nothing was selected'));
    assert.ok(
      said.includes('The other loop'),
      'naming what is still selected is what rules out a silent fall back',
    );

    const withNothing = describeChoiceRefused({ note: 'broken', stillChosen: null });
    assert.ok(withNothing.includes('no loop is selected'));
  });

  /*
   * `describeNextMandateLoop` is gone (DSP-87), and with it the test that asserted it
   * named the declaration file as well as the loop.
   *
   * That was DSP-84 #3: a sentence under the chat's composer, added because Niclas had
   * pressed `Use loop` with a different loop drawn in the editor and nothing told him
   * the two were not the same thing. DSP-85 then made the editor's dropdown the only
   * way to choose a loop, so the name and the origin are on screen continuously, as a
   * control — and the sentence became a paragraph repeating another window's dropdown
   * under a box whose business is the message being typed now.
   *
   * What it established is not lost. That a name is not a location is carried by the
   * chooser's own rows, which hold `display.origin` beside every name, and the
   * one-source constraint the sentence was built on is the suite below.
   */
});

/*
 * The one question about a drawing that is about to be lost (DSP-88).
 *
 * It is here rather than in the window trial because the window trial cannot read it. A
 * native message box is the operating system's, so a walk can provoke this dialog and
 * answer it through `DSPATCH_UNSAVED_DRAWING` but never see a word of it — which means the
 * buttons, the default and the wording have exactly one place they can be checked, and
 * this is it. What the trial establishes instead is that each answer does what it says.
 *
 * DSP-88 #5 asks that the switch reuse DSP-86's question rather than invent a second
 * dialogue, so the tests are written as a comparison of the two shapes rather than as two
 * independent descriptions: one function, two occasions, one extra button.
 */
describe('the question asked before a drawing is lost', () => {
  const drawing = { path: 'C:\\work\\graphs\\chat.graph.json', graphName: 'Simple chat loop' };

  it('offers Save, Discard changes and Cancel when a switch would lose the drawing', () => {
    const asked = describeUnsavedDrawingQuestion({ ...drawing, occasion: 'switch' });
    assert.deepEqual(asked.buttons, ['Save', 'Discard changes', 'Cancel']);
    // Parallel to the buttons, because the caller reads the response index out of it. A
    // list of labels plus a separate decision about which index means what is two
    // statements of one mapping, and the one that drifts writes or destroys a file.
    assert.deepEqual(asked.answers, ['save', 'discard', 'cancel']);
    assert.equal(asked.answers[asked.cancelId], 'cancel', 'the escape hatch has to be Cancel');
  });

  it('offers the run\u2019s two answers and no way to discard at the start of a run', () => {
    const asked = describeUnsavedDrawingQuestion({ ...drawing, occasion: 'run' });
    assert.deepEqual(asked.buttons, ['Save and run', 'Cancel']);
    assert.deepEqual(asked.answers, ['save', 'cancel']);
    // Not an oversight and worth pinning: discarding the edits and then running the older
    // file behind them is not something a person means by pressing one button in a dialog
    // they did not ask for, and DSP-86 deliberately did not offer it.
    assert.ok(!asked.answers.includes('discard'));
  });

  it('makes Cancel the default in both shapes, because the other answers are the destructive ones', () => {
    for (const occasion of ['run', 'switch'] as const) {
      const asked = describeUnsavedDrawingQuestion({ ...drawing, occasion });
      assert.equal(
        asked.cancelId,
        asked.buttons.length - 1,
        `${occasion}: Cancel is last, so a person reading left to right meets the safe answer last`,
      );
      assert.equal(asked.answers[asked.cancelId], 'cancel');
    }
  });

  it('names the file and the loop, and says what each answer will do', () => {
    const asked = describeUnsavedDrawingQuestion({ ...drawing, occasion: 'switch' });
    assert.ok(asked.message.includes('Simple chat loop'), 'a path alone does not say which loop');
    assert.ok(asked.detail.includes(drawing.path), 'and the file is what would be written');
    // All three, because a dialog that named only its safe answer would leave a person
    // guessing which of the other two loses the work.
    assert.match(asked.detail, /Save writes those changes/);
    assert.match(asked.detail, /Discard changes switches without/);
    assert.match(asked.detail, /Cancel switches nothing/);
  });

  it('keeps one vocabulary across the two occasions', () => {
    // #5's substance. The two questions are the same question, so they must not read as
    // two products: the file, the loop and the word Save appear in both, and the switch's
    // own addition is the only difference in the answers.
    const forRun = describeUnsavedDrawingQuestion({ ...drawing, occasion: 'run' });
    const forSwitch = describeUnsavedDrawingQuestion({ ...drawing, occasion: 'switch' });
    for (const asked of [forRun, forSwitch]) {
      assert.ok(asked.detail.includes(drawing.path));
      assert.ok(asked.message.includes(drawing.graphName));
      assert.match(asked.message, /^Save your changes to/);
      assert.match(asked.detail, /leaves? .*exactly as they are/);
    }
    assert.deepEqual(
      forSwitch.answers.filter((answer) => answer !== 'discard'),
      forRun.answers,
      'the switch is the run\u2019s question plus one answer, not a second dialogue',
    );
  });

  it('says both halves of what a cancelled switch left alone', () => {
    const said = describeSwitchKept('C:\\work\\graphs\\chat.graph.json');
    assert.ok(said.includes('C:\\work\\graphs\\chat.graph.json'));
    // The drawing and the selection. DSP-88 #2 is two claims, and a window that reported
    // only the first would leave the dropdown's own state an open question — which is
    // exactly the way this fix would go wrong.
    assert.match(said, /still on the canvas/);
    assert.match(said, /has not moved/);
    assert.match(said, /Nothing was switched/);
  });
});

describe('the next mandate\u2019s loop comes out of the one list', () => {
  function listingOf(
    rows: readonly { key: string; name: string; preselected: boolean }[],
  ): LoopDefinitionListing {
    return {
      choices: rows.map((row) => ({
        key: row.key,
        definitionId: row.name,
        usable: true,
        preselected: row.preselected,
        display: { name: row.name, description: null, origin: 'somewhere', error: null, dependency: null },
      })),
      problems: [],
    };
  }

  // Still two callers after DSP-85, and the key is still worth having: the chat has no
  // chooser but does hold the workspace key it follows, and passes it here for the sentence
  // under the composer. The editor passes nothing, which is the case below.
  it('prefers the caller\u2019s key, which is the chat naming the key it follows', () => {
    const listing = listingOf([
      { key: 'a', name: 'Alpha', preselected: true },
      { key: 'b', name: 'Beta', preselected: false },
    ]);
    assert.deepEqual(nextMandateLoopFrom(listing, 'b'), { key: 'b', name: 'Beta' });
  });

  // The editor's case, and since DSP-85 this answer is what its `<select>` displays. A
  // dropdown whose value came from anywhere else would be a second selection.
  it('falls back to the row the listing itself marks, which is the editor having none', () => {
    const listing = listingOf([
      { key: 'a', name: 'Alpha', preselected: false },
      { key: 'b', name: 'Beta', preselected: true },
    ]);
    assert.deepEqual(nextMandateLoopFrom(listing), { key: 'b', name: 'Beta' });
  });

  it('answers nothing for a key the list does not hold, rather than inventing a loop', () => {
    const listing = listingOf([{ key: 'a', name: 'Alpha', preselected: false }]);
    assert.equal(nextMandateLoopFrom(listing, 'gone'), null);
    assert.equal(nextMandateLoopFrom(null, 'a'), null);
  });

  /*
   * The trap `main.ts`'s `chooseLoop` fell into, kept as a test because the fix is a list
   * and a list is easy to narrow again.
   *
   * DSP-85's window trial found a fresh editor window drawing DSpatch's own chat loop while
   * its own dropdown named the standalone development loop. The cause is entirely here:
   * `defaultChoiceFrom` can only preselect a row it is given, and the remembered key named
   * a file in no open folder. The listing has always resolved such a key — that is what
   * `pickedPaths` is for — so the two answers came apart, and a hidden loop replaced what
   * the person had chosen (#7).
   */
  it('cannot preselect a remembered key whose row was left out of the list', () => {
    const outside = temporaryDir('remembered-outside');
    write(
      path.join(outside, 'elsewhere.loop.json'),
      JSON.stringify({
        format: 'dspatch-loop-definition',
        formatVersion: 1,
        id: 'dspatch-chat-loop',
        name: 'A loop filed somewhere else',
        graph: 'graphs/elsewhere.graph.json',
        resources: '.',
      }),
    );
    const remembered = path.join(outside, 'elsewhere.loop.json');

    // Given the row, the remembered key wins — that is what the workspace remembering one
    // is supposed to mean.
    const withTheRow = listChoosableLoops([repoRoot], [remembered], undefined, remembered);
    assert.equal(
      withTheRow.choices.find((choice) => choice.preselected)?.key,
      remembered,
      'a listing that holds the remembered row has to offer it',
    );

    // Not given the row, it silently answers with something else. The assertion is on the
    // *silence*: nothing here says the remembered loop was dropped, which is why the wrong
    // graph appeared on a canvas with no complaint anywhere.
    const withoutTheRow = listChoosableLoops([repoRoot], [], undefined, remembered);
    const fallback = withoutTheRow.choices.find((choice) => choice.preselected)?.key;
    assert.notEqual(fallback, remembered);
    assert.ok(
      fallback !== undefined && fallback.endsWith('dspatch-chat-loop.loop.json'),
      'and what it falls to is DSpatch\u2019s own chat loop, which is the substitution #7 forbids',
    );
  });

  it('gives the editor and the chat one answer for a real listing', () => {
    // The declarations this repository actually has, listed the way the window lists
    // them, with the workspace remembering the chat loop. The editor reads the marked
    // row and the chat reads its own key; the point is that they coincide.
    const listing = listChoosableLoops([repoRoot], [], undefined, chatLoopDefinition);
    const forTheEditor = nextMandateLoopFrom(listing);
    const forTheChat = nextMandateLoopFrom(listing, chatLoopDefinition);
    assert.deepEqual(forTheEditor, forTheChat);
    assert.equal(forTheEditor?.key, chatLoopDefinition);
  });
});
