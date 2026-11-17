import { useEffect, useState } from 'react';

import type { ModelClassSettings, ModelListing, StoredSessionProvider } from '../shared/bridge';
import { MODEL_CLASSES, RUN_PROVIDER_NAMES, sharedClassModels, type ModelClass } from '../shared/loop-graph';

/**
 * DSP-223: the app-wide model class setting. For each agent, which model the classes small,
 * medium and large run, chosen from the same list the chat offers, or "Use chat model". Graphs
 * name only a class; this is where a class gets a model. It changes no agent, and a run already
 * going keeps the mapping it started with.
 */
const PROVIDERS: readonly StoredSessionProvider[] = ['cursor', 'claude', 'copilot'];
const CLASS_HINTS: Readonly<Record<ModelClass, string>> = {
  small: 'For straightforward, well-bounded steps.',
  medium: 'For ordinary steps that follow established patterns.',
  large: 'For complex or uncertain steps.',
};

export function ModelClassDialog({
  initialProvider,
  onClose,
  onChanged,
}: {
  readonly initialProvider: StoredSessionProvider | null;
  readonly onClose: () => void;
  /** The setting was saved; the window re-reads what a run would use. */
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [provider, setProvider] = useState<StoredSessionProvider>(initialProvider ?? 'copilot');
  const [settings, setSettings] = useState<ModelClassSettings | null>(null);
  const [listings, setListings] = useState<Partial<Record<StoredSessionProvider, ModelListing | string>>>({});
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void window.dspatch.readModelClasses().then(setSettings, (error: unknown) => setNote(`The setting could not be read: ${String(error)}`));
  }, []);
  useEffect(() => {
    if (listings[provider] !== undefined) {
      return;
    }
    // The chat's own list for this agent, read the way the chat reads it.
    void window.dspatch.listModels(provider).then(
      (listing) => setListings((now) => ({ ...now, [provider]: listing })),
      (error: unknown) => setListings((now) => ({ ...now, [provider]: `The model list could not be read: ${String(error)}` })),
    );
  }, [provider, listings]);

  const listing = listings[provider];
  const mapping = settings?.mappings[provider] ?? {};
  const models = typeof listing === 'object' ? listing.models.filter((model) => model.providerDefault !== true) : [];
  const chatModel = typeof listing === 'object' ? listing.chosen : '';
  const shared = sharedClassModels(mapping);

  const choose = (modelClass: ModelClass, model: string | null): void => {
    void window.dspatch.setModelClass(provider, modelClass, model).then(
      (next) => {
        setSettings(next);
        setNote(null);
        onChanged();
      },
      (error: unknown) => setNote(`Not saved: ${String(error)}`),
    );
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog model-classes" role="dialog" aria-label="Model classes" data-ev="model-classes">
        <h2>Model classes</h2>
        <p>
          A graph step can ask for a model class: small, medium or large. Here each agent's classes get a
          model from the list the chat offers for that agent. <strong>Use chat model</strong> runs the model
          chosen in the chat. The classes say how capable a step is meant to be, not how large a model is.
          A change applies from the next run; a run in progress keeps what it started with. The agent that
          runs a graph is still the one chosen in the chat.
        </p>
        <div className="model-classes__tabs" role="tablist" aria-label="Agent">
          {PROVIDERS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={provider === name}
              className={provider === name ? 'model-classes__tab model-classes__tab--on chosen' : 'model-classes__tab'}
              data-ev={`model-classes-${name}`}
              onClick={() => setProvider(name)}
            >
              {RUN_PROVIDER_NAMES[name]}
              {name === initialProvider ? ' (runs graphs now)' : ''}
            </button>
          ))}
        </div>
        {listing === undefined ? <p className="muted">Reading {RUN_PROVIDER_NAMES[provider]}'s model list…</p> : null}
        {typeof listing === 'string' ? <p className="muted" data-ev="model-classes-list-error">{listing}</p> : null}
        {typeof listing === 'object' && listing.error !== null ? (
          <p className="muted" data-ev="model-classes-list-error">{listing.error}</p>
        ) : null}
        {typeof listing === 'object' && listing.error === null && models.length === 0 ? (
          <p className="muted" data-ev="model-classes-list-empty">
            {RUN_PROVIDER_NAMES[provider]} listed no named models for this account in this launch, so only the
            chat's model can be chosen here. A class saved with a model that is not in the agent's list is refused
            before a run starts, never replaced by another model.
          </p>
        ) : null}
        {MODEL_CLASSES.map((modelClass) => {
          const current = mapping[modelClass] ?? '';
          const unlisted = current !== '' && !models.some((model) => model.id === current);
          return (
            <label key={modelClass} className="model-classes__row" data-ev={`model-class-${modelClass}`}>
              <span className="model-classes__name">
                {modelClass}
                <span className="muted"> — {CLASS_HINTS[modelClass]}</span>
              </span>
              <select
                value={current}
                disabled={settings === null}
                onChange={(event) => choose(modelClass, event.target.value === '' ? null : event.target.value)}
              >
                <option value="">Use chat model{chatModel === '' ? '' : ` (${chatModel})`}</option>
                {unlisted ? <option value={current}>{current} (not in the list read now)</option> : null}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName === model.id ? model.id : `${model.displayName} (${model.id})`}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {shared.length === 0 ? null : (
          <p className="model-classes__shared" data-ev="model-classes-shared">
            {shared.map((entry) => `${entry.classes.join(' and ')} use the same model, ${entry.model}.`).join(' ')} Steps of
            those classes then run alike.
          </p>
        )}
        {note === null ? null : <p className="muted" data-ev="model-classes-note">{note}</p>}
        <div className="dialog-actions">
          <button type="button" data-ev="model-classes-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
