# DSpatch: Content-Exclusion Integration and Verification
**Proposed integration contract and verification plan**

Version 0.2 | 22 October 2026 | Draft pending requirements from the responsible tooling team. Organization-specific references are generalized; technical requirements and verification status are unchanged.

## 1. Scope and known requirements

Provide a narrow, testable path for using centrally maintained content-exclusion controls with DSpatch's Copilot runtime. Prefer reuse of the actual control implementation rather than an independently maintained copy of its glob rules.

Niclas reports that the responsible tooling team permits an SDK-based application if content exclusion satisfies its rules. The supplied example includes a managed hook configuration (referred to here by the illustrative filename `managed-hooks.json`), Bash/PowerShell pre/post scripts, 15-second timeouts and a separate global-pattern configuration. The executable scripts, helper code and written requirements have not yet been reviewed. Exact script execution versus an equivalent improved implementation remains open. [U1]

No implementation or security test has been performed for this document. Integration success, observed enforcement and acceptance under the responsible tooling team's existing process are separate outcomes. The document does not modify organizational policy or grant permission to process real workplace material.

### Define the information-flow boundary

Confirm whether the requirement prevents local access, exposure of contents to the model, or a specified combination. A path passed to local evaluation is not identical to bytes supplied as model context. However, a script can print protected contents; argument syntax alone cannot make an operation safe.

A future approved implementation could distinguish permitted local computation and metrics from prohibited raw-content exposure. That is an open design possibility, not an exception to apply before agreement.

### Deployment terminology matters

The reported `~/.copilot/hooks` directory is GitHub's user-hook location even when files are centrally distributed. Machine-wide Policy Hooks are another documented source. Central distribution alone proves neither successful discovery nor tamper resistance nor mandatory execution. Check effective configuration locations, permissions and update behavior on the selected path. [W1]

### Relationship to the runtime roadmap

The initial SDK probe uses synthetic material, does not implement DSpatch content exclusion and must not disable mandatory controls already installed. It establishes compatibility, not workplace readiness. The verified policy path is required before the real workplace pilot. Home providers do not automatically inherit the workplace configuration. [S1]

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

Proposed workplace behavior: prevent an affected operation when its mandatory control cannot be established, report why, and provide a recovery path. Confirm the exact rule with the responsible tooling team. Never silently degrade a workplace runtime into the synthetic-test configuration.

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

**Deterministic bridge tests** use controlled substitute scripts to exercise payload conversion, output parsing, ordering, timeout and process handling. They do not certify the managed scripts or provider context assembly.

**End-to-end tests** use the actual managed package in the intended runtime/platform. Verify prevention and output at the best observable boundary; state what remains dependent on provider behavior or organizational assurance.

A successful Windows/direct-SDK test does not certify Linux/AHP. Reuse test cases across actual deployment combinations, not unsupported conclusions. A worktree is not a security sandbox, a hook log is not a non-disclosure guarantee, and a completed workflow is not a passed security test.

<!-- pagebreak -->

## 4. Open decisions and rollout gate

### Questions to settle with the responsible tooling team

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

**S1:** Companion [*DSpatch: Runtime, Workspaces and Platform Evolution*](RUNTIME_PLATFORM_ROADMAP.md), v0.4. Existing working-memory and orchestration documents remain the product principles; this draft narrows their application to mandatory control integration.

**Status:** requirements incomplete; no workplace script has been reviewed or run, and no workplace deployment has been made. Sections 5 and 6 record what has been established with synthetic material.

## 5. Findings from the Copilot SDK path, 31 October 2026

Established with `@github/copilot-sdk` 1.0.28 and runtime 1.0.105, from its typings, `tools.list`, `hooks.discover`, and a local stand-in model behind the real runtime (`app/tests/copilot-runtime.test.ts`). No real account, no managed package. This records facts about the path; it is not a security result and meets no gate of section 4.

**Hooks load natively.** With DSpatch's session settings (`enableConfigDiscovery: false`, `enableFileHooks: false`) a `preToolUse` command hook in `$COPILOT_HOME/hooks/` was found by `hooks.discover` and ran before a tool call. So the runtime's own loading is the path, and DSpatch adds no bridge and matches no rule itself: exactly one invocation. DSpatch does not set `COPILOT_HOME` or `baseDirectory`. Policy hooks in `/etc/github-copilot/policy.d/` and `C:\ProgramData\GitHub\Copilot\policy.d\` were not tried; GitHub documents that they load first and cannot be disabled by `disableAllHooks`. A hook in the repository under review did not run. `DSPATCH_COPILOT_REQUIRE_HOOKS=1` refuses Copilot work unless the runtime reports an enabled `preToolUse` hook from a user or managed source. Whether a hook is the right one is not checked; the requirement only prevents silently working without any.

**GitHub's own content exclusion.** GitHub's documentation says it does not cover the Copilot CLI or agent mode. Do not count on it here. A repository-scoped rule could not follow a revision folder anyway: that folder is outside the repository, and `enableHostGitOperations` is off for review.

| Data flow | What covers it now |
| --- | --- |
| `view`, `glob`, `grep` in analysis | The allow-list, `onPreToolUse` and `onPermissionRequest` confine them to the revision folder, links resolved. A managed `preToolUse` hook sees the call too, with a path **inside the revision folder**: a path-pattern rule matches, a repository-relative rule may not. Not tried. |
| Tool results | Nothing of DSpatch's. A managed `postToolUse` hook sees them; not tried. |
| The diff and the question sent as a prompt (walks, delegated review, Worth checking, discussion) | **Uncovered.** No tool hook sees it. A file-glob exclusion does not stop it. `userPromptSubmitted` sees the prompt, but GitHub documents `modifiedPrompt` as honoured only for SDK callbacks, and nothing here has tried a deny. The review's Context says so. |
| Discussion context, the earlier history | Uncovered, as above. |
| Role and node instructions | Uncovered, as above. |
| Delegated sub-agents | Not reachable: `task` is off. |
| Main chat with shell | Commands run with the person's rights; `preToolUse` sees the line, not what the program reads. |

**Remaining obstacles to work code.** The prompt flow above needs a decision or a mechanism; the scripts have not been reviewed; the questions in section 4 are open. Synthetic or public material only until then, which is also what a failed or missing control must not silently change.

## 6. Tool hooks on DSpatch's path, 1 November 2026 (DSP-154)

Established with the same SDK and runtime versions as section 5, by real runtime runs of real scripts from a synthetic hook home, against a local stand-in model whose received requests are what "reached the model" means here (`app/tests/copilot-hooks.test.ts`). Repeated on Linux from the packaged host, with its own Node, over real ssh, with hooks in the account's default `~/.copilot/hooks` (`app/scripts/trial-package/hooks.mjs`). No real scripts, account or model. It is not a security result, and no gate of section 4 is met. Where this differs from section 5, this section is newer: tool results and post hooks have now been tried.

**The contract as it behaves.** `hooks.discover` and the runtime find `*.json` in `$COPILOT_HOME/hooks`, by default `~/.copilot/hooks`, with DSpatch's session settings. The runtime process runs the `bash` command, or `powershell` on Windows, with the session's folder as working directory and the runtime's environment, plus `COPILOT_HOOK_DIR` (the hook file's folder) and `COPILOT_PROJECT_DIR` (the session's folder). Standard input is JSON with `sessionId`, `timestamp`, `cwd`, `toolName` and `toolArgs`, as an object; `postToolUse` adds `toolResult` with `resultType` and `textResultForLlm`. The agent and the hooks run on the same machine, the host, whether DSpatch is used locally or over SSH. DSpatch runs no script, reads no rule, and each hook runs once per call.

| Outcome | What the runtime does | With DSpatch |
| --- | --- | --- |
| `preToolUse` answers `deny` | Stops the call, no post hook, the reason reaches the model | Same; the agent is told, and the refusal is logged |
| `preToolUse` exits 2 | Stops the call, as a denial | Same |
| `preToolUse` exits with another code, or its script cannot be started | Stops the call | Same; that call is refused and the turn goes on |
| `preToolUse` times out | **Runs the call** and sends its result to the model | Stopped before it runs: read, search, write, command and DSpatch's own tools tried. That call is refused, the model is told, and the turn goes on |
| `preToolUse` exits 0 with unreadable output | **Treats it as allowing** | **Not covered.** The runtime reports success, as for no output, so DSpatch cannot tell |
| `postToolUse` answers `modifiedResult` | The replacement is what reaches the model | Same |
| `postToolUse` answers `additionalContext` | Added to the result for the model | Same |
| `postToolUse` answers `permissionDecision` | Ignored | Same |
| `postToolUse` errors or times out | The original result goes on | The turn is stopped and says that result may have reached the model. **It is not held back**: the failure is reported after the result has left the hook stage |
| A tool fails | `postToolUse` does not run, so the error text reaches the model unseen | **Not covered** |

So a post hook can remove a result before the model sees it when it runs and answers, and this runtime honours that. It cannot be relied on when it fails. What a real script does is a separate question: section 2's warning about its actual function stands.

**How a failed pre hook is stopped.** The runtime reports `hook.end` with `success: false`, and asks `onPermissionRequest` after that and before the tool runs. DSpatch's existing permission callback refuses there. A call that asks no permission, such as DSpatch's own tools, is refused by DSpatch before it runs, so it has no effect; its `onPostToolUse` callback also holds back the result of any such call that ran regardless (DSP-164). **Only the identified call is refused (Niclas's decision, confirmed by him on 3 November 2026).** A failed or timed-out `preToolUse` hook refuses the tool call it answered for, before it runs and with no side effect, and the turn goes on; the model is told the call was not run. The calls are known from the hook's `hook.start`. Where a failed pre hook names no call DSpatch can identify, and for a failed `postToolUse` hook, whose result may already have left, the turn is still stopped, as it is for a failure of the runtime or of DSpatch's own controls. No script runs twice. This relies on that order, which the tests pin for this runtime version; recheck it on an upgrade. Per Niclas's instruction of 1 November 2026 this is stricter than GitHub's documented timeout behaviour (section 2), and it applies to every `preToolUse` and `postToolUse` hook in force, not only one marked mandatory. The responsible tooling team has not confirmed the rule (section 4).

**Required hooks.** `DSPATCH_COPILOT_REQUIRE_HOOKS=1`, or a file `copilot-hooks-required` in the host's data folder, refuses Copilot work when no enabled user or managed `preToolUse` hook is reported. The file exists for a host started over SSH, which does not get the person's variables. Anything of that name counts, whatever it holds, a link leading nowhere included, and so does a folder that cannot be looked in: only a certain absence means no requirement. It is read at every session start and resume, before the sign-in is asked about, so a host without a login refuses too, and adding or removing it needs no host restart. A session already open is not affected until its next start or resume. It holds across installs and updates: hooks live in the person's home, not in a package. A broken or unreadable hook file gives no hook, so it is refused like none; without the requirement, it silently means no hooks. Verified with the real host (`tests/copilot-hooks-required.test.ts`) and with the packaged host started over ssh in its default data folder, with no variable set (`scripts/trial-package/hooks.mjs`). There the session that passes stops at the sign-in, because no launch setting reaches a stand-in model; that a passed session works was shown on the adapter with the stand-in model. Whether a hook is the right one is not checked. The agent's shell runs with the person's rights, so it could change a hook in the home; policy hooks are the documented answer and have not been tried.

**Search and shell.** `preToolUse` sees the call, not what it will read.

| Path | With a path rule in a pre hook | With a post hook reading results |
| --- | --- | --- |
| `view` of the path | Denied | Not reached |
| `grep` or `glob` naming the path, or a command containing it | Denied | Not reached |
| `grep` of the whole folder | **Passes**, and matching lines reach the model | Caught if the script recognises the content |
| `glob` of the whole folder | **Passes**, and file names reach the model | As above |
| A command that does not contain the path, such as a wildcard, a variable or a program that reads it | **Passes** | Caught if the script recognises the content; the command has run |

The tests' post hook recognises a known marker, which a real rule on paths cannot do. A real script's rules may be able to judge a search's arguments; that is unknown until it is reviewed.

**Exported revisions.** Walks, delegated review, Worth checking and code questions read `<data>/reviews/revisions/<pair>/base|target/…`, and the session's folder is `<pair>`. The hook therefore sees `cwd` and `COPILOT_PROJECT_DIR` as that folder, which is no Git repository, and a path such as `…/<pair>/target/src/file.ts`. A pattern on the end of the path, such as `**/secret/**`, matches. A rule anchored at a repository's root does not, because the path relative to `cwd` starts with `target/`. A rule on the repository's location or name, or a script asking Git for the repository, gets nothing it recognises, and whether the script then allows or denies is its own behaviour. Results keep their link to the repository and commits as before: they name repository paths at a commit, not the folder. **The real script must be tried against this layout before review is used with protected material.** Both sides of a change are there, so a rule must hold for each. Since DSP-175 (5 November 2026) the same folder can also hold `<pair>/context/<name>/…`: other repositories of the workspace, written from Git's objects at a recorded commit, as read context. A hook sees those paths too, relative to `cwd` as `context/<name>/…`; a rule anchored at a repository's root, or one that asks Git about the repository, matches them no better than `target/`, so the same trial applies to them. A code walk may show such a place to the person; the window reads it from Git at the recorded commit through the review's context record, not from the analysis folder or a working copy.

**Stop during a hook.** `session.abort()` does not answer until a running hook has ended, which used to hold back DSpatch's escalation for as long as the hook ran. `session.abort()` does not stop the hook either. So the turn ends within the eight-second bound by ending the runtime, and the tool does not run. Each session has its own runtime process, so no other session is touched, and the process tree under that runtime goes with it, which ends the hook script instead of leaving it running (`forceStop` alone left it). With two sessions on one adapter, a stop during one's slow hook left the other working through its answer, exactly once; a further turn, a new session and a resume of the stopped one then worked, and no event of the stopped run came later. Measured on Linux. The Windows branch (`taskkill /T /F`) has only been simulated. A process that left the tree on purpose, such as a double-forked daemon, is not found. A runtime costs about 25 MB of its own memory and 70 ms per session, until the adapter closes.

**Text that passes no tool hook.** None of this touches what DSpatch itself puts in a prompt: the diffs and file lists of walks and delegated review, marked lines and the question and context in the review discussion, the question and excerpt of a code question, Worth checking's material, what a person writes or pastes in chat, role and node instructions, loop handovers and results passed to the next step, and earlier history of a resumed conversation. Those flows are unfiltered, and this task builds no filter for them. A review question with Copilot or Claude does have tools, the same read-only access as a walk, so what the agent reads in the revisions passes the hooks; only Cursor's discussion stays tool-free. (An earlier version of this section and of the report on it said review questions offer no tools. That was wrong.)

**Surfaces.** All Copilot work uses one adapter. Project chat and loops use the chat policy; reads, searches, writes, commands, failures and Stop were tried on it through the adapter, not through the chat and loop services. Walk generation was run through the real job service in a real revision folder; the review discussion's questions, from the diff and from a walk, *Explain this*, *Explain more simply* and follow-ups were run through the real discussion and job services with the real runtime (`tests/copilot-review-questions.test.ts`): a definition outside the excerpt is read at the commit asked for, a denying hook stops the read before the model, writes and commands do not run, and references are checked at their commit. Delegated review uses the same policy and folder. Remote differs only in where the host runs; the trial shows the adapter and hooks on a machine reached over ssh, not a turn over DSpatch's own tunnel, because a real turn needs a sign-in.

**Not tried.** Windows at all: the fixture has a PowerShell path, which has only been read. Policy hooks. Real scripts, including the 15-second timeouts of the reported example. Two hooks on one event. Tools running in parallel in one model response. Delegated sub-agents remain off. A real model's handling of a denial.
