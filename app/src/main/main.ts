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
  MenuCommand,
  ProjectListEntry,
  ProjectListing,
  ProjectPickOutcome,
  RendererReady,
  ChatLoopPrepareOutcome,
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
  CHAT_LOOP_GRAPH_REL,
  chatPromptFor,
  describeChatLoopBinding,
  lookupFromGraph,
  modelForChatNode,
  type ChatRoleText,
} from '../shared/loop-chat';
import { describeLiveBinding } from '../shared/loop-editor-run';
import { roleKey } from '../shared/loop-graph-editing';
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import { detectNewline } from '../shared/loop-graph-write';
import type { LoopNode, RoleReference, RoleResolver } from '../shared/loop-graph';
import type { RunResult, RunStatus } from '../shared/loop-run';
import { ChatService, type ChatAdapter } from './chat-service';
import { ConversationStore } from './conversation-store';
import { PresentationAdapter, presentationAuthStatus } from './presentation-adapter';
import { InstructionQueue } from './instruction-queue';
import { instructionPreamble } from '../shared/loop-instruction';
import { createFileRoleResolver } from './loop-graph-roles';
import { refuseLiveWorkspace } from './loop-live';
import { defaultLiveModel, runLiveGraph } from './loop-live-run';
import { LoopRunController } from './loop-control-runtime';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from '../shared/loop-control';
import { LoopRunAudience } from './loop-run-audience';
import type { LiveRunAnnouncement } from '../shared/loop-run-view';
import { ownRepositoryRoot } from './own-repository';
import { PROBE_EXIT, runCursorProbe } from './probe-cursor';
import { ProjectStore } from './project-store';
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
const OPEN_LOOP_GRAPH: BridgeChannel = 'dspatch:open-loop-graph';
const SAVE_LOOP_GRAPH: BridgeChannel = 'dspatch:save-loop-graph';
const RESOLVE_LOOP_ROLES: BridgeChannel = 'dspatch:resolve-loop-roles';
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
  chatRunScenario === 'conversation-comes-back';
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
        createAdapter: (): ChatAdapter => new PresentationAdapter(),
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
        label: '&Project',
        submenu: [
          {
            label: 'Open a project…',
            accelerator: 'CmdOrCtrl+O',
            click: () => {
              tell('change-project');
            },
          },
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
        ],
      },
  ]);
  Menu.setApplicationMenu(menu);
  menuItemsByCommand.clear();
  for (const [command, label] of [
    ['change-project', 'Open a project…'],
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
/**
 * A graph's role references, resolved once, keyed the way the renderer indexes them.
 *
 * Shared by the editor's `resolveLoopRoles` handler and by the announcement a run
 * makes about itself, because those have to agree. A run that announced its drawing
 * without its bindings is what made a graph view refuse to draw the loop it was
 * watching: the roles existed, had already been resolved here in order to run the
 * graph, and simply never travelled — see `LiveRunAnnouncement.roles`.
 */
function resolvedRolesWith(
  references: readonly RoleReference[],
  resolve: RoleResolver,
): readonly ResolvedRoleEntry[] {
  const seen = new Map<string, ResolvedRoleEntry>();
  for (const reference of references) {
    const key = roleKey(reference);
    if (!seen.has(key)) {
      seen.set(key, { key, role: resolve(reference) });
    }
  }
  return [...seen.values()];
}

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
          title: 'Open a loop graph',
          defaultPath: ownRoot === null ? undefined : path.join(ownRoot, 'docs', 'loop', 'graphs'),
          filters: [{ name: 'Loop graph', extensions: ['json'] }],
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

      const projectRoot = ownRoot ?? path.dirname(target);
      return {
        kind: 'read',
        path: target,
        displayPath: path.relative(projectRoot, target) || target,
        text,
        newline: detectNewline(text),
        projectRoot,
        roles: roleEntries(referencedRoles(text)),
      };
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
            `cannot load ${CHAT_LOOP_GRAPH_REL}.`,
        };
      }
      const overlap = activeLoopRunRefusal();
      if (overlap !== null) {
        return { kind: 'failed', note: overlap };
      }

      const graphPath = path.join(ownRoot, CHAT_LOOP_GRAPH_REL);
      let graphText: string;
      try {
        graphText = fs.readFileSync(graphPath, 'utf8');
      } catch (error) {
        return {
          kind: 'failed',
          note: `${graphPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // Held rather than constructed inline, because the same resolution now feeds two
      // things: validation, which refuses a reference that resolves to nothing, and the
      // prompt, which sends the role's own text. Before DSP-46 only the first existed,
      // so the refusal protected a property nothing provided. One resolver, and it
      // caches, so the role file is read once per run however many nodes name it.
      const resolveRole = createFileRoleResolver(ownRoot);
      const loaded = loadLoopGraph(graphText, {
        resolveRole,
        connectedTargets: ['cursor'],
      });
      if (!loaded.ok) {
        return {
          kind: 'refused',
          reason: `The chat loop graph does not validate, so it was not run:\n\n${formatFindings(loaded.findings)}`,
        };
      }

      const binding = describeChatLoopBinding(loaded.graph);
      if (!binding.ready) {
        return { kind: 'refused', reason: binding.reason };
      }

      const workspacePath = session.workspacePath;
      const refusal = refuseLiveWorkspace(workspacePath, path.join(ownRoot, 'app'));
      if (refusal !== null) {
        return { kind: 'refused', reason: refusal };
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
      // is in the file now.
      const graphVersionId = graphVersionIdFor(graphText);
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
          modelRequested,
          workspacePath,
          keepWorkspace: true,
          bindingKind: 'chat-loop',
          abortSignal: abort.signal,
          control: loopControl,
          promptFor: (node) => {
            const prompt = chatPromptFor(node, {
              entryId: loaded.graph.entry,
              mandate: request.mandate,
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
        });
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
    (_event, chosen: boolean): ChatLoopPrepareOutcome => {
      if (!chosen) {
        runAudience.standDown();
        return { kind: 'stood-down' };
      }
      if (ownRoot === null) {
        return {
          kind: 'not-shown',
          note:
            'DSpatch could not find its own working copy from where it is running, so it ' +
            `cannot read ${CHAT_LOOP_GRAPH_REL} to show you the loop.`,
        };
      }
      const graphPath = path.join(ownRoot, CHAT_LOOP_GRAPH_REL);
      let graphText: string;
      try {
        graphText = fs.readFileSync(graphPath, 'utf8');
      } catch (error) {
        return {
          kind: 'not-shown',
          note: `${graphPath} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      const resolveRole = createFileRoleResolver(ownRoot);
      const loaded = loadLoopGraph(graphText, { resolveRole, connectedTargets: ['cursor'] });
      if (!loaded.ok) {
        return {
          kind: 'not-shown',
          note: `The chat loop graph does not validate, so there is nothing to show:\n\n${formatFindings(loaded.findings)}`,
        };
      }
      const run: LiveRunAnnouncement = {
        // Its own id, and never one a run will reuse. The address has to be unique or
        // a later run's entries could land on the stand-by view; `ready-` is not a
        // prefix any run id takes.
        runId: `ready-${graphVersionIdFor(graphText).slice(0, 12)}`,
        graphVersionId: graphVersionIdFor(graphText),
        graphId: loaded.graph.id,
        graphName: loaded.graph.name,
        binding: 'chat-loop',
        graphText,
        startedAtUtc: new Date().toISOString(),
        phase: 'ready',
        roles: resolvedRolesWith(referencedRoles(graphText), resolveRole),
      };
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
 * The role references in a graph file, read without validating it.
 *
 * An invalid graph still needs its roles resolved: the editor draws what it can and
 * the findings say what is wrong, and a broken reference is one of the things it must
 * be able to show. So this reads the shape rather than trusting it.
 */
function referencedRoles(text: string): readonly RoleReference[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const nodes = (parsed as { readonly nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  const found: RoleReference[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const role = (node as { readonly role?: unknown }).role;
    if (typeof role !== 'object' || role === null) {
      continue;
    }
    const id = (role as { readonly id?: unknown }).id;
    const source = (role as { readonly source?: unknown }).source;
    if (typeof id !== 'string' || typeof source !== 'object' || source === null) {
      continue;
    }
    const kind = (source as { readonly kind?: unknown }).kind;
    const sourcePath = (source as { readonly path?: unknown }).path;
    if (typeof kind !== 'string' || typeof sourcePath !== 'string') {
      continue;
    }
    found.push({ id, source: { kind: kind as RoleReference['source']['kind'], path: sourcePath } });
  }
  return found;
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
