import { contextBridge, ipcRenderer } from 'electron';

import type {
  AbandonOutcome,
  BridgeChannel,
  CancelObservations,
  CancelOutcome,
  ChatSessionInfo,
  ConnectionStatus,
  ConversationExportResult,
  ConversationListing,
  ConversationSaveStatus,
  DspatchBridge,
  ChatLoopCancelOutcome,
  ChatLoopPrepareOutcome,
  ChatLoopReply,
  ChatLoopRunOutcome,
  ChatLoopRunRequest,
  AddLoopInstructionOutcome,
  AddLoopInstructionRequest,
  LoopInstructionEventPayload,
  EditorLoopCancelOutcome,
  EditorLoopRunOutcome,
  EditorLoopRunRequest,
  EnvironmentInfo,
  ForgetProjectsResult,
  LoopDefinitionChooseOutcome,
  LoopDefinitionListing,
  LoopGraphOpenOutcome,
  LoopGraphOpenRequest,
  LoopEditorWindowOutcome,
  LoopGraphSaveOutcome,
  LoopGraphSaveRequest,
  GraphSavedElsewhere,
  UnsavedDrawing,
  MenuCommand,
  ProjectListing,
  ProjectPickOutcome,
  RendererReady,
  ResolvedRoleEntry,
  RestoredConversation,
  RunStateReport,
  SampleCleanupOutcome,
  SampleProjectsView,
  ScriptedRunPlan,
  ScriptedRunReport,
  StartSessionRequest,
  StoredRunRecordEntry,
  TestFreshness,
  TestOutcome,
  TestRunRequest,
  TurnUsage,
  UiAgentEvent,
  WorkspaceReport,
} from '../shared/bridge';
import type { StepActivity } from '../shared/loop-activity';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from '../shared/loop-control';
import type { RoleReference } from '../shared/loop-graph';
import type { RunJournalEntry } from '../shared/loop-run';
import type { LiveRunAnnouncement, LoopRunEvent } from '../shared/loop-run-view';
import type { DirectoryPage, FileView, WorkspaceView } from '../shared/workspace-folders';

// Sandboxed preload: only Electron modules may be imported as values.
// Channel names are therefore typed literals so misspellings are caught.
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
const LOOP_RUN_EVENT: BridgeChannel = 'dspatch:loop-run-event';
const CURRENT_LOOP_RUN: BridgeChannel = 'dspatch:current-loop-run';
const START_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:start-chat-loop-run';
const CANCEL_CHAT_LOOP_RUN: BridgeChannel = 'dspatch:cancel-chat-loop-run';
const CHAT_LOOP_JOURNAL: BridgeChannel = 'dspatch:chat-loop-journal';
const CHAT_LOOP_REPLY: BridgeChannel = 'dspatch:chat-loop-reply';
const CHAT_LOOP_ACTIVITY: BridgeChannel = 'dspatch:chat-loop-activity';
const PREPARE_CHAT_LOOP: BridgeChannel = 'dspatch:prepare-chat-loop';
const LIST_LOOP_DEFINITIONS: BridgeChannel = 'dspatch:list-loop-definitions';
const CHOOSE_LOOP_DEFINITION: BridgeChannel = 'dspatch:choose-loop-definition';
const TAKE_GRAPH_TO_EDIT: BridgeChannel = 'dspatch:take-graph-to-edit';
const GRAPH_TO_EDIT: BridgeChannel = 'dspatch:graph-to-edit';
const NOTE_UNSAVED_DRAWING: BridgeChannel = 'dspatch:note-unsaved-drawing';
const GRAPH_SAVED_ELSEWHERE: BridgeChannel = 'dspatch:graph-saved-elsewhere';
const ADD_LOOP_INSTRUCTION: BridgeChannel = 'dspatch:add-loop-instruction';
const LOOP_INSTRUCTION_EVENT: BridgeChannel = 'dspatch:loop-instruction-event';
const LIST_RUN_RECORDS: BridgeChannel = 'dspatch:list-run-records';
const LOOP_CONTROL: BridgeChannel = 'dspatch:loop-control';
const READ_LOOP_CONTROL: BridgeChannel = 'dspatch:read-loop-control';
const REQUEST_LOOP_PAUSE: BridgeChannel = 'dspatch:request-loop-pause';
const CONTINUE_LOOP: BridgeChannel = 'dspatch:continue-loop';
const SET_LOOP_MODE: BridgeChannel = 'dspatch:set-loop-mode';
const WORKSPACE_FOLDERS: BridgeChannel = 'dspatch:workspace-folders';
const WORKSPACE_FOLDERS_CHANGED: BridgeChannel = 'dspatch:workspace-folders-changed';
const ADD_WORKSPACE_FOLDER: BridgeChannel = 'dspatch:add-workspace-folder';
const REMOVE_WORKSPACE_FOLDER: BridgeChannel = 'dspatch:remove-workspace-folder';
const OPEN_WORKSPACE_FILE: BridgeChannel = 'dspatch:open-workspace-file';
const SAVE_WORKSPACE_FILE: BridgeChannel = 'dspatch:save-workspace-file';
const READ_WORKSPACE_DIRECTORY: BridgeChannel = 'dspatch:read-workspace-directory';
const READ_WORKSPACE_FILE: BridgeChannel = 'dspatch:read-workspace-file';

const bridge: DspatchBridge = {
  getEnvironment: () =>
    ipcRenderer.invoke(GET_ENVIRONMENT) as Promise<EnvironmentInfo>,
  reportReady: (ready: RendererReady) => {
    ipcRenderer.send(RENDERER_READY, ready);
  },

  getConnection: () =>
    ipcRenderer.invoke(GET_CONNECTION) as Promise<ConnectionStatus>,
  setRequestedModel: (modelId: string) =>
    ipcRenderer.invoke(SET_MODEL, modelId) as Promise<string>,
  onMenuCommand: (listener: (command: MenuCommand) => void) => {
    const handler = (_event: unknown, payload: MenuCommand): void => {
      listener(payload);
    };
    ipcRenderer.on(MENU_COMMAND, handler);
    return () => {
      ipcRenderer.removeListener(MENU_COMMAND, handler);
    };
  },
  pickProjectFolder: () =>
    ipcRenderer.invoke(PICK_PROJECT) as Promise<ProjectPickOutcome>,
  listProjects: () => ipcRenderer.invoke(LIST_PROJECTS) as Promise<ProjectListing>,
  forgetProjects: (projectPaths: readonly string[]) =>
    ipcRenderer.invoke(FORGET_PROJECTS, projectPaths) as Promise<ForgetProjectsResult>,
  listSampleProjects: () =>
    ipcRenderer.invoke(LIST_SAMPLE_PROJECTS) as Promise<SampleProjectsView>,
  cleanUpSampleProjects: (paths: readonly string[]) =>
    ipcRenderer.invoke(CLEAN_SAMPLE_PROJECTS, paths) as Promise<SampleCleanupOutcome>,
  listConversations: () =>
    ipcRenderer.invoke(LIST_CONVERSATIONS) as Promise<ConversationListing>,
  conversationSaveStatus: () =>
    ipcRenderer.invoke(CONVERSATION_SAVE_STATUS) as Promise<ConversationSaveStatus>,
  resumeConversation: (conversationId: string) =>
    ipcRenderer.invoke(RESUME_CONVERSATION, conversationId) as Promise<RestoredConversation>,
  exportConversation: (conversationId: string) =>
    ipcRenderer.invoke(EXPORT_CONVERSATION, conversationId) as Promise<ConversationExportResult>,
  revealConversationFile: (conversationId: string) =>
    ipcRenderer.invoke(REVEAL_CONVERSATION, conversationId) as Promise<{
      readonly revealed: boolean;
      readonly note: string;
    }>,
  startChatSession: (request: StartSessionRequest) =>
    ipcRenderer.invoke(START_SESSION, request) as Promise<ChatSessionInfo>,
  sendPrompt: (text: string, acknowledgedAttemptIds?: readonly string[]) =>
    ipcRenderer.invoke(SEND_PROMPT, text, acknowledgedAttemptIds) as Promise<{
      readonly dspatchRunId: string;
    }>,
  cancelRun: () => ipcRenderer.invoke(CANCEL_RUN) as Promise<CancelOutcome>,
  abandonSend: () => ipcRenderer.invoke(ABANDON_SEND) as Promise<AbandonOutcome>,
  getCancelObservations: () =>
    ipcRenderer.invoke(CANCEL_OBSERVATIONS) as Promise<CancelObservations>,
  getRunState: () => ipcRenderer.invoke(RUN_STATE) as Promise<RunStateReport>,
  runWorkspaceTest: (request: TestRunRequest) =>
    ipcRenderer.invoke(RUN_TEST, request) as Promise<TestOutcome>,
  stopWorkspaceTest: () =>
    ipcRenderer.invoke(STOP_TEST) as Promise<{
      readonly stopped: boolean;
      readonly note: string;
    }>,
  getTestFreshness: () => ipcRenderer.invoke(TEST_FRESHNESS) as Promise<TestFreshness>,
  getWorkspaceChanges: () =>
    ipcRenderer.invoke(WORKSPACE_CHANGES) as Promise<WorkspaceReport>,
  getTurnUsage: (dspatchRunId: string) =>
    ipcRenderer.invoke(TURN_USAGE, dspatchRunId) as Promise<TurnUsage>,

  // The listener is wrapped rather than passed through: `ipcRenderer` hands its
  // own event object to the first parameter, and that object must not reach the
  // renderer. Only the payload does.
  onAgentEvent: (listener: (event: UiAgentEvent) => void) => {
    const handler = (_event: unknown, payload: UiAgentEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(AGENT_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(AGENT_EVENT, handler);
    };
  },

  getScriptedRun: () =>
    ipcRenderer.invoke(GET_SCRIPTED_RUN) as Promise<ScriptedRunPlan | null>,
  reportScriptedRun: (report: ScriptedRunReport) => {
    ipcRenderer.send(SCRIPTED_RUN_REPORT, report);
  },
  pressMenuItem: (command: MenuCommand) =>
    ipcRenderer.invoke(PRESS_MENU_ITEM, command) as Promise<boolean>,
  captureWindow: (label: string) =>
    ipcRenderer.invoke(CAPTURE_WINDOW, label) as Promise<boolean>,
  setWindowWidth: (width: number) =>
    ipcRenderer.invoke(SET_WINDOW_WIDTH, width) as Promise<number>,
  emulateReducedMotion: (reduce: boolean) =>
    ipcRenderer.invoke(EMULATE_REDUCED_MOTION, reduce) as Promise<boolean>,

  openLoopGraph: (request: LoopGraphOpenRequest) =>
    ipcRenderer.invoke(OPEN_LOOP_GRAPH, request) as Promise<LoopGraphOpenOutcome>,
  saveLoopGraph: (request: LoopGraphSaveRequest) =>
    ipcRenderer.invoke(SAVE_LOOP_GRAPH, request) as Promise<LoopGraphSaveOutcome>,
  resolveLoopRoles: (references: readonly RoleReference[]) =>
    ipcRenderer.invoke(RESOLVE_LOOP_ROLES, references) as Promise<readonly ResolvedRoleEntry[]>,
  revealRoleSource: (request: { readonly root: string; readonly path: string }) =>
    ipcRenderer.invoke(REVEAL_ROLE_SOURCE, request) as Promise<{
      readonly revealed: boolean;
      readonly note: string;
    }>,
  startEditorLoopRun: (request: EditorLoopRunRequest) =>
    ipcRenderer.invoke(START_EDITOR_LOOP_RUN, request) as Promise<EditorLoopRunOutcome>,
  cancelEditorLoopRun: () =>
    ipcRenderer.invoke(CANCEL_EDITOR_LOOP_RUN) as Promise<EditorLoopCancelOutcome>,
  openLoopEditor: () =>
    ipcRenderer.invoke(OPEN_LOOP_EDITOR) as Promise<LoopEditorWindowOutcome>,
  onLoopRunEvent: (listener: (event: LoopRunEvent) => void) => {
    const handler = (_event: unknown, payload: LoopRunEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(LOOP_RUN_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(LOOP_RUN_EVENT, handler);
    };
  },
  currentLoopRun: () =>
    ipcRenderer.invoke(CURRENT_LOOP_RUN) as Promise<LiveRunAnnouncement | null>,
  startChatLoopRun: (request: ChatLoopRunRequest) =>
    ipcRenderer.invoke(START_CHAT_LOOP_RUN, request) as Promise<ChatLoopRunOutcome>,
  cancelChatLoopRun: () =>
    ipcRenderer.invoke(CANCEL_CHAT_LOOP_RUN) as Promise<ChatLoopCancelOutcome>,
  onChatLoopJournal: (listener: (entry: RunJournalEntry) => void) => {
    const handler = (_event: unknown, payload: RunJournalEntry): void => {
      listener(payload);
    };
    ipcRenderer.on(CHAT_LOOP_JOURNAL, handler);
    return () => {
      ipcRenderer.removeListener(CHAT_LOOP_JOURNAL, handler);
    };
  },
  onChatLoopReply: (listener: (reply: ChatLoopReply) => void) => {
    const handler = (_event: unknown, payload: ChatLoopReply): void => {
      listener(payload);
    };
    ipcRenderer.on(CHAT_LOOP_REPLY, handler);
    return () => {
      ipcRenderer.removeListener(CHAT_LOOP_REPLY, handler);
    };
  },
  onChatLoopActivity: (listener: (activity: StepActivity) => void) => {
    const handler = (_event: unknown, payload: StepActivity): void => {
      listener(payload);
    };
    ipcRenderer.on(CHAT_LOOP_ACTIVITY, handler);
    return () => {
      ipcRenderer.removeListener(CHAT_LOOP_ACTIVITY, handler);
    };
  },
  prepareChatLoop: (chosen: boolean, definitionKey: string | null) =>
    ipcRenderer.invoke(PREPARE_CHAT_LOOP, chosen, definitionKey) as Promise<ChatLoopPrepareOutcome>,
  listLoopDefinitions: () =>
    ipcRenderer.invoke(LIST_LOOP_DEFINITIONS) as Promise<LoopDefinitionListing>,
  chooseLoopDefinition: (definitionPath: string | null) =>
    ipcRenderer.invoke(
      CHOOSE_LOOP_DEFINITION,
      definitionPath,
    ) as Promise<LoopDefinitionChooseOutcome>,
  takeGraphToEdit: () => ipcRenderer.invoke(TAKE_GRAPH_TO_EDIT) as Promise<string | null>,
  onGraphToEdit: (listener: () => void) => {
    const handler = (): void => {
      listener();
    };
    ipcRenderer.on(GRAPH_TO_EDIT, handler);
    return () => {
      ipcRenderer.removeListener(GRAPH_TO_EDIT, handler);
    };
  },
  noteUnsavedDrawing: (drawing: UnsavedDrawing | null) =>
    ipcRenderer.invoke(NOTE_UNSAVED_DRAWING, drawing) as Promise<void>,
  onGraphSavedElsewhere: (listener: (saved: GraphSavedElsewhere) => void) => {
    const handler = (_event: unknown, payload: GraphSavedElsewhere): void => {
      listener(payload);
    };
    ipcRenderer.on(GRAPH_SAVED_ELSEWHERE, handler);
    return () => {
      ipcRenderer.removeListener(GRAPH_SAVED_ELSEWHERE, handler);
    };
  },
  addLoopInstruction: (request: AddLoopInstructionRequest) =>
    ipcRenderer.invoke(ADD_LOOP_INSTRUCTION, request) as Promise<AddLoopInstructionOutcome>,
  onLoopInstruction: (listener: (event: LoopInstructionEventPayload) => void) => {
    const handler = (_event: unknown, payload: LoopInstructionEventPayload): void => {
      listener(payload);
    };
    ipcRenderer.on(LOOP_INSTRUCTION_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(LOOP_INSTRUCTION_EVENT, handler);
    };
  },
  listRunRecords: (conversationId: string) =>
    ipcRenderer.invoke(LIST_RUN_RECORDS, conversationId) as Promise<
      readonly StoredRunRecordEntry[]
    >,
  requestLoopPause: () => ipcRenderer.invoke(REQUEST_LOOP_PAUSE) as Promise<LoopControlOutcome>,
  continueLoop: () => ipcRenderer.invoke(CONTINUE_LOOP) as Promise<LoopControlOutcome>,
  setLoopMode: (mode: LoopMode) =>
    ipcRenderer.invoke(SET_LOOP_MODE, mode) as Promise<LoopControlOutcome>,
  loopControl: () => ipcRenderer.invoke(READ_LOOP_CONTROL) as Promise<LoopControlReport>,
  onLoopControl: (listener: (report: LoopControlReport) => void) => {
    const handler = (_event: unknown, payload: LoopControlReport): void => {
      listener(payload);
    };
    ipcRenderer.on(LOOP_CONTROL, handler);
    return () => {
      ipcRenderer.removeListener(LOOP_CONTROL, handler);
    };
  },

  workspaceFolders: () => ipcRenderer.invoke(WORKSPACE_FOLDERS) as Promise<WorkspaceView>,
  onWorkspaceFolders: (listener: (view: WorkspaceView) => void) => {
    const handler = (_event: unknown, payload: WorkspaceView): void => {
      listener(payload);
    };
    ipcRenderer.on(WORKSPACE_FOLDERS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(WORKSPACE_FOLDERS_CHANGED, handler);
    };
  },
  addFolderToWorkspace: (folderPath?: string) =>
    ipcRenderer.invoke(ADD_WORKSPACE_FOLDER, folderPath ?? null) as Promise<WorkspaceView>,
  removeFolderFromWorkspace: (folderPath: string) =>
    ipcRenderer.invoke(REMOVE_WORKSPACE_FOLDER, folderPath) as Promise<WorkspaceView>,
  openWorkspaceFile: (filePath?: string) =>
    ipcRenderer.invoke(OPEN_WORKSPACE_FILE, filePath ?? null) as Promise<WorkspaceView>,
  saveWorkspaceFile: (filePath?: string) =>
    ipcRenderer.invoke(SAVE_WORKSPACE_FILE, filePath ?? null) as Promise<WorkspaceView>,
  readWorkspaceDirectory: (dirPath: string) =>
    ipcRenderer.invoke(READ_WORKSPACE_DIRECTORY, dirPath) as Promise<DirectoryPage>,
  readWorkspaceFile: (filePath: string) =>
    ipcRenderer.invoke(READ_WORKSPACE_FILE, filePath) as Promise<FileView>,
};

// The renderer has no Node access and no other Electron access.
contextBridge.exposeInMainWorld('dspatch', bridge);
