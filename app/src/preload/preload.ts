import { contextBridge, ipcRenderer } from 'electron';

import type {
  BridgeChannel,
  CancelObservations,
  CancelOutcome,
  ChatSessionInfo,
  ConnectionStatus,
  DspatchBridge,
  EnvironmentInfo,
  RendererReady,
  ScriptedRunPlan,
  ScriptedRunReport,
  TestOutcome,
  TurnUsage,
  UiAgentEvent,
  WorkspaceReport,
} from '../shared/bridge';

// Sandboxed preload: only Electron modules may be imported as values.
// Channel names are therefore typed literals so misspellings are caught.
const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';
const GET_CONNECTION: BridgeChannel = 'dspatch:get-connection';
const START_SESSION: BridgeChannel = 'dspatch:start-session';
const SEND_PROMPT: BridgeChannel = 'dspatch:send-prompt';
const CANCEL_RUN: BridgeChannel = 'dspatch:cancel-run';
const CANCEL_OBSERVATIONS: BridgeChannel = 'dspatch:cancel-observations';
const RUN_TEST: BridgeChannel = 'dspatch:run-test';
const WORKSPACE_CHANGES: BridgeChannel = 'dspatch:workspace-changes';
const TURN_USAGE: BridgeChannel = 'dspatch:turn-usage';
const AGENT_EVENT: BridgeChannel = 'dspatch:agent-event';
const GET_SCRIPTED_RUN: BridgeChannel = 'dspatch:get-scripted-run';
const SCRIPTED_RUN_REPORT: BridgeChannel = 'dspatch:scripted-run-report';

const bridge: DspatchBridge = {
  getEnvironment: () =>
    ipcRenderer.invoke(GET_ENVIRONMENT) as Promise<EnvironmentInfo>,
  reportReady: (ready: RendererReady) => {
    ipcRenderer.send(RENDERER_READY, ready);
  },

  getConnection: () =>
    ipcRenderer.invoke(GET_CONNECTION) as Promise<ConnectionStatus>,
  startChatSession: () =>
    ipcRenderer.invoke(START_SESSION) as Promise<ChatSessionInfo>,
  sendPrompt: (text: string) =>
    ipcRenderer.invoke(SEND_PROMPT, text) as Promise<{
      readonly dspatchRunId: string;
    }>,
  cancelRun: () => ipcRenderer.invoke(CANCEL_RUN) as Promise<CancelOutcome>,
  getCancelObservations: () =>
    ipcRenderer.invoke(CANCEL_OBSERVATIONS) as Promise<CancelObservations>,
  runWorkspaceTest: () => ipcRenderer.invoke(RUN_TEST) as Promise<TestOutcome>,
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
};

// The renderer has no Node access and no other Electron access.
contextBridge.exposeInMainWorld('dspatch', bridge);
