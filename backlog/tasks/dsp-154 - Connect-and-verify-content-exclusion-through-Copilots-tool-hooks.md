---
id: DSP-154
title: Connect and verify content exclusion through Copilot's tool hooks
status: In Progress
assignee: []
created_date: '2026-11-01 12:00'
updated_date: '2026-11-01 13:00'
labels:
  - integration
  - security
dependencies:
  - DSP-148
  - DSP-153
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Use the scripts named by existing `preToolUse` and `postToolUse` hooks on DSpatch's Copilot path, and show with synthetic material what they do and do not stop. Niclas's instruction of 1 November 2026. No rule system, no policy editor, and no prompt filtering. The aim is the bounded hook integration for a colleague's first trial, not approval of every data path for sensitive material.

Governing: the content-exclusion contract, sections 2 and 5: native hook loading, one invocation, a failed control is not an approval. Stopping on a hook timeout is stricter than GitHub's documented behaviour, by Niclas's instruction that a missing script, script error or timeout must not silently pass a mandatory control. Findings are in the contract's section 6.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The real hook path is established for the installed runtime: discovery, process, input, working folder, environment and decisions
- [ ] #2 Hooks run where the agent runs, without the development repository, and an install or update does not lose them
- [ ] #3 With the real runtime and a stand-in model: allowed read works, denied read stops before the model, and search and shell paths are tested
- [ ] #4 A missing script, script error or timeout does not silently pass; what cannot be stopped is listed
- [ ] #5 Stop works while a hook runs
- [ ] #6 Prompt content DSpatch supplies is mapped and not claimed as covered
- [ ] #7 Denials and failures read as one sentence, with no hook details in the chat
- [ ] #8 Trial with the real scripts on a work machine, by Niclas
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified on Linux with synthetic scripts and a stand-in model: `app/tests/copilot-hooks.test.ts` and, from the packaged host over ssh, `app/scripts/trial-package/hooks.mjs`. Windows has not been run. Agent tests do not accept criteria that need Niclas's trial, so none is ticked here.

Changed: a failed `preToolUse` or `postToolUse` hook ends the turn; the permission callback stops the call of a failed pre hook, which the runtime would otherwise run after a timeout. Stop no longer waits for a running hook. `copilot-hooks-required` in the host's data folder asks for hooks where no variable reaches the host.

Three checks after that report, before the manual trial. **Review questions:** the report said they have no tools, which was wrong: since 30 October a question reads the revisions through `codeAccess`, and nothing needed changing. It had not been run with Copilot; `app/tests/copilot-review-questions.test.ts` now does, through the real services and runtime, from the diff and a walk. **Stop:** ending the runtime took every session on the adapter with it and left the hook process running; each session now has its own runtime, ended with its process tree. Linux measured, Windows simulated. **Required hooks:** a dangling link read as no requirement, sign-in was asked first so a host without a login never reached the check, and an adapter kept the value it was built with; all three fixed, and the file was run on the real host and on the packaged host over ssh (`app/tests/copilot-hooks-required.test.ts`, `app/scripts/trial-package/hooks.mjs`). No host restart is needed.

Remaining gaps, in the contract's section 6: unreadable output from a pre hook counts as allowing; a failed post hook cannot hold back its result; failed tools pass no post hook; a search of the whole folder and indirect commands pass a path rule; rules anchored at a repository's root do not match an exported revision; prompt content passes no tool hook.

Next: try the real scripts against a local project and a revision folder, on a machine where that is permitted.
<!-- SECTION:NOTES:END -->
