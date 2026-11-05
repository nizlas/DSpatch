import { useContext, useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { ContextPlace, Lang, WalkStep } from '../shared/review-model';
import type { ContextFileView } from '../shared/review-pair';
import { PairKeyContext } from './DiscussionAnswer';
import { Markdown } from './Markdown';
import { Inline } from './review-code';
import { pick } from './review-i18n';
import { contextExcerpt, contextPaneLabel } from './walk-context';

/**
 * A walk step's places in other repositories of the workspace (DSP-175), each as a pane of
 * its own, plainly marked as context: the repository, file and lines, the commit the
 * analysis read (short, full on hover), how that commit was chosen and whether it is
 * established as what the reviewed build uses. The code comes from Git at that commit
 * through the review's context record (`readContextFile`), never from a working copy.
 *
 * A context pane is not a station of the walk: it has no diff colours, no line marks, no
 * approve or reviewed action, and nothing in it counts as covered.
 */
export function WalkContextPlaces({ step, lang }: { readonly step: WalkStep; readonly lang: Lang }): JSX.Element | null {
  const places = step.contextPlaces ?? [];
  if (places.length === 0) {
    return null;
  }
  return (
    <div className="rv-walk-context" data-ev="walk-context-places">
      <div className="rv-section-title">Context from other repositories · not under review</div>
      {places.map((place) => (
        <ContextPane key={`${step.id}:${place.id}`} place={place} lang={lang} />
      ))}
    </div>
  );
}

function ContextPane({ place, lang }: { readonly place: ContextPlace; readonly lang: Lang }): JSX.Element {
  const pairKey = useContext(PairKeyContext);
  const [view, setView] = useState<ContextFileView | { readonly error: string } | null>(null);
  const focus = place.focus;
  useEffect(() => {
    let current = true;
    setView(null);
    const bridge = window.dspatchReviewPair;
    if (bridge === undefined || pairKey === null) {
      setView({ error: 'This window cannot open places in other repositories.' });
      return;
    }
    bridge
      .readContextFile(pairKey, focus.repository, focus.path, focus.commit)
      .then((answer) => {
        if (current) {
          setView(answer);
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setView({ error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      current = false;
    };
  }, [pairKey, focus.repository, focus.path, focus.commit]);
  const label = contextPaneLabel(place, view);
  const excerpt = view !== null && !('error' in view) && view.text !== null ? contextExcerpt(place, view.text) : null;
  return (
    <section
      className="rv-walk-context-pane"
      data-ev="walk-context-pane"
      data-place={place.id}
      data-repository={label.repository}
      data-path={label.path}
      data-commit={label.commit}
      data-established={label.relation}
      data-how={view !== null && !('error' in view) ? view.how : ''}
    >
      <header className="rv-walk-context-head">
        <span className="rv-walk-context-badge" data-ev="walk-context-badge">
          Context
        </span>{' '}
        <Inline text={pick(place.label, lang)} />
        <div className="rv-sub" data-ev="walk-context-where">
          {label.repository} / {label.path} {label.lines} @{' '}
          <span className="rv-walk-context-commit" data-ev="walk-context-commit" title={label.commit}>
            {label.shortCommit}
          </span>
        </div>
        {label.how !== '' && (
          <div className="rv-sub" data-ev="walk-context-how">
            Read at {label.how}.
          </div>
        )}
        <div className={label.relation === 'established' ? 'rv-sub' : 'rv-sub rv-walk-context-unestablished'} data-ev="walk-context-relation">
          {label.relationText}
        </div>
      </header>
      {focus.note !== undefined && (
        <div className="rv-place-note">
          <Markdown text={pick(focus.note, lang)} />
        </div>
      )}
      {view === null ? (
        <p className="rv-sub">Reading {label.repository} at {label.shortCommit}…</p>
      ) : 'error' in view ? (
        <p className="rv-error" data-ev="walk-context-error">
          {view.error}
        </p>
      ) : view.text === null ? (
        <p className="rv-sub">A binary file.</p>
      ) : excerpt !== null && 'problem' in excerpt ? (
        <p className="rv-error" data-ev="walk-context-error">
          {excerpt.problem}
        </p>
      ) : excerpt !== null ? (
        <pre className="rv-context-code" data-ev="walk-context-code">
          {excerpt.lines.map((text, index) => {
            const number = excerpt.from + index;
            const marked = number >= focus.start && number <= focus.end;
            return (
              <span key={number} className={marked ? 'rv-context-line rv-context-line-marked' : 'rv-context-line'}>
                <span className="rv-context-number">{number}</span> {text}
                {'\n'}
              </span>
            );
          })}
        </pre>
      ) : null}
    </section>
  );
}
