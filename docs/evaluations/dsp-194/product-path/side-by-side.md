# The three profiles through the real provider flow: the texts side by side

Provider **copilot**, model **copilot-default**, instruction version 9. The synthetic connect case (base 96519f13a330, target e226601e33aa), the same two files at the same two revisions in every run. Three loop runs, one per profile, each with the planner's own plan; then on the Standard walk the reading profile switched to Essentials and to Teacher on the two steps, which made a step explanation through the step explanation channel. Generation path is named at every text.

## The runs

| Profile | Generation path | Started (UTC) | Duration | Walks / steps | Writer turns | Reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | the loop (planner, writer, reviewer) | 2026-11-10 17:12:25 | 3.1 min | 2 / 11 | 12 | 1: rework (1 finding(s)); 2: accept |
| Essentials (alternative of W1.1) | the step explanation channel, after the Standard walk | 2026-11-10 17:15:43 | v9, auto | – | – | – |
| Teacher (alternative of W1.1) | the step explanation channel, after the Standard walk | 2026-11-10 17:16:12 | v9, auto | – | – | – |
| Essentials (alternative of W1.6) | the step explanation channel, after the Standard walk | 2026-11-10 17:16:29 | v9, auto | – | – | – |
| Teacher (alternative of W1.6) | the step explanation channel, after the Standard walk | 2026-11-10 17:16:37 | v9, auto | – | – | – |

## The plans

### Standard run (job-05f3dbf8-3064-4c72-982e-be08b16f9d0e)

- **W1** How does a successful connection become a session-ready report?
  - W1.1 Register before connecting · src/session.ts 3–6 (target)
  - W1.2 Store the outcome handler · src/link.ts 13–14 (target)
  - W1.3 Await the transport · src/link.ts 17–21 (target)
  - W1.4 Read the transport contract · src/link.ts 1–3 (target)
  - W1.5 Return on a successful open · src/link.ts 22–24 (target)
  - W1.6 Schedule the settlement callback · src/link.ts 32–37 (target)
  - W1.7 Translate the outcome for the session · src/session.ts 4–5 (target)
- **W2** What happens when the link gives up?
  - W2.1 Take the failed-open branch · src/link.ts 22–29 (target)
  - W2.2 Schedule the gave-up callback · src/link.ts 32–37 (target)
  - W2.3 Report that the session will retry later · src/session.ts 6–8 (target)
  - W2.4 Report the deferred offline status · src/session.ts 4–5 (target)

Reviewer, visit 1: **rework**. The walks make the successful and give-up paths easy to follow, including the separate return and scheduled-callback reports. W1.4 overstates what the transport contract guarantees: it leaves the reader with an incomplete picture of how a request can end.
- W1.4: The step says the Promise<boolean> contract means connect awaits a true-or-false result for each request. It does not account for a rejected promise.

Reviewer, visit 2: **accept**. W1.4 now distinguishes a fulfilled true-or-false result from a rejected promise and explains what rejection does to the link and session. The walks otherwise let the Standard reader follow the successful and give-up paths, including the separate return and deferred callback reports; no significant shortcomings remain.

## The simple step: the registration in startSession

### Standard, written during the walk (the loop's writer; standard run, W1.1 Register before connecting)

Places: Session entry and connection request (src/session.ts 3–6, target)

`startSession` registers its outcome callback with `link.whenSettled` before calling and awaiting `link.connect`. That order matters: the handler is in place before the connection attempt can settle, while `await` separately lets `startSession` continue with the returned outcome. In the next step, `whenSettled` shows where the link keeps the handler.

### Essentials, made after the walk (the step explanation channel on the Standard walk's W1.1; status done, present)

`startSession` installs a handler before starting `connect`, so `Link` has a callback ready when the attempt settles. That handler reports “session ready” for `connected` and “offline mode” otherwise; the separate awaited result lets `startSession` report “retrying later” when it is `gave-up`. Unlike the base revision, which only awaited `connect`, this version also reports the eventual outcome. The next step shows where `Link` stores the handler (W1.2).

<!-- dspatch:details -->
The two reports use different paths: `connect` returns the outcome to the awaiting function, while `Link` schedules the registered callback rather than invoking it inline. So on a failed attempt, `startSession` reports “retrying later” from the returned outcome, and the callback reports “offline mode” when it runs; on success, the callback supplies the “session ready” report.

### Teacher, made after the walk (the step explanation channel on the Standard walk's W1.1; status done, present)

Here, `startSession` sets up a notification before asking `Link` to connect. Think of the notification and the returned result as two ways to hear about the same operation: the registered callback translates the settled outcome into a user-facing status, while `await` lets `startSession` handle the returned outcome. In the next step, `whenSettled` shows where `Link` keeps that callback (W1.2). This is new compared with the base revision, where `startSession` only awaited `connect`.

<!-- dspatch:details -->
`connect` returns either `connected` or `gave-up`; when it settles, `Link` schedules the registered callback with that outcome (W1.3, W1.6). Because the callback is scheduled rather than called inline, it is not what `await` waits for: `startSession` continues from the returned outcome, while the callback later reports “session ready” or “offline mode” (W1.7). If the result is `gave-up`, `startSession` also reports “retrying later” from its own path.

## The complex step: settle: the slot emptied and the callback deferred

### Standard, written during the walk (the loop's writer; standard run, W1.6 Schedule the settlement callback)

Places: Settlement and callback scheduling (src/link.ts 32–37, target)

After the successful branch calls `settle('connected')` (W1.5), `settle` takes the callback from `onSettled` and clears the field before scheduling it with `setTimeout`. This prevents that stored handler from being reused by another settlement; when present, it runs later with the outcome, not inline during `connect`. The next step returns to `startSession` to show what its handler reports.

### Essentials, made after the walk (the step explanation channel on the Standard walk's W1.6; status done, present)

After the successful-open branch calls `settle` (W1.5), this code consumes the currently registered handler and, if one exists, schedules it with the outcome instead of running it inside `connect`. That lets the connection path proceed without invoking the session’s reporting logic inline. In the next step, `startSession` shows how the handler translates the outcome into a report (W1.7).

<!-- dspatch:details -->
Clearing `onSettled` before scheduling means a later settlement will not reuse this same registration; a newly registered handler could still be stored before then. If no handler is registered, `settle` schedules nothing.

### Teacher, made after the walk (the step explanation channel on the Standard walk's W1.6; status done, present)

`settle` is reached after `Link` has an outcome (W1.5). It takes the registered callback out of `onSettled` and, if one was registered, asks `setTimeout` to run it asynchronously with that outcome. That means the callback is not invoked inline as part of `settle`; `connect` can return its outcome independently. In the next step, `startSession` shows what the callback reports (W1.7).

<!-- dspatch:details -->
The local `callback` keeps the handler available after `onSettled` is cleared, so this registration is consumed rather than left for a later settlement to reuse. A zero-millisecond timer is not an immediate call or a guarantee of an exact run time: it schedules the callback for later, and this code does not wait for it to finish. If there is no registered callback, nothing is scheduled. In the base revision, `Link` simply returned the transport’s boolean result and had no settlement callback path.

## The loop runs' own summaries

### Standard

```json
{
  "runId": "walk-c2330972-730b-4d92-ae24-f4aa596b82ec",
  "graphId": "dspatch-walk-loop",
  "graphVersionId": "graph-8e84007492c1b56f",
  "roles": [
    {
      "id": "walk-planner",
      "sourcePath": "docs/loop/roles/review/walk-planner.role.md"
    },
    {
      "id": "walk-writer",
      "sourcePath": "docs/loop/roles/review/walk-writer.role.md"
    },
    {
      "id": "walk-reviewer",
      "sourcePath": "docs/loop/roles/review/walk-reviewer.role.md"
    }
  ],
  "recordPath": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-qVvgJ7\\reviews\\generated\\r-7cc26aa4e9ea48e5d9626690\\job-05f3dbf8-3064-4c72-982e-be08b16f9d0e.walk-loop\\record.jsonl",
  "resultsDir": "<home>\\AppData\\Local\\Temp\\dspatch-profile-real-qVvgJ7\\reviews\\generated\\r-7cc26aa4e9ea48e5d9626690\\job-05f3dbf8-3064-4c72-982e-be08b16f9d0e.walk-loop\\results",
  "status": "delivered",
  "path": [
    "plan",
    "write",
    "review",
    "write",
    "review",
    "delivered"
  ],
  "first": {
    "assessment": "The walks make the successful and give-up paths easy to follow, including the separate return and scheduled-callback reports. W1.4 overstates what the transport contract guarantees: it leaves the reader with an incomplete picture of how a request can end.",
    "verdict": "rework",
    "findings": [
      {
        "kind": "explanation",
        "steps": [
          "W1.4"
        ],
        "problem": "The step says the Promise<boolean> contract means connect awaits a true-or-false result for each request. It does not account for a rejected promise.",
        "why": "The reader may infer that every unsuccessful request follows the false-result retry path. A rejection takes a different path and does not settle the link.",
        "evidence": "In src/link.ts (target), lines 1–3 type open as Promise<boolean>, but line 21 awaits it without handling rejection. If it rejects, connect exits before the branch, retry, or settle calls at lines 22–29; startSession's await at src/session.ts (target), line 5 rejects, and its registered callback is not invoked.",
        "reference": "Standard: keep the stated behavior accurate so the reader can follow the mechanism."
      }
    ]
  },
  "final": {
    "assessment": "W1.4 now distinguishes a fulfilled true-or-false result from a rejected promise and explains what rejection does to the link and session. The walks otherwise let the Standard reader follow the successful and give-up paths, including the separate return and deferred callback reports; no significant shortcomings remain.",
    "verdict": "accept",
    "findings": []
  },
  "rounds": 1,
  "replanned": false,
  "rewritten": [
    "W1.4"
  ],
  "turns": [
    {
      "node": "plan",
      "occurrence": 1,
      "startedAt": "2026-11-10T17:12:25.878Z",
      "endedAt": "2026-11-10T17:13:31.030Z",
      "durationMs": 65152
    },
    {
      "node": "plan",
      "occurrence": 1,
      "startedAt": "2026-11-10T17:13:31.567Z",
      "endedAt": "2026-11-10T17:13:51.004Z",
      "durationMs": 19437
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.1",
      "startedAt": "2026-11-10T17:13:51.824Z",
      "endedAt": "2026-11-10T17:14:06.958Z",
      "durationMs": 15134
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.2",
      "startedAt": "2026-11-10T17:14:06.972Z",
      "endedAt": "2026-11-10T17:14:11.627Z",
      "durationMs": 4655
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.3",
      "startedAt": "2026-11-10T17:14:11.640Z",
      "endedAt": "2026-11-10T17:14:14.796Z",
      "durationMs": 3156
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.4",
      "startedAt": "2026-11-10T17:14:14.809Z",
      "endedAt": "2026-11-10T17:14:17.916Z",
      "durationMs": 3107
    },
    {
      "node": "write",
      "occurrence": 1,
      "stepId": "W1.5",
      "startedAt": "2026-11-10T17:14:17.931Z",
      "endedAt":
```

