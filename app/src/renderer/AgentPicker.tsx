/**
 * Choosing the agent and model for agent work in review (DSP-152): preparing code walks
 * and a delegated review. Used by the diff window and the walk window alike.
 *
 * It starts from the choice the host answers for this review: the one made in it before,
 * else the one of the chat or loop editor that opened it. With neither, or with one that
 * cannot be used in this launch, nothing is preselected and the person chooses. DSpatch
 * never picks an agent or a model here on its own, and never falls back to another.
 *
 * The models are the chosen agent's own listing, read through the discussion's existing
 * bridge only for that agent, so choosing Claude never asks Cursor anything. A listing
 * that arrives after the agent was changed is ignored. Nothing is started here: the
 * caller starts the work with exactly what is shown.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { ModelChoice } from '../shared/bridge';
import { isPairError, type ReviewAgents } from '../shared/review-pair';

export interface AgentChoice {
  readonly provider: 'cursor' | 'claude';
  readonly model: string;
}

function providerName(provider: 'cursor' | 'claude'): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

export function AgentPicker({
  pairKey,
  action,
  busy,
  onStart,
  onCancel,
  testId,
}: {
  readonly pairKey: string;
  /** The button's words: "Prepare code walks", "Delegate". */
  readonly action: string;
  readonly busy: boolean;
  readonly onStart: (choice: AgentChoice) => void;
  readonly onCancel: () => void;
  readonly testId: string;
}): JSX.Element {
  const [agents, setAgents] = useState<ReviewAgents | null>(null);
  const [readError, setReadError] = useState('');
  const [provider, setProvider] = useState<'cursor' | 'claude' | null>(null);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<readonly ModelChoice[] | null>(null);
  const [listNote, setListNote] = useState('');
  const [startNote, setStartNote] = useState('');
  // Which listing is wanted now: an answer for an agent no longer chosen is dropped.
  const wanted = useRef<'cursor' | 'claude' | null>(null);

  const listModels = (next: 'cursor' | 'claude'): void => {
    wanted.current = next;
    setModels(null);
    setListNote('');
    void window.dspatchReviewDiscussion?.listModels(next).then(
      (listing) => {
        if (wanted.current !== next) {
          return;
        }
        setModels(listing.models);
        if (listing.error !== null) {
          setListNote(`${providerName(next)}'s models could not be listed: ${listing.error}`);
        }
      },
      () => {
        if (wanted.current === next) {
          setModels([]);
          setListNote(`${providerName(next)}'s models could not be listed. Type the model's id.`);
        }
      },
    );
  };

  useEffect(() => {
    void window.dspatchReviewPair?.agents(pairKey).then(
      (answer) => {
        if (isPairError(answer)) {
          setReadError(answer.error);
          return;
        }
        setAgents(answer);
        const current = answer.current;
        if (current === null) {
          setStartNote('No agent was chosen where this review was opened. Choose one.');
          return;
        }
        if (!current.choosable) {
          setStartNote(`${providerName(current.provider)} cannot be used here: ${current.reason ?? 'it is not available in this launch.'} Choose another agent.`);
          return;
        }
        setProvider(current.provider);
        setModel(current.model);
        listModels(current.provider);
      },
      () => {
        setReadError('The agents could not be read.');
      },
    );
    // The choice is read once, when the picker opens; later changes are the person's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  if (readError !== '') {
    return (
      <div className="rv-agent-picker" data-ev={testId}>
        <span className="rv-pair-error">{readError}</span>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  if (agents === null) {
    return <div className="rv-agent-picker" data-ev={testId}>Reading the agents…</div>;
  }
  if (!agents.options.some((option) => option.choosable)) {
    return (
      <div className="rv-agent-picker" data-ev={testId}>
        <span className="rv-pair-muted">No agent can be used here: {agents.options.map((option) => option.reason ?? '').filter((reason) => reason !== '').join(' ')}</span>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  const listed = models ?? [];
  const known = listed.some((entry) => entry.id === model);
  const ready = provider !== null && model.trim() !== '';
  return (
    <div className="rv-agent-picker" data-ev={testId}>
      <label>
        Agent
        <select
          data-ev={`${testId}-provider`}
          value={provider ?? ''}
          onChange={(event) => {
            const next = event.target.value === 'claude' || event.target.value === 'cursor' ? event.target.value : null;
            setProvider(next);
            setStartNote('');
            // A model belongs to its agent: another agent starts with no model chosen,
            // unless it is the one this review or its opener already chose with one.
            const current = agents.current;
            setModel(next !== null && current !== null && current.provider === next ? current.model : '');
            if (next !== null) {
              listModels(next);
            } else {
              wanted.current = null;
              setModels(null);
            }
          }}
        >
          {provider === null && <option value="">Choose an agent</option>}
          {agents.options.map((option) => (
            <option key={option.provider} value={option.provider} disabled={!option.choosable} title={option.reason ?? undefined}>
              {providerName(option.provider)}
              {option.choosable ? '' : ' (not available)'}
            </option>
          ))}
        </select>
      </label>
      {provider !== null && (
        <label>
          Model
          {models === null ? (
            <span className="rv-pair-muted" data-ev={`${testId}-model-reading`}>
              {model === '' ? `Reading ${providerName(provider)}'s models…` : `${model} (reading ${providerName(provider)}'s models…)`}
            </span>
          ) : listed.length > 0 ? (
            <select data-ev={`${testId}-model`} value={known ? model : ''} onChange={(event) => setModel(event.target.value)}>
              {!known && (
                <option value="" disabled>
                  {model === '' ? 'Choose a model' : `${model} (not offered)`}
                </option>
              )}
              {listed.map((entry) => (
                <option key={entry.id} value={entry.id} title={entry.description}>
                  {entry.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input data-ev={`${testId}-model`} value={model} placeholder="Model id" onChange={(event) => setModel(event.target.value)} />
          )}
        </label>
      )}
      <button
        type="button"
        className="rv-pair-primary"
        data-ev={`${testId}-start`}
        disabled={busy || !ready || (models !== null && listed.length > 0 && !known)}
        onClick={() => {
          if (provider !== null && model.trim() !== '') {
            onStart({ provider, model: model.trim() });
          }
        }}
      >
        {action}
      </button>
      <button type="button" className="rv-pair-link" onClick={onCancel}>
        Cancel
      </button>
      {startNote !== '' && <span className="rv-pair-muted" data-ev={`${testId}-note`}>{startNote}</span>}
      {listNote !== '' && <span className="rv-pair-muted">{listNote}</span>}
    </div>
  );
}
