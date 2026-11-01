import { useEffect, useRef, useState, type JSX } from 'react';

import type { ProviderLoginStep, ProviderSetupState } from '../shared/bridge';
import { providerName, setupSteps, type SetupStep } from '../shared/provider-ready';

/**
 * Getting Claude or Copilot ready (DSP-155): one dialog, one Continue, and then whatever is
 * needed in order, on the machine where the work runs. Nothing shows when nothing is needed.
 *
 * The state is read again after each step, so a valid login found once the program is there is
 * reused rather than asked for. Sign-in is the vendor's own page, opened on this computer; the
 * vendor's program reports when it is finished. Closing here only reports back: nothing is sent.
 */

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ask'; readonly state: ProviderSetupState }
  | { readonly kind: 'working' }
  | { readonly kind: 'failed'; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Error: /, '') : String(error);
}

export function ProviderSetupDialog({
  provider,
  startAtOnce,
  onDone,
  onCancel,
}: {
  readonly provider: 'claude' | 'copilot';
  /** The person has already asked, with a Repair or Sign in button: no Continue in between. */
  readonly startAtOnce: boolean;
  /** Ready. `shown` says whether the person went through the dialog. */
  readonly onDone: (shown: boolean) => void;
  readonly onCancel: () => void;
}): JSX.Element | null {
  const bridge = window.dspatchSetup;
  const name = providerName(provider);
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [fetched, setFetched] = useState<{ readonly done: number; readonly total: number } | null>(null);
  const [link, setLink] = useState<{ readonly url: string; readonly code?: string } | null>(null);
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState(`Preparing ${name}…`);
  const closed = useRef(false);
  const loginEnded = useRef<((step: ProviderLoginStep) => void) | null>(null);

  const call = <T,>(method: string, argument?: unknown): Promise<T> => {
    if (bridge === undefined) {
      return Promise.reject(new Error('Setup is not available here.'));
    }
    return bridge.providerCall<T>(method, argument);
  };

  const signIn = (): Promise<void> =>
    new Promise((resolve, reject) => {
      setStatus(`Waiting for you to sign in to ${name}…`);
      setLink(null);
      setAskedFor(null);
      loginEnded.current = (step) => {
        loginEnded.current = null;
        if (step.kind === 'done') {
          resolve();
        } else {
          reject(new Error(step.kind === 'failed' ? step.message : 'The sign-in did not finish.'));
        }
      };
      call('provider.loginStart', provider).catch(reject);
    });

  const run = async (): Promise<void> => {
    setPhase({ kind: 'working' });
    setStatus(`Preparing ${name}…`);
    const handled = new Set<SetupStep>();
    try {
      for (;;) {
        const state = await call<ProviderSetupState>('provider.status', provider);
        if (closed.current) {
          return;
        }
        const next = setupSteps(state)[0];
        if (next === undefined) {
          closed.current = true;
          onDone(true);
          return;
        }
        if (handled.has(next)) {
          throw new Error(next === 'sign-in' ? 'The sign-in did not finish.' : `${name} could not be prepared.`);
        }
        handled.add(next);
        if (next === 'consent') {
          await call('provider.acceptClaude');
        } else if (next === 'sign-in') {
          await signIn();
          setLink(null);
          setAskedFor(null);
          setStatus(`Preparing ${name}…`);
        } else {
          await call('provider.install', provider);
          setFetched(null);
        }
        if (closed.current) {
          return;
        }
      }
    } catch (error) {
      if (!closed.current) {
        setFetched(null);
        setPhase({ kind: 'failed', message: messageOf(error) });
      }
    }
  };

  useEffect(() => {
    let current = true;
    const stopListening = bridge?.onProviderStep(({ tool, step }) => {
      if (tool !== provider) {
        return;
      }
      if (step.kind === 'fetching') {
        setFetched({ done: step.done, total: step.total });
      } else if (step.kind === 'open-url') {
        setLink(step);
      } else if (step.kind === 'input') {
        setAskedFor(step.prompt);
      } else {
        loginEnded.current?.(step);
      }
    });
    void call<ProviderSetupState>('provider.status', provider).then(
      (state) => {
        if (!current) {
          return;
        }
        if (setupSteps(state).length === 0) {
          closed.current = true;
          onDone(false);
        } else if (startAtOnce) {
          void run();
        } else {
          setPhase({ kind: 'ask', state });
        }
      },
      (error: unknown) => {
        if (current) {
          setPhase({ kind: 'failed', message: messageOf(error) });
        }
      },
    );
    return () => {
      current = false;
      stopListening?.();
    };
    // One dialog for one request: it is keyed by the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = (): void => {
    closed.current = true;
    void call('provider.installCancel', provider).catch(() => undefined);
    void call('provider.loginCancel').catch(() => undefined);
    onCancel();
  };

  if (phase.kind === 'checking') {
    return (
      <p className="setup-checking" role="status" data-ev="provider-checking">
        Checking {name}…
      </p>
    );
  }
  const repairing = phase.kind === 'ask' && setupSteps(phase.state).includes('repair');
  return (
    <div className="dialog-backdrop" data-ev="provider-setup">
      <div className="dialog dialog--setup" role="dialog" aria-modal="true" aria-label={`Get started with ${name}`}>
        <div className="dialog__head">
          <h2 className="dialog__title">{repairing || startAtOnce ? name : `Get started with ${name}`}</h2>
        </div>
        {phase.kind === 'ask' && (
          <>
            <p className="setup__text" data-ev="provider-intro">
              {repairing ? `${name} support needs repair. Your sign-in and conversations are kept.` : `DSpatch fetches what ${name} needs and connects your account.`}
            </p>
            {!phase.state.consent && (
              <p className="setup__text setup__text--quiet" data-ev="claude-consent-text">
                DSpatch runs Claude Code on {phase.state.machine}, signed in to your own account. Anthropic&apos;s terms apply, and no API key is used.
              </p>
            )}
          </>
        )}
        {phase.kind === 'working' && (
          <>
            <p className="setup__text" role="status" data-ev="provider-status">
              {status}
            </p>
            {fetched !== null && <progress className="setup__progress" data-ev="provider-progress" value={fetched.done} max={fetched.total} />}
          </>
        )}
        {phase.kind === 'working' && link !== null && (
          <div className="setup__login" data-ev="provider-link">
            {link.code !== undefined && (
              <p className="setup__code-line">
                <code className="setup__code" data-ev="provider-code">
                  {link.code}
                </code>
                <button type="button" className="button button--quiet" data-ev="provider-copy" onClick={() => void navigator.clipboard.writeText(link.code ?? '')}>
                  Copy
                </button>
              </p>
            )}
            <button type="button" className="button" data-ev="provider-open" onClick={() => void bridge?.openLink(link.url)}>
              Open the sign-in page
            </button>
          </div>
        )}
        {phase.kind === 'working' && askedFor !== null && (
          <form
            className="setup__answer"
            onSubmit={(event) => {
              event.preventDefault();
              void call('provider.loginAnswer', typed);
              setTyped('');
            }}
          >
            <label>
              If the page gives you a code, paste it here
              <input data-ev="provider-input" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
            </label>
            <button type="submit" className="button button--quiet" disabled={typed.trim() === ''}>
              Send
            </button>
          </form>
        )}
        {phase.kind === 'failed' && (
          <p className="setup__text setup__text--problem" role="alert" data-ev="provider-problem">
            {phase.message}
          </p>
        )}
        <div className="setup__buttons">
          <button type="button" className="button button--quiet" data-ev="provider-cancel" onClick={cancel}>
            Cancel
          </button>
          {phase.kind !== 'working' && (
            <button type="button" className="button" data-ev="provider-continue" onClick={() => void run()}>
              {phase.kind === 'failed' ? 'Try again' : repairing ? 'Repair' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
