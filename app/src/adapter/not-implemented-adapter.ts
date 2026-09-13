import type { AgentAdapter } from './agent-adapter';
import type {
  AgentEventListener,
  ApprovalDecision,
  CapabilityReport,
  DspatchSessionId,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from './types';

/** Thrown by every unimplemented operation in `NotImplementedAdapter`. */
export class AdapterNotImplementedError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `Adapter operation "${operation}" is not implemented. ` +
        'The skeleton in DSP-1 substep 2 defines the interface without connecting ' +
        'a provider.',
    );
    this.name = 'AdapterNotImplementedError';
    this.operation = operation;
  }
}

const CAPABILITIES: CapabilityReport = {
  start: 'unsupported',
  streaming: 'unsupported',
  cancel: 'unsupported',
  resume: 'unsupported',
  modelSelection: 'unsupported',
  approvals: 'unsupported',
  usageReporting: 'unsupported',
};

/**
 * Placeholder for DSpatch's provider adapter.
 *
 * It calls no provider, imports no SDK and opens no network connection.
 * Unimplemented operations throw. The interface is fixed and type-checked before
 * a real connection is built so packaging failures can be distinguished from
 * connection failures.
 *
 * `capabilities()` returns `unsupported` for all seven capabilities. This is a
 * truthful report for this instance, which supports nothing; it does not predict
 * what a connected Cursor adapter will support.
 */
export class NotImplementedAdapter implements AgentAdapter {
  /** The adapter identity shown in the UI. */
  readonly id = 'not-implemented';

  startSession(_config: SessionConfig): Promise<SessionHandle> {
    return Promise.reject(new AdapterNotImplementedError('startSession'));
  }

  resume(
    _sessionId: DspatchSessionId,
    _config: SessionConfig,
  ): Promise<SessionHandle> {
    return Promise.reject(new AdapterNotImplementedError('resume'));
  }

  send(_sessionId: DspatchSessionId, _prompt: string): Promise<RunReference> {
    return Promise.reject(new AdapterNotImplementedError('send'));
  }

  subscribe(
    _sessionId: DspatchSessionId,
    _onEvent: AgentEventListener,
  ): Unsubscribe {
    throw new AdapterNotImplementedError('subscribe');
  }

  cancel(_sessionId: DspatchSessionId): Promise<void> {
    return Promise.reject(new AdapterNotImplementedError('cancel'));
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.reject(new AdapterNotImplementedError('listModels'));
  }

  readUsage(_scope: UsageQuery): Promise<readonly UsageReading[]> {
    return Promise.reject(new AdapterNotImplementedError('readUsage'));
  }

  respondToApproval(
    _requestId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    return Promise.reject(new AdapterNotImplementedError('respondToApproval'));
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  /** Nothing to dispose. Must not throw: called during application shutdown. */
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
