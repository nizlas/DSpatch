import type { ScriptedScenario } from '../shared/bridge';

/*
 * How this launch was asked to run, read from the environment once (DSP-111).
 *
 * Read by both processes: the client (windows, scripted checks, exit codes) and the
 * project host (which adapters a presentation run gets, what the resume-choice record
 * keeps). The host inherits the client's environment, so both read the same values;
 * keeping the reading in one module is what stops them from deciding differently.
 */

/**
 * Scripted workflow run. Set `DSPATCH_CHAT_RUN=1` and the renderer drives its own
 * controls through the whole workflow, records what reached the DOM, and the main
 * process exits with a code. Its codes start at 30.
 *
 * This exists because "the window can do this" is otherwise only a claim. The
 * script operates the real buttons and the real input field in the real UI; the
 * evidence is what the DOM ended up showing, plus what the main process observed
 * on disk. It is not a substitute for Niclas judging the window.
 */
export const chatRunValue = process.env['DSPATCH_CHAT_RUN'] ?? '';
export const chatRunMode = chatRunValue !== '' && chatRunValue !== '0';
/**
 * `DSPATCH_CHAT_RUN=1` keeps DSP-1's meaning: the whole workflow over the
 * generated sample project. `DSPATCH_CHAT_RUN=chat` is the smaller scenario —
 * open an existing project, one streaming turn, one follow-up — which is what
 * evidences the interactive surface without paying for four turns.
 */
export const chatRunScenario: ScriptedScenario =
  chatRunValue === 'chat'
    ? 'interactive-chat'
    : chatRunValue === 'review'
      ? 'review-and-test'
      : chatRunValue === 'converse'
        ? 'conversation-during-work'
        : chatRunValue === 'presentation'
          ? 'presentation'
          : chatRunValue === 'errors'
            ? 'errors-read-well'
            : chatRunValue === 'history'
              ? 'conversation-comes-back'
              : chatRunValue === 'loop-choice'
                ? 'chosen-loop-runs'
                : chatRunValue === 'loop-result'
                  ? 'chat-loop-files-a-result'
                  : chatRunValue === 'loop-continuous'
                  ? 'loop-open-choose-run'
                  : chatRunValue === 'folders'
                    ? 'folders-and-a-tree'
                    : chatRunValue === 'roots'
                      ? 'several-working-roots'
                      : chatRunValue === 'one-view'
                        ? 'one-graph-view'
                        : chatRunValue === 'says-less'
                          ? 'chat-says-less'
                          : chatRunValue === 'stop-asked'
                          ? 'stop-i-asked-for'
                          : chatRunValue === 'unsaved-switch'
                            ? 'unsaved-edits-survive-a-switch'
                            : chatRunValue === 'liveness'
                              ? 'liveness-and-an-ending'
                              : chatRunValue === 'liveness-look'
                                ? 'how-the-liveness-looks'
                                : chatRunValue === 'workspace-flow'
                                ? 'workspace-flow'
                                : chatRunValue === 'model-list'
                                ? 'model-list'
                                : chatRunValue === 'model-start'
                                ? 'model-start'
                                : chatRunValue === 'model-flow'
                                ? 'model-flow'
                                : chatRunValue === 'steering'
                                ? 'steering'
                                : chatRunValue === 'editor-uncertain'
                                ? 'editor-uncertain'
                                : chatRunValue === 'steering-placement'
                                ? 'steering-placement'
                                : chatRunValue === 'editor-joins-run'
                                ? 'editor-joins-run'
                                : chatRunValue === 'pair-review'
                                ? 'pair-review'
                                : chatRunValue === 'code-walks'
                                ? 'code-walks'
                                : chatRunValue === 'review-agent-choice'
                                ? 'review-agent-choice'
                                : chatRunValue === 'walk-start'
                                ? 'walk-start'
                                : chatRunValue === 'analysis-access'
                                ? 'analysis-access'
                                : chatRunValue === 'selection-explain'
                                ? 'selection-explain'
                                : chatRunValue === 'diff-marks'
                                ? 'diff-marks'
                                : chatRunValue === 'switch'
                                  ? 'workspace-switch'
                                  : chatRunValue === 'resume-choice'
                                    ? 'resume-choice'
                                    : chatRunValue === 'review-window'
                                      ? 'review-window'
                                      : chatRunValue === 'review-direct'
                                        ? 'review-direct'
                                        : chatRunValue === 'review-discussion'
                                          ? 'review-discussion'
                                          : chatRunValue === 'review-hold'
                                            ? 'review-hold'
                                            : 'full-workflow';

/**
 * The one run that talks to no provider.
 *
 * `presentation` answers from `PresentationAdapter` and reads a fixed logged-in
 * status, so it costs nothing, needs no account and is deterministic. Both seams
 * already existed for tests; this is the first use of them in the application, and
 * it is gated on this single value so that no other launch can reach them.
 */
export const presentationMode =
  chatRunScenario === 'presentation' ||
  chatRunScenario === 'errors-read-well' ||
  // Storage and restoring are what this one is about, and neither needs a model. A
  // provider call here would cost money to establish something about a file.
  chatRunScenario === 'conversation-comes-back' ||
  // Which graph is on screen when a definition is chosen is decided entirely here.
  chatRunScenario === 'chosen-loop-runs' ||
  // Folders, a tree and a reading view are all decided on this machine too.
  chatRunScenario === 'folders-and-a-tree' ||
  // DSP-72: which folders a run would be given, which definition resolves, and the
  // refusal — all decided here. The one Send this scenario presses is refused before an
  // adapter exists, and it deliberately does not press the one that would walk.
  chatRunScenario === 'several-working-roots' ||
  // DSP-79: this one really does walk a loop, and it is the first scenario to walk one
  // with no provider. What it checks — that the run was given somewhere to keep results,
  // filed one, opened a session per agent node and put the earlier step's words in the
  // later step's prompt — is decided entirely by DSpatch. A model would add cost and
  // variance to a question it cannot answer.
  chatRunScenario === 'chat-loop-files-a-result' ||
  // DSP-84: which loop was chosen and which loop ran. Both are decided here — the
  // selection is the workspace's, and the run announces the bytes it read — so the one
  // mandate this walks needs canned replies and nothing else.
  chatRunScenario === 'loop-open-choose-run' ||
  // DSP-86: what the graph view does while a run walks through it. The run has to be a
  // real one — a lock that is never taken is not a lock — but nothing about what the
  // steps say matters here, so the canned replies are exactly right and a model would
  // only add time to a reading about zoom, scroll and selection.
  chatRunScenario === 'one-graph-view' ||
  // DSP-87: whether the window can call a run silent while its reply is arriving.
  // The question is what the window says about activity it is receiving, so the
  // activity has to be real and the words have to be the product's — neither of
  // which needs a model, and a model's own timing would make the reading a race.
  chatRunScenario === 'chat-says-less' ||
  // DSP-90: what the window says between asking a run to stop and the run reporting
  // that it has. Both halves are DSpatch's own — the request is the window's, the
  // confirmed end is the runner's — so the run has to be real while the replies do
  // not, and a model would add cost and timing variance to a reading about wording.
  chatRunScenario === 'stop-i-asked-for' ||
  // DSP-88: three gestures, three answers and what is on disk afterwards. Nothing in it
  // starts a run at all, so the adapter is only there to let a session open.
  chatRunScenario === 'unsaved-edits-survive-a-switch' ||
  // DSP-80 and DSP-36: which node is pulsing, which is glinting and which carries the
  // ending mark. The run has to be real — the states come from its journal and its
  // control — but nothing about what any step *says* reaches any of them, and the glint
  // deliberately does not depend on a reply arriving at all. A model would add cost and
  // timing variance to a reading about the run's own state.
  chatRunScenario === 'liveness-and-an-ending' ||
  // DSP-80, second pass: how the glint and the pulse are drawn, rather than when. It runs
  // no loop at all — Niclas's instruction, on the grounds that a change to the
  // distribution of light cannot break a state rule and a full walk would prove nothing
  // about it — so there is nothing here for a provider to be asked. The adapter exists
  // only because the window asks for a login reading on the way to the editor.
  chatRunScenario === 'how-the-liveness-looks' ||
  // DSP-4 WS-1: what the window shows of saved conversations as it switches between
  // them, and after a restart. Everything in it is read from files on this machine;
  // the adapter only lets a session open, and nothing is sent to it.
  chatRunScenario === 'workspace-switch' ||
  // DSP-149: the start page, workspaces and the chat's tools. Every reply and tool call
  // is the presentation adapter's; what is checked is DSpatch's own.
  chatRunScenario === 'workspace-flow' ||
  // DSP-147: steering, the composer and the lock. The steering is the presentation
  // adapter's SIMULATED steering; what is checked is DSpatch's routing, records and window.
  chatRunScenario === 'steering' ||
  chatRunScenario === 'editor-uncertain' ||
  chatRunScenario === 'steering-placement' ||
  // DSP-28 follow-up: the editor window opened during a chat loop; every step is simulated.
  chatRunScenario === 'editor-joins-run' ||
  // DSP-150: review of a chosen revision pair; nothing in it sends to a provider.
  chatRunScenario === 'pair-review' ||
  // DSP-152: walk preparation and delegated review answered by the presentation adapter (SIMULATED).
  chatRunScenario === 'code-walks' ||
  // DSP-152 fix: the agent and model a review's agent work starts with (SIMULATED).
  chatRunScenario === 'review-agent-choice' ||
  // DSP-152, second live trial: from the main window to an opened walk with real input (SIMULATED).
  chatRunScenario === 'walk-start' ||
  // DSP-152: the analysis agent reads the revisions the host wrote (SIMULATED answers over real reads).
  chatRunScenario === 'analysis-access' ||
  // DSP-152: explaining code selected in the diff, with real selections (SIMULATED answers over real reads).
  chatRunScenario === 'selection-explain' ||
  // DSP-150 follow-up: the diff's change marks in the real window (one SIMULATED explanation).
  chatRunScenario === 'diff-marks' ||
  // DSP-121: the refused and failed resume states through the real choice panel. The
  // refusal is the presentation adapter's own, simulated on this machine; the one
  // message the scenario sends after choosing a new session is answered locally.
  chatRunScenario === 'resume-choice' ||
  // DSP-126: windows, IPC and the review record. Nothing in either needs a model.
  chatRunScenario === 'review-window' ||
  chatRunScenario === 'review-direct' ||
  // DSP-127: the review discussion, answered by presentation adapters of its own.
  chatRunScenario === 'review-discussion' ||
  // DSP-126/127 hand-over: P1 opened and left at rest for a person; every answer simulated.
  chatRunScenario === 'review-hold';

/**
 * Hold mode (`DSPATCH_CHAT_HOLD=1` with `resume-choice`, or `review-hold`): the scenario performs the
 * open, the record is written, and the window is left open for a person to look at
 * instead of being exited. The conversation view then behaves as in an ordinary launch
 * - the real panel and its buttons - and is simply not driven further. Not the whole
 * window: `chatRunMode` stays on, so the graph editor's file dialogs and the
 * unsaved-drawing question still answer from the scripted queues.
 */
export const chatRunHold =
  (chatRunScenario === 'resume-choice' && process.env['DSPATCH_CHAT_HOLD'] === '1') ||
  // A hold by nature: P1 is opened and the window is left to the person (`start-review.cmd`).
  chatRunScenario === 'review-hold';
