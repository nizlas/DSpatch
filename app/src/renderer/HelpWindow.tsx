import type { JSX } from 'react';

import { Markdown } from './Markdown';
import remoteWindowsHost from './help/remote-windows-host.md?raw';

/**
 * Help → a guide, in a window of its own (`?window=help&topic=…`, DSP-211). The guides are
 * Markdown files under `help/`, built into the renderer, so they read the same in the app and
 * on GitHub and need no host or network. Code blocks get a Copy button.
 */
const GUIDES: Readonly<Record<string, string>> = {
  'remote-windows-host': remoteWindowsHost,
};

export function HelpWindow(): JSX.Element {
  const topic = new URLSearchParams(window.location.search).get('topic') ?? '';
  const text = GUIDES[topic] ?? '# Not found\n\nThis guide is not part of this version of DSpatch.';
  return (
    <main className="help-window" data-ev="help-window">
      <Markdown text={text} copyCode testId={`help-${topic}`} />
    </main>
  );
}
