/**
 * The scripts that prepare a Windows host and a Linux client for a Remote Session (DSP-214). They
 * live in `app/remote-setup/`, travel in the installed client's `bundled/remote-setup/`, and are
 * published with each release. Help saves a copy of one of them where the person chooses; these two
 * names are all it may save.
 */
export const REMOTE_SETUP_SCRIPTS = {
  windows: 'dspatch-prepare-windows-host.ps1',
  linux: 'dspatch-prepare-linux-client.sh',
} as const;

export type RemoteSetupScript = keyof typeof REMOTE_SETUP_SCRIPTS;

export const SAVE_REMOTE_SETUP_CHANNEL = 'dspatch:help-save-remote-setup';

/** What the Help window may ask of the main process. Set by the main preload. */
export interface HelpBridge {
  /** Ask where to save the script, and save it. The answer is a line to show; empty when cancelled. */
  saveRemoteSetupScript(which: RemoteSetupScript): Promise<string>;
}
