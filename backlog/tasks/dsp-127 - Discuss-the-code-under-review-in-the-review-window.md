---
id: DSP-127
title: Discuss the code under review in the review window
status: In Progress
assignee: []
created_date: '2026-10-25 23:49'
updated_date: '2026-10-26 00:07'
labels: []
dependencies:
  - DSP-126
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 26 Oct 2026, step 2 of 2: the review window gets its own chat field and its own conversation for discussing the code and walk point under review, reusing DSpatch's shared chat and provider functions (no separate SDK integration, not the main chat's provider session). One conversation per review, messages bound to their points; no provider session per walk point. A question is bound to a stable context: review identity and reviewed revision/snapshot, current walk and point if any, relevant code ranges and any selection, the point's explanation and relevant review notes; the reviewed version, never later working-copy changes. Explains and reviews only: no code changes, no loops; enforced by existing tool and permission controls, not by prompt alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A question on the current point is sent with the stable context (review identity and revision, walk and point or the whole review, code ranges, selection, explanation, notes) without the user copying code; the next question's subject is shown compactly
- [ ] #2 An answer still belongs to the original question's point and revision when the user navigates during generation; the discussion survives reopening and a message leads back to its point
- [ ] #3 No provider send on opening review or navigating between points; no automatic or double sends
- [ ] #4 Separate conversation and session identity from the main chat, shared provider, streaming, cancel, storage and error handling; neither conversation receives, cancels or steals the other's session or answers; existing run gates respected with an understandable status
- [ ] #5 The discussion cannot change code or start loops, enforced by the adapter's tool controls; any limit of the current adapter stated concretely
- [ ] #6 The discussion can be shown and hidden; no permanent explanation wall, raw context dump or diagnostics in the normal view; technical context reachable separately
- [ ] #7 Verified offline with the presentation adapter through real windows, IPC and services, incl. streaming, cancel and errors not affecting the other conversation, drafts kept, normal and narrow width; nothing verified with a real provider
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (26 Oct 2026, run 20261026-090000-review-plan): planning, after DSP-126.

Plan (run 20261026-090000-review-plan: reports 001-planner + 003 addendum): a small ReviewDiscussionService, not a second ChatService (ChatService assumes one working-copy session: baseline snapshots, refusal of DSpatch's own working copy, project-keyed conversations, adapter replaced with the session). One text-only CursorSdkAdapter instance per discussion service (presentation substitute offline), lazily created, disposed when its window has closed and no turn runs; the main chat's Stop/cancel protections mirrored (abandonSend, cancel-confirmation grace, own-run vs provider-held run). Read-only limits for AC#5: (1) whether tools: [] removes user-level MCP tools is undocumented and unobserved; (2) Cursor user-level hooks and rules may still apply; (3) no live observation that text-only yields zero tool events; (4) the presentation adapter has no tools, so offline tests verify only DSpatch's choice of text-only and an empty cwd; (5) the reviewed repository's project hooks and ignore rules are not loaded and DSpatch itself supplies code to the model with no exclusion applied - the envelope builder is the future check point. Decision taken as recommended (Niclas may override): a review question is not blocked by a running loop or main-chat turn, and the reverse - resting on 'text-only writes nothing', which limit (1) leaves not fully established.
<!-- SECTION:NOTES:END -->
