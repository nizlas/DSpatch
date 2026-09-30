---
id: DSP-58
title: Stop the conversation jumping and fighting itself for scroll
status: Review
assignee: []
created_date: '2026-09-19 13:50'
updated_date: '2026-09-19 17:24'
labels: []
dependencies:
  - DSP-27
priority: high
type: bug
ordinal: 15615
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas reported this from the packaged window on 19 September and INTERACTION_MODEL v1.3 section 9.1 records it. Sending must not jump the application to the top, including on the very first message of a session. There must be one primary vertical scroll area for the conversation rather than competing page and message scroll areas; code blocks may still scroll horizontally. When the user is following the latest messages, new messages and streaming replies stay in view. When they have scrolled back to read, their position is preserved as new content arrives, with an unobtrusive way to return to the latest. Status updates and agent handovers must not reset the position. Two leads, neither confirmed and both worth testing before believing: the transcript is a nested scroller with its own max-height and overflow-y, which is exactly the competing-scroll-areas shape the model rules out; and the effect that keeps the newest message in view calls scrollIntoView unconditionally on every render that changes the turns, an active answer or the loop turns, with no check for whether the user has scrolled away. Diagnose before fixing; the document deliberately does not assume the cause.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sending a message never scrolls the application to the top, including the first message of a session.
- [ ] #2 The conversation has one primary vertical scroll area.
- [ ] #3 Following the latest keeps new and streaming content in view; scrolling back preserves the reading position and offers a way back to the latest.
- [ ] #4 Status updates and agent handovers do not reset the scroll position.
<!-- AC:END -->
