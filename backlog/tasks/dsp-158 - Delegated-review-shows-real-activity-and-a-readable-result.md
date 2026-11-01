---
id: DSP-158
title: Delegated review shows real activity and a readable result
status: Review
assignee: []
created_date: '2026-11-01'
labels: [review]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While a delegated review runs, show one short activity line from real provider events (Claude and Copilot, local and remote), with no invented phases, estimates or raw tool logs, and no stale or doubled status after Stop, failure, end or reconnect. When the result arrives, lead with a short summary of what was approved and what remains, list findings separately with a heading and a short explanation, gather repeats, fold longer reasoning and code references, and keep partial approval apart from approval of the whole scope. Underlying results, evidence, review decisions and the approval rules are unchanged. Older saved results still open.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 1 November 2026 as part of the pass towards the first non-prerelease. Implemented the same day; awaiting independent verification and Niclas's judgement of how it reads.

Governing: docs/INTERACTION_MODEL.md, docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md (DSpatch's instructions are visible and inspectable), docs/REVIEW_COVERAGE_AND_CODE_WALKS.md, the code-walks plan section 5 (delegation).

**Activity.** Delegated review already used the job activity line (`AgentJob.activity`, carried in the pair record through `REVIEW_PAIR_CHANGED`), so that is what was kept; no second mechanism. Fixed in it: `toolActivity` no longer says "Searching the code" for a tool that neither reads nor searches, nor for a Read without a path; a line naming a finished tool becomes "Waiting for the agent…" three seconds after its last tool ended, unless something newer is reported; "Writing finding N" comes from the answer so far; the end of a successful review now drops the activity and its timers, as every other end did; a stop drops the line at once. Copilot's `view`, `glob` and `grep` reach this as Read, Glob and Grep through the adapter's display names. While a remote host cannot be reached the line is hidden, since the host line above the window says how things stand is unknown.

**Remote path, by reading the code; not exercised over a real transport.** The job runs on the host and writes the record; `ReviewPairs.changed` emits a `review-pair` event, `host-server` posts every event, and the client forwards it to `windowsOverPair`. A window opened later reads the record, with the line in it, and joins the pair. A resumed connection replays events; one that cannot resume reloads the review windows, which read the host's state. `reconcile` marks a job this host does not hold as unknown.

**Result.** Structured, not only parsed: the job's answer had one free `text` per finding, so the answer format gained optional `summary`, finding `title` and `details`, and `text` now asks for the problem and what it leads to. Old results have none of these: `shared/delegated-review-view.ts` then heads a finding with its first sentence and opens with the start of the assessment. That module is pure and reads only: whole, partial or nothing approved comes from the checked ranges against the changed lines in scope, never from the agent's words, and a part is never called whole when the changed lines are not known. Repeats are gathered by heading or text, ignoring case, spacing and numbers; a differently worded repeat stays under Show more. `readReviewAnswer`'s approval rules are unchanged apart from reading the new optional fields.

**Instruction.** `reviewInstruction` is the mandate and answer format of `reviewPrompt`; it is recorded on the job (`AgentJob.instruction`, optional) before sending and readable in the result under "What the agent was told".

**Where it shows.** `AgentReviewResult` is now used in the file view, for the whole change in the file list, and in the walk window; while running it is the one job line, where the file view used to show a second status above it. In a file view only the newest result is open.

**Checked (own checks, SIMULATED provider, isolated user data):** `npm run typecheck`; `npm run test:review` 199 passed; `copilot-review-jobs`, `copilot-review-questions` and `turn-routing` 21 passed; scenario `code-walks` exit 0 in real Electron windows under Xvfb; the same scenario with `DSPATCH_REVIEW_SIM=rich-review` for the screenshot of a partial approval with several findings and a repeat (its two scenario failures are that mode's extra findings and its lack of the repair round, as expected).

**Not verified:** a real Claude or Copilot run, so whether real models fill the new fields well is unknown; the remote path over a real transport; the activity line of a review job seen in a window (host events tested; rendering is `JobLine`, unchanged); the result in the walk window and the file list seen by eye (the walk path ran in the scenario, the file-list path did not).
<!-- SECTION:NOTES:END -->
