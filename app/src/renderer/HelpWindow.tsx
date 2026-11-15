import { useState, type JSX } from 'react';

import { Markdown } from './Markdown';
import remoteWindowsHost from './help/remote-windows-host.md?raw';
import type { RemoteSetupScript } from '../shared/remote-setup';

/**
 * Help → a guide, in a window of its own (`?window=help&topic=…&version=…`, DSP-211). The guides
 * are Markdown files under `help/`, built into the renderer, so they read the same in the app and
 * on GitHub and need no host or network. Code blocks get a Copy button. `{{version}}` in a guide
 * becomes this build's version, so it can name this release's downloads (DSP-214).
 */
const GUIDES: Readonly<Record<string, string>> = {
  'remote-windows-host': remoteWindowsHost,
};

/** The guides that offer to save the remote-setup scripts (DSP-214). */
const SAVES_SCRIPTS = new Set(['remote-windows-host']);

export function HelpWindow(): JSX.Element {
  const query = new URLSearchParams(window.location.search);
  const topic = query.get('topic') ?? '';
  const version = query.get('version') ?? '';
  const guide = GUIDES[topic];
  const text =
    guide === undefined
      ? '# Not found\n\nThis guide is not part of this version of DSpatch.'
      : guide.replaceAll('{{version}}', /^[0-9A-Za-z.+-]+$/.test(version) ? version : '<version>');
  const [status, setStatus] = useState('');
  const help = window.dspatchHelp;
  const save = (which: RemoteSetupScript): void => {
    if (help === undefined) {
      return;
    }
    setStatus('');
    void help.saveRemoteSetupScript(which).then(setStatus, (error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  };
  return (
    <main className="help-window" data-ev="help-window">
      {help !== undefined && SAVES_SCRIPTS.has(topic) ? (
        <div className="help-window__actions" data-ev="help-actions">
          <button type="button" onClick={() => save('windows')} data-ev="help-save-windows">
            Save Windows script…
          </button>
          <button type="button" onClick={() => save('linux')} data-ev="help-save-linux">
            Save Linux helper…
          </button>
          {status === '' ? null : (
            <span className="help-window__status" role="status">
              {status}
            </span>
          )}
        </div>
      ) : null}
      <Markdown text={text} copyCode testId={`help-${topic}`} />
    </main>
  );
}
