import type { ProviderSetupState, StoredSessionProvider } from './bridge';

/**
 * What stands between a provider and a first message, and how to read a failure that names
 * such a thing (DSP-155). Used by the setup dialog and by the failure lines, so the two agree.
 */

export type SetupStep = 'consent' | 'install' | 'repair' | 'sign-in';

/**
 * The steps left, in order. An unknown sign-in (`null`) asks for nothing: it is checked when a
 * session is used. Copilot's runtime ships with DSpatch and its fetched CLI only signs in, so a
 * signed-in Copilot needs no fetched CLI.
 */
export function setupSteps(state: ProviderSetupState): readonly SetupStep[] {
  const steps: SetupStep[] = [];
  if (!state.consent) {
    steps.push('consent');
  }
  if (state.program !== 'ready' && (state.tool === 'claude' || state.signedIn === false)) {
    steps.push(state.program === 'absent' ? 'install' : 'repair');
  }
  if (state.signedIn === false) {
    steps.push('sign-in');
  }
  return steps;
}

export interface ProviderProblem {
  readonly provider: 'claude' | 'copilot';
  readonly kind: 'repair' | 'install' | 'sign-in';
}

/**
 * A failure that setup can actually resolve, by the sentences the adapters and the Claude
 * program use. A failure that is anything else answers `null`: a button that cannot help is
 * worse than none.
 */
export function providerProblem(message: string): ProviderProblem | null {
  if (message.includes('Claude support needs repair')) {
    return { provider: 'claude', kind: 'repair' };
  }
  if (/Claude support is not installed|Claude is not enabled for this launch/.test(message)) {
    return { provider: 'claude', kind: 'install' };
  }
  if (message.includes('Copilot is not signed in')) {
    return { provider: 'copilot', kind: 'sign-in' };
  }
  if (/Not logged in|Please run \/login|OAuth token has expired/i.test(message)) {
    return { provider: 'claude', kind: 'sign-in' };
  }
  return null;
}

/** One line for a problem setup can resolve. */
export function providerProblemText(problem: ProviderProblem): string {
  const name = providerName(problem.provider);
  return problem.kind === 'repair'
    ? `${name} support needs repair.`
    : problem.kind === 'install'
      ? `${name} needs to be set up.`
      : `${name} needs you to sign in.`;
}

export function providerProblemAction(problem: ProviderProblem): string {
  return problem.kind === 'repair' ? 'Repair' : problem.kind === 'install' ? 'Set up' : 'Sign in';
}

export function providerName(provider: StoredSessionProvider): string {
  return provider === 'claude' ? 'Claude' : provider === 'copilot' ? 'Copilot' : 'Cursor';
}
