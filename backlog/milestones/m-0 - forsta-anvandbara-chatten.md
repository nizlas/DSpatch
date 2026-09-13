---
id: m-0
title: "Phase 0 – Make a real code change with DSpatch"
---

## Description

DSP-7 is preparation: try the development loop in Cursor and assess its planning before using it for DSP-1. DSP-1–6 deliver the product outcome below; calibration does not replace any of their criteria.

This proposal follows VISION.md sections 14–15 and Niclas's decision on 13 September 2026. After DSP-6, Niclas should select a repository, discuss a small task, let the agent change code, review affected files and a complete conventional text diff, and run a relevant build/test with results for the correct code version. Follow-ups, rework, cancellation, understandable error handling and continuing after restart are included.

Preserve existing manual changes. Reviewed changes and execution results must survive restart, clearly distinguishing historical results from current working-copy contents. Restart or reconnection must not automatically repeat a change request or command.

The milestone is reached when the whole workflow is technically verified on Windows, Niclas has assessed it in real use, and obstacles to everyday use have been resolved or explicitly accepted. Niclas may give early feedback on the first chat. DSP-5 tests code changes, diff and build/test once DSP-2 supports that whole workflow; DSP-6 assesses the combined result including recovery and restart.

TypeScript, React and Electron are the selected stack. Initial implementation and testing use Cursor on Niclas's Windows computer. DSP-1 verifies the stack and selects/tests the concrete connection, including a minimal packaged Windows experiment. The vision includes a consistent workspace on Windows and Linux; Linux support is incremental and Linux tests are not required for this milestone. VS Code/Copilot remain in the vision and must inform architectural choices, but implementation or runtime testing is not required to reach this milestone. Advanced code understanding, a custom editor, an autonomous product loop, complete cost accounting and external planning adapters belong to later phases. Automatic commit, push and PR handling are not required in Phase 0.
