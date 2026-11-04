import type { ProviderLoginStep } from './bridge';
import type { HostBuildDifference } from './remote-protocol';

/*
 * What a window knows of the connection to a host on another machine (DSP-111), and the
 * chooser that browses that machine. Types only: the renderer imports this too.
 */

export type HostLinkPhase = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface HostLinkState {
  /** `false` on an ordinary local start, where there is nothing to show. */
  readonly remote: boolean;
  readonly phase: HostLinkPhase;
  /** The machine the host says it is, or the address before it has. */
  readonly machine: string;
  readonly address: string;
  /** What was found out. Empty when there is nothing to add. */
  readonly note: string;
  /** This machine's own host, which stays running: reached without SSH (DSP-161). */
  readonly here?: boolean;
  /** Handed over: another computer is using this machine's work now. */
  readonly away?: boolean;
  /**
   * The host reached is another build than this window (DSP-165, DSP-169): an update waiting
   * for the host to be restarted, or another build of the same version. Absent while the host
   * is this build, and while the connection is not up.
   */
  readonly build?: HostBuildDifference;
}

export interface HostBrowseEntry {
  readonly name: string;
  readonly kind: 'folder' | 'file';
}

export interface HostBrowsePage {
  readonly path: string;
  /** `null` at the top. */
  readonly parent: string | null;
  readonly entries: readonly HostBrowseEntry[];
  /** Why the folder could not be read; `entries` is then empty. */
  readonly error: string | null;
}

/** On `window.dspatchHost`, in every window. */
export interface HostLinkBridge {
  state(): Promise<HostLinkState>;
  onState(listener: (state: HostLinkState) => void): () => void;
  retry(): void;
  /** Connect to a host by address and token. Answers only if it could not. */
  connect(address: string, token: string): Promise<string>;
  /** Leave the remote session and work on this computer. */
  leave(): void;
  /** After a handover: use this computer's work here again. */
  useHere(): void;
  browse(folder: string | null): Promise<HostBrowsePage>;
  browseDone(chosen: string | null): void;
}

/** One thing ssh needs from the person. */
export interface SshQuestion {
  readonly id: number;
  readonly kind: 'secret' | 'confirm';
  readonly text: string;
}

/** On `window.dspatchSetup`, in the main window (DSP-153). */
export interface SetupBridge {
  sshConnect(target: string): Promise<string>;
  sshRecent(): Promise<readonly string[]>;
  sshAnswer(id: number, answer: string | null): void;
  /** Whether a window should open the connection form, once: a saved tunnel that no longer answers. */
  takeRemoteFormRequest(): Promise<boolean>;
  onSshStatus(listener: (text: string) => void): () => void;
  onSshQuestion(listener: (question: SshQuestion) => void): () => void;
  providerCall<T>(method: string, argument?: unknown): Promise<T>;
  onProviderStep(listener: (update: { readonly tool: 'claude' | 'copilot'; readonly step: ProviderLoginStep }) => void): () => void;
  openLink(url: string): Promise<void>;
}
