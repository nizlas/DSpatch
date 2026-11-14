import type { HostBrowsePage } from './host-link';
import type {
  AddLoopInstructionRequest,
  SteerTurnRequest,
  AttemptAcknowledgement,
  ChatLoopRunOutcome,
  ChatLoopRunRequest,
  DspatchBridge,
  EditorLoopRunRequest,
  LoopDefinitionChooseOutcome,
  LoopGraphOpenRequest,
  LoopGraphSaveRequest,
  ScriptedRunReport,
  StartSessionRequest,
  ProviderSetupState,
  StoredSessionProvider,
  WorkspaceOpenRequest,
  TestRunRequest,
} from './bridge';
import type { HostEnvironmentFacts, HostShutdownAnswer } from './host-protocol';
import type { LoopMode } from './loop-control';
import type { RoleReference } from './loop-graph';
import type {
  DiscussionCancelOutcome,
  DiscussionChooseOutcome,
  DiscussionLoadOutcome,
  DiscussionSendOutcome,
  DiscussionStatusView,
  DiscussionTarget,
} from './review-discussion';
import type { ReviewHostApi } from './review-host-contract';
import type {
  AgentJob,
  ContextFileView,
  ReviewAgents,
  LogCommit,
  OpenPair,
  PairDirection,
  PairAnswer,
  PairRecord,
  OngoingReview,
  PairWalk,
  ReviewRepository,
  RevisionPairIdentity,
} from './review-pair';
import type { WalkLoopRecordView } from './walk-loop';
import type { WalkLoopRunSnapshot } from './walk-loop-view';

/*
 * The project host's methods (DSP-111): what the client may ask of the host, by name,
 * with what each takes and answers. The review host's `ReviewHostApi` is the precedent;
 * this is the same kind of contract for the chat, the projects, the conversations, the
 * workspace, the loops and the review discussions.
 *
 * Every method also takes the call's context first (`HostCallContext`: which window
 * asked), which is not listed here. Arguments and answers are plain data. A method's
 * answer is mostly what the window's own bridge call answers (`DspatchBridge`), because
 * the client's handler forwards it unchanged; where the client does part of the work (a
 * file chooser, a question to the person), the host's half is named here.
 *
 * Both sides are typed against this: the host registers each method with this signature
 * and refuses to start if one is missing or extra (`project-host.ts`), and the client's
 * calls are typed by it (`main.ts`), so a drift between them is a typecheck failure
 * rather than an `unknown-method` at run time.
 */

/** What a window's own bridge call answers, without the promise. */
type BridgeAnswer<K extends keyof DspatchBridge> = DspatchBridge[K] extends (...args: never[]) => Promise<infer T> ? T : never;

/** Which window asked (`webContents.id`), or none: a menu item, a scripted check. */
export interface HostCallContext {
  readonly senderId: number | null;
}

/** A loop step's result of being judged at the point of choosing (`loop.judgeDefinition`). */
export type DefinitionJudgement =
  | { readonly kind: 'refused'; readonly key: string; readonly note: string }
  | { readonly kind: 'runnable'; readonly key: string };

/** One conversation's file as bytes, for the client's export. */
export interface ConversationBytesAnswer {
  readonly filePath: string;
  readonly bytes: Uint8Array | null;
  readonly error: string | null;
}

type ReviewMethods = {
  readonly [K in keyof ReviewHostApi as `review.${K}`]: (
    ...args: Parameters<ReviewHostApi[K]>
  ) => Awaited<ReturnType<ReviewHostApi[K]>>;
};

export type ProjectHostMethods = ReviewMethods & {
  // --- The chat -----------------------------------------------------------------------
  readonly 'chat.environment': () => HostEnvironmentFacts;
  readonly 'chat.getConnection': () => BridgeAnswer<'getConnection'>;
  readonly 'chat.setModel': (modelId: string) => string;
  readonly 'chat.listModels': (provider: StoredSessionProvider) => BridgeAnswer<'listModels'>;
  readonly 'chat.chooseModel': (provider: StoredSessionProvider, modelId: string) => string;
  readonly 'provider.status': (tool: 'claude' | 'copilot') => ProviderSetupState;
  readonly 'provider.install': (tool: 'claude' | 'copilot') => ProviderSetupState;
  readonly 'provider.installCancel': (tool: 'claude' | 'copilot') => void;
  readonly 'provider.acceptClaude': () => ProviderSetupState;
  readonly 'provider.loginStart': (tool: 'claude' | 'copilot') => void;
  readonly 'provider.loginAnswer': (text: string) => void;
  readonly 'provider.loginCancel': () => void;
  readonly 'chat.chooseAgent': (provider: unknown) => StoredSessionProvider | null;
  readonly 'chat.conversationSaveStatus': () => BridgeAnswer<'conversationSaveStatus'>;
  readonly 'chat.resumeConversation': (conversationId: string) => BridgeAnswer<'resumeConversation'>;
  readonly 'chat.startSession': (request: StartSessionRequest) => BridgeAnswer<'startChatSession'>;
  readonly 'chat.discardPendingRecap': (which?: unknown) => BridgeAnswer<'discardPendingRecap'>;
  readonly 'chat.sendPrompt': (
    prompt: string,
    acknowledgedAttemptIds: readonly AttemptAcknowledgement[],
  ) => BridgeAnswer<'sendPrompt'>;
  /** DSP-147: steering of the ordinary turn that is working. */
  readonly 'chat.steerTurn': (request: SteerTurnRequest) => BridgeAnswer<'steerTurn'>;
  readonly 'chat.cancelRun': () => BridgeAnswer<'cancelRun'>;
  readonly 'chat.abandonSend': () => BridgeAnswer<'abandonSend'>;
  readonly 'chat.cancelObservations': () => BridgeAnswer<'getCancelObservations'>;
  readonly 'chat.runState': () => BridgeAnswer<'getRunState'>;
  readonly 'chat.runTest': (request: TestRunRequest) => BridgeAnswer<'runWorkspaceTest'>;
  readonly 'chat.stopTest': () => BridgeAnswer<'stopWorkspaceTest'>;
  readonly 'chat.testFreshness': () => BridgeAnswer<'getTestFreshness'>;
  readonly 'chat.agentCommands': () => BridgeAnswer<'getAgentCommands'>;
  readonly 'chat.workspaceChanges': () => BridgeAnswer<'getWorkspaceChanges'>;
  readonly 'chat.turnUsage': (dspatchRunId: string) => BridgeAnswer<'getTurnUsage'>;

  // --- Workspaces (DSP-149), sample projects and conversations ------------------------
  readonly 'workspaces.recent': () => BridgeAnswer<'listRecentWorkspaces'>;
  readonly 'workspaces.removeFromRecent': (workspaceIds: readonly string[]) => BridgeAnswer<'removeFromRecent'>;
  readonly 'workspaces.open': (request: WorkspaceOpenRequest) => BridgeAnswer<'openWorkspace'>;
  readonly 'samples.list': () => BridgeAnswer<'listSampleProjects'>;
  readonly 'samples.clean': (paths: readonly string[]) => BridgeAnswer<'cleanUpSampleProjects'>;
  readonly 'conversations.list': () => BridgeAnswer<'listConversations'>;
  readonly 'conversations.readBytes': (conversationId: string) => ConversationBytesAnswer;
  readonly 'conversations.locate': (conversationId: string) => { readonly filePath: string; readonly exists: boolean };

  // --- The workspace (a chosen folder or file arrives as the path the client's chooser answered)
  readonly 'workspace.view': () => BridgeAnswer<'workspaceFolders'>;
  readonly 'workspace.addFolder': (folderPath: string) => BridgeAnswer<'addFolderToWorkspace'>;
  readonly 'workspace.removeFolder': (folderPath: string) => BridgeAnswer<'removeFolderFromWorkspace'>;
  readonly 'workspace.openFile': (filePath: string) => BridgeAnswer<'openWorkspaceFile'>;
  readonly 'workspace.saveFile': (filePath: string) => BridgeAnswer<'saveWorkspaceFile'>;
  readonly 'workspace.readDirectory': (dirPath: string) => BridgeAnswer<'readWorkspaceDirectory'>;
  readonly 'workspace.readFile': (filePath: string) => BridgeAnswer<'readWorkspaceFile'>;

  // --- Loops -------------------------------------------------------------------------
  readonly 'loop.openGraph': (request: LoopGraphOpenRequest) => BridgeAnswer<'openLoopGraph'>;
  readonly 'loop.saveGraph': (request: LoopGraphSaveRequest) => BridgeAnswer<'saveLoopGraph'>;
  readonly 'loop.resolveRoles': (references: readonly RoleReference[]) => BridgeAnswer<'resolveLoopRoles'>;
  readonly 'loop.locateRoleSource': (request: {
    readonly root: string;
    readonly path: string;
  }) => { readonly revealed: false; readonly note: string } | { readonly target: string };
  readonly 'loop.listDefinitions': () => BridgeAnswer<'listLoopDefinitions'>;
  readonly 'loop.judgeDefinition': (definitionPath: string) => DefinitionJudgement;
  readonly 'loop.chooseDefinition': (
    definitionPath: string,
    unsavedDrawing: 'save' | 'discard' | null,
  ) => LoopDefinitionChooseOutcome;
  readonly 'loop.chatRunStartCheck': (
    definitionKey: string | null | undefined,
  ) => { readonly refused: ChatLoopRunOutcome } | { readonly graphPath: string };
  readonly 'loop.startEditorRun': (request: EditorLoopRunRequest) => BridgeAnswer<'startEditorLoopRun'>;
  readonly 'loop.startChatRun': (request: ChatLoopRunRequest) => BridgeAnswer<'startChatLoopRun'>;
  readonly 'loop.currentRun': () => BridgeAnswer<'currentLoopRun'>;
  readonly 'loop.currentRunView': () => BridgeAnswer<'currentLoopRunView'>;
  readonly 'loop.readRunAgent': (query: unknown) => BridgeAnswer<'readLoopRunAgent'>;
  readonly 'loop.requestPause': () => BridgeAnswer<'requestLoopPause'>;
  readonly 'loop.continue': () => BridgeAnswer<'continueLoop'>;
  readonly 'loop.answerHandoff': (answer: unknown) => BridgeAnswer<'answerLoopHandoff'>;
  readonly 'loop.setMode': (mode: LoopMode) => BridgeAnswer<'setLoopMode'>;
  readonly 'loop.readControl': () => BridgeAnswer<'loopControl'>;
  readonly 'loop.cancelEditorRun': () => BridgeAnswer<'cancelEditorLoopRun'>;
  readonly 'loop.listRunRecords': (conversationId: string) => BridgeAnswer<'listRunRecords'>;
  readonly 'loop.addInstruction': (request: AddLoopInstructionRequest) => BridgeAnswer<'addLoopInstruction'>;
  readonly 'loop.prepareChatLoop': (wanted: boolean, definitionKey: string | null) => BridgeAnswer<'prepareChatLoop'>;
  readonly 'loop.cancelChatRun': () => BridgeAnswer<'cancelChatLoopRun'>;

  // --- Review: the window's context, the example, and the discussions ------------------
  readonly 'review.openContext': () => {
    readonly repository: string | null;
    readonly defaultProvider: StoredSessionProvider | null;
    readonly defaultModel: string;
  };
  readonly 'review.exampleDefinition': () =>
    | { readonly kind: 'found'; readonly definitionPath: string; readonly repositoryRoot: string }
    | { readonly kind: 'unavailable'; readonly note: string };
  // --- Review of a chosen revision pair (DSP-150) -----------------------------------------
  readonly 'reviewPair.repositories': () => readonly ReviewRepository[];
  readonly 'reviewPair.log': (
    repository: unknown,
    skip: unknown,
  ) => PairAnswer<{
    readonly commits: readonly LogCommit[];
    readonly more: boolean;
    readonly last: { readonly base: string; readonly target: string } | null;
  }>;
  readonly 'reviewPair.direction': (repository: unknown, first: unknown, second: unknown) => PairAnswer<PairDirection>;
  readonly 'reviewPair.open': (request: unknown) => PairAnswer<OpenPair>;
  readonly 'reviewPair.openForWalk': (pair: RevisionPairIdentity, definitionPath?: string, review?: string | null) => PairAnswer<OpenPair>;
  readonly 'reviewPair.readFile': (key: unknown, side: unknown, path: unknown) => PairAnswer<{ readonly text: string | null; readonly binary: boolean }>;
  readonly 'reviewPair.readContextFile': (key: unknown, repository: unknown, path: unknown, commit: unknown) => PairAnswer<ContextFileView>;
  readonly 'reviewPair.state': (key: unknown) => PairAnswer<PairRecord>;
  readonly 'reviewPair.mark': (key: unknown, request: unknown) => PairAnswer<PairRecord>;
  readonly 'reviewPair.savePosition': (key: unknown, position: unknown) => PairAnswer<{ readonly saved: true }>;
  readonly 'reviewPair.walks': (key: unknown, also: unknown) => PairAnswer<readonly PairWalk[]>;
  readonly 'reviewPair.walkToOpen': (key: unknown, also: unknown) => PairAnswer<{ readonly definitionPath: string | null }>;
  readonly 'reviewPair.walkOpened': (key: unknown, definitionPath: unknown) => { readonly saved: true };
  readonly 'reviewPair.ongoing': () => readonly OngoingReview[];
  readonly 'reviewPair.end': (pair: unknown) => PairAnswer<{ readonly ended: true }>;
  readonly 'reviewPair.delete': (review: unknown) => PairAnswer<{ readonly deleted: true }>;
  readonly 'reviewPair.agents': (key: unknown, opener: unknown) => PairAnswer<ReviewAgents>;
  readonly 'reviewPair.startJob': (key: unknown, request: unknown) => PairAnswer<AgentJob>;
  readonly 'reviewPair.cancelJob': (key: unknown, jobId: unknown) => PairAnswer<{ readonly note: string }>;
  readonly 'reviewPair.walkLoopRecord': (key: unknown, jobId: unknown) => PairAnswer<WalkLoopRecordView>;
  /** DSP-190: the walk loop run as it stands, for a window that follows it. A read. */
  readonly 'reviewPair.walkLoopRunView': (key: unknown, jobId: unknown) => PairAnswer<WalkLoopRunSnapshot>;
  readonly 'reviewPair.thread': (key: unknown, request: unknown) => PairAnswer<PairRecord>;
  readonly 'discussion.load': (target: DiscussionTarget, request: unknown) => DiscussionLoadOutcome;
  readonly 'discussion.send': (target: DiscussionTarget, input: unknown) => DiscussionSendOutcome;
  readonly 'discussion.cancel': (target: DiscussionTarget) => DiscussionCancelOutcome;
  readonly 'discussion.acknowledge': (target: DiscussionTarget, attemptIds: unknown) => DiscussionStatusView;
  readonly 'reviewPair.discussionWalk': (key: unknown) => PairAnswer<{ readonly definitionPath: string }>;
  readonly 'discussion.draft': (target: DiscussionTarget, text: unknown) => { readonly saved: boolean; readonly error?: string };
  readonly 'discussion.quote': (target: DiscussionTarget, quote: unknown) => void;
  readonly 'discussion.chooseAgent': (target: DiscussionTarget, provider: unknown) => DiscussionChooseOutcome;
  readonly 'discussion.recap': (target: DiscussionTarget, leftOut: unknown) => DiscussionStatusView;
  readonly 'discussion.detach': (targetId: number) => void;

  // --- The connection probe (DSPATCH_PROBE) and the scripted runs (DSPATCH_CHAT_RUN) ---
  readonly 'probe.runCursor': () => { readonly exitCode: number; readonly repoRoot: string };
  readonly 'scripted.plan': () => { readonly nodePath: string | null; readonly resumeMode: string };
  readonly 'scripted.mainEvidence': () => Record<string, unknown>;
  readonly 'scripted.conversationFiles': () => readonly unknown[];
  readonly 'scripted.resumeChoice': (
    report: ScriptedRunReport | null,
    clipboard: readonly string[],
  ) => {
    readonly adapter: unknown;
    readonly timeline: unknown;
    readonly checks: readonly { readonly check: string; readonly ok: boolean; readonly evidence: string }[];
  };
  readonly 'scripted.reviewReading': () => {
    readonly chat: Record<string, unknown>;
    readonly loops: Record<string, unknown>;
    readonly reviewsFolder: unknown;
    readonly discussionFiles: unknown;
    readonly adapterSent: unknown;
  };

  // --- Choosing a place on the host (DSP-111) -------------------------------------------
  readonly 'files.browse': (folder: string | null) => HostBrowsePage;

  // --- One host over a machine's work (DSP-161) -----------------------------------------
  /** What is running here, as a sentence, or `null` when nothing is. */
  readonly 'host.busy': () => string | null;
  /** Something about this host's data a person has not been told yet, once. */
  readonly 'host.dataNotice': () => string | null;

  // --- Closing -------------------------------------------------------------------------
  readonly 'host.shutdown': (request: { readonly observeConversationFiles: boolean }) => HostShutdownAnswer;
};

export type ProjectHostMethodName = keyof ProjectHostMethods;
export type HostArgs<K extends ProjectHostMethodName> = Parameters<ProjectHostMethods[K]>;
export type HostAnswerOf<K extends ProjectHostMethodName> = ReturnType<ProjectHostMethods[K]>;

/**
 * The methods served only during a scripted window run (`DSPATCH_CHAT_RUN`); an ordinary
 * launch does not register them.
 */
export const SCRIPTED_ONLY_METHODS: readonly ProjectHostMethodName[] = [
  'scripted.plan',
  'scripted.mainEvidence',
  'scripted.conversationFiles',
  'scripted.resumeChoice',
  'scripted.reviewReading',
];

/** Every method name, for the host's check that it serves exactly these. */
export const PROJECT_HOST_METHOD_NAMES = Object.keys({
  'review.createSession': true,
  'review.closeSession': true,
  'review.identify': true,
  'review.open': true,
  'review.lastReviewFor': true,
  'review.repositoryKey': true,
  'review.readFile': true,
  'review.listFiles': true,
  'review.search': true,
  'review.saveState': true,
  'review.getPreferences': true,
  'review.setPreferences': true,
  'review.envelopeFor': true,
  'review.recordReading': true,
  'review.recentIndex': true,
  'chat.environment': true,
  'chat.getConnection': true,
  'chat.setModel': true,
  'chat.listModels': true,
  'chat.chooseModel': true,
  'provider.status': true,
  'provider.install': true,
  'provider.installCancel': true,
  'provider.acceptClaude': true,
  'provider.loginStart': true,
  'provider.loginAnswer': true,
  'provider.loginCancel': true,
  'chat.chooseAgent': true,
  'chat.conversationSaveStatus': true,
  'chat.resumeConversation': true,
  'chat.startSession': true,
  'chat.discardPendingRecap': true,
  'chat.sendPrompt': true,
  'chat.steerTurn': true,
  'chat.cancelRun': true,
  'chat.abandonSend': true,
  'chat.cancelObservations': true,
  'chat.runState': true,
  'chat.runTest': true,
  'chat.stopTest': true,
  'chat.testFreshness': true,
  'chat.agentCommands': true,
  'chat.workspaceChanges': true,
  'chat.turnUsage': true,
  'workspaces.recent': true,
  'workspaces.removeFromRecent': true,
  'workspaces.open': true,
  'samples.list': true,
  'samples.clean': true,
  'conversations.list': true,
  'conversations.readBytes': true,
  'conversations.locate': true,
  'workspace.view': true,
  'workspace.addFolder': true,
  'workspace.removeFolder': true,
  'workspace.openFile': true,
  'workspace.saveFile': true,
  'workspace.readDirectory': true,
  'workspace.readFile': true,
  'loop.openGraph': true,
  'loop.saveGraph': true,
  'loop.resolveRoles': true,
  'loop.locateRoleSource': true,
  'loop.listDefinitions': true,
  'loop.judgeDefinition': true,
  'loop.chooseDefinition': true,
  'loop.chatRunStartCheck': true,
  'loop.startEditorRun': true,
  'loop.startChatRun': true,
  'loop.currentRun': true,
  'loop.currentRunView': true,
  'loop.readRunAgent': true,
  'loop.requestPause': true,
  'loop.continue': true,
  'loop.answerHandoff': true,
  'loop.setMode': true,
  'loop.readControl': true,
  'loop.cancelEditorRun': true,
  'loop.listRunRecords': true,
  'loop.addInstruction': true,
  'loop.prepareChatLoop': true,
  'loop.cancelChatRun': true,
  'review.openContext': true,
  'reviewPair.repositories': true,
  'reviewPair.log': true,
  'reviewPair.direction': true,
  'reviewPair.open': true,
  'reviewPair.openForWalk': true,
  'reviewPair.readFile': true,
  'reviewPair.readContextFile': true,
  'reviewPair.state': true,
  'reviewPair.mark': true,
  'reviewPair.savePosition': true,
  'reviewPair.walks': true,
  'reviewPair.walkToOpen': true,
  'reviewPair.walkOpened': true,
  'reviewPair.ongoing': true,
  'reviewPair.end': true,
  'reviewPair.delete': true,
  'reviewPair.agents': true,
  'reviewPair.startJob': true,
  'reviewPair.cancelJob': true,
  'reviewPair.walkLoopRecord': true,
  'reviewPair.walkLoopRunView': true,
  'reviewPair.thread': true,
  'review.exampleDefinition': true,
  'discussion.load': true,
  'discussion.send': true,
  'discussion.cancel': true,
  'discussion.acknowledge': true,
  'discussion.draft': true,
  'reviewPair.discussionWalk': true,
  'discussion.quote': true,
  'discussion.chooseAgent': true,
  'discussion.recap': true,
  'discussion.detach': true,
  'probe.runCursor': true,
  'scripted.plan': true,
  'scripted.mainEvidence': true,
  'scripted.conversationFiles': true,
  'scripted.resumeChoice': true,
  'scripted.reviewReading': true,
  'files.browse': true,
  'host.busy': true,
  'host.dataNotice': true,
  'host.shutdown': true,
} satisfies Record<ProjectHostMethodName, true>) as ProjectHostMethodName[];
