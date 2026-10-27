import {
  assessAuthentication,
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  REVIEW_PERMISSIONS,
  type ClaudePermissionPolicy,
} from '../adapter/claude-agent-sdk-adapter';
import type { AgentCommandRunner } from '../adapter/agent-adapter';
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
import { createAgentCommandRunner } from './workspace-command';

/**
 * The one place a provider adapter is built (DSP-132, DSP-136, DSP-138), for the main
 * chat, the review discussion and the agent steps of a loop run.
 *
 * | purpose | Cursor | Claude |
 * | --- | --- | --- |
 * | \`chat\` | \`toolPolicy: 'provider-default'\` | \`CHAT_PERMISSIONS\` |
 * | \`review\` | \`toolPolicy: 'text-only'\` | \`REVIEW_PERMISSIONS\` (no tools, a deny-all hook) |
 * | \`loop\` | \`LOOP_RUN_TOOL_POLICY\` (\`'provider-default'\`) | \`CHAT_PERMISSIONS\`, exactly |
 *
 * A loop step under Claude has the main chat's permissions and nothing more: it can read
 * and change files, and (DSP-145) run commands through DSpatch's command tool. The chat
 * and the loop get DSpatch's command runner ({@link commandRunnerFor}); the review never
 * does, and the Claude adapter refuses a runner with the review's policy as well. The
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
export type AdapterPurpose = 'chat' | 'review' | 'loop';

export interface AdapterRequest {
  readonly provider: StoredSessionProvider;
  readonly purpose: AdapterPurpose;
}

export interface ProviderAdaptersOptions {
  readonly presentation: boolean;
  /** The chat's presentation adapter (main.ts). Required in presentation mode. */
  readonly presentationChat?: () => ChatAdapter;
  /** The review's presentation adapters: stream speed and simulated send failures. */
  readonly reviewPresentation?: { readonly deltaMs?: number; readonly sendMode?: PresentationSendMode };
  /** The launch's \`DSPATCH_CLAUDE_AUTHORIZATION\`, or \`null\`. */
  readonly claudeAuthorizationReference: string | null;
  /** Whether Claude support was installed at launch (DSP-133). */
  readonly claudeInstalled: boolean;
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
    /** `commandRunner` is DSpatch's runner for chat and loop, `undefined` for review. */
    readonly claude?: (
      permissions: ClaudePermissionPolicy,
      commandRunner: AgentCommandRunner | undefined,
    ) => ChatAdapter;
  };
  /**
   * DSP-145: how DSpatch's command runner is made for a chat or loop adapter. Defaults to
   * {@link createAgentCommandRunner}. A test seam; never called for the review.
   */
  readonly commandRunner?: () => AgentCommandRunner;
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
  return purpose === 'review' ? REVIEW_PERMISSIONS : CHAT_PERMISSIONS;
}

/**
 * DSP-145: whether an adapter for this purpose is given DSpatch's command runner. The
 * chat and loop steps are; the review discussion never is.
 */
export function commandRunnerFor(purpose: AdapterPurpose): boolean {
  return purpose === 'chat' || purpose === 'loop';
}

/** The Cursor tool policy for a purpose. */
export function cursorToolPolicyFor(purpose: AdapterPurpose): ToolPolicy {
  if (purpose === 'review') {
    return 'text-only';
  }
  return purpose === 'loop' ? LOOP_RUN_TOOL_POLICY : 'provider-default';
}

export function providerAdapters(options: ProviderAdaptersOptions): ProviderAdapters {
  const reviewBehaviour = options.presentation
    ? new PresentationResumeBehaviour('ok', options.reviewPresentation?.sendMode ?? 'ok')
    : null;
  const deltaMs = options.reviewPresentation?.deltaMs;
  const unavailable = (provider: StoredSessionProvider): string | null => {
    const availability = providerAvailability(provider, {
      claudeAuthorized: options.claudeAuthorizationReference !== null,
      claudeInstalled: options.claudeInstalled,
    });
    return availability.choosable
      ? null
      : (availability.reason ?? `${providerDisplayName(provider)} cannot be used in this launch.`);
  };
  return {
    reviewPresentationBehaviour: reviewBehaviour,
    preflight: ({ provider }) => {
      const reason = unavailable(provider);
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
      if (options.presentation) {
        if (purpose === 'review') {
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
        // A loop step's executor snapshots the folders around each command itself, so its
        // runner does not hash them again (review I2); the chat's runner does.
        const commandRunner = commandRunnerFor(purpose)
          ? (options.commandRunner ?? (() => createAgentCommandRunner({ snapshots: purpose === 'chat' })))()
          : undefined;
        if (options.construct?.claude !== undefined) {
          return options.construct.claude(permissions, commandRunner);
        }
        if (options.claudeAuthorizationReference === null) {
          throw new Error('Claude is not enabled for this launch.');
        }
        return new ClaudeAgentSdkAdapter({
          authorization: { kind: 'subscription', authorization: options.claudeAuthorizationReference },
          permissions,
          ...(commandRunner === undefined ? {} : { commandRunner }),
        });
      }
      const toolPolicy = cursorToolPolicyFor(purpose);
      return options.construct?.cursor !== undefined
        ? options.construct.cursor(toolPolicy)
        : new CursorSdkAdapter({ toolPolicy });
    },
  };
}
