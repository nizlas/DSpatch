import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Capability, CapabilitySupport } from '../adapter/types';
import type { EnvironmentInfo, RendererSource } from '../shared/bridge';

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
        Runnable skeleton. No agent provider is connected: the adapter defines
        an interface and makes no provider calls.
      </p>

      {state.kind === 'loading' && (
        <p className="app__note">Reading environment details from the main process …</p>
      )}

      {state.kind === 'error' && (
        <p className="app__error">
          Could not read environment details: {state.message}
        </p>
      )}

      {state.kind === 'ready' && <Environment environment={state.environment} />}
    </main>
  );
}

function Environment({
  environment,
}: {
  readonly environment: EnvironmentInfo;
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
      </section>
    </>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="facts__item">
      <dt className="facts__label">{label}</dt>
      <dd className="facts__value">{value}</dd>
    </div>
  );
}
