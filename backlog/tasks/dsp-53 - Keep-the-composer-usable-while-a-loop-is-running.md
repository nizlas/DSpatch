---
id: DSP-53
title: Keep the composer usable while a loop is running
status: In Progress
assignee: []
created_date: '2026-09-19 08:48'
updated_date: '2026-09-19 12:28'
labels: []
dependencies:
  - DSP-27
priority: high
type: bug
ordinal: 15610
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today Send is disabled whenever the app is busy, which includes the whole of a loop run. So the chat stops being a conversation the moment work starts, and §4.3, §4.4 and §4.5 of the interaction model are impossible rather than merely unbuilt.

**Unlocking the box is not the delivery.** §9 asks for one continuous thread: the user's messages and the agents' replies in the same window, a question and its answer readable together, and an agent handover marked in that same thread with the role named. The reference is Niclas's own Cursor loop, which already works this way — DSpatch is reproducing a conversation that works, not inventing one.

**What v1.2 removed.** Version 1.0 proposed that a message during a run is a question by default, with a visible control to send it as an instruction instead. §7 retires that: a required message-type switch must not replace ordinary conversation, and interpreting intent belongs to the conversational agent rather than to a form. So this card unlocks the box and builds the thread; it does not add a classifier the user has to operate.

The hazard stays: a message during a run must not start a competing run in the same working copy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While a loop run is in progress the composer can still send a message.
- [ ] #2 A message sent during a run does not start a second run in the same working copy.
- [ ] #3 The user's messages and the agents' replies appear in one continuous thread, with a question and its answer readable together.
- [ ] #4 An agent handover is marked in that same thread, naming the role and saying briefly why control moved.
- [ ] #5 No message-type switch is required of the user for ordinary conversation.
<!-- AC:END -->


## Widened by INTERACTION_MODEL v1.3

<!-- SECTION:NOTES:BEGIN -->
This card's thread requirement (#3, #4) now has presentation requirements beside it in v1.3 §9.1, split out so this card stays about the conversation being continuous rather than about how it looks: **DSP-58** for one scroll area and no jump on send, **DSP-59** for distinguishable user messages and rendered Markdown, **DSP-60** for giving the conversation the main space.

Those three came from Niclas actually running the packaged window, which is the evidence this card's own criteria #3 and #5 were always going to need. They do not change what this card asks for.
<!-- SECTION:NOTES:END -->
