/**
 * The pass/fail rules of the scripted workflow run, separated from the DOM.
 *
 * They live here for one reason: a gate that cannot fail is not evidence, and the
 * only way to show that a gate *can* fail is to feed it a counter-example. That is
 * impossible while the rule is welded to a live window and a billed provider turn.
 * `workflow-script.ts` reads the document and calls these functions; `tests/`
 * calls the same functions with hand-made observations. There is no second copy of
 * a rule anywhere.
 *
 * Nothing here may take, return or record an account address. The gates work on
 * presence and shape.
 */

/**
 * The window renders `…` in the answer element while a turn streams with no text
 * yet, so every streaming turn produces one 1-character sample before any text
 * arrives. A sample at or below this length says nothing about the answer.
 */
export const PLACEHOLDER_ANSWER_CHARS = 1;

export interface StreamingSample {
  /** Milliseconds after the send, as sampled by the script. */
  readonly atMs: number;
  readonly answerChars: number;
}

export interface StreamingGateVerdict {
  /** Samples that carry actual answer text rather than the placeholder. */
  readonly substantiveSampleCount: number;
  readonly distinctSubstantiveAnswerLengths: number;
  readonly distinctSubstantiveSampleTimes: number;
  readonly grewBetweenSubstantiveSamples: boolean;
  /** Non-null means the gate rejects the observation, and says why. */
  readonly failure: string | null;
}

/**
 * Did the answer visibly grow *in text* while the turn was still streaming?
 *
 * The rule counts only samples longer than the placeholder and requires at least
 * two distinct such lengths at two distinct times. That is what separates
 * incremental rendering from a buffered replay: a single delivery of the whole
 * answer yields exactly one substantive length, however long it is, whereas
 * incremental rendering yields a length strictly between empty and final.
 */
export function checkAnswerGrewWhileStreaming(
  samplesWhileStreaming: readonly StreamingSample[],
): StreamingGateVerdict {
  const substantive = samplesWhileStreaming.filter(
    (sample) => sample.answerChars > PLACEHOLDER_ANSWER_CHARS,
  );
  const distinctLengths = new Set(substantive.map((sample) => sample.answerChars)).size;
  const distinctTimes = new Set(substantive.map((sample) => sample.atMs)).size;
  const grew = substantive.some(
    (sample, at) => at > 0 && sample.answerChars > (substantive[at - 1]?.answerChars ?? 0),
  );

  let failure: string | null = null;
  if (distinctLengths < 2 || distinctTimes < 2 || !grew) {
    failure =
      'the answer did not visibly grow in the window while the turn was still ' +
      `streaming: ${String(substantive.length)} samples longer than the ` +
      `${String(PLACEHOLDER_ANSWER_CHARS)}-character placeholder, ` +
      `${String(distinctLengths)} distinct lengths at ${String(distinctTimes)} ` +
      'distinct times. A single delivery of the whole answer looks exactly like ' +
      'this, so incremental rendering is not established.';
  }

  return {
    substantiveSampleCount: substantive.length,
    distinctSubstantiveAnswerLengths: distinctLengths,
    distinctSubstantiveSampleTimes: distinctTimes,
    grewBetweenSubstantiveSamples: grew,
    failure,
  };
}

/**
 * What the connection panel said, reduced to shape.
 *
 * `accountCharacters` and `accountLooksLikeAnAddress` are derived by the caller
 * from the DOM text; the text itself is deliberately not a parameter, so no gate
 * or failure message can leak it.
 */
export interface ConnectionShape {
  readonly connectionKind: string;
  readonly accountCharacters: number;
  readonly accountLooksLikeAnAddress: boolean;
  readonly accountSaysUnknown: boolean;
}

export interface ConnectionGateVerdict {
  readonly failure: string | null;
}

/** The shortest thing that could be an address at all: `a@b`. */
const MIN_ACCOUNT_CHARACTERS = 3;

/**
 * Did the window report a live connection **and name an account**?
 *
 * The criterion has always been both halves. Until this gate existed only the
 * first half was enforced, so an empty or `unknown` account field passed.
 */
export function checkConnectionNamesAnAccount(
  shape: ConnectionShape,
): ConnectionGateVerdict {
  if (shape.connectionKind !== 'connected') {
    return {
      failure:
        `the window reported the connection as "${shape.connectionKind}", so the ` +
        'workflow could not be exercised',
    };
  }
  if (shape.accountCharacters === 0) {
    return {
      failure:
        'the window reported the connection as connected but named no account, so ' +
        'the criterion "connection status with the account named" is not met',
    };
  }
  if (shape.accountSaysUnknown) {
    return {
      failure:
        'the window reported the connection as connected but the account field says ' +
        'unknown, so no account was named',
    };
  }
  if (!shape.accountLooksLikeAnAddress || shape.accountCharacters < MIN_ACCOUNT_CHARACTERS) {
    return {
      failure:
        'the window reported the connection as connected but the account field is ' +
        `not address-shaped: ${String(shape.accountCharacters)} characters, ` +
        `contains an at sign: ${String(shape.accountLooksLikeAnAddress)}. The value ` +
        'itself is deliberately not reported.',
    };
  }
  return { failure: null };
}
