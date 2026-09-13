import { contextBridge, ipcRenderer } from 'electron';

import type {
  BridgeChannel,
  DspatchBridge,
  EnvironmentInfo,
  RendererReady,
} from '../shared/bridge';

// Sandboxed preload: only Electron modules may be imported as values.
// Channel names are therefore typed literals so misspellings are caught.
const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';

const bridge: DspatchBridge = {
  getEnvironment: () =>
    ipcRenderer.invoke(GET_ENVIRONMENT) as Promise<EnvironmentInfo>,
  reportReady: (ready: RendererReady) => {
    ipcRenderer.send(RENDERER_READY, ready);
  },
};

// The renderer has no Node access and no other Electron access.
contextBridge.exposeInMainWorld('dspatch', bridge);
