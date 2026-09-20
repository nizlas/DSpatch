import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  JSX,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import type { Capability, CapabilitySupport } from '../adapter/types';
import type {
  AttemptInfo,
  AttemptReconciliation,
  AttemptState,
  CancelObservations,
  ChatSessionInfo,
  ConnectionStatus,
  ConversationListEntry,
  ConversationListing,
  ConversationSaveStatus,
  DirtyFileInfo,
  EnvironmentInfo,
  PresentedTestStatus,
  ProjectListEntry,
  ProjectListing,
  RendererSource,
  RestoredConversation,
  RunStateReport,
  SampleCleanupOutcome,
  SampleProjectsView,
  StartSessionRequest,
  StoredMessage,
  TestFreshness,
  TestOutcome,
  TestVerdict,
  WorkspaceChange,
  WorkspaceReport,
} from '../shared/bridge';
import {
  connectionRecheckNote,
  connectionRetryPlan,
  describeBridgeFailure,
  describeReconciledRepeat,
  describeSavedConversationUnresolved,
  describeSendWait,
  failureHasResolved,
  restoreComposerAfterRunFailure,
  runEndingNeedsConnectionRecheck,
  FAILURE_RESOLVED_NOTE,
  type BridgeFailure,
} from './recovery';
import { describePlainly } from './plain-error';
import {
  attachUsage,
  currentTurn as currentTurnOf,
  describeActivity,
  emptyChatState,
  markCancelRequested,
  routeEvent,
  summariseContext,
  type ChatState,
  type TurnState,
} from './turn-routing';
import { LoopControlBar, useLoopControl } from './LoopControlBar';
import { Markdown } from './Markdown';
import {
  decideScroll,
  followAfterScrollEvent,
  scrollTopAfterResize,
  shouldOfferReturnToLatest,
  type ScrollMetrics,
  type ScrollReason,
} from './scroll-follow';
import { runScriptedWorkflow } from './workflow-script';
import {
  CHAT_LOOP_GRAPH_ID,
  CHAT_LOOP_WINDOW_LOOKUP,
  chatSendAfter,
  formatChatLiveLogLine,
  loopBusyAfterChatCancel,
  newChatLoopRunId,
  planChatCancel,
} from '../shared/loop-chat';
import {
  runningStep,
  stepStanding,
  type StepActivityState,
  type StepStandingReport,
  type StepToolCall,
} from '../shared/loop-activity';
import {
  activityLine,
  chatHeaderView,
  composerKeyAction,
  handoffTrail,
  type ChatHeaderView,
} from '../shared/chat-workspace';
import {
  composerCanSend,
  composerRouteNote,
  composerSendRoute,
  loopInstructionBadgeText,
  loopInstructionState,
  loopInstructionStatusText,
  loopInstructionsAfter,
  type LoopInstruction,
  type LoopInstructionEvent,
} from '../shared/loop-instruction';
import {
  conversationStanding,
  loopTurnBadge,
  loopTurnBadgeText,
  loopTurnEndingLine,
  loopTurnStatusText,
  loopTurnsAfter,
  loopTurnsFromRecords,
  mergeTranscript,
  type ConversationStanding,
  type LoopTurn,
  type LoopTurnEvent,
} from '../shared/loop-transcript';

const HEADING = 'DSpatch';

/** This is also the display order. The type requires all seven capabilities. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  start: 'Start run',
  streaming: 'Streaming responses',
  cancel: 'Cancel run',
  resume: 'Resume',
  modelSelection: 'Model selection',
  approvals: 'Approvals',
  usageReporting: 'Usage and cost',
};

const SUPPORT_LABEL: Record<CapabilitySupport, string> = {
  supported: 'supported',
  unsupported: 'unsupported',
  unknown: 'unknown',
};

const RENDERER_SOURCE_LABEL: Record<RendererSource, string> = {
  'dev-server': 'development server',
  'built-files': 'built files',
};

const CAPABILITIES = Object.keys(CAPABILITY_LABEL) as Capability[];

/**
 * Windows paths differ in case without differing.
 *
 * The same rule the main process applies when it decides which conversation a
 * project belongs to. Here it decides only what stays on screen, but the two must
 * not disagree: a panel kept for a project the main process considers different
 * would show one project's history beside another project's session.
 */
function samePathOn(platform: string, left: string, right: string): boolean {
  return platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly environment: EnvironmentInfo }
  | { readonly kind: 'error'; readonly message: string };

type Busy =
  | null
  | 'picking-folder'
  | 'starting-session'
  | 'sending'
  | 'cancelling'
  | 'running-test'
  | 'reading-files'
  | 'resuming';

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const readyReported = useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.dspatch
      .getEnvironment()
      .then((environment) => {
        if (!cancelled) {
          setState({ kind: 'ready', environment });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown bridge error.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The acknowledgement is sent after rendering, not on component mount.
  // This distinguishes a live rendered window from an instantiated component.
  useEffect(() => {
    if (state.kind !== 'ready' || readyReported.current) {
      return;
    }
    readyReported.current = true;

    const frame = requestAnimationFrame(() => {
      window.dspatch.reportReady({
        headingText: HEADING,
        capabilityCount: CAPABILITIES.length,
        renderedAt: new Date().toISOString(),
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state.kind]);

  /*
    The window is a column of fixed height with one scrolling region inside it, and
    that is a DSP-58 decision rather than a styling one. The page used to scroll as
    well as the transcript, which is the "competing page and message scroll areas"
    §9.1 rules out and the reason `scrollIntoView` could move the whole application:
    it scrolls every ancestor that can scroll, not the one it was aimed at.

    What used to be here — a large title and a paragraph explaining how the adapter
    is wired — is DSP-60's "long explanations above the conversation". The sentence
    is still in the window, in the session details the top menu opens; the heading
    stays because it is how a person knows which application this is.
  */
  return (
    <main className="app">
      {state.kind !== 'ready' && (
        <header className="appbar">
          <h1 className="app__title">{HEADING}</h1>
        </header>
      )}

      {state.kind === 'loading' && (
        <p className="app__note">Reading environment details from the main process …</p>
      )}

      {state.kind === 'error' && (
        <p className="app__error">
          Could not read environment details: {state.message}
        </p>
      )}

      {state.kind === 'ready' && <Workbench environment={state.environment} />}
    </main>
  );
}

function Workbench({
  environment,
}: {
  readonly environment: EnvironmentInfo;
}): JSX.Element {
  const [connection, setConnection] = useState<ConnectionStatus>({
    kind: 'checking',
  });
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [projects, setProjects] = useState<ProjectListing | null>(null);
  const [session, setSession] = useState<ChatSessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<BridgeFailure | null>(null);
  const [chat, setChat] = useState<ChatState>(emptyChatState(null));
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<BridgeFailure | null>(null);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [testError, setTestError] = useState<BridgeFailure | null>(null);
  const [testCommand, setTestCommand] = useState('');
  const [testCwd, setTestCwd] = useState('');
  const [freshness, setFreshness] = useState<TestFreshness | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceReport | null>(null);
  const [cancelObs, setCancelObs] = useState<CancelObservations | null>(null);
  const [runState, setRunState] = useState<RunStateReport | null>(null);
  const [prompt, setPrompt] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [conversations, setConversations] = useState<ConversationListing | null>(null);
  /**
   * Whether the conversation on screen is on disk.
   *
   * `null` until the first reading, which is not the same as "saved": an unanswered
   * question about the disk is not an answer. The failure it carries has been
   * recorded in the main process since DSP-4 and had nowhere to go, so a
   * conversation that could not be written was announced to the log file and to
   * nobody — and the next restart then opened older work with no explanation.
   */
  const [saveStatus, setSaveStatus] = useState<ConversationSaveStatus | null>(null);
  /** A conversation read back from disk. History only: never a live session. */
  const [restored, setRestored] = useState<RestoredConversation | null>(null);
  /** When the restore's readings of the working copy were taken. */
  const [restoredAtUtc, setRestoredAtUtc] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<BridgeFailure | null>(null);
  /** Why the connection card was re-read without being asked. */
  const [recheckNote, setRecheckNote] = useState<string | null>(null);
  /** What happened to the composer text after a failure, in the user's terms. */
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const [resolvedNote, setResolvedNote] = useState<string | null>(null);
  /** Milliseconds since Send, while nothing has come back. `null` when not waiting. */
  const [waitMs, setWaitMs] = useState<number | null>(null);
  const [stopWaitingNote, setStopWaitingNote] = useState<string | null>(null);
  /** What forgetting remembered projects did, in the main process's own words. */
  const [forgetNote, setForgetNote] = useState<string | null>(null);
  /**
   * What happened when the loop editor window was asked for, when it is worth saying.
   *
   * `null` for the ordinary case: a window appeared, and the window is the message. It
   * exists for the two cases where a person would otherwise think the button did nothing
   * — the editor was already open and has been focused, or it could not be opened at all.
   */
  const [editorWindowNote, setEditorWindowNote] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  /**
   * The sample projects DSpatch has generated, when someone has asked to see them.
   *
   * `null` means nobody has looked. Not the same as an empty list, which means the
   * location was read and there is nothing there.
   */
  const [samples, setSamples] = useState<SampleProjectsView | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  /** What the last removal did, in the main process's own words. */
  const [sampleCleanup, setSampleCleanup] = useState<SampleCleanupOutcome | null>(null);
  /** Why the sample location could not be read or changed at all. */
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [useLoop, setUseLoop] = useState(false);
  const [loopLines, setLoopLines] = useState<readonly string[]>([]);
  const [loopBusy, setLoopBusy] = useState(false);
  /**
   * Who decides the next work step, read from the main process rather than kept here.
   *
   * Deliberately beside `loopBusy` and not folded into it. `loopBusy` is the send
   * machine's business — whether this window may send — and the control is the run's;
   * merging them is how "paused but autonomous" would become possible.
   */
  const loopControl = useLoopControl();
  /**
   * The loop runs the conversation shows: the mandate, the agent's reply, the end.
   *
   * Deliberately beside `chat` rather than inside it. A loop run produces no
   * provider run this window is subscribed to, so a loop turn is not a chat turn,
   * and keeping them apart means the send gate, Cancel's enablement and the
   * unresolved-turn reconciliation still read exactly what they read before.
   */
  const [loopTurns, setLoopTurns] = useState<readonly LoopTurn[]>([]);
  /**
   * Messages typed while a run was working (DSP-32, DSP-53).
   *
   * Beside the loop turns for the same reason they are beside `chat`: this is not
   * a provider run the window is subscribed to, and folding it into either of the
   * other two would teach every predicate that reads a turn about a third kind.
   * They meet in `mergeTranscript`, which is display and decides nothing.
   */
  const [loopInstructions, setLoopInstructions] = useState<readonly LoopInstruction[]>([]);
  /** The step the run last entered, for the standing line. Never a guess. */
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);

  /** Whether the session details the top menu opens are on screen. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** The model this conversation's next ordinary message will be sent to. */
  const [modelChoice, setModelChoice] = useState<string | null>(null);

  const pendingPrompt = useRef('');
  const scriptStarted = useRef(false);
  /**
   * The conversation's one scroller.
   *
   * Every movement below is applied to this element and to nothing else. The
   * previous implementation used `scrollIntoView` on a sentinel, which moves every
   * ancestor that can scroll — with the page scrolling too, that is what took the
   * window to the top on the first send of a session.
   */
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  /** Whether the reader is at the latest message. Updated from real scroll events. */
  const followingLatest = useRef(true);
  /**
   * Where the window itself last put the scroller, or `null` if the last movement
   * was not its own. What tells `followAfterScrollEvent` whose scroll it is looking
   * at — see DSP-66, where the window read its own move as the person walking away.
   */
  const appliedScrollTop = useRef<number | null>(null);
  /**
   * Why the conversation is about to change, for the next content effect.
   *
   * `content` is the resting value, so anything that arrives on its own is treated
   * as content and can only move a reader who was already following.
   */
  const scrollReason = useRef<ScrollReason>('conversation-replaced');
  const [returnToLatest, setReturnToLatest] = useState(false);
  /**
   * Which send the window is still waiting for.
   *
   * Stopping the wait cannot cancel the pending IPC call, so the call's eventual
   * result is compared against this before it is applied. Without it, a send the
   * user abandoned would come back several seconds later and clear the composer
   * they were already retyping into.
   */
  const sendGeneration = useRef(0);
  const waitStartedAt = useRef<number | null>(null);
  const loopBusyRef = useRef(false);
  /**
   * The loop run the transcript entry on screen belongs to.
   *
   * Only for addressing that entry: a stop request has to reach the run whose
   * mandate is shown, not the newest one. It decides no routing and is read by
   * nothing that chooses a canceller.
   */
  const loopRunId = useRef<string | null>(null);

  const activeTurn = useMemo(() => {
    const turn = currentTurnOf(chat);
    return turn !== null && turn.status === 'streaming' ? turn : null;
  }, [chat]);
  const activity = useMemo(() => describeActivity(chat), [chat]);
  /** The conversation column: ordinary turns and loop turns, in one order. */
  const transcript = useMemo(
    () => mergeTranscript(chat.turns, loopTurns, loopInstructions),
    [chat.turns, loopTurns, loopInstructions],
  );
  const context = useMemo(() => summariseContext(chat), [chat]);

  /**
   * A run that must finish before another message can be sent.
   *
   * A cancelled run does **not** count, and that is deliberate. DSP-1 measured
   * that a cancelled turn's terminal state is decided locally and that the
   * provider can keep working afterwards, so a run that has been asked to stop
   * may never report an end. Waiting for one would leave the window permanently
   * unable to send anything — the trap this replaces. Sending anyway supersedes
   * it, and the superseded turn says what happened to it.
   */
  const blockingTurn = activeTurn !== null && !activeTurn.cancelRequested;

  /**
   * Everything that decides what a press of Send does, in one value.
   *
   * Assembled here and read by the button, by Enter and by `send` itself, so the
   * three cannot disagree. They used to: the button and the key handler each
   * spelled out `busy !== null && …` separately, and `send` then branched on
   * `useLoop` with no idea whether a walk was already in flight.
   *
   * `otherWorkInProgress` is the line that actually reopens the composer.
   * `busy === 'sending'` is true for the whole of a loop run, and treating that as
   * "DSpatch is occupied" is what made the box dead exactly when it was wanted. A
   * walk in flight is not the window being busy; it is the work the next message
   * is about. Every other `busy` state still blocks, because a modal folder
   * dialog or a cancellation in progress genuinely is the window being elsewhere.
   */
  const composerState = useMemo(
    () => ({
      text: prompt,
      loopRunning: loopBusy,
      loopRunId: loopRunId.current,
      useLoop,
      outstandingTurn: blockingTurn,
      unresolvedAttempts: runState?.needsAcknowledgement.agentTurn ?? [],
      otherWorkInProgress: busy !== null && !(busy === 'sending' && loopBusy),
      sessionOpen: session !== null,
    }),
    [prompt, loopBusy, useLoop, blockingTurn, runState, busy, session],
  );
  const sendRoute = composerSendRoute(composerState);
  const canSend = composerCanSend(composerState);
  const routeNote = composerRouteNote(sendRoute);

  /**
   * The wait for a send that has not come back, as its own state.
   *
   * Non-null for as long as the send call is outstanding, **including** after the
   * provider has announced a run. That is not an oversight: the adapter announces
   * `run.started` before it holds anything it can cancel, so Cancel in this
   * interval fails, and this is the interval in which stopping the wait is the
   * action that actually works.
   */
  const sendPending = busy === 'sending';
  const nothingBackYet = activeTurn === null || activeTurn.deltaCount === 0;
  const sendWait = sendPending ? describeSendWait(waitMs ?? 0, !nothingBackYet) : null;
  const activityText =
    sendPending && nothingBackYet ? (sendWait?.text ?? activity.text) : activity.text;

  /**
   * The subdued running line, and the live log behind it.
   *
   * `null` for as long as nothing is running, which is what makes it transient:
   * DSP-27 #5 asks for the ticker to leave the screen when the result arrives, and
   * it is safe to let it because the loop turn above it carries the mandate, every
   * reply and the recorded ending, and the run record on disk outlives the window.
   */
  const running = useMemo(
    () =>
      activityLine({
        loopLines,
        loopRunning: loopBusy,
        chatActivityText: activityText,
        chatRunning: sendPending || activeTurn !== null,
      }),
    [loopLines, loopBusy, activityText, sendPending, activeTurn],
  );

  /**
   * §9's four questions, answered from what DSpatch has actually seen.
   *
   * *Who is working, on what, what are they waiting for, and what happens next.*
   * DSP-57 #2 and #3 are this: after an interrupted call or a failed handover a
   * person must be able to tell whether work is active, waiting, stopped or
   * unknown, and must be offered something concrete to do about it.
   *
   * `stillWatching` is the load-bearing input and is deliberately not `loopBusy`.
   * The window stops applying a run's events when the user abandons the wait, and
   * a run in that state is one DSpatch cannot see — which is `unknown`, not
   * `active`. `conversationStanding` turns that into `activityIsKnown: false`, and
   * the block below is the one place allowed to draw the run's standing, so a
   * spinner cannot be shown over a run nobody is watching.
   */
  const newestLoopTurn = loopTurns.length === 0 ? null : (loopTurns[loopTurns.length - 1] ?? null);
  /**
   * The clock, for the one line that says how long a step has been quiet.
   *
   * State rather than a `Date.now()` in the render, because a component that reads the
   * clock without re-rendering shows the time it mounted — and a line frozen at "last
   * update just now" while nothing arrives is precisely the false reassurance this
   * work removes. It ticks only while a loop run is in flight.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!loopBusy) {
      return;
    }
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [loopBusy]);
  const standing = useMemo(
    () =>
      conversationStanding({
        turn: newestLoopTurn,
        stillWatching: loopBusy || newestLoopTurn?.ending !== null,
        currentStepLabel,
        instructions: loopInstructions,
      }),
    [newestLoopTurn, loopBusy, currentStepLabel, loopInstructions],
  );

  /**
   * The compressed top of the window: four things continuously, the rest one
   * expander away, and every problem out in front of it.
   *
   * Two of the inputs are worth naming. A save that did not finish is read from
   * the leftover temporaries — the only evidence a save was lost — and until now
   * that evidence was visible only inside the project chooser, which is to say
   * only to someone who went looking for it. And `refusal` is left null on
   * purpose: a refused send is shown at the composer, beside the text it refused
   * and next to the button that would send it again, which is where a person can
   * act on it. The slot exists so that "a refusal is not a detail" is stated
   * where it can be tested rather than in four components.
   *
   * Nothing here decides anything about a run. It moves strings.
   */
  const header: ChatHeaderView = useMemo(
    () =>
      chatHeaderView({
        project:
          session === null
            ? null
            : {
                name: basename(session.workspacePath),
                fullPath: session.workspacePath,
                dspatchSessionId: session.dspatchSessionId,
                providerSessionId: session.providerSessionId,
                gitSummary: session.git.isGitRepository
                  ? `${session.git.branch ?? 'detached'} at ${
                      session.git.headRevision === null
                        ? 'no commit yet'
                        : session.git.headRevision.slice(0, 12)
                    }`
                  : 'not a git repository — no revision to compare against',
                dirtySummary: !session.git.isGitRepository || session.git.error !== null
                  ? 'unknown'
                  : `${String(session.git.dirtyFiles.length)} file${
                      session.git.dirtyFiles.length === 1 ? '' : 's'
                    } already modified before this session`,
              },
        connection: {
          kind: connection.kind,
          modelRequested: connection.kind === 'connected' ? connection.modelRequested : null,
          account: connection.kind === 'connected' ? connection.account : null,
          problem:
            connection.kind === 'not-connected'
              ? connection.reason
              : connection.kind === 'error'
                ? `The connection check itself failed: ${connection.message}`
                : null,
        },
        activityText,
        unresolvedRuns: activity.unresolvedRuns,
        unresolvedAttempts: runState?.needsAcknowledgement.agentTurn ?? [],
        refusal: null,
        saveFailure:
          conversations === null || conversations.partialWrites.length === 0
            ? null
            : `${String(conversations.partialWrites.length)} save${
                conversations.partialWrites.length === 1 ? '' : 's'
              } did not finish and left a temporary file behind. What that save held is lost; ` +
              'nothing already saved is. They are listed under Saved conversations.',
        context: {
          promptsSent: context.promptsSent,
          promptCharactersSent: context.promptCharactersSent,
          fileContentsSentByDspatch: session?.context.fileContentsSentByDspatch ?? 0,
          toolCallsByAgent: context.toolCallsByAgent,
          toolNames: context.toolNames,
        },
        adapterNote: `Provider calls go through the ${environment.adapter.id} adapter in the main process; the window sees run events over IPC and never calls the provider itself.`,
      }),
    [
      session,
      connection,
      activityText,
      activity.unresolvedRuns,
      runState,
      conversations,
      context,
      environment.adapter.id,
    ],
  );

  /**
   * Every attempt a repeat has to name before DSpatch will start another.
   *
   * A list, not the first one. Report 006 measured a restart leaving two unknown
   * outcomes and naming one of them letting the message through, with the second
   * still unnamed — listed and counted, but not seen. The control names all of
   * them and says how many.
   */
  const turnNeedsAcknowledgement = runState?.needsAcknowledgement.agentTurn ?? [];
  const commandNeedsAcknowledgement = runState?.needsAcknowledgement.command ?? [];

  /**
   * Check the connection once.
   *
   * Every path through this counts an attempt, which is what makes the retry
   * bounded: the effect below schedules a re-check only while the policy allows
   * one, and the button below it is what happens after that.
   */
  const checkConnection = useCallback(async (): Promise<void> => {
    setConnection({ kind: 'checking' });
    try {
      const status = await window.dspatch.getConnection();
      setConnection(status);
      setConnectionAttempts((previous) => (status.kind === 'connected' ? 0 : previous + 1));
    } catch (error) {
      setConnection({
        kind: 'error',
        message: describeBridgeFailure(error).message,
        checkedAtUtc: new Date().toISOString(),
      });
      setConnectionAttempts((previous) => previous + 1);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  /**
   * The bounded automatic retry.
   *
   * Two re-checks and then silence, per `connectionRetryPlan`. A failed connection
   * check is the one thing here that is safe to repeat without asking: it sends
   * nothing and changes nothing. A message or a command is never retried this way.
   */
  useEffect(() => {
    if (connection.kind === 'connected' || connection.kind === 'checking') {
      return;
    }
    const plan = connectionRetryPlan(connectionAttempts - 1);
    if (!plan.retry || plan.delayMs === null) {
      return;
    }
    const timer = setTimeout(() => {
      void checkConnection();
    }, plan.delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [connection.kind, connectionAttempts, checkConnection]);

  /** The attempt ledger from the main process. Nothing is hashed for this. */
  const refreshRunState = useCallback(async (): Promise<void> => {
    try {
      setRunState(await window.dspatch.getRunState());
    } catch {
      // Leaves the previous reading in place. An execution-state panel that goes
      // blank when a read fails is worse than one showing a timestamped reading.
    }
    // Asked here because this already runs after everything that changes what is
    // written down — a turn ending, a command, a restore, a session closing — and a
    // failed save is only worth reporting at the moments it could have happened.
    // Reading only: nothing in this path writes, retries or repairs a file.
    try {
      setSaveStatus(await window.dspatch.conversationSaveStatus());
    } catch {
      // The same rule. An unanswered question about the disk is not an answer that
      // the disk is fine, but it is also not evidence of a failure to announce.
    }
  }, []);

  useEffect(() => {
    void refreshRunState();
  }, [refreshRunState]);

  useEffect(() => {
    loopBusyRef.current = loopBusy;
  }, [loopBusy]);

  /** One place that moves the loop transcript, so its rules stay in one module. */
  const applyLoopTurnEvent = useCallback((event: LoopTurnEvent): void => {
    setLoopTurns((previous) => loopTurnsAfter(previous, event));
  }, []);

  /** The same discipline for the user's own messages into a run. */
  const applyLoopInstructionEvent = useCallback((event: LoopInstructionEvent): void => {
    setLoopInstructions((previous) => loopInstructionsAfter(previous, event));
  }, []);

  useEffect(() => {
    return window.dspatch.onChatLoopJournal((journalEntry) => {
      const line = formatChatLiveLogLine(journalEntry, CHAT_LOOP_WINDOW_LOOKUP);
      if (line !== null) {
        setLoopLines((previous) => [...previous, line]);
      }
      // Two facts out of the journal reach the conversation itself rather than
      // only the live log. Which step the run is on, so the standing line can name
      // it instead of saying something is happening; and which branch it took, so
      // a handover in the thread can say why control moved (DSP-53 #4). Everything
      // else stays in the log: this is not the journal being folded into the
      // transcript, it is the two entries a reader of the conversation needs.
      if (journalEntry.kind === 'node-entered' && journalEntry.nodeId !== undefined) {
        const label =
          CHAT_LOOP_WINDOW_LOOKUP.node(journalEntry.nodeId)?.label ?? journalEntry.nodeId;
        setCurrentStepLabel(label);
      }
      if (journalEntry.kind === 'edge-taken') {
        const runId = loopRunId.current;
        const from = journalEntry.data?.['from'];
        const to = journalEntry.data?.['to'];
        if (runId !== null && typeof from === 'string' && typeof to === 'string') {
          const edge = journalEntry.edgeId === undefined
            ? null
            : CHAT_LOOP_WINDOW_LOOKUP.edge(journalEntry.edgeId);
          const outcome = journalEntry.data?.['outcome'];
          const failure = journalEntry.data?.['failure'];
          applyLoopTurnEvent({
            kind: 'branch-taken',
            runId,
            branch: {
              fromNodeId: from,
              toNodeId: to,
              label:
                edge?.label ??
                (typeof outcome === 'string'
                  ? outcome
                  : typeof failure === 'string'
                    ? failure
                    : (journalEntry.edgeId ?? '')),
            },
          });
        }
      }
    });
  }, [applyLoopTurnEvent]);

  useEffect(() => {
    return window.dspatch.onLoopInstruction((payload) => {
      if (payload.kind === 'delivered') {
        applyLoopInstructionEvent({
          kind: 'delivered',
          runId: payload.runId,
          instructionIds: payload.instructionIds,
          delivery: {
            nodeId: payload.nodeId,
            nodeLabel: payload.nodeLabel,
            occurrence: payload.occurrence,
            atUtc: payload.atUtc,
          },
        });
        return;
      }
      applyLoopInstructionEvent({ kind: 'run-ended', runId: payload.runId });
    });
  }, [applyLoopInstructionEvent]);

  /**
   * Put this conversation's kept loop runs back in the column.
   *
   * **Display only.** `listRunRecords` reads files; nothing in this path starts an
   * agent, runs a command or writes into the project, and a run whose record has no
   * ending line comes back as an interrupted run rather than as one still in
   * flight. Resuming a run is the next delivery and is deliberately not reachable
   * from here — a "restore" that helpfully continued would be a defect.
   *
   * A failure to read is swallowed on purpose: the conversation itself opened, and
   * an unreadable run record must not take that down with it. Each record carries
   * its own error into the entry it produces.
   */
  const restoreLoopRuns = useCallback(
    async (conversationId: string | null): Promise<void> => {
      if (conversationId === null || conversationId === '') {
        return;
      }
      try {
        const records = await window.dspatch.listRunRecords(conversationId);
        const restored = loopTurnsFromRecords(records);
        if (restored.length > 0) {
          applyLoopTurnEvent({ kind: 'records-restored', turns: restored });
        }
      } catch {
        // Nothing to say beyond what the conversation already says: no loop run was
        // shown, and none was invented.
      }
    },
    [applyLoopTurnEvent],
  );

  useEffect(() => {
    return window.dspatch.onChatLoopReply((reply) => {
      applyLoopTurnEvent({
        kind: 'agent-replied',
        runId: reply.runId,
        reply: { nodeId: reply.nodeId, nodeLabel: reply.nodeLabel, text: reply.text },
      });
      // The step's turn is over, so it stops being the live one. Carried separately
      // and with the executor's own occurrence, because an empty reply becomes a
      // silent step and never reaches the reply list — and a step that went quiet
      // must still stop reporting that it is waiting for something.
      applyLoopTurnEvent({
        kind: 'step-finished',
        runId: reply.runId,
        nodeId: reply.nodeId,
        occurrence: reply.occurrence,
      });
    });
  }, [applyLoopTurnEvent]);

  /**
   * What the step that is working is doing, as it does it.
   *
   * The channel that closes the 320-second silence. `waitForTurn` handled three event
   * types and none of them arrived before the turn ended; these are the ones it now
   * forwards, folded by the same module the graph view folds them with, so the two
   * windows cannot give different answers about one run.
   */
  useEffect(() => {
    return window.dspatch.onChatLoopActivity((activity) => {
      applyLoopTurnEvent({ kind: 'step-activity', runId: activity.runId, activity });
    });
  }, [applyLoopTurnEvent]);

  // Keep the panel current while anything could be changing. Two reasons, both
  // found by driving the real window: an attempt can move from "cancellation
  // requested" to "unknown outcome" on a timer in the main process with no event
  // to announce it, and a command that is running is only entered in the ledger
  // once its call returns — so without this, the panel showed nothing running
  // while a command was running.
  useEffect(() => {
    if (runState === null || (runState.unresolved.length === 0 && busy === null)) {
      return;
    }
    const timer = setInterval(() => {
      void refreshRunState();
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [runState, busy, refreshRunState]);

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await window.dspatch.listProjects());
    } catch {
      // The list of remembered projects is a convenience. Losing it must not
      // stop the folder picker from working, so the failure is left silent here
      // and the store's own error text is what the panel shows when it has one.
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /**
   * Forget remembered projects.
   *
   * DSP-5 friction 3: nine of ten remembered entries were throwaway `%TEMP%`
   * repositories from overnight verification, several already gone from disk, and
   * nothing in the window could remove one.
   *
   * The listing comes back from the main process rather than being pruned here, so
   * the rows on screen are what the file now says. A refusal to change the file is
   * reported in `note` and leaves the rows where they were, which is the truth.
   */
  const forgetProjects = useCallback(
    async (projectPaths: readonly string[]): Promise<void> => {
      if (projectPaths.length === 0) {
        return;
      }
      setForgetting(true);
      try {
        const outcome = await window.dspatch.forgetProjects(projectPaths);
        setProjects(outcome.projects);
        setForgetNote(outcome.note);
      } catch (error) {
        setForgetNote(
          `Nothing was removed: ${describeBridgeFailure(error).message} The list is ` +
            'unchanged, and no folder or saved conversation was touched.',
        );
      } finally {
        setForgetting(false);
      }
    },
    [],
  );

  /**
   * What DSpatch has left behind in its own sample location (DSP-61).
   *
   * Read when asked for, not on every render: it walks a directory, and nothing in
   * the conversation depends on the answer. A new session generates a folder of its
   * own regardless of what is in this list, so an unreadable location is a note
   * rather than a problem to raise.
   */
  const refreshSampleProjects = useCallback(async (): Promise<void> => {
    setSampleBusy(true);
    try {
      setSamples(await window.dspatch.listSampleProjects());
      setSampleNote(null);
    } catch (error) {
      setSampleNote(
        `Could not read the sample location: ${describeBridgeFailure(error).message} ` +
          'Nothing was removed, and a new sample project does not depend on this.',
      );
    } finally {
      setSampleBusy(false);
    }
  }, []);

  /**
   * Remove the sample projects DSpatch generated, because the person asked.
   *
   * The main process checks every path against the sample location again, so what
   * comes back is what it actually did — including the folders it refused and the
   * ones a live process is holding, each with its reason.
   */
  const cleanUpSampleProjects = useCallback(
    async (paths: readonly string[]): Promise<void> => {
      if (paths.length === 0) {
        return;
      }
      setSampleBusy(true);
      try {
        const outcome = await window.dspatch.cleanUpSampleProjects(paths);
        setSamples(outcome.remaining);
        setSampleCleanup(outcome);
        setSampleNote(null);
      } catch (error) {
        setSampleNote(
          `Nothing was removed: ${describeBridgeFailure(error).message} Every folder ` +
            'is still there.',
        );
      } finally {
        setSampleBusy(false);
      }
    },
    [],
  );

  const refreshConversations = useCallback(async (): Promise<void> => {
    try {
      setConversations(await window.dspatch.listConversations());
    } catch {
      // Same reasoning as the project list: the chooser must still work. An
      // unreadable conversation directory reports itself through the listing's own
      // `error` field, which the panel shows.
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  /**
   * Ask the main process whether the displayed result still describes the code.
   *
   * A failure leaves the previous reading in place rather than replacing it with
   * a guess. That direction is deliberate: a stuck verdict can only be wrongly
   * "stale" or wrongly "unknown", never wrongly "current".
   */
  const refreshFreshness = useCallback(async (): Promise<void> => {
    try {
      setFreshness(await window.dspatch.getTestFreshness());
    } catch {
      // Intentionally silent; the previous reading and its timestamp stay.
    }
  }, []);

  // Subscribed before the first prompt, not after: early events would be lost.
  // Routing lives in `turn-routing.ts` so that the superseded-run rule can be
  // tested against a counter-example instead of only asserted here.
  useEffect(() => {
    const unsubscribe = window.dspatch.onAgentEvent((event) => {
      setChat((previous) => routeEvent(previous, event, pendingPrompt.current));
      if (event.type === 'run.started' || event.type === 'run.finished') {
        // Both ends of a run change an attempt's state in the main process.
        void refreshRunState();
      }
      if (
        event.type === 'run.finished' &&
        runEndingNeedsConnectionRecheck(event.status, event.errorMessage)
      ) {
        // Report 005 measured the card reading `connected` for a whole 60-second
        // outage while the attempt beside it read `failed`. The check sends nothing
        // and starts nothing, so a run that ended badly is a good enough reason.
        setRecheckNote(connectionRecheckNote('run-failed', event.errorMessage ?? null));
        setConnectionAttempts(0);
        void checkConnection();
      }
      if (event.type === 'run.finished') {
        void window.dspatch
          .getTurnUsage(event.dspatchRunId)
          .then((usage) => {
            setChat((previous) => attachUsage(previous, event.dspatchRunId, usage));
          })
          .catch(() => {
            // A failed usage read leaves `usage` null, which the UI shows as
            // unknown. Silently showing zero would be the actual error.
          });
        // The end of a turn is the likeliest moment for the code to have moved
        // on, so this is when an earlier test result most needs re-checking.
        void refreshFreshness();
      }
    });
    return unsubscribe;
  }, [checkConnection, refreshFreshness, refreshRunState]);

  /**
   * Put a failed turn's text back in the composer, or say where it is.
   *
   * Report 005 measured the promise this keeps: a failed attempt's note said "Your
   * text and everything already received are kept", and after a run-level failure
   * the composer was empty, because the send had been accepted — and the text
   * cleared — before the run failed. The decision is in `recovery.ts`; this only
   * carries it out, once per failed run.
   */
  const composerRestoredForRun = useRef<string | null>(null);
  useEffect(() => {
    const failed = [...chat.turns].reverse().find((turn) => turn.status === 'error');
    if (failed === undefined || composerRestoredForRun.current === failed.dspatchRunId) {
      return;
    }
    composerRestoredForRun.current = failed.dspatchRunId;
    const outcome = restoreComposerAfterRunFailure(failed.prompt, prompt);
    if (outcome.restore) {
      setPrompt(outcome.text);
    }
    setComposerNote(outcome.note);
  }, [chat.turns, prompt]);

  /**
   * Take down a failure block whose condition has passed.
   *
   * The `already has an active run` message stayed up for 30 seconds after the run
   * it named had reported `cancelled` and the panel below already said nothing was
   * unresolved. Two parts of the window disagreeing is the defect; nothing is
   * retried to find this out, it is read from the ledger reading already on screen.
   */
  useEffect(() => {
    if (actionError === null || runState === null) {
      return;
    }
    const resolved = failureHasResolved(actionError, {
      unresolvedAgentTurns: runState.unresolved.filter(
        (attempt) => attempt.kind === 'agent-turn',
      ).length,
      needsAcknowledgementAgentTurn: runState.needsAcknowledgement.agentTurn,
    });
    if (resolved) {
      setActionError(null);
      setResolvedNote(FAILURE_RESOLVED_NOTE);
    }
  }, [actionError, runState]);

  /**
   * Count the wait while a send has produced nothing.
   *
   * A number that moves is the difference between "waiting" and "hung" for the
   * person watching, and this is the interval the window previously had nothing to
   * say about at all.
   */
  useEffect(() => {
    if (busy !== 'sending' || activeTurn !== null) {
      waitStartedAt.current = null;
      return;
    }
    waitStartedAt.current ??= Date.now();
    const startedAt = waitStartedAt.current;
    const timer = setInterval(() => {
      setWaitMs(Date.now() - startedAt);
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [busy, activeTurn]);

  /**
   * What the top application menu asked for.
   *
   * The menu is where the session details, identifiers, paths and diagnostics went
   * (DSP-60 #2). It asks; the window decides what the request means, so the menu
   * item and the button in the bar cannot drift into meaning different things.
   */
  useEffect(
    () =>
      window.dspatch.onMenuCommand((command) => {
        if (command === 'show-session-details') {
          setDetailsOpen(true);
        } else if (command === 'hide-session-details') {
          setDetailsOpen(false);
        } else if (command === 'show-sample-projects') {
          // Shows, and nothing more. The removing is the button in that panel,
          // because DSP-61's decision was that clearing out old sample projects is
          // an act a person performs rather than a side effect of looking.
          setDetailsOpen(true);
          void refreshSampleProjects();
        } else {
          setDetailsOpen(false);
          setChoosing(true);
        }
      }),
    [refreshSampleProjects],
  );

  /* ----------------------------------------------------------------------- */
  /* DSP-58: following the latest, and leaving a reader where they are        */
  /* ----------------------------------------------------------------------- */

  const transcriptMetrics = useCallback((): ScrollMetrics | null => {
    const element = transcriptRef.current;
    return element === null
      ? null
      : {
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
  }, []);

  const scrollToLatest = useCallback((): void => {
    const element = transcriptRef.current;
    if (element === null) {
      return;
    }
    // One element. Never `scrollIntoView`, which would take the ancestors with it.
    element.scrollTop = element.scrollHeight;
    // Read back rather than remembered: the browser clamps the assignment to the
    // foot, and the clamped value is what the scroll event this produces will
    // report. Comparing against what was asked for instead of what was applied
    // would make every one of our own moves look like the person's.
    appliedScrollTop.current = element.scrollTop;
    followingLatest.current = true;
    setReturnToLatest(false);
  }, []);

  /**
   * Hold the thread, and re-follow when its own viewport changes height.
   *
   * The thread shrinks by about 170 px the moment a send goes out, because the
   * composer grows an acknowledgement and a Cancel while a turn is in flight and
   * takes that space from the thread above it. The foot of the conversation moves
   * without any content arriving, so nothing in the content effect runs and the
   * message the person has just sent sits short of the bottom until the first of
   * the reply lands. Against the local adapter that is 40 ms; against a provider
   * that thinks for four seconds it is four seconds of their own message being
   * not quite in view, which is the complaint.
   *
   * The observer is attached here rather than in an effect because the thread is
   * only in the document once a session is open: an effect running at mount finds
   * nothing to observe and silently never attaches, which is what the first
   * version of this did. It observes the element rather than polling it — one
   * callback per real layout change, and none at all for someone reading further
   * up, whose position this must not take.
   */
  const attachTranscript = useCallback(
    (element: HTMLDivElement | null) => {
      transcriptRef.current = element;
      if (element === null || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => {
        if (followingLatest.current) {
          scrollToLatest();
        }
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        transcriptRef.current = null;
      };
    },
    [scrollToLatest],
  );

  const noteTranscriptScrolled = useCallback((): void => {
    const metrics = transcriptMetrics();
    if (metrics === null) {
      return;
    }
    const following = followAfterScrollEvent({
      metrics,
      appliedScrollTop: appliedScrollTop.current,
    });
    if (Math.abs(metrics.scrollTop - (appliedScrollTop.current ?? Number.NaN)) > 1) {
      // Whoever moved it, it is no longer where the window put it, so the next
      // event has to be measured rather than trusted.
      appliedScrollTop.current = null;
    }
    followingLatest.current = following;
    setReturnToLatest(!following);
  }, [transcriptMetrics]);

  /**
   * Keep the latest in view for someone following it, and only for them.
   *
   * The dependencies are everything that changes the height of the conversation:
   * the merged transcript, the streaming answer, the standing block and the
   * activity ticker. Status updates and handovers arrive through the last two,
   * which is why they are listed rather than excluded — §9.1 requires them not to
   * reset the position, and the way to know that is to let them run through the
   * same decision as everything else.
   */
  useEffect(() => {
    if (transcriptRef.current === null) {
      return;
    }
    const reason = scrollReason.current;
    scrollReason.current = 'content';
    if (decideScroll({ reason, followingLatest: followingLatest.current }) === 'scroll-to-latest') {
      scrollToLatest();
      return;
    }
    const metrics = transcriptMetrics();
    if (metrics !== null) {
      setReturnToLatest(shouldOfferReturnToLatest(metrics));
    }
  }, [
    transcript,
    activeTurn?.answer,
    loopLines,
    currentStepLabel,
    detailsOpen,
    scrollToLatest,
    transcriptMetrics,
  ]);

  const startSession = useCallback(
    async (request: StartSessionRequest): Promise<void> => {
      setBusy('starting-session');
      setSessionError(null);
      setActionError(null);
      setTest(null);
      setTestError(null);
      setFreshness(null);
      setStopNote(null);
      setStopWaitingNote(null);
      setWorkspace(null);
      setCancelObs(null);
      setChat(emptyChatState(null));
      scrollReason.current = 'conversation-replaced';
      // The loop half of the conversation column has the same lifetime as the
      // ordinary half cleared on the line above. Whatever `request` turns out to
      // be — another project, or a new provider session over this one — the
      // conversation on screen after it is not the one those loop runs were sent
      // in. `loopBusy` is deliberately left alone: it belongs to the send
      // machine, not to what the column shows.
      applyLoopTurnEvent({ kind: 'conversation-replaced' });
      applyLoopInstructionEvent({ kind: 'conversation-replaced' });
      setLoopLines([]);
      setCurrentStepLabel(null);
      setRecheckNote(null);
      setComposerNote(null);
      setResolvedNote(null);
      try {
        const opened = await window.dspatch.startChatSession(request);
        setSession(opened);
        setChat(emptyChatState(opened.dspatchSessionId));
        // The fields are seeded from the project, then owned by the user. A later
        // session over a different project reseeds them; nothing else does.
        setTestCommand(opened.suggestedTestCommand);
        setTestCwd(opened.suggestedTestCwd);
        setChoosing(false);
        void restoreLoopRuns(opened.conversationId);
        // A restored conversation about a different project is no longer the history
        // of what is on screen, and leaving it there would invite reading its diff
        // as belonging to this project. One about the same project stays: it is this
        // conversation's earlier half, which is the whole point of continuing.
        setRestored((previous) =>
          previous === null ||
          samePathOn(environment.platform, previous.project.path, opened.workspacePath)
            ? previous
            : null,
        );
        void refreshProjects();
        void refreshConversations();
      } catch (error) {
        setSessionError(describeBridgeFailure(error));
      } finally {
        setBusy(null);
        // Closing a session records what became unknown about anything still
        // unresolved, so the panel has to be re-read here rather than kept.
        void refreshRunState();
      }
    },
    [
      applyLoopTurnEvent,
      environment.platform,
      refreshConversations,
      refreshProjects,
      refreshRunState,
      restoreLoopRuns,
    ],
  );

  /**
   * Read a saved conversation back.
   *
   * Deliberately not a session. Nothing is sent, nothing is run and nothing is
   * written into the project — the main process says so in its own words and counts
   * the three things it did not repeat, which the panel shows as it arrived. The
   * live state is cleared first so that no live control can act on restored
   * evidence: `session` stays `null`, so the composer and the test panel are not on
   * screen until the project is opened again.
   */
  const resume = useCallback(
    async (conversationId: string): Promise<void> => {
      setBusy('resuming');
      setResumeError(null);
      setSessionError(null);
      setActionError(null);
      setSession(null);
      setChat(emptyChatState(null));
      // Same rule as `startSession`. The restored column replaces the live one, so
      // a loop run sent in the live one is not part of what is now on screen.
      // `session` is `null` here, so the entry is off screen either way — but it
      // would still be in memory waiting for the next session to draw it.
      applyLoopTurnEvent({ kind: 'conversation-replaced' });
      applyLoopInstructionEvent({ kind: 'conversation-replaced' });
      setLoopLines([]);
      setCurrentStepLabel(null);
      setTest(null);
      setTestError(null);
      setFreshness(null);
      setWorkspace(null);
      setCancelObs(null);
      setStopNote(null);
      setStopWaitingNote(null);
      setRecheckNote(null);
      setComposerNote(null);
      setResolvedNote(null);
      try {
        const conversation = await window.dspatch.resumeConversation(conversationId);
        setRestored(conversation);
        void restoreLoopRuns(conversationId);
        setRestoredAtUtc(new Date().toISOString());
        // Seeded, not run. The command is the one this conversation used, so
        // continuing does not mean retyping it — but it is only run when pressed.
        setTestCommand(conversation.session.suggestedTestCommand);
        setTestCwd(conversation.session.suggestedTestCwd);
        setChoosing(false);
      } catch (error) {
        setResumeError(describeBridgeFailure(error));
      } finally {
        setBusy(null);
        // The restore may have turned saved attempts into explicit unknowns, and
        // those are what block the next message. Read the ledger rather than
        // trusting the panel's previous contents.
        void refreshRunState();
      }
    },
    [applyLoopTurnEvent, refreshRunState, restoreLoopRuns],
  );

  const pickFolder = useCallback(async (): Promise<void> => {
    setBusy('picking-folder');
    setSessionError(null);
    let chosen: string | null = null;
    try {
      const outcome = await window.dspatch.pickProjectFolder();
      chosen = outcome.kind === 'chosen' ? outcome.path : null;
    } catch (error) {
      setSessionError(describeBridgeFailure(error));
    } finally {
      setBusy(null);
    }
    if (chosen !== null) {
      await startSession({ kind: 'folder', path: chosen });
    }
  }, [startSession]);

  /**
   * Send the composer's text.
   *
   * Two things here carry AC#3. The text is cleared only after the send is
   * accepted, so a failure leaves it where the user can send it again; and the
   * result is applied only if this is still the send the window is waiting for, so
   * a send that was abandoned cannot come back and overwrite what is being typed.
   *
   * `acknowledgedAttemptIds` is passed straight through to the main process, which
   * is where the decision is made. The window cannot talk itself past the gate.
   *
   * **Where the text goes is decided by `composerSendRoute`, not here.** DSP-53
   * unlocks the composer during a loop run, and the whole hazard of doing that is
   * a routing mistake: a press of Send while a walk is in flight must add to that
   * walk and must never start a second one in the same working copy. Asking one
   * function which of the three things this press is keeps that guarantee
   * structural — the `instruction` branch below is the only thing reachable while
   * a run is walking, and `loop-run` is unreachable from there.
   */
  const send = useCallback(
    async (acknowledgedAttemptIds?: readonly string[]): Promise<void> => {
      const text = prompt.trim();
      if (text === '') {
        return;
      }
      const route = composerSendRoute(composerState);
      if (route.kind === 'blocked') {
        setComposerNote(route.reason);
        return;
      }
      // Their own message is what they want to see, wherever they had scrolled to.
      scrollReason.current = 'sent';
      if (route.kind === 'instruction') {
        // Into the run that is walking. No generation, no loop-busy flag and no
        // `busy`: this send does not wait for a provider turn and must not make
        // the window look as though it does — the run it joins is what is working.
        setActionError(null);
        try {
          const outcome = await window.dspatch.addLoopInstruction({
            runId: route.runId,
            text,
          });
          if (outcome.kind === 'refused') {
            // The text stays in the box, which is what the refusal says. Losing
            // what someone typed at the moment of telling them no is the cheapest
            // way to make a window feel hostile.
            setComposerNote(outcome.reason);
            return;
          }
          applyLoopInstructionEvent({
            kind: 'received',
            instruction: {
              id: outcome.instructionId,
              runId: route.runId,
              text,
              receivedAtUtc: outcome.receivedAtUtc,
              delivered: null,
              runEnded: false,
            },
          });
          setComposerNote(null);
          setPrompt('');
        } catch (error) {
          setActionError(describeBridgeFailure(error));
        }
        return;
      }
      // Every send establishes the loop-busy flag, an ordinary one included: this
      // send is the one the window now waits on, so a walk left outstanding by an
      // earlier send must not keep the flag — see chatSendAfter for the invariant.
      // `route`, not `useLoop`. They agree here — the route is only `loop-run`
      // when the toggle is on and nothing is walking — but reading the route is
      // what keeps them unable to disagree later.
      const walksLoop = route.kind === 'loop-run';
      const started = chatSendAfter(
        { generation: sendGeneration.current, loopBusy: loopBusyRef.current },
        { kind: 'send-started', walksLoop },
      );
      const generation = started.generation;
      sendGeneration.current = generation;
      setLoopBusy(started.loopBusy);
      loopBusyRef.current = started.loopBusy;
      setBusy('sending');
      setActionError(null);
      setWaitMs(0);
      pendingPrompt.current = text;
      try {
        if (walksLoop) {
          setLoopLines([]);
          setCurrentStepLabel(null);
          const runId = newChatLoopRunId();
          loopRunId.current = runId;
          // The mandate is echoed now, not when the run ends. A person who types and
          // sees nothing assumes it was lost, which is the complaint this answers.
          applyLoopTurnEvent({
            kind: 'mandate-sent',
            runId,
            mandate: text,
            atUtc: new Date().toISOString(),
          });
          let outcome: Awaited<ReturnType<typeof window.dspatch.startChatLoopRun>>;
          try {
            outcome = await window.dspatch.startChatLoopRun({
              runId,
              mandate: text,
            });
          } catch (error) {
            // The entry is closed whatever happened to the call, because a mandate on
            // screen with no account of it is the state this must never leave behind.
            applyLoopTurnEvent({
              kind: 'send-threw',
              runId,
              message: describeBridgeFailure(error).message,
            });
            throw error;
          }
          // Not guarded by the generation: a run whose wait was abandoned still ends,
          // and its ending belongs on the entry that echoed its mandate.
          applyLoopTurnEvent({ kind: 'run-settled', runId, outcome });
          if (sendGeneration.current === generation) {
            if (outcome.kind === 'refused' || outcome.kind === 'failed') {
              setActionError(
                describeBridgeFailure(
                  new Error(outcome.kind === 'refused' ? outcome.reason : outcome.note),
                ),
              );
            } else {
              setPrompt('');
            }
          }
        } else {
          await window.dspatch.sendPrompt(text, acknowledgedAttemptIds);
          if (sendGeneration.current === generation) {
            setPrompt('');
          }
        }
      } catch (error) {
        if (sendGeneration.current === generation) {
          const failure = describeBridgeFailure(error);
          setActionError(failure);
          if (failure.kind === 'connection') {
            setRecheckNote(connectionRecheckNote('send-failed', failure.message));
            setConnectionAttempts(0);
            void checkConnection();
          }
        }
      } finally {
        // The flag is settled through the same helper, which leaves a newer send's
        // flag alone rather than clearing it: a walk can settle long after the send
        // that started it has stopped being the one the window waits on.
        const settled = chatSendAfter(
          { generation: sendGeneration.current, loopBusy: loopBusyRef.current },
          { kind: 'send-settled', generation },
        );
        setLoopBusy(settled.loopBusy);
        loopBusyRef.current = settled.loopBusy;
        if (sendGeneration.current === generation) {
          setBusy(null);
          setWaitMs(null);
        }
        void refreshRunState();
      }
    },
    [
      applyLoopInstructionEvent,
      applyLoopTurnEvent,
      checkConnection,
      composerState,
      prompt,
      refreshRunState,
    ],
  );

  /**
   * Say on the entry that a stop was asked for.
   *
   * Called from all three stop paths. It records the request and nothing more:
   * `cancelChatLoopRun` only asks the run to abort, so claiming here that the agent
   * stopped would be the window inventing a terminal state.
   */
  const noteLoopStopRequested = useCallback(
    (abandonsWait: boolean): void => {
      const runId = loopRunId.current;
      if (runId === null) {
        return;
      }
      applyLoopTurnEvent({ kind: 'stop-requested', runId, abandonsWait });
    },
    [applyLoopTurnEvent],
  );

  const cancel = useCallback(async (): Promise<void> => {
    setBusy('cancelling');
    setActionError(null);
    // Cancel does not give up on the send, so the send it interrupts still ends in
    // its own generation-guarded cleanup and clears the flag there. It does clear
    // `busy` below while an aborted walk is still outstanding, which re-enables
    // Send; the flag that a new send starting there must hold is established by
    // that send, not corrected here, so this state keeps one owner per event.
    const plan = planChatCancel({ loopBusy: loopBusyRef.current, abandonsSend: false });
    if (plan.target === 'chat-loop') {
      noteLoopStopRequested(false);
      try {
        const outcome = await window.dspatch.cancelChatLoopRun();
        setStopWaitingNote(outcome.note);
      } catch (error) {
        setActionError(describeBridgeFailure(error));
      } finally {
        setBusy(null);
        void refreshRunState();
      }
      return;
    }
    setChat((previous) => markCancelRequested(previous));
    try {
      await window.dspatch.cancelRun();
      setCancelObs(await window.dspatch.getCancelObservations());
    } catch (error) {
      setActionError(describeBridgeFailure(error));
    } finally {
      setBusy(null);
      void refreshRunState();
    }
  }, [noteLoopStopRequested, refreshRunState]);

  /**
   * Stop waiting for a send that has not started a run.
   *
   * The gap this fills was measured rather than imagined: 11–12 seconds between
   * Send and the first text, during which Cancel has no run to cancel. The window
   * stops waiting immediately — the pending call is left to settle in the main
   * process, which asks any run that does appear to stop — and nothing here claims
   * that the provider stopped.
   */
  const stopWaiting = useCallback(async (): Promise<void> => {
    sendGeneration.current += 1;
    const plan = planChatCancel({ loopBusy: loopBusyRef.current, abandonsSend: true });
    setBusy(null);
    setWaitMs(null);
    // The send this belonged to has just been abandoned, so its cleanup will not
    // match its generation and will never run. Clearing here is what keeps the
    // next Cancel pointed at the run it is meant to stop.
    const nextLoopBusy = loopBusyAfterChatCancel(loopBusyRef.current, plan);
    setLoopBusy(nextLoopBusy);
    loopBusyRef.current = nextLoopBusy;
    if (plan.target === 'chat-loop') {
      noteLoopStopRequested(true);
      try {
        const outcome = await window.dspatch.cancelChatLoopRun();
        setStopWaitingNote(outcome.note);
      } catch (error) {
        setActionError(describeBridgeFailure(error));
      } finally {
        void refreshRunState();
      }
      return;
    }
    try {
      const outcome = await window.dspatch.abandonSend();
      setStopWaitingNote(outcome.note);
      if (outcome.cancelledRun) {
        setChat((previous) => markCancelRequested(previous));
        setCancelObs(await window.dspatch.getCancelObservations());
      }
    } catch (error) {
      setActionError(describeBridgeFailure(error));
    } finally {
      void refreshRunState();
    }
  }, [noteLoopStopRequested, refreshRunState]);

  const refreshCancelObservations = useCallback(async (): Promise<void> => {
    try {
      setCancelObs(await window.dspatch.getCancelObservations());
    } catch {
      // Leaves the previous reading in place rather than replacing it with a guess.
    }
  }, []);

  /**
   * Run the command.
   *
   * The previous result is **not** cleared first. AC#3 requires execution logs to
   * survive errors, and clearing on the way in means a run that fails to start
   * takes the last real result with it. It is replaced when a new one arrives, and
   * the freshness line above it always names the code it describes.
   */
  const runTest = useCallback(
    async (acknowledgedAttemptIds?: readonly string[]): Promise<void> => {
      setBusy('running-test');
      setTestError(null);
      setStopNote(null);
      try {
        const outcome = await window.dspatch.runWorkspaceTest({
          command: testCommand,
          cwd: testCwd,
          ...(acknowledgedAttemptIds === undefined ? {} : { acknowledgedAttemptIds }),
        });
        setTest(outcome);
        await refreshFreshness();
      } catch (error) {
        setTestError(describeBridgeFailure(error));
      } finally {
        setBusy(null);
        void refreshRunState();
      }
    },
    [refreshFreshness, refreshRunState, testCommand, testCwd],
  );

  const stopTest = useCallback(async (): Promise<void> => {
    try {
      setStopNote((await window.dspatch.stopWorkspaceTest()).note);
    } catch (error) {
      setStopNote(describeBridgeFailure(error).message);
    } finally {
      void refreshRunState();
    }
  }, [refreshRunState]);

  const readFiles = useCallback(async (): Promise<void> => {
    setBusy('reading-files');
    setActionError(null);
    try {
      setWorkspace(await window.dspatch.getWorkspaceChanges());
      // The working copy was just hashed for the diff, so this is the cheapest
      // moment to find out whether the test result has been left behind by it.
      await refreshFreshness();
    } catch (error) {
      setActionError(describeBridgeFailure(error));
    } finally {
      setBusy(null);
    }
  }, [refreshFreshness]);

  // While a cancellation watch is running, keep the panel current. The watch is
  // the only thing that can distinguish "we stopped listening" from "the provider
  // stopped", so a stale reading would be the wrong thing to leave on screen.
  useEffect(() => {
    if (cancelObs === null || !cancelObs.watching) {
      return;
    }
    const timer = setInterval(() => {
      void refreshCancelObservations();
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [cancelObs, refreshCancelObservations]);

  /**
   * Keep the freshness verdict current while a result is on screen.
   *
   * Polling because a file can change from outside DSpatch entirely — an editor,
   * a build, a `git checkout` — and a result that only re-checked on DSpatch's
   * own actions would keep showing green through all of them. The period is
   * derived from what the last check actually cost, so hashing a large project
   * slows the polling down instead of occupying the main process.
   */
  const freshnessPeriodMs = freshnessPollMs(freshness?.durationMs ?? null);
  useEffect(() => {
    if (test === null) {
      return;
    }
    const timer = setInterval(() => {
      void refreshFreshness();
    }, freshnessPeriodMs);
    return () => {
      clearInterval(timer);
    };
  }, [test, freshnessPeriodMs, refreshFreshness]);

  /**
   * The scripted run.
   *
   * It operates the controls below rather than calling the bridge directly, so
   * what it proves is that the window does the work. `scriptStarted` guards
   * against React's development-mode double effect.
   */
  useEffect(() => {
    if (scriptStarted.current) {
      return;
    }
    scriptStarted.current = true;
    void window.dspatch.getScriptedRun().then((plan) => {
      if (plan === null) {
        return;
      }
      void runScriptedWorkflow(plan).then((report) => {
        window.dspatch.reportScriptedRun(report);
      });
    });
  }, []);

  const showChooser = session === null || choosing;

  return (
    <>
      {/*
        No project row. DSpatch's name, the project, *Open another project*,
        *connected* and *Session details* were a line of chrome above every
        conversation, and the same two of them were offered again inside the
        conversation's own heading. Changing project and the session details are
        menu items, which is where §9 puts identifiers and diagnostics; which
        project is open is the conversation's heading, one line lower.

        What stays out here is only what has gone wrong: `headerProblems` decides
        what counts, and it draws nothing at all when nothing is wrong.
      */}
      <AppBarProblems
        header={header}
        connection={connection}
        connectionAttempts={connectionAttempts}
        onReconnect={() => {
          setConnectionAttempts(0);
          void checkConnection();
        }}
      />

      {recheckNote !== null && (
        <p className="app__note" data-ev="connection-recheck-note">
          {recheckNote}
        </p>
      )}

      {/*
        The work area: one column of fixed height, holding the conversation and,
        when the top menu opens it, the session details over the top of it. Both
        stay mounted — the details view is hidden rather than discarded, so opening
        it costs nothing and closing it loses nothing — and only one is on screen.
      */}
      <div className={`workarea${detailsOpen ? ' workarea--details' : ''}`}>
      <div className="workarea__lead">
      {showChooser && (
        <ProjectChooser
          projects={projects}
          conversations={conversations}
          connection={connection}
          busy={busy}
          sessionError={sessionError}
          resumeError={resumeError}
          hasSession={session !== null}
          onPick={() => {
            void pickFolder();
          }}
          onOpen={(projectPath) => {
            void startSession({ kind: 'folder', path: projectPath });
          }}
          forgetting={forgetting}
          forgetNote={forgetNote}
          onForget={(projectPaths) => {
            void forgetProjects(projectPaths);
          }}
          onSample={() => {
            void startSession({ kind: 'sample' });
          }}
          onResume={(conversationId) => {
            void resume(conversationId);
          }}
          onRefreshConversations={() => {
            void refreshConversations();
          }}
          onDismiss={() => {
            setChoosing(false);
          }}
        />
      )}

      {restored !== null && (
        <RestoredPanel
          restored={restored}
          restoredAtUtc={restoredAtUtc}
          busy={busy}
          hasSession={session !== null}
          onContinue={() => {
            void startSession({ kind: 'folder', path: restored.project.path });
          }}
          onClose={() => {
            setRestored(null);
            setRestoredAtUtc(null);
          }}
        />
      )}
      </div>

      {session !== null && (
        <>
          <section className="panel panel--conversation">
            <div className="panel__head">
              {/* Which project this conversation is about, and nothing else on the
                  line. §9 asks for project identity to stay compact rather than
                  wait for a left explorer; this is the compact version of it. */}
              <h2
                className="panel__title panel__title--project"
                data-ev="project-path"
                title={session.workspacePath}
              >
                {header.project}
              </h2>
              <div className="panel__actions">
                <button
                  type="button"
                  className="button button--quiet"
                  data-ev="edit-agent-loops"
                  title="Opens a separate window. This conversation and any running loop keep working."
                  onClick={() => {
                    // Its own window, not this one. The editor used to replace the chat
                    // here, and on 17 September that lost Niclas his open project; keeping
                    // the chat mounted and hidden repaired it and remained a workaround for
                    // two views competing for one window. Opening starts no work, and
                    // asking twice focuses the window that is already open.
                    void window.dspatch.openLoopEditor().then(
                      (outcome) => {
                        setEditorWindowNote(outcome.kind === 'opened' ? null : outcome.note);
                      },
                      () => {
                        setEditorWindowNote(
                          'The loop editor window could not be opened, and DSpatch did not get a reason.',
                        );
                      },
                    );
                  }}
                >
                  Edit agent loops
                </button>
              </div>
            </div>

            {editorWindowNote === null ? null : (
              <p className="note" data-ev="editor-window-note">
                {editorWindowNote}
              </p>
            )}

            {/*
              Whether Cursor still had the earlier session, what the recap will
              contain and how the resumption was established are all in the
              session details now. They are true and they are long, and §9 puts
              long explanations of session restoration out of the conversation —
              see `SessionContinuity`, which draws exactly the text that used to
              be here.
            */}

            {/*
              A save that did not happen, said where the work it concerns is.

              Above the conversation rather than behind a disclosure, because it is
              the one thing in this window that a person has to act on *before* they
              carry on: everything on screen is real and still copyable, and a
              restart is what would lose it. §5's rule about unknowns applies to the
              silence this replaces — the failure was recorded and shown to nobody,
              so the next restart quietly opened an older version of the work.
            */}
            {saveStatus?.error !== null && saveStatus !== null && (
              <p className="app__error" data-ev="save-error">
                {saveStatus.error} Everything in this conversation is still on screen
                and can still be selected and copied out
                {saveStatus.filePath === null
                  ? ''
                  : `; the file DSpatch was writing to is ${saveStatus.filePath}`}
                . A restart is what would lose it, so copy anything you need before
                closing this window.
              </p>
            )}
            {/* The scroller and the way back to its foot, in one box, so the
                button is placed against the conversation rather than against a
                guess about how tall the composer is today. */}
            <div className="conversation">
            <div
              className="transcript"
              data-ev="transcript"
              ref={attachTranscript}
              onScroll={noteTranscriptScrolled}
            >
              {/*
                This project's earlier messages, above the ones sent since it was
                opened and in the order the file holds them.

                Drawn here rather than in a panel because it is the same
                conversation: §9 asks for one continuous thread, and putting the
                history somewhere else would be the "find the answer in a separate
                output panel" that section rules out. The loop half of this column
                has restored itself from the run records since DSP-25, which is why
                Niclas reopened a project and met an old loop run with none of his
                own messages — the ordinary half had nothing doing the same job.

                **History, not memory.** These are messages read from a file. What
                the provider's session retains is a different question, decided by a
                resume that either worked or did not, and `SessionContinuity` above
                is where that is said — including the recap DSpatch had to send in
                its place. Nothing here implies the agent remembers any of it.
              */}
              {session.restoredHistory.messages.length > 0 && (
                <>
                  <p className="app__note" data-ev="history-mark">
                    {session.restoredHistory.messages.length} earlier message
                    {session.restoredHistory.messages.length === 1 ? '' : 's'} in this
                    conversation, read back from{' '}
                    <code data-ev="history-file">
                      {session.restoredHistory.filePath ?? 'memory'}
                    </code>
                    {session.restoredHistory.savedAtUtc === null
                      ? ''
                      : `, saved ${session.restoredHistory.savedAtUtc}`}
                    . This is what was written down. Whether the agent still has it is
                    said above, where the session says what it could continue.
                  </p>
                  {session.restoredHistory.messages.map((message) => (
                    <RestoredMessage
                      key={`history-${String(message.ordinal)}-${message.dspatchRunId}`}
                      message={message}
                      prefix="history-turn"
                      quiet
                    />
                  ))}
                </>
              )}
              {session.restoredHistory.error !== null && (
                <p className="app__error" data-ev="history-error">
                  {session.restoredHistory.error}
                </p>
              )}
              {transcript.length === 0 && session.restoredHistory.messages.length === 0 && (
                <p className="app__note">
                  Nothing sent yet. Ask a question to read the code, or request a
                  change — a change request authorises the agent to edit files in{' '}
                  <code>{session.workspacePath}</code>.
                </p>
              )}
              {/*
                One column, in the order things happened. Loop turns are separate
                state — a loop run is not a provider run this window is subscribed
                to — so they are merged for display by time rather than appended,
                because an ordinary message sent after a loop run would otherwise be
                drawn above it and misstate the order of the user's own work.
              */}
              {transcript.map((item) =>
                item.kind === 'chat' ? (
                  <Turn
                    key={item.turn.dspatchRunId}
                    turn={item.turn}
                    index={item.index}
                    active={item.turn.dspatchRunId === activeTurn?.dspatchRunId}
                  />
                ) : item.kind === 'loop' ? (
                  <LoopTurnEntry
                    key={item.turn.runId}
                    turn={item.turn}
                    index={item.index}
                    /* Only the run the standing was computed from, so one run's
                       status can never be drawn against another's mandate. */
                    standing={item.turn.runId === newestLoopTurn?.runId ? standing : null}
                    stillWatching={item.turn.runId === newestLoopTurn?.runId && loopBusy}
                    nowMs={nowMs}
                  />
                ) : (
                  <InstructionEntry
                    key={item.instruction.id}
                    instruction={item.instruction}
                    index={item.index}
                  />
                ),
              )}
              {/*
                One subdued line saying what is happening, and the live log behind
                it for whoever wants it.

                This used to be the whole journal, permanently, in a bordered box
                beside turns that already carry their own account of themselves —
                the "a run adds its own live log" half of the debug-window
                complaint. Now it is a ticker: `activityLine` returns null the
                moment nothing is running, and the entry above it keeps the mandate,
                every reply and the recorded ending. Nothing here is written by
                DSpatch about what an agent is thinking. The sentence is either one
                the runner recorded or one of two statements about what DSpatch
                itself knows.
              */}
              {/*
                Where the run stands is no longer drawn here. It is drawn inside
                the loop entry it belongs to — see `RunStanding` — because a block
                at the foot of the column belongs to whatever is newest, and a
                finished run's status was therefore following every later message
                down the page. The ticker below is different and stays: it is
                transient by construction and disappears when nothing is running.
              */}
              {running !== null && (
                <div className="running" data-ev="running-activity">
                  <p className="running__line" data-ev="running-line">
                    {running.text}
                  </p>
                  {running.earlier.length > 0 && (
                    <details data-ev="running-earlier">
                      <summary className="running__summary">
                        {running.earlier.length} earlier step
                        {running.earlier.length === 1 ? '' : 's'} in this run
                      </summary>
                      <ol className="loop-log" aria-label="Loop log" data-ev="loop-log">
                        {running.earlier.map((line, index) => (
                          <li key={`${String(index)}-${line}`}>{line}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/*
              The way back, offered only when there is something below to go back
              to. §9.1 asks for it to be unobtrusive, so it is one small button over
              the foot of the conversation rather than a bar that is always there.
            */}
            {returnToLatest && (
              <button
                type="button"
                className="button button--quiet transcript__return"
                data-ev="return-to-latest"
                onClick={scrollToLatest}
              >
                Back to the latest message ↓
              </button>
            )}
            </div>

            <div className="composer">
              <textarea
                className="composer__input"
                data-ev="prompt"
                rows={3}
                placeholder={
                  useLoop
                    ? 'Describe the work. Send walks the chat loop; this text is the entry mandate. Enter sends, Shift+Enter starts a line.'
                    : 'Ask about this project, or request a change. Enter sends, Shift+Enter starts a line.'
                }
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                }}
                /*
                  Enter sends and Shift+Enter breaks the line, which is what every
                  chat a person has used does; Ctrl+Enter and Cmd+Enter keep working
                  because that is what this window asked for until now. The decision
                  itself is `composerKeyAction`, where it can be tested — including
                  the two cases most easily broken by a later tidy-up: an IME
                  composition, where Enter chooses a word rather than sending, and a
                  blocked send, where Enter must not silently reshape the text
                  instead.
                */
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  const action = composerKeyAction(
                    {
                      key: event.key,
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey,
                      altKey: event.altKey,
                      composing: event.nativeEvent.isComposing,
                    },
                    // One predicate, shared with the button, so Enter and Send can
                    // no longer disagree about whether a press would do anything.
                    { canSend },
                  );
                  if (action === 'send') {
                    event.preventDefault();
                    void send();
                  } else if (action === 'ignore') {
                    event.preventDefault();
                  }
                }}
              />
              <div className="row">
                {/*
                  **There is no Send button.** Niclas's decision, 19 September 2026, and
                  `docs/INTERACTION_MODEL.md` §9 records it: Enter is the send, so a
                  button beside the box is furniture repeating what the box already
                  says.

                  Two things the button was carrying, and neither goes with it. The
                  keystroke stays discoverable in the composer's own placeholder, which
                  names Enter and Shift+Enter in the default state — the only place a
                  hint exists, and no second one was added here. And the text still
                  survives a refused or failed send, because that was never the button's
                  doing: `composerTextAfterSend` decides it and the composer is cleared
                  only once a send is accepted.

                  What a dead button used to say, `routeNote` below says in words, which
                  is the better version of it: a reason rather than a disabled control.
                */}
                {busy === 'sending' && !loopBusy && (
                  <span className="pending" data-ev="sending">
                    Sending …
                  </span>
                )}
                <label
                  className="loop-toggle"
                  title="When on, Send walks dspatch-chat-loop on this project. Off is ordinary single-agent chat."
                >
                  <input
                    type="checkbox"
                    data-ev="use-loop"
                    checked={useLoop}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setUseLoop(next);
                      if (!next && loopBusyRef.current) {
                        noteLoopStopRequested(false);
                        void window.dspatch.cancelChatLoopRun().then((outcome) => {
                          setStopWaitingNote(outcome.note);
                        });
                      }
                      /*
                       * Show the loop that has just been chosen, in the graph view if
                       * one is open.
                       *
                       * Ticking this box picks a graph, and until now that was
                       * invisible until the first send — so the drawing first appeared
                       * over work that had already started. **It opens no window and
                       * starts nothing**: a graph view that is open sees the loop
                       * appear with its entry step marked ready, and a tick with no
                       * graph view open changes nothing anywhere.
                       *
                       * The failure is swallowed deliberately. A preview that cannot
                       * be drawn is not a reason a mandate cannot be sent, and
                       * `startChatLoopRun` reads the same file and gives its own
                       * account when it matters.
                       */
                      void window.dspatch.prepareChatLoop(next).catch(() => {
                        /* Nothing to show is not something to report here. */
                      });
                    }}
                  />
                  Use loop
                </label>
                {/*
                  Directly after the switch it qualifies, and drawn only when that
                  switch is on or a run is walking. Beside an ordinary composer it was
                  a mode chooser and a sentence saying no loop was running, which is
                  why it read as a second copy of `Use loop`. What it actually decides
                  is in `LoopControlBar`'s own comment and comes from
                  `decideNextStep`: whether a step that starts an agent, runs a command
                  or hands work outside begins on its own or waits to be let through,
                  one step at a time. Cancel below is untouched — it abandons what is
                  in flight, which is a different act from letting a step finish first.
                */}
                <LoopControlBar report={loopControl} loopIntended={useLoop} />
                {/*
                  §9: model selection beside the composer, saying which work it
                  affects. Not a card and not in the header — it belongs next to
                  the box whose next message it changes.
                */}
                <ModelChooser
                  connection={connection}
                  chosen={modelChoice}
                  onChoose={(modelId) => {
                    void window.dspatch.setRequestedModel(modelId).then(
                      (inForce) => {
                        setModelChoice(inForce);
                      },
                      () => {
                        setComposerNote(
                          'DSpatch could not change the model. The next message ' +
                            'goes to the one named beside the composer.',
                        );
                      },
                    );
                  }}
                />
                {/*
                  Shown when there is something to stop, rather than always. A
                  dead Cancel and a dead Stop waiting beside every idle composer
                  are two thirds of a control row that says nothing about the
                  state it is in; their meaning and their reach are unchanged.
                */}
                {(activeTurn !== null || loopBusy) && (
                  <button
                    type="button"
                    className="button"
                    data-ev="cancel"
                    onClick={() => {
                      void cancel();
                    }}
                    disabled={busy === 'cancelling'}
                  >
                    {busy === 'cancelling' ? 'Cancelling …' : 'Cancel'}
                  </button>
                )}
                {/*
                  The way out of a send that has not come back. Offered for the
                  whole outstanding send, which is exactly the interval in which
                  Cancel is offered but cannot work: the adapter announces the run
                  before it holds one it can cancel. Report 003 found that gap by
                  reading the code; this is the button that closes it.
                */}
                {sendWait !== null && (
                  <button
                    type="button"
                    className="button"
                    data-ev="stop-waiting"
                    onClick={() => {
                      void stopWaiting();
                    }}
                  >
                    Stop waiting
                  </button>
                )}
                <span className="pending" data-ev="active-status">
                  {activityText}
                </span>
              </div>
              {/*
                Where this press would go, when that is not obvious. Null for an
                ordinary send and for starting a walk, because saying "this will
                send your message" under the box that sends it is noise; non-null
                while a run is walking, where the person is entitled to know their
                text joins that run rather than starting a second one — and non-null
                when a send would be refused, which since the Send button went is the
                only thing saying so.
              */}
              {routeNote !== null && (
                <p className="app__note" data-ev="composer-route-note">
                  {routeNote}
                </p>
              )}
              {sendWait?.longWait === true && (
                <p className="app__note" data-ev="long-wait">
                  This wait is longer than anything measured in this project, and it
                  is still not a failure. DSpatch has no way to see whether the
                  provider is working — only whether it has said anything.
                </p>
              )}
              {stopWaitingNote !== null && (
                <p className="app__note" data-ev="stop-waiting-note">
                  {stopWaitingNote}
                </p>
              )}
              {composerNote !== null && (
                <p className="app__note" data-ev="composer-note">
                  {composerNote}
                </p>
              )}
              {resolvedNote !== null && (
                <p className="app__note" data-ev="failure-resolved-note">
                  {resolvedNote}
                </p>
              )}
              {turnNeedsAcknowledgement.length > 0 && (
                <div className="app__error" data-ev="send-needs-acknowledgement">
                  <p>
                    {turnNeedsAcknowledgement.length === 1
                      ? 'An earlier attempt has no known outcome'
                      : `${String(
                          turnNeedsAcknowledgement.length,
                        )} earlier attempts have no known outcome`}{' '}
                    ({turnNeedsAcknowledgement.join(', ')}), so DSpatch will not send
                    another message by itself. Nothing is lost: your text stays in the
                    box and the conversation above is untouched. What it knows about{' '}
                    {turnNeedsAcknowledgement.length === 1 ? 'that attempt' : 'them'} is
                    in &quot;Execution state&quot; below.
                  </p>
                  <button
                    type="button"
                    className="button"
                    data-ev="send-anyway"
                    onClick={() => {
                      void send(turnNeedsAcknowledgement);
                    }}
                    disabled={busy !== null || prompt.trim() === ''}
                  >
                    {turnNeedsAcknowledgement.length === 1
                      ? `Send anyway, leaving ${turnNeedsAcknowledgement[0] ?? ''} unresolved`
                      : `Send anyway, leaving all ${String(
                          turnNeedsAcknowledgement.length,
                        )} unresolved (${turnNeedsAcknowledgement.join(', ')})`}
                  </button>
                </div>
              )}
              {/*
                `onContinueInNewSession` is the way out of a provider session that
                holds an unfinished run, and it exists because *Open a project
                again* was not one: re-opening resumes the same session, which holds
                the same run and refuses the next message in the same words. Report
                008 hit that twice across a restart. This opens a new provider
                session over the same project and the same conversation, and the
                recap it will send is shown before anything is sent.
              */}
              {actionError !== null && (
                <Failure
                  failure={actionError}
                  testId="action-error"
                  onRetry={() => {
                    void send();
                  }}
                  onReconnect={() => {
                    setConnectionAttempts(0);
                    void checkConnection();
                  }}
                  onOpenAgain={() => {
                    setChoosing(true);
                  }}
                  onContinueInNewSession={() => {
                    void startSession({ kind: 'new-provider-session' });
                  }}
                />
              )}
              {chat.droppedCount > 0 && (
                <p className="app__note" data-ev="dropped-late-events">
                  {chat.droppedCount} event
                  {chat.droppedCount === 1 ? '' : 's'} arrived for a run that is no
                  longer the current one and{' '}
                  {chat.droppedCount === 1 ? 'was' : 'were'} not applied to this
                  conversation. The turn they belonged to says so below. Whether
                  that run is still going on the provider&apos;s side is not
                  something DSpatch can see.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/*
        Everything that is evidence rather than conversation.

        Mounted whether or not it is on screen, which is two decisions in one. It
        keeps a run's own panels alive while someone reads the session details, so
        opening them cannot interrupt work; and it keeps every `data-ev` name
        readable, so the scripted runs that drive the command field and the diff
        still find the controls they always found. Only the visibility changes.
      */}
      <div
        className="details-view"
        data-ev="session-details-view"
        data-open={String(detailsOpen)}
        aria-hidden={!detailsOpen}
      >
        <SessionFacts header={header} connection={connection} />

        {session !== null && (
          <>
            <SessionContinuity session={session} sentAnything={chat.turns.length > 0} />

            <ProjectDetails session={session} />

            <WorkspacePanel
              session={session}
              workspace={workspace}
              busy={busy}
              onRead={() => {
                void readFiles();
              }}
            />

            <TestPanel
              session={session}
              test={test}
              testError={testError}
              freshness={freshness}
              stopNote={stopNote}
              command={testCommand}
              cwd={testCwd}
              busy={busy}
              onCommandChange={setTestCommand}
              onCwdChange={setTestCwd}
              onResetCommand={() => {
                setTestCommand(session.suggestedTestCommand);
                setTestCwd(session.suggestedTestCwd);
              }}
              needsAcknowledgement={commandNeedsAcknowledgement}
              onRun={(acknowledgedAttemptId) => {
                void runTest(acknowledgedAttemptId);
              }}
              onStop={() => {
                void stopTest();
              }}
              onRecheck={() => {
                void refreshFreshness();
              }}
            />

            {cancelObs !== null && cancelObs.attempted && (
              <CancelPanel observations={cancelObs} />
            )}
          </>
        )}

      {/*
        Outside the session block on purpose. After a restart the attempts that were
        left unresolved are the first thing that has to be visible, and at that moment
        there is no session — the whole point being that restoring brings back history
        and not activity. A panel that only appeared once a project was open would
        hide the reconciliation until after the decision it informs.
      */}
      {runState !== null && (session !== null || restored !== null) && (
        <RunStatePanel
          runState={runState}
          busy={busy}
          onStopWaiting={() => {
            void stopWaiting();
          }}
          onStopCommand={() => {
            void stopTest();
          }}
          onSendAnyway={(attemptIds) => {
            void send(attemptIds);
          }}
          onRunAgain={(attemptIds) => {
            void runTest(attemptIds);
          }}
          onRetry={(kind) => {
            if (kind === 'agent-turn') {
              void send();
            } else {
              void runTest();
            }
          }}
          canAct={session !== null}
        />
      )}

        <SampleProjectsPanel
          samples={samples}
          cleanup={sampleCleanup}
          note={sampleNote}
          busy={sampleBusy}
          onRead={() => {
            void refreshSampleProjects();
          }}
          onRemove={(paths) => {
            void cleanUpSampleProjects(paths);
          }}
        />

        <Environment environment={environment} connection={connection} />
      </div>
      </div>
    </>
  );
}

/**
 * Which model the next message goes to (DSP-60 #3).
 *
 * Three states, and the difference between them is the point. With a model list,
 * it is a chooser. Without one — the list is read when the connection is checked
 * and that read can fail — it names the model in force and offers no choice,
 * because an empty chooser is worse than an honest sentence. With no connection at
 * all it says so.
 *
 * The note underneath is not decoration: §9 requires a selection to say which work
 * it affects, and here that is narrow and worth stating. It changes the next
 * ordinary message. It does not reach a turn already in flight, and it does not
 * reach a loop run, which carries the model the loop was started with.
 */
function ModelChooser({
  connection,
  chosen,
  onChoose,
}: {
  readonly connection: ConnectionStatus;
  readonly chosen: string | null;
  readonly onChoose: (modelId: string) => void;
}): JSX.Element | null {
  if (connection.kind !== 'connected') {
    return null;
  }
  const inForce = chosen ?? connection.modelRequested;
  const listed = connection.models.some((model) => model.id === inForce);
  return (
    <span className="model">
      {connection.models.length === 0 ? (
        <span className="model__fixed" data-ev="model-name">
          Model {inForce}
        </span>
      ) : (
        <label className="model__label">
          <span>Model</span>
          <select
            className="model__select"
            data-ev="model-select"
            value={inForce}
            onChange={(event) => {
              onChoose(event.target.value);
            }}
          >
            {/* The model in force is always an option, even when the provider's
                list does not contain it — otherwise the control would silently
                show a different model from the one that will be used. */}
            {!listed && <option value={inForce}>{inForce}</option>}
            {connection.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="model__note" data-ev="model-affects">
        for your next message here. A loop run uses the model it was started with.
      </span>
    </span>
  );
}

/**
 * What has gone wrong, and the way to try the connection again.
 *
 * The only thing left above the conversation, and it draws nothing when nothing
 * is wrong. That is the limit this pass had to respect while the rest of the
 * chrome went: a person who never opens the session details must still not be
 * surprised by a connection that is down or an attempt whose outcome nobody
 * established. The rule about what counts stays in `headerProblems`, where it is
 * tested; *connected*, which is not a problem, is a fact in the session details.
 */
function AppBarProblems({
  header,
  connection,
  connectionAttempts,
  onReconnect,
}: {
  readonly header: ChatHeaderView;
  readonly connection: ConnectionStatus;
  readonly connectionAttempts: number;
  readonly onReconnect: () => void;
}): JSX.Element | null {
  const retry = connectionRetryPlan(Math.max(connectionAttempts - 1, 0));
  const showRetry = connection.kind !== 'connected' && connection.kind !== 'checking';
  if (header.problems.length === 0 && !showRetry) {
    return null;
  }
  return (
    <div className="appbar__problems" data-ev="workspace-header">
      {header.problems.map((problem) => (
        <p
          key={problem.id}
          className={problem.severity === 'bad' ? 'app__error' : 'app__note'}
          data-ev={problem.id}
        >
          {problem.text}
        </p>
      ))}
      {showRetry && (
        <>
          <p className="app__note" data-ev="connection-retry-note">
            {retry.note}
          </p>
          <p>
            <button
              type="button"
              className="button button--quiet"
              data-ev="reconnect"
              onClick={onReconnect}
            >
              Check the connection again
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The session facts, as the details view shows them.
 *
 * The same `data-ev` names on the same text as before they moved. `textContent`
 * reaches into a hidden element, so the scripted runs that measure these facts read
 * what they always read.
 */
function SessionFacts({
  header,
  connection,
}: {
  readonly header: ChatHeaderView;
  readonly connection: ConnectionStatus;
}): JSX.Element {
  return (
    <Section title="Session details">
      <dl className="facts" data-ev="header-details">
        {/*
          "connected" is a one-word fact about a working connection, which is to
          say it is not news. It was a badge in the project row; the row is gone
          and the fact is here. A connection that is *not* working is a different
          thing and stays above the conversation, in `AppBarProblems`.
        */}
        <Fact label="Connection" value={header.connection} testId="connection-kind" />
        {header.details.map((fact) => (
          <Fact
            key={fact.label}
            label={fact.label}
            value={fact.value}
            testId={DETAIL_TEST_ID[fact.label]}
          />
        ))}
        {connection.kind === 'connected' && (
          <Fact
            label="Models available"
            value={
              connection.modelsAvailable === null
                ? 'unknown — the list was not read'
                : `${String(connection.modelsAvailable)} · cost unknown`
            }
            testId="connection-models"
          />
        )}
      </dl>
      <p className="app__note">
        Every provider call happens in the main process behind the adapter; this
        window reaches it only over IPC.
      </p>
    </Section>
  );
}

/**
 * The `data-ev` names the scripted walkthrough already reads, kept on the facts
 * that carry the same text after they moved behind the expander.
 *
 * A rename here silently blinds `workflow-script.ts`, which reads these by name
 * and would then record an empty string as a measurement. Keyed by the label the
 * shared module produces, so the two stay together.
 */
const DETAIL_TEST_ID: Record<string, string | undefined> = {
  'Project folder': 'project-folder',
  'DSpatch session': 'dspatch-session',
  'Provider session': 'provider-session',
  Revision: 'project-git',
  'Already modified': 'project-dirty-count',
  Account: 'connection-account',
  'Context DSpatch sent': 'context-summary',
  'Files sent by DSpatch': 'context-files-sent',
  'The agent\u2019s own tool calls': 'agent-tool-calls',
  'How this is wired': 'adapter-note',
};

function ProjectChooser({
  projects,
  conversations,
  connection,
  busy,
  sessionError,
  resumeError,
  hasSession,
  forgetting,
  forgetNote,
  onPick,
  onOpen,
  onForget,
  onSample,
  onResume,
  onRefreshConversations,
  onDismiss,
}: {
  readonly projects: ProjectListing | null;
  readonly conversations: ConversationListing | null;
  readonly connection: ConnectionStatus;
  readonly busy: Busy;
  readonly sessionError: BridgeFailure | null;
  readonly resumeError: BridgeFailure | null;
  readonly hasSession: boolean;
  readonly forgetting: boolean;
  readonly forgetNote: string | null;
  readonly onPick: () => void;
  readonly onOpen: (projectPath: string) => void;
  readonly onForget: (projectPaths: readonly string[]) => void;
  readonly onSample: () => void;
  readonly onResume: (conversationId: string) => void;
  readonly onRefreshConversations: () => void;
  readonly onDismiss: () => void;
}): JSX.Element {
  const connected = connection.kind === 'connected';
  const disabled = busy !== null || !connected;
  // `recent` only: a project named by the environment is not in the store, so
  // there would be nothing to remove for it.
  const missingRemembered = (projects?.entries ?? []).filter(
    (entry) => entry.origin === 'recent' && !entry.exists,
  );
  return (
    <section className="panel panel--lead">
      <div className="panel__head">
        <h2 className="panel__title">Open a project</h2>
        {hasSession && (
          <button
            type="button"
            className="button button--quiet"
            data-ev="keep-project"
            onClick={onDismiss}
          >
            Keep the current one
          </button>
        )}
      </div>
      <p className="app__note">
        Pick the folder you want to work in. DSpatch records its git revision and
        which files are already modified before anything starts, so your own
        uncommitted work stays yours and cannot later be attributed to the agent.
      </p>

      <div className="row">
        <button
          type="button"
          className="button button--primary"
          data-ev="pick-folder"
          onClick={onPick}
          disabled={disabled}
        >
          {busy === 'picking-folder' ? 'Choosing …' : 'Choose a folder …'}
        </button>
        <button
          type="button"
          className="button"
          data-ev="new-session"
          onClick={onSample}
          disabled={disabled}
        >
          Use a generated sample project
        </button>
        {busy === 'starting-session' && (
          <span className="pending" data-ev="session-pending">
            opening the project and hashing its files …
          </span>
        )}
      </div>

      {!connected && (
        <p className="app__note">
          A session needs a connected account. Nothing is sent until then.
        </p>
      )}

      {sessionError !== null && (
        <Failure
          failure={sessionError}
          testId="session-error"
          onRetry={onPick}
          onChooseFolder={onPick}
          onOpenAgain={onPick}
        />
      )}

      <div data-ev="projects">
        {projects !== null && projects.entries.length > 0 && (
          <ul className="files">
            {projects.entries.map((entry, index) => (
              <ProjectRow
                key={entry.path}
                entry={entry}
                index={index}
                disabled={disabled}
                forgetting={forgetting}
                onOpen={onOpen}
                onForget={onForget}
              />
            ))}
          </ul>
        )}
        {/*
          DSP-5 friction 3. Nine of Niclas's ten remembered entries were throwaway
          `%TEMP%` repositories from overnight verification, several already gone
          from disk, and nothing here could remove one. Per-row *Forget* is the
          answer; this line is the answer to nine of them, because forgetting the
          gone ones one at a time is the same chore in nine pieces.

          Only entries the store actually holds are offered. A project named by
          `DSPATCH_PROJECT_PATH` is not remembered anywhere, so there is nothing to
          forget about it.
        */}
        {projects !== null && missingRemembered.length > 0 && (
          <div className="row" data-ev="projects-missing">
            <span className="files__note">
              {missingRemembered.length === 1
                ? 'One remembered folder is not on disk any more.'
                : `${String(
                    missingRemembered.length,
                  )} remembered folders are not on disk any more.`}{' '}
              Forgetting {missingRemembered.length === 1 ? 'it' : 'them'} changes
              only this list.
            </span>
            <button
              type="button"
              className="button button--quiet"
              data-ev="forget-missing-projects"
              onClick={() => {
                onForget(missingRemembered.map((entry) => entry.path));
              }}
              disabled={forgetting}
            >
              {forgetting
                ? 'Forgetting …'
                : missingRemembered.length === 1
                  ? 'Forget the missing folder'
                  : `Forget all ${String(missingRemembered.length)} missing folders`}
            </button>
          </div>
        )}
        {forgetNote !== null && (
          <p className="app__note" data-ev="forget-projects-note">
            {forgetNote}
          </p>
        )}
        {projects !== null && projects.entries.length === 0 && (
          <p className="app__note">
            No projects remembered yet. The one you choose will appear here next
            time.
          </p>
        )}
        {projects !== null && projects.error !== null && (
          <p className="app__note">{projects.error}</p>
        )}
      </div>

      <SavedConversations
        conversations={conversations}
        busy={busy}
        resumeError={resumeError}
        onResume={onResume}
        onRefresh={onRefreshConversations}
      />
    </section>
  );
}

/**
 * The saved conversations, as a way back into work that was interrupted.
 *
 * Reading one back needs no connection and starts nothing, so unlike the buttons
 * above it is not disabled when the provider is unreachable: the history and the
 * evidence are on disk and are exactly what someone wants when the provider is
 * down. A conversation with unresolved attempts says so here, before it is opened,
 * because finding out afterwards that the conversation cannot simply be continued
 * would be a surprise the row could have prevented.
 */
function SavedConversations({
  conversations,
  busy,
  resumeError,
  onResume,
  onRefresh,
}: {
  readonly conversations: ConversationListing | null;
  readonly busy: Busy;
  readonly resumeError: BridgeFailure | null;
  readonly onResume: (conversationId: string) => void;
  readonly onRefresh: () => void;
}): JSX.Element {
  return (
    <div data-ev="conversations">
      <h3 className="panel__title">Saved conversations</h3>
      {conversations !== null && (
        <p className="app__note" data-ev="conversations-directory">
          Kept as one JSON file per conversation in{' '}
          <code>{conversations.directory}</code>, format version{' '}
          {conversations.formatVersion}. Each file holds the messages, the diff you
          reviewed and any command output <strong>verbatim</strong>, and — so that
          the diff can still be read back after a restart — a{' '}
          <strong>base64 copy of the project files the session started from</strong>,
          git-ignored files and anything over the size limits excluded. So a file you
          share carries that source as well as the terminal output in it. Treat it
          accordingly.
        </p>
      )}
      {conversations === null && <p className="app__note">Reading the saved files …</p>}
      {conversations !== null && conversations.entries.length === 0 && (
        <p className="app__note" data-ev="no-conversations">
          Nothing saved yet. A conversation is written to{' '}
          <code>{conversations.directory}</code> as you work, so closing DSpatch will
          not lose it. It is outside every project, so nothing here reaches your git
          history.
        </p>
      )}
      {conversations !== null && conversations.entries.length > 0 && (
        <ul className="files">
          {conversations.entries.map((entry, index) => (
            <ConversationRow
              key={entry.conversationId}
              entry={entry}
              index={index}
              busy={busy}
              onResume={onResume}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
      {conversations?.error !== null && conversations !== null && (
        <p className="app__note" data-ev="conversations-error">
          {conversations.error}
        </p>
      )}
      {conversations?.recovery != null && (
        <p className="app__note" data-ev="conversations-recovery">
          {conversations.recovery}
        </p>
      )}
      {/*
        Leftover temporaries from a save that was interrupted. Shown, never swept
        up: the file is the only evidence that a save was lost, and deleting it
        quietly would be DSpatch tidying away the trace of its own failure.
      */}
      {conversations !== null && conversations.partialWrites.length > 0 && (
        <div className="app__note" data-ev="conversations-partial-writes">
          <p>
            {conversations.partialWrites.length} save
            {conversations.partialWrites.length === 1 ? '' : 's'} did not finish
            writing. DSpatch writes a temporary file and renames it over the real
            one, so the conversation{' '}
            {conversations.partialWrites.length === 1 ? 'file' : 'files'} listed above{' '}
            {conversations.partialWrites.length === 1 ? 'is' : 'are'} whole and the
            unfinished write is still sitting beside{' '}
            {conversations.partialWrites.length === 1 ? 'it' : 'them'}. What was in
            that save is lost; nothing that was already saved is. DSpatch will not
            delete{' '}
            {conversations.partialWrites.length === 1 ? 'the file' : 'these files'} on
            its own — look, then remove{' '}
            {conversations.partialWrites.length === 1 ? 'it' : 'them'} yourself if you
            do not want{' '}
            {conversations.partialWrites.length === 1 ? 'it' : 'them'}.
          </p>
          <ul className="files">
            {conversations.partialWrites.map((partial) => (
              <li className="files__row" key={partial.filePath}>
                <span className="files__path">{partial.fileName}</span>
                <span className="files__note">
                  {partial.bytes === null
                    ? 'size unknown'
                    : `${String(partial.bytes)} bytes`}
                  {partial.modifiedAtUtc === null
                    ? ''
                    : ` · last written ${partial.modifiedAtUtc}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {resumeError !== null && <Failure failure={resumeError} testId="resume-error" />}
    </div>
  );
}

function ConversationRow({
  entry,
  index,
  busy,
  onResume,
  onRefresh,
}: {
  readonly entry: ConversationListEntry;
  readonly index: number;
  readonly busy: Busy;
  readonly onResume: (conversationId: string) => void;
  readonly onRefresh: () => void;
}): JSX.Element {
  /**
   * What the last export or reveal on this row did.
   *
   * Local to the row because it is about this file. It says what was written and
   * what reading it back produced, so "exported" is something the user can check
   * rather than something DSpatch asserts.
   */
  const [action, setAction] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const exportIt = useCallback(async (): Promise<void> => {
    setWorking(true);
    setAction(null);
    try {
      const result = await window.dspatch.exportConversation(entry.conversationId);
      setAction(
        result.kind === 'written'
          ? `${result.note} ${
              result.readBack.parsed
                ? `Read back from the copy: ${String(
                    result.readBack.messageCount ?? 0,
                  )} messages, format version ${String(
                    result.readBack.formatVersion ?? 0,
                  )}.`
                : `The copy cannot be parsed either, which is expected when the stored file could not be: ${
                    result.readBack.error ?? 'no reason given'
                  }`
            }`
          : result.kind === 'cancelled'
            ? result.note
            : `The export failed: ${result.message} The stored file has not been touched.`,
      );
    } catch (error) {
      setAction(
        `The export could not be started: ${
          error instanceof Error ? error.message : String(error)
        } The stored file has not been touched.`,
      );
    } finally {
      setWorking(false);
    }
  }, [entry.conversationId]);

  const revealIt = useCallback(async (): Promise<void> => {
    setAction(null);
    try {
      const result = await window.dspatch.revealConversationFile(entry.conversationId);
      setAction(result.note);
      if (!result.revealed) {
        onRefresh();
      }
    } catch (error) {
      setAction(
        `The folder could not be opened: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [entry.conversationId, onRefresh]);

  return (
    <li className="files__row" data-ev={`conversation-${String(index)}`}>
      <div>
        <p className="files__path" data-ev={`conversation-project-${String(index)}`}>
          {entry.projectPath}
        </p>
        <p className="files__meta" data-ev={`conversation-meta-${String(index)}`}>
          {entry.messageCount} message{entry.messageCount === 1 ? '' : 's'}, last saved{' '}
          {entry.savedAtUtc}
          {entry.hasReviewedDiff ? ', with the diff that was reviewed' : ''}
          {entry.hasTestResult ? ', with a command result' : ''}. {entry.conversationId}
        </p>
        {!entry.projectExists && (
          <p className="files__meta" data-ev={`conversation-missing-${String(index)}`}>
            The project is no longer at this path. The conversation can still be read;
            whether its saved results describe anything that exists now is unknown.
          </p>
        )}
        {entry.unresolvedAttemptCount > 0 && (
          <p className="files__meta" data-ev={`conversation-unresolved-${String(index)}`}>
            {describeSavedConversationUnresolved(
              entry.unresolvedAttemptCount,
              entry.unacknowledgedAttemptCount,
            )}
          </p>
        )}
        {entry.readOnly && (
          <p className="files__meta" data-ev={`conversation-readonly-${String(index)}`}>
            Written by a newer DSpatch (format {entry.formatVersion}). It will be read
            and never rewritten, so nothing in it can be lost by this build.
          </p>
        )}
        {entry.error !== null && (
          <p className="files__meta" data-ev={`conversation-error-${String(index)}`}>
            {entry.error}
          </p>
        )}
        {/*
          AC#5's storage half: a file DSpatch cannot use says so, and says what can
          be done about it. The recovery line is separate from the error because
          the error describes the damage and this describes the way out — and the
          way out is the two buttons below, which work on a file no matter how
          broken it is, because they never parse it.
        */}
        {entry.recovery !== null && (
          <p className="files__meta" data-ev={`conversation-recovery-${String(index)}`}>
            {entry.recovery}
          </p>
        )}
        {action !== null && (
          <p className="files__meta" data-ev={`conversation-action-${String(index)}`}>
            {action}
          </p>
        )}
      </div>
      <div className="row">
        <button
          type="button"
          className="button"
          data-ev={`resume-${String(index)}`}
          onClick={() => {
            onResume(entry.conversationId);
          }}
          disabled={busy !== null || entry.error !== null}
        >
          {busy === 'resuming' ? 'Reading …' : 'Read this back'}
        </button>
        {/*
          Deliberately not disabled by `entry.error`. Getting an unreadable record
          out to somewhere safe is exactly what someone wants when the record is
          unreadable, and the export copies bytes without reading them.
        */}
        <button
          type="button"
          className="button button--quiet"
          data-ev={`export-conversation-${String(index)}`}
          onClick={() => {
            void exportIt();
          }}
          disabled={working}
        >
          {working ? 'Copying …' : 'Export a copy'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          data-ev={`reveal-conversation-${String(index)}`}
          onClick={() => {
            void revealIt();
          }}
        >
          Show the file
        </button>
      </div>
    </li>
  );
}

const PROJECT_ORIGIN_LABEL: Record<ProjectListEntry['origin'], string> = {
  recent: 'opened before',
  'startup-environment': 'named at startup by DSPATCH_PROJECT_PATH',
};

function ProjectRow({
  entry,
  index,
  disabled,
  forgetting,
  onOpen,
  onForget,
}: {
  readonly entry: ProjectListEntry;
  readonly index: number;
  readonly disabled: boolean;
  readonly forgetting: boolean;
  readonly onOpen: (projectPath: string) => void;
  readonly onForget: (projectPaths: readonly string[]) => void;
}): JSX.Element {
  return (
    <li className="files__row">
      <span className="files__path" data-ev={`project-${String(index)}-path`}>
        {entry.path}
      </span>
      <span className="files__note">
        {PROJECT_ORIGIN_LABEL[entry.origin]}
        {entry.lastOpenedAtUtc === null ? '' : ` · last opened ${entry.lastOpenedAtUtc}`}
        {entry.exists
          ? entry.isGitRepository === true
            ? ' · git repository'
            : ' · no .git here'
          : ' · missing: the folder is not there any more'}
      </span>
      <button
        type="button"
        className="button button--quiet"
        data-ev={`open-project-${String(index)}`}
        onClick={() => {
          onOpen(entry.path);
        }}
        disabled={disabled || !entry.exists}
      >
        Open
      </button>
      {/*
        *Forget*, not *Remove*: the word has to say that this is about the list and
        not about the folder. Enabled for a missing folder too — that is the case it
        was asked for. Absent for a project named by the environment, because
        nothing remembers it and the button would have nothing to do.
      */}
      {entry.origin === 'recent' && (
        <button
          type="button"
          className="button button--quiet"
          data-ev={`forget-project-${String(index)}`}
          title="Removes this entry from DSpatch's list. The folder and any saved conversation are untouched."
          onClick={() => {
            onForget([entry.path]);
          }}
          disabled={forgetting}
        >
          Forget
        </button>
      )}
    </li>
  );
}

/**
 * A conversation read back from disk.
 *
 * Everything here is labelled as a record. That is the whole design of DSP-4's
 * restart: what comes back is history and evidence, and the one thing that does not
 * come back is activity. So this panel has no Send, no Cancel and no Run — the only
 * button that acts is *Continue*, which opens the project and starts a new session,
 * and it says that is what it does. The counts of what was **not** repeated come
 * from the main process rather than being asserted here, because "nothing was
 * restarted" is a measurement and a window that merely fails to mention restarting
 * something is indistinguishable from one that quietly did.
 */
function RestoredPanel({
  restored,
  restoredAtUtc,
  busy,
  hasSession,
  onContinue,
  onClose,
}: {
  readonly restored: RestoredConversation;
  readonly restoredAtUtc: string | null;
  readonly busy: Busy;
  readonly hasSession: boolean;
  readonly onContinue: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const diff = restored.reviewedDiff;
  const entries: readonly { file: WorkspaceChange; label: DiffLabel }[] =
    diff === null
      ? []
      : [
          ...diff.report.changed.map((file) => ({ file, label: 'changed' as const })),
          ...diff.report.added.map((file) => ({ file, label: 'added' as const })),
          ...diff.report.removed.map((file) => ({ file, label: 'removed' as const })),
        ];

  return (
    <section className="panel" data-ev="restored">
      <div className="panel__head">
        <h2 className="panel__title">Restored conversation</h2>
        <button
          type="button"
          className="button button--quiet"
          data-ev="restored-close"
          onClick={onClose}
        >
          Put this away
        </button>
      </div>

      <p className="app__note" data-ev="restored-statement">
        {restored.statement}
      </p>
      <dl className="facts">
        <Fact label="Conversation" value={restored.conversationId} testId="restored-id" />
        <Fact label="Project" value={restored.project.path} testId="restored-project" />
        <Fact label="Saved" value={restored.savedAtUtc} testId="restored-saved" />
        <Fact label="Started" value={restored.createdAtUtc} />
        <Fact
          label="Read from"
          value={`${restored.filePath} (format ${String(restored.formatVersion)})`}
          testId="restored-file"
        />
        <Fact
          label="Nothing repeated"
          value={`${String(restored.reconciliation.repeated.providerRuns)} model runs, ${String(
            restored.reconciliation.repeated.commands,
          )} commands, ${String(
            restored.reconciliation.repeated.workspaceWrites,
          )} writes into your project`}
          testId="restored-repeated"
        />
      </dl>
      <p className="app__note" data-ev="restored-repeat-note">
        {restored.reconciliation.repeated.note}
      </p>
      {restored.readOnly && (
        <p className="app__note" data-ev="restored-readonly">
          This file was written by a newer DSpatch, so it is read and never rewritten.
          Continuing would save into a new conversation rather than change this one.
        </p>
      )}
      {restored.error !== null && (
        <p className="app__error" data-ev="restored-error">
          {restored.error}
        </p>
      )}

      <div className="row">
        <button
          type="button"
          className="button button--primary"
          data-ev="restored-continue"
          onClick={onContinue}
          disabled={busy !== null || !restored.project.exists || hasSession}
        >
          {busy === 'starting-session'
            ? 'Opening the project …'
            : hasSession
              ? 'A project is open'
              : 'Continue: open this project again'}
        </button>
        <span className="pending" data-ev="restored-continue-note">
          {!restored.project.exists
            ? 'The project folder is not there, so there is nothing to open. The ' +
              'conversation stays readable.'
            : hasSession
              ? // Below, not above: this panel renders before the Conversation
                // panel that holds the composer. DSP-5 measured the cost of the
                // wrong preposition — Niclas went looking upwards and did not find
                // it. The panel is named as well as the direction, because a page
                // that has been scrolled makes "below" true but not helpful.
                'A session is open for this conversation. Its composer is in the ' +
                '"Conversation" panel further down this page.'
              : 'This starts a new provider session over the same folder. Nothing ' +
                'from this conversation is sent to the model by opening it.'}
        </span>
      </div>

      <h3 className="subheading">Unresolved when DSpatch closed</h3>
      <p className="app__note" data-ev="restored-reconciliation-note">
        {restored.reconciliation.note}
      </p>
      {restored.reconciliation.attempts.length > 0 && (
        <ul className="files" data-ev="restored-reconciliation">
          {restored.reconciliation.attempts.map((item, index) => (
            <ReconciliationRow key={item.attemptId} item={item} index={index} />
          ))}
        </ul>
      )}

      <h3 className="subheading">Messages</h3>
      {restored.messages.length === 0 ? (
        <p className="app__note" data-ev="restored-no-messages">
          This conversation was saved before anything was sent. The project was opened
          and nothing else happened.
        </p>
      ) : (
        <div className="transcript" data-ev="restored-transcript">
          {restored.messages.map((message) => (
            <RestoredMessage key={message.dspatchRunId} message={message} />
          ))}
        </div>
      )}

      {restored.testResult !== null && (
        <>
          <h3 className="subheading">The saved command result</h3>
          <p
            className={
              restored.testResult.freshness.kind === 'current' ? 'app__note' : 'app__error'
            }
            data-ev="restored-test-status"
          >
            <span data-ev="restored-test-presented">
              {PRESENTED_STATUS_LABEL[restored.testResult.freshness.presentedStatus]}
            </span>{' '}
            — {restored.testResult.freshness.presentedHeadline}
          </p>
          <p className="app__note" data-ev="restored-test-note">
            {restored.testResult.note}
          </p>
          <dl className="facts">
            <Fact label="Command" value={restored.testResult.outcome.command} />
            <Fact
              label="Working directory"
              value={restored.testResult.outcome.cwd}
              testId="restored-test-cwd"
            />
            <Fact
              label="Exit code"
              value={
                restored.testResult.outcome.killedByDspatch
                  ? 'none — it was stopped, so there is no result'
                  : restored.testResult.outcome.exitCode === null
                    ? `none — ended on signal ${
                        restored.testResult.outcome.signal ?? 'unknown'
                      }`
                    : String(restored.testResult.outcome.exitCode)
              }
              testId="restored-test-exit-code"
            />
            <Fact
              label="Code it ran against"
              value={restored.testResult.outcome.snapshotId ?? 'unknown'}
              testId="restored-test-snapshot"
            />
            <Fact
              label="Code on disk at the restore"
              value={
                restored.testResult.freshness.currentSnapshotId ??
                'unknown — the project could not be hashed'
              }
              testId="restored-test-current-snapshot"
            />
            <Fact label="Ran" value={restored.testResult.outcome.finishedAtUtc} />
          </dl>
          <pre className="output" data-ev="restored-test-stdout">
            {restored.testResult.outcome.stdout === ''
              ? '(no standard output)'
              : restored.testResult.outcome.stdout}
          </pre>
          {restored.testResult.outcome.stderr !== '' && (
            <pre className="output" data-ev="restored-test-stderr">
              {restored.testResult.outcome.stderr}
            </pre>
          )}
        </>
      )}

      {diff !== null && (
        <>
          <h3 className="subheading">The diff that was reviewed</h3>
          <p
            className={diff.stillDescribesDisk === true ? 'app__note' : 'app__error'}
            data-ev="restored-diff-note"
          >
            {diff.note}
          </p>
          <p className="app__note" data-ev="restored-diff-snapshots">
            Between <code>{diff.report.baselineSnapshotId}</code> and{' '}
            <code>{diff.report.observedSnapshotId}</code>, read{' '}
            {diff.report.observedAtUtc}. The working copy was{' '}
            <code data-ev="restored-diff-current">
              {diff.currentSnapshotId ?? 'unreadable'}
            </code>{' '}
            when this was read back
            {restoredAtUtc === null ? '' : ` at ${restoredAtUtc}`}.
          </p>
          <div className="diffs">
            {entries.map((entry, index) => (
              <FileDiff
                key={`restored-${entry.label}-${entry.file.relPath}`}
                file={entry.file}
                label={entry.label}
                index={index}
              />
            ))}
          </div>
          {entries.length === 0 && (
            <p className="app__note">
              The saved diff listed no differing file: the working copy matched the
              session baseline when it was reviewed.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ReconciliationRow({
  item,
  index,
}: {
  readonly item: AttemptReconciliation;
  readonly index: number;
}): JSX.Element {
  return (
    <li className="files__row" data-ev={`reconciled-${String(index)}`}>
      <div>
        <p className="attempt__head">
          <code data-ev={`reconciled-${String(index)}-id`}>{item.attemptId}</code>{' '}
          <span
            className={`badge badge--${ATTEMPT_BADGE[item.stateNow]}`}
            data-ev={`reconciled-${String(index)}-state`}
          >
            {ATTEMPT_STATE_LABEL[item.stateNow]}
          </span>{' '}
          <span className="files__note">
            was {ATTEMPT_STATE_LABEL[item.stateAtClose]} when DSpatch closed
          </span>
        </p>
        <p className="card__detail" data-ev={`reconciled-${String(index)}-note`}>
          {item.note}
        </p>
        <p className="card__detail">
          {item.kind === 'agent-turn' ? 'message' : 'command'}: {item.label}
        </p>
        <p className="card__detail" data-ev={`reconciled-${String(index)}-blocks`}>
          {describeReconciledRepeat(item.kind, item.blocksRepeat)}
        </p>
      </div>
    </li>
  );
}

/**
 * One saved turn. The same text, without any claim that it is still live.
 *
 * `prefix` exists because this now draws in two places — the restored conversation
 * panel, and a reopened project's own history at the head of the thread — and a
 * `data-ev` name appearing twice on one screen would make every scripted reading of
 * it ambiguous. The panel keeps the names it has always had.
 */
function RestoredMessage({
  message,
  prefix = 'restored-turn',
  quiet = false,
}: {
  readonly message: StoredMessage;
  readonly prefix?: string;
  /**
   * Drawn in the conversation rather than in the restored-conversation panel.
   *
   * The panel is a place for facts about a file and keeps its row of them. In the
   * thread the same row is a run id and the word *finished* under every restored
   * message — the identical furniture removed from live replies this pass, and putting
   * it back for history would make a reopened conversation read as more technical than
   * the one it continues. So the row is kept for the cases worth acting on: a turn that
   * never reported an ending is one.
   */
  readonly quiet?: boolean;
}): JSX.Element {
  const at = `${prefix}-${String(message.ordinal)}`;
  const showHead = !quiet || message.terminalStatus === null;
  return (
    <article className="turn" data-ev={at} data-ended={message.terminalStatus ?? 'unreported'}>
      {showHead && (
        <p className="turn__head">
          <span className="turn__index">#{message.ordinal + 1}</span>{' '}
          <code data-ev={`${at}-run`}>{message.dspatchRunId}</code>{' '}
          <span className="files__note">
            {message.terminalStatus === null
              ? 'no ending was ever reported for this turn'
              : `ended as ${message.terminalStatus}`}
            {message.totalTokens === null
              ? ' · tokens unknown'
              : ` · ${String(message.totalTokens)} tokens`}
          </span>
        </p>
      )}
      <UserMessage
        text={message.prompt === '' ? '(no prompt recorded for this turn)' : message.prompt}
        testId={`${at}-prompt`}
      />
      {/* AC#5's second half: a saved reply is read back formatted, not as the raw
          characters it was stored as. */}
      <div className="turn__answer" data-ev={`${at}-answer`}>
        {message.answer === '' ? (
          <p className="app__note">
            Nothing was received for this turn before DSpatch stopped listening.
          </p>
        ) : (
          <Markdown text={message.answer} />
        )}
      </div>
      {/*
        A saved turn that carried a recap says so when it is read back, for the
        same reason the live turn does: what the model was told is part of what
        happened, and a reader looking at this history a week later cannot work
        it out from the prompt alone.
      */}
      {message.resentContext !== null && (
        <details className="turn__resent" data-ev={`${at}-resent`}>
          <summary>
            This message was sent to a new provider session with{' '}
            {String(message.resentContext.length)} characters of recap in front of it.
          </summary>
          <pre className="turn__answer">{message.resentContext}</pre>
        </details>
      )}
      {message.errorMessage !== null && (
        <p className="app__error" data-ev={`${at}-error`}>
          {message.errorMessage}
        </p>
      )}
    </article>
  );
}

/**
 * Whether the model still has this conversation, and what it will be told if not.
 *
 * Both statements are the same kind of thing and both used to sit above the
 * thread: a paragraph about a resumed provider session, and the whole recap
 * DSpatch would put in front of the next message. §9 keeps long explanations of
 * session restoration and provider mechanics out of the conversation and
 * available as details, so they are here, with their text and their `data-ev`
 * names unchanged.
 *
 * The recap is still shown **before** it is sent, which is the point of it: a
 * summary of what the model was told is not what the model was told.
 */
function SessionContinuity({
  session,
  sentAnything,
}: {
  readonly session: ChatSessionInfo;
  readonly sentAnything: boolean;
}): JSX.Element | null {
  const pendingRecap = sentAnything ? null : session.continuity.contextToResend;
  if (session.continuity.kind === 'first-session' && pendingRecap === null) {
    return null;
  }
  return (
    <Section title="This session and the earlier conversation">
      {session.continuity.kind !== 'first-session' && (
        <p className="app__note" data-ev="session-continuity">
          {session.continuity.statement}
        </p>
      )}
      {pendingRecap !== null && (
        <details className="turn__resent" data-ev="pending-resend">
          <summary data-ev="pending-resend-summary">
            {pendingRecap.length} characters of recap will go in front of your next
            message. Read it first.
          </summary>
          <p className="app__note" data-ev="pending-resend-note">
            {session.continuity.contextNote}
          </p>
          <pre className="turn__answer" data-ev="pending-resend-text">
            {pendingRecap}
          </pre>
          <p className="app__note" data-ev="pending-resend-envelope">
            This is DSpatch&apos;s text, complete and exact. The provider adds an
            envelope of its own around every message it delivers — a timestamp and
            its own tags — so the model receives a little more than this, and none of
            the extra comes from DSpatch or from you.
          </p>
        </details>
      )}
    </Section>
  );
}

/** Everything about the session that is evidence rather than conversation. */
function ProjectDetails({ session }: { readonly session: ChatSessionInfo }): JSX.Element {
  const dirty = session.git.dirtyFiles;
  return (
    <Section title="Project and session details" defaultOpen={false}>
      <dl className="facts">
        <Fact label="DSpatch session" value={session.dspatchSessionId} testId="session-id" />
        {/*
          The conversation the session writes into, which is not the same thing as the
          session and is the identifier that decides whether reopening a project
          continues the work or starts beside it. An internal identifier, so §9 puts it
          here behind the menu rather than above the conversation.
        */}
        <Fact
          label="Conversation"
          value={session.restoredHistory.conversationId}
          testId="conversation-id"
        />
        <Fact label="Provider session" value={session.providerSessionId} />
        <Fact label="Model requested" value={session.modelRequested} />
        <Fact label="Tool policy" value={session.toolPolicy} />
        <Fact label="Working copy" value={session.workspacePath} testId="workspace-path" />
        <Fact label="How it was opened" value={session.workspaceOrigin} />
        <Fact
          label="git revision"
          value={
            !session.git.isGitRepository
              ? 'not a git repository'
              : (session.git.headRevision ?? 'no commit yet')
          }
          testId="project-git-head"
        />
        <Fact
          label="Baseline snapshot"
          value={`${session.baseline.snapshotId} · ${String(
            session.baseline.fileCount,
          )} files · ${String(session.baseline.totalBytes)} bytes · hashed in ${String(
            session.baseline.durationMs,
          )} ms`}
          testId="baseline-id"
        />
        <Fact label="Files listed by" value={session.baseline.fileSourceNote} />
      </dl>

      <p className="app__note" data-ev="context-statement">
        {session.context.statement}
      </p>

      {session.baseline.truncated && (
        <p className="app__error">
          The baseline hit a size limit, so it covers only part of this project. A
          change outside it will not be detected. Later comparisons are partial.
        </p>
      )}
      {session.baseline.skipped.length > 0 && (
        <p className="app__note">
          {session.baseline.skipped.length} file
          {session.baseline.skipped.length === 1 ? '' : 's'} could not be hashed:{' '}
          {session.baseline.skipped
            .slice(0, 5)
            .map((file) => `${file.relPath} (${file.reason})`)
            .join('; ')}
          {session.baseline.skipped.length > 5 ? ' …' : ''}
        </p>
      )}
      {session.git.error !== null && <p className="app__error">{session.git.error}</p>}
      {!session.git.isGitRepository && (
        <p className="app__note">
          This folder is not a git repository, so DSpatch cannot tell which files
          you had already changed. The content baseline above still applies, and
          differences from it are differences since this session opened — but
          &quot;nothing was modified beforehand&quot; is not a claim DSpatch can
          make here.
        </p>
      )}

      <h3 className="subheading">Already modified when the session opened</h3>
      {!session.git.isGitRepository || session.git.error !== null ? (
        <p className="app__note">Unknown.</p>
      ) : dirty.length === 0 ? (
        <p className="app__note" data-ev="dirty-at-start">
          Nothing: the working copy matched {session.git.headRevision?.slice(0, 12) ?? 'HEAD'}.
        </p>
      ) : (
        <ul className="files" data-ev="dirty-at-start">
          {dirty.map((file) => (
            <li key={`${file.statusCode}-${file.relPath}`} className="files__row">
              <span className="files__path">{file.relPath}</span>
              <span className="files__note">{describeDirty(file)}</span>
              <code className="files__hash">{file.statusCode.replace(/ /g, '·')}</code>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function describeDirty(file: DirtyFileInfo): string {
  const staged = file.staged ? 'staged' : 'not staged';
  return file.previousRelPath === null
    ? `${file.kind}, ${staged}`
    : `${file.kind} from ${file.previousRelPath}, ${staged}`;
}

/**
 * The review surface: which files differ, and the text of every difference.
 *
 * One list, not two. Each file's summary line carries the hashes that establish
 * *that* it changed, and opening it shows the unified diff that shows *how*. A
 * file DSpatch cannot render as text is still in the list, with its own reason —
 * a review that quietly omits a change is worse than one that admits a gap,
 * because the omission reads as completeness.
 */
function WorkspacePanel({
  session,
  workspace,
  busy,
  onRead,
}: {
  readonly session: ChatSessionInfo;
  readonly workspace: WorkspaceReport | null;
  readonly busy: Busy;
  readonly onRead: () => void;
}): JSX.Element {
  const entries: readonly { file: WorkspaceChange; label: DiffLabel }[] =
    workspace === null
      ? []
      : [
          ...workspace.changed.map((file) => ({ file, label: 'changed' as const })),
          ...workspace.added.map((file) => ({ file, label: 'added' as const })),
          ...workspace.removed.map((file) => ({ file, label: 'removed' as const })),
        ];

  return (
    <Section title="Changes and diff" defaultOpen>
      <p className="app__note">
        Differences established by hashing file bytes against the snapshot taken
        when the session opened ({session.baseline.snapshotId}). An agent&apos;s
        account of what it changed is not used here.
      </p>
      <div className="row">
        <button
          type="button"
          className="button"
          data-ev="read-files"
          onClick={onRead}
          disabled={busy !== null}
        >
          {busy === 'reading-files' ? 'Hashing and diffing …' : 'Check files on disk'}
        </button>
      </div>
      <div data-ev="changes">
        {workspace === null ? (
          <p className="app__note">Not checked yet.</p>
        ) : (
          <>
            <p className="app__note" data-ev="diff-snapshots">
              Diff between <code>{workspace.baselineSnapshotId}</code> (the session
              baseline, taken {workspace.baselineTakenAtUtc}) and{' '}
              <code>{workspace.observedSnapshotId}</code> (on disk, read{' '}
              {workspace.observedAtUtc}). Produced in{' '}
              {String(workspace.diffDurationMs)} ms.
            </p>
            <p className="app__note">
              <span data-ev="changed-count">{workspace.changed.length}</span> changed,{' '}
              <span data-ev="added-count">{workspace.added.length}</span> added,{' '}
              {workspace.removed.length} removed, {workspace.unchangedCount} unchanged.
            </p>
            <p className="app__note" data-ev="diff-coverage">
              {workspace.coverageNote}
            </p>
            {workspace.truncated && (
              <p className="app__error">
                One of the snapshots hit a size limit, so this comparison is
                partial. Files outside it are not reported either way.
              </p>
            )}
            {workspace.filesWithoutDiff > 0 && (
              <p className="app__note" data-ev="diff-without-text">
                {workspace.filesWithoutDiff} of these{' '}
                {workspace.filesWithoutDiff === 1 ? 'files is' : 'files are'} listed
                without diff text. Each one says why.
              </p>
            )}
            {entries.length === 0 && (
              <p className="app__note">No file differs from the baseline.</p>
            )}
            <div className="diffs">
              {entries.map((entry, index) => (
                <FileDiff
                  key={`${entry.label}-${entry.file.relPath}`}
                  file={entry.file}
                  label={entry.label}
                  index={index}
                />
              ))}
            </div>
            {workspace.dirtyAtSessionStart.length > 0 && (
              <p className="app__note">
                {workspace.dirtyAtSessionStart.length} file
                {workspace.dirtyAtSessionStart.length === 1 ? '' : 's'} already
                differed from git HEAD when this session opened. Any of them marked
                above carries your earlier work as well as anything changed since.
              </p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

type DiffLabel = 'changed' | 'added' | 'removed';

const DIFF_LABEL_TEXT: Record<DiffLabel, string> = {
  changed: 'changed',
  added: 'added since the session opened',
  removed: 'deleted since the session opened',
};

function FileDiff({
  file,
  label,
  index,
}: {
  readonly file: WorkspaceChange;
  readonly label: DiffLabel;
  readonly index: number;
}): JSX.Element {
  return (
    <details className="diff" open>
      <summary className="diff__summary">
        <span className="files__path" data-ev={`diff-${String(index)}-path`}>
          {file.relPath}
        </span>{' '}
        <span className="files__note">{DIFF_LABEL_TEXT[label]}</span>{' '}
        <span className="files__note" data-ev={`diff-${String(index)}-lines`}>
          {file.addedLines === null || file.removedLines === null
            ? 'line counts unknown'
            : `+${String(file.addedLines)} −${String(file.removedLines)}`}
        </span>{' '}
        <code className="files__hash">
          {short(file.beforeSha256)} → {short(file.afterSha256)}
        </code>{' '}
        <span className="files__note">
          {file.beforeBytes === null ? '—' : String(file.beforeBytes)} →{' '}
          {file.afterBytes === null ? '—' : String(file.afterBytes)} bytes
        </span>
        {file.preexistingDirty && (
          <>
            {' '}
            <span
              className="badge badge--unknown"
              data-ev={`diff-${String(index)}-preexisting`}
            >
              also had your earlier changes
            </span>
          </>
        )}
      </summary>
      {file.diffLimitation !== null && (
        <p className="app__note" data-ev={`diff-${String(index)}-limitation`}>
          {file.diffLimitation}
        </p>
      )}
      {file.unifiedDiff !== null && (
        <pre className="diff__text" data-ev={`diff-${String(index)}-text`}>
          {diffLines(file.unifiedDiff).map((line, at) => (
            <span
              key={`${String(at)}-${line}`}
              className={`diff__line diff__line--${diffLineKind(line)}`}
            >
              {line}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </details>
  );
}

/** The patch's lines, without the empty one its final newline would produce. */
function diffLines(unifiedDiff: string): readonly string[] {
  const lines = unifiedDiff.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function diffLineKind(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('\\')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
}

/**
 * The build/test action.
 *
 * The command and the working directory are two ordinary text fields, and they
 * are the only place either value lives: there is no settings file to hand-edit,
 * and the suggestion DSpatch derived from the project is a starting point the
 * user can overwrite.
 *
 * The part that carries AC#8 is the freshness line above the result. A result is
 * bound to the snapshot hash of the code it ran against; once the working copy
 * moves on, the result says so instead of sitting there looking like a verdict on
 * the new code.
 */
function TestPanel({
  session,
  test,
  testError,
  freshness,
  stopNote,
  command,
  cwd,
  busy,
  needsAcknowledgement,
  onCommandChange,
  onCwdChange,
  onResetCommand,
  onRun,
  onStop,
  onRecheck,
}: {
  readonly session: ChatSessionInfo;
  readonly test: TestOutcome | null;
  readonly testError: BridgeFailure | null;
  readonly freshness: TestFreshness | null;
  readonly stopNote: string | null;
  readonly command: string;
  readonly cwd: string;
  readonly busy: Busy;
  readonly needsAcknowledgement: readonly string[];
  readonly onCommandChange: (value: string) => void;
  readonly onCwdChange: (value: string) => void;
  readonly onResetCommand: () => void;
  readonly onRun: (acknowledgedAttemptIds?: readonly string[]) => void;
  readonly onStop: () => void;
  readonly onRecheck: () => void;
}): JSX.Element {
  const running = busy === 'running-test';
  const stale = freshness !== null && freshness.kind === 'stale';
  return (
    <Section title="Build and test" defaultOpen>
      <p className="app__note">
        DSpatch starts the command as a child process, so the exit code and the
        output are DSpatch&apos;s own observation. Both fields are editable and
        nothing is configured anywhere else.
      </p>

      <div className="fields">
        <label className="field">
          <span className="field__label">Command</span>
          <input
            className="field__input"
            data-ev="test-command-input"
            type="text"
            spellCheck={false}
            placeholder="for example: npm test"
            value={command}
            disabled={running}
            onChange={(event) => {
              onCommandChange(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">Working directory</span>
          <input
            className="field__input"
            data-ev="test-cwd-input"
            type="text"
            spellCheck={false}
            value={cwd}
            disabled={running}
            onChange={(event) => {
              onCwdChange(event.target.value);
            }}
          />
        </label>
      </div>

      <p className="app__note">
        Will run <code data-ev="test-command">{command === '' ? 'nothing yet' : command}</code>{' '}
        in <code data-ev="test-cwd">{cwd}</code>.
      </p>
      <p className="app__note">{session.testCommandNote}</p>

      <div className="row">
        <button
          type="button"
          className="button"
          data-ev="run-test"
          onClick={() => {
            onRun();
          }}
          disabled={
            busy !== null || command.trim() === '' || needsAcknowledgement.length > 0
          }
        >
          {running ? 'Running …' : 'Run it'}
        </button>
        <button
          type="button"
          className="button"
          data-ev="stop-test"
          onClick={onStop}
          disabled={!running}
        >
          Stop it
        </button>
        <button
          type="button"
          className="button button--quiet"
          data-ev="reset-test-command"
          onClick={onResetCommand}
          disabled={running}
        >
          Reset to the suggestion
        </button>
        <button
          type="button"
          className="button button--quiet"
          data-ev="recheck-test"
          onClick={onRecheck}
          disabled={test === null || running}
        >
          Check whether this still applies
        </button>
        {running && (
          <span className="pending" data-ev="test-pending">
            the command is running; no result yet
          </span>
        )}
      </div>

      {needsAcknowledgement.length > 0 && (
        <div className="app__error" data-ev="run-needs-acknowledgement">
          <p>
            {needsAcknowledgement.length === 1
              ? 'The previous command has no known outcome'
              : `${String(
                  needsAcknowledgement.length,
                )} earlier commands have no known outcome`}{' '}
            ({needsAcknowledgement.join(', ')}), so DSpatch will not start one again
            by itself — a process that is still running would write into the same
            working copy, and on Windows it also keeps the folder open.{' '}
            {needsAcknowledgement.length === 1 ? 'Its details are' : 'Their details are'}{' '}
            in &quot;Execution state&quot; above.
          </p>
          <button
            type="button"
            className="button"
            data-ev="run-anyway"
            onClick={() => {
              onRun(needsAcknowledgement);
            }}
            disabled={busy !== null || command.trim() === ''}
          >
            {needsAcknowledgement.length === 1
              ? `Run again, leaving ${needsAcknowledgement[0] ?? ''} unresolved`
              : `Run again, leaving all ${String(
                  needsAcknowledgement.length,
                )} unresolved (${needsAcknowledgement.join(', ')})`}
          </button>
        </div>
      )}
      {testError !== null && (
        <Failure
          failure={testError}
          testId="test-error"
          onRetry={() => {
            onRun();
          }}
          onAcknowledge={
            needsAcknowledgement.length === 0
              ? undefined
              : () => {
                  onRun(needsAcknowledgement);
                }
          }
        />
      )}
      {stopNote !== null && (
        <p className="app__note" data-ev="test-stop-note">
          {stopNote}
        </p>
      )}

      <div data-ev="test-result">
        {test === null ? (
          <p className="app__note">
            {running ? 'Waiting for the command to finish …' : 'Not run yet.'}
          </p>
        ) : (
          <>
            {/*
              The one line that says what the run means. It comes from the main
              process, which combines how the command ended with whether the code
              has changed since. The window renders it and derives nothing: there is
              no expression here that can produce "passed".
            */}
            {freshness !== null && (
              <p
                className={
                  freshness.presentedStatus === 'passed' ? 'app__note' : 'app__error'
                }
                data-ev="test-status"
              >
                <span
                  className={`badge badge--${PRESENTED_BADGE[freshness.presentedStatus]}`}
                  data-ev="test-status-kind"
                >
                  {PRESENTED_STATUS_LABEL[freshness.presentedStatus]}
                </span>{' '}
                {freshness.presentedHeadline}
              </p>
            )}
            <p className="app__note" data-ev="test-verdict">
              How it ended: <strong>{TEST_VERDICT_LABEL[test.verdict]}</strong>.{' '}
              {test.verdictHeadline}
            </p>
            {freshness !== null && (
              <p
                className={freshness.kind === 'current' ? 'app__note' : 'app__error'}
                data-ev="test-freshness"
              >
                <span data-ev="test-freshness-kind">{freshness.kind}</span> —{' '}
                {freshness.headline} Checked {freshness.checkedAtUtc}.
              </p>
            )}
            {freshness?.commandChangedWorkspace === true && (
              <p className="app__error" data-ev="test-self-modified">
                The command itself changed files in the working copy while it ran
                ({freshness.testedSnapshotId ?? 'unknown'} →{' '}
                {freshness.afterRunSnapshotId ?? 'unknown'}), so what it tested is not
                what it left behind.
              </p>
            )}
            {test.killedByDspatch && (
              <p className="app__error" data-ev="test-killed">
                You stopped this command. What is below is the output it had produced
                by then, not a result.
              </p>
            )}
            <dl className="facts">
              <Fact label="Command" value={test.command} />
              <Fact label="Interpreted by" value={test.shell} />
              <Fact label="Working directory" value={test.cwd} />
              <Fact
                label="Exit code"
                value={
                  test.killedByDspatch
                    ? 'none — you stopped it, so there is no result'
                    : test.exitCode === null
                      ? `none — ended on signal ${test.signal ?? 'unknown'}`
                      : String(test.exitCode)
                }
                testId="test-exit-code"
              />
              <Fact label="Duration" value={`${String(test.durationMs)} ms`} />
              <Fact
                label="Code it ran against"
                value={test.snapshotId ?? 'unknown — the working copy could not be hashed'}
                testId="test-snapshot"
              />
              <Fact
                label="git revision then"
                value={test.gitHeadRevision ?? 'unknown'}
              />
            </dl>
            {stale && (
              <p className="app__note">
                The output below is kept deliberately rather than cleared: it is still
                a true record of {test.snapshotId ?? 'the snapshot it ran against'}. It
                is simply not about the code you have now.
              </p>
            )}
            <pre className="output" data-ev="test-stdout">
              {test.stdout === '' ? '(no standard output)' : test.stdout}
            </pre>
            {test.stderr !== '' && (
              <pre className="output" data-ev="test-stderr">
                {test.stderr}
              </pre>
            )}
            {test.outputTruncated && (
              <p className="app__note">
                The command produced more output than DSpatch keeps, so what is above
                is the first part of it.
              </p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

/**
 * One failure, in the words that belong to it, with the action that applies.
 *
 * The transport's own wrapping is removed by `describeBridgeFailure`, and what is
 * left is the sentence the main process wrote. The channel is kept below it: the
 * point of report 003's finding was that `Error invoking remote method
 * 'dspatch:start-session'` should not be the **first** thing a person reads, not
 * that it should be unavailable.
 *
 * DSP-64 decides the shape: **one sentence, then what can be done, then the detail
 * on request.** The headline is the failure's own first sentence, taken verbatim by
 * `describePlainly` rather than summarised here, so no refusal is made vaguer by
 * being made shorter. Everything that used to sit open under it — the rest of the
 * message, the long explanation with its measurements, the channel, the raw text —
 * is inside the disclosure, one labelled line each. Nothing was removed.
 *
 * The action is whatever genuinely applies. A handler that is not supplied leaves
 * the button out rather than showing a dead one.
 */
function Failure({
  failure,
  testId,
  onRetry,
  onReconnect,
  onOpenAgain,
  onAcknowledge,
  onChooseFolder,
  onContinueInNewSession,
}: {
  readonly failure: BridgeFailure;
  readonly testId: string;
  readonly onRetry?: () => void;
  readonly onReconnect?: () => void;
  readonly onOpenAgain?: () => void;
  readonly onAcknowledge?: () => void;
  readonly onChooseFolder?: () => void;
  readonly onContinueInNewSession?: () => void;
}): JSX.Element {
  const handler =
    failure.action === 'retry'
      ? onRetry
      : failure.action === 'reconnect'
        ? onReconnect
        : failure.action === 'open-project-again'
          ? onOpenAgain
          : failure.action === 'acknowledge-then-repeat'
            ? onAcknowledge
            : failure.action === 'choose-another-folder'
              ? onChooseFolder
              : failure.action === 'continue-in-new-session'
                ? onContinueInNewSession
                : undefined;
  const label =
    failure.action === 'retry'
      ? 'Try again'
      : failure.action === 'reconnect'
        ? 'Check the connection again'
        : failure.action === 'open-project-again'
          ? 'Open a project again'
          : failure.action === 'acknowledge-then-repeat'
            ? 'Continue, leaving the earlier attempt unresolved'
            : failure.action === 'continue-in-new-session'
              ? 'Continue in a new provider session'
              : 'Choose another folder';

  const plain = describePlainly(failure);

  return (
    <div className="app__error" data-ev={testId}>
      <p data-ev={`${testId}-message`}>{plain.headline}</p>
      {plain.nextStep !== '' && (
        <p className="card__detail" data-ev={`${testId}-next-step`}>
          {plain.nextStep}
        </p>
      )}
      <details className="error-detail" data-ev={`${testId}-detail`}>
        <summary className="error-detail__summary" data-ev={`${testId}-detail-summary`}>
          Technical detail
        </summary>
        {plain.detail.map((line) => (
          <p className="card__detail" key={line.label}>
            <strong>{line.label}:</strong> {line.value}
          </p>
        ))}
      </details>
      {handler !== undefined && (
        <button
          type="button"
          className="button"
          data-ev={`${testId}-action`}
          onClick={handler}
        >
          {label}
        </button>
      )}
    </div>
  );
}

const ATTEMPT_STATE_LABEL: Record<AttemptState, string> = {
  waiting: 'waiting — nothing has confirmed a start',
  running: 'running',
  'cancel-requested': 'cancellation requested — no confirmed end yet',
  'stopped-confirmed': 'confirmed stopped',
  'outcome-unknown': 'outcome unknown',
  completed: 'completed',
  failed: 'failed',
};

const ATTEMPT_BADGE: Record<AttemptState, CapabilitySupport> = {
  waiting: 'unknown',
  running: 'unknown',
  'cancel-requested': 'unknown',
  'stopped-confirmed': 'supported',
  'outcome-unknown': 'unsupported',
  completed: 'supported',
  failed: 'unsupported',
};

/**
 * Execution state: every attempt, its own ID, and what may still be going.
 *
 * This panel is DSP-3's answer to the loop that stalled on a failed tool call. The
 * conversation shows what was said; this shows what was **done**, including the
 * attempts that produced nothing to say. A waiting send, a cancellation with no
 * confirmed end and an outcome nobody knows are all visible here as themselves,
 * and each carries the one action that applies to it.
 */
function RunStatePanel({
  runState,
  busy,
  onStopWaiting,
  onStopCommand,
  onSendAnyway,
  onRunAgain,
  onRetry,
  canAct,
}: {
  readonly runState: RunStateReport;
  readonly busy: Busy;
  readonly onStopWaiting: () => void;
  readonly onStopCommand: () => void;
  readonly onSendAnyway: (attemptIds: readonly string[]) => void;
  readonly onRunAgain: (attemptIds: readonly string[]) => void;
  readonly onRetry: (kind: AttemptInfo['kind']) => void;
  /** Whether a session is open. Without one, no action here can do anything. */
  readonly canAct: boolean;
}): JSX.Element {
  const newestFirst = [...runState.attempts].reverse();
  return (
    <Section title="Execution state" defaultOpen>
      <p className="app__note">
        Every attempt DSpatch has made in this window, with its own ID and the state
        it is actually in. An attempt that started nothing, or that was asked to stop
        without confirming an end, is shown as exactly that. Nothing here is inferred
        from silence.
      </p>
      <p className="app__note" data-ev="unresolved-attempts">
        {runState.unresolved.length === 0
          ? 'Nothing is unresolved.'
          : `${String(runState.unresolved.length)} attempt${
              runState.unresolved.length === 1 ? ' is' : 's are'
            } unresolved. While that is true, DSpatch will not repeat the same kind ` +
            'of action on its own.'}
      </p>
      {!canAct && newestFirst.length > 0 && (
        <p className="app__note" data-ev="attempts-need-session">
          No project is open, so these are a record rather than something to act on.
          The states below are what DSpatch established; an unresolved one still has to
          be confirmed, and that happens when you continue the conversation.
        </p>
      )}
      {newestFirst.length === 0 ? (
        <p className="app__note">Nothing has been attempted yet.</p>
      ) : (
        <div className="attempts">
          {newestFirst.map((attempt, index) => (
            <AttemptRow
              key={attempt.attemptId}
              attempt={attempt}
              index={index}
              busy={busy}
              needsAcknowledgement={
                attempt.kind === 'agent-turn'
                  ? runState.needsAcknowledgement.agentTurn
                  : runState.needsAcknowledgement.command
              }
              onStopWaiting={onStopWaiting}
              onStopCommand={onStopCommand}
              onSendAnyway={onSendAnyway}
              onRunAgain={onRunAgain}
              onRetry={onRetry}
              canAct={canAct}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function AttemptRow({
  attempt,
  index,
  busy,
  needsAcknowledgement,
  onStopWaiting,
  onStopCommand,
  onSendAnyway,
  onRunAgain,
  onRetry,
  canAct,
}: {
  readonly attempt: AttemptInfo;
  readonly index: number;
  readonly busy: Busy;
  /**
   * Every attempt of this attempt's kind that a repeat has to name.
   *
   * Includes this one when this one is blocking. It is the whole list because the
   * main process will not accept a subset: one unknown outcome left unnamed is
   * still an unknown outcome, and report 006 measured a restart producing two.
   */
  readonly needsAcknowledgement: readonly string[];
  readonly onStopWaiting: () => void;
  readonly onStopCommand: () => void;
  readonly onSendAnyway: (attemptIds: readonly string[]) => void;
  readonly onRunAgain: (attemptIds: readonly string[]) => void;
  readonly onRetry: (kind: AttemptInfo['kind']) => void;
  readonly canAct: boolean;
}): JSX.Element {
  const isTurn = attempt.kind === 'agent-turn';
  const action = attempt.nextAction;
  const alsoNamed = needsAcknowledgement.filter((id) => id !== attempt.attemptId);
  const handler =
    action.kind === 'stop-waiting'
      ? isTurn
        ? onStopWaiting
        : onStopCommand
      : action.kind === 'acknowledge-then-repeat'
        ? () => {
            if (isTurn) {
              onSendAnyway(needsAcknowledgement);
            } else {
              onRunAgain(needsAcknowledgement);
            }
          }
        : // A failed attempt suggests trying again, and report 005 found that the
          // suggestion had no control of its own: the plain Send button was enabled,
          // so nothing was stuck, but the failure did not carry its own action the
          // way an IPC rejection does. This is a new attempt, not a repeat of this
          // one — a failure is a known ending, so nothing has to be acknowledged.
          action.kind === 'retry'
          ? () => {
              onRetry(attempt.kind);
            }
          : null;

  return (
    <article className="attempt" data-ev={`attempt-${String(index)}`}>
      <p className="attempt__head">
        <code data-ev={`attempt-${String(index)}-id`}>{attempt.attemptId}</code>{' '}
        <span
          className={`badge badge--${ATTEMPT_BADGE[attempt.state]}`}
          data-ev={`attempt-${String(index)}-state`}
        >
          {ATTEMPT_STATE_LABEL[attempt.state]}
        </span>{' '}
        <span className="files__note">
          {isTurn ? 'message' : 'command'}: {attempt.label}
        </span>
      </p>
      <p className="card__detail" data-ev={`attempt-${String(index)}-reason`}>
        {attempt.stateReason}
      </p>
      <p className="card__detail" data-ev={`attempt-${String(index)}-still-running`}>
        Still running — provider: {tristate(attempt.stillRunning.provider)}; a process
        DSpatch started: {tristate(attempt.stillRunning.dspatchProcess)}.{' '}
        {attempt.stillRunning.note}
      </p>
      <p className="card__detail">
        Asked for {attempt.requestedAtUtc}
        {attempt.providerRunId === null ? '' : ` · run ${attempt.providerRunId}`}
        {attempt.localPid === null ? '' : ` · pid ${String(attempt.localPid)}`}
        {attempt.cancelRequestedAtUtc === null
          ? ''
          : ` · stop asked for ${attempt.cancelRequestedAtUtc}`}
        {attempt.endedAtUtc === null ? '' : ` · ended ${attempt.endedAtUtc}`}
        {attempt.acknowledgedAtUtc === null
          ? ''
          : ` · you accepted the unknown outcome ${attempt.acknowledgedAtUtc}`}
      </p>
      {/*
        Also shown when there is no action but the outcome is unknown: that is the
        acknowledged case, where the absence of a button is the thing that needs
        explaining. An attempt that simply ended keeps its silent row.
      */}
      {(action.kind !== 'none' || attempt.state === 'outcome-unknown') && (
        <p className="card__detail" data-ev={`attempt-${String(index)}-action-note`}>
          {action.detail}
        </p>
      )}
      {/*
        Acting on this row acts on the others too, so the row says so before the
        button rather than after. Report 006 measured the alternative: one attempt
        named, the message accepted, and a second unknown outcome still sitting
        there unmentioned by the thing that let the message through.
      */}
      {action.kind === 'acknowledge-then-repeat' && alsoNamed.length > 0 && (
        <p className="card__detail" data-ev={`attempt-${String(index)}-also-named`}>
          {alsoNamed.length === 1
            ? 'One other attempt'
            : `${String(alsoNamed.length)} other attempts`}{' '}
          of this kind {alsoNamed.length === 1 ? 'has' : 'have'} no known outcome
          either ({alsoNamed.join(', ')}), and DSpatch will not continue while any of
          them is unnamed. Using the button below accepts all{' '}
          {String(needsAcknowledgement.length)} as unresolved. That records them; it
          does not mark any of them done.
        </p>
      )}
      {handler !== null && canAct && (
        <button
          type="button"
          className="button"
          data-ev={`attempt-${String(index)}-action`}
          onClick={handler}
          disabled={busy === 'starting-session'}
        >
          {action.kind === 'acknowledge-then-repeat' && alsoNamed.length > 0
            ? `${action.label} (all ${String(needsAcknowledgement.length)})`
            : action.label}
        </button>
      )}
      {attempt.history.some((step) => !step.applied) && (
        <p className="app__note" data-ev={`attempt-${String(index)}-discarded`}>
          {attempt.history.filter((step) => !step.applied).length} later claim about
          this attempt&apos;s outcome was recorded but not applied, because it had
          already been settled. The claims are kept:{' '}
          {attempt.history
            .filter((step) => !step.applied)
            .map((step) => `${step.state} at ${step.atUtc}`)
            .join('; ')}
          .
        </p>
      )}
    </article>
  );
}

function tristate(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

function CancelPanel({
  observations,
}: {
  readonly observations: CancelObservations;
}): JSX.Element {
  return (
    <Section title="After cancellation" defaultOpen>
      <p className="app__note">{observations.note}</p>
      <dl className="facts">
        <Fact
          label="Verdict"
          value={
            observations.watching
              ? 'still watching — no verdict yet'
              : VERDICT_LABEL[observations.verdict]
          }
          testId="cancel-verdict"
        />
        <Fact
          label="Tool events before / after cancel"
          value={`${String(observations.toolEventsBeforeCancel)} / ${String(
            observations.toolEventsAfterCancel,
          )}`}
        />
        <Fact
          label="Events after the terminal event"
          value={String(observations.eventsAfterTerminalEvent)}
        />
        <Fact
          label="Usage records after cancel"
          value={String(observations.usageEventsAfterCancel)}
        />
        <Fact
          label="Files at cancel / after watching"
          value={`${unknownOr(observations.workspaceFileCountAtCancel)} / ${unknownOr(
            observations.workspaceFileCountAfterWatch,
          )}`}
        />
        <Fact
          label="Watched"
          value={`${String(observations.watchedSeconds)} s`}
          testId="cancel-watched"
        />
      </dl>
    </Section>
  );
}

const TEST_VERDICT_LABEL: Record<TestVerdict, string> = {
  passed: 'ran to the end and exited 0',
  failed: 'ran to the end and failed',
  interrupted: 'interrupted, so there is no result',
  unknown: 'unknown — no exit code was reported',
};

const PRESENTED_STATUS_LABEL: Record<PresentedTestStatus, string> = {
  'no-result': 'not run',
  passed: 'passed',
  'passed-for-older-code': 'passed for older code',
  failed: 'failed',
  interrupted: 'interrupted — not a result',
  unknown: 'unknown',
};

const PRESENTED_BADGE: Record<PresentedTestStatus, CapabilitySupport> = {
  'no-result': 'unknown',
  passed: 'supported',
  'passed-for-older-code': 'unknown',
  failed: 'unsupported',
  interrupted: 'unknown',
  unknown: 'unknown',
};

const VERDICT_LABEL: Record<CancelObservations['verdict'], string> = {
  unresolved:
    'unresolved — nothing observed either way; this does not mean the provider stopped',
  'provider-kept-working':
    'the provider kept working after DSpatch reported the run cancelled',
  'no-continued-work-observed':
    'no continued work observed, which is not the same as the provider having stopped',
};

/**
 * A collapsible panel.
 *
 * `<details>` rather than conditional rendering on purpose: the children stay in
 * the document when the panel is closed, so the scripted run can still read what
 * the window is holding, and screen readers and keyboard users get the disclosure
 * behaviour for free.
 */
/**
 * What DSpatch has left in its own sample location, and a way to remove it (DSP-61).
 *
 * Here rather than beside *Use a generated sample project*, because a new session no
 * longer depends on any of it: the generator writes into a folder of its own every
 * time, so this panel is about disk space rather than about getting started. Reached
 * from **Project → Old sample projects…**, which opens the details and reads the
 * location; nothing is removed until the button below is used.
 *
 * Every row says what DSpatch knows about the folder, including whether it carries
 * the marker. The ones that do not are the folders generated before the marker
 * existed — the leftover that broke the sample project in the first place — and they
 * are removable here because they are in DSpatch's own location, which is the only
 * thing that makes them DSpatch's to remove.
 */
function SampleProjectsPanel({
  samples,
  cleanup,
  note,
  busy,
  onRead,
  onRemove,
}: {
  readonly samples: SampleProjectsView | null;
  readonly cleanup: SampleCleanupOutcome | null;
  readonly note: string | null;
  readonly busy: boolean;
  readonly onRead: () => void;
  readonly onRemove: (paths: readonly string[]) => void;
}): JSX.Element {
  return (
    <Section title="Sample projects DSpatch generated">
      <div data-ev="sample-projects">
        <p className="app__note">
          DSpatch generates a throwaway sample project in a folder of its own each
          time you ask for one, so nothing here is reused or needed by a new session.
          Removing them is entirely up to you. Your own project folders are never
          touched, and no saved conversation is deleted.
        </p>

        {samples === null ? (
          <div className="row">
            <button
              type="button"
              className="button"
              data-ev="read-sample-projects"
              onClick={onRead}
              disabled={busy}
            >
              {busy ? 'Reading …' : 'Look for old sample projects'}
            </button>
          </div>
        ) : (
          <>
            <dl className="facts">
              <Fact label="Location" value={samples.root} testId="sample-root" />
              <Fact
                label="Found"
                value={
                  samples.folders.length === 0
                    ? 'none'
                    : `${String(samples.folders.length)} ${
                        samples.folders.length === 1 ? 'folder' : 'folders'
                      }`
                }
                testId="sample-count"
              />
              {samples.inUse !== null && (
                <Fact
                  label="In use by this session"
                  value={`${samples.inUse} — not offered for removal`}
                  testId="sample-in-use"
                />
              )}
            </dl>
            <p className="app__note" data-ev="sample-note">
              {samples.note}
            </p>
            {samples.error !== null && (
              <p className="app__error" data-ev="sample-error">
                {samples.error}
              </p>
            )}
            {samples.folders.length > 0 && (
              <ul className="files">
                {samples.folders.map((folder) => (
                  <li className="files__row" key={folder.path}>
                    <span className="files__path">{folder.name}</span>
                    <span className="files__note">
                      {folder.fileCount === 0
                        ? 'empty'
                        : `${String(folder.fileCount)} files`}
                      {folder.lastChangedUtc === null
                        ? ', last changed unknown'
                        : `, last changed ${folder.lastChangedUtc}`}
                      {folder.marked
                        ? ''
                        : ' — generated before DSpatch wrote a marker file, so it is' +
                          ' known by being in this location'}
                      {folder.error === null ? '' : ` (${folder.error})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="row">
              <button
                type="button"
                className="button"
                data-ev="reread-sample-projects"
                onClick={onRead}
                disabled={busy}
              >
                {busy ? 'Reading …' : 'Look again'}
              </button>
              {samples.folders.length > 0 && (
                <button
                  type="button"
                  className="button"
                  data-ev="remove-sample-projects"
                  onClick={() => {
                    onRemove(samples.folders.map((folder) => folder.path));
                  }}
                  disabled={busy}
                >
                  {busy
                    ? 'Removing …'
                    : samples.folders.length === 1
                      ? 'Remove it'
                      : `Remove all ${String(samples.folders.length)}`}
                </button>
              )}
            </div>
          </>
        )}

        {cleanup !== null && (
          <div data-ev="sample-cleanup">
            <p className="app__note" data-ev="sample-cleanup-note">
              {cleanup.note}
            </p>
            {cleanup.held.length > 0 && (
              <ul className="files">
                {cleanup.held.map((entry) => (
                  <li className="files__row" key={entry.path}>
                    <span className="files__path">{entry.path}</span>
                    <span className="files__note">{entry.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {note !== null && (
          <p className="app__error" data-ev="sample-failure">
            {note}
          </p>
        )}
      </div>
    </Section>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <details
      className="panel panel--section"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="panel__title panel__summary">{title}</summary>
      {children}
    </details>
  );
}

/**
 * How often to re-check whether a test result still applies.
 *
 * Bucketed rather than proportional, so the interval is not torn down and
 * rebuilt on every tick. Hashing DSpatch's own repository took 94 ms when it was
 * measured; polling that every four seconds would spend a noticeable slice of
 * the main process on a question nobody asked, so a slow check polls slowly.
 */
function freshnessPollMs(lastDurationMs: number | null): number {
  if (lastDurationMs === null || lastDurationMs < 50) {
    return 4_000;
  }
  if (lastDurationMs < 250) {
    return 10_000;
  }
  return 30_000;
}

function unknownOr(value: number | null): string {
  return value === null ? 'unknown' : String(value);
}

function short(hash: string | null): string {
  return hash === null ? '—' : `${hash.slice(0, 12)}…`;
}

function basename(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? fullPath;
}

const TURN_STATUS_LABEL: Record<TurnState['status'], string> = {
  streaming: 'streaming …',
  'awaiting-approval': 'waiting for an approval DSpatch cannot answer',
  finished: 'finished',
  cancelled: 'cancelled',
  error: 'error',
};

/**
 * One loop run in the conversation.
 *
 * The same three parts as an ordinary turn — what was asked, what came back, what
 * state it is in — and one part an ordinary turn does not need: a line saying this
 * was a loop run rather than a message. A later reader has to be able to tell who
 * typed what, and the mandate is the user's own words while the replies are an
 * agent's, several steps deep.
 *
 * Nothing here decides what to say. {@link loopTurnStatusText} owns that, so the
 * sentence a refusal, a fault, a spent bound or a cancellation gets is the one its
 * test asserts rather than one this component assembles.
 */
function LoopTurnEntry({
  turn,
  index,
  standing,
  stillWatching,
  nowMs,
}: {
  readonly turn: LoopTurn;
  readonly index: number;
  /** Where this run stands, for the run it is about. `null` for any other run. */
  readonly standing: ConversationStanding | null;
  /** Whether the window is still receiving this run's events. */
  readonly stillWatching: boolean;
  readonly nowMs: number;
}): JSX.Element {
  const badge = loopTurnBadge(turn);
  const at = `loop-turn-${String(index)}`;
  const ending = loopTurnEndingLine(turn);
  const steps = turn.steps ?? [];
  const live = turn.ending === null ? runningStep(steps, turn.runId) : null;
  const liveStanding =
    live === null && turn.ending !== null
      ? null
      : stepStanding({ step: live, stillWatching, nowMs });
  return (
    <article className="turn turn--loop" data-ev={at}>
      <p className="turn__loop-mark" data-ev={`${at}-mark`}>
        Loop run · <code>{CHAT_LOOP_GRAPH_ID}</code> ·{' '}
        {turn.restoredFrom === 'record'
          ? 'read back from this conversation’s saved record — history, not something in flight'
          : 'your mandate, walked by the loop'}
      </p>
      <UserMessage text={turn.mandate} testId={`${at}-mandate`} />
      {/*
        The run as roles handing work to each other, drawn from the record's own
        replies and their order — never from an idea of what the graph does. A loop
        run mostly consists of those moves, and a column of three replies does not
        show them; `handoffTrail` also counts the times a role speaks, because
        implementer, verifier, implementer is what rework looks like and two entries
        both labelled Implementer leave a reader unable to tell the passes apart.
        Everything here survives a restart: `loopTurnsFromRecords` rebuilds the same
        replies from disk and the same trail comes back out.
      */}
      {handoffTrail(turn.replies, turn.branches ?? []).map((item, itemIndex) =>
        item.kind === 'handoff' ? (
          <p
            key={`handoff-${String(itemIndex)}`}
            className="handoff"
            data-ev={`${at}-handoff-${String(itemIndex)}`}
          >
            {item.text}
          </p>
        ) : (
          <div key={`reply-${String(itemIndex)}`}>
            <p className="app__note" data-ev={`${at}-reply-${String(itemIndex)}-who`}>
              {item.nodeLabel} ({item.nodeId}) answered
              {item.occurrenceNote === '' ? '' : `, ${item.occurrenceNote}`}:
            </p>
            {/* Whole and untrimmed, like an ordinary answer. A summarised account of
                what an agent did to the project would not be the agent's account.
                Formatted for the same reason an ordinary reply is: a role's report
                is the most heading-and-list-shaped text in the window. */}
            <div className="turn__answer" data-ev={`${at}-reply-${String(itemIndex)}`}>
              <Markdown text={item.text} />
            </div>
            {/* What this step did, beside the work it did it for. §9 asks for tool
                detail expanded alongside the relevant work rather than in a log
                somewhere else; a step that made no tool calls shows nothing. */}
            <StepToolCalls
              tools={toolsForStep(steps, turn.runId, item.nodeId, item.occurrence)}
              testId={`${at}-reply-${String(itemIndex)}-tools`}
            />
          </div>
        ),
      )}
      {/*
        The step that is working, **in the place its reply will take**.

        §9: streaming text grows in the reply's place and remains as history when
        complete. So this sits after the last handover, where the next answer goes, and
        the reply replaces it when it lands — which is why the final result does not
        duplicate what was already shown. It is a view and not history: the run record
        keeps the reply and the prompt it answered, and nothing here is written down.
      */}
      {live === null ? null : (
        <LiveStep step={live} standing={liveStanding} testId={`${at}-live`} />
      )}
      {live === null && liveStanding !== null && turn.ending === null ? (
        <p
          className={`step-status step-status--${liveStanding.standing}`}
          data-ev={`${at}-live-status`}
          data-standing={liveStanding.standing}
          data-activity-known={String(liveStanding.activityIsKnown)}
        >
          {liveStanding.text}
        </p>
      ) : null}
      {/*
        The ending, short, with the technical account behind it.

        Niclas met the long version: a paragraph of run detail under a loop run in the
        middle of a conversation, reading as though the interesting thing about the run
        were how DSpatch had gone about checking it. §5 asks for a concise statement of
        what was achieved and what was checked, with technical detail available on
        demand, and `loopTurnEndingLine` decides which runs get that treatment — a run
        still going, stopped, waiting or interrupted keeps its whole sentence here.

        `${at}-account` stays on the element holding the ending in the column, so what
        a scripted run reads as the account is still the account. The full text is in
        the disclosure and `textContent` reaches into a closed `details`, so nothing
        that could read it before has lost it.
      */}
      <p className="turn__meta">
        <span className={`badge badge--${badge}`} data-ev={`${at}-status`}>
          {loopTurnBadgeText(turn)}
        </span>{' '}
        <span data-ev={`${at}-account`}>{ending.text}</span>
      </p>
      {ending.hasMore && (
        <details className="turn__counts" data-ev={`${at}-account-detail`}>
          <summary className="turn__counts-summary">
            {turn.restoredFrom === 'record'
              ? 'What this run recorded at the time'
              : 'What this run established, in full'}
          </summary>
          <p className="app__note" data-ev={`${at}-account-full`}>
            {loopTurnStatusText(turn)}
          </p>
        </details>
      )}
      <RunStanding standing={standing} testId={at} />
    </article>
  );
}

/** The tool calls belonging to one step of one run, or none when there were none. */
function toolsForStep(
  steps: readonly StepActivityState[],
  runId: string,
  nodeId: string,
  occurrence: number,
): readonly StepToolCall[] {
  const step = steps.find(
    (entry) =>
      entry.runId === runId && entry.nodeId === nodeId && entry.occurrence === occurrence,
  );
  return step?.tools ?? [];
}

/**
 * What an agent actually did, expanded beside the work it did it for.
 *
 * Summaries from `describeToolActivity`, which reads the provider's own message. The
 * detail behind each one is whatever the provider reported and nothing else: a command
 * that printed nothing says *no output was reported*, never *it printed nothing*,
 * because a two-megabyte stdout has been measured arriving here empty with the field
 * that would disclose it left null.
 */
function StepToolCalls({
  tools,
  testId,
}: {
  readonly tools: readonly StepToolCall[];
  readonly testId: string;
}): JSX.Element | null {
  if (tools.length === 0) {
    return null;
  }
  return (
    <details className="tool-calls" data-ev={testId}>
      <summary className="tool-calls__summary">
        {tools.length === 1 ? 'One tool call' : `${String(tools.length)} tool calls`} in this
        step
      </summary>
      <ul className="tool-calls__list">
        {tools.map((call) => (
          <li
            key={call.callId}
            className={`tool-call tool-call--${call.status ?? 'running'}`}
            data-ev={`${testId}-${call.callId}`}
          >
            <span className="tool-call__summary">{call.summary}</span>
            {call.detail === null ? null : (
              <pre className="tool-call__detail">{call.detail}</pre>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The step that is working: what it is saying, what it is running, and how long since.
 *
 * Three things a person asked for and could not have: the reply text as it is written,
 * the tool calls as they start and finish, and which agent and role the activity
 * belongs to. The status line is the fourth — one line, never a paragraph defending
 * the wait, and it says *waiting* rather than *working* the moment DSpatch stops
 * hearing anything, because time alone proves neither progress nor failure.
 */
function LiveStep({
  step,
  standing,
  testId,
}: {
  readonly step: StepActivityState;
  readonly standing: StepStandingReport | null;
  readonly testId: string;
}): JSX.Element {
  return (
    <div className="live-step" data-ev={testId}>
      <p className="app__note" data-ev={`${testId}-who`}>
        {step.nodeId} is working
        {step.roleId === null ? '' : ` as “${step.roleId}”`}
        {step.occurrence > 1 ? `, on its ${String(step.occurrence)}${ordinalSuffix(step.occurrence)} turn` : ''}:
      </p>
      {standing === null ? null : (
        <p
          className={`step-status step-status--${standing.standing}`}
          data-ev={`${testId}-status`}
          data-standing={standing.standing}
          data-activity-known={String(standing.activityIsKnown)}
        >
          {standing.text}
        </p>
      )}
      {/* The reply as it is being written, in the place the finished reply will take.
          Formatted the same way, so nothing jumps when the two swap over. */}
      {step.text === '' ? null : (
        <div className="turn__answer" data-ev={`${testId}-text`}>
          <Markdown text={step.text} />
        </div>
      )}
      {step.tools.length === 0 ? null : (
        <ul className="tool-calls__list tool-calls__list--live" data-ev={`${testId}-tools`}>
          {step.tools.map((call) => (
            <li
              key={call.callId}
              className={`tool-call tool-call--${call.status ?? 'running'}`}
              data-ev={`${testId}-tool-${call.callId}`}
            >
              <span className="tool-call__summary">{call.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ordinalSuffix(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return 'th';
  }
  const last = value % 10;
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

/**
 * Where a run stands, beside the run it is about.
 *
 * This used to be drawn once, at the foot of the conversation, from
 * `loopTurns[loopTurns.length - 1]` — the newest **loop** turn, wherever that sat
 * relative to newer messages. So a run that had finished kept announcing *Nobody.
 * This run has reported an end* under every ordinary reply that followed it, for
 * the rest of the session. Niclas met exactly that.
 *
 * The cure is placement rather than wording: the block belongs to one run, so it
 * is rendered inside that run's own entry and inherits the conversation's order
 * for free. Nothing about a run can now outlive its position in the history.
 *
 * A finished run keeps its standing behind a disclosure. The short, intelligible
 * ending is the sentence above it, which is already the run's own account of
 * itself; the four questions §9 asks — who, on what, waiting for what, what next —
 * are what a *live* run needs continuously and a finished one needs on request.
 */
function RunStanding({
  standing,
  testId,
}: {
  readonly standing: ConversationStanding | null;
  readonly testId: string;
}): JSX.Element | null {
  if (standing === null || standing.standing === 'idle') {
    return null;
  }
  const block = (
    <div
      className={`standing standing--${standing.standing}${
        standing.activityIsKnown && standing.standing === 'active' ? ' standing--live' : ''
      }`}
      data-ev="run-standing"
      data-standing={standing.standing}
      data-activity-known={String(standing.activityIsKnown)}
    >
      <p data-ev="standing-who">{standing.whoIsWorking}</p>
      <p data-ev="standing-what">{standing.onWhat}</p>
      <p data-ev="standing-waiting">{standing.waitingFor}</p>
      <p data-ev="standing-next">{standing.whatHappensNext}</p>
    </div>
  );
  /*
   * A working run keeps its four answers, on request.
   *
   * They were four paragraphs, permanently, under a run that had nothing to report —
   * *the first step to answer, nothing has come back yet* said at length for five
   * minutes. The line that belongs there while a step works is the step's own status,
   * which `LiveStep` draws above from what the provider actually sent; §9's four
   * questions are what a reader asks when the short line is not enough, and a
   * disclosure is where a question like that is answered.
   *
   * `stop-requested` and `unknown` stay open, because both are states a person may
   * have to act on and neither has anything shorter to say.
   */
  if (standing.standing !== 'stopped' && standing.standing !== 'active') {
    return block;
  }
  return (
    <details className="standing-detail" data-ev={`${testId}-standing-detail`}>
      <summary className="standing-detail__summary">
        {standing.standing === 'active'
          ? 'Who is working, on what, and what happens next'
          : 'Where this run stands, and what it left behind'}
      </summary>
      {block}
    </details>
  );
}

/**
 * A message the user typed while a run was working.
 *
 * In the same column as their other messages and the agents' replies, which is
 * DSP-53 #3: the question, the answer and the follow-up have to be readable
 * together, and a pending-instructions panel somewhere else would be the
 * "separate locations for a question and its reply" §6 rules out.
 *
 * It is drawn as the user's own message, because that is what it is. Nothing here
 * calls it an instruction, offers to reclassify it, or asks the person what kind
 * of message they meant — §7 retired that. The only thing this adds to an ordinary
 * message is a line saying where it has got to, which is the distinction §4.4
 * insists on: DSpatch holding it is not an agent having it.
 */
function InstructionEntry({
  instruction,
  index,
}: {
  readonly instruction: LoopInstruction;
  readonly index: number;
}): JSX.Element {
  const at = `instruction-${String(index)}`;
  const state = loopInstructionState(instruction);
  // Never the positive tone. A message that reached an agent is not a result, and
  // the three tones here say how far it got, not whether it did any good.
  const badge = state === 'delivered' ? 'unknown' : state === 'pending' ? 'unknown' : 'unsupported';
  return (
    <article className="turn turn--instruction" data-ev={at}>
      <p className="turn__loop-mark" data-ev={`${at}-mark`}>
        Your message, sent while the loop was working
      </p>
      <UserMessage text={instruction.text} testId={`${at}-text`} />
      <p className="turn__meta">
        <span className={`badge badge--${badge}`} data-ev={`${at}-status`}>
          {loopInstructionBadgeText(instruction)}
        </span>{' '}
        <span data-ev={`${at}-account`}>{loopInstructionStatusText(instruction)}</span>
      </p>
    </article>
  );
}

/**
 * How far a pointer may travel between press and release and still be a click.
 *
 * This constant is the difference between a box that feels right and one that is
 * infuriating. Selecting text in a collapsed message ends in a `click` event on the
 * box, indistinguishable from a tap unless the distance travelled is looked at, and
 * a message that folds itself up the moment you finish selecting a sentence from it
 * would be worse than no folding at all. A pointer that moved is a selection.
 */
const CLICK_SLOP_PX = 4;

/**
 * The user's own message: whole when it is short, folded when it is long.
 *
 * **The whole string is always in the document.** The fold is two CSS rules — a
 * height and `overflow: hidden` — so a collapsed message is shortened on screen and
 * not in the text: a selection reaches every word of it and Ctrl+C hands over the
 * message as it was typed. Truncating the string instead would have looked identical
 * and would have left nothing to copy.
 *
 * **There are no buttons.** The box itself is the control: clicking inside a
 * collapsed one opens it, clicking anywhere outside folds it again, and the only
 * thing drawn is a small glyph in the corner and a deep fade over the last line —
 * which is what the Cursor reference does. Keyboard access survives that: the box is
 * focusable and answers Enter, Space and Escape, so the affordance being quiet does
 * not make it mouse-only.
 *
 * Whether a message is long is a fact about the box rather than about the number of
 * characters — the same paragraph is short in a wide window and long in a narrow one
 * — so it is measured after layout and re-measured whenever the box changes width.
 *
 * Expanding and folding moves content above the reader's eyes, which is the same
 * problem as a reply arriving, so it is answered by the same module:
 * `scrollTopAfterResize` holds the message where it was on screen.
 */
function UserMessage({
  text,
  testId,
}: {
  readonly text: string;
  readonly testId: string;
}): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [longerThanTheBox, setLongerThanTheBox] = useState(false);
  /** Where the message sat in the scroller just before it changed height. */
  const anchorTopBefore = useRef<number | null>(null);
  /** Where the pointer went down, so a drag can be told from a click. */
  const pressedAt = useRef<{ readonly x: number; readonly y: number } | null>(null);

  const scrollerOf = (element: HTMLElement | null): HTMLElement | null =>
    element?.closest('.transcript') ?? null;

  /** Remember the box's place on screen, for the layout effect below. */
  const noteAnchor = useCallback((): void => {
    const element = boxRef.current;
    const scroller = scrollerOf(element);
    anchorTopBefore.current =
      element === null || scroller === null
        ? null
        : element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, []);

  // Measured while the fold is applied, and re-measured when the box's width
  // changes: a narrower window turns a message that fitted into one that does not,
  // and that is exactly the case where a stale answer here leaves a message cut off
  // with nothing to say so.
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (element === null || expanded) {
      return;
    }
    const measure = (): void => {
      // A couple of pixels of rounding is not an overflow; a clipped line is.
      setLongerThanTheBox(element.scrollHeight - element.clientHeight > 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [text, expanded]);

  useLayoutEffect(() => {
    const before = anchorTopBefore.current;
    anchorTopBefore.current = null;
    const element = boxRef.current;
    const scroller = scrollerOf(element);
    if (before === null || element === null || scroller === null) {
      return;
    }
    scroller.scrollTop = scrollTopAfterResize({
      scrollTop: scroller.scrollTop,
      anchorTopBefore: before,
      anchorTopAfter:
        element.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    });
    // The window's own scroll handler owns "is the reader following the latest",
    // and moving the scroller programmatically must not leave it holding a stale
    // answer to that.
    scroller.dispatchEvent(new Event('scroll'));
  }, [expanded]);

  // Clicking outside folds it again. The press is what is listened for rather than
  // the click, so a selection that starts inside the message and is released outside
  // it — over the reply below, say — is not read as leaving the box.
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const foldOnPressOutside = (event: PointerEvent): void => {
      const element = boxRef.current;
      const target = event.target;
      if (element === null || (target instanceof Node && element.contains(target))) {
        return;
      }
      noteAnchor();
      setExpanded(false);
    };
    document.addEventListener('pointerdown', foldOnPressOutside, true);
    return () => {
      document.removeEventListener('pointerdown', foldOnPressOutside, true);
    };
  }, [expanded, noteAnchor]);

  const interactive = longerThanTheBox;

  /**
   * Was that a click on the message, or the end of something else?
   *
   * Three things are not a click: a pointer that travelled, a selection that now
   * exists inside this box, and a press on a link — which keeps its own behaviour.
   */
  const wasAClick = (event: ReactMouseEvent<HTMLDivElement>): boolean => {
    const from = pressedAt.current;
    pressedAt.current = null;
    if (event.target instanceof Element && event.target.closest('a') !== null) {
      return false;
    }
    if (
      from !== null &&
      Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y) > CLICK_SLOP_PX
    ) {
      return false;
    }
    const selection = window.getSelection();
    const element = boxRef.current;
    if (
      selection !== null &&
      !selection.isCollapsed &&
      selection.anchorNode !== null &&
      element !== null &&
      element.contains(selection.anchorNode)
    ) {
      return false;
    }
    return true;
  };

  return (
    <div
      ref={boxRef}
      className={
        `turn__prompt${interactive ? ' turn__prompt--collapsible' : ''}` +
        `${expanded ? '' : ' turn__prompt--collapsed'}`
      }
      data-ev={testId}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-expanded': expanded,
            title: expanded
              ? 'Click anywhere outside this message to fold it again.'
              : 'Click to read the whole message.',
            onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
              pressedAt.current = { x: event.clientX, y: event.clientY };
            },
            onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
              // Only opening. A click inside an open message leaves it open: folding
              // the text someone is in the middle of reading, because they clicked
              // to put the caret somewhere, is the version of this that annoys.
              if (expanded || !wasAClick(event)) {
                return;
              }
              noteAnchor();
              setExpanded(true);
            },
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                noteAnchor();
                setExpanded((open) => !open);
              } else if (event.key === 'Escape' && expanded) {
                noteAnchor();
                setExpanded(false);
              }
            },
          }
        : {})}
    >
      {text}
    </div>
  );
}

function Turn({
  turn,
  index,
  active,
}: {
  readonly turn: TurnState;
  readonly index: number;
  readonly active: boolean;
}): JSX.Element {
  const badge =
    turn.status === 'finished'
      ? 'supported'
      : turn.status === 'streaming' || turn.status === 'awaiting-approval'
        ? 'unknown'
        : 'unsupported';
  return (
    <article
      className="turn"
      data-ev={`turn-${String(index)}`}
      /*
        The turn's state, readable without being drawn.

        A normal finished reply no longer carries a badge, and a scripted run still has
        to be able to establish how a turn ended — otherwise removing the furniture
        would also remove the evidence that the turn ended at all. An attribute is the
        window's existing way of saying that (`data-standing` beside a run does the
        same), and it is exactly what a badge nobody needs should have been in the
        first place: a fact about the turn, not a mark on the conversation.
      */
      data-status={turn.status}
    >
      {/*
        AC#2's honesty requirement, attached to the message it is about. The old
        chat being visible on screen is not evidence the model received it, so
        when DSpatch had to send a recap instead of resuming, the recap is shown
        here verbatim — the whole text, not a claim about it.
      */}
      {turn.resentContext !== null && (
        <details className="turn__resent" data-ev={`turn-${String(index)}-resent`}>
          <summary>
            This is a new provider session, so DSpatch put{' '}
            {String(turn.resentContext.length)} characters of recap in front of your
            message. Everything the model has of the earlier conversation is in here.
          </summary>
          <pre
            className="turn__answer"
            data-ev={`turn-${String(index)}-resent-text`}
          >
            {turn.resentContext}
          </pre>
          {/*
            Report 008 measured the gap this closes: Cursor's own transcript of the
            message showed 2 443 characters where this count said 2 260, because
            the provider wraps whatever it delivers in an envelope of its own. The
            count above is exact for DSpatch's text, which is the part DSpatch can
            answer for; saying so is cheaper than letting a reader discover it.
          */}
          <p className="app__note" data-ev={`turn-${String(index)}-resent-envelope`}>
            This is DSpatch&apos;s text, complete and exact. The provider adds an
            envelope of its own around every message it delivers — a timestamp and
            its own tags — so the model receives a little more than this, and none of
            the extra comes from DSpatch or from you.
          </p>
        </details>
      )}
      <UserMessage text={turn.prompt} testId={`turn-${String(index)}-prompt`} />
      {/*
        The reply, as Markdown, while it streams and afterwards (DSP-59 #2, #5).
        The element keeps its `data-ev` name and its text, so what the scripted runs
        sample as the answer grows is the same answer; what changed is that a
        heading is a heading rather than three hash characters.

        The two empty states stay plain text: they are DSpatch's own words about a
        turn, not the agent's, and running them through a Markdown reader would be
        pretending otherwise.
      */}
      {turn.answer === '' ? (
        <pre
          className="turn__answer"
          data-ev={active ? 'active-answer' : `turn-${String(index)}-answer`}
        >
          {active ? '…' : '(no text in this turn)'}
        </pre>
      ) : (
        <div
          className="turn__answer"
          data-ev={active ? 'active-answer' : `turn-${String(index)}-answer`}
        >
          <Markdown text={turn.answer} />
        </div>
      )}
      {/*
        The state of the turn stays in the column; the counting moves behind a
        disclosure. How many fragments a reply arrived in and how many tool calls
        finished are how DSpatch is debugged, not how a conversation is read, and
        they were taking a line under every ordinary answer. Nothing is deleted
        and every name a scripted run reads is unchanged — `textContent` reaches
        into a closed `details`.
      */}
      {/*
        A reply that ended normally with text carries no mark at all.

        The badge went from a row of its own to the disclosure's own line last pass,
        and that was still a mark under every single answer. Put the Cursor reference
        beside this window and the difference after each reply is a badge reading
        *finished* against nothing — and *finished* is what an answer being there
        already says. Niclas has decided this; the distinction that survives is the
        one worth having.

        **What stays visible is what someone may have to act on**: a turn that is
        streaming, waiting for an approval, cancelled or failed, and a reply that ended
        with no text. An empty reply reads exactly like a normal one otherwise — the
        thread shows a prompt and a blank — so it is marked, which is the whole of why
        marking every reply was not needed to achieve it.
      */}
      {(turn.status !== 'finished' || turn.answer === '') && (
        <p className="turn__meta">
          <span
            className={`badge badge--${badge}`}
            data-ev={active ? 'active-turn-status' : `turn-${String(index)}-status`}
          >
            {turn.status === 'finished'
              ? 'finished with no text'
              : TURN_STATUS_LABEL[turn.status]}
          </span>
        </p>
      )}
      {/*
        The disclosure itself, as a small quiet affordance rather than a labelled row.
        The words are unchanged — they say what is behind it, which a generic *Details*
        would not — and `turn__counts-summary--quiet` is what makes it read as furniture
        a reader can ignore.
      */}
      <details className="turn__counts">
        <summary className="turn__counts-summary turn__counts-summary--quiet">
          How this turn arrived
        </summary>
        <p className="turn__meta">
          <span data-ev={`turn-${String(index)}-deltas`}>
            {String(turn.deltaCount)} text fragments
          </span>{' '}
          ·{' '}
          <span data-ev={active ? 'active-tools-finished' : `turn-${String(index)}-tools`}>
            {String(turn.toolsFinished)}
          </span>{' '}
          of {String(turn.toolsStarted)} tool calls finished
          {turn.lastTool !== null && <> · last tool {turn.lastTool}</>} ·{' '}
          <span data-ev={`turn-${String(index)}-tokens`}>
            {turn.usage === null
              ? active
                ? 'tokens not reported yet'
                : 'tokens unknown'
              : turn.usage.totalTokens === null
                ? 'tokens unknown'
                : `${String(turn.usage.totalTokens)} tokens`}
          </span>{' '}
          · cost unknown
        </p>
      </details>
      {turn.cancelRequested && turn.status === 'streaming' && (
        <p className="pending">
          Cancellation requested. The run has not reported a terminal state yet.
        </p>
      )}
      {turn.lateEventsDropped > 0 && (
        <p className="app__note" data-ev={`turn-${String(index)}-late-events`}>
          {turn.lateEventsDropped} event
          {turn.lateEventsDropped === 1 ? '' : 's'} arrived for this run after a
          newer message superseded it and{' '}
          {turn.lateEventsDropped === 1 ? 'was' : 'were'} not applied:{' '}
          {Object.entries(turn.lateEventTypes)
            .map(([type, count]) => `${type} ×${String(count)}`)
            .join(', ')}
          . Last one {turn.lastLateEventAtUtc ?? 'unknown'}.
        </p>
      )}
      {turn.superseded && turn.status === 'streaming' && (
        <p className="app__error">
          This run never reported an end, and DSpatch stopped applying its events
          when the next message was sent. Whether it is still running on the
          provider&apos;s side is unknown.
        </p>
      )}
      {turn.approvalSummary !== null && (
        <p className="app__note">{turn.approvalSummary}</p>
      )}
      {turn.errorMessage !== null && (
        <p className="app__error" data-ev={`turn-${String(index)}-error`}>
          {turn.errorMessage}
        </p>
      )}
    </article>
  );
}

function Environment({
  environment,
  connection,
}: {
  readonly environment: EnvironmentInfo;
  readonly connection: ConnectionStatus;
}): JSX.Element {
  const { versions, adapter } = environment;

  return (
    <>
      <Section title="Runtime environment">
        <dl className="facts">
          <Fact label="Electron" value={versions.electron} />
          <Fact label="Chromium" value={versions.chromium} />
          <Fact label="Node" value={versions.node} />
          <Fact label="V8" value={versions.v8} />
          <Fact label="Platform" value={environment.platform} />
          <Fact
            label="Renderer loaded from"
            value={RENDERER_SOURCE_LABEL[environment.rendererSource]}
            testId="renderer-source"
          />
          <Fact label="App version" value={environment.appVersion} />
          <Fact
            label="Running as"
            value={
              environment.packaged
                ? 'a packaged application'
                : 'an unpackaged build from dist/'
            }
            testId="packaged"
          />
          {/*
            Which sources this build was made from. A packaged application is
            opaque, and the artifact this project shipped before this field existed
            turned out to predate DSP-4 with nothing on it to say so. The digest is
            reproducible: `node scripts/build-identity.mjs` on a working copy prints
            the same one if the sources match.
          */}
          <Fact
            label="Build identity"
            value={
              environment.build === null
                ? 'unknown — this build carries no manifest'
                : environment.build.error !== null
                  ? `unknown — ${environment.build.error}`
                  : `${environment.build.digest.slice(0, 16)} over ${String(
                      environment.build.fileCount,
                    )} source files, built ${environment.build.generatedAtUtc}` +
                    ` from git ${
                      environment.build.gitRevision?.slice(0, 7) ?? 'unknown'
                    }` +
                    (environment.build.gitDirtyFileCount === null
                      ? ' with an unknown number of uncommitted changes'
                      : environment.build.gitDirtyFileCount === 0
                        ? ' with nothing uncommitted'
                        : ` plus ${String(
                            environment.build.gitDirtyFileCount,
                          )} uncommitted changes`)
            }
            testId="build-identity"
          />
        </dl>
      </Section>

      <Section title={`Adapter — ${adapter.id}`}>
        <p className="app__note">
          The seven capabilities in the integration contract. These values apply to
          this adapter instance — provider plus transport — rather than to the
          provider in general.
        </p>
        <ul className="capabilities">
          {CAPABILITIES.map((capability) => {
            const support = adapter.capabilities[capability];
            return (
              <li key={capability} className="capabilities__row">
                <span className="capabilities__name">{CAPABILITY_LABEL[capability]}</span>
                <span
                  className={`badge badge--${support}`}
                  title={`capabilities().${capability} = "${support}"`}
                >
                  {SUPPORT_LABEL[support]}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="app__note">
          Three possible values:{' '}
          <span className="badge badge--supported">{SUPPORT_LABEL.supported}</span>{' '}
          <span className="badge badge--unsupported">{SUPPORT_LABEL.unsupported}</span>{' '}
          <span className="badge badge--unknown">{SUPPORT_LABEL.unknown}</span>. Unknown
          is a valid answer and is never presented as a positive result.
        </p>
        <p className="app__note">
          Usage and cost is <span className="badge badge--unknown">unknown</span> for a
          reason: per-turn token counts arrive on the run stream, while this
          account&apos;s cost API is refused with HTTP 403. Monetary cost is therefore
          shown as <strong>unknown</strong> everywhere and never as 0.
          {connection.kind === 'connected' &&
            connection.modelsAvailable === null &&
            ' The model list could not be read this time, so that field is unknown too.'}
        </p>
      </Section>
    </>
  );
}

function Fact({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
}): JSX.Element {
  return (
    <div className="facts__item">
      <dt className="facts__label">{label}</dt>
      <dd className="facts__value" {...(testId === undefined ? {} : { 'data-ev': testId })}>
        {value}
      </dd>
    </div>
  );
}
