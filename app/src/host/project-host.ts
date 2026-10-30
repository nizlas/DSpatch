import fs from 'node:fs';
import path from 'node:path';

import type {
  AddLoopInstructionOutcome,
  AddLoopInstructionRequest,
  SteerTurnRequest,
  AttemptAcknowledgement,
  AttemptRef,
  BridgeChannel,
  ChatLoopCancelOutcome,
  ChatLoopPrepareOutcome,
  ChatLoopRecordInfo,
  ChatLoopReply,
  ChatLoopRunOutcome,
  ChatLoopRunRequest,
  ChatSessionInfo,
  EditorLoopCancelOutcome,
  EditorLoopRunOutcome,
  EditorLoopRunRequest,
  LoopDefinitionChooseOutcome,
  LoopDefinitionListing,
  LoopGraphOpenOutcome,
  LoopGraphOpenRequest,
  LoopGraphSaveOutcome,
  LoopGraphSaveRequest,
  LoopInstructionEventPayload,
  ModelListing,
  RecentWorkspaceEntry,
  RecentWorkspaces,
  ResolvedRoleEntry,
  SampleProjectsView,
  ScriptedRunReport,
  StartSessionRequest,
  StoredRunRecordEntry,
  StoredSession,
  StoredSessionProvider,
  TestRunRequest,
  WorkspaceOpenOutcome,
  WorkspaceOpenRequest,
} from '../shared/bridge';
import type { AppTool, ModelInfo } from '../adapter/types';
import type { HostEnvironmentFacts, HostEventTarget, HostShutdownAnswer, HostStartConfig } from '../shared/host-protocol';
import {
  PROJECT_HOST_METHOD_NAMES,
  SCRIPTED_ONLY_METHODS,
  type HostAnswerOf,
  type HostArgs,
  type HostCallContext,
  type ProjectHostMethodName,
} from '../shared/project-host-contract';
import {
  boundedPathList,
  chatPromptFor,
  describeChosenLoopBinding,
  lookupFromGraph,
  modelForChatNode,
  type ChatRoleText,
} from '../shared/loop-chat';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from '../shared/loop-control';
import { describeLiveBinding } from '../shared/loop-editor-run';
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import type { LoopGraph, LoopNode, LoopTarget, RoleReference, RoleResolver } from '../shared/loop-graph';
import { earlierInstructionsContext, instructionPreamble } from '../shared/loop-instruction';
import {
  describeRunOutcome,
  runOutcomeFrom,
  type RecordedCommand,
  type RecordedEndingKind,
  type RecordedRunEnding,
  type RecordedRunMessage,
  type RunWalkEnding,
} from '../shared/loop-record';
import { describeLoopRunAgent, type LoopRunAgentInfo } from '../shared/loop-run-agent-text';
import type { RunResult, RunStatus } from '../shared/loop-run';
import type { LiveRunAnnouncement } from '../shared/loop-run-view';
import { REVIEW_DISCUSSION_CHANNELS, type DiscussionIdentity, type DiscussionTarget } from '../shared/review-discussion';
import { isReviewHostError, REVIEW_HOST_METHODS } from '../shared/review-host-contract';
import { workingRootsFrom } from '../shared/working-roots';
import {
  addFolderTo,
  folderDisplayName,
  parseWorkspaceFile,
  removeFolderFrom,
  sameFolder,
  workspaceFileText,
  type DirectoryPage,
  type FileView,
  type WorkspaceView,
} from '../shared/workspace-folders';
import {
  ANALYSIS_PERMISSIONS,
  REVIEW_DENY_REASON,
  REVIEW_PERMISSIONS,
  describePermissionPolicy,
} from '../adapter/claude-agent-sdk-adapter';
import { claudeSupportStatus } from '../adapter/claude-support';
import { ChatService, type ChatAdapter } from '../main/chat-service';
import { ConversationStore } from '../main/conversation-store';
import { inRecent, ProjectStore, type WorkspaceRecord } from '../main/project-store';
import { workspaceTools } from './workspace-tools';
import { locateExampleReview } from '../main/example-review';
import { InstructionQueue } from '../main/instruction-queue';
import { chatRunHold, chatRunMode, chatRunScenario, presentationMode } from '../main/launch-mode';
import { judgeChosenLoop } from '../main/loop-choice-check';
import { LoopRunController } from '../main/loop-control-runtime';
import {
  defaultChoiceFrom,
  listChoosableLoops,
  openChosenLoop,
  rowForKey,
  type ChosenLoopOutcome,
} from '../main/loop-definition-choice';
import { discoverLoopDefinitions, openLoopDefinitionFile } from '../main/loop-definition-files';
import {
  isLoopDefinitionText,
  openedFromDefinition,
  openedFromGraphFile,
  referencedRoles,
  resolvedRolesWith,
} from '../main/loop-graph-open';
import { createFileRoleResolver } from '../main/loop-graph-roles';
import { refuseLiveWorkingRoots, type LiveInspection, type SteerableStep } from '../main/loop-live';
import { uncertainLoopWork, WORKING_COPY_LOCK } from '../main/working-copy-lock';
import type { DisposalRecord } from '../adapter/claude-agent-sdk-adapter';
import { defaultLiveModel, runLiveGraph } from '../main/loop-live-run';
import { LoopRunAudience } from '../main/loop-run-audience';
import { loopRunAgentInfo, prepareLoopRun, resolveLoopProvider, type LoopRunAgentRequest } from '../main/loop-run-agent';
import { ownRepositoryRoot } from '../main/own-repository';
import {
  CLAUDE_SHAPED_MODELS,
  PresentationAdapter,
  PresentationResumeBehaviour,
  presentationAuthStatus,
  presentationResumeMode,
  presentationSendMode,
} from '../main/presentation-adapter';
import { PROBE_EXIT, runCursorProbe } from '../main/probe-cursor';
import { CURSOR_ANALYSIS_REFUSAL, providerAdapters } from '../main/provider-adapters';
import { providerAvailability } from '../main/provider-availability';
import {
  REVIEW_DISCUSSION_DEFAULT_MODEL,
  ReviewDiscussions,
  type EnvelopeSource,
  type ReviewDiscussionService,
} from '../main/review-discussion-service';
import {
  graphVersionIdFor,
  recordedCommandsAtEnd,
  recordedSnapshotsFrom,
  RunRecordStore,
  type RunRecordWriter,
} from '../main/run-record-store';
import type { SampleProjectListing } from '../main/sample-projects';
import { readDirectoryPage, readFileForViewing } from '../main/workspace-tree';
import { ReviewHost } from './review-host';
import { ReviewPairs, pairKeyOf } from './review-pairs';
import { earlierDiscussion, pairEnvelopeSource } from './review-pair-discussion';
import { definitionFrom } from '../shared/review-agent';
import { ReviewAgentJobs } from './review-agent-jobs';
import { RevisionSnapshots } from './revision-snapshots';
import { REVIEW_PAIR_CHANGED } from '../shared/review-pair';

/*
 * The project host (DSP-111): the services that do a project's work, in a process of
 * their own.
 *
 * **What is here.** Repository access and git, the agent connections (the chat's, every
 * loop step's and every review discussion's, all from the one provider factory), loop
 * runs and their control, and the durable data those services own: remembered projects,
 * the workspace, conversations, run records and review records, all under the data
 * directory the client names (`HostStartConfig.userDataDir`). The provider SDK's own
 * harness still owns each agent's tools and inner loop; this process holds the adapters
 * that start it, exactly as the main process did.
 *
 * **What is not.** Windows, menus, dialogs, the clipboard and the file manager are the
 * client's (`main/main.ts`). Where an operation needs a person to choose a file, the
 * client asks first and sends the chosen path; where it needs a question answered
 * before work starts (an unsaved drawing in the editor), the client asks before calling.
 * Nothing here imports Electron: `project-host-boundary.test.ts` reads that from the
 * source, however deep the imports go.
 *
 * **How it is reached.** Every method in `hostMethods()` takes and returns plain data,
 * and each is reached only through `host-server.ts`. Events go to an audience
 * (`HostEventTarget`) that the client turns into windows. The code below is the main
 * process's own, moved: its comments still speak of handlers, because each method is
 * the body of the IPC handler it used to be, and the client's handler now forwards to it.
 *
 * One host per process, so the state is module state, as it was in `main.ts`; it is
 * set up once by `startProjectHost`.
 */

let hostConfig: HostStartConfig | null = null;

let emitEvent: (to: HostEventTarget, channel: string, payload: unknown) => void = () => undefined;

function config(): HostStartConfig {
  if (hostConfig === null) {
    throw new Error("DSpatch's project host has not been started.");
  }
  return hostConfig;
}

/** DSpatch's own durable data: what `app.getPath('userData')` was in the main process. */
function userDataDir(): string {
  return config().userDataDir;
}

function log(message: string): void {
  process.stdout.write(`[dspatch] ${message}\n`);
}

const AGENT_EVENT: BridgeChannel = 'dspatch:agent-event';
const WORKSPACE_FOLDERS_CHANGED: BridgeChannel = 'dspatch:workspace-folders-changed';
const SESSION_REPLACED: BridgeChannel = 'dspatch:session-replaced';
const LOOP_CONTROL_CHANNEL: BridgeChannel = 'dspatch:loop-control';
const CHAT_LOOP_JOURNAL: BridgeChannel = 'dspatch:chat-loop-journal';
const CHAT_LOOP_REPLY: BridgeChannel = 'dspatch:chat-loop-reply';
const CHAT_LOOP_ACTIVITY: BridgeChannel = 'dspatch:chat-loop-activity';
const LOOP_INSTRUCTION_EVENT: BridgeChannel = 'dspatch:loop-instruction-event';

/**
 * A project to offer at startup, for an automated run or a shortcut.
 *
 * Deliberately a new variable rather than a new meaning for
 * `DSPATCH_CHAT_WORKSPACE`, which still points at the generated sample project.
 * Reusing it would silently change what DSP-1's recorded procedure did.
 */
const startupProjectPath = process.env['DSPATCH_PROJECT_PATH'];

/**
 * Whether `Use loop` is ticked, held where a run ends rather than where it was ticked.
 *
 * DSP-86 #6: when a run ends, the Ready pulse has to come back to the entry step without
 * the person toggling the feature off and on. Only the chat window knows the tick — but
 * it tells the host every time it moves, through `loop.prepareChatLoop`'s `wanted`,
 * so the host already holds the fact. Recording it here rather than re-announcing
 * from the chat window is what makes the pulse return while the person is looking at the
 * graph view: in a window on `#editor` the chat is not mounted at all, and a restoration
 * that lived there would fire for nobody in the one place it is meant to be seen.
 */
let chatLoopIntended = false;

/** To the chat window, as `sendToMainWindow` did. */
function sendToMainWindow(channel: BridgeChannel, payload: unknown): void {
  emitEvent({ kind: 'main-window' }, channel, payload);
}

/** To every window, as `sendToEveryWindow` did. */
function sendToEveryWindow(channel: BridgeChannel, payload: unknown): void {
  emitEvent({ kind: 'every-window' }, channel, payload);
}

/** To the one window that started the work, as `event.sender.send` did. */
function sendToContents(contentsId: number, channel: string, payload: unknown): void {
  emitEvent({ kind: 'contents', id: contentsId }, channel, payload);
}

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
function presentationAdapterOptions(): {
  readonly deltaMs?: number;
  readonly resume: PresentationResumeBehaviour;
  readonly models?: readonly ModelInfo[];
  readonly listDelayMs?: number;
} {
  const raw = process.env['DSPATCH_PRESENTATION_DELTA_MS'] ?? '';
  const parsed = Number.parseInt(raw, 10);
  // DSP-152: `claude` lists models shaped like a Claude account's, arriving after a while.
  const claudeShaped = process.env['DSPATCH_PRESENTATION_MODELS'] === 'claude';
  const listMs = Number.parseInt(process.env['DSPATCH_PRESENTATION_LIST_MS'] ?? '', 10);
  return {
    ...(Number.isFinite(parsed) && parsed > 0 ? { deltaMs: parsed } : {}),
    resume: presentationResume,
    ...(claudeShaped ? { models: CLAUDE_SHAPED_MODELS, listDelayMs: Number.isFinite(listMs) && listMs > 0 ? listMs : 1500 } : {}),
  };
}

/**
 * How the presentation adapter answers `resume()` (`DSPATCH_CHAT_RESUME`, DSP-121),
 * and the record of what it was asked.
 *
 * One object for the whole process, because `ChatService` replaces its adapter with
 * the session and `refused-once` has to remember a refusal across that. Read only
 * in presentation mode: an ordinary launch constructs no presentation adapter, so
 * the variable cannot reach a provider. A value that is not one of the four modes is
 * logged and treated as `ok`; the `resume-choice` scenario then reports that it was
 * given no refusal to show, rather than running a different trial.
 */
const presentationResumeRequested = presentationResumeMode(process.env['DSPATCH_CHAT_RESUME']);
const presentationResume = new PresentationResumeBehaviour(presentationResumeRequested ?? 'ok');
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
let ownRepoRoot: string | null = null;

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
  return ownRepoRoot ?? path.resolve(config().appPath, '..');
}
/**
 * DSP-117: the reference that enables Claude in the main chat for this launch.
 *
 * Read once, here. `DSPATCH_CLAUDE_AUTHORIZATION=<reference text>` maps to the
 * adapter's existing subscription authorization; absent (the default), Claude
 * cannot be chosen and the window says so. No credential is read, copied or
 * stored: the text is a reference to an approval, shown in Session details, and
 * the adapter's own credential rule still decides whether a session may start.
 * There is no API-key path.
 */
const CLAUDE_AUTHORIZATION_REFERENCE: string | null =
  (process.env['DSPATCH_CLAUDE_AUTHORIZATION'] ?? '').trim() || null;

/**
 * DSP-133: whether Claude support (`app/claude-support/`) is installed, read once
 * at launch from `package.json` files only. Nothing installs it here, at reopen
 * or when the agent choice renders: `npm run claude:install` in `app/` does, and
 * a restart picks it up. A packaged build has none.
 */
const CLAUDE_SUPPORT = claudeSupportStatus();

/**
 * DSP-132: every provider adapter - the chat's and the review discussion's - comes from
 * this one factory (`provider-adapters.ts`), which picks the policy for the purpose and
 * refuses an unavailable provider, naming what is missing, before construction.
 *
 * In presentation mode every adapter is SIMULATED: the chat's echoes the provider it
 * was opened for; the review's keep a presentation record of their own, with the
 * simulated send failures of `DSPATCH_REVIEW_PRESENTATION_SEND` read here and nowhere
 * else, so the main chat's adapter never meets them.
 */
const adapterFactory = providerAdapters({
  presentation: presentationMode,
  presentationChat: () => new PresentationAdapter(presentationAdapterOptions()),
  reviewPresentation: {
    sendMode: presentationMode
      ? (presentationSendMode(process.env['DSPATCH_REVIEW_PRESENTATION_SEND']) ?? 'ok')
      : 'ok',
    // DSP-152: a session start the provider refuses, with a SIMULATED error of its shape.
    ...(presentationMode && process.env['DSPATCH_REVIEW_SIM'] === 'start-fails'
      ? { startFailure: 'SIMULATED (DSPATCH_REVIEW_SIM=start-fails) UnknownAgentError: [plan_required] this agent is not available for this account.' }
      : {}),
    ...((): { deltaMs?: number } => {
      const parsed = Number.parseInt(process.env['DSPATCH_PRESENTATION_DELTA_MS'] ?? '', 10);
      return Number.isFinite(parsed) && parsed > 0 ? { deltaMs: parsed } : {};
    })(),
  },
  claudeAuthorizationReference: CLAUDE_AUTHORIZATION_REFERENCE,
  claudeInstalled: CLAUDE_SUPPORT.installed,
});

/** The main chat's adapter per provider, from the shared factory. */
function createChatAdapter(provider: StoredSessionProvider): ChatAdapter {
  return adapterFactory.createAdapter({ provider, purpose: 'chat' });
}

/**
 * The agent a loop run started now would use, and how (DSP-138).
 *
 * The one seam both run handlers go through - the graph editor's Run and the chat's
 * *Use loop* - so the provider is the explicit agent choice in both and nothing falls
 * back to Cursor. Adapters come from the shared factory with purpose `'loop'`, which in
 * presentation mode is the presentation adapter: a presentation window cannot reach a
 * provider by starting a run from either window (DSP-121 review B3). Every construction
 * is logged, as the chat's are.
 */
function loopRunRequest(input: {
  readonly rootCount: number;
  readonly entryNode?: Pick<LoopNode, 'id' | 'label' | 'model'>;
  readonly cursorModel: string;
}): LoopRunAgentRequest {
  return {
    ...input,
    // DSP-149: Claude's model is the person's choice, as in the chat.
    claudeModel: chatService.modelFor('claude'),
    claudeModels: chatService.knownModelIds('claude'),
    sessionProvider: chatService.openSession()?.provider ?? null,
    chosenAgent: chatService.chosenAgent(),
    adapters: {
      preflight: (request) => adapterFactory.preflight(request),
      createAdapter: (request) => {
        log(
          `[loop] building a ${request.provider} loop adapter` +
            `${presentationMode ? ' (presentation, simulated)' : ''}`,
        );
        return adapterFactory.createAdapter(request);
      },
    },
  };
}

/** The editor's Run: one generated folder, Cursor's live model, no node model read. */
function editorLoopRunRequest(
  entryNode: Pick<LoopNode, 'id' | 'label' | 'model'> | undefined,
): LoopRunAgentRequest {
  // The entry step goes in so the Claude model rule applies here as in *Use loop*
  // (DSP-138 review B2). A Cursor run is unchanged: it asks for `defaultLiveModel()`.
  return loopRunRequest({
    rootCount: 1,
    ...(entryNode === undefined ? {} : { entryNode }),
    cursorModel: defaultLiveModel(),
  });
}

/** The entry step a window named, checked field by field: it came from a renderer. */
function entryFromQuery(value: unknown): Pick<LoopNode, 'id' | 'label' | 'model'> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const entry = value as { id?: unknown; label?: unknown; model?: unknown };
  if (typeof entry.id !== 'string') {
    return undefined;
  }
  const model = entry.model as { policy?: unknown; model?: unknown } | undefined;
  const policy: LoopNode['model'] =
    model !== undefined &&
    model !== null &&
    (model.policy === 'inherit' || model.policy === 'fixed' || model.policy === 'described')
      ? {
          policy: model.policy,
          ...(typeof model.model === 'string' ? { model: model.model } : {}),
        }
      : undefined;
  return {
    id: entry.id,
    ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
    ...(policy === undefined ? {} : { model: policy }),
  };
}

/**
 * The chat's *Use loop*: every open folder, and the entry node's model as the run has
 * always taken it.
 */
function chatLoopRunRequest(
  rootCount: number,
  entryNode: LoopNode | undefined,
  sessionModel: string,
): LoopRunAgentRequest {
  return loopRunRequest({
    rootCount,
    ...(entryNode === undefined ? {} : { entryNode }),
    cursorModel: modelForChatNode(entryNode, sessionModel),
  });
}

/**
 * The "Runs with ..." line for a chat loop standing by: what *Use loop* would run this
 * drawing with now, by the same preparation the run makes. Constructs nothing.
 */
function chatLoopAgentInfo(graph: LoopGraph): LoopRunAgentInfo {
  const session = chatService.openSession();
  const rootCount =
    session === null
      ? 1
      : workingRootsFrom(openWorkspaceFolders(), session.workspacePath, pathsAreCaseInsensitive)
          .length;
  const entryNode = graph.nodes.find((node) => node.id === graph.entry);
  return loopRunAgentInfo(
    chatLoopRunRequest(rootCount, entryNode, session?.modelRequested ?? ''),
    graph.target,
  );
}
/**
 * The chat service owns the chat's adapter (Cursor, or Claude when this launch
 * enables it), in the project host.
 *
 * A window reaches it only through the client's channels, which forward to the
 * methods below. Nothing about the window changes that: `contextIsolation` stays on,
 * `nodeIntegration` stays off and the sandbox stays enabled.
 */
let chatService: ChatService;

function createChatService(): ChatService {
  return new ChatService({
  repoRoot: probeRepoRoot(),
  ownRepoRoot,
  send: (event) => {
    sendToMainWindow(AGENT_EVENT, event);
  },
  // DSP-147: agent work with no confirmed end that belongs to no conversation.
  uncertainWorkFile: path.join(userDataDir(), 'dspatch-uncertain-work.json'),
  // DSP-147: steering of a chat turn, on the loop's message channel.
  sendSteering: (payload) => {
    sendToMainWindow(LOOP_INSTRUCTION_EVENT, payload);
  },
  log: (message) => {
    log(`[chat] ${message}`);
  },
  conversations: () => requireConversationStore(),
  // DSP-149: which chat continues is decided by the workspace being opened and passed
  // with the request; without one, the most recent workspace of this first folder.
  conversationForProject: (projectPath) =>
    requireProjectStore().workspaceForPrimary(projectPath)?.lastConversationId ?? null,
  looseFolder: () => path.join(userDataDir(), 'conversation-without-workspace'),
  appTools: () => chatWorkspaceTools(),
  onTurnSettled: () => {
    openPendingWorkspace();
  },
  // DSP-136: every chat adapter construction is logged, so a run record can show that
  // none was built where no agent was chosen.
  createAdapter: (provider) => {
    log(`[chat] building a ${provider} chat adapter${presentationMode ? ' (presentation, simulated)' : ''}`);
    return createChatAdapter(provider);
  },
  claudeAuthorizationReference: CLAUDE_AUTHORIZATION_REFERENCE,
  claudeSupport: { installed: CLAUDE_SUPPORT.installed, reason: CLAUDE_SUPPORT.reason },
  agentChoiceStore: { read: () => agentChoiceStore.read(), write: (provider) => agentChoiceStore.write(provider) },
  modelChoice: modelChoiceStore,
  ...(chatRunMode && process.env['DSPATCH_FAIL_MODEL_LIST_ONCE'] === '1' ? { failFirstModelList: true } : {}),
  ...(presentationMode ? { readAuthStatus: presentationAuthStatus } : {}),
  });
}

let serviceDisposed = false;

/**
 * Remembered projects.
 *
 * One versioned file under Electron's `userData`, created on first use. It is
 * outside the repository and outside every project, so nothing DSpatch remembers
 * ends up in the user's git history.
 */
let projectStore: ProjectStore | null = null;

/**
 * DSP-149: the model chosen for each agent, in one small file under `userData`. No
 * file, an unreadable one or no entry means no choice for that agent. Written only by
 * an explicit choice; a write that fails is logged and costs the memory, not the turn.
 */
const modelChoiceStore = {
  file(): string {
    return path.join(userDataDir(), 'dspatch-model-choice.json');
  },
  readAll(): Partial<Record<StoredSessionProvider, string>> {
    try {
      const parsed = JSON.parse(fs.readFileSync(modelChoiceStore.file(), 'utf8')) as { models?: Record<string, unknown> };
      const models: Partial<Record<StoredSessionProvider, string>> = {};
      for (const provider of ['cursor', 'claude'] as const) {
        const value = parsed.models?.[provider];
        if (typeof value === 'string' && value !== '') {
          models[provider] = value;
        }
      }
      return models;
    } catch {
      return {};
    }
  },
  read(provider: StoredSessionProvider): string | null {
    return modelChoiceStore.readAll()[provider] ?? null;
  },
  write(provider: StoredSessionProvider, modelId: string | null): void {
    const models = { ...modelChoiceStore.readAll() };
    if (modelId === null) {
      delete models[provider];
    } else {
      models[provider] = modelId;
    }
    try {
      const file = modelChoiceStore.file();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ formatVersion: 1, models }, null, 2)}
`, 'utf8');
    } catch (error) {
      log(`[model] the choice could not be remembered: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

/**
 * DSP-136: the agent chosen explicitly in *Open a project*, kept in one small file
 * under `userData`. No file, or anything unreadable in it, means none chosen: a
 * fresh installation has no default agent. Written only by an explicit choice.
 */
const agentChoiceStore = {
  file(): string {
    return path.join(userDataDir(), 'dspatch-agent-choice.json');
  },
  read(): StoredSessionProvider | null {
    let text: string;
    try {
      text = fs.readFileSync(agentChoiceStore.file(), 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as { agent?: unknown };
      return parsed.agent === 'cursor' || parsed.agent === 'claude' ? parsed.agent : null;
    } catch {
      return null;
    }
  },
  write(provider: StoredSessionProvider): void {
    const file = agentChoiceStore.file();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify({ formatVersion: 1, agent: provider, chosenAtUtc: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(temporary, file);
  },
};

function requireProjectStore(): ProjectStore {
  projectStore ??= new ProjectStore(
    path.join(userDataDir(), 'dspatch-projects.json'),
  );
  return projectStore;
}

/* --------------------------------------------------------------------------- */
/* Workspaces: an identity, a name and folders (DSP-71, DSP-72, DSP-149)       */
/* --------------------------------------------------------------------------- */

/**
 * The open workspace.
 *
 * **A workspace is what a person opens** (DSP-149): a record in the project store with
 * a persistent identity, a name and one or more folders, the first being the primary —
 * the agent's working directory and the provider session's resume key. Its folders are
 * the open session's folders (`chatService.sessionFolders()`): every one of them is
 * given to the agent, in the chat and in loop runs, by each SDK's own multi-folder
 * mechanism. DSP-71's "one working folder and others shown beside it" and its
 * module-level list of extra folders are gone; there is one list, and it is the
 * workspace's.
 *
 * `null` while a conversation with no workspace is on screen, or nothing is open.
 */
let openWorkspaceId: string | null = null;

/**
 * The loop definition this workspace chose (DSP-68, DSP-71). Kept per workspace in the
 * store; at startup it is the most recently opened workspace's.
 */
let workspaceLoopDefinitionKey: string | null = null;

/**
 * A workspace the chat's own tools asked to open (DSP-149). Opened when the turn that
 * asked has ended: opening replaces the session the agent is answering in.
 */
let pendingWorkspaceOpen: string | null = null;

const pathsAreCaseInsensitive = process.platform === 'win32';

function openWorkspaceRecord(): WorkspaceRecord | null {
  return openWorkspaceId === null ? null : requireProjectStore().workspace(openWorkspaceId);
}

/** Every folder of the open workspace, the primary first; empty with none open. */
function openWorkspaceFolders(): readonly string[] {
  const session = chatService.openSession();
  if (session === null || session.origin === 'no-workspace') {
    return [];
  }
  const folders = chatService.sessionFolders();
  return folders.length === 0 ? [path.resolve(session.workspacePath)] : folders;
}

function currentWorkspaceView(problem: string | null = null): WorkspaceView {
  const folders = openWorkspaceFolders();
  const record = openWorkspaceRecord();
  return {
    id: record?.id ?? null,
    name: record?.name ?? (folders[0] === undefined ? null : folderDisplayName(folders[0])),
    folders: folders.map((folder, index) => ({
      path: folder,
      name: folderDisplayName(folder),
      working: index === 0,
    })),
    loopDefinitionKey: workspaceLoopDefinitionKey,
    filePath: record?.filePath ?? null,
    problem,
  };
}

/**
 * Tell the windows what the workspace is now.
 *
 * Pushed rather than polled because the menu and the chat's own tools can change it,
 * and neither is something the renderer can see.
 */
function announceWorkspace(problem: string | null = null): WorkspaceView {
  const view = currentWorkspaceView(problem);
  // Every window, not only the chat's: the view carries `loopDefinitionKey`, which the
  // editor reads to say which loop the next mandate walks (DSP-84).
  sendToEveryWindow(WORKSPACE_FOLDERS_CHANGED, view);
  return view;
}

/** Write a change to the open workspace. A failure costs the memory, not the work. */
function updateOpenWorkspace(patch: Parameters<ProjectStore['updateWorkspace']>[1]): void {
  if (openWorkspaceId === null) {
    return;
  }
  const outcome = requireProjectStore().updateWorkspace(openWorkspaceId, patch);
  if (outcome.problem !== null) {
    log(`[workspace] ${outcome.problem}`);
  }
}

/**
 * Record which loop this workspace chose, when the window says it has changed.
 *
 * Called from the three places a choice is made — the chooser beside the composer, the
 * file picker, and the editor's `Use this loop` — and from nowhere else, so a preview
 * that resolves the default does not silently write a choice nobody made.
 */
function noteChosenLoopDefinition(key: string | null): void {
  if (key === null || key === '' || key === workspaceLoopDefinitionKey) {
    return;
  }
  workspaceLoopDefinitionKey = key;
  updateOpenWorkspace({ loopDefinitionKey: key });
  announceWorkspace();
}

/**
 * Add folders to the open workspace (DSP-149): the menu's *Add Folder to Workspace…*
 * and the chat's `add_folders_to_workspace` both come here. Each folder gets the checks
 * an opened folder gets. The workspace remembers them, and the open session works in
 * them from its next message.
 */
function addFoldersToOpenWorkspace(
  chosen: readonly string[],
): { readonly folders: readonly string[] } | { readonly problem: string } {
  if (openWorkspaceRecord() === null) {
    return {
      problem:
        'No workspace is open, so there is nothing to add a folder to. Open a project first; ' +
        'the folder can then be added to its workspace.',
    };
  }
  let folders = openWorkspaceFolders();
  for (const folder of chosen) {
    let checked: string;
    try {
      checked = chatService.checkFolder(folder);
    } catch (error) {
      return { problem: error instanceof Error ? error.message : String(error) };
    }
    if (folders.some((open) => sameFolder(open, checked, pathsAreCaseInsensitive))) {
      continue;
    }
    folders = addFolderTo(folders, checked, pathsAreCaseInsensitive);
  }
  updateOpenWorkspace({ folders });
  chatService.setWorkingFolders(folders);
  announceWorkspace();
  return { folders };
}

/**
 * Add a folder chosen in the client's native chooser (DSP-111) or named by a scripted
 * trial.
 */
function addWorkspaceFolder(chosen: string): WorkspaceView {
  const resolved = path.resolve(chosen);
  if (openWorkspaceFolders().some((open) => sameFolder(open, resolved, pathsAreCaseInsensitive))) {
    return announceWorkspace(`${resolved} is already in this workspace.`);
  }
  const outcome = addFoldersToOpenWorkspace([resolved]);
  return 'problem' in outcome ? announceWorkspace(`${outcome.problem} Nothing was added.`) : currentWorkspaceView();
}

/**
 * Remove a folder from the workspace.
 *
 * **The link and nothing else** (DSP-71 #2): no file is deleted, no folder is touched,
 * no conversation is removed. The primary is refused: it is the working directory and
 * the conversation's resume key, and a workspace with another primary is another
 * workspace.
 */
function removeWorkspaceFolder(folderPath: string): WorkspaceView {
  const resolved = path.resolve(folderPath);
  const folders = openWorkspaceFolders();
  if (folders[0] !== undefined && sameFolder(folders[0], resolved, pathsAreCaseInsensitive)) {
    return announceWorkspace(
      `${resolved} is this workspace's primary folder, where the agent's commands start, so it ` +
        'was not removed. Nothing on disk was touched.',
    );
  }
  const remaining = removeFolderFrom(folders, resolved, pathsAreCaseInsensitive);
  if (remaining.length !== folders.length) {
    updateOpenWorkspace({ folders: remaining });
    chatService.setWorkingFolders(remaining);
  }
  return announceWorkspace();
}

/**
 * Open a workspace (DSP-149): one from Recent, or the workspace of a chosen first folder,
 * created with the folder's name when there is none.
 *
 * Every folder is checked before anything is closed; a primary that is missing refuses
 * the opening with the reason, here, when the person tries to open it — the list does
 * not carry standing warnings. Another folder that is missing is named, and the
 * workspace opens without it.
 *
 * A conversation begun without a workspace that has messages moves into the workspace
 * and continues there in a new provider session with DSpatch's recap (`carry`);
 * otherwise the workspace's own last chat continues, or a new one starts. Either way
 * nothing is sent and no work starts.
 */
async function openWorkspaceFor(request: WorkspaceOpenRequest): Promise<WorkspaceOpenOutcome> {
  const store = requireProjectStore();
  let record: WorkspaceRecord | null;
  let folders: readonly string[];
  if ('workspaceId' in request) {
    record = store.workspace(request.workspaceId);
    if (record === null) {
      return { kind: 'refused', problem: 'That workspace is no longer known to DSpatch. Nothing was opened.' };
    }
    folders = record.folders;
  } else {
    const resolved = path.resolve(request.folder);
    record = store.workspaceForPrimary(resolved);
    folders = record?.folders ?? [resolved];
  }
  const primary = folders[0];
  if (primary === undefined) {
    return { kind: 'refused', problem: 'This workspace has no folders. Nothing was opened.' };
  }
  try {
    chatService.checkFolder(primary);
  } catch (error) {
    return {
      kind: 'refused',
      problem:
        `${record === null ? 'The project' : `"${record.name}"`} could not be opened: ` +
        `${error instanceof Error ? error.message : String(error)} Nothing was closed or changed.`,
    };
  }
  const usable: string[] = [primary];
  const missing: string[] = [];
  for (const folder of folders.slice(1)) {
    try {
      usable.push(chatService.checkFolder(folder));
    } catch {
      missing.push(folder);
    }
  }
  // DSP-149: a folder with no workspace yet gets one only once it has opened, so a
  // refused or failed opening leaves nothing in Recent.
  const name = record?.name ?? folderDisplayName(primary);
  const carried = chatService.looseConversationWithMessages();
  const startRequest: StartSessionRequest =
    carried === null
      ? {
          kind: 'folder',
          path: primary,
          folders: usable.slice(1),
          conversationId: request.newChat === true || record === null ? null : record.lastConversationId,
          ...(request.provider === undefined ? {} : { provider: request.provider }),
        }
      : { kind: 'carry', path: primary, folders: usable.slice(1), conversationId: carried, workspaceName: name };
  const previousWorkspace = openWorkspaceId;
  openWorkspaceId = record?.id ?? null;
  let session: ChatSessionInfo;
  try {
    session = await chatService.startChatSession(startRequest);
  } catch (error) {
    // The chat service closes the earlier session before it opens the new one, so after
    // a failure no session is open, and no workspace is either.
    openWorkspaceId = chatService.openSession() === null ? null : previousWorkspace;
    announceWorkspace();
    return {
      kind: 'refused',
      problem: `"${name}" could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // The opening succeeded: this is what Recent records (DSP-149).
  if (record === null) {
    const created = store.openFolder(primary);
    if (created.problem !== null) {
      log(`[workspace] ${created.problem}`);
    }
    record = created.workspace;
    if (record === null) {
      announceWorkspace(created.problem);
      return { kind: 'refused', problem: created.problem ?? 'The workspace could not be recorded.' };
    }
    openWorkspaceId = record.id;
  } else {
    store.recordOpened(record.id);
  }
  updateOpenWorkspace({ lastConversationId: session.conversationId });
  if (carried !== null) {
    const outcome = store.setLooseConversation(null);
    if (outcome.problem !== null) {
      log(`[workspace] ${outcome.problem}`);
    }
  }
  if (record.loopDefinitionKey !== null) {
    workspaceLoopDefinitionKey = record.loopDefinitionKey;
  }
  log(
    `[workspace] opened "${record.name}" (${record.id}) with ${String(usable.length)} folder(s)` +
      `${carried === null ? '' : `; carried conversation ${carried} into it`}`,
  );
  const workspace = announceWorkspace(
    missing.length === 0
      ? null
      : `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not on this computer, so ` +
          `${missing.length === 1 ? 'it was' : 'they were'} left out this time. The workspace still lists ` +
          `${missing.length === 1 ? 'it' : 'them'}.`,
  );
  return { kind: 'opened', session, workspace };
}

/**
 * A conversation with no workspace (DSP-149): the one begun before, unless a new one is
 * asked for. It is remembered at once, so it survives a restart before any workspace
 * exists.
 */
async function openLooseConversation(request: Extract<StartSessionRequest, { kind: 'loose' }>): Promise<ChatSessionInfo> {
  const store = requireProjectStore();
  const conversationId = request.conversationId === undefined ? store.read().looseConversationId : request.conversationId;
  const session = await chatService.startChatSession({ ...request, conversationId });
  openWorkspaceId = null;
  const outcome = store.setLooseConversation(session.conversationId);
  if (outcome.problem !== null) {
    log(`[workspace] ${outcome.problem}`);
  }
  announceWorkspace();
  return session;
}

/** The chat's tools asked for a workspace to be opened; open it now the turn has ended. */
function openPendingWorkspace(): void {
  const id = pendingWorkspaceOpen;
  if (id === null) {
    return;
  }
  pendingWorkspaceOpen = null;
  void openWorkspaceFor({ workspaceId: id }).then(
    (outcome) => {
      sendToMainWindow(SESSION_REPLACED, outcome);
    },
    (error: unknown) => {
      sendToMainWindow(SESSION_REPLACED, {
        kind: 'refused',
        problem: `The workspace could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies WorkspaceOpenOutcome);
    },
  );
}

/** What the chat's workspace tools reach: the same functions as the menus (DSP-149). */
function chatWorkspaceTools(): readonly AppTool[] {
  return workspaceTools({
    recent: () =>
      requireProjectStore()
        .read()
        .workspaces.filter(inRecent)
        .map((record) => ({ id: record.id, name: record.name, folders: record.folders })),
    openWorkspace: () => {
      const record = openWorkspaceRecord();
      return record === null ? null : { id: record.id, name: record.name, folders: openWorkspaceFolders() };
    },
    checkFolder: (folder) => chatService.checkFolder(folder),
    createWorkspace: (name, folders) => {
      const outcome = requireProjectStore().createWorkspace({ name, folders, opened: false });
      if (outcome.workspace === null) {
        return { problem: outcome.problem ?? 'The workspace could not be recorded.' };
      }
      log(`[workspace] the chat created "${outcome.workspace.name}" (${outcome.workspace.id})`);
      return { id: outcome.workspace.id };
    },
    addFolders: (folders) => addFoldersToOpenWorkspace(folders),
    openWhenTurnEnds: (workspaceId) => {
      pendingWorkspaceOpen = workspaceId;
      log(`[workspace] the chat asked for ${workspaceId} to be opened when its turn ends`);
    },
  });
}

/**
 * Open a saved `.dspatch-workspace.json` (DSP-71): the workspace it describes, recorded
 * in the store and opened as any other.
 */
async function openWorkspace(target: string): Promise<WorkspaceView> {
  const resolved = path.resolve(target);
  let text: string;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    return announceWorkspace(
      `${resolved} could not be read, so nothing was opened: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const read = parseWorkspaceFile(text, resolved);
  if (!read.ok) {
    return announceWorkspace(read.problem);
  }
  const folders = read.workspace.folders.map((folder) => path.resolve(folder));
  const primary = folders[0];
  if (primary === undefined) {
    return announceWorkspace(`${resolved} lists no folders, so nothing was opened.`);
  }
  const store = requireProjectStore();
  const existing =
    store.read().workspaces.find((record) => record.filePath !== null && sameFolder(record.filePath, resolved, pathsAreCaseInsensitive)) ??
    null;
  const record = existing ?? store.createWorkspace({ name: folderDisplayName(primary), folders }).workspace;
  if (record === null) {
    return announceWorkspace('The workspace could not be recorded, so nothing was opened.');
  }
  store.updateWorkspace(record.id, { folders, filePath: resolved, loopDefinitionKey: read.workspace.loopDefinitionKey });
  const outcome = await openWorkspaceFor({ workspaceId: record.id });
  sendToMainWindow(SESSION_REPLACED, outcome);
  return outcome.kind === 'opened' ? outcome.workspace : announceWorkspace(outcome.problem);
}

/**
 * Write the open workspace's folders and chosen definition to a file. DSP-71 #5 is
 * `workspaceFileText`'s doing: there is no field in it for a run result.
 */
function saveWorkspace(target: string): WorkspaceView {
  const resolved = path.resolve(target);
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(
      resolved,
      workspaceFileText({ folders: openWorkspaceFolders(), loopDefinitionKey: workspaceLoopDefinitionKey }),
      'utf8',
    );
  } catch (error) {
    return announceWorkspace(
      `The workspace could not be saved to ${resolved}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  updateOpenWorkspace({ filePath: resolved });
  return announceWorkspace();
}

/**
 * What is restored at startup: the loop definition of the most recently opened
 * workspace, and nothing else. Opening a workspace is an act a person performs (or asks
 * the chat to perform); a window that had opened one before anyone asked would be the
 * interface deciding the work.
 */
function restoreRememberedWorkspace(): void {
  workspaceLoopDefinitionKey = requireProjectStore().read().workspaces[0]?.loopDefinitionKey ?? null;
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
    path.join(userDataDir(), 'conversations'),
    config().appVersion,
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
  runRecordStore ??= new RunRecordStore(path.join(userDataDir(), 'loop-runs'));
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
  return path.join(userDataDir(), 'loop-runs', runId, 'results');
}
/**
 * The sample projects DSpatch generated, as the window shows them (DSP-61).
 *
 * The note is written here rather than in the renderer because it is a statement
 * about what the host will and will not delete, and that is where the
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

/**
 * Recent projects (DSP-149): every workspace not removed from the list, most recently
 * opened first, after the project named at startup by `DSPATCH_PROJECT_PATH` when it is
 * not one of them. Whether each primary folder exists is read now; a missing one is
 * reported when someone tries to open it, not as a warning on the list.
 */
function recentWorkspaces(problem: string | null = null): RecentWorkspaces {
  const state = requireProjectStore().read();
  const exists = (folder: string): boolean => {
    try {
      return fs.statSync(folder).isDirectory();
    } catch {
      return false;
    }
  };
  const entries: RecentWorkspaceEntry[] = state.workspaces
    .filter(inRecent)
    .map((record) => ({
      id: record.id,
      name: record.name,
      folders: record.folders,
      lastOpenedAtUtc: record.lastOpenedAtUtc === '' ? null : record.lastOpenedAtUtc,
      primaryExists: exists(record.folders[0] ?? ''),
    }));
  if (startupProjectPath !== undefined && startupProjectPath.trim() !== '') {
    const resolved = path.resolve(startupProjectPath.trim());
    if (!entries.some((entry) => sameFolder(entry.folders[0] ?? '', resolved, pathsAreCaseInsensitive))) {
      entries.unshift({
        id: null,
        name: folderDisplayName(resolved),
        folders: [resolved],
        lastOpenedAtUtc: null,
        primaryExists: exists(resolved),
      });
    }
  }
  // The conversation begun without a workspace comes back only if it has something in it.
  const loose = state.looseConversationId;
  const looseHasMessages =
    loose !== null &&
    (requireConversationStore()
      .list()
      .entries.find((entry) => entry.conversationId === loose)?.messageCount ?? 0) > 0;
  return {
    entries,
    error: problem ?? state.error,
    readOnly: state.readOnly,
    looseConversationId: looseHasMessages ? loose : null,
  };
}

function environmentFacts(): HostEnvironmentFacts {
  return {
    // DSP-136: a reading of the open session's adapter, never a construction. At
    // startup no session is open, so this is null and no adapter exists.
    adapter: chatService.adapterInfo(),
    agentChoice: chatService.agentChoice(chatService.chosenAgent()),
    chosenAgent: chatService.chosenAgent(),
  };
}

async function disposeAdapterOnce(): Promise<void> {
  if (serviceDisposed) {
    return;
  }
  serviceDisposed = true;
  // The chat's adapter and every review discussion's, side by side, inside the one
  // bounded shutdown. A review answer still arriving is recorded as unknown.
  const results = await Promise.allSettled([
    chatService.dispose(),
    reviewDiscussions?.dispose() ?? Promise.resolve(),
    reviewAgentJobs?.dispose() ?? Promise.resolve(),
  ]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed !== undefined) {
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
  }
}
/**
 * The run audience's state: which run is walking, or standing ready, for a window that
 * has just opened. The windows themselves are the client's; this audience is one
 * listener that forwards every broadcast to the client's run audience (DSP-111).
 */
const runAudience = new LoopRunAudience();
runAudience.add({
  isDestroyed: () => false,
  send: (channel, payload) => {
    emitEvent({ kind: 'run-audience' }, channel, payload);
  },
});

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
/** The same directory, however it was spelled: resolved, and case-blind on Windows. */
function samePathSpelling(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * What one conversation file holds, read from disk by the project host.
 *
 * For the `workspace-switch` record: the Verifier compares these with what the DOM
 * showed, and the two must stay apart in the record because they are different
 * kinds of evidence. Everything here is read through the real store.
 */
interface ConversationFileObservation {
  readonly conversationId: string;
  readonly filePath: string;
  readonly projectPath: string | null;
  readonly savedAtUtc: string | null;
  readonly formatVersion: number | null;
  readonly messages: number | null;
  readonly attempts: readonly {
    readonly attemptId: string;
    readonly kind: string;
    readonly state: string;
    readonly acknowledgedAtUtc: string | null;
  }[];
  readonly testRuns: readonly { readonly attemptId: string | null; readonly verdict: string }[];
  readonly reviewedDiffFiles: readonly string[] | null;
  /**
   * The file's `session` block, verbatim (DSP-121): what the resume-choice record
   * compares before and after a refused resume, where it must not have changed.
   */
  readonly session: StoredSession | null;
  readonly error: string | null;
}

function observeConversationFiles(): readonly ConversationFileObservation[] {
  const store = requireConversationStore();
  return store.list().entries.map((entry) => {
    const read = store.read(entry.conversationId);
    const conversation = read.conversation;
    if (conversation === null) {
      return {
        conversationId: entry.conversationId,
        filePath: read.filePath,
        projectPath: null,
        savedAtUtc: null,
        formatVersion: null,
        messages: null,
        attempts: [],
        testRuns: [],
        reviewedDiffFiles: null,
        session: null,
        error: read.error ?? entry.error,
      };
    }
    const diff = conversation.reviewedDiff;
    return {
      conversationId: conversation.conversationId,
      filePath: read.filePath,
      projectPath: conversation.project.path,
      savedAtUtc: conversation.savedAtUtc,
      formatVersion: conversation.formatVersion,
      messages: conversation.messages.length,
      attempts: conversation.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        kind: attempt.kind,
        state: attempt.state,
        acknowledgedAtUtc: attempt.acknowledgedAtUtc,
      })),
      testRuns: conversation.testRuns.map((run) => ({
        attemptId: run.attemptId,
        verdict: run.verdict,
      })),
      reviewedDiffFiles:
        diff === null
          ? null
          : [...diff.changed, ...diff.added, ...diff.removed].map((file) => file.relPath),
      session: conversation.session,
      error: null,
    };
  });
}

/**
 * The resume-choice scenario's main-process timeline (DSP-121).
 *
 * One entry per session start the window asked for and per message it sent, taken
 * in the real IPC handlers as the request passes through: what the conversation
 * file's `session` block held on disk before and after, how the service described
 * the continuity afterwards, and what the presentation adapter had been asked by
 * then. The renderer's record says what the window showed; this says what was on
 * disk and what reached the adapter at the same moments, which is the half the
 * DOM cannot see - that the session ID stayed on record until a choice was made,
 * that nothing was sent, and that the one message sent later went without a recap.
 */
interface ResumeChoiceTimelineEntry {
  readonly event: 'start-session' | 'send';
  readonly request: string;
  readonly atUtc: string;
  readonly outcome: 'ok' | 'refused';
  readonly detail: string | null;
  readonly fileSessionBefore: StoredSession | null;
  readonly fileSessionAfter: StoredSession | null;
  readonly continuityAfter: {
    readonly kind: string;
    readonly providerSessionOpen: boolean;
    readonly resumeFailure: unknown;
  } | null;
  readonly resumeAttempts: number;
  readonly startSessionCalls: number;
  readonly sentCount: number;
  /**
   * A send's `acknowledgedAttemptIds` as they arrived over IPC (DSP-124): what the
   * window named when it sent, `null` for a session start.
   */
  readonly acknowledged: readonly AttemptAcknowledgement[] | null;
}

const resumeChoiceTimeline: ResumeChoiceTimelineEntry[] = [];

/** The `session` block of project A's conversation file, read from disk now. */
function resumeChoiceFileSession(): StoredSession | null {
  const projectA = (process.env['DSPATCH_CHAT_SWITCH_PROJECTS'] ?? '').split(';')[0]?.trim() ?? '';
  if (projectA === '') {
    return null;
  }
  const found = observeConversationFiles().find(
    (file) => file.projectPath !== null && samePathSpelling(file.projectPath, projectA),
  );
  return found?.session ?? null;
}

function recordResumeChoice(
  event: ResumeChoiceTimelineEntry['event'],
  request: string,
  before: StoredSession | null,
  outcome: ResumeChoiceTimelineEntry['outcome'],
  detail: string | null,
  acknowledged: readonly AttemptAcknowledgement[] | null = null,
): void {
  const continuity = chatService.sessionContinuity();
  const adapter = presentationResume.record();
  resumeChoiceTimeline.push({
    event,
    request,
    atUtc: new Date().toISOString(),
    outcome,
    detail,
    fileSessionBefore: before,
    fileSessionAfter: resumeChoiceFileSession(),
    continuityAfter:
      chatService.openSession() === null
        ? null
        : {
            kind: continuity.kind,
            providerSessionOpen: continuity.providerSessionOpen,
            resumeFailure: continuity.resumeFailure,
          },
    resumeAttempts: adapter.resumeAttempts.length,
    startSessionCalls: adapter.startSessionCalls,
    sentCount: adapter.sent.length,
    acknowledged,
  });
}

/**
 * What the host can say about the resume-choice run, checked here rather
 * than left for a reader: each line is one claim the DOM cannot make, with the
 * evidence it was judged on. A failed line turns the exit into 89, so the scenario
 * cannot pass on what the window showed while the disk or the adapter disagreed.
 */
function resumeChoiceChecks(
  report: ScriptedRunReport | null,
  /** What *Copy diagnostic info* recorded on the client instead of the clipboard. */
  scriptedClipboard: readonly string[],
): readonly { readonly check: string; readonly ok: boolean; readonly evidence: string }[] {
  const checks: { check: string; ok: boolean; evidence: string }[] = [];
  const claim = (check: string, ok: boolean, evidence: string): void => {
    checks.push({ check, ok, evidence });
  };
  const same = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);
  const mode = presentationResume.mode;
  const observations = report?.observations ?? {};
  const starts = resumeChoiceTimeline.filter((entry) => entry.event === 'start-session');
  const opened = starts[0];
  const seeded = opened?.fileSessionBefore ?? null;
  claim(
    'the first session start was the open of project A from Recent',
    opened !== undefined && opened.request === 'folder',
    `first start request: ${opened?.request ?? 'none'}`,
  );
  claim(
    'project A had a session on record before the open',
    seeded !== null,
    seeded === null ? 'no session block read' : `dspatchSessionId ${seeded.dspatchSessionId}`,
  );
  const expectedKind =
    mode === 'failed' ? 'resume-failed' : mode === 'ok' ? 'provider-session-resumed' : 'resume-refused';
  claim(
    mode === 'ok'
      ? `after the open the continuity was ${expectedKind}`
      : `after the open the continuity was ${expectedKind} with no provider session open`,
    opened?.continuityAfter?.kind === expectedKind &&
      (mode === 'ok' || opened?.continuityAfter?.providerSessionOpen === false),
    `kind ${opened?.continuityAfter?.kind ?? 'none'}, open ${String(opened?.continuityAfter?.providerSessionOpen ?? 'none')}`,
  );
  if (mode !== 'ok') {
    claim(
      'after the open the file session block was unchanged',
      opened !== undefined && same(opened.fileSessionAfter, seeded),
      `after: ${JSON.stringify(opened?.fileSessionAfter ?? null)}`,
    );
    claim(
      'the open made exactly one resume attempt, started no session and sent nothing',
      opened?.resumeAttempts === 1 && opened.startSessionCalls === 0 && opened.sentCount === 0,
      `attempts ${String(opened?.resumeAttempts)}, starts ${String(opened?.startSessionCalls)}, sent ${String(opened?.sentCount)}`,
    );
  }
  if (mode === 'failed') {
    const failure = opened?.continuityAfter?.resumeFailure as
      | { readonly kind?: unknown; readonly providerCode?: unknown }
      | null
      | undefined;
    claim(
      'the failure was recorded as an error with no provider code',
      failure?.kind === 'error' && failure.providerCode === null,
      JSON.stringify(failure ?? null),
    );
  }
  // DSP-121 flow: while no agent session is open the composer holds a message back,
  // so not even a send to be refused may reach the main process - the service's guard
  // is a back-stop now, not the route. A send is judged by the session start before it.
  const sendsWhileClosed = resumeChoiceTimeline.filter((entry, index) => {
    if (entry.event !== 'send') {
      return false;
    }
    const startBefore = resumeChoiceTimeline
      .slice(0, index)
      .filter((earlier) => earlier.event === 'start-session')
      .pop();
    return startBefore?.continuityAfter?.providerSessionOpen !== true;
  });
  const closedStarts = starts.filter((entry) => entry.continuityAfter?.providerSessionOpen === false);
  claim(
    'while no provider session was open, no send reached the main process and the adapter received nothing',
    sendsWhileClosed.length === 0 && closedStarts.every((entry) => entry.sentCount === 0),
    `${String(sendsWhileClosed.length)} send(s) while closed` +
      (sendsWhileClosed.length === 0
        ? ''
        : `: ${sendsWhileClosed.map((entry) => `${entry.outcome} ${entry.detail ?? entry.request}`).join(' | ')}`) +
      `; adapter sent count at each start that left no session open: ${
        closedStarts.map((entry) => String(entry.sentCount)).join(', ') || 'none'
      }`,
  );
  const retry = starts.find((entry) => entry.request === 'retry-resume');
  if (!chatRunHold && mode !== 'ok') {
    claim(
      'Try again was asked for and made a second resume attempt',
      retry !== undefined && retry.resumeAttempts === 2,
      `retry: ${retry === undefined ? 'none' : `attempts ${String(retry.resumeAttempts)}`}`,
    );
  }
  if (retry !== undefined) {
    if (mode === 'refused-once') {
      claim(
        'after Try again the session was resumed, with no session started and nothing sent',
        retry.continuityAfter?.kind === 'provider-session-resumed' &&
          retry.continuityAfter.providerSessionOpen === true &&
          retry.startSessionCalls === 0 &&
          retry.sentCount === 0 &&
          retry.fileSessionAfter?.dspatchSessionId === seeded?.dspatchSessionId,
        `kind ${retry.continuityAfter?.kind ?? 'none'}, starts ${String(retry.startSessionCalls)}, sent ${String(retry.sentCount)}, file id ${retry.fileSessionAfter?.dspatchSessionId ?? 'none'}`,
      );
    } else if (mode !== 'ok') {
      claim(
        'after Try again the file session block was still unchanged and nothing was sent',
        same(retry.fileSessionAfter, seeded) &&
          retry.sentCount === 0 &&
          retry.startSessionCalls === 0 &&
          retry.continuityAfter?.kind === expectedKind,
        `kind ${retry.continuityAfter?.kind ?? 'none'}, sent ${String(retry.sentCount)}, file after: ${JSON.stringify(retry.fileSessionAfter)}`,
      );
    }
  }
  // DSP-124, the ok phase: one press of Send anyway over an outcome-unknown turn. What
  // the window cannot see: that exactly one send reached this process, naming exactly
  // that attempt in this conversation; that the adapter received the draft alone; and
  // that the file keeps the attempt unresolved but acknowledged, beside the new turn.
  if (mode === 'ok') {
    const message = observations['messageSentAnyway'];
    const named = observations['sendAnywayAttemptNamed'];
    const sends = resumeChoiceTimeline.filter((entry) => entry.event === 'send');
    const projectA = (process.env['DSPATCH_CHAT_SWITCH_PROJECTS'] ?? '').split(';')[0]?.trim() ?? '';
    const fileA = observeConversationFiles().find(
      (file) => file.projectPath !== null && projectA !== '' && samePathSpelling(file.projectPath, projectA),
    );
    claim(
      'exactly one send reached the main process, accepted, carrying the draft',
      typeof message === 'string' &&
        sends.length === 1 &&
        sends[0]?.outcome === 'ok' &&
        sends[0].request === message,
      `${String(sends.length)} send(s): ${
        sends.map((entry) => `${entry.outcome} ${JSON.stringify(entry.request)}${entry.detail === null ? '' : ` (${entry.detail})`}`).join(' | ') || 'none'
      }; the window typed ${JSON.stringify(message ?? null)}`,
    );
    const acknowledged = sends[0]?.acknowledged ?? null;
    claim(
      'that send acknowledged exactly the named attempt, by conversation and attempt ID',
      typeof named === 'string' &&
        fileA !== undefined &&
        acknowledged !== null &&
        acknowledged.length === 1 &&
        typeof acknowledged[0] === 'object' &&
        acknowledged[0].attemptId === named &&
        acknowledged[0].conversationId === fileA.conversationId,
      `acknowledged ${JSON.stringify(acknowledged)}; named in the window ${JSON.stringify(named ?? null)}; A's conversation ${
        fileA?.conversationId ?? 'not found'
      }`,
    );
    const sent = presentationResume.record().sent;
    claim(
      'the adapter received exactly the draft, once, with nothing in front of it',
      typeof message === 'string' && sent.length === 1 && sent[0] === message,
      `adapter received ${JSON.stringify(sent)}`,
    );
    const seenAttempt = fileA?.attempts.find((attempt) => attempt.attemptId === named) ?? null;
    const turns = fileA?.attempts.filter((attempt) => attempt.kind === 'agent-turn') ?? [];
    const newest = turns[turns.length - 1] ?? null;
    claim(
      "the file keeps the named attempt unresolved but acknowledged, and records the new turn as its own attempt",
      seenAttempt !== null &&
        seenAttempt.kind === 'agent-turn' &&
        seenAttempt.state === 'outcome-unknown' &&
        seenAttempt.acknowledgedAtUtc !== null &&
        newest !== null &&
        newest.attemptId !== named &&
        newest.state === 'completed',
      `named attempt ${JSON.stringify(seenAttempt)}; newest agent-turn attempt ${JSON.stringify(newest)}`,
    );
    const last = resumeChoiceLastMessage();
    claim(
      "the conversation file's last message is the draft",
      last !== null && typeof message === 'string' && last.prompt === message && last.resentContext === null,
      `last message ${last === null ? 'none' : JSON.stringify(last.prompt)}`,
    );
  }
  // The refused and failed phases both choose a new session: refused removes the
  // summary before its one message, failed keeps it.
  if ((mode === 'refused' || mode === 'failed') && !chatRunHold) {
    const shownAtCopy = observations['diagnosticsShownAtCopy'];
    claim(
      'Copy diagnostic info recorded exactly the diagnostics the window showed, in the run record and not on the system clipboard',
      typeof shownAtCopy === 'string' &&
        shownAtCopy !== '' &&
        scriptedClipboard.length === 1 &&
        scriptedClipboard[0] === shownAtCopy,
      `${String(scriptedClipboard.length)} copy recorded; ${
        scriptedClipboard[0] === undefined ? 'none' : `${String(scriptedClipboard[0].length)} chars`
      }; shown ${typeof shownAtCopy === 'string' ? `${String(shownAtCopy.length)} chars` : 'nothing'}; equal ${String(
        scriptedClipboard[0] === shownAtCopy,
      )}`,
    );
    const fresh = starts.find((entry) => entry.request === 'new-provider-session');
    claim(
      'a new provider session was asked for and opened one, sending nothing',
      fresh !== undefined &&
        fresh.continuityAfter?.kind === 'new-provider-session' &&
        fresh.startSessionCalls === 1 &&
        fresh.sentCount === 0,
      fresh === undefined
        ? 'no new-provider-session request'
        : `kind ${fresh.continuityAfter?.kind ?? 'none'}, starts ${String(fresh.startSessionCalls)}, sent ${String(fresh.sentCount)}`,
    );
    claim(
      'the stored session was replaced only when the new session was chosen',
      fresh !== undefined &&
        seeded !== null &&
        same(fresh.fileSessionBefore, seeded) &&
        fresh.fileSessionAfter !== null &&
        fresh.fileSessionAfter.dspatchSessionId !== seeded.dspatchSessionId,
      `before the choice ${fresh?.fileSessionBefore?.dspatchSessionId ?? 'none'}, after it ${
        fresh?.fileSessionAfter?.dspatchSessionId ?? 'none'
      }, seeded ${seeded?.dspatchSessionId ?? 'none'}`,
    );
    // What reached the adapter, what the sent turn says went with it, and what the
    // conversation file saved with that message: three readings of one fact, which
    // must agree. The turn and the file can say it because the adapter emits
    // `run.started` inside `send`, while the service still holds the summary.
    const sent = presentationResume.record().sent;
    const message = observations['messageSentInNewSession'];
    const turnResent = observations['resentShownWithTurn'];
    const last = resumeChoiceLastMessage();
    const savedSummary = `the file's last message: prompt ${
      last === null ? 'none' : last.prompt === message ? 'equal to the message' : 'different'
    }, resentContext ${
      last === null || last.resentContext === null ? 'null' : `${String(last.resentContext.length)} chars`
    }; the sent turn shows ${
      typeof turnResent === 'string' ? `${String(turnResent.length)} chars of summary` : 'no summary'
    }`;
    if (mode === 'refused') {
      claim(
        'the summary was removed: exactly the one message reached the adapter with nothing in front of it, and neither the sent turn nor the saved message records a summary',
        typeof message === 'string' &&
          message !== '' &&
          sent.length === 1 &&
          sent[0] === message &&
          last !== null &&
          last.prompt === message &&
          last.resentContext === null &&
          turnResent === null,
        `window sent ${JSON.stringify(message ?? null)}; adapter received ${JSON.stringify(sent)}; ${savedSummary}`,
      );
    } else {
      const shown = observations['summaryShownBeforeSend'];
      const expected = typeof shown === 'string' && typeof message === 'string' ? `${shown}\n\n${message}` : null;
      claim(
        'the summary was kept: exactly one message reached the adapter, the summary as the disclosure showed it, a blank line, then the message',
        expected !== null && shown !== '' && sent.length === 1 && sent[0] === expected,
        `summary shown ${typeof shown === 'string' ? `${String(shown.length)} chars` : 'nothing'}; adapter received ${
          sent.map((text) => `${String(text.length)} chars`).join(', ') || 'nothing'
        }; equal to the summary, a blank line and the message: ${String(sent[0] === expected)}`,
      );
      claim(
        "the sent turn's resentContext is the summary the disclosure showed, and the saved message in the conversation file records it",
        typeof shown === 'string' &&
          shown !== '' &&
          turnResent === shown &&
          last !== null &&
          last.prompt === message &&
          last.resentContext === shown,
        `${savedSummary}; the turn's text equals the summary shown: ${String(turnResent === shown)}; the file's equals it: ${String(
          last?.resentContext === shown,
        )}`,
      );
    }
    const current = chatService.openSession();
    const fileNow = resumeChoiceFileSession();
    claim(
      'the file now holds the new session ID, which is not the seeded one',
      fileNow !== null &&
        seeded !== null &&
        fileNow.dspatchSessionId !== seeded.dspatchSessionId &&
        fileNow.dspatchSessionId === current?.dspatchSessionId,
      `file ${fileNow?.dspatchSessionId ?? 'none'}, seeded ${seeded?.dspatchSessionId ?? 'none'}, current ${current?.dspatchSessionId ?? 'none'}`,
    );
  }
  return checks;
}

/** The last message of project A's conversation file, read from disk now (DSP-121 flow). */
function resumeChoiceLastMessage(): { readonly prompt: string; readonly resentContext: string | null } | null {
  const projectA = (process.env['DSPATCH_CHAT_SWITCH_PROJECTS'] ?? '').split(';')[0]?.trim() ?? '';
  if (projectA === '') {
    return null;
  }
  const store = requireConversationStore();
  for (const entry of store.list().entries) {
    const conversation = store.read(entry.conversationId).conversation;
    if (conversation !== null && samePathSpelling(conversation.project.path, projectA)) {
      const last = conversation.messages[conversation.messages.length - 1];
      return last === undefined ? null : { prompt: last.prompt, resentContext: last.resentContext };
    }
  }
  return null;
}
/**
 * A host method, registered by name with the signature `ProjectHostMethods` gives it
 * (`shared/project-host-contract.ts`). The first argument is always the call's context:
 * which window asked, by the id the client gave it, so events about the work can go back
 * to that window as `event.sender.send` did in the main process.
 */
type HostMethod = (context: HostCallContext, ...args: never[]) => unknown;

const methods: Record<string, HostMethod> = {};

function handle<K extends ProjectHostMethodName>(
  name: K,
  method: (context: HostCallContext, ...args: HostArgs<K>) => HostAnswerOf<K> | Promise<HostAnswerOf<K>>,
): void {
  if (Object.prototype.hasOwnProperty.call(methods, name)) {
    throw new Error(`The host method ${name} is registered twice.`);
  }
  methods[name] = method as HostMethod;
}

/**
 * The loop editor's file access: read a graph, resolve its roles, write it back.
 *
 * Three handlers and no validation. `loop-graph-load.ts` has no Node imports and the
 * editor revalidates after every keystroke, so validation belongs in the window;
 * what only the host can do is touch the disk. Role resolution is here for
 * the same reason — `createFileRoleResolver` reads `.cursor/agents/*.md`, and a role
 * reference that resolves to nothing is a finding the author must see (DSP-22 #6).
 *
 * Every file chooser is the client's: a request that needs one (`pick`, *Open loop…*)
 * reaches this as the path the person chose.
 */
function registerLoopMethods(): void {
  const ownRoot = ownRepoRoot;

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

  handle(
    'loop.openGraph',
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
        // `pick` is answered by the client's chooser, which sends the path it chose.
        return { kind: 'cancelled' };
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

  handle(
    'loop.saveGraph',
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

  handle(
    'loop.resolveRoles',
    (_event, references: readonly RoleReference[]): readonly ResolvedRoleEntry[] =>
      roleEntries(references),
  );

  /**
   * Find a role's own file, for the client to show in the file manager, selected.
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
   * or read here; the client shows the folder and selects the file in it (a file
   * manager is the client's, and today it runs on the same machine as the host).
   */
  handle(
    'loop.locateRoleSource',
    (
      _event,
      request: { readonly root: string; readonly path: string },
    ): { readonly revealed: false; readonly note: string } | { readonly target: string } => {
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
      return { target };
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
   * DSP-147: the run's agent step whose turn is working, offered by the executor for
   * steering, with its label from the walked graph; `null` between steps.
   */
  let chatLoopSteerable: { readonly step: SteerableStep; readonly nodeLabel: string } | null = null;
  /**
   * DSP-147: the run's messages that have reached the work so far, by steering or at a
   * step's start, oldest first. Later steps are briefed with them, so a verifier judges
   * the work against the assignment as the person has since changed it.
   */
  let chatLoopGiven: string[] = [];
  /** DSP-147: what became of each steering message in this run, for its ending note. */
  let chatLoopSteered: { readonly text: string; readonly outcome: string }[] = [];
  /**
   * DSP-147: every message the person sent into this run, where it was sent and what
   * became of it, written on the run's ending so the conversation reads back in order.
   */
  let chatLoopMessages = new Map<string, RecordedRunMessage>();
  /** DSP-147: a loop run's agent work with no confirmed end, into the attempt ledger. */
  const recordUncertainLoopWork = (
    runId: string,
    steps: readonly { readonly sessionId: string; readonly nodeLabel: string }[],
    disposals: readonly DisposalRecord[],
  ): void => {
    for (const work of uncertainLoopWork(runId, steps, disposals)) {
      chatService.recordUncertainAgentWork(work.label, work.note);
    }
  };
  /** DSP-147: the window that started the run hears what happens to its messages. */
  let chatLoopInstructionEvents: ((payload: LoopInstructionEventPayload) => void) | null = null;

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
  handle(
    'loop.listDefinitions',
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
  /**
   * The judgement half of choosing (DSP-84, DSP-85): would this definition run? Records
   * nothing. The client asks this before it asks about an unsaved drawing, for the reason
   * `loop.chooseDefinition` gives.
   */
  function judgeDefinition(asked: string): { readonly key: string; readonly judged: ReturnType<typeof judgeChosenLoop> } {
    const key = path.resolve(asked);
    const discovery = discoverLoopDefinitions(loopFolders());
    // `rowForKey` and not a second reader: a definition from outside every folder
    // becomes the same row shape a discovered one has, which is why it can then be
    // chosen, listed and run by exactly the path a discovered one takes.
    const row = rowForKey(discovery.rows, key);
    return { key, judged: judgeChosenLoop(openChosenLoop(row), 'it was not chosen') };
  }

  handle(
    'loop.judgeDefinition',
    (_event, definitionPath: string): { readonly kind: 'refused'; readonly key: string; readonly note: string } | { readonly kind: 'runnable'; readonly key: string } => {
      const { key, judged } = judgeDefinition(definitionPath);
      if (!judged.runnable) {
        log(`loop definition refused at the point of choosing: ${key}`);
        return { kind: 'refused', key, note: judged.brief };
      }
      return { kind: 'runnable', key };
    },
  );

  /**
   * Select a definition for the next mandate. **It starts nothing.**
   *
   * DSP-84 added this because the editor's open path recorded nothing: a loop could be
   * drawn on the canvas and still be neither listed nor chosen. DSP-85 made it the only
   * way a loop is selected at all, and folded the file chooser into it: the editor's
   * **Open loop…** asks the client's chooser first and sends the file chosen here. The
   * two gestures share this method because they are one act with one outcome; a second
   * path that added a row without judging it, which is what `PICK_LOOP_DEFINITION` used
   * to do for the chat, is how a loop nobody could run became the selection.
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
   * is read beside a dropdown. The judgement is asked again here, because the file may
   * have changed while the person answered the client's question about an unsaved
   * drawing (DSP-88), which the client settles between `loop.judgeDefinition` and this.
   *
   * A run already walking is not consulted and not disturbed. It holds the definition
   * it started with (`ChosenLoop` is a value, not a lookup), so this can only be about
   * the next one — which is what the window is made to say.
   */
  handle(
    'loop.chooseDefinition',
    (
      _event,
      definitionPath: string,
      unsavedDrawing: 'save' | 'discard' | null,
    ): LoopDefinitionChooseOutcome => {
      const { key, judged } = judgeDefinition(definitionPath);
      if (!judged.runnable) {
        log(`loop definition refused at the point of choosing: ${key}`);
        return { kind: 'refused', key, note: judged.brief };
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
        unsavedDrawing,
      };
    },
  );

  /**
   * What `loop.startChatRun` would answer before it reads anything, and otherwise the
   * graph file it would read (DSP-86). A read: it starts, claims and records nothing.
   *
   * The client asks this first so that its question about an unsaved drawing in the
   * editor comes in the same place it always did: after the refusals a run gives
   * without reading the definition, and before the run starts. The run asks all of it
   * again when it starts.
   */
  handle(
    'loop.chatRunStartCheck',
    (_event, definitionKey: string | null | undefined): { readonly refused: ChatLoopRunOutcome } | { readonly graphPath: string } => {
      if (chatService.openSession() === null) {
        return {
          refused: {
            kind: 'refused',
            reason: 'Open a project first. Use loop walks the project already open in chat.',
          },
        };
      }
      if (ownRoot === null) {
        return {
          refused: {
            kind: 'failed',
            note:
              'DSpatch could not find its own working copy from where it is running, so it ' +
              'cannot offer its own loop definitions. A definition beside the open project ' +
              'would still run.',
          },
        };
      }
      const overlap = activeLoopRunRefusal();
      if (overlap !== null) {
        return { refused: { kind: 'failed', note: overlap } };
      }
      const choice = chooseLoop(definitionKey);
      return choice.ok ? { graphPath: choice.chosen.graphPath } : { refused: { kind: 'failed', note: choice.note } };
    },
  );

  /*
   * Open review (DSP-126). The input is read here, in the host, from the session the
   * chat service has open - not sent by the renderer - and it is only the folder: review
   * uses it as the chooser's start folder and to find the last review opened for that
   * repository. Nothing else of the chat goes to review, and nothing comes back. The
   * client opens the window with it.
   */
  handle('review.openContext', (): { readonly repository: string | null; readonly defaultProvider: StoredSessionProvider | null; readonly defaultModel: string } => {
    const session = chatService.openSession();
    // DSP-132: the main window's agent is the default for a new review discussion. It is
    // the agent a loop run would use too (`resolveLoopProvider`), so review opened from
    // the chat and from the loop editor starts from the same choice.
    const provider = resolveLoopProvider({ sessionProvider: session?.provider ?? null, chosenAgent: chatService.chosenAgent() });
    return {
      repository: session?.workspacePath ?? null,
      defaultProvider: provider,
      // DSP-152: the model that agent is asked for there; '' when none was chosen.
      defaultModel: provider === null ? '' : chatService.modelFor(provider),
    };
  });

  handle(
    'loop.startEditorRun',
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
      // No `connectedTargets`: a graph's target is a label of the drawing and does not
      // decide which agent runs it (DSP-138). It only ever produced a notice.
      const loaded = loadLoopGraph(request.text, {
        resolveRole: resolveEditorRole,
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

      // DSP-138: which agent, decided before the control is claimed. A refusal starts
      // nothing, claims nothing and constructs nothing.
      const agent = prepareLoopRun(
        editorLoopRunRequest(loaded.graph.nodes.find((node) => node.id === loaded.graph.entry)),
      );
      if (!agent.ok) {
        return { kind: 'refused', reason: agent.reason };
      }

      editorLoopAbort = new AbortController();
      const abort = editorLoopAbort;
      // DSP-147: what the run gave its agents, its stopped steps, and a refusal over
      // earlier agent work with no confirmed end, for the record and the answer.
      let editorRoots: string[] = [];
      const editorUnconfirmed: { readonly sessionId: string; readonly nodeLabel: string }[] = [];
      const editorAdapter: { current: { disposals?: () => readonly DisposalRecord[] } | null } = { current: null };
      let uncertainRefusal: readonly AttemptRef[] | null = null;
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
          // The provider actually used, from the preparation this run is walking with.
          agent: describeLoopRunAgent({
            provider: agent.provider,
            modelRequested: agent.modelRequested,
            drawnFor: loaded.graph.target,
          }),
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
          modelRequested: agent.modelRequested,
          keepWorkspace: true,
          // DSP-147: the editor's run works in a new folder of its own, which a workspace
          // containing it (the temp folder, a whole drive) still overlaps; so it takes the
          // same working-copy lock as every other run, for the folders it actually gives.
          //
          // And, as for every other agent work, not over earlier agent work with no
          // confirmed end in those folders until the person names it (`acknowledgedAttemptIds`).
          claimWorkingRoots: (paths) => {
            const gate = chatService.agentWorkGateFor(paths, request.acknowledgedAttemptIds ?? []);
            if (gate !== null) {
              uncertainRefusal = gate.acknowledgeable;
              return {
                ok: false,
                holder: { kind: 'agent-work', folders: paths, label: 'agent work with no confirmed end' },
                reason: gate.reason,
              };
            }
            editorRoots = [...paths];
            return WORKING_COPY_LOCK.claim({ kind: 'agent-work', folders: paths, label: 'a run from the graph editor' });
          },
          abortSignal: abort.signal,
          control: loopControl,
          // The chosen agent's adapter from the shared factory (DSP-138), which in
          // presentation mode is the presentation adapter: the same seam as the chat's
          // loop run, so the editor's Run builds no real adapter in it.
          provider: agent.provider,
          createAdapter: () => {
            const built = agent.createAdapter();
            editorAdapter.current = built as { disposals?: () => readonly DisposalRecord[] };
            return built;
          },
          // DSP-147: a step whose stop ended unconfirmed, for the record after the run.
          onAgentReply: (reply) => {
            if (reply.terminalEnd === 'unconfirmed') {
              editorUnconfirmed.push({ sessionId: reply.sessionId, nodeLabel: loaded.graph.nodes.find((node) => node.id === reply.nodeId)?.label ?? reply.nodeId });
            }
          },
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
        if (uncertainRefusal !== null) {
          // DSP-147: refused over agent work with no confirmed end; the editor offers to
          // name it and run anyway, as the chat's Send anyway does.
          return { kind: 'refused', reason: note, needsAcknowledgement: uncertainRefusal };
        }
        return { kind: 'failed', note };
      } finally {
        // DSP-147: the run having ended is not evidence that a stopped step's work did.
        // Recorded with this run and its folders unless `dispose` saw the process exit.
        for (const work of uncertainLoopWork(request.runId, editorUnconfirmed, editorAdapter.current?.disposals?.() ?? [])) {
          chatService.recordUncertainEditorWork(request.runId, editorRoots, `graph editor ${work.label}`, work.note);
        }
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
  handle('loop.currentRun', (): LiveRunAnnouncement | null => runAudience.current());
  // The same read with the run's progress folded in, for a graph view opening mid-step.
  handle('loop.currentRunView', () => runAudience.currentView());

  /**
   * Which agent the graph editor's Run would use now, as one line (DSP-138).
   *
   * **A read.** The same preparation the Run makes, without starting, recording or
   * constructing anything. `target` is the drawing's label, named when it differs.
   */
  handle('loop.readRunAgent', (_event, query: unknown): LoopRunAgentInfo => {
    const asked = (typeof query === 'object' && query !== null ? query : {}) as {
      target?: unknown;
      entry?: unknown;
    };
    const target = asked.target;
    const drawnFor: LoopTarget | null =
      target === 'cursor' || target === 'copilot' || target === 'claude-code' ? target : null;
    return loopRunAgentInfo(editorLoopRunRequest(entryFromQuery(asked.entry)), drawnFor);
  });

  /**
   * Pause, continue, and who decides the next step.
   *
   * All four go through the one `LoopRunController`, so the chat window and the graph
   * window cannot end up controlling different things or describing the same run
   * differently. Reading is a read: `READ_LOOP_CONTROL` starts nothing and repeats
   * nothing, and a window that opened halfway through a paused run gets the same
   * answer as the window that paused it.
   */
  handle('loop.requestPause', (): LoopControlOutcome => loopControl.requestPause());
  handle('loop.continue', (): LoopControlOutcome => loopControl.continueRun());
  handle('loop.setMode', (_event, mode: LoopMode): LoopControlOutcome => loopControl.setMode(mode));
  handle('loop.readControl', (): LoopControlReport => loopControl.report());

  handle('loop.cancelEditorRun', (): EditorLoopCancelOutcome => {
    if (editorLoopAbort === null) {
      return { cancelled: false, note: 'No loop run is in progress.' };
    }
    editorLoopAbort.abort();
    return {
      cancelled: true,
      note: 'Cancel requested. Completed steps are not replayed; the graph and workspace stay as they are.',
    };
  });

  handle(
    'loop.startChatRun',
    async (event, request: ChatLoopRunRequest): Promise<ChatLoopRunOutcome> => {
      // The window that pressed Send, which hears the transcript; the client delivers
      // to it only while it is alive, as `event.sender.isDestroyed()` guarded before.
      const sendToSender = (channel: BridgeChannel, payload: unknown): void => {
        if (event.senderId !== null) {
          sendToContents(event.senderId, channel, payload);
        }
      };
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
      const choice = chooseLoop(request.definitionKey);
      if (!choice.ok) {
        return { kind: 'failed', note: choice.note };
      }

      /*
       * **Unsaved edits are never run quietly, and never skipped quietly** (DSP-86).
       *
       * Settled by the client before this call (`loop.chatRunStartCheck` names the file
       * a run would read, and the question is the client's): *Cancel* never reaches
       * here, and *Save and run* has written the drawing before this read, so what walks
       * is what was just written rather than an older copy on disk.
       */

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
      // No `connectedTargets`: a graph's target is a label of the drawing and does not
      // decide which agent runs it (DSP-138).
      const loaded = loadLoopGraph(graphText, {
        resolveRole,
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
      // DSP-138: which agent and model, decided before the record is opened and the
      // control is claimed. A refusal opens no record, claims nothing and constructs
      // nothing. The session's provider first, as the shown line resolves it.
      const agent = prepareLoopRun(
        chatLoopRunRequest(workingRoots.length, entryNode, session.modelRequested),
      );
      if (!agent.ok) {
        return { kind: 'refused', reason: agent.reason };
      }
      const modelRequested = agent.modelRequested;
      // DSP-147: nor while earlier agent work here has no confirmed end and nobody has
      // named it (an unconfirmed stop of a turn or a loop step). The rule a message meets.
      const uncertain = chatService.uncertainAgentWorkRefusal();
      if (uncertain !== null) {
        return { kind: 'refused', reason: `${uncertain} The loop was not started.` };
      }
      // DSP-147: no loop run while the person's own command runs in a folder of this
      // run's. Before the record is opened, so a refusal leaves nothing behind.
      const workClaim = WORKING_COPY_LOCK.claim({
        kind: 'agent-work',
        folders: workingRoots.map((root) => root.path),
        label: 'a loop run',
      });
      if (!workClaim.ok) {
        return { kind: 'refused', reason: `${workClaim.reason} The loop was not started.` };
      }
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
        provider: agent.provider,
        appVersion: config().appVersion,
        startedAtUtc: new Date().toISOString(),
      });
      // Labels from the graph that is actually being walked, rather than the
      // window's own copy of them, so a reply is attributed to the node the run
      // entered even if the two ever drift apart.
      const lookup = lookupFromGraph(loaded.graph);

      chatLoopAbort = new AbortController();
      chatLoopRunId = request.runId;
      chatLoopGiven = [];
      chatLoopSteered = [];
      chatLoopMessages = new Map();
      chatLoopInstructionEvents = (payload) => {
        noteRunMessageEvent(chatLoopMessages, payload);
        sendToSender(LOOP_INSTRUCTION_EVENT, payload);
      };
      /**
       * DSP-147: steps whose stop ended unconfirmed, and the run's adapter, whose
       * `dispose` may yet see their local process exit. Read after the walk, before the
       * working-copy lock is released: the loop having ended is not evidence that they did.
       */
      const unconfirmedSteps: { readonly sessionId: string; readonly nodeLabel: string }[] = [];
      const runAdapter: { current: { disposals?: () => readonly DisposalRecord[] } | null } = { current: null };
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
        workClaim.release();
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
          // The provider actually used, from the preparation this run walks with.
          agent: describeLoopRunAgent({
            provider: agent.provider,
            modelRequested: agent.modelRequested,
            drawnFor: loaded.graph.target,
          }),
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
          // The chosen agent's adapter from the shared factory (DSP-138), built once by
          // the run and disposed by it. In presentation mode it is the presentation
          // adapter - the same seam the direct chat has had since DSP-1 - so a scripted
          // run walks a real loop in the real window with no provider call.
          provider: agent.provider,
          createAdapter: () => {
            const built = agent.createAdapter();
            runAdapter.current = built as { disposals?: () => readonly DisposalRecord[] };
            return built;
          },
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
            // DSP-147: what earlier steps were given, before anything new, so this step
            // works and judges against the assignment as it now stands.
            const earlier = earlierInstructionsContext(chatLoopGiven);
            const taken = chatLoopInstructions.takeFor(request.runId);
            if (taken.length === 0) {
              return `${earlier}${prompt}`;
            }
            chatLoopGiven = [...chatLoopGiven, ...taken.map((entry) => entry.text)];
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
            noteRunMessageEvent(chatLoopMessages, payload);
            sendToSender(LOOP_INSTRUCTION_EVENT, payload);
            return `${earlier}${instructionPreamble(taken.map((entry) => entry.text))}${prompt}`;
          },
          // DSP-147: the step that is working, for steering from the conversation.
          onSteerableStep: (step) => {
            chatLoopSteerable =
              step === null ? null : { step, nodeLabel: lookup.node(step.nodeId)?.label ?? step.nodeId };
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
            sendToSender(CHAT_LOOP_JOURNAL, entry);
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
            sendToSender(CHAT_LOOP_ACTIVITY, activity);
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
            if (reply.terminalEnd === 'unconfirmed') {
              unconfirmedSteps.push({ sessionId: reply.sessionId, nodeLabel });
            }
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
            sendToSender(CHAT_LOOP_REPLY, {
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
          undeliveredNote(chatLoopInstructions.peekFor(request.runId)) +
          steeredNote(chatLoopSteered);
        const cancelled = abort.signal.aborted;
        const recorded = closeChatLoopRecord(record, {
          kind: cancelled ? 'cancelled' : 'finished',
          result: delivery.result,
          inspection: delivery.inspection,
          note: workspaceNote,
          modelRequested,
          cancelled,
          messages: [...chatLoopMessages.values()],
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
          messages: [...chatLoopMessages.values()],
        });
        endedNote = `The loop could not be run: ${note}`;
        return { kind: 'failed', note };
      } finally {
        // The run's identity rather than the announcement's, for the reason the
        // editor handler's `finally` gives: this one now covers the claim too.
        chatLoopAbort = null;
        chatLoopRunId = null;
        chatLoopSteerable = null;
        // DSP-147: a step whose stop was unconfirmed is recorded as agent work with an
        // unknown outcome unless `dispose` then saw its process exit; so is a process
        // `dispose` itself could not see exit. That record, not this run's ending, decides
        // whether more work may start here. Then the run's own lock is released.
        recordUncertainLoopWork(request.runId, unconfirmedSteps, runAdapter.current?.disposals?.() ?? []);
        workClaim.release();
        // Every path out of the handler, including the throwing one, for the same
        // reason the control is released here: a message left in the queue after
        // its run has gone would sit on `pending` for ever, and §4.4 asks for the
        // opposite — *if no step receives it before the run ends, say so*. The
        // release also empties the queue, so it can never reach the next run.
        const undelivered = chatLoopInstructions.releaseRun(request.runId);
        sendToSender(LOOP_INSTRUCTION_EVENT, {
          kind: 'run-ended',
          runId: request.runId,
          undelivered: undelivered.map((entry) => entry.id),
        } satisfies LoopInstructionEventPayload);
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

  handle(
    'loop.listRunRecords',
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
  handle(
    'loop.addInstruction',
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
      chatLoopMessages.set(entry.id, {
        id: entry.id,
        text,
        receivedAtUtc: entry.receivedAtUtc,
        anchor: request.anchor ?? null,
        outcome: 'not-delivered',
        delivery: null,
      });
      const received: AddLoopInstructionOutcome = {
        kind: 'received',
        instructionId: entry.id,
        receivedAtUtc: entry.receivedAtUtc,
        waiting: chatLoopInstructions.peekFor(request.runId).length,
      };
      // DSP-147: into the step that is working, through its runtime's own steering, where
      // it has it. Withdrawn from the queue while offered, so the next step's prompt
      // cannot take it as well; put back only if the runtime never took it.
      const target = chatLoopSteerable;
      const emit = chatLoopInstructionEvents;
      const steer = target?.step.steer;
      if (target === null || steer === undefined) {
        emit?.({ kind: 'waiting', runId: request.runId, instructionIds: [entry.id], waitingFor: 'next-step' });
        return received;
      }
      chatLoopInstructions.withdraw(entry.id);
      let accepted = false;
      const runId = request.runId;
      const ids = [entry.id];
      void steer(text, (update) => {
        if (update.state === 'accepted' && !accepted) {
          accepted = true;
          emit?.({ kind: 'accepted', runId, instructionIds: ids });
        }
      })
        .then((final) => {
          const sameRun = chatLoopRunId === runId;
          if (final.state === 'delivered') {
            if (sameRun) {
              chatLoopGiven = [...chatLoopGiven, text];
              chatLoopSteered = [...chatLoopSteered, { text, outcome: `delivered to “${target.nodeLabel}” by the runtime’s steering` }];
            }
            emit?.({
              kind: 'delivered',
              runId,
              instructionIds: ids,
              nodeId: target.step.nodeId,
              nodeLabel: target.nodeLabel,
              occurrence: target.step.occurrence,
              atUtc: new Date().toISOString(),
              during: true,
            });
            return;
          }
          if (accepted || final.reason === 'failed') {
            // The runtime had it; it may have reached the agent, so it is never handed
            // over again. Later steps are still briefed with it, without a claim of receipt.
            if (sameRun) {
              chatLoopGiven = [...chatLoopGiven, text];
              chatLoopSteered = [...chatLoopSteered, { text, outcome: `delivery to “${target.nodeLabel}” not confirmed` }];
            }
            emit?.({ kind: 'unconfirmed', runId, instructionIds: ids });
            return;
          }
          if (sameRun) {
            // Never reached the runtime: the next step gets it, as before steering existed.
            chatLoopInstructions.restore(entry);
            emit?.({ kind: 'waiting', runId, instructionIds: ids, waitingFor: 'next-step' });
            return;
          }
          emit?.({ kind: 'not-delivered', runId, instructionIds: ids });
        })
        .catch(() => {
          if (chatLoopRunId === runId && !accepted) {
            chatLoopInstructions.restore(entry);
            emit?.({ kind: 'waiting', runId, instructionIds: ids, waitingFor: 'next-step' });
          } else {
            emit?.({ kind: accepted ? 'unconfirmed' : 'not-delivered', runId, instructionIds: ids });
          }
        });
      return received;
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
        // DSP-138: which agent *Use loop* would run this with now, or why it would not.
        agent: chatLoopAgentInfo(judged.graph).line,
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
  handle(
    'loop.prepareChatLoop',
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

  handle('loop.cancelChatRun', (): ChatLoopCancelOutcome => {
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
 * DSP-147: the run's steering messages and what became of each, on the ending note, so
 * the record keeps a message the runtime took into a running step (which no prompt
 * holds) beside the prompts that hold the ones given at a step's start. `''` when there
 * were none, so a run without steering keeps its note byte for byte.
 */
/** DSP-147: what an event about the run's messages settles about each, for its record. */
function noteRunMessageEvent(
  messages: Map<string, RecordedRunMessage>,
  payload: LoopInstructionEventPayload,
): void {
  if (!('instructionIds' in payload)) {
    return;
  }
  for (const id of payload.instructionIds) {
    const known = messages.get(id);
    if (known === undefined || known.outcome === 'delivered') {
      continue;
    }
    if (payload.kind === 'delivered') {
      messages.set(id, {
        ...known,
        outcome: 'delivered',
        delivery: {
          nodeId: payload.nodeId,
          nodeLabel: payload.nodeLabel,
          occurrence: payload.occurrence,
          atUtc: payload.atUtc,
          ...(payload.during === true ? { during: true } : {}),
        },
      });
    } else if (payload.kind === 'unconfirmed') {
      messages.set(id, { ...known, outcome: 'unconfirmed' });
    }
  }
}

function steeredNote(steered: readonly { readonly text: string; readonly outcome: string }[]): string {
  if (steered.length === 0) {
    return '';
  }
  return ` Steering sent while steps worked: ${steered
    .map((entry) => `“${entry.text}” (${entry.outcome})`)
    .join('; ')}.`;
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
    readonly messages?: readonly RecordedRunMessage[];
  },
): ChatLoopRecordInfo {
  const atUtc = new Date().toISOString();
  // No clock reading passed in: each command carries the moment it really started, so
  // these copies inside the ending line say the same thing as the lines written while
  // the run was still walking. DSP-145: each agent's command says whether the run ended
  // on the code it left.
  const commands: readonly RecordedCommand[] =
    input.inspection === null ? [] : recordedCommandsAtEnd(input.inspection);
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
    ...(input.messages === undefined || input.messages.length === 0 ? {} : { messages: input.messages }),
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

/* --------------------------------------------------------------------------- */
/* Review: the review host and the review discussions                          */
/* --------------------------------------------------------------------------- */

/**
 * The review host (DSP-111): repository access at the identified commits and the
 * review records. Its own contract, `ReviewHostApi`, is served here method for method
 * under `review.<method>`; the client's review windows reach it through the same
 * contract, bound to this process instead of in-process.
 */
let reviewHost: ReviewHost | null = null;

/**
 * The review discussions (DSP-127): one per review, each with an adapter of its own,
 * created on the first question and closed with its last window or at quit. In
 * presentation mode the adapters are presentation adapters with their own record,
 * never the chat's `presentationResume`.
 */
let reviewDiscussions: ReviewDiscussions | null = null;
/** Reviews of a chosen revision pair (DSP-150): the log, the diff and the decisions. */
let reviewPairs: ReviewPairs | null = null;
/** Walk preparation and delegated review over a revision pair (DSP-152). */
let reviewAgentJobs: ReviewAgentJobs | null = null;

function requireReviewAgentJobs(): ReviewAgentJobs {
  if (reviewAgentJobs === null) {
    throw new Error('Review is not ready in the host yet.');
  }
  return reviewAgentJobs;
}

/** The pair as a window opens it, with jobs the last host left running settled first. */
function reconciled<T>(answer: T): T {
  const key = typeof answer === 'object' && answer !== null ? (answer as { key?: unknown }).key : undefined;
  if (typeof key === 'string' && reviewAgentJobs !== null) {
    reviewAgentJobs.reconcile(key);
    const state = requireReviewPairs().state(key);
    if (typeof state === 'object' && state !== null && !('error' in state)) {
      return { ...answer, record: state } as T;
    }
  }
  return answer;
}

/** Where the definitions with no walks that carry a review's discussion are written. */
function discussionDefinitionsDir(): string {
  return path.join(userDataDir(), 'reviews', 'discussion');
}

/** A definition written only to carry a review's discussion before any walk; never walks. */
function isDiscussionDefinition(definition: string): boolean {
  const resolved = path.resolve(definition);
  return path.dirname(resolved).toLowerCase() === path.resolve(discussionDefinitionsDir()).toLowerCase() || path.basename(resolved).toLowerCase() === 'discussion.review.json';
}

/** Walk definitions prepared for one pair (DSP-152), newest first. */
function generatedWalkDefinitions(key: unknown): readonly string[] {
  if (typeof key !== 'string' || !/^[0-9a-f]{24}$/.test(key)) {
    return [];
  }
  const folder = path.join(userDataDir(), 'reviews', 'generated', key);
  try {
    return fs
      .readdirSync(folder)
      .filter((name) => name.endsWith('.review.json'))
      .map((name) => path.join(folder, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

function requireReviewPairs(): ReviewPairs {
  if (reviewPairs === null) {
    throw new Error('Review is not ready in the host yet.');
  }
  return reviewPairs;
}

/** The walk definitions the host knows of: the bundled example and every one opened before. */
async function knownWalkDefinitions(also: readonly string[]): Promise<readonly string[]> {
  const out: string[] = [...also];
  const example = locateExampleReview(ownRepoRoot);
  if (example.kind === 'found') {
    out.push(example.definitionPath);
  }
  const recent = await requireReviewHost().recentIndex();
  const index = 'index' in recent ? recent.index : null;
  const repositories =
    typeof index === 'object' && index !== null ? (index as { repositories?: unknown }).repositories : undefined;
  if (typeof repositories === 'object' && repositories !== null) {
    for (const entry of Object.values(repositories as Record<string, unknown>)) {
      const definition = typeof entry === 'object' && entry !== null ? (entry as { definitionPath?: unknown }).definitionPath : undefined;
      if (typeof definition === 'string') {
        out.push(definition);
      }
    }
  }
  return out;
}

function requireReviewHost(): ReviewHost {
  if (reviewHost === null) {
    throw new Error("DSpatch's project host has not been started.");
  }
  return reviewHost;
}

function requireReviewDiscussions(): ReviewDiscussions {
  if (reviewDiscussions === null) {
    throw new Error("DSpatch's project host has not been started.");
  }
  return reviewDiscussions;
}

/** The review discussion's context, built on the host in this window's review session. */
function envelopeSourceFor(sessionId: string): EnvelopeSource {
  return {
    envelopeFor: async (request) => {
      const answer = await requireReviewHost().envelopeFor({ sessionId, request });
      return isReviewHostError(answer) ? { kind: 'refused', error: answer.message } : answer;
    },
  };
}

/**
 * The discussion of the review this window shows, with the window bound as its event
 * target. A window that comes back while an answer is still arriving is rebound here.
 */
/**
 * One discussion per repository and revision pair (Niclas's decision of 30 October 2026): a
 * walk window and the diff window over the same pair reach the same discussion, whatever
 * walk the walk window shows. The pair's key is the one its review record has.
 */
function pairDiscussionIdentity(identity: DiscussionIdentity): DiscussionIdentity {
  const pair = { repository: identity.repository, base: identity.base, target: identity.target };
  return { key: pairKeyOf(pair), ...pair, definitionPath: '' };
}

/** Where a window's question gets its context: a walk's review, or the diff's revision pair. */
function envelopeSourceOf(target: DiscussionTarget): EnvelopeSource {
  return target.identity.definitionPath === ''
    ? pairEnvelopeSource(requireReviewPairs(), pairDiscussionIdentity(target.identity).key)
    : envelopeSourceFor(target.sessionId);
}

function discussionOf(target: DiscussionTarget): ReviewDiscussionService {
  const targetId = target.targetId;
  return requireReviewDiscussions().attach(
    targetId,
    pairDiscussionIdentity(target.identity),
    (payload) => {
      sendToContents(targetId, REVIEW_DISCUSSION_CHANNELS.event, payload);
    },
    target.defaultProvider,
  );
}

function registerReviewMethods(): void {
  const host = requireReviewHost();
  for (const method of REVIEW_HOST_METHODS) {
    const call = host[method] as (request?: unknown) => Promise<unknown>;
    // The review host's own contract, method for method; its answers are already plain.
    methods[`review.${method}`] = (_context: HostCallContext, request?: unknown) => call.call(host, request);
  }
  /*
   * *Open example review* (DSP-129): the bundled DSP-116 walk from this DSpatch's own
   * clone. The definition is located here, where the clone is read; the client opens
   * the window with it. Outside a clone it names nothing and says why.
   */
  handle('review.exampleDefinition', () => locateExampleReview(ownRepoRoot));

  /*
   * Review of a chosen revision pair (DSP-150). The repositories are those of the open
   * session's folders, found here; the windows name a repository only from that list,
   * and every read is at one of two named commits.
   */
  handle('reviewPair.repositories', () => requireReviewPairs().repositories(chatService.sessionFolders()));
  handle('reviewPair.log', async (_event, repository: unknown, skip: unknown) => {
    const pairs = requireReviewPairs();
    const page = await pairs.log(repository, skip);
    return 'error' in page ? page : { ...page, last: pairs.lastPair(repository) };
  });
  // A scripted run can hold Git's answer back (DSPATCH_PAIR_DIRECTION_DELAY_MS, presentation
  // mode only), so that a newer choice is made while an older answer is on its way.
  const directionDelayMs = presentationMode ? Number.parseInt(process.env['DSPATCH_PAIR_DIRECTION_DELAY_MS'] ?? '', 10) : Number.NaN;
  handle('reviewPair.direction', async (_event, repository: unknown, first: unknown, second: unknown) => {
    const answer = await requireReviewPairs().direction(repository, first, second);
    if (Number.isFinite(directionDelayMs) && directionDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, directionDelayMs));
    }
    return answer;
  });
  handle('reviewPair.open', async (_event, request: unknown) => reconciled(await requireReviewPairs().openPair(request)));
  handle('reviewPair.openForWalk', async (_event, pair) => reconciled(await requireReviewPairs().openForWalk(pair)));
  handle('reviewPair.readFile', (_event, key: unknown, side: unknown, filePath: unknown) =>
    requireReviewPairs().readFile(key, side, filePath),
  );
  handle('reviewPair.state', (_event, key: unknown) => requireReviewPairs().state(key));
  handle('reviewPair.mark', (_event, key: unknown, request: unknown) => requireReviewPairs().mark(key, request));
  handle('reviewPair.savePosition', (_event, key: unknown, position: unknown) =>
    requireReviewPairs().savePosition(key, position),
  );
  // The definition that carries a review's discussion before any walk is never offered as walks.
  const walksOver = async (key: unknown, also: unknown): Promise<ReturnType<ReviewPairs['walksFor']>> =>
    requireReviewPairs().walksFor(
      key,
      [
        ...generatedWalkDefinitions(key),
        ...(await knownWalkDefinitions(Array.isArray(also) ? also.filter((entry): entry is string => typeof entry === 'string') : [])),
      ].filter((definition) => !isDiscussionDefinition(definition)),
    );
  handle('reviewPair.walks', (_event, key: unknown, also: unknown) => walksOver(key, also));
  // *Code walks* opens the walk last opened from this review, else the newest prepared one.
  handle('reviewPair.walkToOpen', async (_event, key: unknown, also: unknown) => {
    const walks = await walksOver(key, also);
    return 'error' in walks ? walks : { definitionPath: requireReviewPairs().walkToOpen(key, walks) };
  });
  /*
   * The review's panel carries its one discussion (Niclas's decision of 30 October 2026).
   * Before any walk is prepared it opens over a definition of the pair with no walks, written
   * once in a folder of its own and never offered as walks; walks prepared later take over.
   */
  handle('reviewPair.discussionWalk', (_event, key: unknown) => {
    const open = typeof key === 'string' ? requireReviewPairs().opened(key) : null;
    if (open === null || typeof key !== 'string') {
      return { error: 'That review is not open.' };
    }
    const file = path.join(discussionDefinitionsDir(), `${key}.review.json`);
    if (!fs.existsSync(file)) {
      const heading = `Discussion · ${open.repositoryName} ${open.pair.base.slice(0, 7)}→${open.pair.target.slice(0, 7)}`;
      const provenance = 'No code walks yet: the review\'s discussion is here. Walks prepared later open in this window, and the discussion goes on.';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(definitionFrom({ overview: '', background: '', attention: [], checks: [], walks: [] }, open.pair, heading, provenance), null, 2)}\n`, 'utf8');
    }
    return { definitionPath: file };
  });
  handle('reviewPair.walkOpened', (_event, key: unknown, definitionPath: unknown) => {
    requireReviewPairs().walkOpened(key, definitionPath);
    return { saved: true };
  });
  // The way into review lists the reviews not ended; ending one approves nothing.
  handle('reviewPair.ongoing', () => requireReviewPairs().ongoing());
  handle('reviewPair.end', (_event, pair: unknown) => requireReviewPairs().end(pair));
  // DSP-152: preparing walks and delegated review, started only by an explicit request.
  handle('reviewPair.agents', (_event, key: unknown, opener: unknown) => requireReviewAgentJobs().agents(key, opener));
  handle('reviewPair.startJob', (_event, key: unknown, request: unknown) => {
    // DSP-152: a request that fails in the host before it is answered, as a trial needs it.
    if (presentationMode && process.env['DSPATCH_REVIEW_SIM'] === 'start-throws') {
      throw new Error('SIMULATED (DSPATCH_REVIEW_SIM=start-throws): the host could not take the request.');
    }
    return requireReviewAgentJobs().request(key, request);
  });
  handle('reviewPair.cancelJob', (_event, key: unknown, jobId: unknown) => requireReviewAgentJobs().cancel(key, jobId));

  handle('discussion.load', (_event, target: DiscussionTarget, request: unknown) =>
    discussionOf(target).load(
      typeof request === 'object' && request !== null ? (request as never) : null,
      envelopeSourceOf(target),
    ),
  );
  handle('discussion.send', (_event, target: DiscussionTarget, input: unknown) =>
    discussionOf(target).send(input, envelopeSourceOf(target)),
  );
  handle('discussion.cancel', (_event, target: DiscussionTarget) => discussionOf(target).cancel());
  handle('discussion.acknowledge', (_event, target: DiscussionTarget, attemptIds: unknown) =>
    discussionOf(target).acknowledge(attemptIds),
  );
  handle('discussion.draft', (_event, target: DiscussionTarget, text: unknown) => discussionOf(target).saveDraft(text, target.targetId));
  handle('discussion.quote', (_event, target: DiscussionTarget, quote: unknown) => {
    discussionOf(target).setQuote(quote, target.targetId);
  });
  // DSP-132: choosing the agent records it and builds nothing.
  handle('discussion.chooseAgent', (_event, target: DiscussionTarget, provider: unknown) =>
    discussionOf(target).chooseAgent(provider),
  );
  handle('discussion.recap', (_event, target: DiscussionTarget, leftOut: unknown) =>
    discussionOf(target).setRecapLeftOut(leftOut),
  );
  /** A review window has gone: its renderer no longer hears any discussion. */
  handle('discussion.detach', (_event, targetId: number) => {
    requireReviewDiscussions().detach(targetId);
  });
}

/* --------------------------------------------------------------------------- */
/* The chat, projects, conversations and the workspace                         */
/* --------------------------------------------------------------------------- */

function registerCoreMethods(): void {
  handle('chat.environment', (): HostEnvironmentFacts => environmentFacts());
  handle('chat.getConnection', () => chatService.getConnection());

  /**
   * The model the next ordinary message is sent to (DSP-60 #3).
   *
   * Returns what is actually in force rather than what was asked for, so the
   * window states a fact instead of echoing its own request.
   */
  handle('chat.listModels', (_event, provider: unknown): Promise<ModelListing> => {
    if (provider !== 'cursor' && provider !== 'claude') {
      throw new Error('Unknown agent.');
    }
    return chatService.listModels(provider);
  });
  handle('chat.chooseModel', (_event, provider: unknown, modelId: unknown): string => {
    if ((provider !== 'cursor' && provider !== 'claude') || typeof modelId !== 'string') {
      throw new Error('Unknown agent or model.');
    }
    return chatService.setModelFor(provider, modelId);
  });
  handle('chat.setModel', (_event, modelId: string): string => {
    const inForce = chatService.setRequestedModel(modelId);
    log(`model requested for the next message: ${inForce}`);
    return inForce;
  });

  // DSP-136: an explicit agent choice in *Open a project*. Recorded only; nothing is
  // built and no provider is asked.
  handle('chat.chooseAgent', (_event, provider: unknown): StoredSessionProvider | null => {
    if (provider !== 'cursor' && provider !== 'claude') {
      throw new Error('Unknown agent.');
    }
    const chosen = chatService.chooseAgent(provider);
    log(`agent chosen: ${provider}`);
    return chosen;
  });

  handle('workspaces.recent', (): RecentWorkspaces => recentWorkspaces());

  /**
   * Remove from recent (DSP-149): the list entries and nothing else. No folder is
   * touched, no conversation is removed, and each workspace keeps its name and folders.
   */
  handle('workspaces.removeFromRecent', (_event, workspaceIds: readonly string[]): RecentWorkspaces => {
    const ids = Array.isArray(workspaceIds) ? workspaceIds.filter((id) => typeof id === 'string') : [];
    const outcome = requireProjectStore().removeFromRecent(ids);
    log(`[workspace] removed ${String(ids.length)} from Recent${outcome.problem === null ? '' : `: ${outcome.problem}`}`);
    return recentWorkspaces(outcome.problem);
  });

  handle('workspaces.open', async (_event, request: WorkspaceOpenRequest) => {
    // The resume-choice record's host half (DSP-121): opening from Recent is a session
    // start like any other, so the file's session block is read before and after it.
    const fileSessionBefore = chatRunScenario === 'resume-choice' ? resumeChoiceFileSession() : null;
    const outcome = await openWorkspaceFor(request);
    if (chatRunScenario === 'resume-choice') {
      recordResumeChoice(
        'start-session',
        'folder',
        fileSessionBefore,
        outcome.kind === 'opened' ? 'ok' : 'refused',
        outcome.kind === 'opened' ? null : outcome.problem,
      );
    }
    return outcome;
  });

  /**
   * What DSpatch has left behind in its own sample location (DSP-61).
   *
   * Reads only. A new session generates into a folder of its own, so nothing here
   * is on any session's path — this exists for a person who wants the space back.
   */
  handle('samples.list', (): SampleProjectsView => sampleProjectsView());

  /**
   * Remove old sample projects, because a person asked for it.
   *
   * The renderer names paths it was shown, and `cleanUpSampleProjects` checks every
   * one of them against the sample location again here rather than trusting the
   * list it sent. A path anywhere else is refused, which is the same guarantee the
   * generator's refusal gives from the other direction: DSpatch removes only what
   * DSpatch created.
   */
  handle('samples.clean', (_event, paths: readonly string[]) => {
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

  handle('conversations.list', () => requireConversationStore().list());
  handle('chat.conversationSaveStatus', () => chatService.conversationSaveStatus());
  handle('chat.resumeConversation', async (_event, conversationId: string) => {
    const restored = await chatService.resumeConversation(conversationId);
    // The conversation in use has just changed, so the project's pointer has to
    // change with it. Without this the pointer only ever recorded whichever
    // conversation a project was *opened* with, and choosing an earlier one and
    // working in it left the next open returning to the older one.
    // DSP-149: the chat a workspace continues is the one last worked in there, so a chat
    // read back and continued is the one its workspace opens with next time.
    const owner = requireProjectStore().workspaceForPrimary(restored.project.path);
    if (owner !== null) {
      const outcome = requireProjectStore().updateWorkspace(owner.id, { lastConversationId: restored.conversationId });
      if (outcome.problem !== null) {
        log(`[workspace] ${outcome.problem}`);
      }
    }
    return restored;
  });

  /**
   * One conversation's file as bytes, for the client's export (DSP-4): a byte-for-byte
   * copy is the client's to write, where the person chose, and these are the bytes.
   * `Buffer` arrives at the client as a `Uint8Array` with the same contents.
   */
  handle('conversations.readBytes', (_event, conversationId: string) =>
    requireConversationStore().readBytes(conversationId),
  );

  /** Where one conversation's file is, and whether it is there, for *Show in folder*. */
  handle('conversations.locate', (_event, conversationId: string) => {
    const { filePath } = requireConversationStore().readBytes(conversationId);
    return { filePath, exists: fs.existsSync(filePath) };
  });

  handle('chat.startSession', async (_event, request: StartSessionRequest) => {
    // The resume-choice record's host half (DSP-121): the file's session block before
    // and after each start the window asks for. Read only in that scenario; an
    // ordinary launch does not touch this.
    const fileSessionBefore =
      chatRunScenario === 'resume-choice' ? resumeChoiceFileSession() : null;
    // DSP-149: a folder opens its workspace, and a conversation without one opens in
    // DSpatch's own empty folder; both go through the same functions as the start page.
    if (request.kind === 'folder') {
      const outcome = await openWorkspaceFor({
        folder: request.path,
        ...(request.provider === undefined ? {} : { provider: request.provider }),
      });
      if (outcome.kind === 'refused') {
        throw new Error(outcome.problem);
      }
      return outcome.session;
    }
    if (request.kind === 'loose') {
      return openLooseConversation(request);
    }
    let session: ChatSessionInfo;
    try {
      session = await chatService.startChatSession(request);
    } catch (error) {
      if (chatRunScenario === 'resume-choice') {
        recordResumeChoice(
          'start-session',
          request.kind,
          fileSessionBefore,
          'refused',
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
    if (chatRunScenario === 'resume-choice') {
      recordResumeChoice('start-session', request.kind, fileSessionBefore, 'ok', null);
    }
    announceWorkspace();
    return session;
  });
  // DSP-121: the user removing the recap. Sends nothing; the service answers with
  // the continuity the window shows from then on.
  handle('chat.discardPendingRecap', () => chatService.discardPendingRecap());
  // DSP-147: steering of the turn that is working; it never starts a turn.
  handle('chat.steerTurn', (_event, request: SteerTurnRequest) => chatService.steerTurn(request.text, request.anchor));
  handle(
    'chat.sendPrompt',
    async (_event, prompt: string, acknowledgedAttemptIds?: readonly AttemptAcknowledgement[]) => {
      if (chatRunScenario !== 'resume-choice') {
        return chatService.sendPrompt(prompt, acknowledgedAttemptIds ?? []);
      }
      // The record's host half (DSP-121): a send refused by the guard, with its
      // reason, or one that went - and the adapter's count of what it received.
      const fileSessionBefore = resumeChoiceFileSession();
      try {
        const reference = await chatService.sendPrompt(prompt, acknowledgedAttemptIds ?? []);
        recordResumeChoice('send', prompt, fileSessionBefore, 'ok', null, acknowledgedAttemptIds ?? []);
        return reference;
      } catch (error) {
        recordResumeChoice(
          'send',
          prompt,
          fileSessionBefore,
          'refused',
          error instanceof Error ? error.message : String(error),
          acknowledgedAttemptIds ?? [],
        );
        throw error;
      }
    },
  );
  handle('chat.cancelRun', () => chatService.cancelRun());
  handle('chat.abandonSend', () => chatService.abandonSend());
  handle('chat.cancelObservations', () => chatService.getCancelObservations());
  handle('chat.runState', () => chatService.getRunState());
  handle('chat.runTest', (_event, request: TestRunRequest) => chatService.runWorkspaceTest(request));
  handle('chat.stopTest', () => chatService.stopRunningCommand());
  handle('chat.testFreshness', () => chatService.getTestFreshness());
  handle('chat.agentCommands', () => chatService.getAgentCommands());
  handle('chat.workspaceChanges', () => chatService.getWorkspaceChanges());
  handle('chat.turnUsage', (_event, dspatchRunId: string) => chatService.getTurnUsage(dspatchRunId));

  /*
   * The folders, the tree and the reading view.
   *
   * Every method here is a read or a change to a list of folders. None of them starts
   * a session, changes a working copy or touches a run — which is DSP-73 #3 as a
   * property of what is registered rather than of what the window happens to call.
   * A folder or a workspace file a person chooses arrives as the path the client's
   * chooser answered.
   */
  handle('workspace.view', (): WorkspaceView => currentWorkspaceView());
  handle('workspace.addFolder', (_event, folderPath: string): WorkspaceView => addWorkspaceFolder(folderPath));
  handle('workspace.removeFolder', (_event, folderPath: string): WorkspaceView => removeWorkspaceFolder(folderPath));
  handle('workspace.openFile', (_event, filePath: string): Promise<WorkspaceView> => openWorkspace(filePath));
  handle('workspace.saveFile', (_event, filePath: string): WorkspaceView => saveWorkspace(filePath));
  handle('workspace.readDirectory', (_event, dirPath: string): DirectoryPage => readDirectoryPage(dirPath));
  handle('workspace.readFile', (_event, filePath: string): FileView => readFileForViewing(filePath));

  /**
   * DSP-1's connection probe (`DSPATCH_PROBE=1`): the Cursor adapter, here where every
   * agent connection is. The client starts it and exits with its code.
   */
  handle('probe.runCursor', async (): Promise<{ readonly exitCode: number; readonly repoRoot: string }> => {
    const repoRoot = probeRepoRoot();
    log(`connection probe starting. repo root treated as ${repoRoot}`);
    try {
      const { exitCode } = await runCursorProbe(repoRoot);
      return { exitCode, repoRoot };
    } catch (error) {
      log(`connection probe threw outside its own handling: ${String(error)}`);
      return { exitCode: PROBE_EXIT.unexpectedError, repoRoot };
    }
  });
}

/* --------------------------------------------------------------------------- */
/* Readings for the scripted window runs                                       */
/* --------------------------------------------------------------------------- */

/** Every file under a folder, relative, sorted; for the "nothing changed here" checks. */
function filesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(`${path.relative(root, full)} ${String(fs.statSync(full).size)}`);
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * What the host reads for the scripted runs (`DSPATCH_CHAT_RUN`): the service's own
 * evidence, the conversation files, the resume-choice record and the review readings.
 * The client writes the run record from these beside what the windows showed; the two
 * stay apart in it because they are different kinds of evidence.
 */
function registerScriptedMethods(): void {
  handle('scripted.plan', () => ({
    nodePath: chatService.nodeRunnerPath(),
    resumeMode: presentationResume.mode,
  }));
  handle('scripted.mainEvidence', () => chatService.evidence());
  handle('scripted.conversationFiles', () => observeConversationFiles());
  handle('scripted.resumeChoice', (_event, report: ScriptedRunReport | null, clipboard: readonly string[]) => ({
    adapter: presentationResume.record(),
    timeline: resumeChoiceTimeline,
    checks: resumeChoiceChecks(report, clipboard),
  }));
  handle('scripted.reviewReading', () => {
    // DSP-127: the discussion records on disk, and what each presentation adapter was sent.
    const reviewsDir = path.join(userDataDir(), 'reviews');
    const discussionFiles: unknown[] = [];
    try {
      for (const name of fs.readdirSync(reviewsDir).filter((entry) => entry.endsWith('.discussion.json'))) {
        try {
          const stored = JSON.parse(fs.readFileSync(path.join(reviewsDir, name), 'utf8')) as {
            draft?: unknown;
            messages?: { role?: unknown; status?: unknown }[];
            attempts?: { state?: unknown }[];
          };
          discussionFiles.push({
            file: name,
            draft: stored.draft,
            messages: (stored.messages ?? []).map((message) => `${String(message.role)}:${String(message.status)}`),
            attempts: (stored.attempts ?? []).map((attempt) => attempt.state),
          });
        } catch (error) {
          discussionFiles.push({ file: name, unreadable: String(error) });
        }
      }
    } catch {
      // No reviews folder yet: nothing has been discussed.
    }
    const session = chatService.openSession();
    return {
      chat: {
        sessionId: session?.dspatchSessionId ?? null,
        conversationId: session?.conversationId ?? null,
        workspacePath: session?.workspacePath ?? null,
      },
      loops: {
        current: runAudience.current(),
        loopRunFiles: filesUnder(path.join(userDataDir(), 'loop-runs')),
      },
      reviewsFolder: filesUnder(path.join(userDataDir(), 'reviews')),
      discussionFiles,
      // Each presentation behaviour's own record: the chat's and the review adapters'.
      adapterSent: {
        chat: presentationMode ? presentationResume.record().sent : null,
        review: adapterFactory.reviewPresentationBehaviour?.record().sent ?? null,
        // DSP-152: which agent the review adapters were built for, and each session's model.
        reviewBuilt: adapterFactory.reviewPresentationBehaviour?.record().built ?? null,
        reviewStarts: adapterFactory.reviewPresentationBehaviour?.record().starts ?? null,
      },
    };
  });
}

/* --------------------------------------------------------------------------- */
/* Start and stop                                                              */
/* --------------------------------------------------------------------------- */

/**
 * Close every adapter (the chat's and every review discussion's) and answer how it
 * went. The client bounds the wait; a close that never answers ends with the process.
 */
export async function shutdownProjectHost(observeConversationFilesAfter: boolean): Promise<HostShutdownAnswer> {
  try {
    await disposeAdapterOnce();
    return {
      completed: true,
      detail: 'adapter closed',
      conversationFiles: observeConversationFilesAfter ? observeConversationFiles() : null,
    };
  } catch (error) {
    return {
      completed: false,
      detail: `the adapter failed to close (${String(error)}). Closing anyway.`,
      conversationFiles: null,
    };
  }
}

export interface ProjectHostStart {
  readonly config: HostStartConfig;
  readonly emit: (to: HostEventTarget, channel: string, payload: unknown) => void;
}

/**
 * Build the host's services and answer the methods the client may call. Once per
 * process: the services are module state, as they were in the main process.
 */
export function startProjectHost(start: ProjectHostStart): Readonly<Record<string, HostMethod>> {
  if (hostConfig !== null) {
    throw new Error('The project host was started twice in one process.');
  }
  hostConfig = start.config;
  emitEvent = start.emit;
  ownRepoRoot = ownRepositoryRoot(start.config.appPath);
  chatService = createChatService();

  log(
    `[host] userData=${userDataDir()} conversations=${path.join(userDataDir(), 'conversations')} ` +
      `ownRepo=${ownRepoRoot ?? 'none'} generatorBoundary=${probeRepoRoot()}`,
  );
  if (presentationMode && presentationResumeRequested === null) {
    log(
      `DSPATCH_CHAT_RESUME is "${process.env['DSPATCH_CHAT_RESUME'] ?? ''}", which is none of ` +
        'ok, refused, failed or refused-once; the presentation adapter resumes everything (ok).',
    );
  }
  if (presentationMode && presentationResume.mode !== 'ok') {
    log(
      `presentation adapter resume mode: ${presentationResume.mode} - SIMULATED refusals ` +
        'or failures on this machine; no provider is asked anything.',
    );
  }

  // Before the methods are served, because the loop-definition methods read the
  // workspace's remembered definition and a window that asked first would ask for the
  // list before there was one to prefer.
  restoreRememberedWorkspace();

  // The review host (DSP-126, DSP-111): read-only git at a fixed revision pair and the
  // review records.
  reviewHost = new ReviewHost({
    recordsDir: path.join(userDataDir(), 'reviews'),
    log: (message) => {
      log(`[review host] ${message}`);
    },
    // DSP-152: a step's answered code questions, from the record of the pair its walk is over.
    stepAnalysis: (definitionPath, stepId) => (reviewPairs === null ? [] : reviewPairs.stepAnswers(definitionPath, stepId)),
  });
  reviewPairs = new ReviewPairs({
    recordsDir: path.join(userDataDir(), 'reviews', 'pairs'),
    changed: (key, record) => {
      emitEvent({ kind: 'review-pair', key }, REVIEW_PAIR_CHANGED, { key, record });
    },
  });
  // DSP-152: the two revisions as files the analysis agent reads; folders left by an earlier
  // run cannot be in use, so they go now.
  const revisionSnapshots = new RevisionSnapshots({
    root: path.join(userDataDir(), 'reviews', 'revisions'),
    log: (message) => {
      log(`[review] ${message}`);
    },
  });
  revisionSnapshots.sweep();
  reviewAgentJobs = new ReviewAgentJobs({
    recordsDir: path.join(userDataDir(), 'reviews'),
    // The shared factory, for the analysis purpose only; the jobs check the policy themselves.
    createAdapter: (provider) => {
      log(`[review] building a ${provider} analysis adapter${presentationMode ? ' (presentation, simulated)' : ''}`);
      return adapterFactory.createAdapter({ provider, purpose: 'analysis' });
    },
    snapshots: revisionSnapshots,
    // The factory's own rule for analysis: Cursor is refused, with its reason, before a start.
    availability: (provider) => {
      const availability = providerAvailability(provider, {
        claudeAuthorized: CLAUDE_AUTHORIZATION_REFERENCE !== null,
        claudeInstalled: CLAUDE_SUPPORT.installed,
      });
      return availability.choosable && provider === 'cursor' ? { ...availability, choosable: false, reason: CURSOR_ANALYSIS_REFUSAL } : availability;
    },
    pairs: reviewPairs,
    language: async () => {
      const preferences = await requireReviewHost().getPreferences();
      return 'language' in preferences && preferences.language === 'sv' ? 'sv' : 'en';
    },
    log: (message) => {
      log(`[review] ${message}`);
    },
  });
  reviewDiscussions = new ReviewDiscussions({
    recordsDir: path.join(userDataDir(), 'reviews'),
    // The pair's one discussion starts from what was discussed and explained before (30 October 2026).
    earlier: (identity) =>
      reviewPairs === null
        ? []
        : earlierDiscussion(path.join(userDataDir(), 'reviews'), identity, (other) => pairKeyOf(other) === identity.key, reviewPairs),
    // DSP-132: the shared factory; ReviewDiscussions binds the review purpose itself.
    createAdapter: (request) => {
      log(`[review] building a ${request.provider} review adapter${presentationMode ? ' (presentation, simulated)' : ''}`);
      return adapterFactory.createAdapter(request);
    },
    model: process.env['DSPATCH_CHAT_MODEL'] ?? undefined,
    // DSP-149: the same choice as the chat, in the discussion's own session.
    modelFor: (provider) =>
      provider === 'claude'
        ? chatService.modelFor('claude')
        : (modelChoiceStore.read('cursor') ?? process.env['DSPATCH_CHAT_MODEL'] ?? REVIEW_DISCUSSION_DEFAULT_MODEL),
    availability: (provider) =>
      providerAvailability(provider, {
        claudeAuthorized: CLAUDE_AUTHORIZATION_REFERENCE !== null,
        claudeInstalled: CLAUDE_SUPPORT.installed,
      }),
    policyFor: (provider) =>
      provider === 'claude'
        ? `${describePermissionPolicy(REVIEW_PERMISSIONS)}. Deny reason: ${REVIEW_DENY_REASON}`
        : 'text-only (tools: [])',
    // Niclas's decision of 30 October 2026: a question may read the two revisions with the
    // analysis access the walk preparation uses. Only an agent with a read-only analysis
    // policy gets it (Claude); Cursor has none and stays tool-free.
    codeAccess: {
      offered: (provider) => provider === 'claude',
      createAdapter: (provider) => {
        log(`[review] building a ${provider} analysis adapter for a discussion${presentationMode ? ' (presentation, simulated)' : ''}`);
        return adapterFactory.createAdapter({ provider, purpose: 'analysis' });
      },
      policy: ANALYSIS_PERMISSIONS,
      policyLine: `${describePermissionPolicy(ANALYSIS_PERMISSIONS)}, in a folder holding the two revisions only`,
      hold: (identity, holder) =>
        requireReviewAgentJobs().holdForDiscussion({ repository: identity.repository, base: identity.base, target: identity.target }, holder),
    },
    log: (message) => {
      log(`[review] ${message}`);
    },
  });

  registerCoreMethods();
  registerLoopMethods();
  registerReviewMethods();
  if (chatRunMode) {
    registerScriptedMethods();
  }
  // Exactly the contract's methods, or the host does not start: a client and a host built
  // from different sources would otherwise meet only as an `unknown-method` mid-work.
  // `host.shutdown` is the process's own (`host-process.ts`).
  const expected = PROJECT_HOST_METHOD_NAMES.filter(
    (name) => name !== 'host.shutdown' && (chatRunMode || !SCRIPTED_ONLY_METHODS.includes(name)),
  );
  const missing = expected.filter((name) => !Object.prototype.hasOwnProperty.call(methods, name));
  const extra = Object.keys(methods).filter((name) => !(expected as readonly string[]).includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `The project host does not serve its contract: missing ${missing.join(', ') || 'none'}; ` +
        `not in the contract ${extra.join(', ') || 'none'}.`,
    );
  }
  return methods;
}
