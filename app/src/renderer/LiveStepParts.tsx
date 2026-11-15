/**
 * The pieces of a working step's live output, shared by the chat's live step and the step
 * output window (Niclas, 15 November 2026: the same presentation in a separate window), so
 * the two cannot draw one step's text or tool calls two ways.
 */

import type { JSX } from 'react';

import type { StepToolCall } from '../shared/loop-activity';
import { Markdown } from './Markdown';

/** The step's tool calls, each with its state: running, ok or error. */
export function LiveToolCalls({ tools, testId }: { readonly tools: readonly StepToolCall[]; readonly testId: string }): JSX.Element | null {
  if (tools.length === 0) {
    return null;
  }
  return (
    <ul className="tool-calls__list tool-calls__list--live" data-ev={`${testId}-tools`}>
      {tools.map((call) => (
        <li key={call.callId} className={`tool-call tool-call--${call.status ?? 'running'}`} data-ev={`${testId}-tool-${call.callId}`}>
          <span className="tool-call__summary">{call.summary}</span>
        </li>
      ))}
    </ul>
  );
}

/** The reply as it is being written, formatted as the finished reply will be. */
export function LiveReplyText({ text, testId }: { readonly text: string; readonly testId: string }): JSX.Element | null {
  if (text === '') {
    return null;
  }
  return (
    <div className="turn__answer" data-ev={testId}>
      <Markdown text={text} />
    </div>
  );
}
