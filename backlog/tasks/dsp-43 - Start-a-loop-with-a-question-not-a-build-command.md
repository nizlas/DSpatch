---
id: DSP-43
title: 'Start a loop with a question, not a build command'
status: To Do
assignee: []
created_date: '2026-09-18 17:25'
updated_date: '2026-09-19 08:51'
labels: []
dependencies:
  - DSP-26
priority: high
type: feature
ordinal: 15590
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

A mandate of "check that you can see the git repo" was refused before an agent was called, because no build or test command had been filled in — and had it started, the drawing would have ended with a build regardless. Both come from one place. `dspatch-chat-loop.graph.json` says so in its own notes field: *"Same shape as dspatch-live-duration."* That file is a DSP-18 test fixture whose stated purpose was proving a live walk can spawn a child process, and its build gate **was the thing being tested**. The chat loop was made by copying the fixture and rewording it, so the mandatory build is a test rig's scaffolding that got promoted to product behaviour. Nobody designed it as loop behaviour, and there is no rationale to preserve.

A loop that must end in a build is a loop usable for one kind of work. The mandate that finds three real defects by reading is the ordinary case, not the exception.

### What decides, and what must not

The graph draws where verification happens; the run measures whether anything was produced to verify. Both halves matter and neither is sufficient alone.

**A skip is the wrong mechanism.** The graph format deliberately expresses no conditions as expressions, and states that the graph says what the loop is. A runner that quietly skips a drawn node based on run state makes the picture stop being the run, which is the class of defect DSP-26 #1 exists to close. It would also get a research mandate that writes a report file backwards — files changed, so the build runs, which is the absurdity this card exists to remove — and it would hide an implementer that was asked to change files and changed none.

So the measurement chooses a **drawn branch**, not an omission. DSpatch already takes a before and after tree, so "this run changed nothing" is DSpatch's own observation and not an agent's account of itself.

### Relationship to DSP-18 and DSP-26

This is the shape half of what DSP-18 has been calling its chat binding. It extends DSP-26's outcome vocabulary rather than contradicting it: the five states that must stay distinct all survive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mandate can be sent to the loop, and the loop starts, without a build or test command having been filled in anywhere beforehand.
- [ ] #2 A run in which nothing in the project changed ends by telling the user what the agent found, and says nothing whatever about whether the project builds or its tests pass.
- [ ] #3 Which path a run took is visible in the graph view and in the saved record, and the reason it took that path is DSpatch's own comparison of the project before and after, not the agent's description of what it did.
- [ ] #4 A run that did change files still reaches its verification step; no drawn step is passed over silently.
- [ ] #5 A person reading the drawing before pressing Send can see that a mandate which only reads never meets a build.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in run `20260918-171500-shape`, call 002, together with DSP-44. Delivered: 596 tests across 84 suites, all passing, typecheck clean, up from a reproduced 580/81 baseline. No provider turn spent.

The graph is seven nodes and seven edges: one `work` agent node declaring `changed-files` / `changed-nothing`, one `check` gate, and five terminals so no ending has to be read from a colour. No router, because a live router always takes its first declared outcome and would have drawn a decision nobody makes.

**The measured branch is the load-bearing part.** `measuredWorkOutcome` compares DSpatch's own before-and-after tree and counts changed plus added plus removed — added matters because a research mandate that writes FINDINGS.md would otherwise read as having changed nothing, and removed matters because a deletion modifies no file. Both end-to-end tests deliberately use a reply that claims the opposite of what the run did to the files, and the measurement wins. A declared `spec-error` or `blocked` still overrides, because those are statements about the task that only the agent can make.

**The pre-run refusal is deleted**, executing decision D4. The code names D4 at the site so it can be reversed on sight. This reverses deliberate, verified work from 17 September on the coordinator's reading of Niclas's words rather than on his explicit instruction.

Deviation taken under the handoff's stated fallback: **the entry is an agent node, not a human one.** Pre-answering a human entry would need a new mechanism inside the live executor, which is both the half-built human node the handoff warned against and the second rule beside `decideNextStep` that DSP-30's note asked DSP-31 not to add. DSP-31 #5 owns it, and no criterion here needs it.

Criteria #1 to #4 pass with evidence; #5 is PARTIAL and HUMAN_PENDING, since whether the drawing reads that way in the editor is Niclas's judgement and no agent in this run could open a window.
<!-- SECTION:NOTES:END -->

## Verification Notes

<!-- SECTION:VERIFY:BEGIN -->
Call 003 verified this on candidate-2 and **downgraded two criteria from call 002's PASS**. Recorded here so a later call does not inherit a verdict that was withdrawn.

**#2 is PARTIAL, not PASS.** The build half holds exactly as claimed — a read-only run is `work → nothing-changed`, spawns nothing, and its sentence says nothing about whether the project builds. But a reply containing the ordinary English word *blocked* routes a successful read-only run to the `stopped` ending, which says the work was not done. Three of three plausible C++ review sentences do it. That is DSP-47, and it is the likeliest single thing to spoil the next trial.

**#5 stays PARTIAL, for one more reason than call 002 gave.** Beyond the rendering being Niclas's judgement: the statement the drawing makes — a mandate which only reads never meets a build — is one the runtime does not keep when anything else writes to the project during the turn. So a person could read the drawing correctly and still be wrong. That is DSP-48.

**#1, #3 and #4 are reproduced**, #1 from two further directions than call 002 used: the pre-walk predicates executed against a CMake tree with an empty Command field, and all five early returns in the handler enumerated with a negative control proving the scan can find a precondition rather than merely failing to.

Everything about what a window shows is HUMAN_PENDING. No agent in this run could open one.
<!-- SECTION:VERIFY:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
**#2 confirmed as met on re-examination. The verifier withdrew its own PARTIAL from call 003** — both stated reasons were addressed by call 004 and both fixes were reproduced.

A separate wording defect remains and does not hold this criterion, because it is neither of the two reasons given: `describeLoopEnding` still appends "the file changes are in the workspace view" to a run that changed nothing, and names the ending by its raw id rather than the label the drawing gives it. That belongs to DSP-27's subject and is being fixed in call 007.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Superseded in part. **Kept:** a loop may start from a question and must not demand a configured command. **Removed:** the branch chosen by DSpatch comparing file trees before and after — that is the orchestrator deciding what counts as work, which the interaction model rejects. A successful work step now always hands over to a checking agent, which decides for itself whether the assignment needed a build. Do not close on the delivered file-diff behaviour.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
