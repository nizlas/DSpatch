<a id="överlämning-mellan-koordinator-och-specialist"></a>

# Handoff between coordinator and specialist

The coordinator sends a bounded assignment containing the following information. Use short text and exact files or headings; do not dump the entire chat history. Apply the English project-language policy in AGENTS.md to handoffs and saved reports.

<a id="uppdrag"></a>

## Assignment

- **Identity:** run-id, task-id and call-id. Call-id is the journal's sequence number; store the runtime agent ID separately when available.
- **Role and mode:** specialist name, for example Reviewer in plan or implementation mode.
- **Goal and value:** what must be achieved and why it is needed now.
- **Mandate and boundaries:** permitted write locations, possible commands and what is outside the assignment. State whether this is an isolated calibration repository.
- **Current decisions:** relevant user direction in plain language, including corrections since the previous attempt.
- **Source material:** relevant VISION section, current task file, code and previous reports. Read AGENTS.md.
- **Initial state:** branch, base revision, existing changes and candidate snapshot if established.
- **Assessment:** applicable criteria, required checks and what needs human feedback.
- **Delivery:** final response to the coordinator; any explicitly permitted log directory. No further delegation.

The specialist must check material contradictions or missing authority with the coordinator. Normal reversible choices may be made within a clear assignment.

Questions go to the coordinator as normal report text, with a recommendation, dependent step and when an answer is needed. Specialists do not open their own question forms for Niclas. The coordinator decides what agents can resolve and what belongs in the combined report under [reporting and open questions](../DEVELOPMENT_LOOP.md#reporting-and-open-questions). A missing decision required by the assignment must be reported as a blocker; other questions must not stop independent work within the mandate.

<a id="slutsvar"></a>

## Final response

Include:

1. **Result:** COMPLETE, PARTIAL, BLOCKED or NEEDS_DECISION for your assignment, never automatically for the entire backlog task.
2. **Source material:** what you actually read or checked, with relevant candidate/report references.
3. **Delivery:** changed files, proposal or conclusion; why this addresses the bounded assignment.
4. **Evidence:** checks performed, commands, exit codes and logs. Distinguish your observations from documentation and assumptions. Verifier uses PASS/FAIL/NOT_RUN/HUMAN_PENDING per criterion; Reviewer uses ACCEPT/REWORK/NEEDS_DECISION.
5. **Remaining:** uncertainties, processes with unclear outcomes, relevant risks and human assessments.
6. **Next step:** a concrete proposed action and who needs to perform it.

Be as concise as the evidence allows. Link existing raw logs, but do not replace important findings with “see log”. The coordinator saves the report and supplies the same relevant context on rework.

<a id="journalens-aktiva-anrop"></a>

## The journal's active call

Before delegation, the coordinator sets `active_call` to an object with `call_id`, `role`, `started_at_utc`, `runtime_agent_id` (initially null), `outcome` (initially `unknown`) and `handoff_path`. Increment the call counter before starting. On a known completion, save the report, add the step to `completed_steps` and set `active_call` to null. On interruption with an unclear outcome, retain the object for reconciliation; do not reset counters or earlier reports.
