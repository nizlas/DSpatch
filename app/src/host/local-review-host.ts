import {
  REVIEW_HOST_METHODS,
  type ReviewHostApi,
  type ReviewHostError,
} from '../shared/review-host-contract';

/*
 * The local binding of the review host (DSP-111): the same `ReviewHostApi`, in the
 * same process, as a transport would give it.
 *
 * Arguments and answers are passed through `structuredClone`, so the client and the
 * host never share a reference: what the client holds after a call is a copy, as it
 * would be after a trip over a wire, and a value that could not be cloned fails here
 * rather than only once there is a transport. A method that throws anyway (the host
 * itself never should) is answered as `internal`, so the client's side of the
 * contract holds the same promise: every call answers.
 */

function bindingError(method: string, error: unknown): ReviewHostError {
  return {
    kind: 'host-error',
    code: 'internal',
    message: `The review host could not answer (${method}).`,
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function localReviewHost(host: ReviewHostApi): ReviewHostApi {
  const bound: Record<string, (request?: unknown) => Promise<unknown>> = {};
  for (const method of REVIEW_HOST_METHODS) {
    const call = host[method] as (request?: unknown) => Promise<unknown>;
    bound[method] = async (request?: unknown): Promise<unknown> => {
      try {
        const answer = await call.call(host, request === undefined ? undefined : structuredClone(request));
        return structuredClone(answer);
      } catch (error) {
        return bindingError(method, error);
      }
    };
  }
  return bound as unknown as ReviewHostApi;
}
