# Workshop: an example of the reusable sections

A small graph with its own steps and roles — a coordinator, a maker, a scout, an assembler and two checks — that uses the two reusable sections DSP-227 added, and nothing from the generic agent network:

- **A model-class choice, "Work size"** (`size`): small, medium or large, each with its criteria. The coordinator decides it on every visit; the maker runs any class, the scout medium or large, and the parallel branches follow it too. The model of each class is the agent's *Model classes* setting, not the graph's.
- **A review-route choice** (`review`): standard or thorough, ordered weakest first. A missing or invalid value takes thorough, and after parallel branches the work carries the strongest route any branch had.
- **A parallel section**: the coordinator may answer `split` and write the slices; the crew (`crew`) runs each slice as a maker or a scout with its own size and review route, at most three at a time, each in its own worktree; the assembler integrates them and sends the whole to the quick check or the deep check by the review route. Its own model is always the medium class: a branch's class does not decide it. The coordinator's other outcomes, `make`, `scout` and `stop`, are its sequential path.

The graph was built the way a person builds one with DSpatch's chat agent: the bare graph with `propose_loop_graph`, then the two choices and the parallel section with `propose_graph_section`, then applied. `app/tests/graph-sections.test.ts` builds it again by the same path and writes these files when run with `DSPATCH_WRITE_EXAMPLE=1`. No purpose or role carries the `CHOICE:` or slice format: DSpatch writes those instructions from the graph, and the editor's message panel shows them.

To open it, open this folder (`docs/loop/examples/workshop`) as a project in DSpatch and choose **Workshop** in the graph editor.
