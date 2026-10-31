/**
 * Choosing the agent and model for agent work in review (DSP-152): preparing code walks
 * and a delegated review. Used by the diff window and the walk window alike.
 *
 * It starts from the choice the host answers for this review: the one made in it before,
 * else the one of the chat or loop editor that opened it. An opener on the provider's
 * default starts from the model the list marks as the default, which is what the chat
 * shows and runs. With no choice, or one that cannot be used in this launch, nothing is
 * preselected and the person chooses. A model that is not offered stays named and asks
 * for a choice: DSpatch never falls back to another agent or model on its own.
 *
 * The models are the chosen agent's own listing, read through the discussion's existing
 * bridge only for that agent, so choosing Claude never asks Cursor anything, and drawn
 * as the chat draws them (`modelRows`: the provider's `default` alias is not a model of
 * its own). A listing that arrives after the agent was changed is ignored. Nothing is
 * started here: the caller starts the work with exactly what is shown. While the start
 * cannot be pressed, the picker says why. A listing that arrives late never replaces a
 * model the person chose.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { ModelListing } from '../shared/bridge';
import { isDefaultRow, listedDefault, modelRows } from '../shared/model-rows';
import { isPairError, type ReviewAgents } from '../shared/review-pair';

export interface AgentChoice {
  readonly provider: 'cursor' | 'claude' | 'copilot';
  readonly model: string;
}

function providerName(provider: 'cursor' | 'claude' | 'copilot'): string {
  return provider === 'claude' ? 'Claude' : provider === 'copilot' ? 'Copilot' : 'Cursor';
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
  const [provider, setProvider] = useState<'cursor' | 'claude' | 'copilot' | null>(null);
  const [model, setModel] = useState('');
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [listNote, setListNote] = useState('');
  const [startNote, setStartNote] = useState('');
  // Which listing is wanted now: an answer for an agent no longer chosen is dropped.
  const wanted = useRef<'cursor' | 'claude' | 'copilot' | null>(null);
  // The inherited agent runs on the provider's default, and the list has yet to name it.
  // Cleared by any choice of the person's, so a late list never replaces one.
  const followsDefault = useRef(false);

  const chooseModel = (next: string): void => {
    followsDefault.current = false;
    setModel(next);
  };

  const listModels = (next: 'cursor' | 'claude' | 'copilot'): void => {
    wanted.current = next;
    setListing(null);
    setListNote('');
    void window.dspatchReviewDiscussion?.listModels(next).then(
      (answer) => {
        if (wanted.current !== next) {
          return;
        }
        setListing(answer);
        if (followsDefault.current) {
          followsDefault.current = false;
          setModel(listedDefault(answer));
        } else {
          // An inherited "no model named" is the default row, which now says what it means.
          setModel((current) => (answer.models.some((entry) => isDefaultRow(entry) && entry.id === current) ? listedDefault(answer) : current));
        }
        if (answer.error !== null) {
          setListNote(`${providerName(next)}'s models could not be listed: ${answer.error}`);
        }
      },
      () => {
        if (wanted.current === next) {
          setListing({ provider: next, models: [], chosen: '', error: 'the list could not be read', source: '' });
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
        followsDefault.current = current.model === '';
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
  // The rows the chat shows for this listing, without one for a choice it does not offer.
  const rows = listing === null || listing.models.length === 0 ? [] : modelRows(listing, '').rows.filter((row) => row.value !== '');
  const known = rows.some((row) => row.value === model);
  const ready = provider !== null && model.trim() !== '';
  const offeredOrUnlisted = rows.length === 0 || known;
  // Why the start cannot be pressed now, said beside it: never a silent grey button.
  const blocked =
    busy
      ? 'This work is already running.'
      : provider === null
        ? ''
        : model.trim() === ''
          ? listing === null
            ? ''
            : 'Choose a model.'
          : !offeredOrUnlisted
            ? `${model} is not in ${providerName(provider)}'s list for this account. Choose a model.`
            : '';
  const note = startNote !== '' ? startNote : blocked;
  return (
    <div className="rv-agent-picker" data-ev={testId}>
      <label>
        Agent
        <select
          data-ev={`${testId}-provider`}
          value={provider ?? ''}
          onChange={(event) => {
            const next = event.target.value === 'claude' || event.target.value === 'cursor' || event.target.value === 'copilot' ? event.target.value : null;
            setProvider(next);
            setStartNote('');
            // A model belongs to its agent: another agent starts with no model chosen,
            // unless it is the one this review or its opener already chose with one.
            const current = agents.current;
            const inherited = next !== null && current !== null && current.provider === next;
            setModel(inherited ? current.model : '');
            followsDefault.current = inherited && current.model === '';
            if (next !== null) {
              listModels(next);
            } else {
              wanted.current = null;
              setListing(null);
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
          {listing === null ? (
            <span className="rv-pair-muted" data-ev={`${testId}-model-reading`}>
              {model === '' ? `Reading ${providerName(provider)}'s models…` : `${model} (reading ${providerName(provider)}'s models…)`}
            </span>
          ) : rows.length > 0 ? (
            <select data-ev={`${testId}-model`} value={known ? model : ''} onChange={(event) => chooseModel(event.target.value)}>
              {!known && (
                <option value="" disabled>
                  {model === '' ? 'Choose a model' : `${model} (not offered)`}
                </option>
              )}
              {rows.map((row) => (
                <option key={row.value} value={row.value} title={row.title}>
                  {row.label}
                </option>
              ))}
            </select>
          ) : (
            <input data-ev={`${testId}-model`} value={model} placeholder="Model id" onChange={(event) => chooseModel(event.target.value)} />
          )}
        </label>
      )}
      <button
        type="button"
        className="rv-pair-primary"
        data-ev={`${testId}-start`}
        disabled={busy || !ready || !offeredOrUnlisted}
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
      {note !== '' && (
        <span className="rv-pair-muted" data-ev={`${testId}-note`} role="status">
          {note}
        </span>
      )}
      {listNote !== '' && <span className="rv-pair-muted">{listNote}</span>}
    </div>
  );
}
