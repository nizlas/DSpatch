import { contextBridge, ipcRenderer } from 'electron';

import type {
  BridgeChannel,
  DspatchBridge,
  EnvironmentInfo,
  RendererReady,
} from '../shared/bridge';

// Sandlådad preload: bara Electrons egna moduler får importeras som värden.
// Kanalnamnen står därför som literaler, typade så att ett stavfel fångas.
const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';

const bridge: DspatchBridge = {
  getEnvironment: () =>
    ipcRenderer.invoke(GET_ENVIRONMENT) as Promise<EnvironmentInfo>,
  reportReady: (ready: RendererReady) => {
    ipcRenderer.send(RENDERER_READY, ready);
  },
};

// Renderaren når ingenting av Node och ingenting av Electron utöver detta.
contextBridge.exposeInMainWorld('dspatch', bridge);
