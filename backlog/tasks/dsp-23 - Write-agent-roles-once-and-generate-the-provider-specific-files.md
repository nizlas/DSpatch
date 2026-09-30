---
id: DSP-23
title: Write agent roles once and generate the provider-specific files
status: Review
assignee: []
created_date: '2026-09-15 20:29'
updated_date: '2026-09-15 22:24'
labels: []
dependencies: []
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Niclas raised it on 15 September 2026 while describing the graph editor: an agent node needs a way to point at its role description, and the providers declare roles differently even when the goal is the same. Copilot has skills, instructions and custom agents; Cursor uses other names and a different split across files. The same role should be written once and formatted into whichever files a provider expects.

[VISION.md](../../docs/VISION.md) already asks for this in principle — keep VS Code and Copilot compatibility in mind and isolate the Cursor-specific parts — and we now have five real roles in `.cursor/agents/` to test it against rather than a hypothesis.

### The trap, stated first because it is the likely failure

A single format that targets several providers tends to collapse to whatever they all support, and then quietly stops expressing the thing that mattered.

We have direct evidence of what would be lost. `readonly: true` is a Cursor concept, and it is not a detail: it shaped this project's entire delivery contract on 15 September, when a read-only Researcher was asked to write files it cannot write and `docs/loop/HANDOFF.md` had to state the delivery rule per role. If a provider has no equivalent, a portable role description **must not** imply it is enforced there. The same applies to model and effort selection, background execution and tool or MCP access.

So the rule this task follows is the one [VISION section 9.2](../../docs/VISION.md) already states for adapters: **missing support must be visible.** Portable content travels; provider capability is declared per target and its absence is said out loud.

### How the unique parts survive, decided with Niclas on 15 September 2026

He set the premise that makes this tractable: **once you are working in a framework you rarely port anything**, so the goal is not write-once-run-anywhere. The goal is that a role can be *targeted* at any of at least three frameworks, and that nothing is quietly lost when it is. Four mechanisms, in the order they matter:

**Requirements are portable; mechanisms are not.** This is the load-bearing idea. A role does not say `readonly: true` — that is Cursor's word for it. It says *this role must not be able to write files*. Each target then answers that requirement in one of three ways: enforced natively, as Cursor does with its own flag; achieved another way, such as permissions or a sandbox; or **not met**, in which case generation fails or warns and names the requirement. A degraded file that reads as though the requirement holds is the one outcome the task forbids.

**A per-target section, carried through verbatim.** Anything genuinely unique goes in a block addressed to that target and is copied out untouched. No translation is attempted, so nothing is lost in one — and a provider feature the format has never heard of still works.

**Targets are declared, and a role may support only one.** Since porting is the exception, a Cursor-only role is a legitimate and common answer. Generating for an undeclared target is refused rather than guessed at.

**Three targets on the map: Cursor, Copilot and Claude Code.** Niclas is considering trying Claude Code, so it belongs in the design even though nothing is built for it here. Only Cursor is implemented. What we believe about the other two is documentation we have read, not behaviour we have seen, and must be labelled that way until someone runs them.

### Scope

The source form, the generation, and the five existing specialists expressed in it. Generation only needs to target Cursor to be useful, because that is where the loop runs — but the format has to be honest about a second target rather than merely leaving room for one.

Two practical things worth deciding rather than discovering: a generated file must be identifiable as generated, and regeneration must not silently overwrite a file somebody edited by hand. Both are cheap now and painful later.

### What it enables

[DSP-21](dsp-21%20-%20Define-the-agent-loop-graph-format.md)'s agent nodes reference a role rather than carrying its prose, so a role can be shared between loops — which is what a future set of loops for different kinds of task would need. This task can proceed independently of the graph work; the roles exist already.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each role has one provider-neutral source holding what is genuinely portable: its purpose, responsibilities, boundaries, and what it must report and deliver.
- [ ] #2 The provider files are generated from that source for at least Cursor. A generated file says it is generated and names the source it came from, so nobody edits the wrong end.
- [ ] #3 A role states what it *requires* — for example that it must not be able to write, or must run in the background, or must use a particular model — and each target states whether it enforces that natively, achieves it another way, or cannot meet it. Generating for a target that cannot meet a requirement fails or warns, naming the requirement; it never produces a file that reads as though the requirement holds.
- [ ] #7 A role declares which targets it supports, and a role may support only one. Generating for an undeclared target is refused rather than attempted.
- [ ] #8 Each target has a section for what is unique to it, carried through verbatim, so a provider feature the format never anticipated can still be expressed without waiting for the format to learn about it.
- [ ] #9 Three targets are on the map — Cursor, Copilot and Claude Code — and the format accommodates all three. Only Cursor is implemented here. What is known about the other two is recorded as documentation-only until someone runs them.
- [ ] #4 Regeneration detects a generated file that was edited by hand and refuses or reports rather than overwriting the edit silently.
- [ ] #5 The five existing DSpatch specialists are expressed in the new form without losing anything their current definitions say. Anything that cannot be carried across is named in the task, not dropped quietly.
- [ ] #6 What was actually verified is distinguished from what was only read in documentation. Copilot's equivalents are not claimed to work until someone has run them.
<!-- AC:END -->
