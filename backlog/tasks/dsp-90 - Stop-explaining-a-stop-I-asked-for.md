---
id: DSP-90
title: Stop explaining a stop I asked for
status: Review
assignee: []
created_date: '2026-09-22 00:36'
updated_date: '2026-09-22 01:13'
labels: []
dependencies:
  - DSP-87
priority: high
type: bug
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's third pass over the chat's status text, 22 September, finishing what DSP-87 began. DSP-87 removed the four standing paragraphs for a run that is WORKING; the same disclosure survives for every other run state and he has now met it. At his own cancellation the window showed 'stopped short' followed by a long passage of internal definitions and recovery rules, and 'Where this run stands, and what it left behind' is still there. REMOVE that dropdown and its general explanations for ALL run states, not only the working one. At a confirmed stop that he asked for himself, the status marking is enough: no explanatory standard text afterwards. Show further text ONLY when he needs to act on a concrete circumstance - the stop could not be confirmed, a file could not be saved - and then say briefly what the problem is and what he can do about it. Technical detail stays in the existing run journal under diagnostics; create no new panel or disclosure as a replacement. Do NOT change stop, recovery or run behaviour: this is presentation only. The burden of proof is on anything that stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Where this run stands, and what it left behind is gone, for every run state.
- [ ] #2 A confirmed stop the person asked for shows the status marking and no explanatory paragraph.
- [ ] #3 Text appears only for a concrete circumstance needing action, and says briefly what is wrong and what to do.
- [ ] #4 An unconfirmed stop still gives the information needed to act.
- [ ] #5 Technical detail remains in the existing run journal; no new panel or disclosure replaces the removed one.
- [ ] #6 Stop, recovery and run behaviour are unchanged.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Presentation only. No stop path, recovery path or run path was touched: `cancelChatLoopRun`,
`noteLoopStopRequested`, the abort and every journal and record write behave exactly as before.

**Where the distinction is knowable.** A stop the person asked for and got is the conjunction of
two facts DSpatch already holds, and `stoppedAsAsked(turn)` in `loop-transcript.ts` is that
conjunction: `turn.cancelRequested`, set by all three of the window's stop paths — Cancel, Stop
waiting, and unticking *Use loop* — and by nothing else; and `turn.ending.kind === 'cancelled'`,
which is the run reporting that it stopped. It is the same separation the attempt ledger keeps
between `cancel-requested` and `stopped-confirmed`, for the reason DSP-1 measured: 69.5 s of
remote work continued after a severed connection, so asking is not stopping. `abandoned` is
deliberately not consulted, because an ending that arrived settles what abandoning left open.

**What changed.**

- `ConversationStanding` lost `whoIsWorking`, `onWhat`, `waitingFor` and `whatHappensNext` and
  gained one `actionNote: string | null`. It is `null` for no run, a working run, an ended run
  and a confirmed stop; it is one or two sentences for the two states DSpatch cannot see into.
- `RunStanding` is a single `<p>`, drawn only when there is a note. The `<details>` titled *Where
  this run stands, and what it left behind* is gone, and nothing replaced it.
- `loopTurnEndingLine` returns `{ text: '', hasMore: false }` at a confirmed stop somebody asked
  for, so the badge stands alone. The technical account is unchanged and is in the run journal
  under **View → Run journal (diagnostics)**.
- `loopTurnStatusText` no longer captions an unended run with *A stop was requested…* or *You
  stopped waiting for this run…*; the note below says both, with an action. The window walk found
  the caption and the note on screen together, which is what prompted this.
- `LoopEnding` gained `actionNote`, carrying the two facts that outlive the silence: a record that
  could not be written, and a record that could not be read back in full.
- The chat-loop cancel no longer leaves *Cancel requested. Completed steps are not replayed; files
  stay as they are* beside the composer. A press that did nothing still speaks.
- `StandingInput` lost `currentStepLabel` and `instructions`, which only ever fed the four
  sentences.

**Verified.** `npm run typecheck`; fast 991 pass; heavy 152 pass; `npm run build`. One window walk
against the local presentation adapter, no provider:
`logs/028-implementer/the-stop-i-asked-for.ps1`, exit 0, zero stray processes. It read
`stop-requested` then `stopped`, and after the stop the run's whole entry was the loop mark, the
assignment and `stopped short`.
<!-- SECTION:NOTES:END -->
