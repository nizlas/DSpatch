import { claudeUnavailableReason } from '../adapter/claude-support';
import type { StoredSessionProvider } from '../shared/bridge';

/**
 * Whether a provider can be chosen, and why not (DSP-136).
 *
 * The one place that answers it, for the main chat's agent choice and later for
 * the review discussion. Nothing here builds an adapter, reads a credential or
 * asks a provider anything:
 *
 * - **Claude** is choosable when this launch carries `DSPATCH_CLAUDE_AUTHORIZATION`
 *   **and** Claude support is installed (DSP-133). Each missing part is named.
 * - **Cursor** is always choosable. Its login is checked only when a Cursor session
 *   is actually used: a session started without one fails at start with Cursor's
 *   own message, and nothing is sent. No feature assumes a working Cursor login.
 * - **Copilot** is choosable when its runtime is installed here. Like Cursor's, its login
 *   is checked when a session is used, with a sentence saying where to sign in (DSP-148).
 */
export interface ProviderAvailability {
  readonly provider: StoredSessionProvider;
  readonly choosable: boolean;
  /** Why it cannot be chosen, in plain words; `null` when it can. */
  readonly reason: string | null;
}

export interface ProviderAvailabilityInput {
  /** Whether the launch carries a Claude authorization reference. */
  readonly claudeAuthorized: boolean;
  /** Whether Claude support was installed at launch. */
  readonly claudeInstalled: boolean;
  /** Whether this machine has Copilot's runtime (DSP-148). Absent counts as not. */
  readonly copilotInstalled?: boolean;
}

/**
 * The model a Claude session asks for, in the main chat (DSP-117) and in a loop run
 * (DSP-138). By name: the Claude adapter has no model list, so the window names the
 * model rather than offering a choice.
 */
export const CLAUDE_CHAT_MODEL = 'claude-haiku-4-5';

/** The sentence beside Cursor wherever its login matters. */
export const CURSOR_LOGIN_NOTE =
  "Cursor's login is checked only when a Cursor session is used; DSpatch does not " +
  'check it on its own.';

/** Copilot's login is the runtime's, on the machine where the work runs (DSP-148). */
export const COPILOT_NOT_INSTALLED_TEXT = "Copilot's runtime is missing from this installation of DSpatch. Reinstall DSpatch to use Copilot.";

export function providerAvailability(
  provider: StoredSessionProvider,
  input: ProviderAvailabilityInput,
): ProviderAvailability {
  if (provider === 'cursor') {
    return { provider, choosable: true, reason: null };
  }
  if (provider === 'copilot') {
    return input.copilotInstalled === true
      ? { provider, choosable: true, reason: null }
      : { provider, choosable: false, reason: COPILOT_NOT_INSTALLED_TEXT };
  }
  const reason = claudeUnavailableReason({
    authorized: input.claudeAuthorized,
    installed: input.claudeInstalled,
  });
  return { provider, choosable: reason === null, reason };
}

/** The display name of a provider. */
export function providerDisplayName(provider: StoredSessionProvider): string {
  return provider === 'claude' ? 'Claude' : provider === 'copilot' ? 'Copilot' : 'Cursor';
}
