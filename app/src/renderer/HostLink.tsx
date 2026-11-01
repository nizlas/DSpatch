import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { HostBrowsePage, HostLinkState, SshQuestion } from '../shared/host-link';

/**
 * The connection to a host on another machine, in every window (DSP-111). Draws nothing on a
 * local start. It says which machine the work is on and whether it can be reached; a lost
 * connection is never drawn as work having ended.
 */
export function HostLinkLine(): JSX.Element | null {
  const [state, setState] = useState<HostLinkState | null>(null);
  useEffect(() => {
    const bridge = window.dspatchHost;
    if (bridge === undefined) {
      return;
    }
    void bridge.state().then(setState);
    return bridge.onState(setState);
  }, []);
  const inPanel = new URLSearchParams(window.location.search).get('view') === 'panel';
  // The panel sits beside a window that already says it; it speaks up only when it matters.
  if (state === null || !state.remote || (inPanel && state.phase === 'connected')) {
    return null;
  }
  if (state.away === true) {
    return (
      <div className="host-link host-link--stopped" data-ev="host-link" data-phase="away">
        <span className="host-link__dot" aria-hidden="true" />
        <span>In use from another computer</span>
        <span className="host-link__note">{state.note}</span>
        <button type="button" data-ev="host-link-use-here" onClick={() => window.dspatchHost?.useHere()}>
          Use here
        </button>
      </div>
    );
  }
  if (state.here === true) {
    return (
      <div className={`host-link host-link--${state.phase}`} data-ev="host-link" data-phase={state.phase}>
        <span className="host-link__dot" aria-hidden="true" />
        <span>{state.phase === 'connected' ? 'On this computer, through the host that stays running' : 'This computer’s host stopped answering'}</span>
        {state.note !== '' && <span className="host-link__note">{state.note}</span>}
        <button type="button" data-ev="host-link-leave" title="End the host once nothing runs in it, and work in this window alone" onClick={() => window.dspatchHost?.leave()}>
          End host
        </button>
      </div>
    );
  }
  const words = state.phase === 'connected' ? `On ${state.machine}` : state.phase === 'connecting' ? `Connecting to ${state.machine}…` : state.phase === 'reconnecting' ? `Disconnected from ${state.machine}, reconnecting…` : `Disconnected from ${state.machine}`;
  return (
    <div className={`host-link host-link--${state.phase}`} data-ev="host-link" data-phase={state.phase}>
      <span className="host-link__dot" aria-hidden="true" />
      <span>{words}</span>
      {state.note !== '' && <span className="host-link__note">{state.note}</span>}
      {state.phase === 'reconnecting' && (
        <button type="button" data-ev="host-link-retry" onClick={() => window.dspatchHost?.retry()}>
          Try now
        </button>
      )}
      <button type="button" data-ev="host-link-leave" title="Close this session and work on this computer" onClick={() => window.dspatchHost?.leave()}>
        Leave
      </button>
    </div>
  );
}

/**
 * What ssh asks the person, in the main window, whenever it asks: a new machine's fingerprint, a
 * password, a one-time code, or whether to replace another version of the host. What is typed
 * goes to ssh and is not kept in this window.
 */
export function SshQuestions(): JSX.Element | null {
  const [question, setQuestion] = useState<SshQuestion | null>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => window.dspatchSetup?.onSshQuestion(setQuestion), []);
  if (question === null) {
    return null;
  }
  const answer = (value: string | null): void => {
    window.dspatchSetup?.sshAnswer(question.id, value);
    setQuestion(null);
    setTyped('');
  };
  return (
    <div className="ssh-question" role="dialog" aria-modal="true" data-ev="ssh-question" data-kind={question.kind}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          answer(question.kind === 'confirm' ? 'yes' : typed);
        }}
      >
        <p className="ssh-question__text">{question.text}</p>
        {question.kind === 'secret' && (
          <input data-ev="ssh-secret" type="password" autoFocus autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
        )}
        <div className="ssh-question__buttons">
          <button type="submit" data-ev="ssh-yes">{question.kind === 'confirm' ? 'Yes' : 'Continue'}</button>
          <button type="button" data-ev="ssh-no" onClick={() => answer(question.kind === 'confirm' ? 'no' : null)}>{question.kind === 'confirm' ? 'No' : 'Cancel'}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Choosing a folder or file on the host, in a window of its own: the paths mean something only
 * there, so the machine in front of the person is never browsed. Names only.
 */
export function HostBrowser(): JSX.Element {
  const search = new URLSearchParams(window.location.search);
  const mode = search.get('mode') ?? 'folder';
  const [page, setPage] = useState<HostBrowsePage | null>(null);
  const [fileName, setFileName] = useState('');
  const [typed, setTyped] = useState('');
  const go = (folder: string | null): void => {
    void window.dspatchHost?.browse(folder).then((next) => {
      setPage(next);
      setTyped(next.path);
    });
  };
  useEffect(() => {
    go(null);
  }, []);
  const separator = page?.path.includes('\\') === true ? '\\' : '/';
  const join = (name: string): string => `${(page?.path ?? '').replace(/[\\/]$/, '')}${separator}${name}`;
  const chosen = mode === 'folder' ? page?.path : fileName === '' ? null : join(fileName);
  return (
    <div className="host-browser" data-ev="host-browser">
      <h1>{search.get('title') ?? 'Choose on the host'}</h1>
      <form
        className="host-browser__path"
        onSubmit={(event) => {
          event.preventDefault();
          go(typed);
        }}
      >
        <input data-ev="host-browser-path" value={typed} onChange={(event) => setTyped(event.target.value)} spellCheck={false} />
        <button type="submit">Go</button>
      </form>
      {page?.error !== null && page?.error !== undefined && <p className="host-browser__error">{page.error}</p>}
      <ul className="host-browser__list">
        {page?.parent !== null && page?.parent !== undefined && (
          <li>
            <button type="button" onClick={() => go(page.parent)}>
              ..
            </button>
          </li>
        )}
        {page?.entries.map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              className={entry.kind === 'file' ? 'host-browser__file' : undefined}
              disabled={entry.kind === 'file' && mode === 'folder'}
              onClick={() => {
                if (entry.kind === 'folder') {
                  go(join(entry.name));
                } else {
                  setFileName(entry.name);
                }
              }}
            >
              {entry.kind === 'folder' ? `${entry.name}/` : entry.name}
            </button>
          </li>
        ))}
      </ul>
      {mode !== 'folder' && (
        <label className="host-browser__name">
          File
          <input data-ev="host-browser-name" value={fileName} onChange={(event) => setFileName(event.target.value)} spellCheck={false} />
        </label>
      )}
      <div className="host-browser__buttons">
        <button type="button" data-ev="host-browser-choose" disabled={chosen === null || chosen === undefined} onClick={() => window.dspatchHost?.browseDone(chosen ?? null)}>
          {mode === 'folder' ? 'Choose this folder' : mode === 'save' ? 'Save here' : 'Open'}
        </button>
        <button type="button" onClick={() => window.dspatchHost?.browseDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
