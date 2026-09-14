# Review, code understanding and Maestro: discovery brief

Status: planned work after Phase 0. Recorded 14 September 2026.
Governing direction: [VISION.md](VISION.md), especially sections 1.1, 3 and 14.
Tracking: [milestone m-1](../backlog/milestones/m-1%20-%20Review-and-Maestro-discovery.md), with stories DSP-11 through DSP-15.

This document records a research plan and early concepts. It contains no completed study, product comparison results or claim of novelty.

## Purpose and timing

HCI means human-computer interaction: how people understand and use an interactive system.

Continue the existing product plan through DSP-6. Then use the resulting workspace and Niclas's experience to reconsider the next direction for code review and Maestro orchestration. The discovery phase should help us decide what to build next and why, while keeping DSpatch useful.

A complete conventional diff is the Phase 0 baseline. Its layout and implementation do not become the permanent design just because they shipped first. Preserve access to actual code, changes and revision-linked evidence; avoid speculative architecture until a concrete experiment needs it.

## Questions to investigate

- Where do people lose their place while following control flow, data flow or changes across files?
- What helps them explain the difference in behaviour, identify dependencies and discover a faulty assumption?
- Which changes deserve attention, and how can guidance avoid hiding important details or creating false confidence?
- How should explanations, uncertainty, tests and potential benefits or risks appear together with code?
- What must remain understandable when Maestro performs several attempts autonomously, and when the user returns to detailed work?
- Which existing approaches have credible evidence of helping, and in which tasks or populations? What is merely described or demonstrated?

Start with observed needs. A visually impressive representation is a candidate, not evidence of better understanding.

## Stories and independent research outputs

| Story | Deliverable |
| --- | --- |
| [DSP-11](../backlog/tasks/dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md) | User-needs brief and baseline comparison tasks from Phase 0. |
| [DSP-12](../backlog/tasks/dsp-12%20-%20Survey-smart-tools-and-interaction-designs.md) | Open survey of smart tools and a gallery of concrete interactions. |
| [DSP-13](../backlog/tasks/dsp-13%20-%20Review-HCI-and-UI-research-for-code-understanding.md) | HCI/UI research synthesis with evaluation evidence and limits. |
| [DSP-14](../backlog/tasks/dsp-14%20-%20Compare-and-try-code-review-concepts.md) | Comparison of the seeds and research-derived alternatives; small concept trials with Niclas. |
| [DSP-15](../backlog/tasks/dsp-15%20-%20Agree-the-next-direction-for-review-and-Maestro.md) | Joint review/Maestro direction decision and bounded next-story proposals. |

DSP-11, DSP-12 and DSP-13 follow DSP-6. The surveys can progress independently of the user walkthrough. DSP-14 depends on all three, and DSP-15 depends on DSP-14.

The tool survey and research review are substantial inputs in their own right. Study current and older code browsers, debuggers, review and visualisation tools, and published prototypes; include useful interactions outside AI tools and IDEs. The research review also looks beyond programming at topics such as coordinated views, focus/context, semantic zoom, attention and communicating uncertainty. Explain any proposed transfer into DSpatch rather than treating it as already established.

For tools, preserve a screenshot, linked demonstration or clear interaction walkthrough, with the version/date and provenance. For research, preserve the question, method, participants/tasks, findings and limitations. Look for failure, mixed results and constraints as well as successes. A feature checklist or list of competitors is not a sufficient output.

Search broadly enough to encounter alternatives before selecting concepts. The findings may redirect the project, reveal a useful existing solution or show that an appealing idea has drawbacks. The five seeds below are comparison material, not a filter that all research must fit.

## Niclas's concept seeds

These phrases describe intentions, not fixed commands, requirements or final UI designs. They may be combined, changed or discarded. The first concept's “tree” means an overview of code/files; whether it also needs symbols or a call graph remains open.

| Concept | Intended help | Open design questions | How a small trial could assess it |
| --- | --- | --- | --- |
| “Take me through the code flow” | Walk through a relevant execution or data path, highlighting locations and jumps in the code/file tree. | Who selects the path? How are branches, callbacks, async work and uncertain relationships shown? How does the user leave and return to the walkthrough? | Ask the user to explain the path and locate a relevant branch or dependency; observe orientation and navigation effort. |
| “Highlight the essential diffs” | Guide attention to consequential changes while preserving the full change set. | What makes a change essential? How are cross-file dependencies and unhighlighted changes exposed? Can the user challenge the selection? | Check whether users find a meaningful issue, including one outside the highlighted selection, rather than only reading fewer lines. |
| “Give me the conceptual difference” | Explain before/after behaviour, responsibilities or data flow beyond changed lines. | What level is useful? How do summaries link to both changed and relevant unchanged code? How are assumptions distinguished from established behaviour? | Ask users to describe what changed and what stayed the same, and check the explanation against code and available tests. |
| “Explain benefits/risks” visually and in text | Connect a claimed benefit or risk to the affected code and supporting evidence. | How much annotation helps? How do predicted consequences differ visually from measured results? How are trade-offs and uncertainty represented? | Ask users to identify a trade-off and the evidence needed to resolve an uncertainty; check for unjustified confidence. |
| “Zoomable minimap” or another change overview | Move between the overall shape of a change and local detail without losing context. | Is a file, symbol, dependency or behaviour overview useful? What should zoom reveal? Would a simpler overview work better? | Ask users to locate related changes and return to their previous position; compare orientation with the baseline. |

Every view must offer a route to the full diff and real code. Highlights and summaries must not silently remove remaining changes. Anchor an explanation to the revision it describes, and label relationships as observed, derived from analysis or hypothesised as appropriate.

## A bounded first study

At the start of each discovery story, record a manageable scope using the available mandate. Expand only to resolve a specific unanswered question. The first pass produces a useful decision packet, not an exhaustive survey or a finished editor.

1. **Observe the current workflow.** Use Phase 0 findings and a short walkthrough with Niclas on an identified build. Ask him to narrate how he understands a change and where he has to search, guess or reconstruct context. Keep his observations separate from agent interpretations. More developers can be included later if useful; early findings from one user do not establish general effectiveness.
2. **Study tools and UI research as separate workstreams.** DSP-12 examines concrete interactions in existing tools and prototypes. DSP-13 examines primary HCI/software-engineering studies and applicable UI/information-visualisation research outside programming. Include established work and negative or context-dependent findings. Record dates and versions for product claims and study limitations for research; share useful sources without duplicating the two deliverables.
3. **Build an evidence map.** For each relevant approach, record the problem, interaction, source, evaluation setting and results, limitations, applicability to DSpatch and questions left open. Distinguish an empirical result, documented capability, our own trial and inference. Record where we did not investigate; “not found in this search” is not “never done”.
4. **Compare and sketch.** Relate the evidence to all five seeds and invite Niclas's further ideas. Select one or two promising interactions for inexpensive sketches or a disposable prototype; include alternatives suggested by research. Compare with the existing conventional diff and explanation workflow using the same or comparable code-change tasks.
5. **Choose the next direction together.** Present the evidence, sketches, trade-offs and recommendation to Niclas. Select a bounded next increment, its user value and assessment criteria, and list what is deferred. Creating a sketch does not approve its production implementation.

Where useful, keep reusable notes under `docs/research/`. Do not create an elaborate reporting system before it is needed. A source/observation table and a concise decision record are sufficient.

## Example comparison tasks and observations

Possible tasks include explaining a cross-file behaviour change, following a callback or asynchronous path, distinguishing refactoring from a semantic change, and finding a risk absent from an agent summary. Choose examples small enough to inspect independently but representative of the question being studied.

Record comprehension accuracy, issues found or missed, ability to locate supporting code, orientation, perceived effort and confidence compared with correctness. Time and number of clicks can be supporting observations; they do not replace understanding. Test whether a user can challenge a convincing but incorrect explanation.

Use comparable tasks and vary the order where practical so prior exposure does not make one view look better. Report the small sample and task limitations honestly. Performance, readability, keyboard access and cues beyond colour remain part of assessing a usable interaction.

## Connection to Maestro

Consider review during interactive work, after an autonomous attempt and across several attempts. What should the user see first, how can they inspect the evidence, and what happens to their review when a new candidate appears?

Assess which concrete information a promising interaction needs: for example goals, attempts, candidate revisions, changes, test results or decision history. Separate those needs from speculative storage schemas and UI architecture. The initial study need not implement an orchestrator or a general graph engine.

Discuss the next increment across both directions: improve human code understanding, introduce a bounded Maestro workflow, or combine a small amount of each if the dependency and user value are clear. Autonomy is not a prerequisite for review innovation; human-interactive work remains a full mode.

The existing [Maestro orchestration proposal (PR #7)](https://github.com/nizlas/DSpatch/pull/7) is input to this discussion, not evidence of an implemented system. The study should not depend on that PR being merged.

## Completion and handover

The decision packet should contain:

- The observed user needs and limits of the observations.
- A dated map of relevant prior work and evidence.
- An assessment of all five seeds, including alternatives, unresolved questions and reasons for selecting the small experiments.
- Sketch/prototype comparisons with the baseline and any human feedback.
- A recommendation covering review features and Maestro, then Niclas's recorded direction decision and a bounded next task proposal.

Keep each story in Review while its own required human assessment is pending: user observations for DSP-11, concept trials for DSP-14 and the direction decision for DSP-15. DSP-12 and DSP-13 can be completed on their evidence deliverables without inventing another human gate. Complete each task only when its criteria are satisfied. Do not treat the research plan, an attractive prototype or agreement to continue through DSP-6 as approval to implement all the concepts.
