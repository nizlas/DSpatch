/**
 * DSP-229: one recommendation turn with the workspace's own agent, in the repository, read-only.
 *
 * The adapter is built by the caller for the analysis purpose (read-only tools; Cursor has none and
 * is refused before this is reached). The session works in the repository only. Cancelling stops
 * the turn; nothing it produced is applied anywhere, so a cancel or a failure loses nothing the
 * person typed.
 */
import type { DspatchSessionId, ProviderId } from '../adapter/types';
import { parseRecommendations, type RecommendationAnswer } from '../shared/project-recommendations';
import { waitForTurn, type LoopStepAdapter } from './loop-live';

export async function runRecommendation(input: {
  readonly adapter: Pick<LoopStepAdapter, 'startSession' | 'subscribe' | 'send' | 'cancel'>;
  readonly provider: ProviderId;
  readonly model: string;
  readonly repository: string;
  readonly prompt: string;
  readonly allowed: readonly string[];
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly ok: true; readonly answer: RecommendationAnswer; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly problem: string; readonly cancelled?: true }
> {
  const session = await input.adapter.startSession({
    provider: input.provider,
    dspatchSessionId: input.sessionId as DspatchSessionId,
    modelRequested: input.model,
    workspacePath: input.repository,
    workspacePaths: [input.repository],
    appTools: [],
  });
  const turn = waitForTurn(input.adapter, session.dspatchSessionId);
  const cancel = (): void => {
    void input.adapter.cancel(session.dspatchSessionId).catch(() => undefined);
  };
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    await input.adapter.send(session.dspatchSessionId, input.prompt);
    await turn.finished;
  } catch (error) {
    return { ok: false, problem: `The agent could not be asked: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
  if (input.signal?.aborted === true) {
    return { ok: false, problem: 'Stopped. Nothing was changed.', cancelled: true };
  }
  if (turn.terminalStatus() !== 'finished') {
    return { ok: false, problem: `The agent's turn ended as ${turn.terminalStatus() ?? 'nothing reported'}${turn.terminalError() === null ? '' : `: ${turn.terminalError() ?? ''}`}.` };
  }
  const parsed = parseRecommendations(turn.assistantText(), input.allowed);
  return parsed.ok ? { ok: true, answer: parsed.answer, dropped: parsed.dropped } : { ok: false, problem: parsed.problem };
}
