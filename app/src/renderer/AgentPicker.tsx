/**
 * Choosing the agent and model for agent work in review (DSP-152): preparing code walks
 * and a delegated review. Used by the diff window and the walk window alike.
 *
 * The agents are those the host says can be used in this launch, each with the model it
 * would use now (the same choice as the chat and the review discussion); the models come
 * from the provider's own listing through the discussion's existing bridge. Nothing is
 * started here: the caller starts the work with what was chosen.
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { ModelChoice } from '../shared/bridge';
import type { ReviewAgentOption } from '../shared/review-pair';

export interface AgentChoice {
  readonly provider: 'cursor' | 'claude';
  readonly model: string;
}

function providerName(provider: 'cursor' | 'claude'): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

export function AgentPicker({
  action,
  busy,
  onStart,
  onCancel,
  testId,
}: {
  /** The button's words: "Prepare code walks", "Delegate". */
  readonly action: string;
  readonly busy: boolean;
  readonly onStart: (choice: AgentChoice) => void;
  readonly onCancel: () => void;
  readonly testId: string;
}): JSX.Element {
  const [options, setOptions] = useState<readonly ReviewAgentOption[] | null>(null);
  const [provider, setProvider] = useState<'cursor' | 'claude' | null>(null);
  const [models, setModels] = useState<readonly ModelChoice[]>([]);
  const [model, setModel] = useState('');
  const [listNote, setListNote] = useState('');

  useEffect(() => {
    void window.dspatchReviewPair?.agents().then((answer) => {
      setOptions(answer);
      const first = answer.find((option) => option.choosable);
      if (first !== undefined) {
        setProvider(first.provider);
        setModel(first.model);
      }
    });
  }, []);

  useEffect(() => {
    if (provider === null) {
      return;
    }
    const option = options?.find((entry) => entry.provider === provider);
    setModel(option?.model ?? '');
    setModels([]);
    setListNote('');
    void window.dspatchReviewDiscussion?.listModels(provider).then(
      (listing) => {
        setModels(listing.models);
        if (listing.error !== null) {
          setListNote(listing.error);
        }
      },
      () => {
        setListNote('The list of models could not be read; the current model is used.');
      },
    );
  }, [provider, options]);

  if (options === null) {
    return <div className="rv-agent-picker" data-ev={testId}>Reading the agents…</div>;
  }
  const usable = options.filter((option) => option.choosable);
  if (usable.length === 0) {
    return (
      <div className="rv-agent-picker" data-ev={testId}>
        <span className="rv-pair-muted">No agent can be used here: {options.map((option) => option.reason ?? '').filter((reason) => reason !== '').join(' ')}</span>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  const known = models.some((entry) => entry.id === model);
  return (
    <div className="rv-agent-picker" data-ev={testId}>
      <label>
        Agent
        <select data-ev={`${testId}-provider`} value={provider ?? ''} onChange={(event) => setProvider(event.target.value as 'cursor' | 'claude')}>
          {options.map((option) => (
            <option key={option.provider} value={option.provider} disabled={!option.choosable} title={option.reason ?? undefined}>
              {providerName(option.provider)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        {models.length > 0 ? (
          <select data-ev={`${testId}-model`} value={known ? model : ''} onChange={(event) => setModel(event.target.value)}>
            {!known && <option value="">{model === '' ? 'Choose a model' : model}</option>}
            {models.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.description}>
                {entry.displayName}
              </option>
            ))}
          </select>
        ) : (
          <input data-ev={`${testId}-model`} value={model} onChange={(event) => setModel(event.target.value)} />
        )}
      </label>
      <button
        type="button"
        className="rv-pair-primary"
        data-ev={`${testId}-start`}
        disabled={busy || provider === null || model.trim() === ''}
        onClick={() => {
          if (provider !== null) {
            onStart({ provider, model: model.trim() });
          }
        }}
      >
        {action}
      </button>
      <button type="button" className="rv-pair-link" onClick={onCancel}>
        Cancel
      </button>
      {listNote !== '' && <span className="rv-pair-muted">{listNote}</span>}
    </div>
  );
}
