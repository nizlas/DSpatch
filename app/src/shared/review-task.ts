/**
 * The header every review task prompt starts with, so a simulated agent can tell them apart:
 * the analysis tasks (`review-agent.ts`) and a discussion question that can read the code
 * (`review-discussion.ts`). Its own module so the discussion needs nothing of the analysis prompts.
 */
export const TASK_HEADER = 'DSPATCH-REVIEW-TASK:';
