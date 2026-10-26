import {
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  REVIEW_PERMISSIONS,
  type ClaudePermissionPolicy,
} from '../adapter/claude-agent-sdk-adapter';
import { CursorSdkAdapter, type ToolPolicy } from '../adapter/cursor-sdk-adapter';
import type { StoredSessionProvider } from '../shared/bridge';
import type { ChatAdapter } from './chat-service';
import {
  PresentationAdapter,
  PresentationResumeBehaviour,
  type PresentationSendMode,
} from './presentation-adapter';
import { providerAvailability, providerDisplayName } from './provider-availability';

/**
 * The one place a provider adapter is built (DSP-132, DSP-136), for the main chat and
 * the review discussion alike.
 *
 * | purpose | Cursor | Claude |
 * | --- | --- | --- |
 * | \`chat\` | \`toolPolicy: 'provider-default'\` | \`CHAT_PERMISSIONS\` |
 * | \`review\` | \`toolPolicy: 'text-only'\` | \`REVIEW_PERMISSIONS\` (no tools, a deny-all hook) |
 *
 * In presentation mode every adapter is SIMULATED: the chat's from the main process's
 * own presentation options, the review's with **its own** presentation record, so a
 * simulated failure meant for one never reaches the other. An unavailable provider is
 * refused, with its reason, before anything is constructed - in presentation mode too,
 * so what can be chosen is the same.
 */
export type AdapterPurpose = 'chat' | 'review';

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
   * Test seams: how the two real adapters are constructed. Production passes nothing.
   * The policy given is always the one this module chose for the purpose.
   */
  readonly construct?: {
    readonly cursor?: (toolPolicy: ToolPolicy) => ChatAdapter;
    readonly claude?: (permissions: ClaudePermissionPolicy) => ChatAdapter;
  };
}

export interface ProviderAdapters {
  /** Build an adapter for this provider and purpose, or throw why it cannot be. */
  createAdapter(request: AdapterRequest): ChatAdapter;
  /** The review adapters' presentation record, in presentation mode; \`null\` otherwise. */
  readonly reviewPresentationBehaviour: PresentationResumeBehaviour | null;
}

/** The Claude policy for a purpose. The review path can never receive the chat's. */
export function claudePermissionsFor(purpose: AdapterPurpose): ClaudePermissionPolicy {
  return purpose === 'review' ? REVIEW_PERMISSIONS : CHAT_PERMISSIONS;
}

/** The Cursor tool policy for a purpose. */
export function cursorToolPolicyFor(purpose: AdapterPurpose): ToolPolicy {
  return purpose === 'review' ? 'text-only' : 'provider-default';
}

export function providerAdapters(options: ProviderAdaptersOptions): ProviderAdapters {
  const reviewBehaviour = options.presentation
    ? new PresentationResumeBehaviour('ok', options.reviewPresentation?.sendMode ?? 'ok')
    : null;
  const deltaMs = options.reviewPresentation?.deltaMs;
  return {
    reviewPresentationBehaviour: reviewBehaviour,
    createAdapter: ({ provider, purpose }) => {
      const availability = providerAvailability(provider, {
        claudeAuthorized: options.claudeAuthorizationReference !== null,
        claudeInstalled: options.claudeInstalled,
      });
      if (!availability.choosable) {
        throw new Error(
          availability.reason ?? `${providerDisplayName(provider)} cannot be used in this launch.`,
        );
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
      const toolPolicy = cursorToolPolicyFor(purpose);
      return options.construct?.cursor !== undefined
        ? options.construct.cursor(toolPolicy)
        : new CursorSdkAdapter({ toolPolicy });
    },
  };
}
