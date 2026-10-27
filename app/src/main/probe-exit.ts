/*
 * The connection probe's exit codes (DSP-1), in a module of their own so the client
 * can name them without loading the probe, which loads the Cursor SDK (DSP-111: agent
 * connections are the project host's).
 */

/** Exit codes. Distinct causes get distinct codes; 0–4 belong to the smoke test. */
export const PROBE_EXIT = {
  ok: 0,
  misconfigured: 10,
  notAuthenticated: 11,
  startSessionFailed: 12,
  firstTurnFailed: 13,
  streamingNotDemonstrated: 14,
  secondTurnFailed: 15,
  continuityNotProven: 16,
  usageReadFailed: 17,
  timedOut: 18,
  unexpectedError: 19,
} as const;
