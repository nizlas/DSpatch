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

/** Kastas av varje operation i `NotImplementedAdapter`. */
export class AdapterNotImplementedError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `Adapteroperationen "${operation}" är inte implementerad. ` +
        'Skelettet i DSP-1 delsteg 2 definierar gränssnittet utan att ansluta ' +
        'någon leverantör.',
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
 * Platshållaren för DSpatchs leverantörsadapter.
 *
 * Den anropar ingen leverantör, importerar ingen SDK och öppnar ingen
 * nätverksanslutning. Varje operation kastar. Syftet är att gränssnittets form
 * ska vara låst och typkontrollerad innan en verklig anslutning byggs, så att
 * paketeringsfel och anslutningsfel kan skiljas från varandra.
 *
 * `capabilities()` svarar `unsupported` för alla sju förmågorna. Det är ett
 * sant besked om just denna instans — den stöder ingenting — och inte en
 * förhandsbedömning av vad en ansluten Cursor-adapter kommer att stödja.
 */
export class NotImplementedAdapter implements AgentAdapter {
  /** Vad gränssnittet visar som adapterns identitet. */
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

  /** Ingenting att avveckla. Får inte kasta: anropas när appen stängs. */
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
