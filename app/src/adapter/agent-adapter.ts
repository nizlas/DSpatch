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

/**
 * DSpatchs gräns mot en agentleverantör.
 *
 * Gränssnittet är **sessionsgranulärt**. Skälet är konkret och gäller båda
 * leverantörerna: Copilot har ingen körningsnivå alls, och en prenumeration som
 * etableras efter `send` tappar händelser hos båda. Copilots dokumenterade
 * mönster är `session.on(...)` före första prompten, och Cursors race-fria väg
 * är callbacks som skickas in i `send`.
 *
 * **Invariant: högst en aktiv körning per session.** Ingen av leverantörerna
 * garanterar något annat — Copilot dokumenterar "No session locking — concurrent
 * access to same session is undefined" och Cursor kastar `AgentBusyError` för
 * molnkörningar. VISION avsnitt 14 kräver ändå bara en skrivande körning i taget
 * i Etapp 0. Anropas `send` medan en körning är aktiv ska adaptern avvisa
 * anropet, inte köa det.
 *
 * Ingen implementation finns ännu. `NotImplementedAdapter` är den enda
 * implementationen i delsteg 2, och den anropar ingen leverantör.
 */
export interface AgentAdapter {
  /**
   * Startar en ny session. Prenumerera med `subscribe` **innan** första `send`,
   * annars kan händelser gå förlorade.
   */
  startSession(config: SessionConfig): Promise<SessionHandle>;

  /**
   * Återupptar en tidigare session. Konfigurationen måste skickas igen: ingen
   * leverantör persisterar hela den, och DSpatch äger den därför själv.
   */
  resume(
    sessionId: DspatchSessionId,
    config: SessionConfig,
  ): Promise<SessionHandle>;

  /**
   * Skickar en prompt och returnerar identiteten som händelserna grupperas på.
   * Avvisas om sessionen redan har en aktiv körning.
   */
  send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference>;

  /**
   * Etableras vid sessionsstart, före första `send`. Lyssnaren tar emot alla
   * körningar i sessionen; `dspatchRunId` på varje händelse skiljer dem.
   */
  subscribe(
    sessionId: DspatchSessionId,
    onEvent: AgentEventListener,
  ): Unsubscribe;

  /**
   * Avbryter sessionens aktuella varv. Sessionen består och kan få en ny prompt.
   *
   * Om ett pågående fjärranrop till modellen faktiskt stoppas är odokumenterat
   * hos båda leverantörerna. Det ska mätas, inte antas.
   */
  cancel(sessionId: DspatchSessionId): Promise<void>;

  /** Modeller adapterinstansen kan efterfråga. */
  listModels(): Promise<readonly ModelInfo[]>;

  /**
   * Läser förbrukning. Ett saknat värde returneras som `null`, aldrig som `0`.
   * En tom lista betyder att adaptern inte hade någon läsning att ge.
   */
  readUsage(scope: UsageQuery): Promise<readonly UsageReading[]>;

  /**
   * Svarar på en väntande godkännandefråga. Adaptern får svara att det inte
   * stöds; `capabilities().approvals` ska då vara `unsupported`.
   */
  respondToApproval(
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  /** Vad just denna instans stöder — leverantör plus transport. */
  capabilities(): CapabilityReport;

  /**
   * Avvecklar adaptern. Måste anropas innan appen avslutas: en leverantörsväg
   * kan äga en barnprocess eller ett lokalt lager med öppna filer. Idempotent,
   * och får inte kasta — den anropas när appen redan är på väg att stängas.
   */
  dispose(): Promise<void>;
}
