---
id: DSP-118
title: Import the review and orchestration documentation update from 982cb84
status: Review
assignee: []
created_date: '2026-10-23 14:35'
updated_date: '2026-10-23 14:37'
labels:
  - documentation
  - review
dependencies: []
priority: medium
type: docs
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Import Niclas's documentation update of 23 October 2026, prepared from repository revision 982cb84, into the maintained Markdown. Prose only: no pilot, runtime work, application change or live call.

- docs/VISION.md 1.11 -> 1.12: version note and new section 3.4 "Walkthrough coverage and levels of engagement" (design proposals for a bounded pilot, not implemented).
- docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md 1 -> 1.1: new section 5 "Orchestration and independent review share the agent connection", including a dated implementation-boundary snapshot.
- docs/TASK_MANAGEMENT_AND_WORKING_MEMORY.md 0.2 -> 0.3: new section 11 "Review records without an orchestration dependency".
- docs/REVIEW_RESEARCH.md: optional short cross-reference to VISION section 3.4, keeping the brief's open design status.

VISION section 3.3 and RUNTIME_PLATFORM_ROADMAP section 2 stay authoritative for the standalone-review decision and the shared-runtime responsibilities. The Word files are reading copies regenerated from the Markdown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each file is compared with the current repository version before applying; no newer edit is overwritten and no version is downgraded; existing anchors and unrelated content are preserved
- [x] #2 VISION 3.4, orchestration section 5 and working-memory section 11 consistently describe standalone review input, optional identifiable supplementary input, shared AgentAdapter reuse without a shared live session, credentials or permissions, roadmap ownership of shared-runtime responsibilities, pilot proposals as unimplemented, review records bound to identified content and separate from provider-session resume, and same-repository implementation without a refactoring mandate
- [x] #3 The dated implementation-boundary paragraph matches the DSP-109, DSP-115, DSP-116 and DSP-117 cards and does not imply that Claude runs through the app's chat or that Linux or cross-process resume is verified
- [x] #4 Links and anchors resolve; public-repository wording holds; changes beyond the supplied prose are reported with the exact diff
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (23 Oct 2026): compare the three uploaded files with the repository at 982cb84, apply the intended sections, review meaning, status, ownership, links and anchors, commit locally without pushing.

Imported 23 Oct 2026 on 982cb84. Each upload was compared with the repository file first: all three were the repository version plus the intended additions (version lines, VISION 3.4, orchestration section 5, working-memory section 11); no newer repository edit was overwritten and no version downgraded. Applied hunks only at those places (git diff checked).
Review edits beyond the supplied prose (exact text in the commit diff): (1) explicit anchor `34-walkthrough-coverage-and-levels-of-engagement` before VISION 3.4, matching the 3.3 convention; (2) orchestration section 5 snapshot: "application restart recovery, cross-process session resume or Linux support", and DSP-117 described by its actual criteria (ledger keeps provider work unknown after a stopped or forced end; UI never shows an unconfirmed stop as an ordinary cancel) instead of "truthful ledger and UI handling of an unconfirmed stop", because the ledger already records an unconfirmed end as outcome-unknown since DSP-116; (3) working-memory section 11 links the roadmap's "Four different persistence requirements"; (4) REVIEW_RESEARCH gains one paragraph pointing to VISION 3.4 as hypotheses, not selected designs; (5) runs of blank lines collapsed and the trailing blank line removed.
Status snapshot checked against the cards: DSP-109, DSP-115, DSP-116 Done; DSP-117 To Do; live cancellation and same-session follow-up were in the experiment program; DSP-116 offline only.
Checks: links and anchors in the four changed documents resolve (scratch link check; pre-existing encoded backlog links not affected); the seven consistency points hold across VISION 3.3/3.4, orchestration section 5 and working-memory section 11, with RUNTIME_PLATFORM_ROADMAP section 2 owning the shared-runtime responsibilities; no organization-specific wording. No application tests (prose only).
Open question for Niclas: working-memory section 11 says an early review pilot can use "an isolated branch and worktree", while CLAUDE.md and the loop default to the main checkout unless Niclas asks for a worktree. Read as a future explicit request, there is no conflict; the text was kept.
<!-- SECTION:NOTES:END -->
