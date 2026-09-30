<a id="dspatchs-utvecklingsloop"></a>

# DSpatch development loop

Initial draft, 13 September 2026. This workflow helps us **build DSpatch in Cursor**. The product vision and phases are in [VISION.md](VISION.md); the built-in Maestro feature comes later. A run journal and instructions do not replace Cursor's actual process and tool management.

<a id="börja-i-cursor"></a>

## Start in Cursor

Fetch the branch containing these files and open the repository root in Cursor. Use an Agent chat with access to project files, a terminal and subagents. Use your normal model selection; specialists have `model: inherit`. Git and Python 3.10+ are needed for the bundled snapshot tool and its local probe, without extra Python packages. This does not select the language for the DSpatch product.

Enter in the Agent chat:

```text
/dspatch-loop calibrate
```

The initial probe is [DSP-7](../backlog/tasks/dsp-7%20-%20Kalibrera-utvecklingsloopen-i-Cursor.md), with the concrete procedure in [CALIBRATION.md](loop/CALIBRATION.md). It tests real specialist calls, a simple pause/resume point and planning using actual DSpatch material.

After a successful probe, you can enter:

```text
/dspatch-loop run DSP-1
```

Other assignments:

| Assignment | Result |
| --- | --- |
| `/dspatch-loop plan` followed by a goal | A reviewed proposal for the next increment and concrete tasks. Plan mode starts no implementation. |
| `/dspatch-loop resume` | Read the current run journal and continue from the last reconciled state with the same mandate and counters. |
| “Work interactively with me for now” | The coordinator stays in dialogue and saves decisions. No time limit requires returning to the loop. |

These are chat instructions to the skill, not a separate CLI. If the skill is missing, open a new Agent chat at the correct repository root and check that the files exist. As a fallback, attach `.cursor/skills/dspatch-loop/SKILL.md` and ask the main agent to follow it as coordinator. A missing subagent tool must be reported; playing every role in one context does not count as successful loop calibration.

<a id="sex-roller-en-platt-anropsstruktur"></a>

## Six roles, a flat call structure

| Role | Definition | Responsibility |
| --- | --- | --- |
| Coordinator, in the main chat | [dspatch-loop](../.cursor/skills/dspatch-loop/SKILL.md) | Mandate, context, operational plan, all delegation and status recording. |
| Backlog Planner | [Agent](../.cursor/agents/dspatch-backlog-planner.md) | Plan overview and well-specified task proposals. |
| Researcher | [Agent](../.cursor/agents/dspatch-researcher.md) | Bounded investigation when a real uncertainty needs resolving. |
| Implementer | [Agent](../.cursor/agents/dspatch-implementer.md) | Agreed code change and own checks. |
| Verifier | [Agent](../.cursor/agents/dspatch-verifier.md) | Independent execution and assessment of technical evidence. |
| Reviewer | [Agent](../.cursor/agents/dspatch-reviewer.md) | Independent review of a plan or implementation. |

The coordinator calls specialists directly and sequentially, in the foreground while the user is present and in the background for an unattended run (see [limits and stopping](#gränser-och-stopp)). No specialist delegates, including to generic subagents. This is our policy, not a platform restriction: Cursor's documentation states that subagents can launch child subagents starting in Cursor 2.5. The policy keeps the call structure flat and traceable, and specialist instructions repeat it. Researcher and Backlog Planner are used when needed, not as mandatory ceremonies before every small change. Reviewer assesses substantial new plans and delivered implementations. The coordinator supplies a clear handoff so specialists need not guess what was said in the main chat.

<a id="planerad-förbättring-uppgiftsstyrt-modellval"></a>

## Planned improvement: task-aware model selection

[DSP-8](../backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md) tests model selection by assignment character, complexity and uncertainty. The [model-selection proposal](MODEL_SELECTION.md) describes assessment, fixed user choice, justified switches and verification of Cursor's actual selection.

This is future work. DSP-7 used `model: inherit` throughout calibration. Adoption requires a verified Cursor experiment; the current skill and specialists do not select models dynamically. DSP-8 is not a dependency for DSP-1 or the first product milestone.

<a id="ett-normalt-pass"></a>

## A normal run

1. **Establish what will start.** Briefly check the correct repository, current branch, existing changes, selected task, dependencies and mandate. Reconcile any previous run before new work.
2. **Start the task in Backlog.** Set the selected card to `In Progress`, record the current substep or focus and confirm that the update was saved under [status and recovery](../BACKLOG.md#status-and-recovery). Do this before deeper planning, research, technical probes, implementation and specialist calls. On resume or rework, reconcile status before continuing. Then read remaining task-relevant vision material and decisions and briefly show value and scope. A standard run covers one task; useful substeps must not silently shrink its final criteria.
3. **Plan when needed.** Backlog Planner returns an overview and task proposals. Reviewer assesses a substantial proposal in plan mode. The coordinator applies justified changes within the mandate; changes in product direction go to Niclas.
4. **Investigate a concrete uncertainty.** Call Researcher if code or documentation is insufficient. Assign an executable technical probe to Implementer and Verifier with the appropriate mandate.
5. **Implement.** Give Implementer bounded write locations and criteria. On return, the coordinator checks the actual diff and establishes the candidate snapshot.
6. **Verify and review.** Verifier performs relevant checks on the candidate. Reviewer reads the same candidate, real code and verification report. If the material has changed, earlier results are history, not approval of the new candidate.
7. **Handle findings.** A code defect receives bounded rework. A wrong premise returns to planning or research. A vision decision or human UX assessment goes to Niclas. Do not simply repeat the same assignment with more agents.
8. **Finish or hand over.** The coordinator updates the task and summarises value, changes, evidence, open questions and next action. Use Review for pending human assessment; Done requires satisfied criteria. Other work may continue if already within the user's mandate and independent of the pending assessment.

<a id="planeringens-kvalitetsprov"></a>

## Assessing planning quality

The plan overview must be understandable without reading every ticket: what problem are we solving, why now and what can Niclas use after the step?

Assess both the first proposal and the outcome after feedback: missing necessary steps, unclear dependencies, unassessable criteria, unnecessary work and the amount of fundamental correction needed. Distinguish new product insights from errors the planner should have avoided. An uncertain UX idea may need a small experiment before implementation.

Preserve generalisable decisions in the task or shared instructions. Do not turn every individual comment into a permanent rule. Review the first real planning revision with Niclas before expanding the mandate.

<a id="rapportering-och-öppna-frågor"></a>

## Reporting and open questions

Niclas must be able to copy the report, discuss it and provide combined feedback for the next iteration. Present results and decision material directly as Markdown in normal chat. The coordinator uses separate question forms, such as `AskQuestion`, only when Niclas explicitly requests them. This applies to the loop's own questions; Cursor's permission controls still apply.

Follow AGENTS.md's language policy: saved reports, handoffs and repository updates are in English. Chat summaries for Niclas may be in Swedish. Lead with an executive overview of what exists, decisions that matter, what was actually verified, remaining uncertainty and the next step; put implementation details in the linked evidence.

Show the current plan overview and concrete proposed adjustments before asking for assessment. Do not first ask how to present the material. The report must be sufficient to understand the decision; task cards and raw reports provide detail.

Collect questions in a numbered list under **Open questions for the next iteration**. For each item, state:

- The question and the evidence or confirmed blocker behind it.
- The coordinator's recommendation and the relevant consequence of the choice.
- When an answer is needed, which step depends on it and what can continue now.

First determine who can resolve the question and when it needs an answer:

| Situation | Handling |
| --- | --- |
| Routine choice or technical uncertainty agents can investigate within the mandate | Decide or investigate and report the result. An untested prerequisite is not itself a confirmed blocker. |
| Human decision needed only later | Save the question for the next iteration. Continue independent work within the existing mandate and run limits. |
| Human assessment or missing authority actually required by the next step | Present the concrete material and question in normal chat. Wait on the dependent step until answered. If no other work can continue, save the next step and use WAITING_USER. |

An interim report or completed substep is not itself a stopping point. Continue to the next planned step when it fits the mandate and run limits and does not require an unanswered human decision. Reporting a routine technical choice does not request new approval. Do not end a run just to get a new chat or reset counters.

Deferring a question does not expand the mandate. Silence is never approval and human acceptance criteria remain open. A normal run still covers one task; a later iteration or next task may start only within the user's given mandate. Technical blockers and unknown call outcomes follow the existing stop and reconciliation rules.

The coordinator saves the report in the run journal. Record outstanding human decisions and checks in the existing `pending_human_checks`, referring to the report item and when an answer is needed. Describe technical investigations and the next action in the report and `next_step`. Summarise durable questions, decisions and next steps in the task file so they are also readable from Backlog.

At the next iteration or resume, read the report, pending items and any answers from Niclas before new delegation. Match each answer to its question, save the decision and retain unanswered items. Execute already approved choices without asking again; relay relevant decisions to affected specialists. Use the existing journal and counters under the recovery rules.

<a id="överlämning-och-en-enda-skrivande-ägare"></a>

## Handoffs and a single writing owner

Use [HANDOFF.md](loop/HANDOFF.md) for assignments and final responses. The coordinator saves the specialist report in full or as a faithful, labelled summary with references to raw material.

Only the coordinator writes `BACKLOG.md`, task statuses, milestones and the run journal. Backlog Planner proposes changes. Implementer may write assigned files. Verifier may create test artifacts and logs but must not fix product code. Planner, Researcher and Reviewer are configured as read-only.

Use the Backlog CLI when it works. Otherwise the coordinator may edit the same Markdown files under AGENTS.md. After a failed MCP or CLI write, read the actual outcome before retrying. No external project system is required.

If `backlog` is not found in the terminal, check `PATH` before concluding that the tool is missing. An agent terminal may inherit a stale environment lacking `C:\Program Files\nodejs` and `%APPDATA%\npm` even though they exist in the saved PATH. The symptom is either an unrecognised command or, with its full path, an unrecognised `node`. Update the session PATH or restart Cursor; do not reinstall without evidence. This occurred during DSP-7 and is documented there.

<a id="körjournal-och-återupptagning"></a>

## Run journal and recovery

Local journals are in `.dspatch-loop/runs/<run-id>/`, containing `state.json`, numbered handoffs/reports, logs and snapshots. Start from [STATE.template.json](loop/STATE.template.json). The coordinator creates run-id, for example a UTC timestamp plus a short random value. A local `.dspatch-loop/current.json` points to the run.

Write `state.json` through a temporary file and atomic replacement. Before a specialist or tool call, save the next step, call number and known outcome. Afterwards, save the actual agent/process ID if supplied, the report reference and new state. An unknown ID is null, never invented.

| Journal state | Meaning |
| --- | --- |
| READY | The next bounded step is known; no call is known to be active. |
| RUNNING | A specified call has started; assess actual activity through the tool. |
| RECONCILING | A previous call or file/command outcome needs clarification. No automatic repetition. |
| PAUSED | The run is paused at a concrete recovery point. |
| WAITING_USER | An actual decision or manual test is required. |
| BLOCKED | A concrete obstacle prevents meaningful progress. |
| COMPLETED | This run is finished; the entire task is not automatically Done. |

On resume, read the journal, reports, actual working copy and available process state. Compare the candidate and next step. If a call's outcome is unclear, enter RECONCILING and establish what already happened. If this cannot be established, provide a concrete question or local check and stop. Do not restart a patch, agent run or test process merely because the chat or a tool lost its connection.

<a id="reda-ut-ett-avbrutet-specialistanrop"></a>

### Reconciling an interrupted specialist call

An interrupted call is not the same as unfinished work, and most outcomes that look unknown are recoverable. Work through these in order before treating anything as unknown, and never repeat a call until you have.

1. **The report file.** Implementer and Verifier write it before ending, under the run's `reports/`. If it is there, the call delivered. Backlog Planner, Researcher and Reviewer are read-only and cannot write it, so its absence proves nothing about them — go straight to the transcript.
2. **The agent transcript.** Cursor keeps each subagent's own transcript at `agent-transcripts/<parent-chat-id>/subagents/<runtime-agent-id>.jsonl`. A line `{"type":"turn_ended","status":"success"}` means the specialist finished; its final response is the last assistant text entry and can be saved as the report. Read the file as UTF-8 — reading it with the shell's default encoding corrupts non-ASCII text.
3. **Artifact timestamps.** Log files under the run's `logs/` show when work actually stopped. A gap between the last artifact and the interruption is the difference between a stalled call and a slow one.
4. **The working copy.** New and changed files, `npm run typecheck` and the test suite establish whether the delivered state builds, independently of any report.

Record which of these established the outcome. A recovered report is the specialist's own words and is labelled as recovered, with the time it finished and the time it was retrieved.

Run one coordinator per working copy. This draft has no process supervisor or automatic lock manager; the journal supports recovery but does not prove that processes are running or stopped. Journals are local and Git-ignored. Summarise durable decisions, results and the latest verified next step in the task file; resuming on another computer also requires the necessary local material to be available there.

<a id="kandidat-och-teknisk-evidens"></a>

## Candidate and technical evidence

The coordinator captures a candidate after implementation and before independent checks:

```sh
python scripts/loop_snapshot.py --output .dspatch-loop/runs/EXAMPLE/candidate.json
python scripts/loop_snapshot.py --expect .dspatch-loop/runs/EXAMPLE/candidate.json
```

Replace EXAMPLE with the actual run ID. The tool reads Git and file content; it neither commits nor resets anything. It includes tracked files, tracked deletions and new non-ignored files. Local run journals are always excluded. Ignored dependencies, the environment and tool versions must be reported separately. The first tool does not support submodules.

Verifier checks before and after testing. Reviewer checks against the same snapshot. If tests create new non-ignored artifacts, document them and establish a stable candidate; never hide a source change as a test artifact. Document a later administrative backlog-status change as such; continue reporting the actual checked candidate, not an invented “tested HEAD”.

<a id="proportionate-verification"></a>

## Proportionate verification

**Niclas's decision, 19 September 2026.** Verification concentrates on what changed and on the functions a change can reasonably affect. **Full retesting is an exception that needs a concrete reason.** This governs how we build DSpatch. It says nothing about how Maestro should run the user's agents, which is [INTERACTION_MODEL.md](INTERACTION_MODEL.md).

These are the rules the rest of this document, [AGENTS.md](../AGENTS.md), [the handoff contract](loop/HANDOFF.md) and the role sources in `docs/loop/roles/` now defer to.

**Choose the smallest sufficient check.** A provider call is tried through the adapter. A handover is tried with a bounded flow. The whole agent loop is used when it is the whole that needs verifying.

**Reach the state the cheapest honest way, and stop as soon as you have looked.** When what is being checked is how something *looks or behaves in a given state*, the question is only how to get the window into that state — not how to exercise everything around it. Niclas's own formulation, 21 September, is usually the right one: start the thing, watch the first node for two seconds, stop. That costs seconds, needs no new apparatus, and uses the product as it stands.

Weigh the alternatives before choosing. Walking a whole run to arrive at a working node establishes nothing extra unless the question is how the state is *reached*. But building a hook to force the state is not automatically cheaper: a new kind of observation can mean new plumbing through the bridge, the preload, the type declarations and the scripted gates, which costs more than the walk it was meant to replace. **A shortcut that requires building a road is not a shortcut.** Prefer what already exists, cut the duration rather than the realism, and if a state genuinely cannot be reached without new apparatus, say so — that is a finding about our own testability, not a reason to pay for either route in silence.

**Separate presentation from provider behaviour.** Layout, Markdown and scrolling are tried in the real window, with saved content or controlled streaming. Real provider calls are needed when the provider's actual behaviour is the question. Say what each trial shows.

**Reuse valid results.** Unchanged parts are not retested routinely. Ask whether the change affects an earlier result and top it up where it does. Bind results to the right code version without making every new version trigger every test.

**Broaden only for a concrete reason** — shared infrastructure, dependencies, a storage format, or a fault suggesting wider impact. State the reason briefly in the work report. Do not ask Niclas about routine test choices.

**Keep the effort proportionate.** Do not build extensive test tooling, negative controls or assertions about exact code shape for simple changes without clear benefit. Check the behaviour that matters to the user. **A correct, briefly visible intermediate state does not have to be held open long enough for a test to catch it** — if an instrument cannot sample it, that is the instrument's problem, not the product's.

**Do not duplicate work between roles.** Verifier reviews the implementer's evidence and independently checks the important remaining risks. Independent verification does not mean mechanically repeating every run.

**Bound waiting and repetition.** Use sensible timeouts and end your own test processes. When a trial is slow or fails, separate a product fault from a fault in the test tooling and from needless waiting before running it again. Do not repeat the same expensive trial without new information.

**Stop when verification is enough.** When the relevant criteria are checked and no concrete blocking risk remains, move to delivery. Packaging and full test suites are not repeated after every small change without a reason.

Keep meaningful regression testing, and keep reporting honestly what was not tried. The goal is sufficient reliability for proportionate effort.

<a id="keep-the-suite-worth-running"></a>

### Keep the suite worth running

The same principle applied to the tests themselves. A suite nobody dares run because it takes too long, hangs, or answers a question nobody asked stops protecting anything.

**A new test earns its place.** It protects a concrete behaviour or a concrete risk that nothing already covers. Not every change needs one, and the number of tests is not a measure of anything.

**Run the smallest sufficient selection.** Each run answers a concrete question: what changed, and what it can reasonably affect, including the dependencies it affects. `npm run test:list` in `app/` names the groups; a presentation change does not need the chat service's tests.

**Frequent checks answer in seconds.** Tests that spawn processes, run git or wait on a clock are separated from the rest, so a multi-minute trial is a deliberate choice rather than the default cost of checking anything.

**When behaviour changes or goes, its tests go with it.** Review, simplify or remove them in the same change, rather than leaving a test that describes a product that no longer exists.

**Maintain a slow or flaky test rather than widening its timeout.** A larger timeout by default hides the fault. Cleanup that runs on a failed assertion and on interruption, waiting for your own children to exit before removing their directories, and isolating and restoring the environment variables that matter are part of the test, not extras. A test run that is forced to exit is not a passing run: it is a resource leak with the evidence suppressed.

**Review the suite when a milestone finishes.** A short look at overlap, time and tests for behaviour that has moved on. Not a form, not an approval round, and not a target for the test count.

**Independent verification reuses valid results.** It concentrates on the risks that remain rather than repeating a selection that has already answered its question.

### Give a load-bearing comparison a negative control

This is the main case where extra rigour earns its cost, and it is scoped deliberately: **when a comparison is itself the evidence**, break it on purpose and require it to notice. For a simple change with an obvious check, skip it — that is the proportionality rule above.

**A comparison that matches nothing looks exactly like a comparison that passes.** Run 20260917-204500-obs18 was bitten by this six times in thirteen calls, in six different disguises, and once it produced a report naming 21 defects that did not exist.

The rule that survived: **break the comparison on purpose and require it to notice.** Corrupt a known file and require the diff to name it; remove one shared test name and require the count of missing names to rise by exactly one; assert that a hex colour was found before concluding none was added. A comparator should also **refuse rather than pass** when a side parses to nothing — that refusal is what eventually caught the trap itself.

The disguises below are worth reading whenever you capture output for another call to parse, whatever the size of the change: they cost nothing to avoid and they are how a comparison silently becomes worthless.

The disguises, recorded so the next run recognises them rather than rediscovering them:

- `git show` in PowerShell writes UTF-16, so a baseline decoded as zero characters — and a file with no colours in it makes every colour look added.
- `Tee-Object` writes UTF-16LE with a BOM, so genuinely correct TAP parsed as zero test names.
- The console code page mangles non-ASCII into a captured log, so `✔` is stored as `Γ£ö` and em dashes differ between two files, making identical test names compare unequal.
- `npm test --reporter=tap` silently yields spec output, because `--reporter` goes to npm and never reaches node. Use `node --test --test-reporter=tap`.
- Naming a file `.tap` does not make it TAP, and the next call's comparator will find zero lines in it.
- A path that does not exist matches nothing silently. Resolve paths against the snapshot's own file list rather than accepting an empty result as a pass.

Prefer `| Out-File -Encoding utf8` over `Tee-Object` for anything another call will parse.

### A revert proof does not prove what it looks like it proves

Reverting a fix and watching a test fail shows that **the test notices that rule's absence**. It never shows that no *other* path produces the same fault. Two defects in the run above survived ten and eight revert proofs respectively, and both were found instead by asking what else could reach the same false statement.

So: use revert proofs to keep a rule, and attack from a second direction to establish that a claim is true. Make the captured failure land on the **user-visible assertion** — a revert that fails on a boolean proves the wrong thing.

Both this and the negative control are tools for a claim that carries weight, not a checklist for every change. [Proportionate verification](#proportionate-verification) decides when they are worth their cost.

<a id="gränser-och-stopp"></a>

## Limits and stopping

The default is one task, at most two correction rounds and twelve specialist calls per run. Preserve counters on resume and count failed calls too. The user may specify other limits or multiple tasks. At a limit, deliver the concrete result and proposed next step rather than starting a new run that resets the counter.

A read-only call with a confirmed failure may be retried once. Writes or unknown outcomes require reconciliation first. Use real timeouts where tools support them. Instruction limits are checked between calls and **cannot** interrupt a blocked Cursor tool. If such a call hangs, the user must cancel it in Cursor; the next run resumes by [reconciling the interrupted call](#reda-ut-ett-avbrutet-specialistanrop).

That remedy assumes someone is at the keyboard. **In an unattended run it does not apply, and a blocked call costs the whole remaining budget.** On 14 September 2026 a completed specialist call was never delivered back to the coordinator; the call stayed blocked for five hours and fifty minutes, past a hard stop the coordinator could not check because checking happens between calls. Two hours and forty minutes of that run were productive and six were lost.

For a run that continues while the user is away, prefer background specialist calls over foreground ones, and write the journal before ending the turn. This does not remove the failure — a background call that never reports still stops the loop, and completion is signalled only after the coordinator's turn ends — but the coordinator is not frozen mid-call, the journal is current, and the wall clock stays visible. State in the run journal which mode was used.

Report missing access, blocking technology or changed product direction with what was tried and exactly what is needed. Keep Niclas's manual UX assessment separate from technical PASS. Report absent usage data as unknown, not zero.

<a id="verifieringsläge-och-källor"></a>

## Verification status and sources

This draft contains real definitions and an executable local helper tool. DSP-7 records the completed Cursor calibration on Niclas's computer and its limitations. File checks alone do not prove agent behaviour or planning quality; consult the recorded run evidence.

Cursor formats were checked on 13 September 2026: [subagents](https://cursor.com/docs/subagents) and [skills](https://cursor.com/docs/skills). The coordinator is a skill in the main chat; specialists are project agents. Shared instructions are in [AGENTS.md](../AGENTS.md), also readable outside Cursor.
