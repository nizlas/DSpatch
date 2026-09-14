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

The coordinator calls specialists directly, sequentially and in the foreground. No specialist delegates, including to generic subagents. This is our policy, not a platform restriction: Cursor's documentation states that subagents can launch child subagents starting in Cursor 2.5. The policy keeps the call structure flat and traceable, and specialist instructions repeat it. Researcher and Backlog Planner are used when needed, not as mandatory ceremonies before every small change. Reviewer assesses substantial new plans and delivered implementations. The coordinator supplies a clear handoff so specialists need not guess what was said in the main chat.

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

<a id="gränser-och-stopp"></a>

## Limits and stopping

The default is one task, at most two correction rounds and twelve specialist calls per run. Preserve counters on resume and count failed calls too. The user may specify other limits or multiple tasks. At a limit, deliver the concrete result and proposed next step rather than starting a new run that resets the counter.

A read-only call with a confirmed failure may be retried once. Writes or unknown outcomes require reconciliation first. Use real timeouts where tools support them. Instruction limits are checked between calls and **cannot** interrupt a blocked Cursor tool. If such a call hangs, the user must cancel it in Cursor; the next run resumes by reconciliation.

Report missing access, blocking technology or changed product direction with what was tried and exactly what is needed. Keep Niclas's manual UX assessment separate from technical PASS. Report absent usage data as unknown, not zero.

<a id="verifieringsläge-och-källor"></a>

## Verification status and sources

This draft contains real definitions and an executable local helper tool. DSP-7 records the completed Cursor calibration on Niclas's computer and its limitations. File checks alone do not prove agent behaviour or planning quality; consult the recorded run evidence.

Cursor formats were checked on 13 September 2026: [subagents](https://cursor.com/docs/subagents) and [skills](https://cursor.com/docs/skills). The coordinator is a skill in the main chat; specialists are project agents. Shared instructions are in [AGENTS.md](../AGENTS.md), also readable outside Cursor.
