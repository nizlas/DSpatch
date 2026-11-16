import { useRef, useState, type JSX } from 'react';

import { Markdown } from './Markdown';
import remoteWindowsHost from './help/remote-windows-host.md?raw';
import remoteWindowsHostHowItWorks from './help/remote-windows-host.how-it-works.md?raw';
import remoteWindowsHostManual from './help/remote-windows-host.manual.md?raw';
import remoteWindowsHostOtherWays from './help/remote-windows-host.other-ways.md?raw';
import remoteWindowsHostTested from './help/remote-windows-host.tested.md?raw';
import remoteWindowsHostTroubleshooting from './help/remote-windows-host.troubleshooting.md?raw';
import type { RemoteSetupScript } from '../shared/remote-setup';

/**
 * Help → a guide, in a window of its own (`?window=help&topic=…&version=…`, DSP-211). The guides
 * are Markdown files under `help/`, built into the renderer, so they read the same in the app and
 * on GitHub and need no host or network. Code blocks get a Copy button. `{{version}}` in a guide
 * becomes this build's version, so it can name this release's downloads (DSP-214).
 *
 * A guide opens on its first view, the steps a person follows; everything else, such as manual
 * setup and troubleshooting, is a view of its own behind a link below the steps, with a way back
 * (DSP-215). The window still never navigates: a view is state, not a page.
 */
interface HelpView {
  readonly id: string;
  /** The link's text below the first view. */
  readonly label: string;
  readonly text: string;
  /** Whether this view offers to save the remote-setup scripts (DSP-214). */
  readonly savesScripts?: boolean;
}

const GUIDES: Readonly<Record<string, readonly HelpView[]>> = {
  'remote-windows-host': [
    { id: 'steps', label: 'The three steps', text: remoteWindowsHost },
    { id: 'troubleshooting', label: 'Troubleshooting', text: remoteWindowsHostTroubleshooting },
    { id: 'other-ways', label: 'Other ways to run the scripts', text: remoteWindowsHostOtherWays, savesScripts: true },
    { id: 'manual', label: 'Manual setup', text: remoteWindowsHostManual },
    { id: 'how-it-works', label: 'How it works', text: remoteWindowsHostHowItWorks },
    { id: 'tested', label: 'What has been tested', text: remoteWindowsHostTested },
  ],
};

export function HelpWindow(): JSX.Element {
  const query = new URLSearchParams(window.location.search);
  const topic = query.get('topic') ?? '';
  const version = query.get('version') ?? '';
  const views = GUIDES[topic];
  const [viewId, setViewId] = useState(views?.[0]?.id ?? '');
  const [status, setStatus] = useState('');
  const scroller = useRef<HTMLElement>(null);
  const first = views?.[0];
  const view = views?.find((candidate) => candidate.id === viewId) ?? first;
  const text =
    view === undefined
      ? '# Not found\n\nThis guide is not part of this version of DSpatch.'
      : view.text.replaceAll('{{version}}', /^[0-9A-Za-z.+-]+$/.test(version) ? version : '<version>');
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
  const show = (id: string): void => {
    setStatus('');
    setViewId(id);
    scroller.current?.scrollTo(0, 0);
  };
  const onFirst = view === first;
  return (
    <main ref={scroller} className="help-window" data-ev="help-window" data-view={view?.id}>
      {onFirst || first === undefined ? null : (
        <nav className="help-window__back">
          <button type="button" className="help-window__link" onClick={() => show(first.id)} data-ev="help-back">
            ← {first.label}
          </button>
        </nav>
      )}
      {help !== undefined && view?.savesScripts === true ? (
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
      {onFirst && views !== undefined && views.length > 1 ? (
        <nav className="help-window__more" data-ev="help-more">
          <span className="help-window__more-title">If something does not fit</span>
          {views.slice(1).map((other) => (
            <button
              key={other.id}
              type="button"
              className="help-window__link"
              onClick={() => show(other.id)}
              data-ev={`help-view-${other.id}`}
            >
              {other.label}
            </button>
          ))}
        </nav>
      ) : null}
    </main>
  );
}
