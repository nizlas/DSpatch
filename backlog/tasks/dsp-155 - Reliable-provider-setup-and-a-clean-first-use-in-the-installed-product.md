---
id: DSP-155
title: Reliable provider setup and a clean first use in the installed product
status: In Progress
assignee: []
created_date: '2026-11-01 18:00'
updated_date: '2026-11-01 18:00'
labels:
  - integration
dependencies:
  - DSP-153
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's trial of the installed .deb on Ubuntu, 1 November 2026: Claude was installed but a send failed for want of zod, the failure led to a Cursor connection check, and the start page carried unstyled setup buttons and long text. A provider's support must be complete when it is called installed, an incomplete one must be repairable in the app on the right host, every setup step and failure must belong to the provider of the operation, and first use must be one short dialog.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An installation is complete only when the SDK and its modules load from the real install location and a tool server can be built
- [ ] #2 An incomplete installation is repaired in the app, on the host doing the work, keeping sign-in, conversations and settings
- [ ] #3 Setup, sign-in, checks and failures belong to the operation's provider; no automatic switch; late answers are dropped; a Claude failure contacts nothing of Cursor's
- [ ] #4 One Get started dialog for Claude and Copilot, none when ready; Cancel and failure leave the app usable and the draft kept
- [ ] #5 Sign-in is the vendor's browser flow, a valid login is reused, a one-time code is shown, completion is detected, and nothing is sent automatically
- [ ] #6 A failure shows once with an action that helps; technical detail stays in diagnostics
- [ ] #7 What ships and what is fetched is documented, with sources for any distribution claim
- [ ] #8 Verified from the packaged product in a clean environment, with screenshots reviewed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (1 November 2026): root causes traced. `packagesFor` in `provider-setup.ts` dropped every lockfile entry marked `peer`, among them zod and @modelcontextprotocol/sdk, and `installed()` read only a marker file. `App.tsx` called the Cursor-only `getConnection` after any failed run, whatever the provider.
<!-- SECTION:NOTES:END -->
