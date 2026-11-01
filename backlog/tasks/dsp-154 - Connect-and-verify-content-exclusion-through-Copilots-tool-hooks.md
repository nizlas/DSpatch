---
id: DSP-154
title: Connect and verify content exclusion through Copilot's tool hooks
status: In Progress
assignee: []
created_date: '2026-11-01 12:00'
updated_date: '2026-11-01 12:00'
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

Changed: a failed `preToolUse` or `postToolUse` hook ends the turn; the permission callback stops the call of a failed pre hook, which the runtime would otherwise run after a timeout. Stop no longer waits for a running hook. `copilot-hooks-required` in the host's data folder asks for hooks where no variable reaches the host; that file's reading has not been run.

Remaining gaps, in the contract's section 6: unreadable output from a pre hook counts as allowing; a failed post hook cannot hold back its result; failed tools pass no post hook; a search of the whole folder and indirect commands pass a path rule; rules anchored at a repository's root do not match an exported revision; prompt content passes no tool hook.

Next: try the real scripts against a local project and a revision folder, on a machine where that is permitted.
<!-- SECTION:NOTES:END -->
