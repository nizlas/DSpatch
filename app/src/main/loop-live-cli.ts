/**
 * The command line's live loop run (`npm run loop:live`), and the only place a loop run
 * constructs Cursor's adapter itself.
 *
 * **The command line runs loops with Cursor only** (DSP-138). The window's runs go
 * through the explicit agent choice and the shared adapter factory; this module is kept
 * apart so the product's run path (`loop-live-run.ts`) imports no provider adapter. A
 * Claude run from the command line is not offered here.
 */

import fs from 'node:fs';

import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import { LOOP_RUN_TOOL_POLICY } from '../shared/loop-graph';
import { createFileRoleResolver } from './loop-graph-roles';
import { runLiveGraph, type LiveCliDelivery, type LiveCliOptions } from './loop-live-run';

/** What the command line says about the agent, printed with every live run. */
export const CLI_LOOP_AGENT_NOTE =
  'The command line runs loops with Cursor only; the window runs them with the chosen agent.';

export function runLiveLoop(
  options: Omit<LiveCliOptions, 'provider' | 'createAdapter'>,
): Promise<LiveCliDelivery> {
  const graphText = fs.readFileSync(options.graphPath, 'utf8');
  const loaded = loadLoopGraph(graphText, {
    resolveRole: createFileRoleResolver(options.repoRoot),
    connectedTargets: ['cursor'],
  });
  if (!loaded.ok) {
    throw new Error(
      `${options.graphPath} does not validate, so it was not run:\n\n${formatFindings(loaded.findings)}`,
    );
  }
  return runLiveGraph(loaded.graph, {
    ...options,
    provider: 'cursor',
    // The policy is a named constant beside the capability table, so the node panel
    // states what a step may do by reading the value the adapter is given (DSP-94, F6).
    createAdapter: () => new CursorSdkAdapter({ toolPolicy: LOOP_RUN_TOOL_POLICY }),
  });
}
