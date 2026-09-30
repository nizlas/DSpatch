---
id: DSP-45
title: 'Let the loop work out how to check the project, and show you before it runs'
status: To Do
assignee: []
created_date: '2026-09-18 17:25'
updated_date: '2026-09-19 08:51'
labels: []
dependencies:
  - DSP-44
  - DSP-46
priority: high
type: feature
ordinal: 15594
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Requiring the command up front is unintuitive and unnecessary. The rule the product must keep is that the exit code is DSpatch's own observation rather than an agent's claim — and that constrains **who runs** a command, not who types it. An agent can work out a command and propose it while DSpatch still spawns it, still reads the exit code and still owns the evidence. Its strength is unchanged.

The earlier fix that stopped the gate re-deriving a command the window never showed was right about the real constraint — **the user can see and change what will be run before it runs** — and wrong to conclude that the field is therefore the only permissible source.

### Three sources, one field

DSpatch's own suggestion from the project; what the user typed, in the field or in chat; and what an agent worked out by looking at the project. All three write into the same visible field, and the field is what runs. The replacement rule is *no invisible fallback*, not *no fallback*.

### A proposal that is destructive

DSpatch does not judge a command's content. This project has already argued why half a shell parser is worse than none, and the argument is stronger here: an incomplete danger list that passes reads as DSpatch having checked. The containment is provenance — a command DSpatch never showed the user never runs — which is one rule rather than a list that ages badly. The existing narrow refusal of a bare `.ps1` stays as it is: it refuses on runnability, not on danger, and it must not be grown into a danger list.

One measurable safeguard costs nothing and is already half-built: DSpatch can see when a command modified the tree it was checking, and should say so.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For a project DSpatch cannot work a command out for by itself, the loop proposes one by looking at the project, and the proposal appears in the same command field the user can see and edit.
- [ ] #2 A command the user has had no opportunity to see is never run, whichever way the run is set.
- [ ] #3 A command the user gave in the conversation is used, without them having to retype it into a field.
- [ ] #4 The saved record says where the command came from — suggested by DSpatch, given by the user, or proposed by a named step of this run — and shows the command exactly as it ran.
- [ ] #5 When a command changes the project while checking it, the run says so rather than presenting the result as describing the state it ran against.
- [ ] #6 Choosing the check is a visible step of the loop with its own record, not a derivation hidden inside the run.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in run `20260918-171500-shape`, call 005. **#1, #2, #4, #5 and #6 PASS. #3 is NOT_DONE and the implementer stopped on it deliberately, not for lack of time.**

The drawing gained a visible `choose-check` agent node between `work` and `check`, with `command-proposed` / `no-command` outcomes and its own edges, reply and declared failures. It reads the project, proposes one command, and the proposal lands in the same editable Command field the person already types into. One press runs it; DSpatch spawns it and reads the exit code.

**The containment moved from a rule callers must remember to a function they must pass through.** The old guard was a string assertion on `main.ts`, which is evidence about the handler that exists and says nothing about the next one. `runCommandOffer(offer, spawn)` now takes the spawn as a parameter and is the only way to reach it, so the test counts calls rather than reading source. Proved by mutation: disabling the guard fails 4 of 18 tests. The offer table is typed as `Record<CommandProvenance, CommandOffer>`, so a fourth provenance added later stops compilation until someone says what the door does with it — which is the exact shape of failure that produced DSP-46, where `role` was missing from a table rather than wrong in it.

`commandNeedsConfirmation` has **no access to the loop mode**, and a test asserts the absence, so autonomy cannot become the reason something unseen runs. Reversing D3 is an edit to that one function.

`RecordedCommand` gained `provenance`, `proposedByNodeId`, `provenanceNote` and `line`. `line` is the command without the shell prefix, because *exactly as it ran* is `cmd.exe /d /s /c …` and that is not what a person compares against their field; both are kept. Absent still means not recorded, never a source.

**Why #3 stopped.** The planner's §3.3 says a command given in conversation needs no new parsing, because the mandate reaches `choose-check` through the prompt — so writing "check it with ctest --test-dir build" already works today. But then the record says `step-proposal` for a command the person wrote, and #4 asks whose it was. The alternative is DSpatch parsing the mandate, which is the half-a-parser this project has twice argued against. Choosing between slightly wrong provenance and a parser is a decision, and it is cheaper after Niclas has used the thing once.

Related, cheap to fix once #3 is decided: if he types a command *and* the loop proposes one, the proposal replaces his and he must confirm it. Nothing is lost — the panel shows both and the field is editable — but it costs a press he should not need.
<!-- SECTION:NOTES:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
Verified on `candidate-6`. **#1, #2, #4, #5, #6 PASS in the runtime, with the HUMAN_PENDING halves noted. #3 stays NOT_DONE and the verifier judged the argument for stopping sound.**

**#2 was attacked from three directions and holds.** Exhaustive over provenance, counting spawns rather than reading source: the frightening command the person typed runs, the harmless one nobody has seen does not. Autonomous end to end with a real spawner and a marker file the operating system did not write — an autonomous run with nobody to answer ends at *nothing was checked* rather than starting something unseen. And the confirmation is **per command, not once per run**: a second and different proposal replaces the offer with an unconfirmed one and is asked about again, so a destructive second command cannot ride the first confirmation. Nothing in the code states that; it falls out of `onCommandProposed` rebuilding the offer.

Also checked, and correct in a non-obvious way: pressing the manual *Run it* button during the ten-minute wait cannot double-start the command, because *Run it* is disabled on `busy !== null` for the whole run, while the Command **input** is disabled only on `running-test` and so stays editable during the wait — which is exactly what this card needs.

**One spawn exists outside the door.** The gate branch is `options.runProjectTest ?? runNodeProjectTest`; the chat handler always passes it, the editor Run handler does not. Measured: a real process started with no offer and no confirmation. Three facts bound it — the command is a DSpatch constant rather than anyone's proposal, that path runs in a generated `%TEMP%` repository and never the user's project, and `describeLiveBinding` refuses anything but the duration drawing. So the rule holds, but **the enclosure has a default-shaped hole**: a future caller wanting a gate and forgetting `runProjectTest` inherits a spawn instead of a refusal. Making the option required, with the duration binding passing `runNodeProjectTest` explicitly, is this card's own argument one level up.

**`RecordedCommand.line` is write-only.** `recordedCommandFrom` writes it and nothing in `app/src` reads it, so the ending sentence still shows `cmd.exe /d /s /c cmake --build build` — the exact form `line` was added to spare a person. #4 is met by `command`, but the field's stated purpose is served by nothing today.

**#5 will fire on every real CMake build**, since `cmake --build build` writes into its own tree. The wording is true and good; a sentence that always appears stops being read.

On #3: the fork is real and honestly stated. The path that works today genuinely works — a mandate saying "check it with ctest --test-dir build" reaches `choose-check` through the prompt — and only the provenance label is wrong. Nothing was left half-built. **Add to the decision that the field-overwrite behaviour is the same question:** a proposal overwrites a command the person typed and then makes them confirm it, because `onCommandProposed` assigns unconditionally. Preferring a command the person gave fixes both, and is a condition rather than a design.

**Superseded as a product requirement on 19 September 2026.** Niclas ruled that the user must not fill in, choose or confirm a Command field, and that D3 is not a product requirement. The agent chooses and runs the checks. This card's delivered machinery — `choose-check`, the proposal panel, and the confirmation door — is the misallocation being removed. Keep the notes as history. Do not close this card as delivered. See [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md) §8.
<!-- SECTION:NOTES:END -->
