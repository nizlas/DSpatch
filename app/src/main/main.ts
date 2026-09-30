import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';

import type {
  AddLoopInstructionOutcome,
  AddLoopInstructionRequest,
  BridgeChannel,
  BuildIdentity,
  ConversationExportResult,
  ChatLoopCancelOutcome,
  LoopInstructionEventPayload,
  ChatLoopRecordInfo,
  ChatLoopReply,
  ChatLoopRunOutcome,
  ChatLoopRunRequest,
  StoredRunRecordEntry,
  EditorLoopCancelOutcome,
  EditorLoopRunOutcome,
  EditorLoopRunRequest,
  EnvironmentInfo,
  LoopGraphOpenOutcome,
  LoopGraphOpenRequest,
  LoopEditorWindowOutcome,
  LoopGraphSaveOutcome,
  LoopGraphSaveRequest,
  GraphSavedElsewhere,
  UnsavedDrawing,
  MenuCommand,
  ProjectListEntry,
  ProjectListing,
  ProjectPickOutcome,
  RendererReady,
  ChatLoopPrepareOutcome,
  LoopDefinitionChooseOutcome,
  LoopDefinitionListing,
  ResolvedRoleEntry,
  SampleProjectsView,
  ScriptedRunPlan,
  ScriptedRunReport,
  ScriptedScenario,
  StartSessionRequest,
  TestRunRequest,
} from '../shared/bridge';
import {
  boundedPathList,
  chatPromptFor,
  describeChosenLoopBinding,
  lookupFromGraph,
  modelForChatNode,
  type ChatRoleText,
} from '../shared/loop-chat';
import { describeLiveBinding } from '../shared/loop-editor-run';
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import type { LoopNode, RoleReference, RoleResolver } from '../shared/loop-graph';
import type { RunResult, RunStatus } from '../shared/loop-run';
import { ChatService, type ChatAdapter } from './chat-service';
import { ConversationStore } from './conversation-store';
import { PresentationAdapter, presentationAuthStatus } from './presentation-adapter';
import { InstructionQueue } from './instruction-queue';
import { instructionPreamble } from '../shared/loop-instruction';
import { createFileRoleResolver } from './loop-graph-roles';
import {
  defaultChoiceFrom,
  listChoosableLoops,
  openChosenLoop,
  rowForKey,
  type ChosenLoopOutcome,
} from './loop-definition-choice';
import { judgeChosenLoop } from './loop-choice-check';
import { discoverLoopDefinitions, openLoopDefinitionFile } from './loop-definition-files';
import {
  isLoopDefinitionText,
  openedFromDefinition,
  openedFromGraphFile,
  referencedRoles,
  resolvedRolesWith,
} from './loop-graph-open';
import { refuseLiveWorkingRoots } from './loop-live';
import { defaultLiveModel, runLiveGraph } from './loop-live-run';
import { LoopRunController } from './loop-control-runtime';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from '../shared/loop-control';
import { LoopRunAudience } from './loop-run-audience';
import type { LiveRunAnnouncement } from '../shared/loop-run-view';
import { ownRepositoryRoot } from './own-repository';
import { PROBE_EXIT, runCursorProbe } from './probe-cursor';
import { ProjectStore } from './project-store';
import { readDirectoryPage, readFileForViewing } from './workspace-tree';
import {
  addFolderTo,
  folderDisplayName,
  parseWorkspaceFile,
  removeFolderFrom,
  sameFolder,
  workspaceFileText,
  WORKSPACE_FILE_EXTENSION,
  type DirectoryPage,
  type FileView,
  type WorkspaceView,
} from '../shared/workspace-folders';
import {
  describeSwitchKept,
  describeUnsavedDrawingQuestion,
  type UnsavedDrawingAnswer,
  type UnsavedDrawingOccasion,
} from '../shared/unsaved-drawing';
import { describeWorkingRootsForPerson, workingRootsFrom } from '../shared/working-roots';
import type { SampleProjectListing } from './sample-projects';
import {
  graphVersionIdFor,
  recordedCommandFrom,
  recordedSnapshotsFrom,
  RunRecordStore,
  type RunRecordWriter,
} from './run-record-store';
import {
  describeRunOutcome,
  runOutcomeFrom,
  type RecordedCommand,
  type RecordedEndingKind,
  type RecordedRunEnding,
  type RunWalkEnding,
} from '../shared/loop-record';
import type { LiveInspection } from './loop-live';

const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';
const GET_CONNECTION: BridgeChannel = 'dspatch:get-connection';
const SET_MODEL: BridgeChannel = 'dspatch:set-model';
const MENU_COMMAND: BridgeChannel = 'dspatch:menu-command';
const PICK_PROJECT: BridgeChannel = 'dspatch:pick-project';
const LIST_PROJECTS: BridgeChannel = 'dspatch:list-projects';
const FORGET_PROJECTS: BridgeChannel = 'dspatch:forget-projects';
const LIST_SAMPLE_PROJECTS: BridgeChannel = 'dspatch:list-sample-projects';
const CLEAN_SAMPLE_PROJECTS: BridgeChannel = 'dspatch:clean-sample-projects';
const LIST_CONVERSATIONS: BridgeChannel = 'dspatch:list-conversations';
const CONVERSATION_SAVE_STATUS: BridgeChannel = 'dspatch:conversation-save-status';
const RESUME_CONVERSATION: BridgeChannel = 'dspatch:resume-conversation';
const EXPORT_CONVERSATION: BridgeChannel = 'dspatch:export-conversation';
const REVEAL_CONVERSATION: BridgeChannel = 'dspatch:reveal-conversation';
const START_SESSION: BridgeChannel = 'dspatch:start-session';
const SEND_PROMPT: BridgeChannel = 'dspatch:send-prompt';
const CANCEL_RUN: BridgeChannel = 'dspatch:cancel-run';
const ABANDON_SEND: BridgeChannel = 'dspatch:abandon-send';
const CANCEL_OBSERVATIONS: BridgeChannel = 'dspatch:cancel-observations';
const RUN_STATE: BridgeChannel = 'dspatch:run-state';
const RUN_TEST: BridgeChannel = 'dspatch:run-test';
const STOP_TEST: BridgeChannel = 'dspatch:stop-test';
const TEST_FRESHNESS: BridgeChannel = 'dspatch:test-freshness';
const WORKSPACE_CHANGES: BridgeChannel = 'dspatch:workspace-changes';
const TURN_USAGE: BridgeChannel = 'dspatch:turn-usage';
const AGENT_EVENT: BridgeChannel = 'dspatch:agent-event';
const GET_SCRIPTED_RUN: BridgeChannel = 'dspatch:get-scripted-run';
const SCRIPTED_RUN_REPORT: BridgeChannel = 'dspatch:scripted-run-report';
const PRESS_MENU_ITEM: BridgeChannel = 'dspatch:press-menu-item';
const CAPTURE_WINDOW: BridgeChannel = 'dspatch:capture-window';
const SET_WINDOW_WIDTH: BridgeChannel = 'dspatch:set-window-width';
const EMULATE_REDUCED_MOTION: BridgeChannel = 'dspatch:emulate-reduced-motion';
const OPEN_LOOP_GRAPH: BridgeChannel = 'dspatch:open-loop-graph';
const SAVE_LOOP_GRAPH: BridgeChannel = 'dspatch:save-loop-graph';
const RESOLVE_LOOP_ROLES: BridgeChannel = 'dspatch:resolve-loop-roles';
const REVEAL_ROLE_SOURCE: BridgeChannel = 'dspatch:reveal-role-source';
const OPEN_LOOP_EDITOR: BridgeChannel = 'dspatch:open-loop-editor';
const START_EDITOR_LOOP_RUN: BridgeChannel = 'dspatch:start-editor-loop-run';
const CANCEL_EDITOR_LOOP_RUN: BridgeChannel = 'dspatch:cancel-editor-loop-run';
const CURRENT_LOOP_RUN: BridgeChannel = 'dspatch:current-loop-run';
const START_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:start-chat-loop-run';
const CANCEL_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:cancel-chat-loop-run';
const CHAT_LOOP_JOURNAL: BridgeChannel = 'dspatch:chat-loop-journal';
const CHAT_LOOP_REPLY: BridgeChannel = 'dspatch:chat-loop-reply';
const CHAT_LOOP_ACTIVITY: BridgeChannel = 'dspatch:chat-loop-activity';
const PREPARE_CHAT_LOOP: BridgeChannel = 'dspatch:prepare-chat-loop';
const WORKSPACE_FOLDERS: BridgeChannel = 'dspatch:workspace-folders';
const WORKSPACE_FOLDERS_CHANGED: BridgeChannel = 'dspatch:workspace-folders-changed';
const ADD_WORKSPACE_FOLDER: BridgeChannel = 'dspatch:add-workspace-folder';
const REMOVE_WORKSPACE_FOLDER: BridgeChannel = 'dspatch:remove-workspace-folder';
const OPEN_WORKSPACE_FILE: BridgeChannel = 'dspatch:open-workspace-file';
const SAVE_WORKSPACE_FILE: BridgeChannel = 'dspatch:save-workspace-file';
const READ_WORKSPACE_DIRECTORY: BridgeChannel = 'dspatch:read-workspace-directory';
const READ_WORKSPACE_FILE: BridgeChannel = 'dspatch:read-workspace-file';
const LIST_LOOP_DEFINITIONS: BridgeChannel = 'dspatch:list-loop-definitions';
const CHOOSE_LOOP_DEFINITION: BridgeChannel = 'dspatch:choose-loop-definition';
const TAKE_GRAPH_TO_EDIT: BridgeChannel = 'dspatch:take-graph-to-edit';
const GRAPH_TO_EDIT: BridgeChannel = 'dspatch:graph-to-edit';
const NOTE_UNSAVED_DRAWING: BridgeChannel = 'dspatch:note-unsaved-drawing';
const GRAPH_SAVED_ELSEWHERE: BridgeChannel = 'dspatch:graph-saved-elsewhere';
const ADD_LOOP_INSTRUCTION: BridgeChannel = 'dspatch:add-loop-instruction';
const LOOP_INSTRUCTION_EVENT: BridgeChannel = 'dspatch:loop-instruction-event';
const LIST_RUN_RECORDS: BridgeChannel = 'dspatch:list-run-records';
const LOOP_CONTROL_CHANNEL: BridgeChannel = 'dspatch:loop-control';
const READ_LOOP_CONTROL: BridgeChannel = 'dspatch:read-loop-control';
const REQUEST_LOOP_PAUSE: BridgeChannel = 'dspatch:request-loop-pause';
const CONTINUE_LOOP: BridgeChannel = 'dspatch:continue-loop';
const SET_LOOP_MODE: BridgeChannel = 'dspatch:set-loop-mode';

/** Set by `scripts/dev.mjs`; points to the Vite development server. */
const rendererUrl = process.env['DSPATCH_RENDERER_URL'];

/**
 * Startup smoke test. Set `DSPATCH_SMOKE=1` to start, load the renderer, report
 * actual observations and exit with a code. A launched command alone does not
 * prove that a window appeared.
 */
const smokeMode = process.env['DSPATCH_SMOKE'] === '1';
const smokeTimeoutMs = 30_000;

/**
 * Connection probe. Set `DSPATCH_PROBE=1` to connect through the Cursor adapter
 * from the main process and exit with a code. See `probe-cursor.ts`; its exit
 * codes start at 10 so they cannot be confused with the smoke test's.
 */
const probeMode = process.env['DSPATCH_PROBE'] === '1';

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
const chatRunValue = process.env['DSPATCH_CHAT_RUN'] ?? '';
const chatRunMode = chatRunValue !== '' && chatRunValue !== '0';
/**
 * `DSPATCH_CHAT_RUN=1` keeps DSP-1's meaning: the whole workflow over the
 * generated sample project. `DSPATCH_CHAT_RUN=chat` is the smaller scenario —
 * open an existing project, one streaming turn, one follow-up — which is what
 * evidences the interactive surface without paying for four turns.
 */
const chatRunScenario: ScriptedScenario =
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
                                : 'full-workflow';

/**
 * The one run that talks to no provider.
 *
 * `presentation` answers from `PresentationAdapter` and reads a fixed logged-in
 * status, so it costs nothing, needs no account and is deterministic. Both seams
 * already existed for tests; this is the first use of them in the application, and
 * it is gated on this single value so that no other launch can reach them.
 */
const presentationMode =
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
  chatRunScenario === 'how-the-liveness-looks';

/**
 * How fast the canned reply arrives, when a scripted run needs to say
 * (`DSPATCH_PRESENTATION_DELTA_MS`).
 *
 * The default 45 ms empties the whole reply in under a second, which is right for
 * every scenario that wants a finished turn quickly and wrong for the two whose
 * subject is a run that has not finished. DSP-87 has to read the window while text is
 * arriving, and a reading taken after the last chunk would be about a finished run —
 * the one state in which the old wording was not a lie. DSP-90 needs a step still
 * working when Cancel is pressed, because cancelling a settled run would measure the
 * script's timing. Slowing the fixture widens the interval being sampled; it changes
 * nothing about what the product does in it.
 */
function presentationAdapterOptions(): { readonly deltaMs?: number } {
  const raw = process.env['DSPATCH_PRESENTATION_DELTA_MS'] ?? '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? { deltaMs: parsed } : {};
}

/**
 * What a file chooser answers during a scripted window run (`DSPATCH_PICK_FILE`).
 *
 * A native dialog cannot be driven from the renderer, so **Open loop…** and
 * **File → Open Graph File…** would be two controls a window trial could look at and
 * never press — and "the button exists" is a weaker claim than DSP-85 #3 and #6 deserve.
 * This is the dialog's *answer*, and only that: the press, the handler, the judgement and
 * everything recorded afterwards are the real ones a person gets.
 *
 * A `;`-separated list, consumed one entry per chooser, so two presses cannot silently
 * pick the same file and look like two different choices. Read only while `chatRunMode`
 * is on, and an exhausted list reads as a dismissed dialog rather than opening a real one
 * — a scripted run must not be able to stop on something nobody can click.
 */
const scriptedFilePicks: string[] = chatRunMode
  ? (process.env['DSPATCH_PICK_FILE'] ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  : [];

/**
 * The terminal a finished run reached, for the graph view's ending mark (DSP-36).
 *
 * Guarded on `completed` rather than trusting the field, exactly as `loop-transcript.ts`
 * guards the ending badge: the runner leaves `terminalNodeId` null on every other status
 * today, and a mark that borrowed one if that ever stopped being true would put a tick on
 * a faulted run. One function for both run handlers, because two copies of this guard is
 * one copy that will lose it.
 */
function terminalReachedBy(result: { readonly status: RunStatus; readonly terminalNodeId: string | null }): string | null {
  return result.status === 'completed' ? result.terminalNodeId : null;
}

/** The next scripted answer, or `null` for "dismissed". Only meaningful in `chatRunMode`. */
function scriptedFilePick(label: string): string | null {
  const next = scriptedFilePicks.shift() ?? null;
  log(`scripted file chooser (${label}) answered ${next ?? 'cancelled'}`);
  return next;
}

/**
 * How long the main process waits for the renderer's report before calling it a
 * timeout.
 *
 * Longer for `converse`, and the reason is the scenario rather than caution: it
 * walks a loop of two agent steps to a terminal and then interrupts a third, where
 * the drawing's own bound for a single step is 15 minutes. 900 000 ms would turn a
 * run behaving exactly as the graph allows into exit 38, and a timeout that fires
 * on correct behaviour reports nothing about the window.
 */
const chatRunTimeoutMs =
  chatRunScenario === 'conversation-during-work'
    ? 2_700_000
    :       // Nothing in these two waits for a provider, so a few minutes is generous and
      // a longer bound would only turn a hang into a long silence. The error run is
      // shorter still: it does one refusal and reads it.
      chatRunScenario === 'presentation'
      ? 180_000
      : chatRunScenario === 'errors-read-well'
        ? 120_000
        : chatRunScenario === 'conversation-comes-back'
          ? 180_000
          : chatRunScenario === 'chosen-loop-runs'
            ? 120_000
            : // Expanding a folder of thousands of entries is the slowest thing it
              // does, and it is a local read.
              chatRunScenario === 'folders-and-a-tree'
              ? 180_000
              : // Two folders, one definition read from disk and one refusal. Nothing
                // here waits for anything remote.
                chatRunScenario === 'several-working-roots'
                ? 120_000
                : // A real two-step walk, with no provider to wait for: the presentation
                  // adapter streams its reply in a couple of seconds per step.
                  chatRunScenario === 'chat-loop-files-a-result'
                  ? 300_000
                  : // Two definitions opened and chosen through the editor, then one
                    // walk with canned replies. Nothing in it waits for anything remote.
                    chatRunScenario === 'loop-open-choose-run'
                    ? 420_000
                    : // One walk with canned replies, held once at a step to check that
                      // waiting for the person keeps the lock. The hold is released by
                      // the trial, so nothing here waits on a person either.
                      chatRunScenario === 'one-graph-view'
                      ? 420_000
                      : // Five gestures, four dialogs and a handful of file reads. It
                        // starts no run and waits for nothing remote.
                        chatRunScenario === 'unsaved-edits-survive-a-switch'
                        ? 300_000
                        : // One held walk, two dry runs and a handful of readings. The
                          // stream is deliberately slowed so that *no new text arrived*
                          // is an interval a sample can fall inside, which makes the
                          // walk longer than the reply it waits for.
                          chatRunScenario === 'liveness-and-an-ending'
                          ? 600_000
                          : // One graph opened, two states forced, a handful of frozen
                            // frames captured. It starts no run and waits for nothing, so
                            // a minute is already generous and anything longer would mean
                            // it is stuck rather than working.
                            chatRunScenario === 'how-the-liveness-looks'
                            ? 90_000
                            : 900_000;
const chatRunTurnTimeoutMs = 240_000;

/**
 * A project to offer at startup, for an automated run or a shortcut.
 *
 * Deliberately a new variable rather than a new meaning for
 * `DSPATCH_CHAT_WORKSPACE`, which still points at the generated sample project.
 * Reusing it would silently change what DSP-1's recorded procedure did.
 */
const startupProjectPath = process.env['DSPATCH_PROJECT_PATH'];

/** `app.quit()` loses the exit code; `app.exit(code)` preserves it. */
const EXIT_OK = 0;
const EXIT_LOAD_FAILED = 2;
const EXIT_TIMEOUT = 3;
const EXIT_RENDERER_GONE = 4;

/** Scripted-run codes. 0–4 belong to the smoke test, 10–19 to the probe. */
const CHAT_EXIT_TIMEOUT = 38;
const CHAT_EXIT_NO_REPORT = 39;

function log(message: string): void {
  process.stdout.write(`[dspatch] ${message}\n`);
}

/**
 * DSpatch's own working copy, resolved by content from where this application is
 * running, or `null` when it is not inside one.
 *
 * Read by exactly one thing: the refusal, for the one question the walk up from
 * the chosen folder cannot answer — whether the chosen folder *contains* DSpatch.
 * Nothing can set it, which is the point. `DSPATCH_PROBE_REPO_ROOT` names the
 * generator's boundary below and must stay out of containment; if the refusal read
 * that variable instead, setting it would start refusing every folder above
 * whatever it named.
 *
 * `null` for a packaged copy moved out of the tree it was built in. That is the
 * honest answer and it refuses nothing: see `own-repository.ts` for why this test
 * is a second direction on top of the content walk rather than the guard itself.
 */
const ownRepoRoot = ownRepositoryRoot(app.getAppPath());

/**
 * Where DSpatch's own sources are: the boundary the sample-project generator and
 * the DSP-1 probe keep out of.
 *
 * This is **not** what contains the agent any more, and it is not read by any
 * refusal. The refusal to open DSpatch's own working copy resolves the repository
 * by walking up from the folder the user chose (`own-repository.ts`), so it no
 * longer depends on this value or on anyone remembering an environment variable.
 * Until DSP-16 it did, and `DSPATCH_PROBE_REPO_ROOT` was documented as something a
 * packaged run *must* set — an environment variable is not containment, and that
 * claim is gone.
 *
 * DSP-16 left one thread of that behind, and Verifier 004 measured it on
 * 15 September 2026: a path test in `validateProjectFolder` still compared the
 * chosen folder against this value, so pointing the variable at a projects parent
 * directory refused every project beneath it, each time claiming the project was
 * inside DSpatch's own working copy. That test is gone. Setting this variable now
 * moves the generator's and the probe's boundary and changes nothing about which
 * folders may be opened, in either direction.
 *
 * Resolution, in order:
 *
 * 1. `DSPATCH_PROBE_REPO_ROOT`, for a run that wants to name the boundary itself.
 * 2. The repository found by walking up from the app path. `app.getAppPath()` is
 *    `<repo>/app` from source and a path inside `app.asar` when packaged; both
 *    resolve to `<repo>` while the artifact is still inside the tree it was built
 *    in, which the artifact under `app/release/win-unpacked` is.
 * 3. The parent of the app path, the old default, when neither answers. For a
 *    packaged copy moved out of the tree that is `…/resources`, which is a
 *    boundary the generator should stay out of anyway.
 */
function probeRepoRoot(): string {
  const explicit = process.env['DSPATCH_PROBE_REPO_ROOT'];
  if (explicit !== undefined && explicit.trim() !== '') {
    return path.resolve(explicit);
  }
  return ownRepoRoot ?? path.resolve(app.getAppPath(), '..');
}

/**
 * The chat service owns the Cursor adapter, in the main process.
 *
 * The renderer reaches it only through the channels registered below. Nothing
 * about the window changes that: `contextIsolation` stays on, `nodeIntegration`
 * stays off and the sandbox stays enabled.
 */
const chatService = new ChatService({
  repoRoot: probeRepoRoot(),
  ownRepoRoot,
  send: (event) => {
    sendToMainWindow(AGENT_EVENT, event);
  },
  log: (message) => {
    log(`[chat] ${message}`);
  },
  conversations: () => requireConversationStore(),
  conversationForProject: (projectPath) =>
    requireProjectStore().conversationFor(projectPath),
  ...(presentationMode
    ? {
        createAdapter: (): ChatAdapter => new PresentationAdapter(presentationAdapterOptions()),
        readAuthStatus: presentationAuthStatus,
      }
    : {}),
});

let serviceDisposed = false;
let probeStarted = false;

/**
 * Remembered projects.
 *
 * One versioned file under Electron's `userData`, created on first use. It is
 * outside the repository and outside every project, so nothing DSpatch remembers
 * ends up in the user's git history.
 */
let projectStore: ProjectStore | null = null;

function requireProjectStore(): ProjectStore {
  projectStore ??= new ProjectStore(
    path.join(app.getPath('userData'), 'dspatch-projects.json'),
  );
  return projectStore;
}

/* --------------------------------------------------------------------------- */
/* A workspace of open folders (DSP-71)                                        */
/* --------------------------------------------------------------------------- */

/**
 * Folders open beside the project, and the loop this arrangement chose.
 *
 * **What "the open project" now means, stated once so it is not inferred from the
 * code.** DSpatch has assumed one open folder everywhere: the chat session's working
 * copy, `refuseLiveWorkspace`, `recordOpened`, the loop-definition search. A
 * workspace of several folders does not fit that, and DSP-71 took the smaller of the two
 * available answers: one folder was the run's working copy and the others were folders
 * DSpatch showed and searched, changing nothing about a run.
 *
 * **DSP-72 changed that half.** Every folder in this list is now a working folder of any
 * loop run started afterwards: `workingRootsFrom(openWorkspaceFolders(), …)` builds the
 * run's roots from exactly this, they are handed to the provider as `cwd` plus `dirs`,
 * and each is snapshotted. What did **not** change is which folder is primary — the
 * project the chat session opened is still the working directory, still the shell's
 * `cwd`, and still what the provider scopes its agent store by.
 *
 * **And the ordinary chat path is untouched.** `chat-service.ts` builds its
 * `SessionConfig` with `workspacePath` alone, so a message outside a loop run gives the
 * agent the working directory and nothing else. That asymmetry is real and is why the
 * sidebar's note names which path it is describing rather than saying "the folders reach
 * Cursor" flatly.
 *
 * So this still holds only the *extra* folders. The working one is wherever it always was.
 */
const extraWorkspaceFolders: string[] = [];

/** The saved workspace this arrangement came from, or `null` if it is unsaved. */
let workspaceFilePath: string | null = null;

/**
 * The loop definition this workspace chose.
 *
 * DSP-68 deferred remembering this and said so in a comment here; the comment is gone
 * because this is the answer. It is written to the project store whenever it changes
 * and read back at startup, and it is what a saved workspace file carries beside its
 * folders.
 */
let workspaceLoopDefinitionKey: string | null = null;

const pathsAreCaseInsensitive = process.platform === 'win32';

/** Every folder open now, the run's working copy first. */
function openWorkspaceFolders(): readonly string[] {
  const working = chatService.openSession()?.workspacePath ?? null;
  let folders: readonly string[] = working === null ? [] : [path.resolve(working)];
  for (const folder of extraWorkspaceFolders) {
    folders = addFolderTo(folders, folder, pathsAreCaseInsensitive);
  }
  return folders;
}

function currentWorkspaceView(problem: string | null = null): WorkspaceView {
  const working = chatService.openSession()?.workspacePath ?? null;
  const resolvedWorking = working === null ? null : path.resolve(working);
  const folders = openWorkspaceFolders();
  return {
    folders: folders.map((folder) => ({
      path: folder,
      name: folderDisplayName(folder),
      working:
        resolvedWorking !== null &&
        sameFolder(folder, resolvedWorking, pathsAreCaseInsensitive),
    })),
    loopDefinitionKey: workspaceLoopDefinitionKey,
    filePath: workspaceFilePath,
    problem,
    // The same construction the run uses, so the sentence on screen describes the list
    // a run would actually be given rather than a second idea of it.
    rootsNote:
      folders.length === 0
        ? null
        : describeWorkingRootsForPerson(
            workingRootsFrom(folders, resolvedWorking, pathsAreCaseInsensitive),
          ),
  };
}

/**
 * Tell the window what the folders are now.
 *
 * Pushed rather than polled because the menu can change them, and a menu bar is
 * exactly the part of the application the renderer cannot see.
 */
function announceWorkspace(problem: string | null = null): WorkspaceView {
  const view = currentWorkspaceView(problem);
  // Every window, not only the chat's. The view carries `loopDefinitionKey`, which
  // since DSP-84 is what the editor reads to say which loop the next mandate walks;
  // an editor in its own window that never heard the announcement would be the second
  // answer this card exists to prevent.
  sendToEveryWindow(WORKSPACE_FOLDERS_CHANGED, view);
  return view;
}

/** Write the arrangement to the project store. A failure costs the memory, not the work. */
function rememberWorkspace(): void {
  const state = requireProjectStore().rememberWorkspace({
    filePath: workspaceFilePath,
    folders: openWorkspaceFolders(),
    loopDefinitionKey: workspaceLoopDefinitionKey,
  });
  if (state.error !== null) {
    log(`[workspace] ${state.error}`);
  }
}

/**
 * Record which loop this workspace chose, when the window says it has changed.
 *
 * Called from the three places a choice is made — the chooser beside the composer, the
 * file picker, and the editor's `Use this loop` — and from nowhere else, so a preview
 * that resolves the default does not silently write a choice nobody made.
 *
 * **This is the one place the selection changes**, which is what makes DSP-84's "one
 * source" claim a property of the code rather than a promise. Every window learns
 * about it through `announceWorkspace` below, and none of them keeps a selection of
 * its own that could disagree.
 */
function noteChosenLoopDefinition(key: string | null): void {
  if (key === null || key === '' || key === workspaceLoopDefinitionKey) {
    return;
  }
  workspaceLoopDefinitionKey = key;
  rememberWorkspace();
  announceWorkspace();
}

/**
 * Add a folder beside the ones already open.
 *
 * With no path a native chooser opens. With one the folder is added directly, which
 * is the only way a scripted trial reaches this: a native dialog cannot be driven
 * from the renderer, and pretending otherwise would be a trial that tested nothing.
 */
async function addWorkspaceFolder(folderPath: string | null): Promise<WorkspaceView> {
  let chosen = folderPath;
  if (chosen === null) {
    const picked = await dialog.showOpenDialog({
      title: 'Add a folder to the workspace',
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return currentWorkspaceView();
    }
    chosen = picked.filePaths[0] as string;
  }

  const resolved = path.resolve(chosen);
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return announceWorkspace(
        `${resolved} is a file, not a folder, so it was not added. Open the folder it ` +
          'is in and the file will be in the tree.',
      );
    }
  } catch (error) {
    return announceWorkspace(
      `${resolved} could not be opened, so it was not added: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (openWorkspaceFolders().some((open) => sameFolder(open, resolved, pathsAreCaseInsensitive))) {
    return announceWorkspace(`${resolved} is already open in this workspace.`);
  }
  extraWorkspaceFolders.push(resolved);
  rememberWorkspace();
  return announceWorkspace();
}

/**
 * Remove a folder from the workspace.
 *
 * **DSP-71 #2 is the absence of a filesystem call in this function.** It removes a
 * string from a list; there is no path from here to deleting anything, and no
 * conversation is keyed on a folder being in the workspace.
 *
 * The run's working copy is refused rather than removed. It is the open project, and
 * closing a project is a different act with different consequences; taking it out of
 * the tree would leave a conversation working in a folder the window no longer shows.
 */
function removeWorkspaceFolder(folderPath: string): WorkspaceView {
  const resolved = path.resolve(folderPath);
  const working = chatService.openSession()?.workspacePath ?? null;
  if (working !== null && sameFolder(path.resolve(working), resolved, pathsAreCaseInsensitive)) {
    return announceWorkspace(
      `${resolved} is the project this conversation is working in, so it was not ` +
        'removed from the workspace. Nothing on disk was touched. Open another ' +
        'project to work somewhere else.',
    );
  }
  const remaining = removeFolderFrom(extraWorkspaceFolders, resolved, pathsAreCaseInsensitive);
  const changed = remaining.length !== extraWorkspaceFolders.length;
  extraWorkspaceFolders.length = 0;
  extraWorkspaceFolders.push(...remaining);
  if (changed) {
    rememberWorkspace();
  }
  return announceWorkspace();
}

/** Open a saved workspace: the folders it lists, and the loop definition it chose. */
async function openWorkspace(filePath: string | null): Promise<WorkspaceView> {
  let target = filePath;
  if (target === null) {
    const picked = await dialog.showOpenDialog({
      title: 'Open a workspace',
      filters: [{ name: 'DSpatch workspace', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return currentWorkspaceView();
    }
    target = picked.filePaths[0] as string;
  }
  const resolved = path.resolve(target);

  let text: string;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    return announceWorkspace(
      `${resolved} could not be read, so no folder was opened and the workspace you ` +
        `have is unchanged: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const read = parseWorkspaceFile(text, resolved);
  if (!read.ok) {
    // The folders on screen are left exactly as they were. A workspace that will not
    // load must not also be the reason the ones already open disappear.
    return announceWorkspace(read.problem);
  }

  extraWorkspaceFolders.length = 0;
  let folders: readonly string[] = [];
  for (const folder of read.workspace.folders) {
    folders = addFolderTo(folders, path.resolve(folder), pathsAreCaseInsensitive);
  }
  extraWorkspaceFolders.push(...folders);
  workspaceFilePath = resolved;
  workspaceLoopDefinitionKey = read.workspace.loopDefinitionKey;
  rememberWorkspace();

  // A folder that has since been moved or deleted is named rather than dropped. A
  // workspace that quietly came back one folder short would be worse than one that
  // says which one is missing.
  const missing = folders.filter((folder) => !fs.existsSync(folder));
  return announceWorkspace(
    missing.length === 0
      ? null
      : `${String(missing.length)} folder${missing.length === 1 ? '' : 's'} in this ` +
          `workspace ${missing.length === 1 ? 'is' : 'are'} not on this machine: ` +
          `${missing.join(', ')}. ${missing.length === 1 ? 'It is' : 'They are'} still ` +
          'listed so the workspace is not silently shorter than it was.',
  );
}

/**
 * Write the open folders and the chosen definition to a file.
 *
 * DSP-71 #5 is `workspaceFileText`'s doing: a workspace holds folders and a loop, and
 * there is no field in it for a run result.
 */
async function saveWorkspace(filePath: string | null): Promise<WorkspaceView> {
  let target = filePath ?? workspaceFilePath;
  if (filePath === null) {
    const picked = await dialog.showSaveDialog({
      title: 'Save workspace',
      defaultPath: workspaceFilePath ?? `my.${WORKSPACE_FILE_EXTENSION}`,
      filters: [{ name: 'DSpatch workspace', extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePath === undefined || picked.filePath === '') {
      return currentWorkspaceView();
    }
    target = picked.filePath;
  }
  if (target === null) {
    return currentWorkspaceView();
  }
  const resolved = path.resolve(target);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(
      resolved,
      workspaceFileText({
        folders: openWorkspaceFolders(),
        loopDefinitionKey: workspaceLoopDefinitionKey,
      }),
      'utf8',
    );
  } catch (error) {
    return announceWorkspace(
      `The workspace could not be saved to ${resolved}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  workspaceFilePath = resolved;
  rememberWorkspace();
  return announceWorkspace();
}

/**
 * The folders, the tree and the reading view, over IPC.
 *
 * Every handler here is a read or a change to a list of folders. None of them starts
 * a session, changes a working copy or touches a run — which is DSP-73 #3 as a
 * property of what is registered rather than of what the window happens to call.
 */
function registerWorkspaceIpc(): void {
  ipcMain.handle(WORKSPACE_FOLDERS, (): WorkspaceView => currentWorkspaceView());
  ipcMain.handle(
    ADD_WORKSPACE_FOLDER,
    (_event, folderPath: string | null): Promise<WorkspaceView> =>
      addWorkspaceFolder(folderPath),
  );
  ipcMain.handle(
    REMOVE_WORKSPACE_FOLDER,
    (_event, folderPath: string): WorkspaceView => removeWorkspaceFolder(folderPath),
  );
  ipcMain.handle(
    OPEN_WORKSPACE_FILE,
    (_event, filePath: string | null): Promise<WorkspaceView> => openWorkspace(filePath),
  );
  ipcMain.handle(
    SAVE_WORKSPACE_FILE,
    (_event, filePath: string | null): Promise<WorkspaceView> => saveWorkspace(filePath),
  );
  ipcMain.handle(
    READ_WORKSPACE_DIRECTORY,
    (_event, dirPath: string): DirectoryPage => readDirectoryPage(dirPath),
  );
  ipcMain.handle(
    READ_WORKSPACE_FILE,
    (_event, filePath: string): FileView => readFileForViewing(filePath),
  );
}

/**
 * What the last workspace was, read once at startup.
 *
 * **A saved workspace comes back; an unsaved arrangement does not.** Saving is the
 * deliberate act that says this set of folders is a thing worth having again, so a
 * workspace with a file behind it is reopened from that file — which is also why the
 * file rather than the store is the source of truth for its contents. An arrangement
 * that was only ever built up in a window restores its chosen loop definition and no
 * folders, because opening a folder is an act a person performs and a window that had
 * opened three of them before anyone asked would be the interface deciding the work.
 *
 * Nothing here starts a session or chooses a working copy. The tree shows roots; the
 * project a run works in is still opened by opening it.
 */
function restoreRememberedWorkspace(): void {
  const remembered = requireProjectStore().currentWorkspace();
  if (remembered === null) {
    return;
  }
  if (remembered.filePath === null) {
    workspaceLoopDefinitionKey = remembered.loopDefinitionKey;
    return;
  }
  void openWorkspace(remembered.filePath);
}

/**
 * Saved conversations.
 *
 * Beside the project file, in a directory of its own: one file per conversation, so a
 * single unreadable conversation costs that conversation rather than the whole
 * history, and the file that is being appended to during a run is small.
 *
 * `app.getVersion()` is stamped into every file. A conversation that cannot be read
 * by a later build should at least say which build wrote it.
 */
let conversationStore: ConversationStore | null = null;

function requireConversationStore(): ConversationStore {
  conversationStore ??= new ConversationStore(
    path.join(app.getPath('userData'), 'conversations'),
    app.getVersion(),
  );
  return conversationStore;
}

/**
 * Kept loop runs.
 *
 * Beside the conversations rather than inside them, and referenced from the record
 * rather than from the conversation. `CONVERSATION_FORMAT_VERSION` therefore does
 * not move, so DSP-25 #6 — existing saved conversations still open — is satisfied
 * by not breaking anything rather than by migration code that would itself need
 * proving.
 */
let runRecordStore: RunRecordStore | null = null;

function requireRunRecordStore(): RunRecordStore {
  runRecordStore ??= new RunRecordStore(path.join(app.getPath('userData'), 'loop-runs'));
  return runRecordStore;
}

/**
 * Where one run's results are filed (DSP-74).
 *
 * Beside that run's record, under `userData`, because a result is part of the record
 * of the run and not part of the project the run worked on. Putting it in a working
 * root would leave DSpatch's own bookkeeping in somebody's repository, and putting it
 * under the definition's folder would let a standalone definition write into whatever
 * project it was pointed at.
 */
function runResultsDir(runId: string): string {
  return path.join(app.getPath('userData'), 'loop-runs', runId, 'results');
}

/**
 * Write a copy of one conversation's file wherever the user chooses.
 *
 * A **byte-for-byte copy**, deliberately. The export is not a rendering of what
 * DSpatch understood: it is the record itself, which is what makes it useful for
 * the case it is most needed in — a file this build cannot read. Anything that
 * parsed first would be unable to export exactly the files most worth rescuing,
 * and would quietly drop fields written by a newer DSpatch.
 *
 * `DSPATCH_EXPORT_DIR` skips the dialog, which is how an automated run exercises
 * this. Interactively the dialog is the only thing that picks a path: the renderer
 * is sandboxed and never names one.
 */
async function exportConversation(
  conversationId: string,
): Promise<ConversationExportResult> {
  const store = requireConversationStore();
  const source = store.readBytes(conversationId);
  if (source.bytes === null) {
    return {
      kind: 'failed',
      message:
        `${source.error ?? 'the file could not be read'} Nothing was exported and ` +
        'nothing was changed.',
    };
  }

  const suggested = `${conversationId}.json`;
  const exportDir = process.env['DSPATCH_EXPORT_DIR'];
  let target: string;
  if (exportDir !== undefined && exportDir.trim() !== '') {
    target = path.resolve(exportDir.trim(), suggested);
  } else {
    const window = liveMainWindow();
    const options = {
      title: 'Export this conversation',
      defaultPath: suggested,
      buttonLabel: 'Export',
      filters: [
        { name: 'DSpatch conversation', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const chosen =
      window === null
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(window, options);
    if (chosen.canceled || chosen.filePath === undefined || chosen.filePath === '') {
      return {
        kind: 'cancelled',
        note: 'Nothing was exported. The conversation is untouched either way.',
      };
    }
    target = chosen.filePath;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source.bytes);
  } catch (error) {
    return {
      kind: 'failed',
      message:
        `The copy could not be written to ${target}: ${String(error)} The saved ` +
        'conversation itself has not been touched.',
    };
  }

  // Read back what was just written rather than reporting what was intended. The
  // two differ whenever the disk is full, a sync client rewrites the file, or the
  // path was not what it looked like.
  const written = fs.readFileSync(target);
  const sha256 = createHash('sha256').update(written).digest('hex');
  const sourceHash = createHash('sha256').update(source.bytes).digest('hex');
  const readBack = describeExportedFile(written);
  log(
    `exported ${conversationId}: ${String(written.byteLength)} bytes -> ${target} ` +
      `sha256=${sha256.slice(0, 16)} identical=${String(sha256 === sourceHash)} ` +
      `parsed=${String(readBack.parsed)}`,
  );
  return {
    kind: 'written',
    sourcePath: source.filePath,
    filePath: target,
    bytes: written.byteLength,
    sha256,
    identicalToSource: sha256 === sourceHash,
    readBack,
    // The opening sentence used to promise, unconditionally, that the copy could
    // be put back and opened again. For the corrupt files this export exists to
    // rescue, that is untrue — and the note went on to say so correctly a few
    // sentences later, which meant it contradicted itself. Report 008's finding 3.
    note:
      `A byte-for-byte copy of ${source.filePath}. ` +
      (readBack.parsed
        ? 'It is the same format DSpatch reads, so it can be put back in the ' +
          'conversations directory and opened again. '
        : 'It is as unreadable as its source, so it cannot be put back and opened ' +
          'again — it is a rescued copy of a damaged file, not a repaired one. ') +
      'Nothing was removed from it on the way out: whatever a command printed ' +
      'while you were working is in here as it was printed, and so is a base64 ' +
      'copy of the project files the session started from, so treat this file with ' +
      'the same care as the code and the output it contains.',
  };
}

/** What the exported bytes turn out to be, read back from the file just written. */
function describeExportedFile(bytes: Buffer): {
  readonly parsed: boolean;
  readonly conversationId: string | null;
  readonly formatVersion: number | null;
  readonly messageCount: number | null;
  readonly error: string | null;
} {
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        parsed: false,
        conversationId: null,
        formatVersion: null,
        messageCount: null,
        error: 'the copy is valid JSON but is not an object, exactly like its source.',
      };
    }
    const record = parsed as Record<string, unknown>;
    const messages = record['messages'];
    return {
      parsed: true,
      conversationId:
        typeof record['conversationId'] === 'string' ? record['conversationId'] : null,
      formatVersion:
        typeof record['formatVersion'] === 'number' ? record['formatVersion'] : null,
      messageCount: Array.isArray(messages) ? messages.length : null,
      error: null,
    };
  } catch (error) {
    return {
      parsed: false,
      conversationId: null,
      formatVersion: null,
      messageCount: null,
      error:
        `the copy does not parse: ${String(error)} That is expected when the file ` +
        'it was copied from does not parse either — the export is faithful, not ' +
        'repaired.',
    };
  }
}

/**
 * The cheap "is this a git repository" check for the list.
 *
 * Presence of a `.git` entry, which is a file rather than a directory inside a
 * worktree. The authoritative reading is done by `git` itself when a session
 * opens; this only decides what label the row carries.
 */
function hasGitEntry(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

/**
 * The sample projects DSpatch generated, as the window shows them (DSP-61).
 *
 * The note is written here rather than in the renderer because it is a statement
 * about what the main process will and will not delete, and that is where the
 * deleting happens.
 */
function describeSampleProjects(listing: SampleProjectListing): SampleProjectsView {
  const unmarked = listing.folders.filter((folder) => !folder.marked).length;
  const note =
    listing.folders.length === 0
      ? `Nothing is left in ${listing.root}. A new sample project is generated in a ` +
        'folder of its own each time, so none of them is reused.'
      : `${String(listing.folders.length)} sample ` +
        `${listing.folders.length === 1 ? 'project' : 'projects'} in ${listing.root}, ` +
        'all generated by DSpatch. Removing them frees the space and affects nothing ' +
        'else: your own project folders are never touched, saved conversations are ' +
        'kept separately, and a new session generates a fresh folder regardless.' +
        (unmarked === 0
          ? ''
          : ` ${String(unmarked)} of them ${unmarked === 1 ? 'predates' : 'predate'} ` +
            "DSpatch's marker file, so DSpatch knows " +
            `${unmarked === 1 ? 'it' : 'them'} by where ` +
            `${unmarked === 1 ? 'it sits' : 'they sit'} rather than by a marker inside.`);
  return {
    root: listing.root,
    folders: listing.folders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      marked: folder.marked,
      fileCount: folder.fileCount,
      lastChangedUtc: folder.lastChangedUtc,
      error: folder.error,
    })),
    inUse: listing.inUse,
    error: listing.error,
    note,
  };
}

function sampleProjectsView(): SampleProjectsView {
  return describeSampleProjects(chatService.listSampleProjects());
}

function projectListing(): ProjectListing {
  const state = requireProjectStore().read();
  const entries: ProjectListEntry[] = [];

  const describe = (
    projectPath: string,
    origin: ProjectListEntry['origin'],
    lastOpenedAtUtc: string | null,
    openCount: number | null,
  ): ProjectListEntry => {
    const exists = (() => {
      try {
        return fs.statSync(projectPath).isDirectory();
      } catch {
        return false;
      }
    })();
    return {
      path: projectPath,
      lastOpenedAtUtc,
      openCount,
      origin,
      exists,
      isGitRepository: exists ? hasGitEntry(projectPath) : null,
    };
  };

  if (startupProjectPath !== undefined && startupProjectPath.trim() !== '') {
    const resolved = path.resolve(startupProjectPath.trim());
    entries.push(describe(resolved, 'startup-environment', null, null));
  }
  for (const project of state.recentProjects) {
    // Windows paths differ in case without differing; Linux paths do not, and
    // folding case there would merge two genuinely different projects.
    const same = (left: string, right: string): boolean =>
      process.platform === 'win32'
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
    if (entries.some((entry) => same(entry.path, project.path))) {
      continue;
    }
    entries.push(
      describe(project.path, 'recent', project.lastOpenedAtUtc, project.openCount),
    );
  }

  return {
    formatVersion: state.formatVersion,
    storePath: state.filePath,
    entries,
    error: state.error,
    readOnly: state.readOnly,
  };
}

/**
 * The build identity written into `dist/` at build time, read once.
 *
 * Inside a packaged artifact this file lives in `app.asar` beside the compiled
 * main process, so `__dirname` finds it without knowing whether the app is
 * packaged. A missing file is reported as an unknown identity rather than as an
 * error: a developer running `tsc` by hand has no manifest, and that is not a
 * fault — it is simply an artifact nobody can identify.
 */
let buildIdentityRead: BuildIdentity | null | undefined;

function buildIdentity(): BuildIdentity | null {
  if (buildIdentityRead !== undefined) {
    return buildIdentityRead;
  }
  const file = path.join(__dirname, '..', 'build-identity.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      digest?: unknown;
      fileCount?: unknown;
      generatedAtUtc?: unknown;
      git?: { revision?: unknown; dirtyFileCount?: unknown };
    };
    if (typeof parsed.digest !== 'string') {
      buildIdentityRead = {
        digest: '',
        fileCount: 0,
        generatedAtUtc: '',
        gitRevision: null,
        gitDirtyFileCount: null,
        error: `${file} does not contain a digest, so this build cannot be identified.`,
      };
      return buildIdentityRead;
    }
    buildIdentityRead = {
      digest: parsed.digest,
      fileCount: typeof parsed.fileCount === 'number' ? parsed.fileCount : 0,
      generatedAtUtc:
        typeof parsed.generatedAtUtc === 'string' ? parsed.generatedAtUtc : '',
      gitRevision:
        typeof parsed.git?.revision === 'string' ? parsed.git.revision : null,
      gitDirtyFileCount:
        typeof parsed.git?.dirtyFileCount === 'number'
          ? parsed.git.dirtyFileCount
          : null,
      error: null,
    };
    return buildIdentityRead;
  } catch (error) {
    buildIdentityRead = {
      digest: '',
      fileCount: 0,
      generatedAtUtc: '',
      gitRevision: null,
      gitDirtyFileCount: null,
      error:
        `${file} could not be read (${String(error)}), so which sources this build ` +
        'was made from is unknown.',
    };
    return buildIdentityRead;
  }
}

function environmentInfo(): EnvironmentInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    rendererSource: rendererUrl === undefined ? 'built-files' : 'dev-server',
    packaged: app.isPackaged,
    build: buildIdentity(),
    versions: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    adapter: {
      id: chatService.adapterId(),
      capabilities: chatService.capabilities(),
    },
  };
}

async function disposeAdapterOnce(): Promise<void> {
  if (serviceDisposed) {
    return;
  }
  serviceDisposed = true;
  await chatService.dispose();
}

/**
 * Both startup conditions must hold: a loaded document is not a visible window,
 * and a visible window is not a painted renderer.
 */
let windowShown = false;
let rendererReady = false;
let pendingExitCode: number | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * The loop editor's own window, and the audience for a run's events.
 *
 * DSP-28 #1 puts a second window on screen, which turns two assumptions in this file
 * into defects. `mainWindow` was the only window, so `mainWindow?.webContents.send`
 * was a complete delivery; and `startEditorLoopRun` sent journal entries to
 * `event.sender`, the window that happened to invoke the run. Both are addressed the
 * same way: events belong to a run, every live window hears them, and the window
 * decides whether the event is about what it is showing.
 *
 * **One editor window, not many.** Asking for the editor while it is open focuses it.
 * Two editors of one file would be two drawings with no way to reconcile them, and
 * the second Save would silently overwrite the first author's work — the palette and
 * the inspector give no way even to notice. Focusing is also what the user almost
 * always means: the window is behind the chat, not missing.
 */
let editorWindow: BrowserWindow | null = null;

const runAudience = new LoopRunAudience();

/**
 * Who decides that the next work step starts, for whichever run is walking.
 *
 * One of these, not one per binding and not one per window. DSP-29 and DSP-30 are the
 * same mechanism from two angles, and two of it could disagree — paused but autonomous,
 * running but interactive — in front of Niclas before it disagreed in front of us. Both
 * run bindings hand this to the runner; every window reads the same report.
 */
const loopControl = new LoopRunController({
  publish: (report) => {
    runAudience.broadcastOn(LOOP_CONTROL_CHANNEL, report);
  },
});

/**
 * The main window, or `null` once there is no live one.
 *
 * `mainWindow?.webContents.send(…)` guards an **unset** reference, not a destroyed
 * one, and the two are not the same thing here. `before-quit` calls
 * `preventDefault()` and disposes the adapter asynchronously, so there is a real
 * interval in which the window has been torn down while the provider can still
 * emit an agent event. Electron answers any call on a destroyed object with
 * `TypeError: Object has been destroyed`, and with nothing to catch it that is the
 * uncaught exception Niclas sees on close.
 *
 * Every reader of `mainWindow` goes through here, so the rule is in one place
 * rather than repeated at each site and forgotten at the next one. It is the same
 * rule `LoopRunAudience.live()` already applies to the run audience: ask the object
 * whether it is still there, and drop it when it is not. Nothing is swallowed —
 * a destroyed window has no renderer left to show anything to.
 */
function liveMainWindow(): BrowserWindow | null {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

/**
 * Deliver to the main window's renderer, or to nobody.
 *
 * `webContents` is checked separately because it can be gone while the window
 * object is not, which is exactly the half-torn-down state a closing app spends
 * time in.
 */
function sendToMainWindow(channel: BridgeChannel, payload: unknown): void {
  const window = liveMainWindow();
  if (window === null || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}

/**
 * Deliver to every window this process has open.
 *
 * For facts about the workspace rather than about a conversation. The chosen loop
 * definition is one of those, and DSP-84 is why it matters: the editor is sometimes a
 * window of its own, and a selection announced only to the chat would leave the two
 * windows holding different answers to "which loop" — the exact drift the card forbids.
 */
function sendToEveryWindow(channel: BridgeChannel, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

/**
 * How long shutdown waits for the adapter to let go before leaving anyway.
 *
 * The provider path owns a local agent runtime and an on-disk store, and closing
 * those is worth waiting for — but only waiting. Eight seconds is longer than a
 * healthy close takes and short enough that a person who clicked the X does not
 * conclude the application is broken.
 */
const DISPOSE_TIMEOUT_MS = 8_000;

/**
 * Dispose, then end the process — and end it even if disposal never comes back.
 *
 * Both exit paths used to be `disposeAdapterOnce().finally(end)`, with nothing
 * bounding the wait. `chatService.dispose()` reaches a third-party agent runtime
 * we do not control, and a promise from it that never settles meant `end` was
 * never called: DSP-62's window that closes onto a process that stays up for
 * ever. `before-quit` made it worse by calling `preventDefault()` first, so the
 * hung disposal had also cancelled the quit that would otherwise have happened.
 *
 * The wait is kept because the cleanup is real; only its unboundedness is
 * removed. An application that will not close is a worse failure than one that
 * closes having said its cleanup did not finish, so the log states which of the
 * two happened and, when it did not finish, what may be left behind.
 */
function disposeThenEnd(end: () => void, path: string): void {
  const startedAt = Date.now();
  let ended = false;
  const finish = (outcome: string): void => {
    if (ended) {
      return;
    }
    ended = true;
    clearTimeout(timer);
    log(`shutdown (${path}) after ${String(Date.now() - startedAt)} ms: ${outcome}`);
    end();
  };
  const timer = setTimeout(() => {
    finish(
      `the adapter did not finish closing within ${String(DISPOSE_TIMEOUT_MS)} ms, ` +
        'so DSpatch is closing anyway. A provider agent runtime and its on-disk ' +
        'session store may still be open, and whatever the close itself would have ' +
        'written may be missing. The conversation is saved as the run goes, so what ' +
        'is at risk is the last step of the close rather than the history.',
    );
  }, DISPOSE_TIMEOUT_MS);
  disposeAdapterOnce().then(
    () => {
      finish('adapter closed');
    },
    (error: unknown) => {
      finish(`the adapter failed to close (${String(error)}). Closing anyway.`);
    },
  );
}

/** Dispose and exit. `app.quit()` would lose the exit code. */
function exitNow(code: number): void {
  disposeThenEnd(() => {
    app.exit(code);
  }, `exit ${String(code)}`);
}

/**
 * Exit with a code that actually propagates, but only after the window is shown.
 *
 * This wait addresses an observed failure. Exiting directly in `did-fail-load`,
 * before the window appeared, did not terminate the process: neither `app.exit()`
 * nor `process.exit()` worked, and timers stopped after `app.exit()`. One probe
 * hung for three minutes before external termination. Once the window had appeared
 * (including Chromium's error page), the process exited normally.
 *
 * This differs from the first run's finding that `app.quit()` loses the exit code.
 */
function exitWith(code: number): void {
  if (!windowShown) {
    pendingExitCode = code;
    log(`exit code ${String(code)} waiting for the window to be shown`);
    return;
  }
  exitNow(code);
}

/**
 * A picture of the finished window, when a run was asked for one.
 *
 * `DSPATCH_CHAT_SHOT` names the file. This exists because the thing being changed
 * is what the window *looks like*, and no count in a report answers that: the
 * check for a layout is a person comparing the window with what they asked for,
 * and a screenshot is how that reaches them. Nothing is captured unless the
 * variable is set, and a failure to capture never changes the run's exit code —
 * the run's result is about the window, not about this.
 */
async function captureWindowImage(label: string | null = null): Promise<boolean> {
  const target = process.env['DSPATCH_CHAT_SHOT'];
  if (target === undefined || target.trim() === '') {
    return false;
  }
  // A label writes beside the run's own picture rather than over it, so a trial
  // can take one at the moment it means something — the conversation while the
  // conversation is on screen — as well as at the end.
  const file =
    label === null
      ? target
      : path.join(
          path.dirname(target),
          `${path.basename(target, path.extname(target))}-${label.replace(/[^A-Za-z0-9._-]/g, '-')}.png`,
        );
  const window = liveMainWindow();
  if (window === null || window.webContents.isDestroyed()) {
    log('screenshot not taken: the window was already gone');
    return false;
  }
  try {
    const image = await window.webContents.capturePage();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    log(`screenshot written to ${file}`);
    return true;
  } catch (error) {
    log(`screenshot could not be written: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function completeSmokeRunIfReady(): void {
  if (!smokeMode || !windowShown || !rendererReady) {
    return;
  }
  const window = liveMainWindow();
  const bounds = window === null ? null : window.getBounds();
  log(
    'startup smoke test passed: window shown and renderer painted. ' +
      `visible=${String(window?.isVisible() ?? false)} ` +
      `bounds=${JSON.stringify(bounds)}`,
  );
  exitWith(EXIT_OK);
}

/**
 * The top application menu (DSP-60 #2).
 *
 * There was no menu at all until now — the standard one was removed because its
 * actions did nothing — and §9 asks for exactly this: a conventional menu bar, like
 * the one in the Cursor reference, holding the session details, identifiers, full
 * paths and diagnostics that used to sit above the conversation.
 *
 * It sends a command to the focused window and decides nothing itself. The window
 * owns what a command means, which keeps the menu from becoming a second way of
 * driving the application that behaves subtly differently from the first.
 */
/**
 * The menu items, by the command each one sends.
 *
 * Kept so a scripted run can press the real item. A renderer cannot see a native
 * menu bar at all, and with the project row gone the menu is the only way to the
 * session details and to another project — so a trial that could not reach it
 * would have to take the most recently moved part of the window on trust. The
 * only thing that reads this is the handler below, registered during a scripted
 * run and at no other time.
 */
const menuItemsByCommand = new Map<MenuCommand, Electron.MenuItem>();

/**
 * The graph file the File menu asked to have edited, until the editor takes it.
 *
 * DSP-85 #6. A standalone `.graph.json` is no longer reachable from the editor's own
 * controls — those are about loops now — so the File menu opens one, and the File menu
 * lives here. Three things make this a held value rather than a message: the press can
 * come from the chat window, the editor window may not exist yet, and a newly created
 * window is not listening when it is created. So the path waits and the editor takes it,
 * on mount and on the notification; taking clears it, which is what makes a double
 * delivery open the file once.
 */
let graphToEdit: string | null = null;

/**
 * The graph the editor has edited and not written, until a start asks about it (DSP-86).
 *
 * **Nothing here writes a file on its own.** The editor registers the drawing whenever
 * it becomes unsaved and clears it whenever it is saved, closed or replaced; the one
 * reader is the save-or-cancel at the start of a chat-loop run. Held in the main process
 * rather than asked for at start time because the question has to be answerable from the
 * window the run begins in, which is the chat and not the editor.
 */
let unsavedDrawing: UnsavedDrawing | null = null;

/**
 * Whether `Use loop` is ticked, held where a run ends rather than where it was ticked.
 *
 * DSP-86 #6: when a run ends, the Ready pulse has to come back to the entry step without
 * the person toggling the feature off and on. Only the chat window knows the tick — but
 * it tells the main process every time it moves, through `PREPARE_CHAT_LOOP`'s `wanted`,
 * so the main process already holds the fact. Recording it here rather than re-announcing
 * from the chat window is what makes the pulse return while the person is looking at the
 * graph view: in a window on `#editor` the chat is not mounted at all, and a restoration
 * that lived there would fire for nobody in the one place it is meant to be seen.
 */
let chatLoopIntended = false;

/**
 * What the unsaved-drawing question answers during a scripted window run.
 *
 * Beside `DSPATCH_PICK_FILE`, for the same reason and with the same limits: a native
 * message box cannot be driven from a renderer, so without this the gestures DSP-86 and
 * DSP-88 add would be dialogs a trial could provoke and never answer. This is the
 * *answer*. The registration, the question, the write and what follows are the real ones.
 *
 * One queue for both occasions, because it is one question: the answers are consumed in
 * the order the window is asked, whether the asking was a run starting or a switch.
 * `DSPATCH_SAVE_BEFORE_RUN` is DSP-86's name for it and still works, so that harness's
 * recorded invocations mean what they meant; `DSPATCH_UNSAVED_DRAWING` is the name that
 * says what it now covers.
 */
const scriptedUnsavedDrawingAnswers: string[] = chatRunMode
  ? (process.env['DSPATCH_UNSAVED_DRAWING'] ?? process.env['DSPATCH_SAVE_BEFORE_RUN'] ?? '')
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  : [];

/**
 * Ask what to do with the editor's unsaved drawing, before the thing that would lose it.
 *
 * DSP-86's *never quietly run an older version than the one on screen*, and DSP-88's
 * *informing is not preserving*. One dialog, two occasions, described by one function in
 * `shared/unsaved-drawing.ts` — see there for why the wording is not written here.
 *
 * A scripted answer of `discard` for a run reads as `cancel`, because the run's question
 * does not offer it and a harness must not be able to drive a button nobody has.
 */
async function askAboutUnsavedDrawing(
  drawing: UnsavedDrawing,
  occasion: UnsavedDrawingOccasion,
): Promise<UnsavedDrawingAnswer> {
  const question = describeUnsavedDrawingQuestion({
    path: drawing.path,
    graphName: drawing.graphName,
    occasion,
  });
  if (chatRunMode) {
    const asked = scriptedUnsavedDrawingAnswers.shift() ?? 'cancel';
    const answer = question.answers.find((offered) => offered === asked) ?? 'cancel';
    log(`scripted unsaved-drawing question (${occasion}) answered ${answer} for ${drawing.path}`);
    return answer;
  }
  const chosen = await dialog.showMessageBox({
    type: 'question',
    buttons: [...question.buttons],
    defaultId: question.cancelId,
    cancelId: question.cancelId,
    title: question.title,
    message: question.message,
    detail: question.detail,
  });
  return question.answers[chosen.response] ?? 'cancel';
}

/**
 * Write the drawing the person just said to save, and tell the editor it was written.
 *
 * Both callers of the question need all three of these together — the write, forgetting
 * the registration, and the broadcast — and DSP-86 had them inline in the run's start.
 * A second copy is how a switch comes to write the file and leave the editor still
 * reporting changes that are now on disk. `null` for written; the note otherwise.
 */
function writeUnsavedDrawing(
  drawing: UnsavedDrawing,
  occasion: UnsavedDrawingOccasion,
): string | null {
  try {
    fs.writeFileSync(drawing.path, drawing.text, 'utf8');
  } catch (error) {
    return `DSpatch could not write ${drawing.path}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  unsavedDrawing = null;
  // The editor is comparing its drawing against what it last wrote, so it has to be
  // told, or it goes on reporting unsaved changes it no longer has.
  sendToEveryWindow(GRAPH_SAVED_ELSEWHERE, {
    path: drawing.path,
    text: drawing.text,
    occasion,
  } satisfies GraphSavedElsewhere);
  log(`wrote the editor's drawing at the ${occasion} question: ${drawing.path}`);
  return null;
}

/**
 * Settle the unsaved drawing before something draws over the canvas (DSP-88).
 *
 * The three gestures that redraw — the loop chooser, **Open loop…** and
 * **File → Open Graph File…** — all used to say the drawing had never been written and
 * then discard it. This is the ask that has to happen first, and it is deliberately
 * *before* the switch is carried out rather than beside it: `go: false` means the caller
 * returns having recorded nothing, drawn nothing and moved nothing.
 *
 * It is asked about whatever drawing is registered, not only about the file being opened.
 * A run's question matches the path because a run reads one file; a redraw loses the
 * drawing whichever file is coming next.
 */
async function settleUnsavedDrawingBeforeRedraw(): Promise<
  | { readonly go: true; readonly answered: 'save' | 'discard' | null }
  | { readonly go: false; readonly note: string }
> {
  const drawing = unsavedDrawing;
  if (drawing === null) {
    return { go: true, answered: null };
  }
  const answer = await askAboutUnsavedDrawing(drawing, 'switch');
  if (answer === 'cancel') {
    return { go: false, note: describeSwitchKept(drawing.path) };
  }
  if (answer === 'discard') {
    /*
     * Forgotten here, immediately, and not left to the editor's own effect.
     *
     * The person threw these edits away. A registration that outlived the answer would
     * let a run a minute later offer to save work they discarded — the same reason
     * closing the editor window clears it. The editor clears it again when the redraw
     * lands; this is the half that does not depend on a window being open to hear it.
     */
    unsavedDrawing = null;
    log(`the editor's drawing was discarded on the person's say-so: ${drawing.path}`);
    return { go: true, answered: 'discard' };
  }
  const failure = writeUnsavedDrawing(drawing, 'switch');
  return failure === null
    ? { go: true, answered: 'save' }
    : { go: false, note: `Nothing was switched. ${failure}` };
}

/**
 * Ask for a graph file and hand it to the loop editor for editing.
 *
 * **It opens a window and reads nothing.** The file is read by `OPEN_LOOP_GRAPH` when
 * the editor asks for it, by the same path every other open takes, so a graph reached
 * from the menu is validated and refused exactly as one reached any other way.
 *
 * Choosing here selects nothing. A `.graph.json` has no declaration behind it and so is
 * not a loop the next mandate could walk — DSP-84 established that and DSP-85 keeps it
 * true of the chooser's displayed state as well, which is why this deliberately does not
 * go near `noteChosenLoopDefinition`.
 */
async function openGraphFileForEditing(): Promise<void> {
  let chosen: string | null = null;
  if (chatRunMode) {
    chosen = scriptedFilePick('Open Graph File…');
  } else {
    const picked = await dialog.showOpenDialog({
      title: 'Open a graph file for editing',
      defaultPath:
        ownRepoRoot === null ? undefined : path.join(ownRepoRoot, 'docs', 'loop', 'graphs'),
      filters: [{ name: 'Loop graph', extensions: ['json'] }],
      properties: ['openFile'],
    });
    chosen = picked.canceled ? null : (picked.filePaths[0] ?? null);
  }
  if (chosen === null) {
    return;
  }
  /*
   * **It asks about an unsaved drawing too, and here is the reason** (DSP-88).
   *
   * The card left this one to be decided. It asks, because the harm is defined by what
   * happens to the drawing and not by which control the gesture came from: this menu item
   * draws a standalone `.graph.json` over the very same canvas, through the very same
   * `open`, and the work it can take away is the work the chooser can take away. A person
   * who has to know that two of the three ways in protect their edits and the third does
   * not is being asked to keep a map of DSpatch's internals.
   *
   * It is asked after the file has been picked rather than before. A dismissed file
   * chooser is not a switch, and a question about losing a drawing that then turns out to
   * be about nothing is the kind of dialog people learn to dismiss without reading.
   */
  const settled = await settleUnsavedDrawingBeforeRedraw();
  if (!settled.go) {
    log(`Open Graph File… stopped at the unsaved-drawing question; ${chosen} was not opened`);
    return;
  }
  graphToEdit = path.resolve(chosen);
  log(`File menu asked for ${graphToEdit} to be edited; nothing was chosen or started`);
  // Focus or create first, so a taken path always has a window that will ask for it.
  openLoopEditorWindow();
  // Every window: only the editor listens, and the editor may be the main window on the
  // `#editor` hash rather than a window of its own.
  sendToEveryWindow(GRAPH_TO_EDIT, null);
}

function installApplicationMenu(): void {
  const tell = (command: MenuCommand): void => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused !== null && !focused.isDestroyed() && !focused.webContents.isDestroyed()) {
      focused.webContents.send(MENU_COMMAND, command);
      return;
    }
    sendToMainWindow(MENU_COMMAND, command);
  };

  const menu = Menu.buildFromTemplate([
      {
        // `&File` since DSP-71: the menu is no longer about one project. Opening a
        // folder, adding one beside it and saving the arrangement are all here,
        // which is where a person looks for them.
        label: '&File',
        submenu: [
          {
            label: 'Open Folder…',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              tell('change-project');
            },
          },
          {
            // Adds a root to the tree, a folder to the loop-definition search, and
            // since DSP-72 a working folder to any loop run started afterwards. It
            // does not move the working directory: that stays the project the chat
            // session opened. See `extraWorkspaceFolders`.
            label: 'Add Folder to Workspace…',
            click: () => {
              void addWorkspaceFolder(null);
            },
          },
          { type: 'separator' },
          {
            // The way to a standalone drawing since DSP-85. The editor's own controls
            // choose loops, and a `.graph.json` is not a loop: it has no declaration
            // behind it, so it cannot be what a mandate walks. Opening one here draws it
            // for editing and leaves the chosen loop exactly where it was, which is the
            // separation DSP-84 established and this card had to keep true of the
            // chooser's displayed state as well.
            label: 'Open Graph File…',
            click: () => {
              void openGraphFileForEditing();
            },
          },
          { type: 'separator' },
          {
            label: 'Open Workspace…',
            click: () => {
              void openWorkspace(null);
            },
          },
          {
            label: 'Save Workspace As…',
            click: () => {
              void saveWorkspace(null);
            },
          },
          { type: 'separator' },
          {
            // Shows the list; the removing is a button beside it. DSP-61: clearing
            // out old sample projects is a separate act a person performs, and a
            // menu item that deleted folders on click would not be one.
            label: 'Old sample projects…',
            click: () => {
              tell('show-sample-projects');
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: '&Session',
        submenu: [
          {
            label: 'Session details, identifiers and diagnostics',
            accelerator: 'CmdOrCtrl+I',
            click: () => {
              tell('show-session-details');
            },
          },
          {
            label: 'Back to the conversation',
            accelerator: 'Escape',
            click: () => {
              tell('hide-session-details');
            },
          },
        ],
      },
      {
        label: '&View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          {
            // DSP-86 #9. The journal was a pane under the canvas, opening itself whenever
            // a run had written anything — diagnostics taking a third of the height of
            // the one graph view the card is about. It is the same journal and the same
            // entries; what changed is that it is asked for.
            label: 'Run journal (diagnostics)',
            click: () => {
              tell('show-run-journal');
            },
          },
        ],
      },
  ]);
  Menu.setApplicationMenu(menu);
  menuItemsByCommand.clear();
  for (const [command, label] of [
    ['change-project', 'Open Folder…'],
    ['open-graph-file', 'Open Graph File…'],
    ['show-run-journal', 'Run journal (diagnostics)'],
    ['show-sample-projects', 'Old sample projects…'],
    ['show-session-details', 'Session details, identifiers and diagnostics'],
    ['hide-session-details', 'Back to the conversation'],
  ] as const) {
    const found = menu.items
      .flatMap((item) => item.submenu?.items ?? [])
      .find((entry) => entry.label === label);
    if (found !== undefined) {
      menuItemsByCommand.set(command, found);
    }
  }
  // Logged because a menu bar is the one part of the window a script in the
  // renderer cannot see at all. Without this, "the details are behind a real
  // application menu" would be a claim with nothing behind it.
  log(
    `menu ${menu.items
      .map(
        (item) =>
          `${item.label}[${(item.submenu?.items ?? [])
            .map((entry) => entry.label || entry.role || entry.type)
            .join('|')}]`,
      )
      .join(' ')}`,
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#101317',
    title: 'DSpatch',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // No navigation and no additional windows. A second window is opened by the main
  // process on request (`openLoopEditorWindow`), never by renderer script.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Held now, while the window is alive, because `closed` must not ask for it.
  // See the handler below: that question is what kept DSpatch running.
  const contents = window.webContents;
  runAudience.add(contents);
  window.on('closed', () => {
    // Only the bookkeeping. Closing a window must not touch a run: DSP-28 #1 says the
    // chat and any running loop keep working while the editor is open, and #5 says
    // looking is never doing. A run that ended because its last viewer closed would
    // be exactly the opposite.
    //
    // **`contents`, not `window.webContents`** — DSP-62. By the time `closed` runs
    // the window is destroyed, and asking a destroyed `BrowserWindow` for a property
    // throws `TypeError: Object has been destroyed`. During an ordinary close that is
    // merely an uncaught exception; during `app.exit()` it is fatal to the exit
    // itself, because Electron emits `closed` while tearing the process down and a
    // listener that throws there leaves the shutdown half-finished: the window goes,
    // the timers stop, and the process never ends. Measured — with this handler
    // reading `window.webContents` the process outlived `app.exit(0)` indefinitely,
    // and with the reference captured here it exits in under a second.
    //
    // The `Set` only needs identity, so a destroyed `WebContents` is a perfectly
    // good key to delete by.
    runAudience.remove(contents);
    // The reference too, or it outlives the window it names. Guarded on identity so
    // a stale `closed` from an earlier window cannot unset a newer one.
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('show', () => {
    log(`window shown bounds=${JSON.stringify(window.getBounds())}`);
    windowShown = true;
    if (pendingExitCode !== null) {
      exitNow(pendingExitCode);
      return;
    }
    completeSmokeRunIfReady();
    startProbeIfRequested();
  });

  window.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${window.webContents.getURL()}`);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      log(
        `did-fail-load url=${validatedURL} code=${String(errorCode)} ` +
          `description=${errorDescription}`,
      );
      if (smokeMode || chatRunMode) {
        exitWith(EXIT_LOAD_FAILED);
      }
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details.reason}`);
    if (smokeMode || chatRunMode) {
      exitWith(EXIT_RENDERER_GONE);
    }
  });

  if (rendererUrl === undefined) {
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
    log(`loading built files: ${indexPath}`);
    void window.loadFile(indexPath);
  } else {
    log(`loading development server: ${rendererUrl}`);
    void window.loadURL(rendererUrl);
  }

  return window;
}

/**
 * Open the loop editor beside the chat, or bring it to the front.
 *
 * DSP-28 #1. **Non-modal, and no parent.** A modal child would freeze the chat, which
 * is the one thing the criterion forbids: the conversation and any running loop must
 * keep working while the editor is open. It is a sibling window with its own taskbar
 * entry, and the two can be arranged side by side, which is the whole point.
 *
 * It loads the same renderer bundle on the `#editor` hash rather than a second HTML
 * entry, so `npm run editor` — which does exactly this by putting the hash on the URL
 * it hands Electron — is unchanged and keeps working.
 *
 * **Opening starts nothing.** No run, no provider call, no file written. The window
 * asks what is already running (`CURRENT_LOOP_RUN`) and that is a read.
 */
function openLoopEditorWindow(): LoopEditorWindowOutcome {
  const existing = editorWindow;
  if (existing !== null && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.focus();
    log('loop editor window focused (already open)');
    return {
      kind: 'focused',
      note: 'The loop editor is already open. It has been brought to the front — one editor, so two windows cannot edit the same file behind each other.',
    };
  }

  try {
    const window = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 560,
      show: false,
      backgroundColor: '#101317',
      title: 'DSpatch — loop editor',
      // Deliberately no `parent` and no `modal`. See above.
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    editorWindow = window;

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Held while the window is alive; `closed` must not ask a destroyed window for
    // it. Same rule and same reason as the chat window above (DSP-62).
    const contents = window.webContents;
    runAudience.add(contents);

    window.once('ready-to-show', () => {
      window.show();
    });
    window.on('closed', () => {
      runAudience.remove(contents);
      if (editorWindow === window) {
        editorWindow = null;
      }
      /*
       * The unsaved drawing goes with the window that held it (DSP-86).
       *
       * Closing the editor discards unsaved edits — there is no save-on-close and this
       * card does not add one. So a later run must not offer to save a drawing nobody
       * can see any more: that would be resurrecting work the person threw away, and
       * writing it to disk on a "Save and run" they thought was about something else.
       * Cleared here rather than in the renderer's unmount, because a destroyed
       * renderer does not reliably run one.
       */
      unsavedDrawing = null;
      // Nothing else. A run in progress is untouched by the view closing, and the
      // chat window is untouched by both.
      log('loop editor window closed; no run was affected');
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      log(
        `loop editor did-fail-load url=${validatedURL} code=${String(errorCode)} ` +
          `description=${errorDescription}`,
      );
    });

    // `window=editor` tells the renderer this window exists only to be the editor, so it
    // does not offer "Back to chat" and cannot become a second chat window on one
    // session. `npm run editor` does not set it and is therefore unchanged.
    if (rendererUrl === undefined) {
      const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
      void window.loadFile(indexPath, { hash: 'editor', search: 'window=editor' });
    } else {
      // The hash the development server URL may already carry is replaced rather than
      // appended to: `npm run editor` sets `#editor` on it, and `…#editor#editor` is
      // not the same URL.
      const base = rendererUrl.split('#')[0] ?? rendererUrl;
      void window.loadURL(`${base}${base.includes('?') ? '&' : '?'}window=editor#editor`);
    }

    log('loop editor window opened');
    return {
      kind: 'opened',
      note: 'The loop editor is open in its own window. The chat and any running loop are unaffected; closing the editor leaves them as they are.',
    };
  } catch (error) {
    editorWindow = null;
    return {
      kind: 'failed',
      note: `The loop editor window could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function startProbeIfRequested(): void {
  if (!probeMode || probeStarted) {
    return;
  }
  probeStarted = true;
  const repoRoot = probeRepoRoot();
  log(`connection probe starting. repo root treated as ${repoRoot}`);
  void runCursorProbe(repoRoot).then(
    ({ exitCode }) => {
      log(`connection probe finished with exit code ${String(exitCode)}`);
      exitNow(exitCode);
    },
    (error: unknown) => {
      log(`connection probe threw outside its own handling: ${String(error)}`);
      exitNow(PROBE_EXIT.unexpectedError);
    },
  );
}

/**
 * Write the scripted run's record.
 *
 * The renderer's own observations and the main process's are kept apart on
 * purpose: what the DOM showed and what was on disk are different kinds of
 * evidence and must not be presented as one.
 */
function writeChatRunRecord(report: ScriptedRunReport | null): void {
  const target = process.env['DSPATCH_CHAT_LOG'];
  if (target === undefined || target.trim() === '') {
    return;
  }
  const record = {
    run:
      chatRunScenario === 'interactive-chat'
        ? 'DSP-2 substeps 1 and 2 — an existing project opened and two turns, driven through the window'
        : chatRunScenario === 'review-and-test'
          ? 'DSP-2 substeps 3 and 4 — diff review and a build/test result that has to go stale, driven through the window'
          : chatRunScenario === 'conversation-during-work'
            ? 'INTERACTION_MODEL §10 trials 4, 10 and 11 — one thread with a handover, two messages sent into a working run, and an interrupted run, driven through the window'
            : chatRunScenario === 'errors-read-well'
              ? 'DSP-64 and DSP-61 — the refusal for a directory DSpatch did not generate, read as a person meets it, driven through the window with no provider call'
              : chatRunScenario === 'chosen-loop-runs'
                ? 'DSP-70 — the loop definitions a window offers, and which graph reaches the screen when one is chosen, with no provider call'
                : chatRunScenario === 'chat-loop-files-a-result'
                ? 'DSP-79 — the window\u2019s own chat-loop run files a result, opens a session per agent node and hands the first step\u2019s words to the second, with no provider call'
                : chatRunScenario === 'several-working-roots'
                  ? 'DSP-72 — two working folders, a definition filed outside both, and the refusal that names the offending root, with no provider call'
                  : chatRunScenario === 'loop-open-choose-run'
                    ? 'DSP-85 — a loop chosen in the graph editor, by dropdown and by file, drawn by the same gesture, and the graph the run that follows actually announced, with no provider call'
                    : chatRunScenario === 'one-graph-view'
                      ? 'DSP-86 — one graph view before, during and after a run: the same layout, zoom, pan and selected node either side of a run, locked while it walks and unlocked by itself when it ends, with no provider call'
                      : chatRunScenario === 'unsaved-edits-survive-a-switch'
                        ? 'DSP-88 — an unsaved drawing put to the dropdown, Open loop… and File → Open Graph File…, answered Save, Discard changes and Cancel, with what the window showed and what reached the disk read for each, and no provider call'
                        : 'DSP-1 substep 7 — the whole workflow driven through the window',
    scenario: chatRunScenario,
    startupProjectPath: startupProjectPath ?? null,
    startedAtUtc: chatRunStartedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    rendererSource: rendererUrl === undefined ? 'built-files' : 'dev-server',
    appPath: app.getAppPath(),
    execPath: process.execPath,
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    renderer: report,
    main: chatService.evidence(),
  };
  try {
    const resolved = path.resolve(target);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    log(`chat run record written: ${resolved}`);
  } catch (error) {
    log(`could not write the chat run record: ${String(error)}`);
  }
}

const chatRunStartedAtUtc = new Date().toISOString();
let chatRunReported = false;

/**
 * Drive the editor's own Dry-run from the window, behind DSPATCH_EDITOR_AUTORUN.
 * Default `npm run editor` does not set that, so ordinary use is unchanged.
 */
function startEditorAutorun(): void {
  const win = liveMainWindow();
  if (win === null) {
    log('editor-autorun: no window');
    return;
  }
  const shouldExit = process.env['DSPATCH_EDITOR_AUTORUN_EXIT'] === '1';
  const outPath = process.env['DSPATCH_EDITOR_AUTORUN_OUT'];
  setTimeout(() => {
    if (win.isDestroyed()) {
      log('editor-autorun: the window closed before the run started');
      return;
    }
    void win.webContents
      .executeJavaScript(
        `(() => {
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          return (async () => {
            for (let i = 0; i < 40; i += 1) {
              if (window.__dspatchEditorCheck) {
                break;
              }
              await wait(250);
            }
            const api = window.__dspatchEditorCheck;
            if (!api) {
              return { ok: false, reason: 'editor check api missing' };
            }
            const first = await api.dryRunCurrent();
            const buttons = [...document.querySelectorAll('button')].map((button) => ({
              text: button.textContent.trim(),
              disabled: button.disabled,
            }));
            const second = await api.dryRunRedirectedE08();
            const journal = document.querySelector('.editor-journal')?.innerText ?? '';
            return {
              ok: Boolean(first && second && first.path !== second.path && first.usage.includes('0 provider turns')),
              first,
              second,
              buttons,
              journal: journal.slice(0, 2500),
            };
          })();
        })()`,
      )
      .then((result: { readonly ok?: boolean } | null) => {
        log(`editor-autorun ${JSON.stringify(result)}`);
        if (outPath !== undefined && outPath !== '') {
          fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
          log(`editor-autorun written ${outPath}`);
        }
        if (shouldExit) {
          exitWith(result?.ok === true ? 0 : 1);
        }
      })
      .catch((error: unknown) => {
        log(`editor-autorun failed: ${String(error)}`);
        if (shouldExit) {
          exitWith(1);
        }
      });
  }, 800);
}

/**
 * Photograph the node panel for named nodes, behind DSPATCH_EDITOR_PANEL_SHOT.
 *
 * DSP-83. What Niclas asked to see is a layout — the role legible with Advanced closed,
 * and the same panel with Advanced open — and there is no count that answers it. But a
 * screenshot is only evidence if the thing it is meant to show is in it, so the trial
 * reads `roleChars` and `roleVisibleHeight` back out of the panel and fails on an
 * illegible capture instead of saving one and calling it proof.
 *
 * `DSPATCH_EDITOR_PANEL_SHOT` names the graph to open and the nodes to visit:
 *   <graph path>|<node id>,<node id>,...
 * Pictures go beside DSPATCH_CHAT_SHOT, labelled `<node>-advanced-closed` and `-open`.
 * A loop definition path is opened as a definition, which is also how this doubles as
 * the window check that choosing a loop by its declaration still opens it.
 */
function startPanelTrial(): void {
  const spec = process.env['DSPATCH_EDITOR_PANEL_SHOT'];
  const win = liveMainWindow();
  if (spec === undefined || spec.trim() === '' || win === null) {
    return;
  }
  const [graphPath = '', nodeList = ''] = spec.split('|');
  const nodes = nodeList
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const shouldExit = process.env['DSPATCH_EDITOR_AUTORUN_EXIT'] === '1';
  const outPath = process.env['DSPATCH_EDITOR_AUTORUN_OUT'];
  const definition = graphPath.endsWith('.loop.json');

  const steps: unknown[] = [];
  const fail = (reason: string): void => {
    log(`panel-trial failed: ${reason}`);
    if (outPath !== undefined && outPath !== '') {
      fs.writeFileSync(
        outPath,
        `${JSON.stringify({ ok: false, reason, graphPath, steps }, null, 2)}\n`,
        'utf8',
      );
    }
    if (shouldExit) {
      exitWith(1);
    }
  };

  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (win.isDestroyed()) {
      fail('the window closed before the trial started');
      return;
    }

    // The editor opens its own drawing on startup, so the hook is there by now; wait
    // for it rather than assume the timing.
    for (let i = 0; i < 40; i += 1) {
      const ready = (await win.webContents.executeJavaScript(
        'Boolean(window.__dspatchEditorCheck)',
      )) as boolean;
      if (ready) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // Through the renderer's own open(), because the bridge only reads a file: the
    // renderer is what resolves the roles, validates and draws. A trial that went
    // straight to the bridge would report a file it read and never notice the canvas
    // stayed empty.
    const request = definition
      ? { kind: 'definition' as const, path: graphPath }
      : { kind: 'path' as const, path: graphPath };
    const opened = (await win.webContents.executeJavaScript(
      `window.__dspatchEditorCheck.openTarget(${JSON.stringify(request)})`,
    )) as { readonly headerText: string; readonly noteText: string; readonly nodesDrawn: number };
    steps.push({ step: 'open', request: request.kind, ...opened });
    if (opened.nodesDrawn === 0) {
      fail(`${graphPath} put nothing on the canvas: ${opened.noteText}`);
      return;
    }
    // The editor already has its own drawing open when the trial starts, so "something
    // is on the canvas" is not evidence that it is the right something.
    if (definition) {
      if (!opened.noteText.includes('Opened the loop "')) {
        fail(`the definition was not opened as a loop: ${opened.noteText}`);
        return;
      }
    } else if (!opened.headerText.includes(path.basename(graphPath))) {
      fail(`the canvas is showing something else: ${opened.headerText}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Three pictures per node. Closed is the layout being judged; open shows that the
    // technical settings are there and readable; and one at the limits, because
    // "Maximum correction rounds" with its units and its inherited value is the
    // criterion, and no count can stand in for reading it.
    const views: readonly {
      readonly advanced: boolean;
      readonly anchor?: string;
      readonly label: string;
      readonly measure?: 'brief';
    }[] = [
      { advanced: false, label: 'advanced-closed' },
      // What the agent is actually told, as text (DSP-94). Its own picture because the
      // instructions are below the role in the panel, and a capture of the panel's top
      // shows that a heading exists rather than that the wording can be read.
      { advanced: false, anchor: '[data-ev="node-brief"]', label: 'instructions', measure: 'brief' },
      { advanced: true, label: 'advanced-open' },
      { advanced: true, anchor: '[data-ev="node-limits"]', label: 'advanced-limits' },
      { advanced: true, anchor: '[data-ev="node-routing"]', label: 'advanced-routing' },
    ];

    for (const id of nodes) {
      for (const view of views) {
        const { advanced } = view;
        const shown = (await win.webContents.executeJavaScript(
          `window.__dspatchEditorCheck.showNode(${JSON.stringify(id)}, ${String(advanced)}, ${
            view.anchor === undefined ? 'undefined' : JSON.stringify(view.anchor)
          })`,
        )) as Record<string, unknown> | null;
        if (shown === null) {
          fail(`there is no node called ${id} in ${graphPath}`);
          return;
        }
        // Long enough for React to paint the opened section before the shutter.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const captured = await captureWindowImage(`${id}-${view.label}`);
        steps.push({ step: 'panel', view: view.label, captured, ...shown });
        if (shown['advancedOpen'] !== advanced) {
          fail(`${id}: Advanced should be ${advanced ? 'open' : 'closed'} and was not`);
          return;
        }
        // The claims a picture cannot make for itself. 240px is about a dozen lines —
        // the difference between a capture that shows the role and one that shows that a
        // role box exists.
        if (Number(shown['roleChars'] ?? 0) < 400) {
          fail(`${id}: only ${String(shown['roleChars'])} characters of role text on screen`);
          return;
        }
        const wanted =
          view.measure === 'brief'
            ? 'briefVisibleHeight'
            : advanced
              ? 'advancedVisibleHeight'
              : 'roleVisibleHeight';
        const named =
          view.measure === 'brief'
            ? 'the instructions this step is sent'
            : advanced
              ? 'the Advanced section'
              : 'the role text';
        if (Number(shown[wanted] ?? 0) < 240) {
          fail(
            `${id} (${view.label}): only ${String(shown[wanted])}px of ${named} is on ` +
              'screen, so this capture is not evidence',
          );
          return;
        }
      }
    }

    log(`panel-trial ok nodes=${String(nodes.length)}`);
    if (outPath !== undefined && outPath !== '') {
      fs.writeFileSync(
        outPath,
        `${JSON.stringify({ ok: true, graphPath, steps }, null, 2)}\n`,
        'utf8',
      );
      log(`panel-trial written ${outPath}`);
    }
    if (shouldExit) {
      exitWith(0);
    }
  })().catch((error: unknown) => {
    fail(String(error));
  });
}

function registerIpc(): void {
  ipcMain.handle(GET_ENVIRONMENT, () => environmentInfo());

  let readyReported = false;
  ipcMain.on(RENDERER_READY, (_event, ready: RendererReady) => {
    if (readyReported) {
      return;
    }
    readyReported = true;
    log(
      `renderer-ready heading="${ready.headingText}" ` +
        `capabilities=${String(ready.capabilityCount)} at=${ready.renderedAt}`,
    );
    rendererReady = true;
    completeSmokeRunIfReady();
    if (process.env['DSPATCH_EDITOR_AUTORUN'] === '1' && ready.headingText === 'Loop editor') {
      startEditorAutorun();
    }
    if (ready.headingText === 'Loop editor') {
      startPanelTrial();
    }
  });

  ipcMain.handle(GET_CONNECTION, () => chatService.getConnection());

  /**
   * The model the next ordinary message is sent to (DSP-60 #3).
   *
   * Returns what is actually in force rather than what was asked for, so the
   * window states a fact instead of echoing its own request.
   */
  ipcMain.handle(SET_MODEL, (_event, modelId: string): string => {
    const inForce = chatService.setRequestedModel(modelId);
    log(`model requested for the next message: ${inForce}`);
    return inForce;
  });

  /**
   * The folder picker.
   *
   * Opened here, in the main process, because the renderer is sandboxed and has
   * no file system access at all — and should keep none. The dialog is modal to
   * the window so it cannot be lost behind it.
   */
  ipcMain.handle(PICK_PROJECT, async (): Promise<ProjectPickOutcome> => {
    const window = liveMainWindow();
    const options = {
      title: 'Choose a project folder',
      buttonLabel: 'Open this project',
      properties: ['openDirectory' as const, 'dontAddToRecent' as const],
    };
    const result =
      window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(window, options);
    const chosen = result.filePaths[0];
    if (result.canceled || chosen === undefined) {
      log('folder picker cancelled');
      return { kind: 'cancelled' };
    }
    log(`folder picker chose ${chosen}`);
    return { kind: 'chosen', path: chosen };
  });

  ipcMain.handle(LIST_PROJECTS, () => projectListing());

  /**
   * Forget remembered projects.
   *
   * The renderer names paths it was just shown, and this only ever edits one list
   * in DSpatch's own settings file. Nothing here deletes a folder, and nothing here
   * touches the conversation store — a conversation whose project has been
   * forgotten is still saved, still listed and still openable.
   *
   * The reply carries the freshly read listing rather than a mutated copy of what
   * the renderer had, so what the window shows next is what the file now says.
   */
  ipcMain.handle(FORGET_PROJECTS, (_event, projectPaths: readonly string[]) => {
    const asked = Array.isArray(projectPaths) ? projectPaths : [];
    const outcome = requireProjectStore().forget(asked);
    log(
      `forget-projects: asked for ${String(asked.length)}, removed ` +
        `${String(outcome.removed.length)}` +
        (outcome.state.error === null ? '' : `, error: ${outcome.state.error}`),
    );
    const projects = projectListing();
    const note =
      outcome.removed.length === 0
        ? outcome.state.error === null
          ? 'Nothing was removed: none of those projects was in the list. No ' +
            'folder and no saved conversation was touched.'
          : `Nothing was removed. ${outcome.state.error} No folder and no saved ` +
            'conversation was touched.'
        : `${String(outcome.removed.length)} remembered ` +
          `${outcome.removed.length === 1 ? 'project' : 'projects'} removed from ` +
          `${projects.storePath}. The ` +
          `${outcome.removed.length === 1 ? 'folder' : 'folders'} on disk and every ` +
          'saved conversation are untouched: conversations are kept separately and ' +
          'are still listed under "Saved conversations".';
    return {
      removed: outcome.removed,
      notFound: outcome.notFound,
      // `projects.error` describes reading the list; a failure to change it is in
      // the note above, and the two must not be confused for one another.
      projects:
        outcome.state.error === null || projects.error !== null
          ? projects
          : { ...projects, error: outcome.state.error },
      note,
    };
  });

  /**
   * What DSpatch has left behind in its own sample location (DSP-61).
   *
   * Reads only. A new session generates into a folder of its own, so nothing here
   * is on any session's path — this exists for a person who wants the space back.
   */
  ipcMain.handle(LIST_SAMPLE_PROJECTS, () => sampleProjectsView());

  /**
   * Remove old sample projects, because a person asked for it.
   *
   * The renderer names paths it was shown, and `cleanUpSampleProjects` checks every
   * one of them against the sample location again here rather than trusting the
   * list it sent. A path anywhere else is refused, which is the same guarantee the
   * generator's refusal gives from the other direction: DSpatch removes only what
   * DSpatch created.
   */
  ipcMain.handle(CLEAN_SAMPLE_PROJECTS, (_event, paths: readonly string[]) => {
    const asked = Array.isArray(paths) ? paths : [];
    const outcome = chatService.cleanUpSampleProjects(asked);
    log(
      `clean-sample-projects: asked for ${String(asked.length)}, removed ` +
        `${String(outcome.removed.length)}, held ${String(outcome.held.length)}`,
    );
    return {
      removed: outcome.removed,
      held: outcome.held,
      note: outcome.note,
      remaining: describeSampleProjects(outcome.remaining),
    };
  });

  ipcMain.handle(LIST_CONVERSATIONS, () => requireConversationStore().list());
  ipcMain.handle(CONVERSATION_SAVE_STATUS, () => chatService.conversationSaveStatus());
  ipcMain.handle(RESUME_CONVERSATION, async (_event, conversationId: string) => {
    const restored = await chatService.resumeConversation(conversationId);
    // The conversation in use has just changed, so the project's pointer has to
    // change with it. Without this the pointer only ever recorded whichever
    // conversation a project was *opened* with, and choosing an earlier one and
    // working in it left the next open returning to the older one.
    const state = requireProjectStore().rememberConversation(
      restored.project.path,
      restored.conversationId,
    );
    if (state.error !== null) {
      log(`[projects] ${state.error}`);
    }
    return restored;
  });
  ipcMain.handle(EXPORT_CONVERSATION, (_event, conversationId: string) =>
    exportConversation(conversationId),
  );
  ipcMain.handle(REVEAL_CONVERSATION, (_event, conversationId: string) => {
    const { filePath } = requireConversationStore().readBytes(conversationId);
    if (!fs.existsSync(filePath)) {
      return {
        revealed: false,
        note:
          `There is no file at ${filePath}, so there is nothing to show. The ` +
          'conversation may already have been moved or deleted from outside DSpatch.',
      };
    }
    shell.showItemInFolder(filePath);
    return {
      revealed: true,
      note: `Opened the folder containing ${filePath} and selected the file there.`,
    };
  });

  ipcMain.handle(START_SESSION, async (_event, request: StartSessionRequest) => {
    const session = await chatService.startChatSession(request);
    if (request.kind === 'folder') {
      // Remembered only once the session actually opened. A folder that was
      // refused or unreadable has no business in the list of recent projects.
      // A generated sample stays out of it too: it is a throwaway directory under
      // temp, and its conversation is still reachable from the conversation list.
      // The conversation ID goes in beside the path, so opening this project again
      // continues the same conversation rather than starting an empty one next to it.
      const state = requireProjectStore().recordOpened(session.workspacePath, {
        conversationId: session.conversationId,
      });
      if (state.error !== null) {
        log(`[projects] ${state.error}`);
      }
    }
    // The project is the workspace's working root, so opening one changes the tree.
    // Announced rather than left for the window to infer, because the folder list is
    // also changed from a menu the renderer cannot see.
    rememberWorkspace();
    announceWorkspace();
    return session;
  });
  ipcMain.handle(
    SEND_PROMPT,
    (_event, prompt: string, acknowledgedAttemptIds?: readonly string[]) =>
      chatService.sendPrompt(prompt, acknowledgedAttemptIds ?? []),
  );
  ipcMain.handle(CANCEL_RUN, () => chatService.cancelRun());
  ipcMain.handle(ABANDON_SEND, () => chatService.abandonSend());
  ipcMain.handle(CANCEL_OBSERVATIONS, () => chatService.getCancelObservations());
  ipcMain.handle(RUN_STATE, () => chatService.getRunState());
  ipcMain.handle(RUN_TEST, (_event, request: TestRunRequest) =>
    chatService.runWorkspaceTest(request),
  );
  ipcMain.handle(STOP_TEST, () => chatService.stopRunningCommand());
  ipcMain.handle(TEST_FRESHNESS, () => chatService.getTestFreshness());
  ipcMain.handle(WORKSPACE_CHANGES, () => chatService.getWorkspaceChanges());
  ipcMain.handle(TURN_USAGE, (_event, dspatchRunId: string) =>
    chatService.getTurnUsage(dspatchRunId),
  );

  ipcMain.handle(GET_SCRIPTED_RUN, (): ScriptedRunPlan | null => {
    if (!chatRunMode) {
      return null;
    }
    return {
      enabled: true,
      scenario: chatRunScenario,
      turnTimeoutMs: chatRunTurnTimeoutMs,
      nodePath: chatService.nodeRunnerPath(),
      note:
        'Scripted workflow run. The renderer operates its own controls and records ' +
        'what reached the DOM. This is evidence that the chain works, not a ' +
        'judgement of the interface.',
      // DSP-72's scenario needs three paths the harness script owns: the saved
      // workspace that brings in a second folder and a definition from elsewhere, that
      // definition's own graph marker, and DSpatch's own copy for the refusal. Passed
      // through rather than discovered here, so the trial's fixtures are visible in the
      // script that creates them.
      ...(process.env['DSPATCH_ROOTS_WORKSPACE'] === undefined
        ? {}
        : { rootsWorkspaceFile: process.env['DSPATCH_ROOTS_WORKSPACE'] }),
      ...(process.env['DSPATCH_ROOTS_GRAPH_MARKER'] === undefined
        ? {}
        : { rootsGraphMarker: process.env['DSPATCH_ROOTS_GRAPH_MARKER'] }),
      // DSP-84's scenario is given the declarations it is to open and choose, for the
      // same reason: a definition filed outside every open folder is the case the card
      // is about, and it cannot be discovered by definition.
      ...((): { choosableDefinitions?: readonly string[] } => {
        const raw = process.env['DSPATCH_CHOOSE_DEFINITIONS'];
        if (raw === undefined || raw.trim() === '') {
          return {};
        }
        const paths = raw
          .split(';')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');
        return paths.length === 0 ? {} : { choosableDefinitions: paths };
      })(),
      // DSP-88's scenario reads the bytes of each loop's graph before and after every
      // answer, so it is given the graph paths alongside the declarations rather than
      // resolving them itself.
      ...((): { unsavedGraphPaths?: readonly string[] } => {
        const raw = process.env['DSPATCH_UNSAVED_GRAPHS'];
        if (raw === undefined || raw.trim() === '') {
          return {};
        }
        const paths = raw
          .split(';')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');
        return paths.length === 0 ? {} : { unsavedGraphPaths: paths };
      })(),
      // The declaration DSP-84's scenario expects to be refused. Authored broken by the
      // harness script, because a fixture that is wrong on purpose has to be visible as
      // such beside the fixtures that are not.
      ...(process.env['DSPATCH_BROKEN_DEFINITION'] === undefined
        ? {}
        : { brokenDefinition: process.env['DSPATCH_BROKEN_DEFINITION'] }),
      // The one graph `how-the-liveness-looks` opens. Given rather than discovered because
      // that scenario never opens a project, which is most of why it costs seconds.
      ...(process.env['DSPATCH_LOOK_GRAPH'] === undefined
        ? {}
        : { lookGraphPath: process.env['DSPATCH_LOOK_GRAPH'] }),
      ...((): { ownRepositoryPath?: string } => {
        const own = ownRepositoryRoot(app.getAppPath());
        return own === null ? {} : { ownRepositoryPath: own };
      })(),
    };
  });

  // Only during a scripted run, and deliberately so: this presses the real menu
  // item, which is the one part of the application a renderer cannot reach. It is
  // not a second way of driving DSpatch — it is the first way, operated from the
  // side the menu lives on.
  if (chatRunMode) {
    ipcMain.handle(PRESS_MENU_ITEM, (_event, command: MenuCommand): boolean => {
      const item = menuItemsByCommand.get(command);
      if (item === undefined) {
        log(`scripted run asked for menu item ${command}, which is not in the menu`);
        return false;
      }
      item.click();
      log(`scripted run pressed the menu item for ${command}`);
      return true;
    });
    ipcMain.handle(
      CAPTURE_WINDOW,
      async (_event, label: string): Promise<boolean> => captureWindowImage(label),
    );
    // Only the main process can resize a window, and "the chat does not follow the
    // window's width" is a claim about a window being resized. Answers the content
    // width the renderer ended up with, so the trial reads the window it got.
    ipcMain.handle(SET_WINDOW_WIDTH, (_event, width: number): number => {
      const window = liveMainWindow();
      if (window === null) {
        return 0;
      }
      // A maximised window ignores new bounds, and the trial would then measure one
      // width twice and conclude nothing while looking like it had.
      if (window.isMaximized()) {
        window.unmaximize();
      }
      const bounds = window.getBounds();
      window.setBounds({ ...bounds, width: Math.max(Math.round(width), 320) });
      return window.getContentBounds().width;
    });
    /*
     * Answer `prefers-reduced-motion` the other way, for as long as a trial asks.
     *
     * DSP-80 has to be able to establish that reduced motion gets a **still marking and
     * not nothing**, and that is a question about the real stylesheet under a real media
     * query. The query's answer belongs to the operating system, so a renderer cannot set
     * it and a trial that read the CSS text instead would only establish that a rule had
     * been typed. `Emulation.setEmulatedMedia` is Chromium answering it differently, which
     * makes the reading a reading of what the window actually paints.
     *
     * Scripted runs only, alongside the menu press and the resize, and for the same
     * reason: this is not a second way to drive DSpatch, it is the only way to reach a
     * part of it a renderer has no access to.
     */
    ipcMain.handle(
      EMULATE_REDUCED_MOTION,
      async (_event, reduce: boolean): Promise<boolean> => {
        const window = liveMainWindow();
        if (window === null || window.webContents.isDestroyed()) {
          return false;
        }
        try {
          if (!window.webContents.debugger.isAttached()) {
            window.webContents.debugger.attach('1.3');
          }
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [
              { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' },
            ],
          });
          log(`scripted run set prefers-reduced-motion to ${reduce ? 'reduce' : 'no-preference'}`);
          return true;
        } catch (error) {
          log(
            'prefers-reduced-motion could not be emulated: ' +
              (error instanceof Error ? error.message : String(error)),
          );
          return false;
        }
      },
    );
  }

  ipcMain.on(SCRIPTED_RUN_REPORT, (_event, report: ScriptedRunReport) => {
    if (chatRunReported) {
      return;
    }
    chatRunReported = true;
    log(
      `scripted run finished: passed=${String(report.passed)} ` +
        `exitCode=${String(report.exitCode)} failures=${String(report.failures.length)}`,
    );
    for (const failure of report.failures) {
      log(`scripted run failure: ${failure}`);
    }
    writeChatRunRecord(report);
    void captureWindowImage().then(() => {
      exitWith(report.exitCode);
    });
  });

  registerLoopGraphIpc();
  registerWorkspaceIpc();
}

/**
 * The loop editor's file access: read a graph, resolve its roles, write it back.
 *
 * Three handlers and no validation. `loop-graph-load.ts` has no Node imports and the
 * editor revalidates after every keystroke, so validation belongs in the window;
 * what only the main process can do is touch the disk. Role resolution is here for
 * the same reason — `createFileRoleResolver` reads `.cursor/agents/*.md`, and a role
 * reference that resolves to nothing is a finding the author must see (DSP-22 #6).
 */
function registerLoopGraphIpc(): void {
  const ownRoot = ownRepositoryRoot(app.getAppPath());

  function roleEntries(references: readonly RoleReference[]): readonly ResolvedRoleEntry[] {
    if (ownRoot === null) {
      // Without a project root there is nothing to resolve against, and answering
      // `null` would report every role as broken. Unchecked is the honest answer,
      // and the loader reports it as a warning rather than an error.
      return [];
    }
    const resolve = createFileRoleResolver(ownRoot);
    return resolvedRolesWith(references, resolve);
  }

  ipcMain.handle(
    OPEN_LOOP_GRAPH,
    async (_event, request: LoopGraphOpenRequest): Promise<LoopGraphOpenOutcome> => {
      // A loop, by the same procedure a run resolves one with. `chooseLoop` is what
      // Send and the chat preview call, and `null` is the loop this workspace has
      // chosen — so "open the chosen loop" and "run the chosen loop" cannot come to
      // different answers about which loop that is (DSP-82 #2).
      if (request.kind === 'chosen-loop') {
        return openedFromDefinition(chooseLoop(null));
      }
      if (request.kind === 'definition') {
        return openedFromDefinition(chooseLoop(path.resolve(request.path)));
      }

      let target: string;
      if (request.kind === 'development-loop') {
        if (ownRoot === null) {
          return {
            kind: 'unavailable',
            note:
              "DSpatch could not find its own working copy from where it is running, so " +
              'it cannot locate docs/loop/graphs/dspatch-development-loop.graph.json. ' +
              'Open a graph file directly instead.',
          };
        }
        target = path.join(ownRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');
      } else if (request.kind === 'path') {
        target = path.resolve(request.path);
      } else {
        const picked = await dialog.showOpenDialog({
          title: 'Open a loop or a graph',
          defaultPath: ownRoot === null ? undefined : path.join(ownRoot, '.dspatch', 'loops'),
          filters: [{ name: 'Loop definition or graph', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (picked.canceled || picked.filePaths.length === 0) {
          return { kind: 'cancelled' };
        }
        target = picked.filePaths[0] as string;
      }

      let text: string;
      try {
        text = fs.readFileSync(target, 'utf8');
      } catch (error) {
        return { kind: 'unavailable', note: `${target} could not be read: ${String(error)}` };
      }

      // Decided by what the file says it is, not by what it is called. A person in a
      // dialog can point at either kind, and a declaration opened as a graph would be
      // refused as a graph with no nodes — a true finding about the wrong question.
      if (isLoopDefinitionText(text)) {
        return openedFromDefinition(chooseLoop(target));
      }

      return openedFromGraphFile({
        path: target,
        text,
        projectRoot: ownRoot ?? path.dirname(target),
        resolveRole: ownRoot === null ? null : createFileRoleResolver(ownRoot),
      });
    },
  );

  ipcMain.handle(
    SAVE_LOOP_GRAPH,
    (_event, request: LoopGraphSaveRequest): LoopGraphSaveOutcome => {
      try {
        const resolved = path.resolve(request.path);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, request.text, 'utf8');
        log(`loop graph written: ${resolved} (${String(Buffer.byteLength(request.text))} bytes)`);
        return {
          kind: 'written',
          path: resolved,
          bytes: Buffer.byteLength(request.text),
          atUtc: new Date().toISOString(),
        };
      } catch (error) {
        return { kind: 'failed', note: `${request.path} could not be written: ${String(error)}` };
      }
    },
  );

  ipcMain.handle(
    RESOLVE_LOOP_ROLES,
    (_event, references: readonly RoleReference[]): readonly ResolvedRoleEntry[] =>
      roleEntries(references),
  );

  /**
   * The graph the File menu asked to have edited, once (DSP-85 #6).
   *
   * **A read that clears.** Two callers ask — the editor on mount, for the window the
   * menu had to create, and the editor on notification, for the window that was already
   * open — and clearing is what makes both of them together open the file exactly once.
   */
  ipcMain.handle(TAKE_GRAPH_TO_EDIT, (): string | null => {
    const waiting = graphToEdit;
    graphToEdit = null;
    return waiting;
  });

  /**
   * Remember that the editor is holding unsaved edits to a graph (DSP-86).
   *
   * **A note, not a save.** Nothing is written here and no run is affected; the value
   * sits in memory until `START_CHAT_LOOP_RUN` asks whether starting would walk an older
   * version of the drawing on screen. `null` forgets it, which is what the editor sends
   * when the drawing is saved, closed or replaced.
   *
   * One drawing at a time, because there is one editor window (DSP-28 #1).
   */
  ipcMain.handle(NOTE_UNSAVED_DRAWING, (_event, drawing: UnsavedDrawing | null): void => {
    unsavedDrawing = drawing === null ? null : { ...drawing, path: path.resolve(drawing.path) };
  });

  /**
   * Show a role's own file in the file manager, selected.
   *
   * DSP-83 #1 asks for the source to be *named and openable*, and the panel renders the
   * role's text — which is a copy. The file is where an author changes a role, so the
   * window needs a way to reach it.
   *
   * **The root is the caller's and the containment check is ours.** `root` is the
   * resource root the graph's role paths are measured from, which for a loop declared
   * outside DSpatch is not DSpatch's own folder. That makes it a value from the
   * renderer, so a path climbing out of it is refused here rather than trusted — the
   * same rule `createFileRoleResolver` applies when it *reads* one, for the same
   * reason: a graph is a file that may be shared, and a role reference is not a way to
   * point this window at an arbitrary part of the machine. Nothing is opened, executed
   * or read; the folder is shown and the file is selected in it.
   */
  ipcMain.handle(
    REVEAL_ROLE_SOURCE,
    (
      _event,
      request: { readonly root: string; readonly path: string },
    ): { readonly revealed: boolean; readonly note: string } => {
      const root = path.resolve(request.root);
      const target = path.resolve(root, request.path);
      const relative = path.relative(root, target);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        return {
          revealed: false,
          note:
            `${request.path} resolves outside ${root}, which is the folder this loop's roles are ` +
            `measured from. Nothing was opened.`,
        };
      }
      if (!fs.existsSync(target)) {
        return {
          revealed: false,
          note: `There is no file at ${target}, so there is nothing to show. That is also why the role resolves to nothing.`,
        };
      }
      shell.showItemInFolder(target);
      return { revealed: true, note: `Opened the folder containing ${target} and selected it there.` };
    },
  );

  // Two bindings, one at a time. Declared together because the condition below is
  // about both of them: guarding each with its own variable is what let the graph
  // editor start a second run on top of a chat loop that was still walking.
  let editorLoopAbort: AbortController | null = null;
  let chatLoopAbort: AbortController | null = null;
  /**
   * Messages typed into a run that is already walking (DSP-32, DSP-53).
   *
   * Beside the abort controllers because it has the same lifetime as a run and the
   * same owner. One queue for the process, keyed by run id inside, so a message
   * typed into a run that has since ended cannot be handed to its successor.
   */
  const chatLoopInstructions = new InstructionQueue();
  /** The chat-loop run now walking, so a message can be checked against it. */
  let chatLoopRunId: string | null = null;

  /**
   * Whether a loop run is already walking, asked once for both run handlers.
   *
   * `loopControl.report().runId` is the fact itself — the control is shared, so it
   * knows about a run whichever window started it — and the two abort variables are
   * kept in the condition because a handler between claiming its controller and
   * reaching `beginRun` is also a run that has started. `LoopRunController.beginRun`
   * refuses the overlap as well; this exists so the person is told before a run gets
   * as far as needing to be refused, and so the sentence can name the window and the
   * graph, which the control cannot see.
   *
   * Returns the sentence to show, or `null` when nothing is running.
   */
  function activeLoopRunRefusal(): string | null {
    if (loopControl.report().runId === null && editorLoopAbort === null && chatLoopAbort === null) {
      return null;
    }
    const current = runAudience.current();
    const where =
      current === null
        ? 'in another window'
        : current.binding === 'chat-loop'
          ? `from the chat window's Use loop, walking "${current.graphName}"`
          : `from the graph editor's Live run, walking "${current.graphName}"`;
    const howToStop =
      current?.binding === 'chat-loop'
        ? 'Switching Use loop off cancels it without resetting files.'
        : 'Cancel it first, or let it finish.';
    return (
      `A loop run is already in progress — started ${where}. DSpatch runs one loop at a time, so ` +
      `this one was not started: no step was begun, no file was changed and the graph was not ` +
      `reset. ${howToStop}`
    );
  }

  /**
   * The folders a loop may be declared in: the open project, and DSpatch's own copy.
   *
   * DSpatch's own is in the list because its chat loop is now an ordinary declaration
   * under `.dspatch/loops/` rather than a path in the source. That is the difference
   * DSP-70 is about: the file is found because this is a folder DSpatch looks in, not
   * because a constant names it, and a project that declares its own loops has them
   * listed beside it on exactly the same terms.
   */
  function loopFolders(): readonly string[] {
    // Every folder open in the workspace, not just the project. DSP-71 makes
    // "the folders DSpatch is looking at" a list a person controls, and a folder
    // added beside the project declares its loops on exactly the same terms.
    return [...openWorkspaceFolders(), ownRoot].filter(
      (folder): folder is string => typeof folder === 'string' && folder !== '',
    );
  }

  /**
   * Declarations the person pointed at, for as long as this window is open.
   *
   * DSP-68 #5, and the way DSP-78's standalone development loop will be reached at
   * all: that definition lives outside the repository on purpose, so without this
   * there is no path to it.
   *
   * **Seeded from the workspace, then window-lived.** DSP-71 owns where a chosen
   * definition is remembered, and it remembers one: if the workspace's key names a
   * file in no open folder, it is put back here at startup so the row it names exists
   * to be preselected. Anything else pointed at during this window is gone on the
   * next start, which is what pointing at a file has always meant.
   */
  const pickedDefinitionPaths = new Set<string>();

  /** The picked files, plus the workspace's own key when it belongs to no folder. */
  function pickedPaths(): readonly string[] {
    const paths = new Set(pickedDefinitionPaths);
    if (workspaceLoopDefinitionKey !== null) {
      paths.add(workspaceLoopDefinitionKey);
    }
    return [...paths];
  }

  /**
   * The definition this window means, resolved to a graph, a version and a resolver.
   *
   * Both the preview and the run call this with the same key, which is what makes the
   * graph shown before Send the graph that walks. `null` takes the same default the
   * listing marks `preselected`, so the row a window highlights and the row a send
   * walks are decided by one function rather than by two that agree most of the time.
   */
  function chooseLoop(definitionKey: string | null | undefined): ChosenLoopOutcome {
    const discovery = discoverLoopDefinitions(loopFolders());
    /*
     * The rows a default is resolved against: the discovered ones **and the pointed-at
     * ones**, which is what the chooser offers.
     *
     * Found by DSP-85's window trial, and it is the last place the defect this card is
     * about was hiding. `defaultChoiceFrom` was given `discovery.rows` alone, so a
     * remembered key naming a file in no open folder — which is exactly what the
     * standalone development loop is — matched nothing and fell through to DSpatch's own
     * chat loop. The workspace remembered the right loop, the chooser displayed the right
     * loop, and `chooseLoop(null)` quietly answered with a different one: a fresh editor
     * window came up drawing a graph its own dropdown was not naming. That is the hidden
     * loop replacing what the person chose that DSP-85 #7 forbids.
     *
     * `pickedPaths()` already includes `workspaceLoopDefinitionKey`, and the dedup keeps
     * discovery's row when a file is both — the same rule and the same reason as in
     * `listChoosableLoops`, so the row a window highlights really is the row a send walks
     * rather than the two agreeing most of the time.
     */
    const rows = [
      ...discovery.rows,
      ...pickedPaths()
        .filter(
          (filePath) =>
            filePath !== '' && !discovery.rows.some((row) => row.filePath === filePath),
        )
        .map((filePath) => openLoopDefinitionFile(filePath)),
    ];
    // A key that is in no folder's list is a picked one, and `rowForKey` reads it
    // through `openLoopDefinitionFile` — the same row shape, so a definition from
    // outside every folder runs by exactly the path a discovered one runs by.
    const key = definitionKey ?? defaultChoiceFrom(rows, workspaceLoopDefinitionKey);
    if (key === null || key === '') {
      return {
        ok: false,
        note:
          'No loop definition was found beside this project or in DSpatch\u2019s own ' +
          'folder, and none was chosen. A loop is a `.loop.json` file in a folder\u2019s ' +
          '`.dspatch/loops/` directory.',
      };
    }
    return openChosenLoop(rowForKey(rows, key));
  }

  /**
   * Which loops this window can offer. **A read**: one directory listed per folder,
   * nothing started, nothing written.
   */
  ipcMain.handle(
    LIST_LOOP_DEFINITIONS,
    (): LoopDefinitionListing =>
      listChoosableLoops(
        loopFolders(),
        pickedPaths(),
        undefined,
        // The workspace's own choice outranks the built-in default, which is how a
        // saved workspace comes back with the loop it was saved with.
        workspaceLoopDefinitionKey,
      ),
  );

  /**
   * Select a definition for the next mandate. **It starts nothing.**
   *
   * DSP-84 added this because the editor's open path recorded nothing: a loop could be
   * drawn on the canvas and still be neither listed nor chosen. DSP-85 made it the only
   * way a loop is selected at all, and folded the file chooser into it — `null` means
   * *ask me for a file first*, which is the editor's **Open loop…**. The two gestures
   * share this handler because they are one act with one outcome; a second path that
   * added a row without judging it, which is what `PICK_LOOP_DEFINITION` used to do for
   * the chat, is how a loop nobody could run became the selection.
   *
   * What it does on success is the two things the chat's picker did — add the file to
   * `pickedDefinitionPaths` so the list knows about it, and record it as the workspace's
   * choice — and nothing else.
   *
   * **Refused before anything is recorded.** `judgeChosenLoop` asks the three questions
   * a run asks — can the declaration and its graph be read, does the graph validate
   * against this definition's own roles, will chat walk this drawing — and a `no` is
   * returned with the run's own sentence while `workspaceLoopDefinitionKey` and
   * `pickedDefinitionPaths` are left exactly as they were. That is DSP-84 #5 and DSP-85
   * #8: the reason arrives at the point of choosing, and nothing quietly becomes
   * selected in its place. The sentence is `judgeChosenLoop`'s `brief`, because this one
   * is read beside a dropdown.
   *
   * A run already walking is not consulted and not disturbed. It holds the definition
   * it started with (`ChosenLoop` is a value, not a lookup), so this can only be about
   * the next one — which is what the window is made to say.
   */
  ipcMain.handle(
    CHOOSE_LOOP_DEFINITION,
    async (_event, definitionPath: string | null): Promise<LoopDefinitionChooseOutcome> => {
      let asked = definitionPath;
      if (asked === null && chatRunMode) {
        asked = scriptedFilePick('Open loop…');
      } else if (asked === null) {
        const picked = await dialog.showOpenDialog({
          title: 'Open a loop definition',
          defaultPath: ownRoot === null ? undefined : path.join(ownRoot, '.dspatch', 'loops'),
          filters: [{ name: 'Loop definition', extensions: ['json'] }],
          properties: ['openFile'],
        });
        asked = picked.canceled ? null : (picked.filePaths[0] ?? null);
      }
      if (asked === null) {
        return { kind: 'cancelled', note: null };
      }
      const key = path.resolve(asked);
      const discovery = discoverLoopDefinitions(loopFolders());
      // `rowForKey` and not a second reader: a definition from outside every folder
      // becomes the same row shape a discovered one has, which is why it can then be
      // chosen, listed and run by exactly the path a discovered one takes.
      const row = rowForKey(discovery.rows, key);
      const judged = judgeChosenLoop(openChosenLoop(row), 'it was not chosen');
      if (!judged.runnable) {
        log(`loop definition refused at the point of choosing: ${key}`);
        return { kind: 'refused', key, note: judged.brief };
      }
      /*
       * **The unsaved drawing is settled before the switch, and after the judgement**
       * (DSP-88).
       *
       * Before, because choosing draws — so a choice that went through would take an
       * edited drawing off the canvas, which is what this card exists to stop. After the
       * judgement, because a definition that cannot run is not going to be drawn either
       * way: asking about the drawing first would be putting a question about a switch
       * that is not going to happen, and the refusal below already leaves everything as
       * it was.
       */
      const settled = await settleUnsavedDrawingBeforeRedraw();
      if (!settled.go) {
        log(`loop choice stopped at the unsaved-drawing question, nothing recorded: ${key}`);
        return { kind: 'cancelled', note: settled.note };
      }
      pickedDefinitionPaths.add(key);
      noteChosenLoopDefinition(key);
      log(`loop definition chosen for the next mandate: ${key}`);
      return {
        kind: 'chosen',
        key,
        name: judged.chosen.definitionName,
        graphPath: judged.chosen.graphPath,
        listing: listChoosableLoops(
          loopFolders(),
          pickedPaths(),
          undefined,
          workspaceLoopDefinitionKey,
        ),
        unsavedDrawing: settled.answered,
      };
    },
  );

  ipcMain.handle(OPEN_LOOP_EDITOR, (): LoopEditorWindowOutcome => openLoopEditorWindow());

  ipcMain.handle(
    START_EDITOR_LOOP_RUN,
    async (_event, request: EditorLoopRunRequest): Promise<EditorLoopRunOutcome> => {
      if (ownRoot === null) {
        return {
          kind: 'failed',
          note:
            'DSpatch could not find its own working copy from where it is running, so it ' +
            'cannot generate an isolated experiment repository for a live run.',
        };
      }
      const overlap = activeLoopRunRefusal();
      if (overlap !== null) {
        return { kind: 'failed', note: overlap };
      }

      // Held rather than inlined, because the announcement below carries what these
      // references resolved to. A run that shows a window its drawing without its
      // bindings is a run that window cannot draw.
      const resolveEditorRole = createFileRoleResolver(ownRoot);
      const loaded = loadLoopGraph(request.text, {
        resolveRole: resolveEditorRole,
        connectedTargets: ['cursor'],
      });
      if (!loaded.ok) {
        return {
          kind: 'refused',
          reason:
            `The canvas graph does not validate, so it was not run:\n\n${formatFindings(loaded.findings)}`,
        };
      }

      const binding = describeLiveBinding(loaded.graph);
      if (!binding.ready) {
        return { kind: 'refused', reason: binding.reason };
      }

      editorLoopAbort = new AbortController();
      const abort = editorLoopAbort;
      // `graphVersionIdFor` hashes the bytes that were validated above and are about
      // to be walked, which is what makes "exactly the graph version being executed"
      // (DSP-28 #2) a claim rather than a hope: the author may edit the canvas a
      // second later and the run's picture must not follow. Computed here, before the
      // claim, so that the `finally` below can name the run without depending on
      // anything built after it.
      const graphVersionId = graphVersionIdFor(request.text);
      // Set on each way out and broadcast once in `finally`, so the throwing path
      // cannot leave a graph view showing a run that will never end.
      let endedStatus: RunStatus | null = null;
      let endedNote = 'The run ended without saying how.';
      let endedTerminal: string | null = null;
      // The control is claimed before anything is announced, so a run that is refused
      // leaves no window showing a run that never walked. The same run, and the same
      // control: the mode the user is working in survives into it; a pause they asked
      // of the previous run does not.
      const began = loopControl.beginRun(request.runId, abort.signal);
      if (!began.started) {
        editorLoopAbort = null;
        return { kind: 'failed', note: began.note };
      }
      // Opened **immediately** after the claim, with nothing between, because this is
      // the `finally` that releases the control (DSP-38). Anything that threw between
      // claiming and entering the `try` would leave the control held by a run that is
      // not walking, and the Verifier of this run measured what follows: pause,
      // continue, both mode changes, Cancel and a foreign `endRun` all fail to
      // recover it, and every later run is then refused by a sentence naming a run
      // that does not exist. Restarting DSpatch is the only way out. Nothing in the
      // old gap could throw, so this closes a fragility rather than a live defect —
      // and the trigger is one line of bookkeeping added here by someone who did not
      // know that. `loop-control-run.test.ts` guards the shape for that reason.
      try {
        // Announced inside the claim, before the walk starts, so a graph view already
        // open switches to this run's own drawing rather than continuing to show
        // whatever the author was editing.
        const announcement: LiveRunAnnouncement = {
          runId: request.runId,
          graphVersionId,
          graphId: loaded.graph.id,
          graphName: loaded.graph.name,
          binding: 'editor-loop',
          graphText: request.text,
          startedAtUtc: new Date().toISOString(),
          phase: 'running',
          // Read from the same bytes the run is walking, so the bindings that travel
          // are the bindings of the drawing that travels.
          roles: resolvedRolesWith(referencedRoles(request.text), resolveEditorRole),
        };
        runAudience.start(announcement);
        const delivery = await runLiveGraph(loaded.graph, {
          runId: request.runId,
          repoRoot: ownRoot,
          outDir: null,
          resultsDir: runResultsDir(request.runId),
          modelRequested: defaultLiveModel(),
          keepWorkspace: true,
          abortSignal: abort.signal,
          control: loopControl,
          onJournalEntry: (entry) => {
            // To the run's audience, not to `event.sender`. The sender was whichever
            // window pressed Run, which is not necessarily — and with two windows,
            // often not — the window watching the graph.
            runAudience.broadcast({
              kind: 'journal',
              runId: announcement.runId,
              graphVersionId: announcement.graphVersionId,
              entry,
            });
          },
          // The same addressed channel as the journal, so the window watching this
          // graph reads one run state rather than two that can disagree.
          onStepActivity: (activity) => {
            runAudience.broadcast({
              kind: 'activity',
              runId: announcement.runId,
              graphVersionId: announcement.graphVersionId,
              activity,
            });
          },
        });
        const workspaceNote =
          `workspace ${delivery.workspacePath} (${delivery.workspaceKept ? 'left on disk' : 'deleted'})`;
        endedStatus = delivery.result.status;
        endedTerminal = terminalReachedBy(delivery.result);
        if (abort.signal.aborted) {
          endedNote = `The run was cancelled. Completed steps were not replayed. ${workspaceNote}`;
          return {
            kind: 'cancelled',
            result: delivery.result,
            journalText: delivery.journalText,
            workspaceNote,
          };
        }
        endedNote = `The run ended: ${delivery.result.status}. ${workspaceNote}`;
        return {
          kind: 'finished',
          result: delivery.result,
          journalText: delivery.journalText,
          workspaceNote,
        };
      } catch (error) {
        const note = error instanceof Error ? error.message : String(error);
        endedNote = `The run could not be completed: ${note}`;
        return { kind: 'failed', note };
      } finally {
        // The run's identity rather than the announcement's, because this `finally`
        // now covers the claim and must still release it on a path that never got as
        // far as announcing. `runAudience.end` guards on the run id, so an ending for
        // a run no window heard start clears nothing and every window drops it.
        editorLoopAbort = null;
        loopControl.endRun(request.runId);
        runAudience.end({
          runId: request.runId,
          graphVersionId,
          status: endedStatus,
          note: endedNote,
          terminalNodeId: endedTerminal,
        });
      }
    },
  );

  /**
   * Which run is walking now.
   *
   * **A read, and only a read.** DSP-28 #5: opening, closing and reopening the graph
   * view must never start, cancel or duplicate work, and a window that has just opened
   * has to be able to find out what is already running or it could only ever show the
   * next run. Nothing here starts a run, and asking twice is the same as asking once.
   */
  ipcMain.handle(CURRENT_LOOP_RUN, (): LiveRunAnnouncement | null => runAudience.current());

  /**
   * Pause, continue, and who decides the next step.
   *
   * All four go through the one `LoopRunController`, so the chat window and the graph
   * window cannot end up controlling different things or describing the same run
   * differently. Reading is a read: `READ_LOOP_CONTROL` starts nothing and repeats
   * nothing, and a window that opened halfway through a paused run gets the same
   * answer as the window that paused it.
   */
  ipcMain.handle(REQUEST_LOOP_PAUSE, (): LoopControlOutcome => loopControl.requestPause());
  ipcMain.handle(CONTINUE_LOOP, (): LoopControlOutcome => loopControl.continueRun());
  ipcMain.handle(SET_LOOP_MODE, (_event, mode: LoopMode): LoopControlOutcome => loopControl.setMode(mode));
  ipcMain.handle(READ_LOOP_CONTROL, (): LoopControlReport => loopControl.report());

  ipcMain.handle(CANCEL_EDITOR_LOOP_RUN, (): EditorLoopCancelOutcome => {
    if (editorLoopAbort === null) {
      return { cancelled: false, note: 'No loop run is in progress.' };
    }
    editorLoopAbort.abort();
    return {
      cancelled: true,
      note: 'Cancel requested. Completed steps are not replayed; the graph and workspace stay as they are.',
    };
  });

  ipcMain.handle(
    START_CHAT_LOOP_RUN,
    async (event, request: ChatLoopRunRequest): Promise<ChatLoopRunOutcome> => {
      const session = chatService.openSession();
      if (session === null) {
        return {
          kind: 'refused',
          reason: 'Open a project first. Use loop walks the project already open in chat.',
        };
      }
      if (ownRoot === null) {
        return {
          kind: 'failed',
          note:
            'DSpatch could not find its own working copy from where it is running, so it ' +
            'cannot offer its own loop definitions. A definition beside the open project ' +
            'would still run.',
        };
      }
      const overlap = activeLoopRunRefusal();
      if (overlap !== null) {
        return { kind: 'failed', note: overlap };
      }

      /*
       * **The chosen definition, read once, and then held for the run's lifetime.**
       *
       * Everything below takes its graph, its version and its roles from this value
       * and never looks the definition up again — which is what makes selecting
       * something else, or editing this file, change nothing about a run already
       * walking. The provider says the same thing from its own side: `dirs` is on
       * `Agent.create` and `Agent.resume` and never on `send`, so a session's roots are
       * fixed when it is created. A run that re-read its definition halfway would be
       * describing something the provider has no way to do.
       */
      let choice = chooseLoop(request.definitionKey);
      if (!choice.ok) {
        return { kind: 'failed', note: choice.note };
      }

      /*
       * **Unsaved edits are never run quietly, and never skipped quietly** (DSP-86).
       *
       * The read above took the file from disk. If the loop editor is holding edits to
       * that same file, the run would walk a version older than the drawing a person is
       * looking at — and DSP-85 could only put a warning on screen about it, because the
       * edits live in the editor's window and the start happens in the chat's. The
       * registration in `NOTE_UNSAVED_DRAWING` is what makes the question answerable
       * here, at the start, where it can still change the answer.
       *
       * Two outcomes and no third. *Cancel* starts nothing and writes nothing. *Save and
       * run* writes the drawing and then **reads the definition again**, so what walks is
       * what was just written rather than the copy read a moment before it.
       */
      const pendingSave =
        unsavedDrawing !== null &&
        (pathsAreCaseInsensitive
          ? unsavedDrawing.path.toLowerCase() === choice.chosen.graphPath.toLowerCase()
          : unsavedDrawing.path === choice.chosen.graphPath)
          ? unsavedDrawing
          : null;
      if (pendingSave !== null) {
        if ((await askAboutUnsavedDrawing(pendingSave, 'run')) === 'cancel') {
          log(`chat loop run ${request.runId} cancelled at the unsaved-drawing question`);
          return {
            kind: 'refused',
            reason:
              `Nothing was started. The loop editor is holding unsaved changes to ` +
              `${pendingSave.path}, which is the file a run reads, and you chose not to save ` +
              `them — so DSpatch did not run the older version on disk behind your drawing. ` +
              `Save in the editor, or send again and choose Save and run.`,
          };
        }
        const failure = writeUnsavedDrawing(pendingSave, 'run');
        if (failure !== null) {
          return { kind: 'failed', note: `Nothing was started. ${failure}` };
        }
        choice = chooseLoop(request.definitionKey);
        if (!choice.ok) {
          return { kind: 'failed', note: choice.note };
        }
      }

      const chosen = choice.chosen;
      const graphPath = chosen.graphPath;
      const graphText = chosen.graphText;

      // Held rather than constructed inline, because the same resolution now feeds two
      // things: validation, which refuses a reference that resolves to nothing, and the
      // prompt, which sends the role's own text. Before DSP-46 only the first existed,
      // so the refusal protected a property nothing provided. One resolver, and it
      // caches, so the role file is read once per run however many nodes name it. Its
      // anchor is the definition's resource root, not the folder being worked on.
      const resolveRole = chosen.resolveRole;
      const loaded = loadLoopGraph(graphText, {
        resolveRole,
        connectedTargets: ['cursor'],
      });
      if (!loaded.ok) {
        return {
          kind: 'refused',
          reason:
            `"${chosen.definitionName}" points at a graph that does not validate, so it ` +
            `was not run:\n\n${formatFindings(loaded.findings)}`,
        };
      }

      const binding = describeChosenLoopBinding(loaded.graph, chosen.definitionName);
      if (!binding.ready) {
        return { kind: 'refused', reason: binding.reason };
      }

      const workspacePath = session.workspacePath;
      /**
       * The folders this run works with (DSP-72).
       *
       * Every folder open in the window, with the session's own working copy first: the
       * primary is the shell's `cwd` and what the provider scopes its local agent store
       * by, so it stays the folder the session was opened over rather than whichever
       * folder happens to be first in a list. Adding a folder to the workspace is now
       * how a person says *this run is about these two repositories* — which is the
       * question DSP-71 deliberately left unanswered, where adding a folder changed only
       * what was drawn and searched.
       */
      const workingRoots = workingRootsFrom(
        openWorkspaceFolders(),
        workspacePath,
        pathsAreCaseInsensitive,
      );
      const refusal = refuseLiveWorkingRoots(workingRoots, path.join(ownRoot, 'app'));
      if (refusal !== null) {
        return { kind: 'refused', reason: refusal.message };
      }

      // The chat loop starts from the mandate alone. The Command field belongs to
      // the Build-and-test panel; this handler does not read it, write it, or wait
      // for a confirmation. Decision D3 is not a product requirement.
      const entryNode = loaded.graph.nodes.find((node) => node.id === loaded.graph.entry);
      const modelRequested = modelForChatNode(entryNode, session.modelRequested);
      // Opened before the walk starts and appended to as it happens, because DSP-25
      // #4 says an interrupted run must still leave understandable history — which
      // rules out assembling anything at the end. `graphVersionIdFor` hashes the
      // bytes that were actually read a few lines above, so the record identifies
      // the drawing that ran rather than the name it happens to share with whatever
      // is in the file now. The same value the preview showed, because both come from
      // the same read of the same chosen definition.
      const graphVersionId = chosen.graphVersionId;
      const record = requireRunRecordStore().open({
        runId: request.runId,
        projectPath: workspacePath,
        conversationId: session.conversationId,
        mandate: request.mandate,
        graphId: loaded.graph.id,
        graphPath: graphPath,
        graphVersionId,
        modelRequested,
        appVersion: app.getVersion(),
        startedAtUtc: new Date().toISOString(),
      });
      // Labels from the graph that is actually being walked, rather than the
      // window's own copy of them, so a reply is attributed to the node the run
      // entered even if the two ever drift apart.
      const lookup = lookupFromGraph(loaded.graph);

      chatLoopAbort = new AbortController();
      chatLoopRunId = request.runId;
      const abort = chatLoopAbort;
      /**
       * How many times each node has been handed a waiting message.
       *
       * Per run, so the window can say *given to "Check the work" on its second
       * turn* when a loop goes round again. Counted here rather than read from the
       * runner, because it counts deliveries and not entries: a node can be entered
       * without anything being waiting for it.
       */
      const deliveredCounts = new Map<string, number>();
      // The control before the announcement, for the reason the editor handler gives.
      // Unreachable in practice, because `activeLoopRunRefusal` above answers the same
      // question earlier; kept because the invariant belongs to the controller and a
      // caller that assumes it was granted is how the overlap got in. The record was
      // opened a few lines above and is closed here rather than left half-written.
      let endedStatus: RunStatus | null = null;
      let endedNote = 'The run ended without saying how.';
      let endedTerminal: string | null = null;
      const began = loopControl.beginRun(request.runId, abort.signal);
      if (!began.started) {
        chatLoopAbort = null;
        closeChatLoopRecord(record, {
          kind: 'failed',
          result: null,
          inspection: null,
          note: began.note,
          modelRequested,
          cancelled: false,
        });
        return { kind: 'failed', note: began.note };
      }
      // Opened immediately after the claim, with nothing between, for the reason
      // DSP-38 gives at the editor handler's own `try`: this is the `finally` that
      // releases the control, so a throw in the gap would wedge it permanently.
      try {
        // The same run, announced to the windows as well as opened on disk. One
        // identity: `request.runId` and the same `graphVersionId` the record header
        // carries, so the graph view, the chat column and the file on disk are all
        // talking about one run rather than three views with three ideas of what is
        // happening (DSP-26 #1).
        const announcement: LiveRunAnnouncement = {
          runId: request.runId,
          graphVersionId,
          graphId: loaded.graph.id,
          graphName: loaded.graph.name,
          binding: 'chat-loop',
          graphText,
          startedAtUtc: new Date().toISOString(),
          phase: 'running',
          // The bindings this run is actually using, announced with the drawing.
          // `resolveRole` above has already read every one of them in order to build
          // the prompts, so this costs a cache lookup and closes the defect where a
          // graph view refused to draw the very loop it was watching.
          roles: resolvedRolesWith(referencedRoles(graphText), resolveRole),
        };
        runAudience.start(announcement);
        const delivery = await runLiveGraph(loaded.graph, {
          runId: request.runId,
          repoRoot: ownRoot,
          outDir: null,
          resultsDir: runResultsDir(request.runId),
          modelRequested,
          workspacePath,
          workingRoots,
          keepWorkspace: true,
          bindingKind: 'chat-loop',
          abortSignal: abort.signal,
          control: loopControl,
          // The same seam the direct chat has had since DSP-1, and for the same
          // reason: a scripted run can then walk a real loop in the real window with
          // no provider call. `presentationMode` is set by one environment value and
          // nothing else constructs this, so an ordinary launch cannot reach it.
          ...(presentationMode
            ? { createAdapter: () => new PresentationAdapter(presentationAdapterOptions()) }
            : {}),
          promptFor: (node, step) => {
            const prompt = chatPromptFor(node, {
              entryId: loaded.graph.entry,
              mandate: request.mandate,
              // DSP-79. Each agent node has its own session now, so the receiving
              // agent's address in the run — and the fact that it has no history of
              // the run — is something the brief has to carry.
              step,
              // DSP-72 #2. The same list the provider is given as `cwd` plus `dirs`, so
              // the folders the prompt names are the folders the session actually has.
              workingRoots,
              // DSP-46 #1. The drawing names a role for every agent node and validation
              // has always refused one that resolves to nothing; this is the line that
              // makes the reference mean something at the provider rather than only at
              // the validator.
              role: chatRoleTextFor(node, resolveRole),
            });
            // DSP-32. The one place a step's prompt is built is the one place a
            // waiting message can be handed over, and draining it here means the
            // message is marked delivered at the instant its text enters the
            // prompt rather than at some other moment that could disagree.
            //
            // This is also why "always the next agent" is not a product rule
            // (§4.4): nothing here chooses a step. Whichever step the run starts
            // next asks for its prompt, and that is the step that gets the
            // message — the following node on an ordinary handover, or the same
            // node again when a step is repeated.
            const taken = chatLoopInstructions.takeFor(request.runId);
            if (taken.length === 0) {
              return prompt;
            }
            const nodeLabel = lookup.node(node.id)?.label ?? node.id;
            const atUtc = new Date().toISOString();
            deliveredCounts.set(node.id, (deliveredCounts.get(node.id) ?? 0) + 1);
            const occurrence = deliveredCounts.get(node.id) ?? 1;
            const payload: LoopInstructionEventPayload = {
              kind: 'delivered',
              runId: request.runId,
              instructionIds: taken.map((entry) => entry.id),
              nodeId: node.id,
              nodeLabel,
              occurrence,
              atUtc,
            };
            // Deliberately no extra record line. What the step was told is already
            // saved whole on its `agent-reply` — `RecordedAgentReply.prompt`, added
            // by DSP-46 — and the message is inside that prompt between the
            // `INSTRUCTION_BLOCK` markers. So the record's evidence that an agent
            // received this is the prompt the agent was actually sent, which is
            // stronger than a line asserting the same thing beside it, and it needs
            // no new `RunRecordLine` kind: one of those would make every record this
            // build writes read as partly unreadable to the build before it, which
            // is the trade-off `loop-record.ts` already declined once.
            //
            // A message no step ever took has no prompt to live in, and that case is
            // carried on the run's ending note instead. See `undeliveredNote`.
            if (!event.sender.isDestroyed()) {
              event.sender.send(LOOP_INSTRUCTION_EVENT, payload);
            }
            return `${instructionPreamble(taken.map((entry) => entry.text))}${prompt}`;
          },
          // Written the moment a command settles rather than read out of the
          // inspection afterwards. The chat loop no longer starts a gate command;
          // the duration fixture still can, and an interrupted run must keep what
          // it already ran.
          onCommand: (command) => {
            record.command(command, null, null);
          },
          onJournalEntry: (entry) => {
            // The record stores the runner's own events, not a second vocabulary
            // beside them. A record event derived from a journal entry is a state
            // model that can drift from the one it was derived from, which is the
            // class of defect DSP-26 #1 exists to close.
            record.journal(entry);
            if (!event.sender.isDestroyed()) {
              event.sender.send(CHAT_LOOP_JOURNAL, entry);
            }
            // And to the run's audience, addressed, so a graph view in another window
            // can follow the same walk. The chat column keeps its own channel because
            // the transcript belongs to the conversation in that window; this is the
            // same entries under a run's address, not a second history.
            runAudience.broadcast({
              kind: 'journal',
              runId: announcement.runId,
              graphVersionId: announcement.graphVersionId,
              entry,
            });
          },
          /*
           * What the provider reports **while** the step works.
           *
           * The chat window and the graph window, from one emission and one fold. A
           * loop step used to be an opaque call because `waitForTurn` handled three
           * event types and none of them arrived before the turn ended; these are the
           * ones it now forwards, and they are the difference between a run a person
           * can watch and 320 seconds of silence.
           *
           * Nothing is recorded here. The run record already keeps the reply and the
           * whole prompt it answered, and a second written history of the same turn is
           * exactly the drift DSP-26 #1 exists to prevent. This is a live view.
           */
          onStepActivity: (activity) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(CHAT_LOOP_ACTIVITY, activity);
            }
            runAudience.broadcast({
              kind: 'activity',
              runId: announcement.runId,
              graphVersionId: announcement.graphVersionId,
              activity,
            });
          },
          // The agent's own account of what it did to the user's project. It used to
          // be collected and used only to classify the step; the conversation shows
          // it as the answer to the mandate, so it is forwarded as it was written.
          onAgentReply: (reply) => {
            const nodeLabel = lookup.node(reply.nodeId)?.label ?? reply.nodeId;
            record.reply({
              atUtc: new Date().toISOString(),
              nodeId: reply.nodeId,
              nodeLabel,
              occurrence: reply.occurrence,
              text: reply.text,
              terminalStatus: reply.terminalStatus,
              // What the step was told, beside what it answered. DSP-46 #1's second
              // half: the role reaching the provider is checkable after the run rather
              // than only assertable during it.
              prompt: reply.prompt,
              ...(reply.role === null
                ? {}
                : { roleId: reply.role.id, roleSourcePath: reply.role.sourcePath }),
              // DSP-79 #1. Two consecutive agent nodes now run in two sessions, and
              // this is the line in the record where a reader sees that they did.
              sessionId: reply.sessionId,
            });
            if (event.sender.isDestroyed()) {
              return;
            }
            event.sender.send(CHAT_LOOP_REPLY, {
              runId: request.runId,
              nodeId: reply.nodeId,
              nodeLabel,
              occurrence: reply.occurrence,
              text: reply.text,
              terminalStatus: reply.terminalStatus,
              // The same string the record line above was written from, so the
              // conversation can show what this call was told without waiting for the
              // file to be read back (DSP-94).
              prompt: reply.prompt,
            } satisfies ChatLoopReply);
          },
        });
        const workspaceNote =
          `workspace ${delivery.workspacePath} (open project; files were not reset)` +
          undeliveredNote(chatLoopInstructions.peekFor(request.runId));
        const cancelled = abort.signal.aborted;
        const recorded = closeChatLoopRecord(record, {
          kind: cancelled ? 'cancelled' : 'finished',
          result: delivery.result,
          inspection: delivery.inspection,
          note: workspaceNote,
          modelRequested,
          cancelled,
        });
        endedStatus = delivery.result.status;
        /*
         * The terminal, and deliberately not when the person stopped the run.
         *
         * A cancelled walk may well have reached a terminal a moment before the stop
         * arrived, and `loop-transcript.ts` already withholds the terminal from a
         * cancelled run's badge for the reason that applies here word for word: what a
         * reader needs first from a cancelled run is that it was cut short. A green tick
         * on a run the person interrupted would say the opposite louder than any sentence.
         */
        endedTerminal = cancelled ? null : terminalReachedBy(delivery.result);
        endedNote = cancelled
          ? `The run was cancelled. Files stay as they are. ${recorded.ending.outcomeText}`
          : recorded.ending.outcomeText;
        return {
          kind: cancelled ? 'cancelled' : 'finished',
          result: delivery.result,
          journalText: delivery.journalText,
          workspaceNote,
          recorded,
        };
      } catch (error) {
        // The record is closed on this path too. A run that threw still happened in
        // the user's project, and a record with no ending line would read as "DSpatch
        // was killed" — which is a different thing from "the call failed and said
        // why", and the two must not be confused after a restart.
        const note = error instanceof Error ? error.message : String(error);
        closeChatLoopRecord(record, {
          kind: 'failed',
          result: null,
          inspection: null,
          note: `The loop could not be run: ${note}`,
          modelRequested,
          cancelled: chatLoopAbort?.signal.aborted ?? false,
        });
        endedNote = `The loop could not be run: ${note}`;
        return { kind: 'failed', note };
      } finally {
        // The run's identity rather than the announcement's, for the reason the
        // editor handler's `finally` gives: this one now covers the claim too.
        chatLoopAbort = null;
        chatLoopRunId = null;
        // Every path out of the handler, including the throwing one, for the same
        // reason the control is released here: a message left in the queue after
        // its run has gone would sit on `pending` for ever, and §4.4 asks for the
        // opposite — *if no step receives it before the run ends, say so*. The
        // release also empties the queue, so it can never reach the next run.
        const undelivered = chatLoopInstructions.releaseRun(request.runId);
        if (!event.sender.isDestroyed()) {
          event.sender.send(LOOP_INSTRUCTION_EVENT, {
            kind: 'run-ended',
            runId: request.runId,
            undelivered: undelivered.map((entry) => entry.id),
          } satisfies LoopInstructionEventPayload);
        }
        loopControl.endRun(request.runId);
        runAudience.end({
          runId: request.runId,
          graphVersionId,
          status: endedStatus,
          note: endedNote,
          terminalNodeId: endedTerminal,
        });
        /*
         * And the loop stands ready again, if it is still wanted (DSP-86 #6).
         *
         * After `end`, which is what frees the audience to take a stand-by offer; before
         * that call it would be refused as an attempt to displace a walking run. Ready
         * means ready for a new mandate, so the finished run's marks give way at once and
         * the result of the run that just ended stays where a person reads results, which
         * is the chat.
         */
        offerReadyAgainAfterRun(request.definitionKey ?? null);
      }
    },
  );

  ipcMain.handle(
    LIST_RUN_RECORDS,
    (_event, conversationId: string): readonly StoredRunRecordEntry[] =>
      // Reading only. No agent call, no command, no file change, and nothing here
      // can resume a run: an incomplete record is read back as incomplete and stays
      // that way. DSP-25 #5.
      requireRunRecordStore()
        .listForConversation(conversationId)
        .map((entry) => ({
          runId: entry.runId,
          filePath: entry.filePath,
          record: entry.record,
          error: entry.error,
          recovery: entry.recovery,
        })),
  );

  /**
   * Take a message for the run that is already walking.
   *
   * This is the other half of *the composer stays usable during a run*, and it is
   * the half that makes unlocking the box safe. The window routes every press of
   * Send during a run here rather than to `START_CHAT_LOOP_RUN`, so DSP-53 #2 and
   * DSP-32 #4 — a message must never start a competing run in the same working
   * copy — hold because there is no code path from one to the other, rather than
   * because the caller remembered.
   *
   * The run id is checked rather than assumed. A message typed at a run that has
   * since ended is refused with a sentence saying where the text is, not filed
   * against whatever run happens to be current: it was written about work that is
   * over, and its author has not asked for it to be applied to anything else.
   */
  ipcMain.handle(
    ADD_LOOP_INSTRUCTION,
    (_event, request: AddLoopInstructionRequest): AddLoopInstructionOutcome => {
      const text = request.text.trim();
      if (text === '') {
        return { kind: 'refused', reason: 'There was nothing in the message to add.' };
      }
      if (chatLoopRunId === null) {
        return {
          kind: 'refused',
          reason:
            'No loop run is working now, so there is nothing to add this to. Your text ' +
            'has not been sent anywhere and is still in the box — send it again to start ' +
            'new work, or ask it as an ordinary question.',
        };
      }
      if (chatLoopRunId !== request.runId) {
        return {
          kind: 'refused',
          reason:
            'The run this message was typed at has ended, and DSpatch will not hand it ' +
            'to the run now working instead: it was written about different work. Your ' +
            'text has not been sent anywhere and is still in the box.',
        };
      }
      const entry = chatLoopInstructions.add(request.runId, text, new Date().toISOString());
      return {
        kind: 'received',
        instructionId: entry.id,
        receivedAtUtc: entry.receivedAtUtc,
        waiting: chatLoopInstructions.peekFor(request.runId).length,
      };
    },
  );

  /**
   * The stand-by drawing for a chosen loop, or the reason there is none.
   *
   * Lifted out of `PREPARE_CHAT_LOOP` so that the end of a run can raise the same offer
   * the tick raises (DSP-86 #6), by the same reading of the same file through the same
   * judgement. Two copies of this would be two answers to "what would run next", and the
   * graph view would eventually show one while a Send walked the other.
   */
  function standByAnnouncementFor(
    definitionKey: string | null,
  ): { readonly run: LiveRunAnnouncement } | { readonly note: string } {
    // The same three questions the editor's chooser asks, asked by the same function.
    const judged = judgeChosenLoop(chooseLoop(definitionKey), 'there is nothing to show');
    if (!judged.runnable) {
      return { note: judged.note };
    }
    const chosen = judged.chosen;
    const graphText = chosen.graphText;
    return {
      run: {
        // Its own id, and never one a run will reuse. The address has to be unique or
        // a later run's entries could land on the stand-by view; `ready-` is not a
        // prefix any run id takes.
        runId: `ready-${chosen.graphVersionId.slice(0, 12)}`,
        graphVersionId: chosen.graphVersionId,
        graphId: judged.graph.id,
        graphName: judged.graph.name,
        binding: 'chat-loop',
        graphText,
        startedAtUtc: new Date().toISOString(),
        phase: 'ready',
        roles: resolvedRolesWith(referencedRoles(graphText), chosen.resolveRole),
      },
    };
  }

  /**
   * Put the Ready pulse back on the entry step after a run has ended (DSP-86 #6).
   *
   * Nothing is started, nothing is asked and no window is opened: this is the same
   * stand-by offer `Use loop` makes, made again because the tick is still on. Quiet
   * about every failure, deliberately — a definition that has since become unreadable
   * is a thing to find out when something is sent, not an error raised by a run that
   * has just finished successfully.
   */
  function offerReadyAgainAfterRun(definitionKey: string | null): void {
    if (!chatLoopIntended) {
      return;
    }
    const offer = standByAnnouncementFor(definitionKey);
    if ('run' in offer) {
      runAudience.prepare(offer.run);
    }
  }

  /**
   * Show the chat loop before anything is sent, or take it off the screen again.
   *
   * **Nothing here starts work.** It reads the graph file, resolves its roles and
   * announces the drawing with `phase: 'ready'`. No session, no provider call, no
   * workspace, no record, no control claimed — and it refuses to displace a run that
   * is walking rather than overwriting the announcement a graph view is drawing from.
   *
   * It also opens no window. A graph view that is open sees the loop appear; one that
   * is not stays closed, because a tick-box is not a request for a second window and
   * DSP-28 #1 has one editor.
   *
   * A graph that cannot be read or does not validate answers `not-shown` with the
   * reason. That is deliberately not a refusal to work: `startChatLoopRun` checks the
   * same file for itself and gives its own account, so a preview that cannot be drawn
   * never becomes a reason a mandate cannot be sent.
   */
  ipcMain.handle(
    PREPARE_CHAT_LOOP,
    (_event, wanted: boolean, definitionKey: string | null): ChatLoopPrepareOutcome => {
      // Before the early return, because untickng is exactly the state that has to be
      // remembered: a run that ends afterwards must not put the pulse back (#6).
      chatLoopIntended = wanted;
      if (!wanted) {
        runAudience.standDown();
        return { kind: 'stood-down' };
      }
      /*
       * The same key `startChatLoopRun` will use, resolved by the same procedure and
       * read from disk now.
       *
       * Deliberately not a pinned copy of an earlier read. A preview showing bytes the
       * file has since moved past would differ from what Send walks with nothing on
       * screen saying so, and pinning belongs at the start of a run rather than here.
       * The window asks for this again whenever it comes back to the front, which is
       * what keeps the drawing on screen the drawing on disk.
       */
      // A key the window names is a choice the person made, so the workspace keeps
      // it. `null` is the window asking for the default and is deliberately not
      // recorded: resolving a default is not choosing one.
      noteChosenLoopDefinition(definitionKey);
      const offer = standByAnnouncementFor(definitionKey);
      /*
       * A preview that can no longer be read takes the old picture down with it.
       *
       * Leaving the last drawing on screen would be the failure this card is about
       * wearing a different hat: a graph marked ready that is not what a Send would
       * walk, and in this case is not on disk at all. `standDown` withdraws a stand-by
       * offer only and leaves a walking run alone, so this cannot disturb real work.
       */
      const withdrawStalePreview = (note: string): ChatLoopPrepareOutcome => {
        runAudience.standDown();
        return { kind: 'not-shown', note };
      };
      if (!('run' in offer)) {
        return withdrawStalePreview(offer.note);
      }
      const run = offer.run;
      if (!runAudience.prepare(run)) {
        return {
          kind: 'not-shown',
          note:
            'A loop run is already on screen, so the graph view keeps showing the run ' +
            'that is walking rather than the loop you have just chosen. Nothing was ' +
            'started or stopped.',
        };
      }
      return { kind: 'shown', run };
    },
  );

  ipcMain.handle(CANCEL_CHAT_LOOP_RUN, (): ChatLoopCancelOutcome => {
    if (chatLoopAbort === null) {
      return { cancelled: false, note: 'No chat loop is in progress.' };
    }
    chatLoopAbort.abort();
    return {
      cancelled: true,
      note: 'Cancel requested. Completed steps are not replayed; files stay as they are.',
    };
  });
}

/**
 * What the run's ending says about messages no step ever took.
 *
 * §4.4's last requirement — *if no step receives it before the run ends, say
 * so* — kept on disk rather than only on screen. It goes on the ending note
 * because that needs no new record line kind: a reader asking what became of a
 * message is asking how the run ended, and that is the line they are already
 * reading. The texts are included whole, because a message nobody acted on is
 * exactly the one a person will want to send again.
 *
 * `''` when everything was delivered, so an ordinary run's ending note is byte
 * for byte what it was.
 */
function undeliveredNote(
  undelivered: readonly { readonly text: string }[],
): string {
  if (undelivered.length === 0) {
    return '';
  }
  const each = undelivered.map((entry) => `“${entry.text}”`).join('; ');
  return (
    ` ${undelivered.length === 1 ? 'One message' : `${String(undelivered.length)} messages`} you ` +
    `sent while this run was working never reached a step, because the run ended before ` +
    `another step started: ${each}. No agent received ${undelivered.length === 1 ? 'it' : 'them'} ` +
    `and nothing was done about ${undelivered.length === 1 ? 'it' : 'them'}.`
  );
}

/**
 * The role a node names, resolved into the three fields a prompt needs.
 *
 * DSP-46 #1. `null` for a node that names no role — a gate or a terminal — and for one
 * whose reference cannot be resolved, which validation refuses before a run starts and
 * which is therefore unreachable here rather than tolerated: a role that failed to
 * resolve must not become a prompt claiming a role with nothing in it, and
 * `loadLoopGraph` has already declined to give us the graph in that case.
 *
 * Resolution is the resolver's, not a second reader beside it, so the text validation
 * checked is the text the agent is sent.
 */
function chatRoleTextFor(node: LoopNode, resolve: RoleResolver): ChatRoleText | null {
  if (node.role === undefined) {
    return null;
  }
  const resolved = resolve(node.role);
  if (resolved === null) {
    return null;
  }
  return {
    id: resolved.id,
    sourcePath: resolved.sourcePath,
    instructions: resolved.instructions ?? null,
  };
}

/**
 * Write the run's last line and hand the same decision back to the window.
 *
 * **One decision, made once.** The outcome is computed here, written into the
 * record, and returned to the renderer, so the chat column, the saved history and
 * anything later that reads the file are all reporting the same value rather than
 * three derivations of it. DSP-26 #1 is that rule; the defect it prevents is the
 * one Niclas met, where a badge read the walk's status and the sentence beside it
 * read the terminal and they disagreed about the same run.
 *
 * A record that could not be written is reported rather than hidden: `recordNote`
 * carries the writer's own account, and the window says the run will not be there
 * after a restart instead of implying that it will.
 */
function closeChatLoopRecord(
  record: RunRecordWriter,
  input: {
    readonly kind: RecordedEndingKind;
    readonly result: RunResult | null;
    readonly inspection: LiveInspection | null;
    readonly note: string;
    readonly modelRequested: string;
    readonly cancelled: boolean;
  },
): ChatLoopRecordInfo {
  const atUtc = new Date().toISOString();
  const commands: readonly RecordedCommand[] = (input.inspection?.commands ?? []).map((command) =>
    // No clock reading passed in: each command carries the moment it really
    // started, so these copies inside the ending line say the same thing as the
    // lines written while the run was still walking.
    recordedCommandFrom(command, input.inspection?.snapshotAfter?.snapshotId ?? null),
  );
  const outcome = runOutcomeFrom({
    commands,
    status: input.result?.status ?? null,
    cancelled: input.cancelled || (input.inspection?.cancelled ?? false),
    // True here by construction: this function is what writes the ending line, so
    // the record is complete the moment it returns. Incompleteness is something a
    // *reader* discovers, and `parseRunRecord` is where it is discovered.
    recordComplete: true,
  });
  const terminalNodeId =
    input.result?.status === 'completed' ? (input.result.terminalNodeId ?? null) : null;
  /**
   * What the walk ended at, for the sentence beside the badge.
   *
   * DSP-44 #4 and DSP-48 #1. Three endings recorded one outcome and therefore one
   * identical paragraph, and the counts cannot tell two of them apart because both
   * are zero — so the terminal id is threaded, from the same moment that already
   * holds it. The paths come from the same inspection the snapshot lines do, so the
   * ending a person reads and the record a reviewer reads name the same files.
   *
   * `runOutcomeFrom` above is deliberately not given this: the recorded outcome must
   * not become something a walk can earn by arriving.
   */
  const moved = boundedPathList([
    ...(input.inspection?.changedFiles ?? []).map((file) => file.relPath),
    ...(input.inspection?.addedFiles ?? []).map((file) => file.relPath),
    ...(input.inspection?.removedFiles ?? []).map((file) => file.relPath),
  ]);
  const walk: RunWalkEnding = {
    terminalNodeId,
    movedPaths: moved.named,
    movedPathsNotListed: moved.notListed,
  };
  const ending: RecordedRunEnding = {
    endedAtUtc: atUtc,
    kind: input.kind,
    status: input.result?.status ?? null,
    terminalNodeId,
    outcome,
    outcomeText: describeRunOutcome(outcome, { commands, walk }),
    modelRequested: input.modelRequested,
    modelReported: input.inspection?.modelReported ?? null,
    commands,
    snapshots:
      input.inspection === null
        ? {
            beforeId: null,
            beforeFileCount: 0,
            afterId: null,
            afterFileCount: 0,
            changed: [],
            added: [],
            removed: [],
            truncated:
              'The run did not return an inspection, so DSpatch has no before or after ' +
              'snapshot of the project for it. That is unknown rather than unchanged: ' +
              'check the project itself.',
          }
        : recordedSnapshotsFrom(input.inspection),
    note: input.note,
    cancelled: input.cancelled || (input.inspection?.cancelled ?? false),
    cost: input.inspection?.cost ?? 'unknown',
  };
  record.finish(ending);
  const failures = record.failures();
  return {
    ending,
    recordPath: failures.length === 0 ? record.filePath() : null,
    recordNote: failures.length === 0 ? null : failures.join(' '),
  };
}

/**
 * Dispose the adapter before closing the app. The provider path owns a local
 * agent runtime and on-disk storage with open files; exiting without disposal
 * would leave those resources behind.
 */
function registerLifecycle(): void {
  app.on('before-quit', (event) => {
    if (serviceDisposed) {
      return;
    }
    event.preventDefault();
    disposeThenEnd(() => {
      app.quit();
    }, 'quit');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

function main(): void {
  const modes = [smokeMode, probeMode, chatRunMode].filter(Boolean).length;
  if (modes > 1) {
    log(
      'DSPATCH_SMOKE, DSPATCH_PROBE and DSPATCH_CHAT_RUN each own the exit code ' +
        'and would fight over it. Set at most one.',
    );
    app.exit(PROBE_EXIT.misconfigured);
    return;
  }

  registerLifecycle();

  installApplicationMenu();

  void app.whenReady().then(() => {
    // First lines in the log on purpose. Which build this is and where its data
    // goes are the two questions every later line depends on, and a packaged
    // application answers neither by looking at it. `userData` is here because a
    // trial that redirects it with `--user-data-dir` should be able to confirm the
    // redirection from the app rather than from the command line it typed.
    const identity = buildIdentity();
    log(
      `build packaged=${String(app.isPackaged)} version=${app.getVersion()} ` +
        (identity === null || identity.error !== null
          ? `identity=unknown (${identity?.error ?? 'no manifest'})`
          : `identity=${identity.digest.slice(0, 16)} files=${String(
              identity.fileCount,
            )} git=${identity.gitRevision?.slice(0, 7) ?? 'unknown'} ` +
            `changedAtBuild=${String(identity.gitDirtyFileCount ?? -1)} ` +
            `built=${identity.generatedAtUtc}`),
    );
    log(
      `userData=${app.getPath('userData')} ` +
        `conversations=${path.join(app.getPath('userData'), 'conversations')} ` +
        `appPath=${app.getAppPath()} exe=${process.execPath}`,
    );
    // What the refusal will and will not be able to say. `ownRepo=none` is the
    // packaged-copy-moved-out case, where a chosen folder that contains DSpatch
    // cannot be recognised as such, so a log that says nothing about it would
    // leave that limit invisible in exactly the run where it applies.
    log(`ownRepo=${ownRepoRoot ?? 'none'} generatorBoundary=${probeRepoRoot()}`);
    // Before `registerIpc`, because the loop-definition handlers read the
    // workspace's remembered definition and a window that opened first would ask
    // for the list before there was one to prefer.
    restoreRememberedWorkspace();
    registerIpc();
    mainWindow = createWindow();

    if (smokeMode) {
      setTimeout(() => {
        log(
          `startup smoke test did not meet both conditions within ${String(smokeTimeoutMs)} ` +
            `ms. window shown=${String(windowShown)} ` +
            `renderer painted=${String(rendererReady)}`,
        );
        // Deliberately bypass the window wait: if it has not appeared within half a
        // minute, keeping the smoke test waiting indefinitely is worse than the
        // remaining risk of a process that fails to exit.
        exitNow(EXIT_TIMEOUT);
      }, smokeTimeoutMs);
    }

    if (chatRunMode) {
      setTimeout(() => {
        if (chatRunReported) {
          return;
        }
        chatRunReported = true;
        log(
          `scripted run did not report within ${String(chatRunTimeoutMs)} ms. ` +
            'This is a timeout, not a verdict: the turn may still be going.',
        );
        writeChatRunRecord(null);
        exitNow(rendererReady ? CHAT_EXIT_TIMEOUT : CHAT_EXIT_NO_REPORT);
      }, chatRunTimeoutMs);
    }
  });
}

main();
