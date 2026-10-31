import childProcess from 'node:child_process';
import type { HostLinkState } from '../shared/host-link';
import { remoteBuild } from '../shared/remote-build';
import { RemoteLink, type RemoteEndpoint } from './remote-link';
import { endRemoteSession, parseRemoteAddress, readRemoteSession, saveRemoteSession } from './remote-session';
import type { HostLinkEvent } from './host-connection';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, app, clipboard, desktopCapturer, dialog, ipcMain, shell, utilityProcess, webContents } from 'electron';

import type {
  AddLoopInstructionOutcome,
  AddLoopInstructionRequest,
  SteerTurnRequest,
  AttemptAcknowledgement,
  BridgeChannel,
  BuildIdentity,
  ConversationExportResult,
  ChatLoopCancelOutcome,
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
  RecentWorkspaces,
  WorkspaceOpenRequest,
  ProjectPickOutcome,
  RendererReady,
  ChatLoopPrepareOutcome,
  LoopDefinitionChooseOutcome,
  LoopDefinitionListing,
  ResolvedRoleEntry,
  ReviewWindowCheckAnswer,
  ReviewWindowCheckRequest,
  EditorWindowCheckAnswer,
  EditorWindowCheckRequest,
  PairWindowCheckRequest,
  TextPoint,
  SampleProjectsView,
  ScriptedRunPlan,
  ScriptedRunReport,
  ChatSessionInfo,
  StartSessionRequest,
  StoredSessionProvider,
  TestRunRequest,
} from '../shared/bridge';
import {
  HOST_CONFIG_ENV,
  isHostCallFailure,
  type HostEventTarget,
  type HostMessage,
  type HostShutdownAnswer,
  type HostStartConfig,
} from '../shared/host-protocol';
import type { LoopRunAgentInfo } from '../shared/loop-run-agent-text';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from '../shared/loop-control';
import type { LiveRunAnnouncement } from '../shared/loop-run-view';
import type { RoleReference } from '../shared/loop-graph';
import { REVIEW_HOST_METHODS, type ReviewHostApi, type ReviewHostError } from '../shared/review-host-contract';
import {
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
import type { DiscussionTarget } from '../shared/review-discussion';
import type {
  HostAnswerOf,
  HostArgs,
  HostCallContext,
  ProjectHostMethodName,
} from '../shared/project-host-contract';
import { HostConnection, type HostLoss, type HostProcess } from './host-connection';
import { chatRunHold, chatRunMode, chatRunScenario } from './launch-mode';
import { ownRepositoryRoot } from './own-repository';
import { PROBE_EXIT } from './probe-exit';
import { registerReviewIpc, reviewSenderRefusal, type ReviewDiscussionClient } from './review-ipc';
import { ReviewWindows } from './review-windows';

const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';
const GET_CONNECTION: BridgeChannel = 'dspatch:get-connection';
const SET_MODEL: BridgeChannel = 'dspatch:set-model';
const LIST_MODELS: BridgeChannel = 'dspatch:list-models';
const CHOOSE_AGENT: BridgeChannel = 'dspatch:choose-agent';
const MENU_COMMAND: BridgeChannel = 'dspatch:menu-command';
const PICK_PROJECT: BridgeChannel = 'dspatch:pick-project';
const LIST_RECENT_WORKSPACES: BridgeChannel = 'dspatch:list-recent-workspaces';
const REMOVE_FROM_RECENT: BridgeChannel = 'dspatch:remove-from-recent';
const OPEN_WORKSPACE: BridgeChannel = 'dspatch:open-workspace';
const LIST_SAMPLE_PROJECTS: BridgeChannel = 'dspatch:list-sample-projects';
const CLEAN_SAMPLE_PROJECTS: BridgeChannel = 'dspatch:clean-sample-projects';
const LIST_CONVERSATIONS: BridgeChannel = 'dspatch:list-conversations';
const CONVERSATION_SAVE_STATUS: BridgeChannel = 'dspatch:conversation-save-status';
const RESUME_CONVERSATION: BridgeChannel = 'dspatch:resume-conversation';
const EXPORT_CONVERSATION: BridgeChannel = 'dspatch:export-conversation';
const REVEAL_CONVERSATION: BridgeChannel = 'dspatch:reveal-conversation';
const START_SESSION: BridgeChannel = 'dspatch:start-session';
const DISCARD_PENDING_RECAP: BridgeChannel = 'dspatch:discard-pending-recap';
const COPY_TEXT: BridgeChannel = 'dspatch:copy-text';
const SEND_PROMPT: BridgeChannel = 'dspatch:send-prompt';
const CANCEL_RUN: BridgeChannel = 'dspatch:cancel-run';
const ABANDON_SEND: BridgeChannel = 'dspatch:abandon-send';
const CANCEL_OBSERVATIONS: BridgeChannel = 'dspatch:cancel-observations';
const RUN_STATE: BridgeChannel = 'dspatch:run-state';
const RUN_TEST: BridgeChannel = 'dspatch:run-test';
const STOP_TEST: BridgeChannel = 'dspatch:stop-test';
const TEST_FRESHNESS: BridgeChannel = 'dspatch:test-freshness';
const AGENT_COMMANDS: BridgeChannel = 'dspatch:agent-commands';
const WORKSPACE_CHANGES: BridgeChannel = 'dspatch:workspace-changes';
const TURN_USAGE: BridgeChannel = 'dspatch:turn-usage';
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
const OPEN_REVIEW: BridgeChannel = 'dspatch:open-review';
const OPEN_EXAMPLE_REVIEW: BridgeChannel = 'dspatch:open-example-review';
const CHECK_REVIEW_WINDOWS: BridgeChannel = 'dspatch:check-review-windows';
const CHECK_EDITOR_WINDOW: BridgeChannel = 'dspatch:check-editor-window';
const CHECK_PAIR_WINDOWS: BridgeChannel = 'dspatch:check-pair-windows';
const START_EDITOR_LOOP_RUN: BridgeChannel = 'dspatch:start-editor-loop-run';
const CANCEL_EDITOR_LOOP_RUN: BridgeChannel = 'dspatch:cancel-editor-loop-run';
const CURRENT_LOOP_RUN: BridgeChannel = 'dspatch:current-loop-run';
const CURRENT_LOOP_RUN_VIEW: BridgeChannel = 'dspatch:current-loop-run-view';
const READ_LOOP_RUN_AGENT: BridgeChannel = 'dspatch:read-loop-run-agent';
const START_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:start-chat-loop-run';
const CANCEL_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:cancel-chat-loop-run';
const PREPARE_CHAT_LOOP: BridgeChannel = 'dspatch:prepare-chat-loop';
const WORKSPACE_FOLDERS: BridgeChannel = 'dspatch:workspace-folders';
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
const STEER_TURN: BridgeChannel = 'dspatch:steer-turn';
const LIST_RUN_RECORDS: BridgeChannel = 'dspatch:list-run-records';
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

/*
 * Scripted workflow runs (`DSPATCH_CHAT_RUN`), presentation mode and hold mode are read
 * once in `launch-mode.ts`, which the project host reads too, so the two processes
 * cannot decide differently about what kind of launch this is.
 */

/**
 * The hold-mode verification aid (`DSPATCH_CHAT_HOLD_CLOSE_MS`, DSP-121 flow).
 *
 * An agent verifying the hand-over cannot close an Electron window, and a hold-mode
 * window nothing closes stays up for ever. With this set to a positive number of
 * milliseconds, and only in hold mode, the main process closes the window that long
 * after writing the record - an ordinary close, the one a person makes, so the
 * after-close record is written as it is then. The start file never sets it: a
 * window for a person stays until the person closes it.
 */
const chatRunHoldCloseMs = ((): number | null => {
  if (!chatRunHold) {
    return null;
  }
  const parsed = Number.parseInt(process.env['DSPATCH_CHAT_HOLD_CLOSE_MS'] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();

/**
 * What *Copy diagnostic info* was asked to copy during an unattended scripted run,
 * kept for the run record instead of being written to the system clipboard (DSP-121
 * flow): an automated test must never overwrite the clipboard of the person at the
 * computer. Hold mode and ordinary launches write the real clipboard.
 */
const scriptedClipboard: string[] = [];

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
                            : // Four projects opened and read back, one local command run.
                              // Nothing waits for a provider.
                              chatRunScenario === 'workspace-switch'
                              ? 300_000
                              : // One project opened, three buttons pressed, one local
                                // reply. Nothing waits for a provider.
                                chatRunScenario === 'resume-choice'
                                ? 300_000
                                : // A handful of windows opened and closed over a local
                                  // git fixture. Nothing waits for a provider.
                                  chatRunScenario === 'review-window' || chatRunScenario === 'review-direct'
                                  ? 180_000
                                  : chatRunScenario === 'review-discussion'
                                    ? 300_000
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

/**
 * Review opened directly, without a chat (DSP-126 #6): `npm run review -- <definition>`.
 *
 * `scripts/review.mjs` sets `DSPATCH_REVIEW_DEFINITION` (when a file is named) and puts
 * `#review` on the development URL. Either one asks for review alone: the review module
 * opens its own window through the same call the chat's *Open review* makes, with no
 * folder and the named definition, and no chat window is created. Closing it quits.
 *
 * The startup smoke test, the probe and every other scripted run ignore it and say so:
 * each of them is about the chat window, and a launch that silently became a review
 * window would pass or fail for the wrong reason.
 */
const reviewDefinitionAtStart = process.env['DSPATCH_REVIEW_DEFINITION'] ?? null;
const reviewAskedAtStart = reviewDefinitionAtStart !== null || (rendererUrl?.endsWith('#review') ?? false);
const directReviewMode =
  chatRunScenario === 'review-direct' || (reviewAskedAtStart && !smokeMode && !probeMode && !chatRunMode);

/** `app.quit()` loses the exit code; `app.exit(code)` preserves it. */
const EXIT_OK = 0;
const EXIT_LOAD_FAILED = 2;
const EXIT_TIMEOUT = 3;
const EXIT_RENDERER_GONE = 4;

/** Scripted-run codes. 0–4 belong to the smoke test, 10–19 to the probe. */
const CHAT_EXIT_TIMEOUT = 38;
const CHAT_EXIT_NO_REPORT = 39;
/**
 * The user-data directory is not the one the trial expected (`DSPATCH_CHAT_EXPECT_USERDATA`).
 *
 * Checked before any store of DSpatch's exists, so a scripted run that was meant to
 * work on a seeded copy can never write into somebody's real profile by mistake. Only
 * DSpatch's own files are protected by it: Chromium opens its profile files under the
 * same directory before this code runs, and that is outside DSpatch's control.
 */
const CHAT_EXIT_WRONG_USERDATA = 25;
/**
 * The resume-choice record's main-process checks contradicted a window that passed
 * (DSP-121): the session block changed before a choice, a resume was attempted a
 * different number of times, something was started or sent that should not have
 * been, or the one message went with a recap in front of it.
 */
const CHAT_EXIT_RESUME_RECORD_WRONG = 89;
/** `review-direct` (DSP-126): the review did not open by itself as it should. */
const REVIEW_EXIT_DIRECT_FAILED = 91;

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

const pathsAreCaseInsensitive = process.platform === 'win32';

/* --------------------------------------------------------------------------- */
/* The project host (DSP-111)                                                  */
/* --------------------------------------------------------------------------- */

/**
 * How long the project host may take to say it is ready. It builds its services and
 * reads the remembered workspace; a few seconds is ordinary, so this only catches a
 * host that will not come up at all.
 */
const HOST_START_TIMEOUT_MS = 30_000;

/** A scripted run, smoke test or probe whose project host could not be started. */
const HOST_EXIT_START_FAILED = 26;
/** A scripted run, smoke test or probe whose project host stopped while it ran. */
const HOST_EXIT_LOST = 27;

/** A call that came from no particular window: a menu item, the probe, a scripted check. */
const NO_SENDER = { senderId: null } as const;

/** The call's context for a window's request: which renderer events about it go back to. */
function from(event: Electron.IpcMainInvokeEvent): { readonly senderId: number } {
  return { senderId: event.sender.id + senderBase() };
}

/**
 * Window ids start again with every launch, and a remote host outlives the launch: without
 * this, an event for a window of the last client would reach a window of this one.
 */
const SENDER_SPAN = 1_000_000;
let senderOffset: number | null = null;

function senderBase(): number {
  if (senderOffset === null) {
    senderOffset = remoteSession() === null ? 0 : (1 + Math.floor(Math.random() * 1_000_000)) * SENDER_SPAN;
  }
  return senderOffset;
}

/** How long a review window may take to save its view when the host changes under it. */
const HOST_MOVE_WINDOW_MS = 3_000;

/** Stop using the current host's connection; the next start uses `next`. */
function forgetHost(next: RemoteEndpoint | null): void {
  remoteLink?.kill();
  remoteLink = null;
  remoteEndpoint = next;
  senderOffset = null;
}

let hostMoving = false;

/**
 * Change which host this client works on, in this process.
 *
 * It was `app.relaunch()` and `app.exit(0)`, and that is what the first real trial tripped on:
 * the relaunched client is detached from the terminal, so its log goes to /dev/null and the
 * prompt comes back whether or not a window ever appears, and on one laptop none did. The exit
 * also killed the local host without its orderly close, which read as a crash. Here the
 * process, its log and its environment stay: windows that belong to the old host save and
 * close, the old host closes the way a quit closes it (a remote one is left running), and the
 * chat window reloads against the new one. Nothing is sent again: no call crosses the change,
 * and a window reloaded here reads what its host saved.
 *
 * Answers a sentence for the window when the change did not happen, otherwise `''`.
 */
async function moveToHost(next: RemoteEndpoint | null, remember: () => void, reason: string): Promise<string> {
  if (hostMoving) {
    return 'DSpatch is already changing host.';
  }
  hostMoving = true;
  try {
    const drawing = unsavedDrawing;
    if (drawing !== null) {
      const answer = await askAboutUnsavedDrawing(drawing, 'reload');
      if (answer === 'cancel') {
        return 'Stayed where you are: the loop editor holds unsaved changes.';
      }
      if (answer === 'discard') {
        unsavedDrawing = null;
      } else {
        const failure = await writeUnsavedDrawing(drawing, 'reload');
        if (failure !== null) {
          return `Stayed where you are: the loop editor's drawing could not be saved. ${failure}`;
        }
      }
    }
    log(reason);
    // The last window closing would quit: a launch of the review alone has no chat window.
    if (liveMainWindow() === null) {
      mainWindow = createWindow();
    }
    await reviewWindows?.closeAll(HOST_MOVE_WINDOW_MS);
    if (editorWindow !== null && !editorWindow.isDestroyed()) {
      editorWindow.close();
    }
    const boundMs = (host.closeBoundMs() ?? 0) + HOST_CLOSE_MARGIN_MS;
    await host.shutdown('host.shutdown', [NO_SENDER, { observeConversationFiles: false }], boundMs);
    forgetHost(next);
    remember();
    if (await startHostOrQuit()) {
      if (remoteSession() === null) {
        publishLink({ phase: 'connected', note: '' });
      }
      liveMainWindow()?.webContents.reload();
    }
    return '';
  } finally {
    hostMoving = false;
  }
}

/** Back to this computer's own host. */
function leaveRemoteSession(): Promise<string> {
  return moveToHost(
    null,
    () => {
      endRemoteSession(app.getPath('userData'));
    },
    'leaving the remote session; working on this computer',
  );
}

/** The connection line and the host chooser, for every window (DSP-111). */
function registerHostLinkIpc(): void {
  ipcMain.handle('dspatch:host-link-state', () => hostLink);
  ipcMain.on('dspatch:host-link-retry', () => {
    remoteLink?.retryNow();
  });
  ipcMain.on('dspatch:remote-leave', () => {
    void leaveRemoteSession();
  });
  ipcMain.handle('dspatch:remote-connect', (_event, address: unknown, token: unknown): Promise<string> | string => {
    if (typeof address !== 'string' || typeof token !== 'string' || token.trim() === '') {
      return 'Give the address and the token.';
    }
    const parsed = parseRemoteAddress(address);
    if ('error' in parsed) {
      return parsed.error;
    }
    return moveToHost(
      { ...parsed, token: token.trim() },
      () => {
        saveRemoteSession(app.getPath('userData'), `${parsed.host}:${String(parsed.port)}`, token.trim());
      },
      `connecting to the host at ${parsed.host}:${String(parsed.port)}`,
    );
  });
  ipcMain.handle('dspatch:host-browse', (_event, folder: unknown) => hostCall('files.browse', NO_SENDER, typeof folder === 'string' ? folder : null));
  ipcMain.on('dspatch:host-browse-done', (_event, chosen: unknown) => {
    browseDone?.(typeof chosen === 'string' ? chosen : null);
  });
}

/**
 * A remote trial's proof that this process leaves the project alone (`scripts/remote-trial.mjs`).
 * Read only in a scripted run. Every touch of a path under the root is logged and refused, and
 * every child process logged, so a client that quietly read the project shows in the trial.
 */
function guardProjectFiles(root: string): void {
  const inside = (candidate: unknown): boolean => {
    const text = typeof candidate === 'string' ? candidate : candidate instanceof URL ? candidate.pathname : '';
    return text !== '' && path.resolve(text).toLowerCase().startsWith(path.resolve(root).toLowerCase());
  };
  const files = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['readFileSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'openSync', 'realpathSync', 'accessSync', 'writeFileSync']) {
    const original = files[name] as (...args: unknown[]) => unknown;
    files[name] = (...args: unknown[]) => {
      if (inside(args[0])) {
        log(`the client touched the project: ${name} ${String(args[0])}`);
        throw new Error(`The client may not touch ${String(args[0])}.`);
      }
      return original(...args);
    };
  }
  const children = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['spawn', 'execFile']) {
    const original = children[name] as (...args: unknown[]) => unknown;
    children[name] = (...args: unknown[]) => {
      log(`the client touched the project: it started ${String(args[0])}`);
      return original(...args);
    };
  }
}

/** What the host is told at start: the values the Electron `app` object holds. */
function hostStartConfig(): HostStartConfig {
  return {
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    appPath: app.getAppPath(),
    clientPid: process.pid,
  };
}

/**
 * Start the project host as an Electron utility process: a Node process of its own,
 * reached over the local process channel (`postMessage`), with nothing on a network.
 * Its log lines are passed through to this process's log unchanged, so a run's log
 * reads as one log.
 */
function spawnUtilityHost(): HostProcess {
  const entry = path.join(__dirname, '..', 'host', 'host-process.js');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[name] = value;
    }
  }
  env[HOST_CONFIG_ENV] = JSON.stringify(hostStartConfig());
  const child = utilityProcess.fork(entry, [], {
    env,
    stdio: 'pipe',
    serviceName: 'DSpatch project host',
  });
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000);
  });
  return {
    post: (message: HostMessage) => {
      child.postMessage(message);
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.once('exit', (code: number) => {
        listener(code);
      });
    },
    kill: () => {
      child.kill();
    },
    pid: () => child.pid,
    stderrTail: () => stderr,
  };
}

/**
 * The connection to the project host. Every service of a project's work is there:
 * the chat and its adapter, projects, conversations, the workspace, loop runs, review
 * and the review discussions. This process keeps the windows and what only a window
 * system can do.
 */
const host = new HostConnection({
  spawn: () => {
    const remote = remoteSession();
    if (remote === null) {
      return spawnUtilityHost();
    }
    publishLink({ phase: 'connecting', note: '' });
    remoteLink = new RemoteLink({ endpoint: remote, build: remoteBuild(app.getAppPath()), log });
    return remoteLink;
  },
  startTimeoutMs: HOST_START_TIMEOUT_MS,
  onEvent: (to, channel, payload) => {
    deliverHostEvent(to, channel, payload);
  },
  onLost: (loss) => {
    void hostLost(loss);
  },
  onLink: (event) => {
    linkChanged(event);
  },
  log,
});

/** The host on another machine this launch uses, or `null` for this computer's own. */
let remoteEndpoint: RemoteEndpoint | null | undefined;

let remoteLink: RemoteLink | null = null;

function remoteSession(): RemoteEndpoint | null {
  if (remoteEndpoint === undefined) {
    remoteEndpoint = readRemoteSession(app.getPath('userData'), process.env);
  }
  return remoteEndpoint;
}

/** What every window shows of the connection (DSP-111). */
let hostLink: HostLinkState = { remote: false, phase: 'connected', machine: '', address: '', note: '' };

function publishLink(change: Pick<HostLinkState, 'phase' | 'note'>): void {
  const remote = remoteSession();
  const address = remote === null ? '' : `${remote.host}:${String(remote.port)}`;
  hostLink = { remote: remote !== null, address, machine: remoteLink?.machineName() || address, ...change };
  log(`host link: ${hostLink.phase}${hostLink.note === '' ? '' : ` (${hostLink.note})`}`);
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) {
      contents.send('dspatch:host-link', hostLink);
    }
  }
}

/** The connection came or went. Windows keep what they show; nothing is sent again. */
function linkChanged(event: HostLinkEvent): void {
  if (event.kind === 'disconnected') {
    publishLink({ phase: 'reconnecting', note: 'Connection lost. This does not stop work on the host; how it stands is unknown until the connection is back. Nothing is sent meanwhile.' });
  } else if (event.kind === 'refused') {
    publishLink({ phase: 'stopped', note: event.message });
  } else {
    publishLink({ phase: 'connected', note: '' });
    if (!event.first && !event.resumed) {
      // Too much happened while away to replay: the windows read what the host has now.
      void reviewWindows?.reattach(true);
      reloadOpenWindows();
    }
  }
}

function reloadOpenWindows(): void {
  const main = liveMainWindow();
  if (main !== null) {
    main.webContents.reload();
  }
  if (editorWindow !== null && !editorWindow.isDestroyed()) {
    editorWindow.webContents.reload();
  }
}

/**
 * The file choosers. Local: the native dialog. In a remote session the paths are the host's,
 * so a small window browses the host; a path on this machine would mean nothing there.
 */
const pickers = {
  showOpenDialog: (first: BrowserWindow | Electron.OpenDialogOptions, second?: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
    const options = second ?? (first as Electron.OpenDialogOptions);
    if (remoteSession() !== null) {
      return pickOnHost(options);
    }
    return second === undefined ? dialog.showOpenDialog(options) : dialog.showOpenDialog(first as BrowserWindow, options);
  },
  showSaveDialog: (first: BrowserWindow | Electron.SaveDialogOptions, second?: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    const options = second ?? (first as Electron.SaveDialogOptions);
    if (remoteSession() !== null) {
      return pickOnHost({ ...options, properties: ['openFile'], ...{ saving: true } }).then((picked) => ({ canceled: picked.canceled, filePath: picked.filePaths[0] ?? '' }));
    }
    return second === undefined ? dialog.showSaveDialog(options) : dialog.showSaveDialog(first as BrowserWindow, options);
  },
};

let browseDone: ((chosen: string | null) => void) | null = null;

let browseWindow: BrowserWindow | null = null;

/** The host chooser, one at a time, in a window of its own. */
function pickOnHost(options: Electron.OpenDialogOptions & { readonly saving?: boolean }): Promise<Electron.OpenDialogReturnValue> {
  return new Promise((resolve) => {
    browseDone?.(null);
    const mode = options.saving === true ? 'save' : options.properties?.includes('openDirectory') === true ? 'folder' : 'file';
    const parent = liveMainWindow();
    const window = new BrowserWindow({
      width: 620,
      height: 520,
      title: options.title ?? 'Choose on the host',
      backgroundColor: '#101317',
      ...(parent === null ? {} : { parent, modal: true }),
      webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.removeMenu();
    browseWindow = window;
    let answered = false;
    const answer = (chosen: string | null): void => {
      if (!answered) {
        answered = true;
        browseDone = null;
        resolve({ canceled: chosen === null, filePaths: chosen === null ? [] : [chosen] });
      }
    };
    browseDone = (chosen) => {
      answer(chosen);
      if (!window.isDestroyed()) {
        window.close();
      }
    };
    window.webContents.once('destroyed', () => {
      answer(null);
    });
    const search = `window=browse&mode=${mode}&title=${encodeURIComponent(options.title ?? '')}`;
    if (rendererUrl === undefined) {
      void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { search });
    } else {
      const base = rendererUrl.split('#')[0] ?? rendererUrl;
      void window.loadURL(`${base}${base.includes('?') ? '&' : '?'}${search}`);
    }
  });
}

/** Deliver an event from the host to the windows of the audience it names. */
function deliverHostEvent(to: HostEventTarget, channel: string, payload: unknown): void {
  switch (to.kind) {
    case 'main-window':
      sendToMainWindow(channel as BridgeChannel, payload);
      return;
    case 'every-window':
      sendToEveryWindow(channel as BridgeChannel, payload);
      return;
    case 'run-audience':
      for (const contents of runAudience) {
        if (contents.isDestroyed()) {
          runAudience.delete(contents);
          continue;
        }
        try {
          contents.send(channel, payload);
        } catch {
          // A window that went away between the check and the send is not an error
          // worth stopping anything for. The others still get the event.
        }
      }
      return;
    case 'review-pair':
      // DSP-150: a pair's record changed. Every review window over that pair reads it
      // again — the diff window and each walk over the same revisions.
      for (const entry of reviewWindows?.windowsOverPair(to.key) ?? []) {
        if (!entry.contents.isDestroyed()) {
          entry.contents.send(channel, payload);
        }
      }
      return;
    case 'contents': {
      // The window that started the work, if it is still there: what
      // `event.sender.isDestroyed()` guarded when the work ran in this process.
      const local = to.id - senderBase();
      const contents = local > 0 && local < SENDER_SPAN ? webContents.fromId(local) : undefined;
      if (contents !== undefined && !contents.isDestroyed()) {
        contents.send(channel, payload);
      }
      return;
    }
    default:
      return;
  }
}

/** A message box for a person, attached to the chat window when there is one. */
async function askPerson(options: Electron.MessageBoxOptions): Promise<number> {
  const parent = liveMainWindow();
  const answer = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
  return answer.response;
}

/** Whether nobody is at the window to answer a question: a scripted run, the smoke test, the probe. */
function unattended(): boolean {
  return smokeMode || probeMode || (chatRunMode && !chatRunHold);
}

/**
 * Start the project host before any window asks it anything, and say plainly when it
 * cannot be started. Nothing is open yet, so nothing can be lost: the person can try
 * again or quit. An unattended run exits with its own code instead of a dialog nobody
 * can press.
 */
async function startHostOrQuit(): Promise<boolean> {
  for (;;) {
    const started = await host.start();
    if (started.ok) {
      if (remoteSession() !== null) {
        const hostBuild = remoteLink?.build();
        const mine = remoteBuild(app.getAppPath());
        publishLink({ phase: 'connected', note: hostBuild !== null && hostBuild !== undefined && hostBuild.commit !== mine.commit ? `The host is at ${hostBuild.commit}, this client at ${mine.commit}.` : '' });
      }
      return true;
    }
    log(`project host could not be started: ${started.failure.message} ${started.failure.detail ?? ''}`.trim());
    if (unattended()) {
      app.exit(HOST_EXIT_START_FAILED);
      return false;
    }
    const remote = remoteSession();
    if (remote !== null) {
      const response = await askPerson({
        type: 'error',
        buttons: ['Try again', 'Work on this computer', 'Quit DSpatch'],
        defaultId: 0,
        cancelId: 2,
        title: 'DSpatch could not reach the host',
        message: `No DSpatch host answered at ${remote.host}:${String(remote.port)}.`,
        detail:
          'Check that the host is running on the other machine and that the SSH tunnel is up. ' +
          `Nothing was sent.\n\n${started.failure.detail ?? started.failure.message}`,
      });
      if (response === 1) {
        // Here, not through `moveToHost`: this may be the launch's own start, with no window yet.
        endRemoteSession(app.getPath('userData'));
        forgetHost(null);
        continue;
      }
      if (response !== 0) {
        app.exit(HOST_EXIT_START_FAILED);
        return false;
      }
      continue;
    }
    const response = await askPerson({
      type: 'error',
      buttons: ['Try again', 'Quit DSpatch'],
      defaultId: 0,
      cancelId: 1,
      title: 'DSpatch could not start',
      message: started.failure.message,
      detail:
        'DSpatch keeps a project’s work (the conversations, git, agents and loop runs) in ' +
        'a process of its own, and that process did not start. Nothing was opened or changed.' +
        (started.failure.detail === undefined || started.failure.detail === ''
          ? ''
          : `\n\nWhat it reported:\n${started.failure.detail}`),
    });
    if (response !== 0) {
      app.exit(HOST_EXIT_START_FAILED);
      return false;
    }
  }
}

/**
 * The host stopped by itself while DSpatch was running.
 *
 * **Nothing is repeated.** Every call it had not answered was answered with
 * `host-lost`, whose words say the outcome is unknown, and the windows got that answer.
 * Work the host had started may have finished or not; DSpatch does not know and does
 * not guess. What it saved before it stopped is on disk: conversations (with their
 * attempts, so an earlier message with no confirmed end reads as such), run records
 * (an interrupted run reads back as incomplete) and review records.
 *
 * A restart starts an empty host and reloads the windows, which then read what was
 * saved. It opens no project and sends nothing: opening a project again is the
 * person's act, as after any restart. Review windows keep their place and are given
 * fresh sessions on the new host.
 */
async function hostLost(loss: HostLoss): Promise<void> {
  if (remoteSession() !== null) {
    // A host on another machine that was restarted: every call waiting has its answer, and
    // the windows read what it saved. Nothing is started or sent again, so nothing to ask.
    log(`the remote host was restarted; ${String(loss.unanswered.length)} unanswered call(s) read as unknown`);
    publishLink({ phase: 'reconnecting', note: 'The host was restarted. What was running there has ended with an unknown outcome.' });
    if (!(await startHostOrQuit())) {
      return;
    }
    if (remoteSession() === null) {
      // The person chose this computer instead: what the review windows show is the other host's.
      await reviewWindows?.closeAll(HOST_MOVE_WINDOW_MS);
      publishLink({ phase: 'connected', note: '' });
      reloadOpenWindows();
      return;
    }
    if (reviewWindows !== null) {
      await reviewWindows.reattach(true);
    }
    publishLink({ phase: 'connected', note: 'The host was restarted. What was running there ended with an unknown outcome; saved work is there.' });
    reloadOpenWindows();
    return;
  }
  if (unattended()) {
    log(`project host lost during an unattended run; exiting with ${String(HOST_EXIT_LOST)}`);
    exitNow(HOST_EXIT_LOST);
    return;
  }
  const pending =
    loss.unanswered.length === 0
      ? 'Nothing was waiting for an answer from it.'
      : `${String(loss.unanswered.length)} request${loss.unanswered.length === 1 ? ' was' : 's were'} ` +
        `waiting for an answer (${loss.unanswered.join(', ')}); whether ` +
        `${loss.unanswered.length === 1 ? 'it was' : 'they were'} done is unknown.`;
  const drawing =
    unsavedDrawing === null
      ? ''
      : ` The loop editor is holding unsaved changes to ${unsavedDrawing.path}; you will be asked ` +
        'about them before it is reloaded.';
  const response = await askPerson({
    type: 'error',
    buttons: ['Restart and reload the windows', 'Quit DSpatch'],
    defaultId: 0,
    cancelId: 1,
    title: 'DSpatch stopped working on the project',
    message: 'DSpatch’s project host stopped unexpectedly.',
    detail:
      `${pending} Work that was in progress (an agent turn, a command, a loop step) may still ` +
      'be running, or may have finished: DSpatch does not know, and has not sent anything ' +
      'again. What was saved before it stopped is on disk: conversations, run records and ' +
      'reviews.\n\n' +
      'Restarting starts the host again and reloads the windows; they read what was saved and ' +
      `start nothing. Open the project again to continue.${drawing}` +
      `\n\nExit code: ${String(loss.exitCode)}` +
      (loss.stderrTail === '' ? '' : `\n${loss.stderrTail}`),
  });
  if (response !== 0) {
    app.quit();
    return;
  }
  if (!(await startHostOrQuit())) {
    return;
  }
  if (reviewWindows !== null) {
    await reviewWindows.reattach();
  }
  // The editor's unsaved drawing is the person's work and lives only in that window:
  // reloading the editor would draw the file on disk over it (DSP-86, DSP-88: unsaved
  // edits are never skipped quietly). So it is asked about first, and *keep* leaves the
  // editor as it is, not reloaded.
  let reloadEditor = true;
  const pendingDrawing = unsavedDrawing;
  if (pendingDrawing !== null) {
    const answer = await askAboutUnsavedDrawing(pendingDrawing, 'reload');
    if (answer === 'cancel') {
      reloadEditor = false;
    } else if (answer === 'discard') {
      unsavedDrawing = null;
      log(`the editor's drawing was discarded on the person's say-so before a reload: ${pendingDrawing.path}`);
    } else {
      const failure = await writeUnsavedDrawing(pendingDrawing, 'reload');
      if (failure !== null) {
        reloadEditor = false;
        log(`the editor was not reloaded, because its drawing could not be saved: ${failure}`);
        void askPerson({ type: 'warning', buttons: ['OK'], message: 'The loop editor was not reloaded', detail: failure });
      }
    }
  }
  // The drawing is the editor window's, or the main window's when that window is the
  // editor (`npm run editor`); that window alone is kept when the person said keep.
  const main = liveMainWindow();
  const editor = editorWindow !== null && !editorWindow.isDestroyed() ? editorWindow : null;
  const holdsDrawing = editor ?? main;
  for (const window of new Set([main, editor])) {
    if (window !== null && (reloadEditor || window !== holdsDrawing || pendingDrawing === null)) {
      window.webContents.reload();
    }
  }
}

/**
 * Call a project host method, typed by its contract (`shared/project-host-contract.ts`):
 * the method's own answer, or an `Error` with the method's own words, as a window's
 * `ipcRenderer.invoke` already sees them.
 */
function hostCall<K extends ProjectHostMethodName>(
  method: K,
  context: HostCallContext,
  ...args: HostArgs<K>
): Promise<Awaited<HostAnswerOf<K>>> {
  return host.call<Awaited<HostAnswerOf<K>>>(method, context, ...args);
}

/** Log a host call that failed where nobody waits for its answer (a menu item). */
function logIfFailed(what: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    log(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * The review host's contract, reached through the project host (DSP-111).
 *
 * The review windows call `ReviewHostApi` exactly as they did; each method is the host's
 * `review.<method>`. A failure of the channel itself (the host not running, or stopping
 * before it answered) is answered as a review host error, so the contract's promise
 * holds: every call answers, and none throws.
 */
const CHANNEL_FAILURES: ReadonlySet<string> = new Set(['failed', 'unknown-method', 'host-unavailable', 'host-lost']);

function remoteReviewHost(): ReviewHostApi {
  const bound: Record<string, (request?: unknown) => Promise<unknown>> = {};
  for (const method of REVIEW_HOST_METHODS) {
    bound[method] = async (request?: unknown): Promise<unknown> => {
      const answer = await host.answer(`review.${method}`, NO_SENDER, request);
      // The review host's own errors pass through as the values they are. A failure of
      // the channel (or a method that threw) becomes the review contract's `internal`,
      // with its words kept, because the review view already says those plainly.
      if (isHostCallFailure(answer) && CHANNEL_FAILURES.has(answer.code)) {
        return {
          kind: 'host-error',
          code: 'internal',
          message: answer.message,
          ...(answer.detail === undefined ? {} : { detail: answer.detail }),
        } satisfies ReviewHostError;
      }
      return answer;
    };
  }
  return bound as unknown as ReviewHostApi;
}

/** The review discussions, reached through the project host, for `review-ipc.ts`. */
const reviewDiscussionClient: ReviewDiscussionClient = {
  // DSP-149: the same host functions as the chat window's model choice.
  listModels: (provider) => hostCall('chat.listModels', NO_SENDER, provider as StoredSessionProvider),
  chooseModel: (provider, modelId) =>
    hostCall('chat.chooseModel', NO_SENDER, provider as StoredSessionProvider, String(modelId)),
  call: (method, target: DiscussionTarget, argument) =>
    hostCall(`discussion.${method}`, NO_SENDER, { ...target, targetId: target.targetId + senderBase() }, argument),
  detach: (targetId) => {
    logIfFailed('detaching a review window from its discussion', hostCall('discussion.detach', NO_SENDER, targetId + senderBase()));
  },
};

let serviceDisposed = false;
let probeStarted = false;

/* --------------------------------------------------------------------------- */
/* A workspace of open folders (DSP-71)                                        */
/* --------------------------------------------------------------------------- */

/*
 * The folders, the chosen loop and the saved workspace file are the host's
 * (`project-host.ts`). What is here is the half only a window system has: the native
 * chooser that asks a person which folder or file. Its answer is a path, and the host
 * is given the path.
 */

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
    const picked = await pickers.showOpenDialog({
      title: 'Add a folder to the workspace',
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return hostCall('workspace.view', NO_SENDER);
    }
    chosen = picked.filePaths[0] as string;
  }
  return hostCall('workspace.addFolder', NO_SENDER, chosen);
}

/** Open a saved workspace: the folders it lists, and the loop definition it chose. */
async function openWorkspace(filePath: string | null): Promise<WorkspaceView> {
  let target = filePath;
  if (target === null) {
    const picked = await pickers.showOpenDialog({
      title: 'Open a workspace',
      filters: [{ name: 'DSpatch workspace', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return hostCall('workspace.view', NO_SENDER);
    }
    target = picked.filePaths[0] as string;
  }
  return hostCall('workspace.openFile', NO_SENDER, target);
}

/**
 * Write the open folders and the chosen definition to a file.
 *
 * DSP-71 #5 is `workspaceFileText`'s doing: a workspace holds folders and a loop, and
 * there is no field in it for a run result.
 */
async function saveWorkspace(filePath: string | null): Promise<WorkspaceView> {
  let target = filePath;
  if (target === null) {
    const current = await hostCall('workspace.view', NO_SENDER);
    const picked = await pickers.showSaveDialog({
      title: 'Save workspace',
      defaultPath: current.filePath ?? `my.${WORKSPACE_FILE_EXTENSION}`,
      filters: [{ name: 'DSpatch workspace', extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePath === undefined || picked.filePath === '') {
      return current;
    }
    target = picked.filePath;
  }
  return hostCall('workspace.saveFile', NO_SENDER, target);
}

/**
 * The folders, the tree and the reading view, over IPC.
 *
 * Every handler here is a read or a change to a list of folders. None of them starts
 * a session, changes a working copy or touches a run — which is DSP-73 #3 as a
 * property of what is registered rather than of what the window happens to call.
 */
function registerWorkspaceIpc(): void {
  ipcMain.handle(WORKSPACE_FOLDERS, (): Promise<WorkspaceView> => hostCall('workspace.view', NO_SENDER));
  ipcMain.handle(
    ADD_WORKSPACE_FOLDER,
    (_event, folderPath: string | null): Promise<WorkspaceView> =>
      addWorkspaceFolder(folderPath),
  );
  ipcMain.handle(
    REMOVE_WORKSPACE_FOLDER,
    (_event, folderPath: string): Promise<WorkspaceView> => hostCall('workspace.removeFolder', NO_SENDER, folderPath),
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
    (_event, dirPath: string): Promise<DirectoryPage> => hostCall('workspace.readDirectory', NO_SENDER, dirPath),
  );
  ipcMain.handle(
    READ_WORKSPACE_FILE,
    (_event, filePath: string): Promise<FileView> => hostCall('workspace.readFile', NO_SENDER, filePath),
  );
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
  // The bytes are the host's, read there exactly as the store keeps them; the copy is
  // written here, where the person chose (DSP-111).
  const source = await hostCall(
    'conversations.readBytes',
    NO_SENDER,
    conversationId,
  );
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
        ? await pickers.showSaveDialog(options)
        : await pickers.showSaveDialog(window, options);
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

async function environmentInfo(): Promise<EnvironmentInfo> {
  // The agent is the host's to say; the application's own name, build and versions
  // are this process's.
  const facts = await hostCall('chat.environment', NO_SENDER);
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
    // DSP-136: a reading of the open session's adapter, never a construction. At
    // startup no session is open, so this is null and no adapter exists.
    ...facts,
  };
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

/**
 * The review module's windows (DSP-126). Created when the app is ready; the chat
 * reaches review only through `open()`. Review windows are deliberately not in the
 * run audience: they show no run, and the review preload has no channel to hear one on.
 */
let reviewWindows: ReviewWindows | null = null;

function requireReviewWindows(): ReviewWindows {
  if (reviewWindows === null) {
    throw new Error('Review is not ready yet: the application has not finished starting.');
  }
  return reviewWindows;
}

/**
 * *Open example review* (DSP-129): the bundled DSP-116 walk from this DSpatch's own
 * clone, through the same `open()` every review goes through. It needs no chat project
 * and makes no provider call. `remember: false` keeps it out of the last-review index,
 * so *Open review* for a project in this clone still opens that project's own last
 * review. Outside a clone it opens nothing and says why.
 */
async function openExampleReview(): Promise<LoopEditorWindowOutcome> {
  // Located on the host, where the clone is read; opened here, where windows are.
  const located = await hostCall(
    'review.exampleDefinition',
    NO_SENDER,
  );
  if (located.kind === 'unavailable') {
    log(`open example review refused: ${located.note}`);
    return { kind: 'failed', note: located.note };
  }
  log(`open example review: ${located.definitionPath}`);
  return requireReviewWindows().open({ repository: null, definitionPath: located.definitionPath, remember: false });
}

/**
 * The windows that hear about loop runs: the chat window and the graph editor.
 *
 * Which run is walking, and every event of it, are the host's (`LoopRunAudience` in
 * `project-host.ts`); its broadcasts arrive addressed to `run-audience` and are sent to
 * each window here. **Events belong to a run, not to a sender** (DSP-28), so every live
 * window in this set hears them and decides for itself whether the event is about what
 * it shows. Review windows are not in it: they show no run.
 */
const runAudience = new Set<Electron.WebContents>();

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
 * How long a shutdown waits beyond the host's own close bound, for its answer to
 * travel back. Used alone when no host has said its bound (it never started).
 */
const HOST_CLOSE_MARGIN_MS = 1_000;

/**
 * How the close went: whether the service and its adapter finished closing before
 * the end, and what was said about it. A record that reads the files after a close
 * that was cut short would present a mid-close state as final (WS-1 review S4).
 */
interface ShutdownOutcome {
  readonly completed: boolean;
  readonly detail: string;
  /**
   * The conversation files as the host read them after its close, when a scripted run
   * asked for that reading; the host is gone by the time this process could read them.
   */
  readonly conversationFilesAfter: readonly unknown[] | null;
}

/**
 * Close the project host, then end the process — and end it even if the close never
 * comes back.
 *
 * Both exit paths used to be `disposeAdapterOnce().finally(end)`, with nothing
 * bounding the wait. The chat service's `dispose()` reaches a third-party agent
 * runtime we do not control, and a promise from it that never settles meant `end` was
 * never called: DSP-62's window that closes onto a process that stays up for ever.
 * `before-quit` made it worse by calling `preventDefault()` first, so the hung
 * disposal had also cancelled the quit that would otherwise have happened.
 *
 * Since DSP-111 the adapters are the project host's, and closing it closes them, the
 * way a quit always did. The wait is kept because the cleanup is real; only its
 * unboundedness is removed: it is the host's own close bound (its adapters' disposal
 * bound, which it states when it starts) plus a margin, and a host that has not
 * answered by then is ended. An application that will not close is a worse failure
 * than one that closes having said its cleanup did not finish, so the log states
 * which of the two happened and, when it did not finish, what may be left behind.
 */
function disposeThenEnd(end: (shutdown: ShutdownOutcome) => void, path: string): void {
  const startedAt = Date.now();
  serviceDisposed = true;
  const boundMs = (host.closeBoundMs() ?? 0) + HOST_CLOSE_MARGIN_MS;
  const observe =
    chatRunMode && (chatRunScenario === 'workspace-switch' || chatRunScenario === 'resume-choice');
  void host
    .shutdown('host.shutdown', [NO_SENDER, { observeConversationFiles: observe }], boundMs)
    .then((answer) => {
      let outcome: ShutdownOutcome;
      if (answer === null && host.state() === 'stopped' && host.failure() !== null) {
        outcome = {
          completed: false,
          detail: `the project host was not running (${host.failure()?.message ?? 'no reason'}); there was nothing to close.`,
          conversationFilesAfter: null,
        };
      } else if (answer === null) {
        outcome = {
          completed: false,
          detail:
            `the project host did not finish closing within ${String(boundMs)} ms, ` +
            'so DSpatch ended it and is closing anyway. A provider agent runtime and its on-disk ' +
            'session store may still be open, and whatever the close itself would have ' +
            'written may be missing. The conversation is saved as the run goes, so what ' +
            'is at risk is the last step of the close rather than the history.',
          conversationFilesAfter: null,
        };
      } else if (isHostCallFailure(answer)) {
        outcome = {
          completed: false,
          detail: `the project host could not close (${answer.message}). Closing anyway.`,
          conversationFilesAfter: null,
        };
      } else {
        const closed = answer as HostShutdownAnswer;
        outcome = {
          completed: closed.completed,
          detail: closed.detail,
          conversationFilesAfter: closed.conversationFiles,
        };
      }
      log(`shutdown (${path}) after ${String(Date.now() - startedAt)} ms: ${outcome.detail}`);
      end(outcome);
    });
}

/** Dispose and exit. `app.quit()` would lose the exit code. */
function exitNow(code: number): void {
  disposeThenEnd((shutdown) => {
    // After the close, which is itself a save: the switch scenario's record says what
    // the close wrote. Other scenarios keep their single record as it was.
    if (
      (chatRunScenario === 'workspace-switch' || chatRunScenario === 'resume-choice') &&
      lastScriptedReport !== undefined
    ) {
      writeChatRunRecord(lastScriptedReport, 'after-close', shutdown);
    }
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
async function captureWindowImage(
  label: string | null = null,
  which: BrowserWindow | null = liveMainWindow(),
): Promise<boolean> {
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
  // The chat window unless another is named: the review scenario photographs its own.
  const window = which;
  if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
    log('screenshot not taken: the window was already gone');
    return false;
  }
  try {
    // `capturePage` copies the last composited frame, and a window the launching
    // terminal is covering composes none: a picture taken 1.5 s after the DOM
    // changed then shows the previous milestone (seen in run 20261024-060000, where
    // "resumed" was byte-identical to "opened" while the record said the panel was
    // gone). Raising the window in z-order, without taking focus, lets Chromium
    // paint again; the short wait is for the occlusion tracker and one frame.
    if (!window.isFocused()) {
      window.moveTop();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 300);
      });
    }
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
async function writeUnsavedDrawing(
  drawing: UnsavedDrawing,
  occasion: UnsavedDrawingOccasion,
): Promise<string | null> {
  // The file is the project's, so the host writes it (DSP-111); the question, the
  // registration and the broadcast stay with the windows.
  let written: LoopGraphSaveOutcome;
  try {
    written = await hostCall('loop.saveGraph', NO_SENDER, { path: drawing.path, text: drawing.text });
  } catch (error) {
    return `DSpatch could not write ${drawing.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (written.kind === 'failed') {
    return `DSpatch could not write ${drawing.path}: ${written.note}`;
  }
  if (written.kind !== 'written') {
    return `DSpatch did not write ${drawing.path}.`;
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
  const failure = await writeUnsavedDrawing(drawing, 'switch');
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
    const picked = await pickers.showOpenDialog({
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
    // A review window has its own View-only menu and no listener for these commands
    // (DSP-126); one that is focused when this menu is pressed passes it to the chat.
    const focusedIsReview =
      focused !== null && reviewWindows !== null && reviewWindows.list().some((entry) => entry.window === focused);
    if (focused !== null && !focusedIsReview && !focused.isDestroyed() && !focused.webContents.isDestroyed()) {
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
            // DSP-149: a folder, then its workspace — created with the folder's name, or
            // reopened. The window asks for the folder so the agent it opens with is the
            // one chosen on screen.
            label: 'Open Project…',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              tell('open-project');
            },
          },
          {
            // DSP-149: every workspace in Recent, with search. The start page shows the
            // most recent ones; this is the whole list, from anywhere.
            label: 'Recent Projects…',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => {
              tell('change-project');
            },
          },
          {
            // DSP-149: another folder in the open workspace. The agent works in it from
            // its next message, in the chat and in loops; the primary does not move.
            label: 'Add Folder to Workspace…',
            click: () => {
              logIfFailed('Add Folder to Workspace', addWorkspaceFolder(null));
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
              logIfFailed('Open Graph File', openGraphFileForEditing());
            },
          },
          {
            // DSP-129. Here as well as beside *Open review*, because that button is on
            // the conversation panel and the example needs no project to be open.
            label: 'Open Example Review',
            click: () => {
              logIfFailed(
                'Open Example Review',
                openExampleReview().then((outcome) => {
                  if (outcome.kind === 'failed') {
                    const parent = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
                    const box = { type: 'info' as const, message: 'The example review cannot be opened', detail: outcome.note };
                    void (parent === null ? dialog.showMessageBox(box) : dialog.showMessageBox(parent, box));
                  }
                }),
              );
            },
          },
          { type: 'separator' },
          {
            label: 'Open Workspace…',
            click: () => {
              logIfFailed('Open Workspace', openWorkspace(null));
            },
          },
          {
            label: 'Save Workspace As…',
            click: () => {
              logIfFailed('Save Workspace As', saveWorkspace(null));
            },
          },
          { type: 'separator' },
          // DSP-149: development and test flows only. A person's start page has no
          // sample project; an unpackaged build keeps one here for trials.
          ...(app.isPackaged
            ? []
            : [
                {
                  label: 'New Sample Project (development)',
                  click: () => {
                    tell('new-sample-project');
                  },
                },
              ]),
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
            // DSP-149: every saved conversation, workspace chats and older stand-alone ones,
            // with export and file information for a chosen one.
            label: 'Conversation History…',
            accelerator: 'CmdOrCtrl+H',
            click: () => {
              tell('show-history');
            },
          },
          { type: 'separator' },
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
    ['change-project', 'Recent Projects…'],
    ['open-project', 'Open Project…'],
    ['show-history', 'Conversation History…'],
    ['new-sample-project', 'New Sample Project (development)'],
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
    runAudience.delete(contents);
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
      runAudience.delete(contents);
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
  // The probe's adapter is an agent connection, so it runs in the project host; this
  // process exits with its code.
  hostCall('probe.runCursor', NO_SENDER).then(
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

/** The same directory, however it was spelled: resolved, and case-blind on Windows. */
function samePathSpelling(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/*
 * The host's half of a scripted run's record (DSP-111): the chat service's evidence,
 * the conversation files on disk and the resume-choice record are read by the project
 * host, which holds them, and kept here for the record. They are read once, when the
 * renderer reports: the after-close write repeats the same readings rather than asking
 * a host that has closed.
 */

/** The resume-choice record as the host keeps it (DSP-121). */
interface ResumeChoiceReading {
  readonly adapter: unknown;
  readonly timeline: unknown;
  readonly checks: readonly { readonly check: string; readonly ok: boolean; readonly evidence: string }[];
}

/** The files as they were when the renderer reported, kept for the after-close record. */
let conversationFilesAtReport: readonly unknown[] | null = null;
/** The host's evidence at report time; the service is gone by the after-close write. */
let mainEvidenceAtReport: Record<string, unknown> | null = null;
/** What was reported, so the after-close write carries the same renderer record. */
let lastScriptedReport: ScriptedRunReport | null | undefined;
/** The resume-choice record and its verdicts, judged on the host when the renderer reported. */
let resumeChoiceAtReport: ResumeChoiceReading | null | undefined;
/** How the presentation adapter was told to answer resumes, as the host read it. */
let presentationResumeMode = 'ok';

/** Read from the host, once, what the record needs from it. A host that cannot answer is recorded as such. */
async function gatherHostEvidence(report: ScriptedRunReport | null): Promise<void> {
  const unanswered = (error: unknown): Record<string, unknown> => ({
    unavailable: `the project host did not answer: ${error instanceof Error ? error.message : String(error)}`,
  });
  const resuming = chatRunScenario === 'resume-choice';
  const switching = chatRunScenario === 'workspace-switch' || resuming;
  if (switching && conversationFilesAtReport === null) {
    conversationFilesAtReport = await host
      .call<readonly unknown[]>('scripted.conversationFiles', NO_SENDER)
      .catch((error: unknown) => [unanswered(error)]);
  }
  if (resumeChoiceAtReport === undefined) {
    resumeChoiceAtReport = resuming
      ? await host
          .call<ResumeChoiceReading>('scripted.resumeChoice', NO_SENDER, report, scriptedClipboard)
          .catch((error: unknown) => ({
            adapter: null,
            timeline: [],
            checks: [{ check: 'the host answered the resume-choice reading', ok: false, evidence: String(error) }],
          }))
      : null;
  }
  mainEvidenceAtReport ??= await host
    .call<Record<string, unknown>>('scripted.mainEvidence', NO_SENDER)
    .catch(unanswered);
}

/**
 * Write the scripted run's record.
 *
 * The renderer's own observations and the main process's are kept apart on
 * purpose: what the DOM showed and what was on disk are different kinds of
 * evidence and must not be presented as one.
 *
 * `workspace-switch` writes it twice: once when the renderer reports, and once more
 * after the close, because the close is itself a save and what it wrote is part of
 * what that scenario is about. The second write carries both readings — unless the
 * close was cut short, in which case the after-close reading is withheld and the
 * record says why, because a mid-close state is not what the close wrote.
 */
function writeChatRunRecord(
  report: ScriptedRunReport | null,
  moment: 'at-report' | 'after-close' = 'at-report',
  shutdown: ShutdownOutcome | null = null,
): void {
  const target = process.env['DSPATCH_CHAT_LOG'];
  if (target === undefined || target.trim() === '') {
    return;
  }
  lastScriptedReport = report;
  const resuming = chatRunScenario === 'resume-choice';
  const switching = chatRunScenario === 'workspace-switch' || resuming;
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
                        : chatRunScenario === 'workspace-switch'
                          ? `DSP-4 WS-1 — saved conversations switched between in one window and read back after a restart (phase ${process.env['DSPATCH_CHAT_SWITCH_PHASE'] ?? 'first'}), over a seeded user-data directory, with no provider call`
                          : chatRunScenario === 'resume-choice'
                            ? `DSP-121 — the refused or failed resume state and the three choices, through the real choice panel (DSPATCH_CHAT_RESUME=${presentationResumeMode}${chatRunHold ? ', hold mode' : ''}), over a seeded user-data directory. SIMULATED: the refusal and the failure are the presentation adapter's own answers on this machine; no provider was asked anything, and nothing here says what any provider would do`
                            : chatRunScenario === 'review-window'
                              ? 'DSP-126 — review opened from the chat as a separate window: one window per review, the chooser or the last review, the chat untouched, identity kept across a project switch, and the position kept across a close inside the save delay, driven through both windows with no provider call'
                              : chatRunScenario === 'review-hold'
                                ? 'DSP-126/127 hand-over — the main chat opened on P1 and left at rest for a person, with Open review going to the seeded walk. SIMULATED: every chat and review answer is a presentation adapter\'s; no provider was asked anything, and nothing was sent by the script'
                                : chatRunScenario === 'review-discussion'
                                ? 'DSP-127 — a discussion about the code under review in the review window: answers on their own questions while the window moves, Stop with and without a run, a review-only send failure, the main chat beside it, drafts across a close and in two windows, and nothing sent on open or navigation. SIMULATED: every answer and every failure is the presentation adapter\'s; no provider was asked anything'
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
    main: mainEvidenceAtReport,
    // DSP-126: what the main process read and did for the review scenario, kept apart
    // from what the chat window's DOM showed.
    ...(chatRunScenario === 'review-window' || chatRunScenario === 'review-discussion'
      ? { reviewWindows: { userDataInUse: app.getPath('userData'), checks: reviewCheckLog } }
      : {}),
    // DSP-121 flow: what *Copy diagnostic info* was asked to copy, recorded here instead
    // of the system clipboard in an unattended run. Empty when nothing was copied.
    copiedInsteadOfClipboard: [...scriptedClipboard],
    ...(switching
      ? {
          // Read by the main process from disk, apart from what the DOM showed.
          userDataInUse: app.getPath('userData'),
          shutdown: moment === 'after-close' ? shutdown : null,
          conversationFiles: {
            atReport: conversationFilesAtReport,
            afterClose:
              moment === 'after-close' && shutdown?.completed === true
                ? shutdown.conversationFilesAfter
                : null,
            afterCloseNote:
              moment !== 'after-close'
                ? 'not yet: this record was written when the renderer reported'
                : shutdown?.completed === true
                  ? null
                  : `not read: the close did not complete (${shutdown?.detail ?? 'no outcome'})`,
          },
        }
      : {}),
    ...(resuming
      ? {
          resumeChoice: {
            simulated:
              'Every refusal and failure in this record is the presentation adapter\'s ' +
              'simulated answer, chosen by DSPATCH_CHAT_RESUME. No provider was asked ' +
              'anything. What is shown is the window\'s behaviour on a refused or failed ' +
              'resume, and nothing about any provider.',
            hold: chatRunHold,
            adapter: resumeChoiceAtReport?.adapter ?? null,
            timeline: resumeChoiceAtReport?.timeline ?? [],
            checks: resumeChoiceAtReport?.checks ?? [],
          },
        }
      : {}),
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

/* ------------------------------------------------------------------------- */
/* DSP-126: the review windows, read and driven for the scripted scenarios     */
/* ------------------------------------------------------------------------- */

/** The review windows for the `pair-review` scenario: listed, read, clicked, closed. */
/**
 * DSP-152: real input in a window, as a person's mouse or keyboard gives it. The element
 * is found and scrolled into view; a click lands at its centre only when that point shows
 * the element itself (or something inside it): a point covered by something else is
 * reported, not clicked through.
 */
async function pressIn(
  window: BrowserWindow,
  contents: Electron.WebContents,
  request: { readonly action: 'press' | 'press-key' | 'type'; readonly selector: string; readonly key?: string; readonly text?: string },
): Promise<EditorWindowCheckAnswer> {
  const place = (await contents.executeJavaScript(
    `(() => {
      const element = document.querySelector(${JSON.stringify(request.selector)});
      // By kind, not by class: an explanation window's elements are made by its walk window's page.
      if (element === null || element.nodeType !== 1 || typeof element.getBoundingClientRect !== 'function') { return null; }
      // Scrolled to only when it is not already in sight, as a person clicks what they see.
      const seen = (() => { const b = element.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return b.width > 0 && hit !== null && element.contains(hit); })();
      if (!seen) { element.scrollIntoView({ block: 'center' }); }
      ${request.action === 'press-key' || request.action === 'type' ? 'element.focus();' : ''}
      const box = element.getBoundingClientRect();
      const x = Math.round(box.left + box.width / 2);
      const y = Math.round(box.top + box.height / 2);
      const hit = document.elementFromPoint(x, y);
      const covered = hit === null || element.contains(hit) ? null : (hit.tagName.toLowerCase() + (hit.getAttribute('data-ev') ? '[data-ev=' + hit.getAttribute('data-ev') + ']' : '') + (typeof hit.className === 'string' && hit.className !== '' ? '.' + hit.className.split(' ').join('.') : ''));
      return { x, y, disabled: (element.tagName === 'BUTTON' || element.tagName === 'SELECT') && element.disabled === true, focused: document.activeElement === element, covered };
    })()`,
  )) as { x: number; y: number; disabled: boolean; focused: boolean; covered: string | null } | null;
  if (place === null) {
    return { ok: false, detail: `nothing matches ${request.selector}` };
  }
  if (place.disabled) {
    return { ok: false, detail: 'disabled' };
  }
  if (request.action === 'press' && place.covered !== null) {
    return { ok: false, detail: `covered by ${place.covered}` };
  }
  window.show();
  window.focus();
  contents.focus();
  if (request.action === 'press') {
    contents.sendInputEvent({ type: 'mouseDown', x: place.x, y: place.y, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x: place.x, y: place.y, button: 'left', clickCount: 1 });
  } else if (request.action === 'type') {
    // As a keyboard gives it: the key down, the character, the key up, with Shift held for a
    // capital or a shifted sign, so handlers of key events see what a person's typing makes.
    for (const character of request.text ?? '') {
      const shifted = character !== character.toLowerCase() || '?!:"()&%'.includes(character);
      const modifiers: ('shift')[] = shifted ? ['shift'] : [];
      const key = character === ' ' ? 'Space' : character;
      contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
      contents.sendInputEvent({ type: 'char', keyCode: character, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
    }
  } else {
    contents.sendInputEvent({ type: 'keyDown', keyCode: request.key ?? '' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: request.key ?? '' });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { ok: true, detail: place };
}

/**
 * DSP-152: where a character of an element's text is drawn, for real mouse input: the left
 * or right half of the character's box, in the window's coordinates. The element is
 * scrolled into view first.
 */
async function textPointIn(contents: Electron.WebContents, point: TextPoint, half: 'left' | 'right'): Promise<{ x: number; y: number } | null> {
  return (await contents.executeJavaScript(
    `(() => {
      const element = document.querySelector(${JSON.stringify(point.selector)});
      if (element === null || element.nodeType !== 1) { return null; }
      const find = () => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let at = 0;
        const wanted = ${String(point.offset)};
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const length = (node.textContent || '').length;
          if (wanted < at + length) {
            const range = document.createRange();
            range.setStart(node, wanted - at);
            range.setEnd(node, wanted - at + 1);
            const box = range.getBoundingClientRect();
            const x = ${half === 'left' ? 'box.left + Math.max(1, box.width * 0.25)' : 'box.right - Math.max(1, box.width * 0.25)'};
            return { x: Math.round(x), y: Math.round(box.top + box.height / 2) };
          }
          at += length;
        }
        return null;
      };
      // Scrolled to only when the character is not already in sight.
      const first = find();
      const hit = first === null ? null : document.elementFromPoint(first.x, first.y);
      if (first !== null && hit !== null && element.contains(hit)) { return first; }
      element.scrollIntoView({ block: 'center' });
      return find();
    })()`,
  )) as { x: number; y: number } | null;
}

async function pointerIn(window: BrowserWindow, contents: Electron.WebContents, request: PairWindowCheckRequest): Promise<EditorWindowCheckAnswer> {
  window.show();
  window.focus();
  contents.focus();
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  if (request.action === 'drag') {
    const start = await textPointIn(contents, request.from, 'left');
    // The end is found after the start was scrolled to, so both are in the same frame.
    const end = await textPointIn(contents, { selector: request.to.selector, offset: Math.max(0, request.to.offset - 1) }, 'right');
    if (start === null || end === null) {
      return { ok: false, detail: `no character at ${JSON.stringify(start === null ? request.from : request.to)}` };
    }
    contents.sendInputEvent({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
      const x = Math.round(start.x + ((end.x - start.x) * step) / 8);
      const y = Math.round(start.y + ((end.y - start.y) * step) / 8);
      contents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftbuttondown'] });
      await pause(20);
    }
    contents.sendInputEvent({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await pause(150);
    return { ok: true, detail: { start, end, selected: (await contents.executeJavaScript('String(window.getSelection())')) as string } };
  }
  if (request.action === 'right-click') {
    const at = await textPointIn(contents, request.at, 'left');
    if (at === null) {
      return { ok: false, detail: `no character at ${JSON.stringify(request.at)}` };
    }
    // What reached the page, counted, so a scenario can tell a missing event from a missed handler.
    await contents.executeJavaScript(
      `(() => { const seen = { mousedown: 0, mouseup: 0, contextmenu: 0 }; window.__dspatchRightClick = seen;
        for (const name of Object.keys(seen)) { window.addEventListener(name, (event) => { if (event.button === 2 || name === 'contextmenu') { seen[name] += 1; } }, { capture: true }); } })()`,
    );
    // As Windows delivers a right click: the button down and up, then the context-menu
    // request (WM_CONTEXTMENU), which is what makes the page's `contextmenu` event.
    contents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'right', clickCount: 1 });
    await pause(40);
    contents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'right', clickCount: 1 });
    contents.sendInputEvent({ type: 'contextMenu', x: at.x, y: at.y, button: 'right', clickCount: 1 });
    await pause(150);
    return { ok: true, detail: { at, seen: (await contents.executeJavaScript('window.__dspatchRightClick')) as unknown } };
  }
  if (request.action === 'pointer-drag' || request.action === 'wheel') {
    const centre = (await contents.executeJavaScript(
      `(() => {
        const element = document.querySelector(${JSON.stringify(request.selector)});
        if (element === null || element.nodeType !== 1) { return null; }
        const box = element.getBoundingClientRect();
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + Math.min(box.height / 2, 200)) };
      })()`,
    )) as { x: number; y: number } | null;
    if (centre === null) {
      return { ok: false, detail: `nothing matches ${request.selector}` };
    }
    if (request.action === 'wheel') {
      contents.sendInputEvent({ type: 'mouseMove', x: centre.x, y: centre.y });
      // Chromium's wheel deltas point the other way: a negative delta scrolls the page down.
      contents.sendInputEvent({ type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY: -request.deltaY, canScroll: true });
      await pause(300);
      return { ok: true, detail: centre };
    }
    contents.sendInputEvent({ type: 'mouseMove', x: centre.x, y: centre.y });
    contents.sendInputEvent({ type: 'mouseDown', x: centre.x, y: centre.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 10; step += 1) {
      contents.sendInputEvent({ type: 'mouseMove', x: Math.round(centre.x + (request.dx * step) / 10), y: centre.y, button: 'left', modifiers: ['leftbuttondown'] });
      await pause(20);
    }
    contents.sendInputEvent({ type: 'mouseUp', x: centre.x + request.dx, y: centre.y, button: 'left', clickCount: 1 });
    await pause(200);
    return { ok: true, detail: { from: centre, dx: request.dx } };
  }
  if (request.action === 'chord') {
    contents.sendInputEvent({ type: 'keyDown', keyCode: request.key, modifiers: [...request.modifiers] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: request.key, modifiers: [...request.modifiers] });
    await pause(150);
    return { ok: true, detail: 'pressed' };
  }
  return { ok: false, detail: 'not a pointer action' };
}

/**
 * The walk window and the review's panel, as one surface for the scripted scenarios (30
 * October 2026). Step and Discussion moved from the walk window into the review's panel; a
 * step of an older scenario that names an element only the panel has is done in the panel,
 * with the same real input, and the panel is first shown by the walk's own Discussion button
 * when it is not open, as a person would open it. A reading of the walk window is completed
 * from the panel's where the walk window has nothing of its own.
 */
async function pairWindowCheck(request: PairWindowCheckRequest): Promise<EditorWindowCheckAnswer> {
  const windows = reviewWindows;
  const id = 'id' in request ? request.id : 0;
  const walk = windows === null || id === 0 ? undefined : windows.list().find((candidate) => candidate.contents.id === id && candidate.view === 'walk');
  if (windows === null || walk === undefined || walk.pairKey === null) {
    return pairWindowCheckIn(request);
  }
  const pairKey = walk.pairKey;
  if (request.action === 'read') {
    const own = await pairWindowCheckIn(request);
    const panel = windows.panelFor(pairKey);
    if (!own.ok || panel === null) {
      return own;
    }
    const theirs = await pairWindowCheckIn({ action: 'read', id: panel.contents.id });
    if (!theirs.ok) {
      return own;
    }
    const empty = (value: unknown): boolean => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    const fill = (mine: Record<string, unknown>, other: Record<string, unknown>): Record<string, unknown> => {
      const merged: Record<string, unknown> = { ...mine };
      for (const [key, value] of Object.entries(other)) {
        if (empty(merged[key]) && !empty(value)) {
          merged[key] = value;
        }
      }
      return merged;
    };
    const mine = (own.detail ?? {}) as Record<string, unknown>;
    const other = (theirs.detail ?? {}) as Record<string, unknown>;
    const merged = fill(mine, other);
    // Readings grouped under a name (the walk view, the points worth checking) are filled one level down.
    const isGroup = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    for (const key of Object.keys(mine)) {
      if (isGroup(mine[key]) && isGroup(other[key])) {
        merged[key] = fill(mine[key], other[key]);
      }
    }
    // The quote above the question is the panel's: read there as `quoteChipText`.
    const view = merged['walkView'];
    if (isGroup(view) && empty(view['quoteChip']) && !empty(other['quoteChipText'])) {
      merged['walkView'] = { ...view, quoteChip: other['quoteChipText'] };
    }
    merged['text'] = `${String(mine['text'] ?? '')} ${String(other['text'] ?? '')}`;
    merged['visibleText'] = `${String(mine['visibleText'] ?? '')} ${String(other['visibleText'] ?? '')}`;
    merged['rightWidth'] = mine['rightWidth'] === 0 ? other['rightWidth'] : mine['rightWidth'];
    if (other['focusedEv'] === 'discussion-composer') {
      merged['focusedEv'] = other['focusedEv'];
    }
    return { ok: true, detail: merged };
  }
  const selector =
    'selector' in request ? request.selector : request.action === 'drag' ? request.from.selector : request.action === 'right-click' ? request.at.selector : null;
  if (selector === null) {
    return pairWindowCheckIn(request);
  }
  const here = (await walk.contents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => true)) as boolean;
  if (here) {
    return pairWindowCheckIn(request);
  }
  let panel = windows.panelFor(pairKey);
  if (panel === null) {
    await pairWindowCheckIn({ action: 'press', id, selector: '[data-ev="walk-discussion"]' });
    for (let wait = 0; wait < 40 && panel === null; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      panel = windows.panelFor(pairKey);
    }
  }
  if (panel === null) {
    return pairWindowCheckIn(request);
  }
  for (let wait = 0; wait < 40; wait += 1) {
    const there = (await panel.contents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)) as boolean;
    if (there) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return pairWindowCheckIn({ ...request, id: panel.contents.id } as PairWindowCheckRequest);
}

async function pairWindowCheckIn(request: PairWindowCheckRequest): Promise<EditorWindowCheckAnswer> {
  // DSP-152: id 0 is the main window, for real input from where a person starts.
  if (request.action === 'browser-text' || request.action === 'main-text') {
    const window = request.action === 'main-text' ? liveMainWindow() : browseWindow;
    return { ok: true, detail: window === null || window.isDestroyed() ? null : await window.webContents.executeJavaScript('document.body.innerText') };
  }
  if ((request.action === 'press' || request.action === 'type') && request.id === -1) {
    return browseWindow === null ? { ok: false, detail: 'no chooser' } : pressIn(browseWindow, browseWindow.webContents, request);
  }
  if ((request.action === 'press' || request.action === 'press-key' || request.action === 'type') && request.id === 0) {
    const main = liveMainWindow();
    return main === null ? { ok: false, detail: 'no main window' } : pressIn(main, main.webContents, request);
  }
  const windows = requireReviewWindows();
  if (request.action === 'trial') {
    const control = process.env['DSPATCH_TRIAL_CONTROL'];
    if (control === undefined) {
      return { ok: false, detail: 'not a remote trial' };
    }
    await fetch(`${control}${request.path}`);
    return { ok: true, detail: request.path };
  }
  if (request.action === 'host-link') {
    return { ok: true, detail: hostLink };
  }
  if (request.action === 'windows') {
    return {
      ok: true,
      detail: windows.list().map((entry) => ({
        id: entry.contents.id,
        view: entry.view,
        pairKey: entry.pairKey,
        title: entry.window.getTitle(),
        focused: windows.shownWindowOf(entry).isFocused(),
        // 30 October 2026: the review's panel, where it is and whether it is shown.
        panel: windows.panelReading(entry),
      })),
    };
  }
  const entry =
    windows.list().find((candidate) => candidate.contents.id === request.id);
  if (entry === undefined || entry.contents.isDestroyed()) {
    return { ok: false, detail: `no review window ${String(request.id)}` };
  }
  if (request.action === 'close') {
    // The review's panel is hidden by closing its window, not closed (30 October 2026).
    if ('view' in entry && entry.view === 'panel') {
      entry.window.close();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { ok: true, detail: entry.window.isDestroyed() ? 'closed' : 'hidden' };
    }
    const closed = new Promise<void>((resolve) => {
      entry.window.once('closed', () => {
        resolve();
      });
    });
    entry.window.close();
    await closed;
    return { ok: true, detail: 'closed' };
  }
  // The review's panel is seen in the window it is docked in, or its own (30 October 2026).
  const shown = 'window' in entry && windows.list().includes(entry as never) ? windows.shownWindowOf(entry as never) : entry.window;
  if (request.action === 'focus') {
    shown.show();
    shown.focus();
    return { ok: true, detail: 'focused' };
  }
  if (request.action === 'resize') {
    shown.setContentSize(Math.round(request.width), Math.round(request.height));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const [width, height] = shown.getContentSize();
    return { ok: true, detail: { width, height } };
  }
  if (request.action === 'press' || request.action === 'press-key' || request.action === 'type') {
    return pressIn(shown, entry.contents, request);
  }
  if (request.action === 'drag' || request.action === 'right-click' || request.action === 'chord' || request.action === 'pointer-drag' || request.action === 'wheel') {
    return pointerIn(shown, entry.contents, request);
  }
  if (request.action === 'screen') {
    shown.show();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const [width, height] = shown.getSize();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: width ?? 1400, height: height ?? 900 } });
    const source = sources.find((candidate) => candidate.id === shown.getMediaSourceId());
    const base = process.env['DSPATCH_CHAT_SHOT'];
    if (source === undefined || base === undefined) {
      return { ok: false, detail: 'the window is not among the desktop sources' };
    }
    const file = `${base.replace(/\.png$/i, '')}-${request.label}.png`;
    fs.writeFileSync(file, source.thumbnail.toPNG());
    return { ok: true, detail: file };
  }
  if (request.action === 'capture') {
    // Two frames painted first: a capture taken at once can return the frame before the
    // last change.
    entry.contents.invalidate();
    // A hidden or covered window paints no frames, so the wait is bounded.
    await entry.contents.executeJavaScript(
      'new Promise((resolve) => { setTimeout(() => resolve(false), 400); requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))); })',
    );
    // The first capture can still hand back the previous frame; the second, a moment
    // later, is the one kept.
    // A view shown a moment ago may have no frame yet: Electron refuses the capture, so it is retried.
    const captured = async (tries: number): Promise<Electron.NativeImage> => {
      try {
        return await entry.contents.capturePage();
      } catch (error) {
        if (tries <= 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        return captured(tries - 1);
      }
    };
    await captured(5);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await captured(5);
    const shot = process.env['DSPATCH_CHAT_SHOT'];
    if (shot === undefined || shot === '') {
      return { ok: false, detail: 'no DSPATCH_CHAT_SHOT' };
    }
    const file = shot.replace(/[.]png$/i, `-${request.label}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, detail: file };
  }
  const shift = 'shift' in request && request.shift === true ? 'true' : 'false';
  const selector = 'selector' in request ? JSON.stringify(request.selector) : 'null';
  let script: string;
  if (request.action === 'read') {
    script = READ_PAIR_WINDOW;
  } else if (request.action === 'go-to-step') {
    script = `(() => window.__dspatchReviewCheck ? window.__dspatchReviewCheck.goToStep(${JSON.stringify(request.stepId)}) : false)()`;
  } else if (request.action === 'select-text') {
    script = `(() => {
      const element = document.querySelector(${selector});
      if (!(element instanceof HTMLElement)) { return ''; }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null && (node.textContent || '').trim() === '') { node = walker.nextNode(); }
      if (node === null) { return ''; }
      const text = node.textContent || '';
      const start = text.length - text.trimStart().length;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(text.length, start + ${String(request.length)}));
      const chosen = window.getSelection();
      chosen.removeAllRanges();
      chosen.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return chosen.toString();
    })()`;
  } else if (request.action === 'select') {
    script = `(() => {
      const element = document.querySelector(${selector});
      if (!(element instanceof HTMLSelectElement)) { return false; }
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(element, ${JSON.stringify(request.value)});
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;
  } else if (request.action === 'key') {
    script = `(() => {
      const element = document.querySelector(${selector});
      if (!(element instanceof HTMLElement)) { return false; }
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(request.key)}, shiftKey: ${shift}, bubbles: true }));
      return document.activeElement === element;
    })()`;
  } else {
    script = `(() => {
      const element = document.querySelector(${selector});
      if (!(element instanceof HTMLElement)) { return false; }
      if (element instanceof HTMLButtonElement && element.disabled) { return 'disabled'; }
      element.scrollIntoView({ block: 'center' });
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1, shiftKey: ${shift} }));
      return true;
    })()`;
  }
  try {
    return { ok: true, detail: (await entry.contents.executeJavaScript(script)) as unknown };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

/** A review window as the `pair-review` scenario reads it: the pair view, the walk, the text. */
const READ_PAIR_WINDOW = String.raw`(() => ({
          pair: window.__dspatchPairCheck ? window.__dspatchPairCheck.read() : null,
          walk: window.__dspatchReviewCheck ? window.__dspatchReviewCheck.read() : null,
          // 30 October 2026: the discussion's messages, with what each answer rests on.
          discussion: window.__dspatchDiscussionCheck ? window.__dspatchDiscussionCheck.read() : null,
          focusedEv: document.activeElement ? document.activeElement.getAttribute('data-ev') : null,
          // The review's panel (30 October 2026): the quote above the question and the activity line, wherever the panel is.
          quoteChipText: (() => { const node = document.querySelector('[data-ev="discussion-quote"]'); return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : ''; })(),
          activityLines: [...document.querySelectorAll('[data-ev="discussion-activity"], [data-ev="deepening-activity"]')].map((node) => (node.textContent || '').trim()),
          decisions: [...document.querySelectorAll('.rv-decision')].map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim()),
          showInDiff: document.querySelector('[data-ev="walk-show-in-diff"]') !== null,
          // 30 October 2026: what each running agent job says it is doing, under its spinner.
          activities: [...document.querySelectorAll('[data-ev^="agent-job-"][data-ev$="-activity"]')].map((node) => (node.textContent || '').trim()),
          deepenings: [...document.querySelectorAll('[data-ev="step-deepening"]')].map((node) => ({ state: node.getAttribute('data-state'), text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) })),
          // DSP-152: a step's code questions: state, the answer as drawn, its references and Details.
          investigations: [...document.querySelectorAll('[data-ev="step-investigation"]')].map((node) => ({
            state: node.getAttribute('data-state'),
            open: node.open,
            text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
            references: [...node.querySelectorAll('[data-ev="step-investigation-ref"]')].map((ref) => ((ref.parentElement || ref).textContent || '').replace(/\s+/g, ' ').trim()),
            details: ((node.querySelector('.rv-agent-detail') || { textContent: '' }).textContent || '').replace(/\s+/g, ' ').trim(),
          })),
          walkJob: (document.querySelector('.rv-walk-delegate [data-state]') || { getAttribute: () => null }).getAttribute('data-state'),
          walkJobText: (document.querySelector('.rv-walk-delegate') || { textContent: '' }).textContent,
          // DSP-152: what each open agent picker shows, as the person sees it.
          pickers: [...document.querySelectorAll('.rv-agent-picker')].map((node) => {
            const provider = node.querySelector('select[data-ev$="-provider"]');
            const model = node.querySelector('[data-ev$="-model"]');
            const start = node.querySelector('button[data-ev$="-start"]');
            const reading = node.querySelector('[data-ev$="-model-reading"]');
            return {
              ev: node.getAttribute('data-ev'),
              provider: provider ? provider.value : null,
              model: model ? model.value : null,
              modelReading: reading ? reading.textContent : null,
              options: model && model.tagName === 'SELECT' ? [...model.options].map((option) => option.value) : null,
              startDisabled: start ? start.disabled : null,
              note: (node.querySelector('[data-ev$="-note"]') || { textContent: '' }).textContent,
              text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
            };
          }),
          jobDetails: [...document.querySelectorAll('.rv-agent-detail')].map((node) => ({ open: node.open, text: (node.textContent || '').replace(/\s+/g, ' ').trim() })),
          // Niclas's trial feedback (29 October 2026): the walk window's left column, list and code panes.
          walkView: (() => {
            // The walk window, or the review's panel (its step and discussion, 30 October 2026).
            const left = document.querySelector('.rv-left') || document.querySelector('.rv-panel-only .rv-right');
            if (!left) { return null; }
            const text = (node) => ((node && (node.innerText || node.textContent)) || '').replace(/\s+/g, ' ').trim();
            const activePane = document.querySelector('.rv-pane-active .rv-pane-lines');
            return {
              leftWidth: left.classList.contains('rv-left') ? Math.round(left.getBoundingClientRect().width) : 0,
              leftOverflowX: left.classList.contains('rv-left') && left.scrollWidth > left.clientWidth + 1,
              heading: text(document.querySelector('[data-ev="walks-heading"]')),
              items: [...document.querySelectorAll('.rv-walk')].map((walk) => ({
                id: text(walk.querySelector('.rv-walk-meta .rv-step-id')),
                title: text(walk.querySelector('.rv-walk-name')),
                reading: walk.querySelector('.rv-kind-tag') !== null,
                purpose: text(walk.querySelector('.rv-walk-purpose')),
                purposeHeight: Math.round((walk.querySelector('.rv-walk-purpose') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
                open: (walk.querySelector('.rv-walk-head') || { getAttribute: () => null }).getAttribute('aria-expanded') === 'true',
                steps: walk.querySelectorAll('.rv-step').length,
              })),
              overview: text(document.querySelector('[data-ev="walk-overview"]')),
              overviewMore: (document.querySelector('[data-ev="walk-overview-more"]') || { textContent: null }).textContent,
              attention: text(document.querySelector('[data-ev="walk-attention"]')),
              treeOpen: document.querySelector('.rv-tree') !== null,
              wrapChecked: (document.querySelector('[data-ev="walk-wrap"]') || { checked: null }).checked,
              definitions: [...document.querySelectorAll('[data-ev="walk-definition"] option')].map((option) => option.textContent),
              activePane: activePane === null ? null : {
                wrap: activePane.getAttribute('data-wrap'),
                scrollLeft: Math.round(activePane.scrollLeft),
                scrollWidth: activePane.scrollWidth,
                clientWidth: activePane.clientWidth,
                path: (activePane.closest('.rv-pane').querySelector('.rv-path') || { title: '' }).title,
                scrollTop: activePane.scrollTop,
                focusRows: [...activePane.querySelectorAll('[data-focus="1"]')].map((row) => ({ line: row.getAttribute('data-line'), height: Math.round(row.getBoundingClientRect().height), numbers: text(row.querySelector('.rv-ln')) })),
              },
              stepTitle: text(document.querySelector('.rv-step-on .rv-step-title')),
              // 30 October 2026: the left column's order, the points worth checking, an open
              // point, and the answers as drawn (with their links and tables).
              leftOrder: [...document.querySelectorAll('.rv-walks-tab [data-ev="walk-about"], .rv-walks-tab [data-ev="walks-heading"], .rv-walks-tab [data-ev="walk-attention"], .rv-walks-tab [data-ev="walk-files"]')].map((node) => node.getAttribute('data-ev')),
              checks: [...document.querySelectorAll('[data-ev^="check-C"]')].map((node) => ({ id: node.getAttribute('data-ev').slice(6), text: text(node), height: Math.round(node.getBoundingClientRect().height) })),
              checkPanel: (() => {
                const panel = document.querySelector('[data-ev="check-panel"]');
                return panel === null ? null : {
                  id: panel.getAttribute('data-check'),
                  title: text(panel.querySelector('.rv-check-panel-title')),
                  reasoning: text(panel.querySelector('[data-ev="check-reasoning"]')),
                  places: panel.querySelectorAll('[data-ev="check-place"]').length,
                  back: text(panel.querySelector('[data-ev="check-back"]')),
                  exchanges: [...panel.querySelectorAll('[data-ev="check-exchange"]')].map((node) => ({ state: node.getAttribute('data-state'), text: text(node).slice(0, 400) })),
                };
              })(),
              answers: [...document.querySelectorAll('[data-ev="discussion-answer-body"]')].filter((node) => node.offsetParent !== null).map((node) => ({
                text: text(node).slice(0, 600),
                details: node.querySelector('[data-ev="answer-details"]') !== null,
                more: text(node.querySelector('[data-ev="answer-show-more"]')),
                simpler: node.querySelector('[data-ev="answer-simpler"]') !== null,
                refsOpen: (() => { const refs = node.querySelector('[data-ev="answer-refs"]'); return refs !== null && !refs.hidden; })(),
                refsToggle: node.querySelector('[data-ev="answer-show-code"]') !== null,
                refs: [...node.querySelectorAll('[data-ev="answer-ref"]')].map((ref) => ref.getAttribute('data-ref')),
                tables: [...node.querySelectorAll('table.markdown__table')].map((table) => {
                  const box = table.closest('.markdown__table-box');
                  const column = node.closest('.rv-right') || node;
                  return { rows: table.querySelectorAll('tr').length, cells: table.querySelectorAll('td').length, boxWidth: Math.round(box.getBoundingClientRect().width), columnWidth: Math.round(column.getBoundingClientRect().width), boxOverflow: box.scrollWidth > box.clientWidth + 1, rawPipes: (node.textContent || '').includes('| ---') };
                }),
              })),
              away: (document.querySelector('.rv-code-pane .rv-path') || { title: '' }).title,
              // What is selected to ask about: the action beside it, and the quote above the field.
              quoteOffer: [...document.querySelectorAll('[data-ev="walk-quote-offer"] button')].map((node) => node.getAttribute('data-ev')),
              quoteChip: text(document.querySelector('[data-ev="discussion-quote"]')),
              windowSelection: (window.getSelection() || { toString: () => '' }).toString(),
              // The kept selection's quiet mark in the code: how many pieces, and their text.
              quoteMark: (() => {
                const mark = CSS.highlights && CSS.highlights.get('rv-quote');
                return mark ? [...mark].map((range) => range.toString()) : [];
              })(),
              docked: document.querySelector('.rv-right-dock .rv-right') !== null,
              // 30 October 2026: technical blocks no longer shown.
              noise: (() => {
                const docs = [document];
                const selector = '.rv-discussion-subject, [data-ev="discussion-subject"], .rv-discussion-context, .rv-discussion-agent-policy, [data-ev^="discussion-go-"], [data-ev="discussion-agent-policy"]';
                const words = ['What it may use here', 'Go to point', "DSpatch's instruction", 'Exact text sent'];
                return docs.flatMap((doc) => [...doc.querySelectorAll(selector)].map((node) => node.className || node.getAttribute('data-ev')).concat(words.filter((word) => (doc.body.innerText || '').includes(word))));
              })(),
              awayBar: text(document.querySelector('[data-ev="away-bar"]')),
              // 30 October 2026: where each code pane of the walk is and how wide, the dividers,
              // and the first line read in the active pane, to see what wrapping lines changes.
              paneBoxes: [...document.querySelectorAll('.rv-pane')].map((pane) => {
                const box = pane.getBoundingClientRect();
                return Math.round(box.left) + ':' + Math.round(box.width);
              }),
              dividers: [...document.querySelectorAll('.rv-divider, [data-ev="walk-divider"]')].map((node) => Math.round(node.getBoundingClientRect().left)),
              activeFirst: (() => {
                const lines = document.querySelector('.rv-pane-active .rv-pane-lines');
                if (lines === null) {
                  return null;
                }
                const top = lines.getBoundingClientRect().top;
                const row = [...lines.querySelectorAll('[data-row]')].find((entry) => entry.getBoundingClientRect().bottom > top + 1);
                return row ? { row: Number(row.getAttribute('data-row')), offset: Math.round(row.getBoundingClientRect().top - top), wrap: lines.getAttribute('data-wrap'), scrollWidth: lines.scrollWidth, clientWidth: lines.clientWidth } : null;
              })(),
              // What is no longer there (30 October 2026): the place's own heading, the whole-walk
              // highlight, and Details.
              removed: {
                placeHeading: document.querySelector('.rv-nav-label') !== null,
                highlightWalk: /Highlight entire walk/.test(document.body.innerText || ''),
                details: [...document.querySelectorAll('.rv-header button')].some((button) => /Details/.test(button.textContent || '')),
              },
              // 30 October 2026: an opened location's pane, and where the walk's own panes are scrolled.
              awayPane: (() => {
                const lines = document.querySelector('.rv-code > .rv-code-pane .rv-lines');
                if (lines === null) {
                  return null;
                }
                const top = lines.getBoundingClientRect().top;
                const first = [...lines.querySelectorAll('[data-sel-line]')].find((row) => row.getBoundingClientRect().bottom > top + 1);
                return {
                  scrollTop: Math.round(lines.scrollTop),
                  scrollHeight: lines.scrollHeight,
                  clientHeight: lines.clientHeight,
                  firstLine: first ? first.getAttribute('data-sel-side') + ':' + first.getAttribute('data-sel-line') : '',
                  marked: [...lines.querySelectorAll('.rv-ref-mark')].map((row) => Number(row.getAttribute('data-sel-line'))),
                  rows: lines.querySelectorAll('[data-sel-line]').length,
                  scope: text(document.querySelector('.rv-code > .rv-code-pane .rv-code-bar .rv-seg:last-of-type .rv-on')),
                };
              })(),
              stageScroll: [...document.querySelectorAll('.rv-walk-stage, .rv-walk-stage *')].filter((node) => node.scrollTop > 0).map((node) => (node.className || node.tagName) + '@' + Math.round(node.scrollTop)),
              discussionActivity: (() => {
                const docs = [document];
                return docs.flatMap((doc) => [...doc.querySelectorAll('[data-ev="discussion-activity"], [data-ev="deepening-activity"]')].map((node) => text(node)));
              })(),
              codeWidth: Math.round((document.querySelector('.rv-code') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
              paneRows: [...document.querySelectorAll('.rv-pane-active [data-sel-line]')].map((node) => node.getAttribute('data-sel-side') + ':' + node.getAttribute('data-sel-path') + ':' + node.getAttribute('data-sel-line')),
              position: window.__dspatchReviewCheck ? window.__dspatchReviewCheck.read().position : null,
              chooseOffered: [...document.querySelectorAll('button')].some((button) => /Open another review/.test(button.textContent || '')),
            };
          })(),
          // The decided column widths as drawn: the diff's first changed row, cell by cell, and
          // each walk pane's gutter beside its code.
          columns: (() => {
            const width = (node) => (node === null ? 0 : Math.round(node.getBoundingClientRect().width));
            const table = document.querySelector('.rv-pair-diff table.rv-pair-table');
            const row = table === null ? null : table.querySelector('tr.rv-pair-row-change');
            return {
              diff: table === null ? null : {
                layout: table.classList.contains('rv-pair-table-split') ? 'split' : 'unified',
                width: width(table),
                startsWithFold: (table.querySelector('tbody > tr') || { classList: { contains: () => false } }).classList.contains('rv-pair-gap'),
                cells: row === null ? [] : [...row.children].map((cell) => ({ kind: cell.className.split(' ')[0], width: width(cell) })),
              },
              walk: [...document.querySelectorAll('.rv-pane-lines')].map((pane) => {
                const line = pane.querySelector('.rv-row');
                const rows = pane.querySelector('.rv-rows');
                return {
                  digits: rows === null ? 0 : Number(getComputedStyle(rows).getPropertyValue('--rv-digits')),
                  pane: width(pane),
                  gutter: width(line && line.querySelector('.rv-gutter')),
                  numbers: width(line && line.querySelector('.rv-ln')),
                  mark: width(line && line.querySelector('.rv-marker')),
                  code: width(line && line.querySelector('.rv-text')),
                };
              }),
            };
          })(),
          rightWidth: (document.querySelector('.rv-right') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
          codeWidth: (document.querySelector('.rv-code') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          text: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 30000),
          // DSP-152: the text as drawn, without what a closed Details holds.
          visibleText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 30000),
        }))()`;

/** Read the loop editor's window through its check hook, or close it like its X does. */
async function editorWindowCheck(request: EditorWindowCheckRequest): Promise<EditorWindowCheckAnswer> {
  const window = editorWindow;
  if (window === null || window.isDestroyed()) {
    return { ok: request.action === 'close', detail: 'no loop editor window is open' };
  }
  if (request.action === 'close') {
    const closed = new Promise<void>((resolve) => {
      window.once('closed', () => {
        resolve();
      });
    });
    window.close();
    await closed;
    return { ok: true, detail: 'closed' };
  }
  if (request.action === 'click') {
    try {
      const clicked = (await window.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${JSON.stringify(request.selector)});
          if (!(element instanceof HTMLElement)) { return false; }
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
          return true;
        })()`,
      )) as unknown;
      return { ok: clicked === true, detail: clicked };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }
  try {
    const detail = (await window.webContents.executeJavaScript(
      `(() => {
        const hook = window.__dspatchEditorCheck;
        return {
          hooked: hook !== undefined,
          drawn: [...document.querySelectorAll('svg g.node')].map((node) => node.getAttribute('data-node-id') ?? ''),
          liveness: hook && hook.readLiveness ? hook.readLiveness() : null,
        };
      })()`,
    )) as unknown;
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

/** Every request the review scenarios made of the main process, and its answer. */
const reviewCheckLog: unknown[] = [];

/** Run a script in a review window and give back what it returned, or why not. */
async function inReviewWindow(webContentsId: number, script: string): Promise<{ ok: boolean; value: unknown }> {
  const entry = requireReviewWindows()
    .list()
    .find((candidate) => candidate.contents.id === webContentsId);
  if (entry === undefined || entry.contents.isDestroyed()) {
    return { ok: false, value: `no review window with webContents id ${String(webContentsId)}` };
  }
  try {
    return { ok: true, value: (await entry.contents.executeJavaScript(script)) as unknown };
  } catch (error) {
    return { ok: false, value: String(error) };
  }
}

/** What the main process can say about the review windows, the chat and the loops right now. */
async function reviewScenarioReading(): Promise<Record<string, unknown>> {
  const windows = requireReviewWindows();
  const views: unknown[] = [];
  for (const reading of await windows.readings()) {
    const view = await inReviewWindow(
      reading.webContentsId,
      'window.__dspatchReviewCheck ? window.__dspatchReviewCheck.read() : null',
    );
    const discussion = await inReviewWindow(
      reading.webContentsId,
      'window.__dspatchDiscussionCheck ? window.__dspatchDiscussionCheck.read() : null',
    );
    views.push({ ...reading, view: view.value, discussion: discussion.value });
  }
  // DSP-127 and DSP-111: the discussion records, the run files and what each presentation
  // adapter was sent are read by the host, which holds them; the windows are read here.
  const hostReading = await hostCall('scripted.reviewReading', NO_SENDER);
  const focused = BrowserWindow.getFocusedWindow();
  return {
    reviewWindows: views,
    chat: {
      ...hostReading.chat,
      windowOpen: liveMainWindow() !== null,
    },
    focusedWindow:
      focused === null
        ? null
        : focused === liveMainWindow()
          ? 'chat'
          : windows.list().some((entry) => entry.window === focused)
            ? 'review'
            : 'other',
    allWindows: BrowserWindow.getAllWindows().length,
    loops: hostReading.loops,
    recentReviews: await windows.recentIndex(),
    reviewsFolder: hostReading.reviewsFolder,
    discussionFiles: hostReading.discussionFiles,
    // Each presentation behaviour's own record: the chat's and the review adapters'.
    adapterSent: hostReading.adapterSent,
  };
}

async function reviewWindowCheck(
  request: ReviewWindowCheckRequest,
  sender: Electron.WebContents,
): Promise<ReviewWindowCheckAnswer> {
  const answer = await reviewWindowCheckNow(request, sender);
  reviewCheckLog.push({ atUtc: new Date().toISOString(), request, answer });
  return answer;
}

async function reviewWindowCheckNow(
  request: ReviewWindowCheckRequest,
  sender: Electron.WebContents,
): Promise<ReviewWindowCheckAnswer> {
  const windows = requireReviewWindows();
  const entryOf = (id: number) => windows.list().find((entry) => entry.contents.id === id) ?? null;
  switch (request.action) {
    case 'read':
      return { ok: true, detail: await reviewScenarioReading() };
    case 'choose': {
      const result = await inReviewWindow(
        request.webContentsId,
        'window.__dspatchReviewCheck ? window.__dspatchReviewCheck.choose() : false',
      );
      return { ok: result.ok && result.value === true, detail: result.value };
    }
    case 'go-to-step': {
      const entry = entryOf(request.webContentsId);
      if (entry === null) {
        return { ok: false, detail: 'no such review window' };
      }
      const startedAt = Date.now();
      const moved = await inReviewWindow(
        request.webContentsId,
        `window.__dspatchReviewCheck ? window.__dspatchReviewCheck.goToStep(${JSON.stringify(request.stepId)}) : false`,
      );
      if (!request.closeAfter) {
        return { ok: moved.ok && moved.value === true, detail: { moved: moved.value } };
      }
      // An ordinary close, the one the window's X makes, straight after the move: inside
      // the view's 250 ms save delay, which is the case the close has to save for.
      const closeAskedAfterMs = Date.now() - startedAt;
      const closed = new Promise<number>((resolve) => {
        entry.window.once('closed', () => {
          resolve(Date.now() - startedAt);
        });
      });
      entry.window.close();
      const closedAfterMs = await closed;
      return {
        ok: moved.ok && moved.value === true,
        detail: { moved: moved.value, closeAskedAfterMs, closedAfterMs },
      };
    }
    case 'close': {
      const entry = entryOf(request.webContentsId);
      if (entry === null) {
        return { ok: false, detail: 'no such review window' };
      }
      const startedAt = Date.now();
      const closed = new Promise<number>((resolve) => {
        entry.window.once('closed', () => {
          resolve(Date.now() - startedAt);
        });
      });
      entry.window.close();
      return { ok: true, detail: { closedAfterMs: await closed } };
    }
    case 'capture': {
      const entry = entryOf(request.webContentsId);
      if (entry === null) {
        return { ok: false, detail: 'no such review window' };
      }
      const before = entry.window.getBounds();
      if (request.width !== null) {
        if (entry.window.isMaximized()) {
          entry.window.unmaximize();
        }
        entry.window.setBounds({ ...before, width: Math.max(Math.round(request.width), 320) });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 600);
        });
      }
      const view = await inReviewWindow(
        request.webContentsId,
        'window.__dspatchReviewCheck ? window.__dspatchReviewCheck.read() : null',
      );
      const written = await captureWindowImage(request.label, entry.window);
      const contentWidth = entry.window.getContentBounds().width;
      if (request.width !== null) {
        entry.window.setBounds(before);
      }
      return { ok: true, detail: { written, contentWidth, view: view.value } };
    }
    case 'discussion': {
      const call =
        request.op === 'tab'
          ? `(() => { const b = document.querySelector('[data-ev="right-tab-${request.tab === 'step' ? 'step' : 'discussion'}"]'); if (b) { b.click(); } return b !== null; })()`
          : `(() => { const d = window.__dspatchDiscussionCheck; if (!d) { return null; } ${
              request.op === 'read'
                ? 'return d.read();'
                : request.op === 'type'
                  ? `return d.type(${JSON.stringify(request.text ?? '')});`
                  : request.op === 'enter'
                    ? `return d.enter(${String(Math.max(1, Math.min(5, request.times ?? 1)))});`
                    : request.op === 'stop'
                      ? 'return d.stop();'
                      : request.op === 'send-anyway'
                        ? 'return d.sendAnyway();'
                        : `return d.goTo(${String(request.index ?? 0)});`
            } })()`;
      const result = await inReviewWindow(request.webContentsId, call);
      return { ok: result.ok && result.value !== null && result.value !== false, detail: result.value };
    }
    case 'refuse-chat-sender': {
      // The review IPC's own guard, given the chat window's sender. The chat window has
      // no review bridge at all (its preload exposes none), so this is the second line.
      const refusal = reviewSenderRefusal(windows, sender);
      return { ok: refusal !== null, detail: { refusal, senderIsChat: sender === liveMainWindow()?.webContents } };
    }
    default:
      return { ok: false, detail: 'unknown request' };
  }
}

/**
 * `review-direct` (DSP-126 #6): review opened by itself, read from main, recorded, exited.
 *
 * There is no chat window to run a script in, so the main process waits for the one
 * review window to show its review, reads it, photographs it and closes it the
 * ordinary way. Exit 0 when one review window opened on the named definition with its
 * identity in the header and no chat window exists; 91 otherwise.
 */
async function runReviewDirectCheck(openNote: string): Promise<void> {
  const failures: string[] = [];
  const startedAt = Date.now();
  let reading: Record<string, unknown> = {};
  let view: Record<string, unknown> | null = null;
  try {
    for (;;) {
      reading = await reviewScenarioReading();
      const first = (reading['reviewWindows'] as { view?: Record<string, unknown> | null }[])[0];
      view = first?.view ?? null;
      if (view !== null && view['kind'] !== 'opening') {
        break;
      }
      if (Date.now() - startedAt > 60_000) {
        failures.push('the review window did not finish opening within 60 s');
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
    const windows = reading['reviewWindows'] as { webContentsId: number; title: string; identity: { definitionPath: string } | null }[];
    const chat = reading['chat'] as { windowOpen: boolean };
    if (windows.length !== 1) failures.push(`expected one review window, found ${String(windows.length)}`);
    if (chat.windowOpen) failures.push('a chat window exists in direct review');
    if (reading['allWindows'] !== 1) failures.push(`expected one window in all, found ${String(reading['allWindows'])}`);
    if (view?.['kind'] !== 'opened') failures.push(`the review did not open: ${JSON.stringify(view)}`);
    if (typeof view?.['identity'] !== 'string' || !/ · [0-9a-f]{7}→[0-9a-f]{7}$/.test(view['identity'])) {
      failures.push(`the header does not show the identity: ${JSON.stringify(view?.['identity'])}`);
    }
    if (view?.['hasChatBridge'] !== false || view['hasReviewBridge'] !== true) {
      failures.push('the review window does not have exactly the review bridge');
    }
    const only = windows[0];
    if (only !== undefined) {
      if (reviewDefinitionAtStart !== null && (only.identity === null || path.resolve(only.identity.definitionPath) !== path.resolve(reviewDefinitionAtStart))) {
        failures.push('the window is not on the definition that was named');
      }
      if (!only.title.includes('·')) failures.push(`the window title carries no identity: ${only.title}`);
      await reviewWindowCheck({ action: 'capture', webContentsId: only.webContentsId, label: 'direct', width: null }, BrowserWindow.getAllWindows()[0]?.webContents as Electron.WebContents);
    }
  } catch (error) {
    failures.push(String(error));
  }
  const exitCode = failures.length === 0 ? EXIT_OK : REVIEW_EXIT_DIRECT_FAILED;
  const target = process.env['DSPATCH_CHAT_LOG'];
  if (target !== undefined && target.trim() !== '') {
    try {
      fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
      fs.writeFileSync(
        path.resolve(target),
        `${JSON.stringify(
          {
            run: 'DSP-126 #6 — review opened directly for a named definition, with no chat window, read from the main process, with no provider call',
            scenario: chatRunScenario,
            definitionNamed: reviewDefinitionAtStart,
            openNote,
            startedAtUtc: chatRunStartedAtUtc,
            finishedAtUtc: new Date().toISOString(),
            userDataInUse: app.getPath('userData'),
            exitCode,
            failures,
            main: reading,
            checks: reviewCheckLog,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      log(`review-direct record written: ${path.resolve(target)}`);
    } catch (error) {
      log(`could not write the review-direct record: ${String(error)}`);
    }
  }
  chatRunReported = true;
  for (const failure of failures) {
    log(`review-direct failure: ${failure}`);
  }
  // Closed the ordinary way first, so the close path (and its save) is the one a person gets.
  for (const entry of requireReviewWindows().list()) {
    await reviewWindowCheck({ action: 'close', webContentsId: entry.contents.id }, entry.contents);
  }
  exitNow(exitCode);
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

  /*
   * The chat's channels (DSP-111): each is answered by the project host, where the chat
   * service and its adapter are. A refusal or failure reaches the window as the same
   * error, with the same words, it was before the host existed.
   */
  ipcMain.handle(GET_CONNECTION, () => hostCall('chat.getConnection', NO_SENDER));

  /**
   * The model the next ordinary message is sent to (DSP-60 #3).
   *
   * Returns what is actually in force rather than what was asked for, so the
   * window states a fact instead of echoing its own request.
   */
  ipcMain.handle(SET_MODEL, (_event, modelId: string): Promise<string> => hostCall('chat.setModel', NO_SENDER, modelId));
  ipcMain.handle(LIST_MODELS, (_event, provider: StoredSessionProvider) => hostCall('chat.listModels', NO_SENDER, provider));

  // DSP-136: an explicit agent choice in *Open a project*. Recorded only; nothing is
  // built and no provider is asked.
  ipcMain.handle(CHOOSE_AGENT, (_event, provider: unknown): Promise<StoredSessionProvider | null> =>
    hostCall('chat.chooseAgent', NO_SENDER, provider),
  );

  /**
   * The folder picker.
   *
   * Opened here, in the client, because the renderer is sandboxed and has no file
   * system access at all — and should keep none. The dialog is modal to the window so
   * it cannot be lost behind it.
   */
  ipcMain.handle(PICK_PROJECT, async (): Promise<ProjectPickOutcome> => {
    // A scripted run answers from its queue, as the editor's choosers do (DSP-147's trial).
    if (chatRunMode && remoteSession() === null) {
      const scripted = scriptedFilePick('Open Project…');
      return scripted === null ? { kind: 'cancelled' } : { kind: 'chosen', path: scripted };
    }
    const window = liveMainWindow();
    const options = {
      title: 'Choose a project folder',
      buttonLabel: 'Open this project',
      properties: ['openDirectory' as const, 'dontAddToRecent' as const],
    };
    const result =
      window === null
        ? await pickers.showOpenDialog(options)
        : await pickers.showOpenDialog(window, options);
    const chosen = result.filePaths[0];
    if (result.canceled || chosen === undefined) {
      log('folder picker cancelled');
      return { kind: 'cancelled' };
    }
    log(`folder picker chose ${chosen}`);
    return { kind: 'chosen', path: chosen };
  });

  ipcMain.handle(LIST_RECENT_WORKSPACES, (): Promise<RecentWorkspaces> => hostCall('workspaces.recent', NO_SENDER));
  ipcMain.handle(REMOVE_FROM_RECENT, (_event, workspaceIds: readonly string[]) =>
    hostCall('workspaces.removeFromRecent', NO_SENDER, workspaceIds),
  );
  ipcMain.handle(OPEN_WORKSPACE, (_event, request: WorkspaceOpenRequest) =>
    hostCall('workspaces.open', NO_SENDER, request),
  );
  ipcMain.handle(LIST_SAMPLE_PROJECTS, (): Promise<SampleProjectsView> => hostCall('samples.list', NO_SENDER));
  ipcMain.handle(CLEAN_SAMPLE_PROJECTS, (_event, paths: readonly string[]) =>
    hostCall('samples.clean', NO_SENDER, paths),
  );

  ipcMain.handle(LIST_CONVERSATIONS, () => hostCall('conversations.list', NO_SENDER));
  ipcMain.handle(CONVERSATION_SAVE_STATUS, () => hostCall('chat.conversationSaveStatus', NO_SENDER));
  ipcMain.handle(RESUME_CONVERSATION, (_event, conversationId: string) =>
    hostCall('chat.resumeConversation', NO_SENDER, conversationId),
  );
  ipcMain.handle(EXPORT_CONVERSATION, (_event, conversationId: string) =>
    exportConversation(conversationId),
  );
  /*
   * *Show in folder*: the file is located by the host and shown by this machine's file
   * manager. Both are the same machine today; a remote host would need the file
   * brought here first (DSP-111, not done).
   */
  ipcMain.handle(REVEAL_CONVERSATION, async (_event, conversationId: string) => {
    const { filePath, exists } = await hostCall(
      'conversations.locate',
      NO_SENDER,
      conversationId,
    );
    if (!exists) {
      return {
        revealed: false,
        note:
          `There is no file at ${filePath}, so there is nothing to show. The ` +
          'conversation may already have been moved or deleted from outside DSpatch.',
      };
    }
    if (remoteSession() !== null) {
      return { revealed: false, note: `The file is on the host, at ${filePath}.` };
    }
    shell.showItemInFolder(filePath);
    return {
      revealed: true,
      note: `Opened the folder containing ${filePath} and selected the file there.`,
    };
  });

  ipcMain.handle(START_SESSION, (_event, request: StartSessionRequest): Promise<ChatSessionInfo> =>
    hostCall('chat.startSession', NO_SENDER, request),
  );
  // DSP-121: the user removing the recap. Sends nothing; the service answers with
  // the continuity the window shows from then on.
  ipcMain.handle(DISCARD_PENDING_RECAP, () => hostCall('chat.discardPendingRecap', NO_SENDER));
  // DSP-121 flow: *Copy diagnostic info*, on the user's click. The clipboard is this
  // machine's; nothing is sent anywhere. An unattended scripted run records the text
  // instead (`scriptedClipboard`), so a test cannot overwrite the user's clipboard.
  ipcMain.handle(COPY_TEXT, (_event, text: unknown): void => {
    if (typeof text !== 'string') {
      throw new Error('Only text can be copied.');
    }
    if (chatRunMode && !chatRunHold) {
      scriptedClipboard.push(text);
      log(
        `scripted run: ${String(text.length)} characters to copy recorded in the run ` +
          'record; the system clipboard was not written',
      );
      return;
    }
    clipboard.writeText(text);
  });
  ipcMain.handle(
    SEND_PROMPT,
    (_event, prompt: string, acknowledgedAttemptIds?: readonly AttemptAcknowledgement[]) =>
      hostCall('chat.sendPrompt', NO_SENDER, prompt, acknowledgedAttemptIds ?? []),
  );
  // DSP-147: steering of the ordinary turn that is working.
  ipcMain.handle(STEER_TURN, (_event, request: SteerTurnRequest) => hostCall('chat.steerTurn', NO_SENDER, request));
  ipcMain.handle(CANCEL_RUN, () => hostCall('chat.cancelRun', NO_SENDER));
  ipcMain.handle(ABANDON_SEND, () => hostCall('chat.abandonSend', NO_SENDER));
  ipcMain.handle(CANCEL_OBSERVATIONS, () => hostCall('chat.cancelObservations', NO_SENDER));
  ipcMain.handle(RUN_STATE, () => hostCall('chat.runState', NO_SENDER));
  ipcMain.handle(RUN_TEST, (_event, request: TestRunRequest) => hostCall('chat.runTest', NO_SENDER, request));
  ipcMain.handle(STOP_TEST, () => hostCall('chat.stopTest', NO_SENDER));
  ipcMain.handle(TEST_FRESHNESS, () => hostCall('chat.testFreshness', NO_SENDER));
  ipcMain.handle(AGENT_COMMANDS, () => hostCall('chat.agentCommands', NO_SENDER));
  ipcMain.handle(WORKSPACE_CHANGES, () => hostCall('chat.workspaceChanges', NO_SENDER));
  ipcMain.handle(TURN_USAGE, (_event, dspatchRunId: string) =>
    hostCall('chat.turnUsage', NO_SENDER, dspatchRunId),
  );

  ipcMain.handle(GET_SCRIPTED_RUN, async (): Promise<ScriptedRunPlan | null> => {
    if (!chatRunMode) {
      return null;
    }
    // What only the host knows: the Node it runs commands with, and how its
    // presentation adapter was told to answer resumes.
    const hostPlan = await hostCall(
      'scripted.plan',
      NO_SENDER,
    );
    presentationResumeMode = hostPlan.resumeMode;
    return {
      enabled: true,
      scenario: chatRunScenario,
      turnTimeoutMs: chatRunTurnTimeoutMs,
      nodePath: hostPlan.nodePath,
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
      // The switch scenario's half and its seeded projects, from the harness that
      // seeded them. `first` unless the restart is asked for by name.
      ...(chatRunScenario === 'workspace-switch'
        ? {
            switchPhase:
              process.env['DSPATCH_CHAT_SWITCH_PHASE'] === 'again'
                ? ('again' as const)
                : ('first' as const),
          }
        : {}),
      // The seeded projects, for the switch scenario and for resume-choice, which
      // reads the first of them (A) from the same variable rather than a new one.
      ...(chatRunScenario === 'workspace-switch' ||
      chatRunScenario === 'resume-choice' ||
      chatRunScenario === 'review-window' ||
      chatRunScenario === 'review-discussion' ||
      chatRunScenario === 'review-hold'
        ? {
            switchProjects: (process.env['DSPATCH_CHAT_SWITCH_PROJECTS'] ?? '')
              .split(';')
              .map((entry) => entry.trim())
              .filter((entry) => entry !== ''),
          }
        : {}),
      ...(chatRunScenario === 'workspace-flow' || chatRunScenario === 'model-flow' || chatRunScenario === 'editor-uncertain' || chatRunScenario === 'steering-placement' || chatRunScenario === 'pair-review' || chatRunScenario === 'code-walks' || chatRunScenario === 'review-agent-choice' || chatRunScenario === 'walk-start' || chatRunScenario === 'analysis-access' || chatRunScenario === 'review-flow'
        ? {
            flowPhase: ((): NonNullable<ScriptedRunPlan['flowPhase']> => {
              const named = process.env['DSPATCH_FLOW_PHASE'];
              // DSP-152: `review-agent-choice` names its phases after what each one opens or meets.
              return named === 'again' || named === 'retry' || named === 'switch' || named === 'editor' || named === 'unavailable' || named === 'start-fails' || named === 'history' || named === 'clean' || named === 'blocked' || named === 'inherit' || named === 'inherit-switch' || named === 'inherit-copilot' || named === 'pick' || named === 'direction' || named === 'columns' || named === 'insight' || named === 'insight-again' || named === 'selection' || named === 'context' || named === 'context-walk' || named === 'panel' || named === 'panel-copilot' || named === 'remote' || named === 'remote-again' || named === 'remote-restart' ? named : 'first';
            })(),
            flowRoot: process.env['DSPATCH_FLOW_ROOT'] ?? '',
          }
        : {}),
      // DSP-121: how the presentation adapter was told to answer resumes, and
      // whether the window is to be left open after the open.
      ...(chatRunScenario === 'resume-choice'
        ? { resumeMode: hostPlan.resumeMode as NonNullable<ScriptedRunPlan['resumeMode']>, resumeHold: chatRunHold }
        : {}),
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
    // DSP-126: the review windows are another renderer, which the chat's script cannot
    // see. The client reads and drives them for it, and logs every answer.
    ipcMain.handle(
      CHECK_REVIEW_WINDOWS,
      (event, request: ReviewWindowCheckRequest): Promise<ReviewWindowCheckAnswer> =>
        reviewWindowCheck(request, event.sender),
    );
    // The loop editor's own window is another renderer too. Read through the hook the
    // editor already installs; closed the way its X closes it. Nothing here touches a run.
    // DSP-150: the review windows over a revision pair, read and operated element by element.
    ipcMain.handle(
      CHECK_PAIR_WINDOWS,
      (_event, request: PairWindowCheckRequest): Promise<EditorWindowCheckAnswer> => pairWindowCheck(request),
    );
    ipcMain.handle(
      CHECK_EDITOR_WINDOW,
      (_event, request: EditorWindowCheckRequest): Promise<EditorWindowCheckAnswer> =>
        editorWindowCheck(request),
    );
    // Only the client can resize a window, and "the chat does not follow the
    // window's width" is a claim about a window being resized. Answers the content
    // width the renderer ended up with, so the trial reads the window it got.
    ipcMain.handle(SET_WINDOW_WIDTH, (_event, width: number, height?: number): number => {
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
      // DSP-149: a height too, for the low-window reading; the window's own minimum holds.
      window.setBounds({
        ...bounds,
        width: Math.max(Math.round(width), 320),
        ...(typeof height === 'number' ? { height: Math.max(Math.round(height), 240) } : {}),
      });
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
    void gatherHostEvidence(report).then(() => {
      writeChatRunRecord(report);
      // DSP-121: the host's verdicts of the resume-choice record. A failed one takes the
      // exit over a window that passed, because what was on disk and what reached the
      // adapter is half of what that scenario claims.
      const mainChecksFailed = (resumeChoiceAtReport?.checks ?? []).filter((check) => !check.ok);
      for (const check of mainChecksFailed) {
        log(`resume-choice main-process check failed: ${check.check} (${check.evidence})`);
      }
      const exitCode =
        report.exitCode === 0 && mainChecksFailed.length > 0
          ? CHAT_EXIT_RESUME_RECORD_WRONG
          : report.exitCode;
      void captureWindowImage().then(() => {
        if (chatRunHold) {
          // Hold mode: the record is written and the window stays. Nothing else is
          // driven; the person closes it when they have looked.
          log(
            chatRunScenario === 'review-hold'
              ? `hold mode: the window is left open on P1 with nothing sent (every answer SIMULATED by ` +
                  `the presentation adapters). Close it when done; would have exited with ${String(exitCode)}.`
              : `hold mode: the window is left open with the ${presentationResumeMode} state ` +
                  `shown (SIMULATED by the presentation adapter). Close it when done; would have ` +
                  `exited with ${String(exitCode)}.`,
          );
          // The verification aid, for an agent that cannot close a window: an ordinary
          // close after the delay, so the after-close record is written as for a person.
          if (chatRunHoldCloseMs !== null) {
            const delay = chatRunHoldCloseMs;
            log(`hold mode: DSPATCH_CHAT_HOLD_CLOSE_MS is set; closing the window in ${String(delay)} ms`);
            setTimeout(() => {
              const window = liveMainWindow();
              if (window === null) {
                log('hold mode: the window was already closed');
                return;
              }
              log('hold mode: closing the window (DSPATCH_CHAT_HOLD_CLOSE_MS)');
              window.close();
            }, delay);
          }
          return;
        }
        exitWith(exitCode);
      });
    });
  });

  registerLoopGraphIpc();
  registerWorkspaceIpc();
}

/**
 * The loop editor's channels and the chat's loop channels (DSP-111).
 *
 * Reading, judging and running loops are the host's (`project-host.ts`): definitions,
 * graphs, role files, run records and the run itself. What is here is what needs a
 * window system: the file choosers, the question about an unsaved drawing in the
 * editor, the file manager, and the editor window. Every other handler forwards.
 */
function registerLoopGraphIpc(): void {
  const ownRoot = ownRepositoryRoot(app.getAppPath());

  ipcMain.handle(
    OPEN_LOOP_GRAPH,
    async (_event, request: LoopGraphOpenRequest): Promise<LoopGraphOpenOutcome> => {
      if (request.kind !== 'pick') {
        return hostCall('loop.openGraph', NO_SENDER, request);
      }
      // A dialog taking either kind; the host decides by what the file says it is.
      const picked = await pickers.showOpenDialog({
        title: 'Open a loop or a graph',
        defaultPath: ownRoot === null ? undefined : path.join(ownRoot, '.dspatch', 'loops'),
        filters: [{ name: 'Loop definition or graph', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { kind: 'cancelled' };
      }
      return hostCall('loop.openGraph', NO_SENDER, { kind: 'path', path: picked.filePaths[0] as string });
    },
  );

  ipcMain.handle(
    SAVE_LOOP_GRAPH,
    (_event, request: LoopGraphSaveRequest): Promise<LoopGraphSaveOutcome> => hostCall('loop.saveGraph', NO_SENDER, request),
  );

  ipcMain.handle(
    RESOLVE_LOOP_ROLES,
    (_event, references: readonly RoleReference[]): Promise<readonly ResolvedRoleEntry[]> =>
      hostCall('loop.resolveRoles', NO_SENDER, references),
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
   * sits in memory until a chat-loop start asks whether starting would walk an older
   * version of the drawing on screen. `null` forgets it, which is what the editor sends
   * when the drawing is saved, closed or replaced. It is the editor window's state, so
   * it stays with the windows rather than going to the host.
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
   * window needs a way to reach it. The host checks the path against the loop's root
   * (`loop.locateRoleSource`); this machine's file manager shows it.
   */
  ipcMain.handle(
    REVEAL_ROLE_SOURCE,
    async (
      _event,
      request: { readonly root: string; readonly path: string },
    ): Promise<{ readonly revealed: boolean; readonly note: string }> => {
      const located = await hostCall(
        'loop.locateRoleSource',
        NO_SENDER,
        request,
      );
      if (!('target' in located)) {
        return located;
      }
      if (remoteSession() !== null) {
        return { revealed: false, note: `The file is on the host, at ${located.target}.` };
      }
      shell.showItemInFolder(located.target);
      return { revealed: true, note: `Opened the folder containing ${located.target} and selected it there.` };
    },
  );

  /**
   * Which loops this window can offer. **A read**: one directory listed per folder,
   * nothing started, nothing written.
   */
  ipcMain.handle(LIST_LOOP_DEFINITIONS, (): Promise<LoopDefinitionListing> => hostCall('loop.listDefinitions', NO_SENDER));

  /**
   * Select a definition for the next mandate. **It starts nothing.**
   *
   * `null` means *ask me for a file first*, which is the editor's **Open loop…**: the
   * chooser is this process's. Then the host judges the file (`loop.judgeDefinition`),
   * and only a definition that would run gets as far as the question about an unsaved
   * drawing (DSP-88): before the switch, because choosing draws, and after the
   * judgement, because a definition that cannot run is not going to be drawn either
   * way. Only then does the host record it (`loop.chooseDefinition`).
   */
  ipcMain.handle(
    CHOOSE_LOOP_DEFINITION,
    async (_event, definitionPath: string | null): Promise<LoopDefinitionChooseOutcome> => {
      let asked = definitionPath;
      if (asked === null && chatRunMode) {
        asked = scriptedFilePick('Open loop…');
      } else if (asked === null) {
        const picked = await pickers.showOpenDialog({
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
      const judged = await hostCall('loop.judgeDefinition', NO_SENDER, asked);
      if (judged.kind === 'refused') {
        return judged;
      }
      const settled = await settleUnsavedDrawingBeforeRedraw();
      if (!settled.go) {
        log(`loop choice stopped at the unsaved-drawing question, nothing recorded: ${judged.key}`);
        return { kind: 'cancelled', note: settled.note };
      }
      return hostCall('loop.chooseDefinition', NO_SENDER, judged.key, settled.answered);
    },
  );

  ipcMain.handle(OPEN_LOOP_EDITOR, (): LoopEditorWindowOutcome => openLoopEditorWindow());
  /*
   * Open review (DSP-126). The input is read by the host from the session the chat
   * service has open - not sent by the renderer - and it is only the folder: review
   * uses it as the chooser's start folder and to find the last review opened for that
   * repository. Nothing else of the chat goes to review, and nothing comes back.
   */
  ipcMain.handle(OPEN_REVIEW, async (): Promise<LoopEditorWindowOutcome> => {
    const context = await hostCall(
      'review.openContext',
      NO_SENDER,
    );
    // DSP-150: review starts by choosing a repository and two commits, in a diff
    // window of its own. Walk definitions are opened from there, over the same pair.
    // DSP-132: the main window's agent is the default for a new review discussion.
    // DSP-152: with the model that agent uses there, the start of the review's agent work.
    return requireReviewWindows().openDiff(context.defaultProvider, context.defaultModel);
  });
  ipcMain.handle(OPEN_EXAMPLE_REVIEW, (): Promise<LoopEditorWindowOutcome> => openExampleReview());

  ipcMain.handle(START_EDITOR_LOOP_RUN, (event, request: EditorLoopRunRequest): Promise<EditorLoopRunOutcome> =>
    hostCall('loop.startEditorRun', from(event), request),
  );

  /**
   * Which run is walking now.
   *
   * **A read, and only a read.** DSP-28 #5: opening, closing and reopening the graph
   * view must never start, cancel or duplicate work, and a window that has just opened
   * has to be able to find out what is already running or it could only ever show the
   * next run.
   */
  ipcMain.handle(CURRENT_LOOP_RUN, (): Promise<LiveRunAnnouncement | null> => hostCall('loop.currentRun', NO_SENDER));
  ipcMain.handle(CURRENT_LOOP_RUN_VIEW, () => hostCall('loop.currentRunView', NO_SENDER));
  ipcMain.handle(READ_LOOP_RUN_AGENT, (_event, query: unknown): Promise<LoopRunAgentInfo> =>
    hostCall('loop.readRunAgent', NO_SENDER, query),
  );
  ipcMain.handle(REQUEST_LOOP_PAUSE, (): Promise<LoopControlOutcome> => hostCall('loop.requestPause', NO_SENDER));
  ipcMain.handle(CONTINUE_LOOP, (): Promise<LoopControlOutcome> => hostCall('loop.continue', NO_SENDER));
  ipcMain.handle(SET_LOOP_MODE, (_event, mode: LoopMode): Promise<LoopControlOutcome> =>
    hostCall('loop.setMode', NO_SENDER, mode),
  );
  ipcMain.handle(READ_LOOP_CONTROL, (): Promise<LoopControlReport> => hostCall('loop.readControl', NO_SENDER));
  ipcMain.handle(CANCEL_EDITOR_LOOP_RUN, (): Promise<EditorLoopCancelOutcome> => hostCall('loop.cancelEditorRun', NO_SENDER));

  /**
   * Start the chat's loop run on the host, with the window that pressed Send as the
   * one that hears its transcript.
   *
   * **Unsaved edits are never run quietly, and never skipped quietly** (DSP-86). If the
   * loop editor holds edits to the graph file this run would read, the person is asked
   * first, here, where the dialog is: *Cancel* starts nothing and writes nothing, and
   * *Save and run* writes the drawing (on the host) before the host reads the
   * definition, so what walks is what was just written. The host's start check comes
   * first, so a run that would be refused anyway is refused before anyone is asked.
   */
  ipcMain.handle(
    START_CHAT_LOOP_RUN,
    async (event, request: ChatLoopRunRequest): Promise<ChatLoopRunOutcome> => {
      const check = await hostCall(
        'loop.chatRunStartCheck',
        NO_SENDER,
        request.definitionKey,
      );
      if ('refused' in check) {
        return check.refused;
      }
      const pendingSave =
        unsavedDrawing !== null &&
        (pathsAreCaseInsensitive
          ? unsavedDrawing.path.toLowerCase() === check.graphPath.toLowerCase()
          : unsavedDrawing.path === check.graphPath)
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
        const failure = await writeUnsavedDrawing(pendingSave, 'run');
        if (failure !== null) {
          return { kind: 'failed', note: `Nothing was started. ${failure}` };
        }
      }
      return hostCall('loop.startChatRun', from(event), request);
    },
  );

  ipcMain.handle(
    LIST_RUN_RECORDS,
    (_event, conversationId: string): Promise<readonly StoredRunRecordEntry[]> =>
      // Reading only. No agent call, no command, no file change, and nothing here
      // can resume a run: an incomplete record is read back as incomplete and stays
      // that way. DSP-25 #5.
      hostCall('loop.listRunRecords', NO_SENDER, conversationId),
  );

  /**
   * Take a message for the run that is already walking (DSP-32, DSP-53). The window
   * routes every press of Send during a run here rather than to `START_CHAT_LOOP_RUN`,
   * so a message cannot start a competing run in the same working copy: there is no
   * code path from one to the other, on either side of the host boundary.
   */
  ipcMain.handle(
    ADD_LOOP_INSTRUCTION,
    (_event, request: AddLoopInstructionRequest): Promise<AddLoopInstructionOutcome> =>
      hostCall('loop.addInstruction', NO_SENDER, request),
  );

  /**
   * Show the chat loop before anything is sent, or take it off the screen again.
   * **Nothing here starts work**: the host reads the graph and announces it standing
   * ready to every window that follows runs.
   */
  ipcMain.handle(
    PREPARE_CHAT_LOOP,
    (_event, wanted: boolean, definitionKey: string | null): Promise<ChatLoopPrepareOutcome> =>
      hostCall('loop.prepareChatLoop', NO_SENDER, wanted, definitionKey),
  );

  ipcMain.handle(CANCEL_CHAT_LOOP_RUN, (): Promise<ChatLoopCancelOutcome> => hostCall('loop.cancelChatRun', NO_SENDER));
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
    disposeThenEnd((shutdown) => {
      // Hold mode (DSP-121): the window's close is the run's close - a person's or the
      // verification aid's - so the record gets the after-close reading an exit gives.
      if (chatRunHold && lastScriptedReport !== undefined) {
        writeChatRunRecord(lastScriptedReport, 'after-close', shutdown);
      }
      app.quit();
    }, 'quit');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

function main(): void {
  const forbidden = process.env['DSPATCH_CLIENT_FORBIDDEN_ROOT'];
  if (chatRunMode && forbidden !== undefined && forbidden !== '') {
    guardProjectFiles(forbidden);
  }
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

  void app.whenReady().then(async () => {
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
    // leave that limit invisible in exactly the run where it applies. The host logs
    // the same reading, with the sample generator's boundary, when it starts.
    log(`ownRepo=${ownRepoRoot ?? 'none'}`);
    // Before anything of DSpatch's is created or written: the project host, started
    // below, is the first thing that touches DSpatch's files under `userData`.
    const expectedUserData = process.env['DSPATCH_CHAT_EXPECT_USERDATA'] ?? '';
    // DSP-149: required, not optional. On 20 September scripted `loop-choice` runs that
    // named no user-data folder wrote ten throwaway Temp projects into a person's real
    // Recent list. A scripted run now has to say where its user data is.
    if (chatRunMode && expectedUserData.trim() === '') {
      log(
        'scripted run refused: DSPATCH_CHAT_EXPECT_USERDATA is not set. A scripted run must name ' +
          'an isolated user-data folder (and start with --user-data-dir set to it), so it can never ' +
          `write into a real profile. Nothing of DSpatch's was created or written; exiting with ` +
          `${String(CHAT_EXIT_WRONG_USERDATA)}.`,
      );
      app.exit(CHAT_EXIT_WRONG_USERDATA);
      return;
    }
    if (chatRunMode && expectedUserData.trim() !== '') {
      const actual = app.getPath('userData');
      if (!samePathSpelling(actual, expectedUserData)) {
        log(
          `scripted run refused: userData is ${actual} but DSPATCH_CHAT_EXPECT_USERDATA ` +
            `names ${expectedUserData}. Nothing of DSpatch's was created or written; ` +
            `exiting with ${String(CHAT_EXIT_WRONG_USERDATA)}.`,
        );
        app.exit(CHAT_EXIT_WRONG_USERDATA);
        return;
      }
      log(`userData matches DSPATCH_CHAT_EXPECT_USERDATA (${expectedUserData})`);
    }
    // DSP-111: the project's work is the project host's, a process of its own. It is
    // started before any window exists, so no window asks it anything before it is
    // ready, and so a host that cannot start is said plainly with nothing yet open.
    // It also restores the remembered workspace, before the loop-definition handlers
    // are asked for a list (a window that asked first would get one with no preference).
    if (!(await startHostOrQuit())) {
      return;
    }
    // The review module (DSP-126): read-only git at a fixed revision pair, in windows of
    // its own. Before `registerIpc`, whose *Open review* handler uses it. The repository
    // and the review records are the review host's, in the project host; the windows
    // reach it only through `ReviewHostApi`, bound to that process.
    const reviewHost = remoteReviewHost();
    reviewWindows = new ReviewWindows({
      host: reviewHost,
      preloadPath: path.join(__dirname, '..', 'preload', 'review-preload.js'),
      load: (window, view) => {
        // `window=review` makes the renderer mount review alone (`renderer/main.tsx`);
        // `view=diff` (DSP-150) mounts the diff review of a chosen revision pair, and
        // `view=panel` the review's panel, Step and Discussion (30 October 2026).
        const search = view === 'diff' ? 'window=review&view=diff' : view === 'panel' ? 'window=review&view=panel' : 'window=review';
        if (rendererUrl === undefined) {
          void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
            hash: 'review',
            search,
          });
        } else {
          const base = rendererUrl.split('#')[0] ?? rendererUrl;
          void window.loadURL(`${base}${base.includes('?') ? '&' : '?'}${search}#review`);
        }
      },
      development: !app.isPackaged,
      hostPicker: () => (remoteSession() === null ? undefined : (options: Electron.OpenDialogOptions) => pickOnHost(options)),
      // A held window is a person's: their review chooser is the real dialog, never the queue.
      scriptedPick: chatRunMode && !chatRunHold ? () => scriptedFilePick('review definition') : null,
      log: (message) => {
        log(`[review] ${message}`);
      },
    });
    registerReviewIpc(
      reviewWindows,
      reviewHost,
      reviewDiscussionClient,
      {
        call: (method, ...args) => host.call<unknown>(method, NO_SENDER, ...args),
      },
      log,
    );
    registerIpc();
    registerHostLinkIpc();
    if (reviewAskedAtStart && !directReviewMode) {
      log(
        'DSPATCH_REVIEW_DEFINITION or #review was set and is ignored: this launch is a ' +
          'smoke test, a probe or another scripted run, each of which is about the chat window.',
      );
    }
    if (directReviewMode) {
      // Review alone: its own window through the same call *Open review* makes, no chat.
      void requireReviewWindows()
        .open({ repository: null, definitionPath: reviewDefinitionAtStart })
        .then((outcome) => {
          log(`direct review: ${outcome.kind}: ${outcome.note}`);
          if (chatRunScenario === 'review-direct') {
            void runReviewDirectCheck(outcome.note);
          }
        });
    } else {
      mainWindow = createWindow();
    }

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

    // Hold mode has no timeout: the window is meant to stay open for a person, and
    // a timer that exited it would be the one thing that mode exists to avoid.
    if (chatRunMode && !chatRunHold) {
      setTimeout(() => {
        if (chatRunReported) {
          return;
        }
        chatRunReported = true;
        log(
          `scripted run did not report within ${String(chatRunTimeoutMs)} ms. ` +
            'This is a timeout, not a verdict: the turn may still be going.',
        );
        void gatherHostEvidence(null).then(() => {
          writeChatRunRecord(null);
          exitNow(rendererReady ? CHAT_EXIT_TIMEOUT : CHAT_EXIT_NO_REPORT);
        });
      }, chatRunTimeoutMs);
    }
  });
}

main();
