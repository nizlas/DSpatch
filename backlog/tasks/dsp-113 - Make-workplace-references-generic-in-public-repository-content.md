---
id: DSP-113
title: Make workplace references generic in public repository content
status: Done
assignee: []
created_date: '2026-10-22'
updated_date: '2026-10-22'
labels:
  - documentation
dependencies: []
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas requested a public-repository cleanup: replace employer-specific names, internal project references and organization-specific examples with generic descriptions while preserving technical requirements, uncertainty and verification status. Scope: current tracked text content. Do not rewrite Git history or modify the home checkout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Employer and internal project identifiers are removed from maintained text without changing runtime behavior.
- [x] #2 Content-exclusion and runtime documents retain technical requirements and distinguish proposals, reported context and verified results.
- [x] #3 All tracked text files are scanned for related identifiers and obvious private endpoints or embedded credentials; findings and scope limits are recorded.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (22 Oct 2026): work from main at a97f4dfb05e0831ffdcb317336626cf29dda415e using an isolated API snapshot. Maintain task Markdown directly because Backlog CLI is unavailable in this snapshot. Review relevant documents, make generic substitutions, check the complete text snapshot, and publish one fast-forward commit. No home files or live provider calls are involved.

Completed: generalized internal naming history and an application-specific metric example in VISION.md; replaced organization/team identifiers and an internal configuration filename in the runtime roadmap and content-exclusion contract. The replacement filename is explicitly illustrative. Preserved runtime order, mandatory controls, reported provenance, unresolved questions and verification gates. Updated document versions and companion links. Added a compact public-content rule to AGENTS.md to prevent reintroduction.

Validation: read all 316 tracked text files at the base revision (source, tests, scripts, configuration, instructions, docs and backlog). Checked employer/internal-project identifiers, related workplace references, URL hosts, email addresses and common embedded-credential patterns. The only remaining matches for the employer's name are the ordinary geometric word in a published-tool research discussion. Credential candidates are explicit synthetic test values; found no obvious private endpoint or real embedded credential in these checks. Reviewed the documentation diff and companion links; runtime source, tests, package files and existing task cards are unchanged. No build or live-model test was needed for prose-only changes.

Scope limits: this is a targeted text review, not a guarantee that all sensitive information has been discovered. The eight tracked PNG images, older commits, external attachments and the home computer's unpublished files were not inspected or rewritten. Existing task/run identifiers and public provider/API names were preserved. No confidential source material was added to this report.
<!-- SECTION:NOTES:END -->
