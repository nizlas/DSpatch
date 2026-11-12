import type { RemoteBuild } from '../shared/remote-protocol';

/**
 * DSP-200: what About DSpatch says. The app's version is the installed package's own
 * (`app.getVersion()`, from its package.json); the host's is what the running host said of
 * itself when this window connected, because a host an earlier version started may still be
 * running after an upgrade. A host that has said nothing is "not known", never this app's version.
 * The instruction version and the host contract are other things and are not shown here.
 */
export function aboutText(appVersion: string, appCommit: string, host: RemoteBuild | null): string {
  const named = (version: string, commit: string): string => (commit === '' || commit === 'unknown' ? version : `${version} (${commit})`);
  const hostLine =
    host === null || host.appVersion === '' || host.appVersion === '0.0.0'
      ? 'Running host: not known (no connected host has reported its version)'
      : `Running host: ${named(host.appVersion, host.commit)}`;
  return [`DSpatch ${named(appVersion, appCommit)}`, hostLine].join('\n');
}

/** The start window's title, with the installed version beside the name. */
export function mainWindowTitle(appVersion: string): string {
  return `DSpatch — ${appVersion}`;
}
