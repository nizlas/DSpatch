import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Capability, CapabilitySupport } from '../adapter/types';
import type {
  CancelObservations,
  ChatSessionInfo,
  ConnectionStatus,
  EnvironmentInfo,
  RendererSource,
  TestOutcome,
  TurnUsage,
  UiAgentEvent,
  WorkspaceReport,
} from '../shared/bridge';
import { runScriptedWorkflow } from './workflow-script';

const HEADING = 'DSpatch';

/** This is also the display order. The type requires all seven capabilities. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  start: 'Start run',
  streaming: 'Streaming responses',
  cancel: 'Cancel run',
  resume: 'Resume',
  modelSelection: 'Model selection',
  approvals: 'Approvals',
  usageReporting: 'Usage and cost',
};

const SUPPORT_LABEL: Record<CapabilitySupport, string> = {
  supported: 'supported',
  unsupported: 'unsupported',
  unknown: 'unknown',
};

const RENDERER_SOURCE_LABEL: Record<RendererSource, string> = {
  'dev-server': 'development server',
  'built-files': 'built files',
};

const CAPABILITIES = Object.keys(CAPABILITY_LABEL) as Capability[];

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly environment: EnvironmentInfo }
  | { readonly kind: 'error'; readonly message: string };

/** A turn as the window shows it. `status` is never inferred from silence. */
interface TurnView {
  readonly dspatchRunId: string;
  readonly prompt: string;
  answer: string;
  deltaCount: number;
  toolsStarted: number;
  toolsFinished: number;
  lastTool: string | null;
  status: 'streaming' | 'awaiting-approval' | 'finished' | 'cancelled' | 'error';
  errorMessage: string | null;
  approvalSummary: string | null;
  usage: TurnUsage | null;
  cancelRequested: boolean;
}

type Busy =
  | null
  | 'starting-session'
  | 'sending'
  | 'cancelling'
  | 'running-test'
  | 'reading-files';

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const readyReported = useRef(false);

  useEffect(() => {
    let cancelled = false;

    window.dspatch
      .getEnvironment()
      .then((environment) => {
        if (!cancelled) {
          setState({ kind: 'ready', environment });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown bridge error.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The acknowledgement is sent after rendering, not on component mount.
  // This distinguishes a live rendered window from an instantiated component.
  useEffect(() => {
    if (state.kind !== 'ready' || readyReported.current) {
      return;
    }
    readyReported.current = true;

    const frame = requestAnimationFrame(() => {
      window.dspatch.reportReady({
        headingText: HEADING,
        capabilityCount: CAPABILITIES.length,
        renderedAt: new Date().toISOString(),
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state.kind]);

  return (
    <main className="app">
      <h1 className="app__title">{HEADING}</h1>
      <p className="app__subtitle">
        A minimal chat surface over one working copy. Every provider call happens
        in the main process behind the adapter; this window reaches it only over
        IPC.
      </p>

      {state.kind === 'loading' && (
        <p className="app__note">Reading environment details from the main process …</p>
      )}

      {state.kind === 'error' && (
        <p className="app__error">
          Could not read environment details: {state.message}
        </p>
      )}

      {state.kind === 'ready' && <Workbench environment={state.environment} />}
    </main>
  );
}

function Workbench({
  environment,
}: {
  readonly environment: EnvironmentInfo;
}): JSX.Element {
  const [connection, setConnection] = useState<ConnectionStatus>({
    kind: 'checking',
  });
  const [session, setSession] = useState<ChatSessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceReport | null>(null);
  const [cancelObs, setCancelObs] = useState<CancelObservations | null>(null);
  const [prompt, setPrompt] = useState('');

  const pendingPrompt = useRef('');
  const scriptStarted = useRef(false);

  const activeTurn = turns.find((turn) => turn.status === 'streaming') ?? null;

  useEffect(() => {
    let cancelled = false;
    window.dspatch
      .getConnection()
      .then((status) => {
        if (!cancelled) {
          setConnection(status);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConnection({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
            checkedAtUtc: new Date().toISOString(),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribed before the first prompt, not after: early events would be lost.
  useEffect(() => {
    const unsubscribe = window.dspatch.onAgentEvent((event: UiAgentEvent) => {
      setTurns((previous) => applyEvent(previous, event, pendingPrompt.current));
      if (event.type === 'run.finished') {
        void window.dspatch
          .getTurnUsage(event.dspatchRunId)
          .then((usage) => {
            setTurns((previous) =>
              previous.map((turn) =>
                turn.dspatchRunId === event.dspatchRunId ? { ...turn, usage } : turn,
              ),
            );
          })
          .catch(() => {
            // A failed usage read leaves `usage` null, which the UI shows as
            // unknown. Silently showing zero would be the actual error.
          });
      }
    });
    return unsubscribe;
  }, []);

  const startSession = useCallback(async (): Promise<void> => {
    setBusy('starting-session');
    setSessionError(null);
    setActionError(null);
    setTest(null);
    setTestError(null);
    setWorkspace(null);
    setCancelObs(null);
    setTurns([]);
    try {
      setSession(await window.dspatch.startChatSession());
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const send = useCallback(async (): Promise<void> => {
    const text = prompt.trim();
    if (text === '') {
      return;
    }
    setBusy('sending');
    setActionError(null);
    pendingPrompt.current = text;
    try {
      await window.dspatch.sendPrompt(text);
      setPrompt('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [prompt]);

  const cancel = useCallback(async (): Promise<void> => {
    setBusy('cancelling');
    setActionError(null);
    setTurns((previous) =>
      previous.map((turn) =>
        turn.status === 'streaming' ? { ...turn, cancelRequested: true } : turn,
      ),
    );
    try {
      await window.dspatch.cancelRun();
      setCancelObs(await window.dspatch.getCancelObservations());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshCancelObservations = useCallback(async (): Promise<void> => {
    try {
      setCancelObs(await window.dspatch.getCancelObservations());
    } catch {
      // Leaves the previous reading in place rather than replacing it with a guess.
    }
  }, []);

  const runTest = useCallback(async (): Promise<void> => {
    setBusy('running-test');
    setTestError(null);
    setTest(null);
    try {
      setTest(await window.dspatch.runWorkspaceTest());
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const readFiles = useCallback(async (): Promise<void> => {
    setBusy('reading-files');
    setActionError(null);
    try {
      setWorkspace(await window.dspatch.getWorkspaceChanges());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, []);

  // While a cancellation watch is running, keep the panel current. The watch is
  // the only thing that can distinguish "we stopped listening" from "the provider
  // stopped", so a stale reading would be the wrong thing to leave on screen.
  useEffect(() => {
    if (cancelObs === null || !cancelObs.watching) {
      return;
    }
    const timer = setInterval(() => {
      void refreshCancelObservations();
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [cancelObs, refreshCancelObservations]);

  /**
   * The scripted workflow run.
   *
   * It operates the controls below rather than calling the bridge directly, so
   * what it proves is that the window does the work. `scriptStarted` guards
   * against React's development-mode double effect.
   */
  useEffect(() => {
    if (scriptStarted.current) {
      return;
    }
    scriptStarted.current = true;
    void window.dspatch.getScriptedRun().then((plan) => {
      if (plan === null) {
        return;
      }
      void runScriptedWorkflow(plan).then((report) => {
        window.dspatch.reportScriptedRun(report);
      });
    });
  }, []);

  return (
    <>
      <ConnectionPanel connection={connection} />

      <section className="panel">
        <h2 className="panel__title">Session</h2>
        <div className="row">
          <button
            type="button"
            className="button button--primary"
            data-ev="new-session"
            onClick={() => {
              void startSession();
            }}
            disabled={busy !== null || connection.kind !== 'connected'}
          >
            {busy === 'starting-session'
              ? 'Generating the working copy …'
              : 'New session (regenerates the test working copy)'}
          </button>
          {busy === 'starting-session' && (
            <span className="pending" data-ev="session-pending">
              working …
            </span>
          )}
        </div>
        {connection.kind !== 'connected' && (
          <p className="app__note">
            A session needs a connected account. Nothing is sent until then.
          </p>
        )}
        {sessionError !== null && (
          <p className="app__error" data-ev="session-error">
            Could not start a session: {sessionError}
          </p>
        )}
        {session === null ? (
          <p className="app__note" data-ev="session-id">
            No session open.
          </p>
        ) : (
          <dl className="facts">
            <Fact
              label="DSpatch session"
              value={session.dspatchSessionId}
              testId="session-id"
            />
            <Fact label="Provider session" value={session.providerSessionId} />
            <Fact label="Model requested" value={session.modelRequested} />
            <Fact label="Tool policy" value={session.toolPolicy} />
            <Fact
              label="Working copy"
              value={session.workspacePath}
              testId="workspace-path"
            />
            <Fact label="Working copy origin" value={session.workspaceOrigin} />
            <Fact
              label="Test runner"
              value={
                session.testRunnerPath === null
                  ? 'not found — no test can be run'
                  : `${session.testRunnerPath} (${session.testRunnerSource ?? 'unknown source'})`
              }
            />
          </dl>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Chat</h2>
        <div className="transcript" data-ev="transcript">
          {turns.length === 0 && (
            <p className="app__note">
              No turns yet. Everything sent from here goes to the provider through
              the adapter in the main process.
            </p>
          )}
          {turns.map((turn, index) => (
            <Turn key={turn.dspatchRunId} turn={turn} index={index} />
          ))}
        </div>

        <div className="composer">
          <textarea
            className="composer__input"
            data-ev="prompt"
            rows={3}
            placeholder="Ask something, or request a change to the working copy."
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            disabled={session === null}
          />
          <div className="row">
            <button
              type="button"
              className="button button--primary"
              data-ev="send"
              onClick={() => {
                void send();
              }}
              disabled={
                session === null ||
                busy !== null ||
                activeTurn !== null ||
                prompt.trim() === ''
              }
            >
              {busy === 'sending' ? 'Sending …' : 'Send'}
            </button>
            <button
              type="button"
              className="button"
              data-ev="cancel"
              onClick={() => {
                void cancel();
              }}
              disabled={activeTurn === null || busy === 'cancelling'}
            >
              {busy === 'cancelling' ? 'Cancelling …' : 'Cancel'}
            </button>
            <span className="pending" data-ev="active-status">
              {activeTurn === null
                ? 'idle'
                : activeTurn.cancelRequested
                  ? 'cancellation requested — waiting for the run to end'
                  : 'streaming …'}
            </span>
          </div>
          {actionError !== null && (
            <p className="app__error" data-ev="action-error">
              {actionError}
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Working copy on disk</h2>
        <p className="app__note">
          Differences established by hashing file bytes against the snapshot taken
          when the session opened. An agent&apos;s account of what it changed is
          not used here.
        </p>
        <div className="row">
          <button
            type="button"
            className="button"
            data-ev="read-files"
            onClick={() => {
              void readFiles();
            }}
            disabled={session === null || busy !== null}
          >
            {busy === 'reading-files' ? 'Hashing …' : 'Check files on disk'}
          </button>
        </div>
        <div data-ev="changes">
          {workspace === null ? (
            <p className="app__note">Not checked yet.</p>
          ) : (
            <>
              <p className="app__note">
                Checked {workspace.observedAtUtc} against the baseline taken{' '}
                {workspace.baselineTakenAtUtc}.{' '}
                <span data-ev="changed-count">{workspace.changed.length}</span>{' '}
                changed, <span data-ev="added-count">{workspace.added.length}</span>{' '}
                added, {workspace.removed.length} removed,{' '}
                {workspace.unchangedCount} unchanged.
              </p>
              {workspace.changed.length === 0 &&
                workspace.added.length === 0 &&
                workspace.removed.length === 0 && (
                  <p className="app__note">No file differs from the baseline.</p>
                )}
              <ul className="files">
                {workspace.changed.map((file) => (
                  <li key={`changed-${file.relPath}`} className="files__row">
                    <span className="files__path">{file.relPath}</span>
                    <span className="files__note">changed</span>
                    <code className="files__hash">
                      {short(file.beforeSha256)} → {short(file.afterSha256)}
                    </code>
                    <span className="files__note">
                      {String(file.beforeBytes)} → {String(file.afterBytes)} bytes
                    </span>
                  </li>
                ))}
                {workspace.added.map((file) => (
                  <li key={`added-${file.relPath}`} className="files__row">
                    <span className="files__path">{file.relPath}</span>
                    <span className="files__note">added</span>
                    <code className="files__hash">{short(file.afterSha256)}</code>
                    <span className="files__note">
                      {String(file.afterBytes)} bytes
                    </span>
                  </li>
                ))}
                {workspace.removed.map((file) => (
                  <li key={`removed-${file.relPath}`} className="files__row">
                    <span className="files__path">{file.relPath}</span>
                    <span className="files__note">removed</span>
                    <code className="files__hash">{short(file.beforeSha256)}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Test</h2>
        <p className="app__note">
          DSpatch starts the test as a child process, so the exit code and the
          output are DSpatch&apos;s own observation.
        </p>
        <div className="row">
          <button
            type="button"
            className="button"
            data-ev="run-test"
            onClick={() => {
              void runTest();
            }}
            disabled={
              session === null || busy !== null || session.testRunnerPath === null
            }
          >
            {busy === 'running-test' ? 'Running …' : 'Run the working copy tests'}
          </button>
          {busy === 'running-test' && (
            <span className="pending" data-ev="test-pending">
              the test is running; no result yet
            </span>
          )}
        </div>
        {testError !== null && (
          <p className="app__error" data-ev="test-error">
            {testError}
          </p>
        )}
        <div data-ev="test-result">
          {test === null ? (
            <p className="app__note">
              {busy === 'running-test' ? 'Waiting for the test to finish …' : 'Not run yet.'}
            </p>
          ) : (
            <>
              <dl className="facts">
                <Fact label="Command" value={test.command} />
                <Fact label="Working directory" value={test.cwd} />
                <Fact
                  label="Exit code"
                  value={
                    test.exitCode === null
                      ? `none — killed by signal ${test.signal ?? 'unknown'}`
                      : String(test.exitCode)
                  }
                  testId="test-exit-code"
                />
                <Fact label="Duration" value={`${String(test.durationMs)} ms`} />
              </dl>
              <pre className="output" data-ev="test-stdout">
                {test.stdout === '' ? '(no standard output)' : test.stdout}
              </pre>
              {test.stderr !== '' && (
                <pre className="output" data-ev="test-stderr">
                  {test.stderr}
                </pre>
              )}
            </>
          )}
        </div>
      </section>

      {cancelObs !== null && cancelObs.attempted && (
        <section className="panel">
          <h2 className="panel__title">After cancellation</h2>
          <p className="app__note">{cancelObs.note}</p>
          <dl className="facts">
            <Fact
              label="Verdict"
              value={
                cancelObs.watching
                  ? 'still watching — no verdict yet'
                  : VERDICT_LABEL[cancelObs.verdict]
              }
              testId="cancel-verdict"
            />
            <Fact
              label="Tool events before / after cancel"
              value={`${String(cancelObs.toolEventsBeforeCancel)} / ${String(
                cancelObs.toolEventsAfterCancel,
              )}`}
            />
            <Fact
              label="Events after the terminal event"
              value={String(cancelObs.eventsAfterTerminalEvent)}
            />
            <Fact
              label="Usage records after cancel"
              value={String(cancelObs.usageEventsAfterCancel)}
            />
            <Fact
              label="Files at cancel / after watching"
              value={`${unknownOr(cancelObs.workspaceFileCountAtCancel)} / ${unknownOr(
                cancelObs.workspaceFileCountAfterWatch,
              )}`}
            />
            <Fact
              label="Watched"
              value={`${String(cancelObs.watchedSeconds)} s`}
              testId="cancel-watched"
            />
          </dl>
        </section>
      )}

      <Environment environment={environment} connection={connection} />
    </>
  );
}

const VERDICT_LABEL: Record<CancelObservations['verdict'], string> = {
  unresolved:
    'unresolved — nothing observed either way; this does not mean the provider stopped',
  'provider-kept-working':
    'the provider kept working after DSpatch reported the run cancelled',
  'no-continued-work-observed':
    'no continued work observed, which is not the same as the provider having stopped',
};

function unknownOr(value: number | null): string {
  return value === null ? 'unknown' : String(value);
}

function short(hash: string | null): string {
  return hash === null ? '—' : `${hash.slice(0, 12)}…`;
}

function ConnectionPanel({
  connection,
}: {
  readonly connection: ConnectionStatus;
}): JSX.Element {
  return (
    <section className="panel">
      <h2 className="panel__title">
        Connection{' '}
        <span
          className={`badge badge--${CONNECTION_BADGE[connection.kind]}`}
          data-ev="connection-kind"
        >
          {connection.kind}
        </span>
      </h2>
      {connection.kind === 'checking' && (
        <p className="app__note">
          Asking the provider whether a stored login is valid … no answer yet.
        </p>
      )}
      {connection.kind === 'not-connected' && (
        <>
          <p className="app__error">{connection.reason}</p>
          <p className="app__note">
            The credential store DSpatch expects is{' '}
            <code>{connection.credentialStorePath}</code>. DSpatch never reads,
            copies or logs it.
          </p>
        </>
      )}
      {connection.kind === 'error' && (
        <p className="app__error">
          The connection check itself failed: {connection.message}
        </p>
      )}
      {connection.kind === 'connected' && (
        <dl className="facts">
          <Fact
            label="Account"
            value={connection.account ?? 'unknown — the provider did not say'}
            testId="connection-account"
          />
          <Fact label="Provider" value={connection.provider} />
          <Fact label="Backend" value={connection.backendUrl} />
          <Fact label="Model requested" value={connection.modelRequested} />
          <Fact
            label="Models available"
            value={
              connection.modelsAvailable === null
                ? 'unknown — the list was not read'
                : String(connection.modelsAvailable)
            }
            testId="connection-models"
          />
          <Fact
            label="Credential expires"
            value={connection.credentialExpiresAtUtc ?? 'unknown'}
          />
          <Fact label="Credential source" value={connection.credentialSource} />
          <Fact label="Checked" value={connection.checkedAtUtc} />
        </dl>
      )}
    </section>
  );
}

const CONNECTION_BADGE: Record<ConnectionStatus['kind'], CapabilitySupport> = {
  checking: 'unknown',
  connected: 'supported',
  'not-connected': 'unsupported',
  error: 'unsupported',
};

const TURN_STATUS_LABEL: Record<TurnView['status'], string> = {
  streaming: 'streaming …',
  'awaiting-approval': 'waiting for an approval DSpatch cannot answer',
  finished: 'finished',
  cancelled: 'cancelled',
  error: 'error',
};

function Turn({
  turn,
  index,
}: {
  readonly turn: TurnView;
  readonly index: number;
}): JSX.Element {
  const active = turn.status === 'streaming';
  return (
    <article className="turn" data-ev={`turn-${String(index)}`}>
      <p className="turn__prompt" data-ev={`turn-${String(index)}-prompt`}>
        {turn.prompt}
      </p>
      <pre
        className="turn__answer"
        data-ev={active ? 'active-answer' : `turn-${String(index)}-answer`}
      >
        {turn.answer === ''
          ? active
            ? '…'
            : '(no text in this turn)'
          : turn.answer}
      </pre>
      <p className="turn__meta">
        <span
          className={`badge badge--${turn.status === 'finished' ? 'supported' : turn.status === 'streaming' || turn.status === 'awaiting-approval' ? 'unknown' : 'unsupported'}`}
          data-ev={active ? 'active-turn-status' : `turn-${String(index)}-status`}
        >
          {TURN_STATUS_LABEL[turn.status]}
        </span>{' '}
        <span data-ev={`turn-${String(index)}-deltas`}>
          {String(turn.deltaCount)} text fragments
        </span>{' '}
        ·{' '}
        <span data-ev={active ? 'active-tools-finished' : `turn-${String(index)}-tools`}>
          {String(turn.toolsFinished)}
        </span>{' '}
        of {String(turn.toolsStarted)} tool calls finished
        {turn.lastTool !== null && <> · last tool {turn.lastTool}</>} ·{' '}
        <span data-ev={`turn-${String(index)}-tokens`}>
          {turn.usage === null
            ? active
              ? 'tokens not reported yet'
              : 'tokens unknown'
            : turn.usage.totalTokens === null
              ? 'tokens unknown'
              : `${String(turn.usage.totalTokens)} tokens`}
        </span>{' '}
        · cost unknown
      </p>
      {turn.cancelRequested && turn.status === 'streaming' && (
        <p className="pending">
          Cancellation requested. The run has not reported a terminal state yet.
        </p>
      )}
      {turn.approvalSummary !== null && (
        <p className="app__note">{turn.approvalSummary}</p>
      )}
      {turn.errorMessage !== null && (
        <p className="app__error" data-ev={`turn-${String(index)}-error`}>
          {turn.errorMessage}
        </p>
      )}
    </article>
  );
}

function Environment({
  environment,
  connection,
}: {
  readonly environment: EnvironmentInfo;
  readonly connection: ConnectionStatus;
}): JSX.Element {
  const { versions, adapter } = environment;

  return (
    <>
      <section className="panel">
        <h2 className="panel__title">Runtime environment</h2>
        <dl className="facts">
          <Fact label="Electron" value={versions.electron} />
          <Fact label="Chromium" value={versions.chromium} />
          <Fact label="Node" value={versions.node} />
          <Fact label="V8" value={versions.v8} />
          <Fact label="Platform" value={environment.platform} />
          <Fact
            label="Renderer loaded from"
            value={RENDERER_SOURCE_LABEL[environment.rendererSource]}
            testId="renderer-source"
          />
          <Fact label="App version" value={environment.appVersion} />
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          Adapter <code className="panel__code">{adapter.id}</code>
        </h2>
        <p className="app__note">
          The seven capabilities in the integration contract. These values apply
          to this adapter instance — provider plus transport — rather than
          to the provider in general.
        </p>
        <ul className="capabilities">
          {CAPABILITIES.map((capability) => {
            const support = adapter.capabilities[capability];
            return (
              <li key={capability} className="capabilities__row">
                <span className="capabilities__name">
                  {CAPABILITY_LABEL[capability]}
                </span>
                <span
                  className={`badge badge--${support}`}
                  title={`capabilities().${capability} = "${support}"`}
                >
                  {SUPPORT_LABEL[support]}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="app__note">
          Three possible values:{' '}
          <span className="badge badge--supported">
            {SUPPORT_LABEL.supported}
          </span>{' '}
          <span className="badge badge--unsupported">
            {SUPPORT_LABEL.unsupported}
          </span>{' '}
          <span className="badge badge--unknown">{SUPPORT_LABEL.unknown}</span>.
          Unknown is a valid answer and is never presented as a positive result.
        </p>
        <p className="app__note">
          Usage and cost is <span className="badge badge--unknown">unknown</span>{' '}
          for a reason: per-turn token counts arrive on the run stream, while this
          account&apos;s cost API is refused with HTTP 403. Monetary cost is
          therefore shown as <strong>unknown</strong> everywhere and never as 0.
          {connection.kind === 'connected' &&
            connection.modelsAvailable === null &&
            ' The model list could not be read this time, so that field is unknown too.'}
        </p>
      </section>
    </>
  );
}

function Fact({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
}): JSX.Element {
  return (
    <div className="facts__item">
      <dt className="facts__label">{label}</dt>
      <dd className="facts__value" {...(testId === undefined ? {} : { 'data-ev': testId })}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Fold one agent event into the visible turns.
 *
 * `run.started` is what creates a turn, because it is the first thing that
 * carries the run ID; `sendPrompt` has not resolved at that point, so the prompt
 * is taken from what the composer just submitted.
 */
function applyEvent(
  turns: readonly TurnView[],
  event: UiAgentEvent,
  submittedPrompt: string,
): TurnView[] {
  if (event.type === 'run.started') {
    return [
      ...turns,
      {
        dspatchRunId: event.dspatchRunId,
        prompt: submittedPrompt,
        answer: '',
        deltaCount: 0,
        toolsStarted: 0,
        toolsFinished: 0,
        lastTool: null,
        status: 'streaming',
        errorMessage: null,
        approvalSummary: null,
        usage: null,
        cancelRequested: false,
      },
    ];
  }
  return turns.map((turn) => {
    if (turn.dspatchRunId !== event.dspatchRunId) {
      return turn;
    }
    switch (event.type) {
      case 'assistant.delta':
        return {
          ...turn,
          answer: turn.answer + (event.text ?? ''),
          deltaCount: turn.deltaCount + 1,
        };
      case 'assistant.message':
        // The adapter emits this once at the end with the same text the deltas
        // carried. Replacing rather than appending keeps the transcript honest.
        return { ...turn, answer: event.text ?? turn.answer };
      case 'tool.started':
        return {
          ...turn,
          toolsStarted: turn.toolsStarted + 1,
          lastTool: event.toolName ?? turn.lastTool,
        };
      case 'tool.finished':
        return {
          ...turn,
          toolsFinished: turn.toolsFinished + 1,
          lastTool: event.toolName ?? turn.lastTool,
        };
      case 'approval.requested':
        return {
          ...turn,
          status: 'awaiting-approval',
          approvalSummary: event.approvalSummary ?? null,
        };
      case 'run.finished':
        return {
          ...turn,
          status:
            event.status === 'finished'
              ? 'finished'
              : event.status === 'cancelled'
                ? 'cancelled'
                : 'error',
          errorMessage: event.errorMessage ?? null,
        };
      default:
        return turn;
    }
  });
}
