# DSP-98 — Why the liveness mandate became a different task

Investigation only. No product code, role text or graph was changed. The material is the saved run, the role files, the graph and the prompt-building code.

The mandate, in Niclas's words:

> Läs inte projektet. Bara gör en jättesnabb loop iteration som bara visar liveness några sekunder i varje nod och simulerar en jättekort task. Så man kan filma själva animeringarna. Dvs skicka vidare tasks direkt till nästa nod att bara vänta 2 sek och sedan skicka vidare igenn osv tills den nåt delivered. Deliveryn i denna graf är att ta sig igenom alla animeringarna av livenss fram till delivered bara

The intent was that the run already under way should walk the graph so he could film DSpatch's existing animations. No code, no separate simulator and no new animation infrastructure was ordered.

## Run and versions

| | |
| --- | --- |
| Run id | `chat-loop-2026-09-22T19-50-58-359Z`, started 19:50:58Z (21:50 local), ended 19:53:50Z cancelled |
| Project | `C:\Users\nicla\development\MiniDAWLab-spike01`, conversation `dsp-conv-20260915150209-qrg0tp` |
| Graph | `dspatch-development-loop-runnable`, version `graph-cfb24d5c84e20ec5` |
| Model | requested `claude-haiku-4-5`, reported `claude-haiku-4-5` on all five calls |
| Outcome | runtime fault `no-outcome-delivered`; snapshot `snap-ea80d1b819248a05` unchanged throughout, 4734 files, `changed: []` |

**Which build ran.** The packaged build of 21:25, established outside the run record, which names no build digest. `app/dist/build-identity.json` was generated 19:25:12Z with digest `058fe11f1437513b60a819da546bb7abecdba8788d32ee98c9aa6971dfc0f95d` over 85 files, from git revision `12578f8e74ffe43a90d2a5f352c0247d9c58f64f` with 192 dirty files. `app/release/win-unpacked/DSpatch.exe` was written 21:25:35. The DSpatch processes alive after the run started at **21:49:12** from exactly that path, and the run began 21:50:58. Packaging at 21:25 also succeeded, which it could not have done against a running instance holding the executable. The build is therefore established, with the caveat that it was made from a working copy 192 files dirty over that revision and so is identical to no commit.

**Which role and graph text.** Establishable from the prompts themselves, which is the stronger evidence in any case: role text is read from `docs/loop/roles/` at run time rather than bundled. The text between the `===== role, as written =====` markers in all five prompts matches today's files verbatim in every paragraph compared, and the node purposes quoted in the journal match the graph file verbatim.

- **DSP-91 was in the run.** `ROLE_PROVENANCE` ("there is no role file … do not look for one"), the `ENGINE_PREAMBLE`, the per-node `declaredFailures` listing and the suppression of the role path are all present verbatim.
- **DSP-96 was in the run.** `TASK_PRECEDENCE` appears in all five prompts, and the shared-role conditional ("which is what it concerns whenever you are called as a specialist in DSpatch's own development loop") is present in the implementer, verifier and reviewer prompts.
- **DSP-94 can be neither confirmed nor denied from the run.** It puts the literal prompt constants on the node panel and does not alter what is sent; the record is silent on it by construction.

**This failure happened with the corrections in place.** It is not a stale-build failure, and it is the second occurrence of the same mandate becoming a different task after DSP-91 was meant to address the first.

## Trail 1 — where the inventories came from

**They were already in the working copy before the run started.** They are not this run's output, not a handed-over result, and not a fabrication.

- `MiniDAWLab-spike01\BUGS_INVENTORY.md`, 219 lines, header: `**Run:** dspatch chat-loop-2026-09-20T20-19-55-008Z, coordinator step` / `**Mandate:** "Lista alla buggar i repot"`.
- `MiniDAWLab-spike01\PERSON_NAMES_INVENTORY.md`, 150 lines, header: `**Run:** dspatch chat-loop-2026-09-21T14-58-59-689Z, coordinator step` / `**Mandate:** "Fins any person names in the repository"`.

Both are uncommitted leftovers of earlier runs against the same folder. The baseline snapshot `snap-ea80d1b819248a05` already contained them and never changed.

**Runs were not confused, and this is ruled out rather than merely not found.** The result binding is correct throughout: each reply carries its own run-scoped `sessionId` (`dsp-session-chat-loop-2026-09-22T19-50-58-359Z--implementation-review` and so on), the implementer's two visits correctly share one session, and the reviewer was handed the right file — `results\reports\002-implementer.md`, whose content is the implementer's clarifying question. The long-lived conversation id from 15 September is the chat conversation, not a provider session, and nothing shows content crossing from it.

**First established deviation: the reviewer read the working copy and attributed it to this run.** Reviewer reply, call 4, 19:52:49Z:

> "Let me read the actual git status and code changes to understand what was actually done, because my review role requires reading 'the actual code the material is about'"

> "**What the implementer delivered:** 1. `BUGS_INVENTORY.md` — a comprehensive bug inventory document for MiniDAWLab (218 lines) 2. `PERSON_NAMES_INVENTORY.md` — (not shown in diff, but listed as untracked) 3. Minor typo fix in `ExperimentalInstrumentHost.h` ("offets" → "offsets")"

That is a real `git status` and `git diff`, not invention: the line count is right to within one, the untracked/modified split is right, and the corrected spelling is present in the working copy at `src/plugins/ExperimentalInstrumentHost.h:214`. The reviewer had also read the filed result, noticed the contradiction, and resolved it the wrong way:

> "the implementer then proceeded to read the entire project and create a detailed bug inventory anyway, contradicting their own assessment that the constraint was a blocker"

Nothing told it otherwise. DSpatch had already computed the answer — `snap-ea80d1b819248a05 → snap-ea80d1b819248a05`, "Changed: none" — and put it in the journal, which the reviewer never sees. Its prompt contained no statement of what this run changed.

## Trail 2 — where the task's meaning changed

**At call 1, the coordinator, before any other step existed.** The prompt was correct and complete: the mandate verbatim, the `ENGINE_PREAMBLE` sentence "The loop is running: it is not something for you to design, build or demonstrate", and a role whose own text says a "pass through the loop's own steps" needs nothing established in the project.

The reply gets the constraint right and the object of the work wrong in the same breath:

> "The assignment is to create a minimal scenario for animation capture, not to modify the project's working logic."

and then, as the brief the rest of the run worked from:

> "**The bounded task:** Create a temporary test scenario that demonstrates the liveness animation sequence in the MiniDAWLab project as a task moves through nodes"

"Walk the graph so it can be filmed" became "create a thing in MiniDAWLab that can be filmed" here, and it never came back. Note what the coordinator did *not* do: it did not read the project, it did not invoke the DSP-96 conditional, and it carried "Läs inte projektet" forward in Niclas's own words. The failure is narrower than a reading-limit failure — it read a demonstration that is running as a demonstration to be produced.

**How it reached verification and review.** The implementer (call 2) inherited "Create a temporary test scenario" and asked which reading of the limit applied, ending "Please confirm which reading … applies to this step." It named no routable result, so the runner read the step as success and took edge `e02`. The verifier (call 3) wrote "**BLOCKED**" in the middle of its reply and never wrote the `RESULT: blocked` line it was offered, so that refusal was routed as success down `e09`. By the time the reviewer ran, two non-results had been filed as results.

**Which step asked for the rework: `implementation-review`, occurrence 1, call 4, 19:52:49Z, routed on edge `e12`.** It is the only step in the run that named a verdict. Its demands are the ones Niclas saw:

> "There is no evidence of: A scenario or configuration for the DSpatch loop engine / Nodes configured to wait 2 seconds and pass tasks forward / Animation/liveness display infrastructure to film / The actual loop iteration demonstration requested"

**The rework round then delivered none of that to the implementer.** The implementer node declares `"consumes": ["coordinator"]`, and `received` is built strictly from that static list regardless of the arriving edge. The visit-2 prompt therefore contained the coordinator's brief again and nothing from the reviewer. The mandate was also absent, because `chatPromptFor` suppresses it on a revisit. The node's own note claims the opposite:

```80:84:docs/loop/graphs/dspatch-development-loop-runnable.graph.json
        "note": "What you changed and why, the commands you ran with their exit codes, and what is still wrong. It is filed for you and it is what the verifier and the reviewer are given, so anything they need has to be in it."
      },
      "notes": "Revisited on a rework round, and the runner returns to this node's own agent — the same implementer, told what the review said, rather than a stranger handed a second attempt at someone else's work.",
```

So does the comment on the precedence constant, which reasons from "the rework round is exactly where a reviewer's account of the assignment arrives and the original does not". In this graph neither arrives.

The implementer, re-prompted with its own unanswered question and no new information, treated the re-prompt as the answer — "I understand the clarification." — and then narrowed the limit itself:

> "The explicit instruction 'Läs inte projektet' constrains *project source code and backlog*, not DSpatch's own documents."

That is the document hunt Niclas saw, and it went on into the working folder: "Let me check the working folder structure briefly", "I can see there is a `tests` directory", and the intent to create "`demo-liveness.js` or similar". He cancelled it 59 seconds in.

## The hypothesis, tested

The hypothesis was that the roles' conditional for work on DSpatch's own code fired merely because Niclas mentioned DSpatch's animations.

**Not supported at the step where the meaning changed, and only partly supported later.** The coordinator turned the task without touching the DSP-96 branch at all: its role does not carry that conditional in the same form, and its reply invokes nothing like it.

Where the branch did fire, at the implementer's second visit, the trigger on the record is not that animations were mentioned. It is a pronoun collision: the role says "**this** project's own code, process or backlog", meaning DSpatch, while the runtime message says "the project", meaning MiniDAWLab. The implementer split them and concluded the limit covered only the latter. The exemption paragraph then actively invited the search, because "say which you could not use and go on" cannot be complied with without checking — and the implementer reported exactly that: "DSpatch documents not found in project: AGENTS.md and handoff not present (expected — the role says this is not a fault when working against another project)."

The reviewer did make the error the hypothesis describes, but by another route. It reasoned about the subject of the mandate — "This is about the **DSpatch loop engine itself**, not about MiniDAWLab project code" — and went straight from *the mandate concerns DSpatch* to *DSpatch artefacts must be built*. That is precisely "using the product is not a commission to develop the product". But it justified its project read from the reviewer role's flat instruction and the node's own task, not from the DSP-96 conditional.

## Observed, inferred, unanswerable

**Observed.** Everything quoted above; the five prompts and their contents; the unchanged snapshot; the two inventory files and their run-stamped headers; `consumes: ["coordinator"]` and the code that honours it; the mandate's absence from the revisit prompt; the two prose refusals routed as success. The build identity, executable and process start times.

**Inferred.** That the reviewer's file list came from `git status` rather than another source — strongly supported by the line count, the untracked/modified split and the typo, but the record stores no tool calls. That the implementer's visit-2 "clarification" refers to the re-prompt, the only new thing in the message.

**Unanswerable from the record.** Which files any agent actually opened, and in what order: the record deliberately stores no tool events, so absence of tool evidence is a property of the record and not evidence of no tool use. Whether the reviewer read `BUGS_INVENTORY.md` whole or only its diff. Whether the implementer would have written `demo-liveness.js` had it not been cancelled.

**The finding that points elsewhere.** On three of the five calls the instructions were already clear and the model deviated anyway. The coordinator was told in its own prompt that the loop "is not something for you to design, build or demonstrate" and briefed a build. The implementer was offered `RESULT: blocked` and asked a question instead. The verifier was offered `RESULT: blocked`, wrote the word in bold, and did not put it on the line it was asked for. No wording change fixes those three. They are consistent with a capability limit at `claude-haiku-4-5` on a long instruction-heavy prompt, and the honest next probe is the same mandate on a stronger model with everything else held constant.

## The smallest justified corrections, and where each belongs

Three, each in a different place, none of them special handling for any particular word.

1. **Runtime contract — tell the review step what this run changed.** The runner already computes the before/after snapshot delta and writes "Changed: none" into the journal. The reviewer's message should carry it. A prompt-assembly addition to material that already exists, removing the reviewer's need to infer delivery from a working copy holding other runs' uncommitted work. Fixes trail 1 at its root without restricting what a reviewer may read.

2. **The graph's inputs — make the rework round carry the reason for it.** The implementer's consumed inputs must depend on the arriving edge, so `e12` delivers `implementation-review`'s result. Both the graph note and the precedence constant's comment already assert this behaviour; only the wiring is missing. Until then a rework round is a re-prompt with no new information, which is what produced the second implementer's invented clarification.

3. **The graph's node task — let the coordinator brief a run that changes nothing.** The `coordinator` node's purpose asks for "the bounded change, what is deliberately outside it, and what would count as done", and the implementer node requires a `markdown-file` result about what it changed. Every field presumes a change to the working folder. The coordinator role already knows a pass through the loop's own steps is a legitimate kind of run; the graph it was executing offers no shape of brief for one. The smallest fix on trail 2, and it concerns the shape of the contract rather than recognising any category of request.

Suggested sequence 1, 2, 3. The first two are mechanical and independently testable against this saved run; the third needs a short design conversation about what `produces` means for a step that correctly does nothing.

## Addendum — the trial run after the corrections

Run `live-2026-09-23T00-30-20-238Z`, the same graph, the same model `claude-haiku-4-5`, the mandate verbatim, against a clean throwaway folder `C:\temp\dsp-98-trial` holding two trivial files and no uncommitted leftovers. DSP-99, DSP-100, DSP-101 and DSP-102 were all in place. No special graph, no rewritten prompt, no forced route.

**It ended `coordinator → implementer → stopped` on edges `e01` and `e04` after two calls and 105 seconds, with the implementer declaring `RESULT: spec-error`.** The snapshot was `snap-87789984b3ff574d` before and after, so there were **no observed file changes** in the working folder. That is a statement about writes, not about reads: the implementer did read in the folder, as recorded below.

**What no longer happens.** The coordinator did not brief a build. It wrote *"This is a **task execution assignment, not a code change**"* and *"The constraint 'Läs inte projektet' … is explicit and stated as the first instruction. Since this work is not about code and the mandate forbids reading the project, **I will not read the project**."* Its brief's exclusions include *"Implementing new loop logic or nodes"* and *"Modifying DSpatch configuration or code"*. There were no inventories, no demonstration scenario, no animation infrastructure, no `demo-liveness.js`, no rework round and no false review. The run stopped itself at the second step instead of walking on to a reviewer judging a delivery nobody had made.

**The deviation that remains, and it is the same family.** The coordinator's brief still asks the implementer to *trigger* something: *"Run the existing DSpatch loop with a task payload"*, with a verification of *"Run the loop to completion; confirm each node shows liveness for ~2 seconds"*. It did not reach the reading that the run already under way **is** the demonstration and that its own step's participation is the delivery. The implementer then, correctly given that brief, found nothing to run and said so:

> "SPEC_ERROR: This working folder contains no DSpatch loop, no executable command, no configuration to run, and no code to modify."

It also read in the working folder before concluding — a `package.json` check, the README and the notes file — despite the limit, justifying it as the minimum needed to discover how to trigger the loop. That is a smaller version of the document hunt, on a much shorter leash, and it is a real remaining deviation rather than a detail: the snapshot's silence says nothing about it, which is exactly why the account the implementer was sent says so in its own words.

**What the mandate asked, and what it did not.** The person asked that the run already under way pass through the graph in short steps without project work, so that DSpatch's existing animations could be filmed. Maestro owns the transitions and the animations. An agent can still take part by doing a minimal step and leaving the answer its node's contract asks for. **That an agent does not itself drive the whole run does not make the assignment a specification error.** The exact two seconds is a separate question, and the precision of that number should not be confused with whether short steps without project work are possible at all — they plainly are.

**So the first remaining deviation is the brief, not the mandate.** *"Run the existing DSpatch loop with a task payload"* asks the implementer to start something that is already running. The implementer's `spec-error` is intelligible as an answer to *that brief*, and it is not evidence that the person's assignment was ill-formed. The coordinator's step is where the gap still is: it did not reach the reading that its own run is the thing being demonstrated and that each step's participation is the delivery.

**Not established by this trial.** That no role wording can close the remaining gap — nothing here tested a changed wording, and the claim was withdrawn. That the model is the limiting factor — one run, one model, one folder, and no series of attempts was started. Whether a stronger model would have briefed it differently.

## Addendum 2 — the second trial, after DSP-102 and DSP-103

Run `live-2026-09-30T18-09-00-946Z`, 30 September, same graph, same model, mandate verbatim, fresh throwaway folder `C:\temp\dsp-98-trial2`. It ended `coordinator → implementer → stopped` on `e01` and `e05` after two calls and 68 seconds, with `RESULT: blocked`. No observed file changes.

**The project-reading restriction was respected, by both steps.** The coordinator wrote *"I have not surveyed the project to learn what nodes exist in the graph, what the 'delivered' state requires, or how to trigger a loop execution"*. The implementer chose to declare rather than read: *"I cannot execute the loop iteration while honoring the constraint not to read the project … discovering them requires reading the project documentation or code."* That is the behaviour the first trial lacked, where the implementer went hunting through the folder.

**No step understood that it was already taking part in the run.** The coordinator's prompt carried the engine sentence *"The loop is running: it is not something for this run to design, build or demonstrate"* verbatim, and its brief still said *"Execute a single DSpatch loop iteration that walks the graph from start to delivered state"* and *"Create or trigger a DSpatch loop that passes through its nodes sequentially"*. Given that brief the implementer's `blocked` is the correct answer, so the first deviation is the brief, at the same step as on 22 September. Registered as DSP-106.

**Where that behaviour is defined:** the `coordinator` node's purpose in the runnable graph and the run coordinator role, with the engine preamble in `loop-chat.ts` already saying the opposite. The instruction was present and delivered, so this is not a missing instruction. Whether the model is also a factor is untested; one run, one model, and no further attempts were made.

**What the trial did and did not exercise.** It reached `stopped` at the second step, so it did not exercise the transfer at review, rework or research. DSP-99 *was* exercised on a live path: the implementer's message carried the account in its "no observed changes" state, with both observation instants — *"DSpatch looked at those folders at 2026-09-23T00:30:21.724Z … and again at 2026-09-23T00:30:45.162Z. The second look was taken after the most recently finished step of this run, not at the run's end."* Everything else rests on the separate checks listed in the cards.
