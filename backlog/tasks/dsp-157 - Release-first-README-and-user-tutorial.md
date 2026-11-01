---
id: DSP-157
title: Release-first README and user tutorial
status: In Progress
assignee: []
created_date: '2026-11-01'
labels: [documentation]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write root README.md and TUTORIAL.md for people installing DSpatch from a GitHub release, developers running a clone on their own branch, and first-time users exploring interactive work, loops and review. Prioritize a complete review walkthrough for the upcoming trial. Work on a separate documentation branch while release packaging continues; do not modify release artifacts or product code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 README gives concise release installation and source development instructions.
- [ ] #2 Tutorial explains interactive work, loop transitions and review, including code selection and integrated agent questions.
- [ ] #3 Instructions and links are checked against repository code; limitations and planned features are distinguished.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started from b09c825 on docs/getting-started-tutorial. Current focus: verify shipped controls and commands, write the two root documents in English, preserve existing documentation entry points, and open a documentation-only PR. Public release publication is concurrent work and has not been verified.
<!-- SECTION:NOTES:END -->
