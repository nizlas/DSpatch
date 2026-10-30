import {
  ANALYSIS_PERMISSIONS,
  assessAuthentication,
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  REVIEW_PERMISSIONS,
  type ClaudePermissionPolicy,
} from '../adapter/claude-agent-sdk-adapter';
import {
  COPILOT_ANALYSIS_POLICY,
  COPILOT_CHAT_POLICY,
  COPILOT_REVIEW_POLICY,
  CopilotSdkAdapter,
  type CopilotToolPolicy,
} from '../adapter/copilot-sdk-adapter';
import { CursorSdkAdapter, type ToolPolicy } from '../adapter/cursor-sdk-adapter';
import type { StoredSessionProvider } from '../shared/bridge';
import { LOOP_RUN_TOOL_POLICY } from '../shared/loop-graph';
import type { ChatAdapter } from './chat-service';
import {
  PresentationAdapter,
  PresentationResumeBehaviour,
  type PresentationSendMode,
} from './presentation-adapter';
import { providerAvailability, providerDisplayName } from './provider-availability';

/**
 * The one place a provider adapter is built (DSP-132, DSP-136, DSP-138), for the main
 * chat, the review discussion and the agent steps of a loop run.
 *
 * | purpose | Cursor | Claude |
 * | --- | --- | --- |
 * | \`chat\` | \`toolPolicy: 'provider-default'\` | \`CHAT_PERMISSIONS\` |
 * | \`review\` | \`toolPolicy: 'text-only'\` | \`REVIEW_PERMISSIONS\` (no tools, a deny-all hook) |
 * | \`analysis\` | refused (see below) | \`ANALYSIS_PERMISSIONS\` (Read, Glob, Grep in the revision folder) |
 * | \`loop\` | \`LOOP_RUN_TOOL_POLICY\` (\`'provider-default'\`) | \`CHAT_PERMISSIONS\`, exactly |
 *
 * A loop step under Claude has the main chat's permissions and nothing more: it can read
 * and change files and (DSP-146) run commands with Claude Code's own shell tools, which
 * DSpatch records through the SDK's hooks. The review discussion gets no tools. The
 * commands DSpatch itself runs for a gate node are not the agent's tools and are not
 * decided here.
 *
 * In presentation mode every adapter is SIMULATED: the chat's and the loop's from the
 * main process's own presentation options (the loop run used the same construction
 * before it came through here), the review's with **its own** presentation record, so
 * a simulated failure meant for one never reaches the other. An unavailable provider is
 * refused, with its reason, before anything is constructed - in presentation mode too,
 * so what can be chosen is the same.
 */
export type AdapterPurpose = 'chat' | 'review' | 'loop' | 'analysis';

/**
 * DSP-152: why Cursor does no analysis work. Its SDK adapter offers two tool policies, no
 * tools or the provider's default set (which writes files and runs commands), and no
 * read-only one DSpatch has verified; giving it the default set for analysis would give it
 * a mandate to change code, and giving it none would not be analysis. So it is refused,
 * with this reason, before anything is built.
 */
export const CURSOR_ANALYSIS_REFUSAL =
  "Cursor cannot be limited to reading files through DSpatch's Cursor connection, so it is not used for walks, delegated review or code questions. Choose Claude or Copilot.";

export interface AdapterRequest {
  readonly provider: StoredSessionProvider;
  readonly purpose: AdapterPurpose;
}

export interface ProviderAdaptersOptions {
  readonly presentation: boolean;
  /** The chat's presentation adapter (main.ts). Required in presentation mode. */
  readonly presentationChat?: () => ChatAdapter;
  /** The review's presentation adapters: stream speed and simulated send failures. */
  readonly reviewPresentation?: {
    readonly deltaMs?: number;
    readonly sendMode?: PresentationSendMode;
    /** DSP-152: a SIMULATED provider error every review session start is refused with. */
    readonly startFailure?: string;
  };
  /** The launch's \`DSPATCH_CLAUDE_AUTHORIZATION\`, or \`null\`. */
  readonly claudeAuthorizationReference: string | null;
  /** Whether Claude support was installed at launch (DSP-133). */
  readonly claudeInstalled: boolean;
  /** Whether Copilot's runtime is installed here (DSP-148). */
  readonly copilotInstalled?: boolean;
  /** `DSPATCH_COPILOT_REQUIRE_HOOKS`: refuse Copilot work unless managed hooks are in force. */
  readonly copilotRequireManagedHooks?: boolean;
  /** Where the Copilot adapter logs. */
  readonly log?: (message: string) => void;
  /**
   * The environment {@link ProviderAdapters.preflight} assesses for Claude, by variable
   * names only. Defaults to \`process.env\`, which is what a Claude adapter built here
   * assesses itself. A test seam.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Test seams: how the two real adapters are constructed. Production passes nothing.
   * The policy given is always the one this module chose for the purpose.
   */
  readonly construct?: {
    readonly cursor?: (toolPolicy: ToolPolicy) => ChatAdapter;
    readonly claude?: (permissions: ClaudePermissionPolicy) => ChatAdapter;
    readonly copilot?: (policy: CopilotToolPolicy) => ChatAdapter;
  };
}

export interface ProviderAdapters {
  /** Build an adapter for this provider and purpose, or throw why it cannot be. */
  createAdapter(request: AdapterRequest): ChatAdapter;
  /**
   * Why an adapter for this provider and purpose could not start work, or \`null\`
   * (DSP-138 A1). **Constructs nothing** and asks no provider anything: the same
   * availability rule {@link createAdapter} applies and, for Claude outside presentation
   * mode, the Claude adapter's own authentication rule over variable names. A failure the
   * adapter finds later, at session start, still lands where it happens.
   */
  preflight(request: AdapterRequest): string | null;
  /** The review adapters' presentation record, in presentation mode; \`null\` otherwise. */
  readonly reviewPresentationBehaviour: PresentationResumeBehaviour | null;
}

/** The Claude policy for a purpose. The review path can never receive the chat's. */
export function claudePermissionsFor(purpose: AdapterPurpose): ClaudePermissionPolicy {
  return purpose === 'review' ? REVIEW_PERMISSIONS : purpose === 'analysis' ? ANALYSIS_PERMISSIONS : CHAT_PERMISSIONS;
}

/** The Copilot policy for a purpose: as for Claude, review can never receive the chat's. */
export function copilotPolicyFor(purpose: AdapterPurpose): CopilotToolPolicy {
  return purpose === 'review' ? COPILOT_REVIEW_POLICY : purpose === 'analysis' ? COPILOT_ANALYSIS_POLICY : COPILOT_CHAT_POLICY;
}

/** The Cursor tool policy for a purpose. */
export function cursorToolPolicyFor(purpose: AdapterPurpose): ToolPolicy {
  // `analysis` is refused for Cursor before this is asked; were it asked, nothing is offered.
  if (purpose === 'review' || purpose === 'analysis') {
    return 'text-only';
  }
  return purpose === 'loop' ? LOOP_RUN_TOOL_POLICY : 'provider-default';
}

export function providerAdapters(options: ProviderAdaptersOptions): ProviderAdapters {
  const reviewBehaviour = options.presentation
    ? new PresentationResumeBehaviour('ok', options.reviewPresentation?.sendMode ?? 'ok')
    : null;
  if (reviewBehaviour !== null && options.reviewPresentation?.startFailure !== undefined) {
    reviewBehaviour.startFailure = options.reviewPresentation.startFailure;
  }
  const deltaMs = options.reviewPresentation?.deltaMs;
  const unavailable = (provider: StoredSessionProvider): string | null => {
    const availability = providerAvailability(provider, {
      claudeAuthorized: options.claudeAuthorizationReference !== null,
      claudeInstalled: options.claudeInstalled,
      ...(options.copilotInstalled === undefined ? {} : { copilotInstalled: options.copilotInstalled }),
    });
    return availability.choosable
      ? null
      : (availability.reason ?? `${providerDisplayName(provider)} cannot be used in this launch.`);
  };
  return {
    reviewPresentationBehaviour: reviewBehaviour,
    preflight: ({ provider, purpose }) => {
      const reason = unavailable(provider);
      if (reason === null && purpose === 'analysis' && provider === 'cursor') {
        return CURSOR_ANALYSIS_REFUSAL;
      }
      if (reason !== null || options.presentation || provider !== 'claude') {
        return reason;
      }
      const reference = options.claudeAuthorizationReference;
      if (reference === null) {
        return 'Claude is not enabled for this launch.';
      }
      // The rule the adapter applies at construction, with the reference it would be
      // given. Variable names only; nothing is kept.
      return assessAuthentication(
        options.env ?? process.env,
        { kind: 'subscription', authorization: reference },
        true,
      ).refusal;
    },
    createAdapter: ({ provider, purpose }) => {
      const reason = unavailable(provider);
      if (reason !== null) {
        throw new Error(reason);
      }
      if (purpose === 'analysis' && provider === 'cursor') {
        throw new Error(CURSOR_ANALYSIS_REFUSAL);
      }
      if (options.presentation) {
        if (purpose === 'review' || purpose === 'analysis') {
          // Which agent was asked for, so a trial can show it is the chosen one.
          reviewBehaviour?.recordBuilt(provider);
          return new PresentationAdapter({
            resume: reviewBehaviour ?? new PresentationResumeBehaviour('ok'),
            ...(deltaMs === undefined ? {} : { deltaMs }),
          });
        }
        if (options.presentationChat === undefined) {
          throw new Error('Presentation mode without a presentation chat adapter.');
        }
        return options.presentationChat();
      }
      if (provider === 'claude') {
        const permissions = claudePermissionsFor(purpose);
        if (options.construct?.claude !== undefined) {
          return options.construct.claude(permissions);
        }
        if (options.claudeAuthorizationReference === null) {
          throw new Error('Claude is not enabled for this launch.');
        }
        return new ClaudeAgentSdkAdapter({
          authorization: { kind: 'subscription', authorization: options.claudeAuthorizationReference },
          permissions,
        });
      }
      if (provider === 'copilot') {
        const policy = copilotPolicyFor(purpose);
        return options.construct?.copilot !== undefined
          ? options.construct.copilot(policy)
          : new CopilotSdkAdapter({
              policy,
              ...(options.copilotRequireManagedHooks === true ? { requireManagedHooks: true } : {}),
              ...(options.log === undefined ? {} : { log: options.log }),
            });
      }
      const toolPolicy = cursorToolPolicyFor(purpose);
      return options.construct?.cursor !== undefined
        ? options.construct.cursor(toolPolicy)
        : new CursorSdkAdapter({ toolPolicy });
    },
  };
}
