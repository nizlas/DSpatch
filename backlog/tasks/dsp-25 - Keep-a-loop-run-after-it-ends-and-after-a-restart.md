---
id: DSP-25
title: 'Keep a loop run after it ends, and after a restart'
status: Review
assignee: []
created_date: '2026-09-17 18:43'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-18
priority: high
type: feature
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

A chat-loop run is currently renderer memory. The journal is produced and dropped, no attempt is opened, and the run vanishes when the project changes, a saved conversation is opened, or the window closes. Ordinary chat turns survive a restart; the loop half of the same column does not, and nothing on screen says so. That is the honesty gap recorded as C2 on DSP-18, and it is why DSP-18 criterion #3 is met by the CLI and duration evidence but **not** by the chat binding.

Niclas set the direction on 17 September 2026: a loop run the user can follow, understand and review **after a restart**.

### Scope

A minimal, versioned record of a chat-loop run, written as the run happens. Not a general history framework, not an analytics store, not a schema meant to absorb every future workflow. The smallest format that lets a person return to a finished or interrupted run and understand what was done and review the real change.

Review must be possible against the actual code, not against the agent's account of it and not against whatever the working copy happens to contain later. That is the constraint that decides what has to be recorded.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chat-loop run is written to disk in a versioned format while it runs, and identifies the project, the conversation, the user's mandate, the run, and the exact graph version that was executed.
- [ ] #2 Steps taken, handoffs between nodes, each agent's reply and the final outcome are recorded, together with the requested model and the model the provider reports having used when that information exists.
- [ ] #3 Executed commands are recorded with their command line, working directory and outcome, and with the code or snapshot references needed to review the real change afterwards rather than trusting the agent's description or the working copy's latest contents.
- [ ] #4 Writing is continuous, so an interrupted or incomplete run still leaves understandable history, and incomplete or unknown outcomes are shown as such rather than as success or failure.
- [ ] #5 After a restart the history is displayed from the record without automatically repeating any agent call, command or file change.
- [ ] #6 Existing saved conversations still open after the format change; older or unreadable data is handled understandably instead of silently discarded; no authentication secrets are written.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
17 September 2026, 20:45 local. Niclas gave a single mandate covering this card and DSP-26, DSP-27 and DSP-28: a loop run the user can follow, understand and review even after a restart. Full mandate to plan and execute without approval between steps; routine technical decisions are the coordinator’s and the specialists’. Run `20260917-204500-obs18` opened.

**Focus for this card, in order:** the record comes first, because DSP-26, DSP-27 and DSP-28 all read from it. A versioned file per run, written as the run happens rather than at the end, carrying the identity (project, conversation, mandate, run id, graph version), the events (steps, handoffs, agent replies, ending, requested and reported model) and the commands (line, working directory, outcome, code references). Then restoring it after a restart without repeating anything.

**The prior art to reuse rather than reinvent:** the CLI and duration path already produces a journal, an attempt ledger and before/after tree snapshots, and DSP-18 #3 is met there. What is missing is that the chat binding drops all of it — `journalText` and `workspaceNote` are returned and discarded, `outDir` is null, no attempt is opened. This is a wiring and a format story, not a new mechanism.

**The known obstacle, recorded by run `tx18` call 001 and still true:** `StoredMessage` has no field that distinguishes a loop turn from something the user typed, and `this.turns` is not only the save path — it also feeds `evidence()` and the carried-message machinery, so anything entering it changes what is put in front of the model. That is why persistence was deferred then. The answer chosen now is a separate versioned run record referenced from the conversation, not loop turns smuggled into the message list.

---

Run `20260917-204500-obs18` call 001 Implementer **COMPLETE** on this card and DSP-26 together. Three new source modules and six changed; **444 tests passing across 47 suites**, against an independently measured 414/36 baseline, with the two name lists compared so that nothing green at baseline went missing. Typecheck exit 0. No provider turn, no commit, `app/dist/` untouched.

**A chat-loop run is now a file**: a header written before the walk starts, one line appended per journal entry, agent reply and command as it happens, and an ending line carrying one computed outcome. Reopening the conversation reads those files back into the same column the live run drew, calling no agent, running no command and touching no project file.

**Append rather than rewrite, and the reasoning is the interesting part.** `conversation-store.ts` writes a temporary file and renames it, which is right for something saved whole after every turn. A run record is not saved whole: #4 requires the line to be on disk *before the next thing happens*, so rewriting would put every earlier line at risk on every event and grow quadratically in a long run, while appending risks only the newest line. The cost is handled rather than hidden — a process killed mid-append leaves a partial last line, `parseRunRecord` drops the fragment, counts it as `truncatedLastLine`, and the reader is told a step may be missing. A dropped fragment is an unfinished write, not damage, and is reported as neither a complete run nor a corrupt one.

**The graph is content-identified, not named.** `graphVersionId` is a SHA-256 over the bytes actually read for that run, prefixed `graph-` so it cannot be confused with a snapshot id. The reason is the editor: a person can change the drawing between runs, so two runs of `dspatch-chat-loop` a week apart may have walked different graphs.

**The conversation format was not touched**, so #6 is met by not breaking anything rather than by migration code. The Implementer looked for an argument to overturn that preference and found none: the conversation is the longer-lived object, records are many per conversation, and a bump would be paid for by every existing saved conversation while buying nothing this increment needs.

**No secrets, by construction and by a test that will survive a future field.** `RunRecordIdentity` has no field a credential could live in, and the test asserts the **exact sorted set of keys** rather than the absence of particular names — so a field added later called `apiKey`, `account` or `endpoint` fails it whatever it is called.

**Twenty-three new tests, each with a logged revert proof that fails on the sentence a person reads.** One of them is worth recording as a lesson: log `23`'s first version asserted only that the records directory had not been created, and the revert **passed** it while a file really was written outside the directory. The assertion was wrong, not the code. It now asserts the escaped path itself.

**Criterion #3 is met for the gate command and partial for code references.** Each command carries its line, working directory, exit code, signal, duration, not-started reason and output tails, and code is referenced by snapshot ids plus per-file hashes for changed, added and removed files. What is missing is surfacing: **a reviewer cannot yet open a diff from the record in the window**, which is DSP-27's work.

**Named limitations, not discovered later.** Records are written for the chat-loop binding only — the dry-run and CLI paths through `runLiveGraph` still write nothing, so "every loop run is kept" is not yet true of every entry point. `snapshotTree` is still unbounded on a large project; the record deliberately does not inherit that unboundedness, keeping snapshot identities and per-file hashes rather than whole trees, and every bound that bites says so in words. And the renderer wiring is covered by `tsc` and by tests of the shared functions it calls, but **nothing opened a window** — the Implementer names this as the largest gap in its own evidence.

Call 002 Verifier: **DSP-25 passes on every criterion** (#5 mechanically, with the window still human-pending), and its defects are all on DSP-26's side. Two findings belong here.

**`RecordedCommand.startedAtUtc` is not a start time.** `main.ts` passes the moment the command *settles*, and `closeChatLoopRecord` passes the record *close* time for the copies in the ending line. Both are after the fact and `durationMs` cannot recover the start from either. Cheap to fix and worth fixing **before DSP-27 draws a timeline from it**, which is exactly the sort of thing that becomes load-bearing the moment something reads it.

**A note for DSP-27, from the path-safety re-derivation:** `filePathFor` is not safe on its own — `filePathFor("a/../../b")` escapes the records directory. The guard lives entirely in `open()` and `read()` checking `isUsableRunId` first. Anything new that builds a path must go through them rather than around them. The Verifier re-derived this rather than reading the existing test, walking the whole sandbox tree before and after twelve hostile ids: zero files created anywhere, and `read()` wrote nothing.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Unaffected in purpose; its content changes. The record must still survive the run and a restart. What it holds is no longer only commands DSpatch spawned: a loop step's evidence is now the **observed tool calls** an agent made, recorded alongside DSpatch's own snapshot. `RecordedCommand` stays for the Build-and-test panel, where DSpatch really does spawn the process and owns the complete output; observed tool calls need their own shape, because the provider can drop output and sends no working directory. Merging the two would erase the distinction the record exists to make. See DSP-54.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
