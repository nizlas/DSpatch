# DSpatch: Content-Exclusion Integration and Verification
**Proposed integration contract and verification plan**

Version 0.1 | 19 October 2026 | Draft pending R&D Tools requirements

## 1. Scope and known requirements

Provide a narrow, testable path for using centrally maintained content-exclusion controls with DSpatch's Copilot runtime. Prefer reuse of the actual control implementation rather than an independently maintained copy of its glob rules.

Niclas reports that R&D Tools permits an SDK-based application if content exclusion satisfies its rules. The supplied example includes `axis-hooks.json`, Bash/PowerShell pre/post scripts, 15-second timeouts and a separate global-pattern configuration. The executable scripts, helper code and written requirements have not yet been reviewed. Exact script execution versus an equivalent improved implementation remains open. [U1]

No implementation or security test has been performed for this document. Integration success, observed enforcement and acceptance under the existing R&D Tools process are separate outcomes. The document does not modify organizational policy or grant permission to process real workplace material.

### Define the information-flow boundary

Confirm whether the requirement prevents local access, exposure of contents to the model, or a specified combination. A path passed to local evaluation is not identical to bytes supplied as model context. However, a script can print protected contents; argument syntax alone cannot make an operation safe.

A future approved implementation could distinguish permitted local computation and metrics from prohibited raw-content exposure. That is an open design possibility, not an exception to apply before agreement.

### Deployment terminology matters

The reported `~/.copilot/hooks` directory is GitHub's user-hook location even when files are centrally distributed. Machine-wide Policy Hooks are another documented source. Central distribution alone proves neither successful discovery nor tamper resistance nor mandatory execution. Check effective configuration locations, permissions and update behavior on the selected path. [W1]

### Relationship to the runtime roadmap

The initial SDK probe uses synthetic material, does not implement DSpatch content exclusion and must not disable mandatory controls already installed. It establishes compatibility, not workplace readiness. The verified policy path is required before the real workplace pilot. Home providers do not automatically inherit the Axis configuration. [S1]

<!-- pagebreak -->

## 2. Proposed runtime contract

### One authoritative invocation path

First determine whether the chosen Copilot runtime natively discovers and runs the managed hooks. Verify the effective user/configuration home, script availability and actual invocation. Prefer native loading when it satisfies the requirement; do not add a callback runner that duplicates it.

If a bridge is required, register the relevant SDK callbacks and await the selected command at the correct lifecycle point. Translate to the script's expected payload rather than assuming the callback object is identical. The pre-check must finish before the operation may proceed.

### Safe command execution and decision handling

Read command selection from the managed configuration, not from a graph node or agent response. Pass model-supplied arguments as structured standard input; never interpolate them into a shell launcher. Preserve the required working directory and environment without leaking credentials into logs.

Interpret stdout, stderr and exit status according to the actual script/runtime contract. Separate diagnostics from decisions, preserve denials and handle multiple hooks consistently. Invalid or missing output is a control failure, not an inferred approval.

The post-hook must reproduce the script's actual function. A name containing “warn” proves neither redaction nor removal of model-facing content. Review whether outputs, errors, attachments and other context ingestion require additional controls.

### Failures need an agreed meaning

Missing configuration, script failure, malformed payload, timeout and malformed decision output are distinct cases. GitHub documents timeout of command hooks as proceeding to the normal permission flow rather than automatically denying. A stricter DSpatch wrapper would therefore change behavior and must be treated as an explicit decision, not invisible compatibility. [W1]

Proposed workplace behavior: prevent an affected operation when its mandatory control cannot be established, report why, and provide a recovery path. Confirm the exact rule with R&D Tools. Never silently degrade a workplace runtime into the synthetic-test configuration.

### Enforcement follows execution

Mandatory controls must remain outside editable roles and graphs. For direct SDK execution, identify the owning runtime process. For AHP, identify a host-side control that remains effective after client disconnect; otherwise do not enable unattended execution. A session event displayed after an action is not a pre-execution check. [W2]

Record non-sensitive outcomes, effective runtime versions and policy references. Do not commit centrally supplied enterprise rules, credentials or private script contents as distributable defaults. Revalidate mandatory control state on restart/resume according to the agreed update rule; an old readiness flag is insufficient.

<!-- pagebreak -->

## 3. Verification matrix

Use synthetic protected files and sentinel values, not actual secrets, footage or model weights. Record the attempted operation, effective policy/runtime, callback/script activity, decision, observed side effects and observable model-facing result. An incomplete log is not proof of non-disclosure.

| Scenario | Required observation or unresolved question |
| --- | --- |
| Allowed text read/edit/test | Legitimate work succeeds with the intended controls active. |
| Excluded file read | Required denial occurs before protected content is exposed. |
| Global rule outside Git | Behavior matches the stated repository-independent rule. |
| Relative paths and symlinks | Resolve behavior against actual implementation; do not assume coverage from a name match. |
| Terminal/local computation | Test approved processing, if defined, and a script returning prohibited contents separately. |
| Prompt or attachment supplied by DSpatch | Cover ingestion outside normal agent file tools. |
| Tool result, errors and diagnostic output | Verify permitted model-facing content and any required redaction. |
| Subagent/delegated task | Establish the real enforcement path; do not assume inheritance. |
| Missing/malformed script or configuration | The agreed failure behavior occurs without silent approval. |
| Timeout or crash | Distinguish native runtime behavior from wrapper behavior. |
| Native loader plus callbacks | No unintended double invocation or conflicting decisions. |
| Resume and policy update | No stale readiness or silently missing required configuration. |
| AHP client disconnect or alternate client | Enforcement remains where execution happens or execution is prevented. |
| Host loss during an operation | Preserve uncertainty; do not blindly repeat side effects. |

### Two evidence layers

**Deterministic bridge tests** use controlled substitute scripts to exercise payload conversion, output parsing, ordering, timeout and process handling. They do not certify the Axis scripts or provider context assembly.

**End-to-end tests** use the actual managed package in the intended runtime/platform. Verify prevention and output at the best observable boundary; state what remains dependent on provider behavior or organizational assurance.

A successful Windows/direct-SDK test does not certify Linux/AHP. Reuse test cases across actual deployment combinations, not unsupported conclusions. A worktree is not a security sandbox, a hook log is not a non-disclosure guarantee, and a completed workflow is not a passed security test.

<!-- pagebreak -->

## 4. Open decisions and rollout gate

### Questions to settle with R&D Tools

| Decision | Integration consequence |
| --- | --- |
| Exact scripts or equivalent implementation? | Compatibility bridge versus separately evaluated control engine. |
| Required local/model information-flow boundary? | Which operations and outputs may be permitted. |
| Which platforms and runtime/host combinations? | Defines the verification matrix. |
| Required timeout/failure behavior? | Prevents accidental semantic differences. |
| Deployment, integrity and updates? | Establishes discovery, enforcement and refresh behavior. |
| Evidence and acceptance owner? | Uses the existing process without inventing a new approval bureaucracy. |

### Proposed workplace enablement gate

Review requirements and executable scripts; establish the effective runtime configuration; pass the agreed prevention, failure and recovery scenarios; record the remaining limitations. Enable real workplace tasks only for the verified scope and satisfy the acceptance expected by the responsible team.

A failed control must not corrupt task history or silently cause a provider switch. Changing provider, transport, host or platform does not inherit unrelated verification. Preserve the current working development route while the new workplace integration is being tested.

### Later improvements

Keep the DSpatch integration boundary and tests reusable so an approved, more precise implementation can replace the policy engine without rewriting graph or UI logic. Describe permitted operation classes, input sensitivity and allowed output rather than relying only on path syntax.

Preserve meaningful differences from the original scripts as explicit design decisions. A role, graph node, Dynamic Workflow or App canvas cannot replace mandatory workplace policy with its own configuration.

### Sources and provenance

**U1:** Niclas's meeting report and configuration excerpts supplied in this conversation. They describe deployment and intended rules, not independently verified script behavior.

**W1:** [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference): hook sources, command configuration, decisions and failure behavior. Verify against the exact deployed runtime before implementation.

**W2:** [VS Code Agent Host architecture](https://code.visualstudio.com/docs/agents/concepts/agent-host) and [AHP/ACP responsibility boundary](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp.html): independent host execution, client coordination and backend responsibilities.

**S1:** Companion *DSpatch: Runtime, Workspaces and Platform Evolution*, v0.1. Existing working-memory and orchestration documents remain the product principles; this draft narrows their application to mandatory control integration.

**Status:** requirements incomplete; no script modification, security verification, workplace deployment or repository update performed.
