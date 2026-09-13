import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Capability, CapabilitySupport } from '../adapter/types';
import type { EnvironmentInfo, RendererSource } from '../shared/bridge';

const HEADING = 'DSpatch';

/** Ordningen här är också visningsordningen. Typen kräver alla sju förmågorna. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  start: 'Starta körning',
  streaming: 'Strömmande svar',
  cancel: 'Avbryta körning',
  resume: 'Återupptagning',
  modelSelection: 'Modellval',
  approvals: 'Godkännanden',
  usageReporting: 'Förbrukning och kostnad',
};

const SUPPORT_LABEL: Record<CapabilitySupport, string> = {
  supported: 'stöds',
  unsupported: 'stöds inte',
  unknown: 'okänt',
};

const RENDERER_SOURCE_LABEL: Record<RendererSource, string> = {
  'dev-server': 'utvecklingsserver',
  'built-files': 'byggda filer',
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
              error instanceof Error ? error.message : 'Okänt fel från bryggan.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Kvittensen skickas efter att innehållet målats, inte när komponenten
  // monterats. Det är skillnaden mellan ett fönster som lever och ett som bara
  // instansierats.
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
        Körbart skelett. Ingen agentleverantör är ansluten: adaptern finns som
        gränssnitt och anropar ingenting.
      </p>

      {state.kind === 'loading' && (
        <p className="app__note">Läser miljöuppgifter från huvudprocessen …</p>
      )}

      {state.kind === 'error' && (
        <p className="app__error">
          Kunde inte läsa miljöuppgifter: {state.message}
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
        <h2 className="panel__title">Körmiljö</h2>
        <dl className="facts">
          <Fact label="Electron" value={versions.electron} />
          <Fact label="Chromium" value={versions.chromium} />
          <Fact label="Node" value={versions.node} />
          <Fact label="V8" value={versions.v8} />
          <Fact label="Plattform" value={environment.platform} />
          <Fact
            label="Renderaren laddad från"
            value={RENDERER_SOURCE_LABEL[environment.rendererSource]}
          />
          <Fact label="Appversion" value={environment.appVersion} />
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          Adaptern <code className="panel__code">{adapter.id}</code>
        </h2>
        <p className="app__note">
          De sju förmågorna i integrationskontraktet. Värdet gäller denna
          adapterinstans — leverantör plus transport — inte en leverantör i
          allmänhet.
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
          Tre möjliga värden:{' '}
          <span className="badge badge--supported">
            {SUPPORT_LABEL.supported}
          </span>{' '}
          <span className="badge badge--unsupported">
            {SUPPORT_LABEL.unsupported}
          </span>{' '}
          <span className="badge badge--unknown">{SUPPORT_LABEL.unknown}</span>.
          Okänt är ett giltigt svar och visas aldrig som ett positivt resultat.
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
