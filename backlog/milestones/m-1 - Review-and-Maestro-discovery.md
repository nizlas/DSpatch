---
id: m-1
title: "Discovery – Review and Maestro direction"
---

## Description

After Phase 0 and DSP-6, use actual experience, an open survey of smart tools, and HCI/UI research to decide the next product direction with Niclas.

| Story | Outcome | Depends on |
| --- | --- | --- |
| [DSP-11](../tasks/dsp-11%20-%20Research-code-understanding-and-agree-next-direction.md) | Understand user needs from Phase 0. | DSP-6 |
| [DSP-12](../tasks/dsp-12%20-%20Survey-smart-tools-and-interaction-designs.md) | Survey smart tools and collect concrete interaction examples. | DSP-6 |
| [DSP-13](../tasks/dsp-13%20-%20Review-HCI-and-UI-research-for-code-understanding.md) | Review HCI/UI evidence, including relevant work outside programming. | DSP-6 |
| [DSP-14](../tasks/dsp-14%20-%20Compare-and-try-code-review-concepts.md) | Compare concepts and try a small selection with Niclas. | DSP-11, DSP-12, DSP-13 |
| [DSP-15](../tasks/dsp-15%20-%20Agree-the-next-direction-for-review-and-Maestro.md) | Agree the next review/Maestro increment and its assessment criteria. | DSP-14 |

The two surveys are independent outputs and need not wait for the user-needs walkthrough. They should include current and older approaches, research prototypes, relevant UI ideas outside IDEs and evidence that could challenge our initial ideas. They are not limited to validating Niclas's five seeds.

Compare those seeds and research-derived alternatives with the evidence, explore a small selection through sketches or prototypes, and consider the relationship to Maestro loop orchestration. No feature, interaction design, editor technology or agent topology is selected merely by adding this milestone.

Building the orchestration is **not** part of this milestone. [DSP-18](../tasks/dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md), split out of DSP-15 on 15 September 2026, defines and runs one bounded Maestro loop; it depends on DSP-6 only and is deliberately unassigned to a milestone. This milestone still considers orchestration, because DSP-15 chooses between it and review features, but it does not design or implement it.

The result is an evidence-based direction decision with Niclas and bounded next-story proposals. See the [research brief](../../docs/REVIEW_RESEARCH.md). This discovery is not required to close Phase 0 and does not implement the later product phases.
