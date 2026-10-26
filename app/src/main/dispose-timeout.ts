/**
 * How long shutdown waits for the chat's adapter to let go before leaving anyway.
 *
 * The provider path owns a local agent runtime and an on-disk store, and closing
 * those is worth waiting for, but only waiting. Since DSP-117 the chat can hold a
 * Claude adapter, whose own disposal is bounded by {@link DISPOSE_BOUND_MS} (wait
 * for the process to exit, then kill it and wait again). The shutdown wait is
 * derived from that bound plus a margin, so a Claude disposal that uses its whole
 * bound is not cut short by the window closing first. The result is the 8 s the
 * wait has been since DSP-62, now with a reason rather than a coincidence.
 *
 * Its own module, without Electron, so a test can pin the relation.
 */

import { DISPOSE_BOUND_MS } from '../adapter/claude-agent-sdk-adapter';

/** Time after the adapter's own bound for the service to save and close. */
export const DISPOSE_MARGIN_MS = 1_000;

export const DISPOSE_TIMEOUT_MS = DISPOSE_BOUND_MS + DISPOSE_MARGIN_MS;
