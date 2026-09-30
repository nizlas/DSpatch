---
id: DSP-21
title: Define the agent-loop graph format
status: Review
assignee: []
created_date: '2026-09-15 20:18'
updated_date: '2026-09-15 21:13'
labels: []
dependencies:
  - DSP-9
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this is a task of its own

Niclas chose this direction on 15 September 2026: build a rudimentary agent loop, edit it in a graph editor shaped like [the reference figure](../../docs/assets/agentloop_generisk.png), realise its rules in code, run it on something small, and iterate on what worked.

Two pieces follow from that — [DSP-22](dsp-22%20-%20Build-a-graph-editor-for-agent-loops.md), the editor, and [DSP-18](dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md), the runner — and he wants them built in parallel if possible. **The one thing they both need is the file between them.** Settling it first is what makes parallel work possible; leaving it implicit is what would make the two drift into incompatible assumptions and discover it late.

It is deliberately small. This is a contract, not a feature.

### What the reference figure already tells us

The figure is close to an executable specification, and the format should be able to hold what it draws without inventing anything:

- **Nodes of different kinds** — roles such as Implementer and Researcher, gates such as *Plangrind* and the *Skeptic påståendegrind*, and a router such as the *Slicetyp* diamond that sends work down one of several branches.
- **Ordinary edges** carrying the branch condition, such as `kod`, `research` or `experiment`.
- **Dashed edges for declared failures**, labelled with what kind of failure they carry: `specfel: planera om` returns to the Planner, `kapacitetsfel: eskalera ett steg` goes elsewhere. **These are what make the figure a loop rather than a flowchart**, and they are the rules most worth realising in code.
- **An iteration archive**, where every node writes its report and returns a reference — which our own external loop learned the hard way is not optional.

### The distinction the format must make explicit

Niclas raised it and it is the sharpest thing in the design: **a declared failure is not the same as something getting stuck.**

A declared failure is an outcome the loop understands and routes on. It belongs in the graph because it changes the path. A runtime fault — a call that hangs, a report that never arrives, a process that dies — is the machinery breaking, and it must **not** be expressible as an edge. Drawing it would give every node a "what if this hangs" edge and make the graph unreadable; handling it is the runner's job, through timeouts, journalling and resumption.

There is one small seam between them, and the format should decide it rather than leave it ambiguous: when the runner finally gives up on a stuck node, either the run stops for a human — which is what our own external loop does — or "no outcome" becomes a condition the graph may route on. If the second, the vocabulary of edge conditions gains one entry and nothing else changes.

### Two things Niclas added the same evening, which shape the format rather than this task's size

**An agent node points at its role, it does not contain it.** Role descriptions are their own artefacts — [DSP-23](dsp-23%20-%20Write-agent-roles-once-and-generate-the-provider-specific-files.md) makes them portable across providers, since Copilot and Cursor declare them differently. Referencing keeps the graph readable and lets a role be reused, which is what the next point needs.

**A graph is drawn for a framework, and the graph is where that is recorded.** Niclas proposed it and the reasoning holds: warnings need a target to be about something, and a target lets the editor say what stops working and what becomes possible if you change it. Two constraints make it safe rather than treacherous.

It is **stored in the file**. Inferring it from the connected account is a sensible default when a graph is first created, but a stored graph must not change meaning because it was opened on another machine or under another account. DSP-12's survey recorded the cost of getting this wrong outside our field: Word's Simple Markup let the *reader's* installation decide what the reader saw, and editors reported recipients missing changes without knowing changes existed. The same shape of mistake is available to us here.

And changing it is **a reported operation, not a migration**. Switching target lists what the new one cannot enforce and what it newly offers, and removes nothing by itself. A requirement silently dropped during a target change is the failure this whole design exists to prevent.

**There will eventually be several loops, not one** — a small loop and a large one, or one per kind of task. That is not built here, but the format must not assume a single graph, because retrofitting identity onto a format that assumed uniqueness is the kind of change that invalidates every file already written. Give a graph an identity and a statement of what it is for, and stop there.

### Bounds

No execution and no interface. A document, a schema or type definition, a validator, and one hand-written example graph. Do not design the full workflow language of [VISION.md](../../docs/VISION.md#14-implementation-phases); design what one bounded loop needs, and leave room rather than filling it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One documented file format describes a loop graph: nodes with a kind, edges with a condition, and the declared failure edges that make it a loop rather than a flowchart. The reference figure in docs/assets/agentloop_generisk.png can be expressed in it without inventing concepts while writing it down.
- [ ] #2 Node attributes are part of the format, not of the editor: at least an identifier, a kind, a model or model policy, and the limits that bound a step. An attribute the runner does not yet honour is marked as not yet honoured rather than silently ignored.
- [ ] #3 The format separates declared failures, which route through the graph, from runtime faults such as a hung or undelivered call, which are the runner's responsibility and are deliberately not expressible as edges. The document says why.
- [ ] #4 A hand-written example graph exists and is valid, so the runner and the editor can each be built and tested against it independently.
- [ ] #5 Validation reports what is wrong and where, in terms a person can act on. An unreadable or invalid graph is refused rather than partially loaded.
- [ ] #6 An agent node references its role description rather than containing it, so the same role can be used by more than one graph. A reference that resolves to nothing is a validation error, not a silently empty role.
- [ ] #8 A graph records the framework it is drawn for, stored in the file, and choosing it is the author's to make. The connected account supplies the default where one can be read, and nothing more. A graph may be drawn for a framework the current account is not connected to; that makes it not runnable here, which is reported, not refused. Once written it is the file that decides, not the environment reading it: the same file must not mean different things on two machines.
- [ ] #9 Validation is against the graph's target: a node whose role does not declare support for it is an error, and so is a requirement the target cannot meet. Changing the target is a reported operation — what is no longer supported, and what becomes available — and never a silent migration or an automatic removal.
- [ ] #7 The format does not assume there is only ever one graph. A graph carries its own identity and a short statement of what kind of work it is for, so a set of loops — a small one and a large one, or one per kind of task — is possible later without changing the format. Building that set is not part of this task.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
16 September 2026, Niclas: the reference figure's double-headed *frågar* arrows mean an agent fetching a summary from another agent through an API that is not specified yet. That is not a fourth edge condition. The first demo graph (our own development loop) omits it rather than inventing control flow. Recorded in [GRAPH_FORMAT.md](../../docs/loop/GRAPH_FORMAT.md#vad-formatet-medvetet-inte-uttrycker). Criterion #1's "without inventing concepts" does not require expressing that consultation until the API exists.
<!-- SECTION:NOTES:END -->
