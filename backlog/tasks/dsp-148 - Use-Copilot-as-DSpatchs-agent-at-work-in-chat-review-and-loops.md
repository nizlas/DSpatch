---
id: DSP-148
title: 'Use Copilot as DSpatch''s agent at work, in chat, review and loops'
status: To Do
assignee: []
created_date: '2026-10-27 16:09'
labels:
  - integration
dependencies:
  - DSP-133
priority: high
type: feature
ordinal: 50500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### The problem it solves

The first external user trial runs on a work computer, where Claude must not be installed or run and the Cursor account is closed. Without a working Copilot provider, DSpatch has no agent there. This story makes Copilot a full provider in DSpatch through the Copilot SDK. A person at work can then choose Copilot explicitly and use it in the main chat, in the review discussion and in loop runs, each with the permissions that surface already has.

### The flow that must work

1. A person installs DSpatch on the work computer with the basic installation and starts it. Nothing of Claude is downloaded.
2. They choose **Copilot** explicitly as the agent and sign in with a login flow the work environment supports, using the work account. DSpatch shows which account and which model are in use.
3. **Main chat:** they give a small task. Copilot does the work with its own tools, including its own commands for building and testing, and DSpatch shows the activity, the real diff and the commands with their reported results.
4. **Review discussion:** they open the bundled DSP-116 example review (DSP-129) and ask about the code. The question goes to Copilot text-only, with no tools, and the *Context* shows what was sent.
5. **Loop:** they choose a loop definition with Copilot as the agent. Each step works with that step's permissions, and the run is recorded as for other providers.
6. They cancel during a turn, and the window says whether the stop was confirmed. They resume a conversation later, or are told plainly that a new session is needed.
7. A failure (no login, no entitlement or credits, the SDK missing, a control that denies an action, a provider error) is one plain sentence with a way forward. The details are in Session details.

### Governing decisions

- **Order and place.** [RUNTIME_PLATFORM_ROADMAP.md §1.2](../../docs/RUNTIME_PLATFORM_ROADMAP.md) (Niclas, 26 Oct 2026, reaffirmed 27 Oct 2026):
  - The Copilot SDK integration is developed and verified on the work computer with approved Copilot tools and the work account's credits.
  - Claude must not be installed or run there.
  - Copilot must work before the first external user trial, which uses the bundled DSP-116 example (DSP-129). General walk generation is not required.
  - Linux and Claude are tried at home.
- **One provider boundary.** Roadmap §2 "Keep the product common" and §4 P3b: Copilot goes behind the existing `AgentAdapter`/`ChatAdapter` boundary. The main chat, loops and review reuse the same adapter without duplicating product logic.
- **The runtime owns its inner loop and tools.** INTERACTION_MODEL.md §1, §5, §6 and §8, and AGENTS.md "Follow the decided design".
  - Copilot's own tools and agent loop are used.
  - DSpatch applies its decided controls and observation at the runtime's boundaries (permissions, hooks, events), as DSP-146 does for Claude.
  - DSpatch does not add a command tool of its own, and it does not approve the agent's ordinary commands.
- **No silent substitution.** Roadmap §1.2 and DSP-117/DSP-136:
  - The provider choice is explicit.
  - There is no silent fallback to another provider, and none to separately billed API use.
  - A session is never resumed through another provider.
- **Content exclusion.** The [content-exclusion contract](../../docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) (a draft, scoped to the Copilot runtime) and roadmap §5 P4A. See the section below.
- **Steering is DSP-147.** INTERACTION_MODEL.md §3.1: steering and separate manual command runs are DSP-147, which Niclas prioritised before this story on 28 Oct 2026. This story establishes what the Copilot runtime offers for steering and implements `AgentAdapter.steer` for it where it exists (DSP-147 AC #7); without it, a message during work waits for the next step or the end of the turn, as for any runtime without steering. Not a blocker for the first trial.

### Content exclusion, anchored in the existing contract

- **Reuse the organisation's actual control mechanism**, not a copy of its rules (contract §1). Commit no centrally supplied rules, scripts or credentials (contract §2).
- **Prefer the runtime's own hook loading** when it meets the requirement. First establish whether the Copilot runtime natively discovers and runs the managed hooks, at which configuration location, and whether that is effective. Add a thin SDK-callback bridge only if it is not. There must be exactly one invocation and no duplicated rule matching (contract §2, roadmap P4A).
- **Cover the relevant data flows** (contract §3): the agent's file and command tools, tool results, errors and diagnostic output, and content DSpatch itself supplies. That includes the prompt, attachments, the review discussion's envelope and role or node instructions. Delegated work is covered on its real enforcement path, not by assumed inheritance.
- **Keep the evidence layers apart** (contract §1 and §3):
  - A synthetic compatibility trial shows that the integration works. It makes no claim that work material is protected.
  - Verified use with work material requires the agreed enablement gate: the responsible tooling team's requirements, the real managed package on the actual runtime, and the prevention, failure and recovery scenarios.
  - Never silently degrade to the synthetic configuration.
- **Questions for the responsible tooling team stay open** until that team answers them (contract §4): exact scripts or an equivalent, the information-flow boundary, platforms, timeout and failure behaviour, deployment and updates, and the evidence owner. DSpatch does not invent an approval process of its own.

### Scope

- A Copilot adapter behind the existing provider boundary.
- Copilot as a choice wherever an agent is chosen: the main chat, the review discussion and loops.
- Explicit provider choice, a supported work-account login, model choice, session isolation, cancellation, resume, and plain error handling.
- The runtime's tool and permission configuration per surface:
  - main chat and loop work steps: development tools, as for Claude;
  - review discussion: text-only and no tools (DSP-132);
  - loop steps: as the step's agent and node allow (DSP-138, DSP-139).
- Command recording through the runtime's own hooks or events, where they provide it.
- The content-exclusion integration as above.
- An installation profile in which the basic installation at work fetches nothing of Claude (DSP-133 already provides this; keep it true).

### Out of scope

- Steering and manual command separation (DSP-147).
- AHP and the VS Code Agent Host (DSP-110 stays an independent investigation and is not a dependency).
- Remote host-client operation (DSP-111).
- Linux at work.
- General walk generation.
- A DSpatch policy engine of its own.
- Copilot App or canvas.
- Any Claude installation or run on the work computer.

### Already in place, to reuse (not Copilot-specific; verified for Cursor or Claude, not for Copilot)

- Explicit provider choice and provider-scoped sessions (DSP-117, DSP-136).
- Provider-neutral loops (DSP-138) and per-agent capability statements (DSP-139).
- The review discussion through the shared adapter, text-only (DSP-132).
- Shell commands recorded through the runtime's hooks (DSP-146).
- The Claude SDK kept out of the basic installation (DSP-133).
- The cancellation sequence with confirmed or unknown ends (DSP-3, DSP-115).
- Conversation continuity and provider resume rules (DSP-4, DSP-122).

Nothing Copilot-specific exists yet.

### Verification

- The criteria that concern the real SDK, the login, the work account, the managed controls or the external trial require evidence from the real Copilot SDK on the work computer.
- Unit tests and a substituted SDK may cover DSpatch's own wiring. On their own they satisfy no such criterion, and they are reported apart.
- No Claude component is installed or run on the work computer for this work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On the work computer, the basic installation fetches no Claude component, and choosing Copilot downloads or starts nothing of Claude or Cursor; shown on the real work computer.
- [ ] #2 Copilot is chosen explicitly; signing in uses a login flow the SDK documents and the work environment supports, with the work account; DSpatch reads, stores and extracts no token; without a usable login or entitlement the window says so in one sentence and nothing falls back to another provider or to separately billed API use.
- [ ] #3 The model in use is chosen explicitly or shown as the runtime's default, and the model actually reported by the runtime is recorded per turn; an unreported model is recorded as unknown.
- [ ] #4 In the main chat, Copilot completes the shared synthetic code-change task with its own tools, including its own build or test command; DSpatch shows the real diff and the commands with their reported results, and the result is checked independently of the agent's account (roadmap P3b exit gate).
- [ ] #5 In the review discussion, a question about the bundled DSP-116 example goes to Copilot text-only with no tools, and Context shows exactly what was sent.
- [ ] #6 A loop run with Copilot as the agent runs each step with that step's permissions and is recorded like a run with another provider.
- [ ] #7 Main chat, review discussion and each loop step keep their own provider sessions; a conversation is never resumed through another provider; a resume that cannot be confirmed continues explicitly in a new session built from DSpatch's persisted context.
- [ ] #8 Cancelling during a turn and during a command ends with the stop shown as confirmed or not confirmed, according to what the runtime and DSpatch actually observed.
- [ ] #9 Missing SDK, no login, no entitlement or credits, a control denying an action and a provider error each read as one plain sentence with a way forward, with the details in Session details.
- [ ] #10 The content-exclusion integration follows the contract: it is established and recorded whether the Copilot runtime loads the managed hooks natively, exactly one invocation path is used, and the relevant data flows (tool use, tool results and errors, content DSpatch supplies) are covered or explicitly listed as uncovered.
- [ ] #11 Synthetic compatibility results and verified use with work material are reported separately; work material is used only after the enablement gate the contract describes, and the open questions for the responsible tooling team are recorded as open until answered.
- [ ] #12 Every criterion about the real SDK, login, work account, managed controls or the external trial is backed by evidence from the real Copilot SDK on the work computer; tests with a substituted SDK are reported apart and do not satisfy them alone.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created 27 Oct 2026 on Niclas's explicit direction. Planning only: no implementation, installation or provider call has been made.

Existing cards checked: none covered the Copilot integration. Roadmap P3/P4A existed only as document sections.
- DSP-1 lists outstanding VS Code/Copilot compatibility tests and is not reopened.
- DSP-110 (AHP) is an independent investigation and not a dependency. The roadmap's P4B decision gate (direct SDK, AHP for Copilot only, or broader AHP) comes after this direct baseline.

Order: after DSP-111 in the agreed sequence (roadmap §1.2), but not dependent on it. Developed at work, so it can proceed in parallel with home work. DSP-147 was prioritised before it (Niclas, 28 Oct 2026). The first external user trial (DSP-129's example) needs it.

Open decisions, to settle before or during planning:
1. **Gate for the first external trial.** Does the first trial require the content-exclusion enablement gate? The trial uses only DSpatch's own public example material. The alternative is to run it under the work environment's existing mandatory controls, not disabled, with no content-exclusion claim. This depends partly on what the responsible tooling team requires for any SDK-based application. Needs Niclas's decision, informed by that team.
2. **The responsible tooling team's questions** (contract §4) are open. Implementation of the enablement gate waits for them; the synthetic integration does not.
3. **Facts for P3a**, to be established from the SDK's code, types and official docs at the start, then recorded:
   - the Copilot SDK package and version;
   - which login flows the work environment supports;
   - how the work account's credits are consumed and reported;
   - whether the runtime loads the managed hooks natively;
   - which hook or event points report commands and their results;
   - what cancellation guarantees.
   These are facts to establish. If one forces a departure from the decided design, it goes to Niclas.
4. **Copilot SDK in the basic installation.** Whether it is part of the basic installation or optional like Claude is an implementation choice within the decided bounds, unless the work environment's rules say otherwise.
<!-- SECTION:NOTES:END -->
