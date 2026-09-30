---
id: DSP-77
title: 'Decide whether a loop run uses Cursor''s sandbox, and record the decision'
status: To Do
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 13:32'
labels: []
dependencies: []
priority: medium
type: feature
ordinal: 15709
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The only real containment knob in reach, and exactly the kind of thing that must be chosen rather than inherited as a side effect of a folder feature. electron-builder.yml already unpacks cursorsandbox.exe for it. Two facts going in. SandboxOptions is a bare enabled boolean with no paths, so it cannot express these folders and nothing else even in principle - containment and working roots are orthogonal rather than two views of one feature. And on this machine today, Cursor's own tooling refused a command saying the Windows sandbox helper only provides network proxy, not filesystem isolation; combined with the earlier finding that the sandbox denies outbound network by default, the expected trade on Windows is losing the network and gaining no containment. That is the worst available trade. It is not settled, because one refusal from the agent harness is not a measurement of the SDK path - hence measure, then decide, then write it down. Scope is measurement and a recorded decision, nothing else.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 It is established and recorded whether outbound network is denied, whether a write outside the working roots is prevented, and whether an ordinary loop step still completes.
- [ ] #2 The decision is recorded either way with its evidence and its date.
- [ ] #3 Nothing enables the sandbox as a side effect of another story.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
NOTED 2026-09-20 from Verifier report 014: the result store's path containment refuses absolute paths, drive letters, UNC, drive-relative, root-relative and .. escapes - twelve shapes checked - but does NOT consider symlinks. Unmeasured, not an observed hole. Belongs with whatever card next looks at containment, which is this one.
<!-- SECTION:NOTES:END -->
