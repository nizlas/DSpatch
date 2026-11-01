---
id: DSP-157
title: Release-first README and user tutorial
status: Review
assignee: []
created_date: '2026-11-01'
labels: [documentation]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write root README.md and TUTORIAL.md for people installing DSpatch from a GitHub release, developers running a clone on their own branch, and first-time users exploring interactive work, loops and review. Provide a complete review walkthrough with discoverable interactions. Keep the documents independent of individual people, machines and trial dates. Work on a separate documentation branch while release packaging continues; do not modify release artifacts or product code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 README gives concise release installation and source development instructions.
- [x] #2 Tutorial explains interactive work, loop transitions and review, including code selection and integrated agent questions.
- [x] #3 Instructions and links are checked against repository code; limitations and planned features are distinguished.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on docs/getting-started-tutorial, based on b09c825. README now leads with release installation, then source development on a personal branch. TUTORIAL covers review, code-selection questions, shared Discussion, context expansion, walks, delegation, interactive chat, loop controls and remote work. Existing README entry anchors are preserved.

Validation: checked commands against app/package.json and dev.mjs, controls against renderer and shared loop code, setup against docs/INSTALL.md and provider setup code, and all 32 relative Markdown links against repository paths and available heading anchors. Fenced code blocks are balanced. No private machine names, individual trial references or dates occur in the two documents. Main advanced to 2a0985a during writing; its changes are release-related and do not modify these files. No installation or runtime tests were run for this documentation change. Public release assets were not yet listed at the last check, so instructions use version placeholders and link to the release listing. Human usability review remains open.
<!-- SECTION:NOTES:END -->
