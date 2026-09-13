/**
 * Typer för DSpatchs leverantörsadapter.
 *
 * Filen innehåller enbart typer. Den importeras av både huvudprocessen och
 * renderaren, så den får aldrig få ett körtidsberoende till Node eller till en
 * leverantörs SDK.
 *
 * Formen är beslutad i DSP-1 delsteg 2 (se uppgiftens Implementation Notes,
 * "Pass 2"). Gränssnittet är sessionsgranulärt: en körning är något som
 * händelser grupperas på, inte ett objekt adaptern lämnar ut.
 */

/** Leverantörer som VISION avsnitt 10 namnger. Ingen av dem är ansluten än. */
export type ProviderId = 'cursor' | 'copilot';

/**
 * DSpatch präglar sina egna identifierare och lånar aldrig en leverantörs form.
 * Adaptern äger översättningen till leverantörens ID.
 *
 * En regel gäller vid översättningen till Cursor: prägla aldrig ett ID som
 * börjar med `bc-`, eftersom Cursor tolkar det prefixet som en molnkörning.
 */
export type DspatchSessionId = string;

/** Identifierar en promptinlämning. Bärs som fält på varje händelse. */
export type DspatchRunId = string;

/** ISO 8601-tidsstämpel i UTC. */
export type Timestamp = string;

/** De sju förmågorna i VISION avsnitt 9.1:s gemensamma integrationskontrakt. */
export type Capability =
  | 'start'
  | 'streaming'
  | 'cancel'
  | 'resume'
  | 'modelSelection'
  | 'approvals'
  | 'usageReporting';

/**
 * Tre värden, inte två. `unknown` är ett giltigt svar: VISION avsnitt 9.1 kräver
 * att saknat stöd framgår, och VISION avsnitt 13 förbjuder att en saknad uppgift
 * visas som ett positivt resultat.
 */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

/**
 * Svaret gäller **per adapterinstans, alltså leverantör plus transport** — inte
 * per leverantör. Godkännanden är exempelvis dokumenterat frånvarande i Cursors
 * SDK-väg men dokumenterat stödda i Cursors ACP-väg; ett svar per leverantör
 * skulle bli osant så snart reservvägen används.
 */
export type CapabilityReport = Readonly<Record<Capability, CapabilitySupport>>;

/**
 * Körningens tillstånd:
 *
 *   created -> running -> awaiting_approval <-> running
 *                      -> finished | cancelled | error
 *
 * `awaiting_approval` ingår från början trots att ingen ansluten adapter kan
 * fylla det ännu. Cursors egen strömtyp bär redan `{type:"request"}`, beskriven
 * som "Awaiting user input or approval", och VISION avsnitt 13 kräver att väntan
 * visas som väntan.
 */
export type RunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'finished'
  | 'cancelled'
  | 'error';

/** Terminala tillstånd. */
export type TerminalRunStatus = Extract<
  RunStatus,
  'finished' | 'cancelled' | 'error'
>;

/**
 * Fel från adaptern. Ingen egen felkodstaxonomi: DSP-3 äger felhanteringen, och
 * en taxonomi byggd på noll faktiska utfall skulle bli fel.
 */
export interface AdapterError {
  readonly message: string;
  /** Leverantörens egen kod, oförändrad, när den finns. */
  readonly providerCode?: string;
}

/** Konfiguration för en session. Adaptern persisterar inte detta; DSpatch äger det. */
export interface SessionConfig {
  readonly provider: ProviderId;
  /**
   * DSpatchs eget sessions-ID. Utelämnas det präglar adaptern ett.
   * Måste vara filnamnssäkert, eftersom en leverantör kan använda det som
   * katalognamn.
   */
  readonly dspatchSessionId?: DspatchSessionId;
  /** Modellen som efterfrågas. Vilken modell som faktiskt användes kan skilja sig. */
  readonly modelRequested: string;
  /** Arbetskopian agenten arbetar i. Indata till sessionen, inte en observation. */
  readonly workspacePath: string;
}

/** Vad adaptern lämnar ut när en session startats eller återupptagits. */
export interface SessionHandle {
  readonly dspatchSessionId: DspatchSessionId;
  readonly provider: ProviderId;
  /** Leverantörens eget sessions-ID, för korrelation mot dess loggar. */
  readonly providerSessionId: string;
  readonly createdAt: Timestamp;
}

/** Vad `send` lämnar ut. Ingen körningsnivå, bara identiteten att gruppera på. */
export interface RunReference {
  readonly dspatchRunId: DspatchRunId;
}

/**
 * En väntande godkännandefråga. Medvetet tre fält: en `kind`-uppräkning skulle
 * normalisera mot noll faktiska utfall och hör till en senare uppgift.
 */
export interface ApprovalRequest {
  readonly requestId: string;
  readonly summary: string;
  readonly requestedAt: Timestamp;
}

/** Godkännandevokabulären i Etapp 0. Inget mer. */
export type ApprovalDecision =
  | { readonly kind: 'allow-once' }
  | { readonly kind: 'deny'; readonly reason: string };

/** Enhet för en förbrukningspost. Bärs alltid tillsammans med `provider`. */
export type UsageUnit = 'tokens' | 'cents';

/** Omfattning för en förbrukningspost. `session` är DSpatchs ord för nivån. */
export type UsageScope = 'call' | 'turn' | 'run' | 'session';

/**
 * En läsning av förbrukning eller kostnad.
 *
 * `value: null` betyder **okänt — aldrig 0**. VISION avsnitt 12 säger att ett
 * saknat kostnadsvärde inte ska presenteras som noll. `null` skiljer inte
 * "dröjer" från "finns inte hos denna leverantör"; `source` och `observedAt`
 * bär den skillnaden.
 */
export interface UsageReading {
  readonly provider: ProviderId;
  readonly unit: UsageUnit;
  readonly scope: UsageScope;
  readonly value: number | null;
  /** Vilken leverantörshändelse eller vilket API läsningen kom från. */
  readonly source: string;
  readonly observedAt: Timestamp;
}

/** Vad en förbrukningsläsning gäller. */
export type UsageQuery =
  | { readonly of: 'session'; readonly dspatchSessionId: DspatchSessionId }
  | { readonly of: 'run'; readonly dspatchRunId: DspatchRunId };

/** En modell som adapterinstansen kan efterfråga. */
export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly provider: ProviderId;
}

/**
 * Normaliserade händelsetyper. Mappningen finns dokumenterad åt båda
 * leverantörshållen; se rapport 003 avsnitt 3.2.
 */
export type AgentEventType =
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.message'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.finished'
  | 'approval.requested'
  | 'usage'
  | 'run.finished';

/**
 * Gemensamma fält på varje händelse. `dspatchRunId` gör att gränssnitt och
 * lagring kan gruppera per körning utan att adaptern behöver en körningsnivå.
 *
 * `rawProviderEvent` sparas oförändrad bredvid den normaliserade formen, enligt
 * VISION avsnitt 9.1. Verktygens argument och resultat normaliseras aldrig:
 * bara envelopen — identitet, namn, status och tidpunkt — har ett stabilt schema
 * hos leverantörerna.
 *
 * Ingen `seq` här. Sekvensnumrering är DSpatchs egen observation och ett
 * lagringsbeslut som hör till DSP-4.
 */
interface AgentEventBase {
  readonly dspatchSessionId: DspatchSessionId;
  readonly dspatchRunId: DspatchRunId;
  readonly at: Timestamp;
  readonly rawProviderEvent: unknown;
}

export type AgentEvent =
  | (AgentEventBase & { readonly type: 'run.started' })
  | (AgentEventBase & {
      readonly type: 'assistant.delta' | 'assistant.message' | 'reasoning.delta';
      readonly text: string;
    })
  | (AgentEventBase & {
      readonly type: 'tool.started';
      readonly toolCallId: string;
      readonly name: string;
    })
  | (AgentEventBase & {
      readonly type: 'tool.finished';
      readonly toolCallId: string;
      readonly name: string;
      readonly status: 'ok' | 'error';
    })
  | (AgentEventBase & {
      readonly type: 'approval.requested';
      readonly request: ApprovalRequest;
    })
  | (AgentEventBase & {
      readonly type: 'usage';
      readonly readings: readonly UsageReading[];
    })
  | (AgentEventBase & {
      readonly type: 'run.finished';
      readonly status: TerminalRunStatus;
      readonly error?: AdapterError;
    });

/** Avregistrerar en prenumeration. Idempotent. */
export type Unsubscribe = () => void;

/** Tar emot normaliserade händelser. Får inte kasta. */
export type AgentEventListener = (event: AgentEvent) => void;
