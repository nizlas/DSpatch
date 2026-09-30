---
id: DSP-59
title: 'Tell my messages from the agent''s, and render replies as Markdown'
status: Review
assignee: []
created_date: '2026-09-19 13:50'
updated_date: '2026-09-19 17:24'
labels: []
dependencies:
  - DSP-27
priority: high
type: feature
ordinal: 15616
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL v1.3 section 9.1, from trying the packaged window against the Cursor reference. User messages need distinct compact containers with a subtle background and border; agent replies stay clearly distinguishable below them in the same thread. A user message must not read as a faint quotation embedded in the agent's answer, which is what the current quoted-prompt styling does. Role labels stay readable at handovers without wrapping every reply in diagnostic text. Agent responses render as formatted Markdown: headings, emphasis, lists, links, inline code and fenced code blocks, so ordinary text stops showing literal ### and ** markers. Two constraints that are not negotiable. Literal characters inside code and code-like content are preserved rather than having their markers stripped, because a reply about Markdown or about shell syntax is exactly the kind of thing this product shows. And model output must never be rendered as raw HTML or script; whether that is achieved by a library or a small renderer is an implementation choice to justify, but the safety property is not. Formatting must work while streaming and again when a saved reply is reopened.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User messages are visually distinct compact containers, not quotations inside the reply.
- [ ] #2 Agent replies render headings, emphasis, lists, links, inline code and fenced code blocks rather than showing literal markers.
- [ ] #3 Literal characters inside code and code-like content survive rendering unchanged.
- [ ] #4 Model output is never rendered as executable HTML or script.
- [ ] #5 Formatting is correct during streaming and after a saved conversation is reopened.
<!-- AC:END -->
