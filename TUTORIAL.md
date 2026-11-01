# Using DSpatch

DSpatch brings three activities into one workspace: **talking with a development agent, delegating a larger effort through an agent workflow, and understanding the resulting code**. You choose how much work to delegate and how closely to follow it. The aim is to make larger changes manageable while keeping their purpose, behaviour and review decisions understandable.

## Why use a loop?

A loop lets you delegate a substantial effort while keeping control of its direction. An assignment can involve discovering what to build, researching alternatives, developing a concept, implementing it and evaluating the result. The work may unfold over many agent steps, with findings changing the plan along the way.

In interactive development, you and an agent organize the work through conversation. The agent can already investigate, edit files and run tests autonomously within one request. A loop adds an explicit structure around that autonomy: responsibilities, handovers, evidence to produce, checks and routes for revision or further investigation. Specialist steps can contribute different perspectives while working toward the same objective.

The fundamental difference is **how responsibility for carrying the work forward is organized**. A loop can coordinate research, design, implementation and assessment without requiring you to prompt each handover. Its structure can be reusable even when the assignment and the solution are entirely new. The graph defines responsibilities and decision routes; agents still have to discover the answers.

For example, a research-and-development workflow could receive this assignment:

> Develop a stronger AI model for this task, informed by recent research. Compare promising approaches, propose a design, implement and evaluate it, and present the evidence behind your decisions.

Research steps could find and assess relevant papers, design steps could propose competing concepts, and implementation and evaluation steps could test them. Results might lead back to more research or a revised design. The output should explain what was chosen, why, what the evidence supports and what remains uncertain—not just deliver code.

Human checkpoints in such a workflow let you steer at the level of goals and trade-offs. You might redirect the work toward lower latency, reject a data requirement or prioritize a different research direction, while leaving detailed investigation and implementation to the agents. This is the intended division of responsibility: sustained autonomous work with meaningful opportunities for human direction.

The expected benefit is the ability to carry a larger, open-ended assignment further with less manual coordination, clearer responsibilities and explicit assessment. Better results still depend on the quality of the roles, checks and evidence; several agents can share the same blind spot.

**Current scope:** DSpatch's external development workflow explores this broader approach; the application currently includes a simplified runnable subset and a smaller work/check loop. The research example above illustrates the wider concept, not a bundled, fully implemented research workflow. In the current application, you can steer a running loop through the project conversation and choose whether work steps start automatically or wait for you. These controls are described [below](#decide-how-much-to-participate).

## Review built around understanding

DSpatch's review flow is designed to help you understand a change's **purpose and behaviour**, as well as inspect its changed lines. The traditional diff and **code walks** provide complementary ways into the same review.

The **diff gives you the overview**: which files changed, the exact additions and removals, surrounding context, and what still needs review. A **code walk gives you a path through the behaviour**: related locations across files, the order and relationships that matter, and an explanation of how those pieces contribute to the purpose of the change. A walk may connect an entry point, a condition, a call and the state it updates, even when some of those locations are unchanged.

This is a central DSpatch concept: the explanation becomes a navigable sequence tied to specific code at specific revisions. You can follow the flow, examine a step in depth and return to the full diff to check what that path did not cover. A walk is an agent's interpretation, not an execution trace or proof of correctness.

Agent support is woven into this reading process. You can select an expression in the diff or a walk and choose **Explain this**, ask your own question in the shared **Discussion**, request a simpler explanation, or follow an answer's references into expandable code context. DSpatch carries the selected code, location and revision into the question. You spend less effort assembling context and directing a separate conversation before you can investigate the code.

The goal is to lower the barrier to reviewing complex changes while keeping actual understanding and review decisions with you. Reading a walk or receiving an answer never counts as approval. You can selectively delegate an assessment when you consider that appropriate—for example, for a well-bounded, lower-risk part of a change—and inspect the agent's findings and recorded approvals. You choose the scope; using agent assistance does not automatically hand over the whole review.

This tutorial describes the current user workflow. For installation, start with the [README](README.md#install-from-a-release). For version-specific limitations, read your [release notes](https://github.com/nizlas/DSpatch/releases).

## Choose your starting point

| You want to… | Start here |
| --- | --- |
| Understand or review an existing change | [Review a change](#review-a-change). No loop or prior DSpatch conversation is required. |
| Ask questions or develop interactively | [Work with an agent](#work-with-an-agent). |
| Coordinate an assignment across agent roles | [Use an agent loop](#use-an-agent-loop). |
| Use a repository and tools on another machine | [Work remotely](#work-remotely). |

There are two conversations to keep in mind:

- **Project chat** is where you investigate and develop the working project. The agent can edit files and run commands within its permitted access.
- **Review Discussion** belongs to a particular repository and pair of commits. It is where you ask about that code. The diff and code walks share this discussion; it is not a second development agent modifying your working files.

The same provider integration powers both, but their tasks and access differ. Preparing an explanation does not approve code, and reviewing committed code does not change your working tree.

## Review a change

For a first review, choose a repository with two commits you can compare and a change small enough to understand. Documentation and configuration changes work too: DSpatch can prepare readings as well as execution-oriented walks.

### 1. Open the repository and choose the revisions

1. Choose **Open Project** and select the repository folder. For remote work, connect first; the folder chooser then browses the host.
2. Choose **Open review**. If the workspace contains several Git repositories, choose one. You can also reopen an ongoing review from this entrance.
3. For a new review, click two commits in the log and check **From → To**, then choose **Review changes**.

The two clicks can be in either order. If one commit is an ancestor of the other, DSpatch uses the ancestor as **From**. If ancestry does not settle the direction, you choose it. **Reverse direction** explicitly swaps the comparison.

**From** is the old revision; **To** is the new one. The review reads these exact commits from Git, including surrounding code. Uncommitted edits are not part of this comparison. If you want to inspect a newly developed change here, commit the intended snapshot on your branch first.

The initial **Files changed** list is your overview. Each row opens a file and shows its review progress. You can use this view without generating walks or making any model call.

### 2. Explore the complete diff

Open a changed file. Switch between **Side by side** and **Unified** to use the layout you prefer.

| Control | What it does |
| --- | --- |
| **Show 20 more lines** | Expands a hidden region from the indicated direction. |
| **Show all** | Opens all the lines in that hidden region. |
| **Show entire file** | Shows the full file with changes still marked. |
| **Compact diff** | Returns to a compact view around the changes. |
| **↑** / **Files changed** | Returns to the file overview. |

Unchanged lines around each change are visible initially. Expand them whenever you need the containing function, earlier setup or later use. You can ask about unchanged code as well as additions and removals.

The traditional diff is sometimes called the **Gerrit-style view**. That describes its review layout; it does not mean this review is connected to a Gerrit server or that comments are being published there.

### 3. Select code and ask the agent

This is available in the traditional diff, code-walk panes and code opened through an answer's reference.

1. Drag across an identifier, expression or several lines of **code text**.
2. Choose **Explain this** beside the selection or in its right-click menu. **Ctrl+Shift+E** is the shortcut.
3. Read the answer in the review's **Discussion** panel.

**Explain this sends a question immediately.** For your own wording, choose **Ask…**, or go directly to the existing Discussion composer after selecting the code. The selection appears as a removable quote; type your question and press **Enter**. **Shift+Enter** inserts a line break. Selecting text or choosing Ask does not itself send anything.

For example, select a collection or flag and ask:

```text
What is this used for? Explain its role in this flow with one concrete example.
```

Or select a condition:

```text
What happens when this condition is false, and where does execution go next?
```

DSpatch attaches the selection's file, revision and exact location. You do not need to copy the code into another chat. With Claude or Copilot, review analysis can read and search the two revision snapshots to find a definition or relevant use. Cursor's review path has more limited, supplied-context-only access. A lookup may still be incomplete; check the answer's references and stated uncertainty.

The quote remains when you move focus to type. A new selection replaces it, and moving to another file or place clears it. Check the quote before sending if you have navigated elsewhere.

**Two kinds of selection serve different purposes:** dragging over code text prepares a question; selecting changed lines by their number or review strip prepares a review decision. Neither action on its own approves anything.

### 4. Keep explanations short, and explore when needed

Answers normally start with a short explanation. Use the controls according to what you need:

| Action | Result | New agent request? |
| --- | --- | --- |
| **Show more / Show less** | Expands or folds details already included in the answer. | No |
| **The code it rests on** | Reveals the answer's checked code references. | No |
| **Explain more simply** | Requests a simpler explanation of that particular answer, keeping the original. | Yes |
| **Tell me more**, where offered | Asks the agent to develop the explanation further. | Yes |
| Your own follow-up | Continues the discussion in your words. | Yes |

Controls appear only where applicable. Older saved answers may be shown whole rather than split into short and detailed parts.

For example:

```text
I understand what the variable contains. Why is it updated before this call?
```

Open a reference under **The code it rests on** to investigate it. The code view identifies the file, folder, revision and range, highlights the referenced lines, and lets you expand the context or open the whole file. You can select code there and ask another question. **Back** takes you back through the references to where you were reading.

The agent's answer is an explanation, not an executed test. A reference being valid confirms where it points, not that the explanation is correct.

### 5. Arrange the discussion where it is comfortable

Each review has one panel with one Discussion. It opens in its own window by default and can be docked into the diff or walk window. Its placement controls let you move it again without starting a new conversation.

The history, draft, selected quote and answer in progress move with it. **Discussion** or **Show discussion** brings it back if hidden. Closing the panel hides it; use **Stop** to stop an answer.

You do not need a code walk to use Discussion. Once a walk is open, the same panel also offers **Step** for the prepared explanation of the current step. Moving through the walk updates Step without replacing your Discussion thread.

### 6. Prepare a guided code walk

From the diff review, choose **Prepare code walks…**, check the agent and model, and start generation. The chooser inherits the applicable existing selection; you can change it before starting.

The agent reads the selected revisions and prepares an overview and related paths through the change. Generation uses your provider account. A short activity line and **Stop** are available while it runs.

When ready, the walk window opens beside the diff. Its left side contains:

- **About the change:** a short overview, with more detail when available.
- **Walks:** paths through related execution, calls, conditions and data.
- **Readings:** coherent tours of documentation or other text, when appropriate.

Choose a step and use **Next** and **Previous** to follow it. A step may contain more than one code location. The code panes and connections show where the explanation moves; the **Step** tab explains the current step.

A walk is an agent's analysis of the code, not a recorded execution trace. It may include unchanged code to explain how the changed behaviour fits together. It is not intended to visit every changed line.

Useful controls while walking:

| Control | Use it to |
| --- | --- |
| **The change / The context / Whole file** | Adjust how much surrounding code you see. |
| **Before / Before → After / After** | Read the old version, comparison or new version. |
| **Wrap lines** | Fit long lines within the current pane width. |
| Pane dividers | Give the code you are reading more space. |
| **Show in diff**, where offered | Move the conventional diff to the corresponding change. |

The stronger focus highlight identifies the current step's relevant code. It is separate from both the diff's addition/removal colours and the review-status strips. Use the step and file labels to stay oriented rather than interpreting green as approval.

You can **select code and use Explain this or ask your own question here too**. The answer arrives in the same Discussion you used from the diff. The diff and walk windows navigate independently unless you explicitly use an action such as Show in diff.

### 7. Ask what deserves closer attention

Under the walks, choose **Find what is worth checking…** when you want the agent to look for questions, uncertainties and findings. This is a separate agent job; generating walks does not automatically run it.

Open a point to see its reasoning with the relevant code. A point can lead to a related walk step or its own sequence of locations. Ask follow-up questions or request a simpler explanation there just as you would elsewhere.

Opening or discussing a point does not resolve it, mark its lines reviewed or approve the change.

### 8. Record review decisions or delegate review

Once you have assessed a change, select the changed lines through their **line numbers or review strip**. Shift extends the selection. Use **Mark reviewed**, **Exempt**, or the available clearing action. Whole-file actions are also available.

These marks describe different things:

| Mark | Meaning |
| --- | --- |
| Manual review (blue strip) | You explicitly marked the changed lines reviewed. |
| Agent review (violet strip) | A completed, recorded and validated delegated review approved those lines. |
| Exempt (grey dashed strip) | You explicitly excluded those lines from review; this is not an approval. |
| No mark | The changed lines remain unhandled. |

For an independent agent assessment, use **Delegate…** on selected changes, **Delegate file…**, **Delegate the whole review…**, or delegation for a walk's changed lines. Check the scope and agent/model before starting.

Read the assessment and any problems or uncertainties. The agent can approve only part of the delegated scope. A result saying some lines were approved does not mean the whole file is correct. A failed, stopped or insufficient review does not create approval.

The current delegated-review presentation can be verbose and may show only **running** while work is in progress. The shorter explanation controls described above should not be assumed to exist on every delegated-review report.

### 9. Return to the overview and resume later

Use **Files changed** to see what remains. The handled percentage counts changed lines, including deletions; expanding unchanged context does not increase the denominator. Exemptions are kept distinct from approvals even when both contribute to handled progress.

In the walk's **Coverage** view, distinguish code included in a walk or opened while reading from code actually reviewed. Passing through a step, generating an explanation and asking questions do not approve lines.

Close the windows when finished for now. Reopen the ongoing review through **Open review** to return to its saved material. Opening saved walks and discussions does not regenerate them or send another question. **End review** removes it from the ongoing list without approving code or deleting the record.

Review decisions belong to the exact revision pair. Choose a new pair to review a later change; do not assume old approvals cover new code.

### A compact first review

Try this sequence once to discover the main interactions:

1. Open two commits and inspect one changed file.
2. Expand context, select an unfamiliar expression, and use **Explain this**.
3. Ask a follow-up, open a reference and return with **Back**.
4. Generate walks and follow one path through the change.
5. Ask about a selection in the walk; find the answer in the same Discussion.
6. Mark a small range reviewed, or delegate it and inspect the result.
7. Return to Files changed, then close and reopen the review.

You can stop after any step. Review is useful without walks, delegation or a development loop.

## Work with an agent

### Open a workspace

Choose a provider and model, then **Open Project**. A workspace can contain multiple folders: use **Add Folder to Workspace** to include another one. For remote work, these folders live on the host.

You can also begin a conversation before opening a project and open the workspace when you are ready. Existing workspace conversations remain available separately.

With **Use loop** off, write an ordinary request:

```text
Find where the application saves its settings. Explain the flow first;
do not change anything yet.
```

Then continue in the same conversation:

```text
Add a clear error message when saving fails. Keep the existing file format,
and run the relevant checks. Explain what changed and what remains untested.
```

The agent can inspect the repository and choose its own tools for the task. A development request can cause real edits and command execution. For experiments, work on a branch or a separate worktree.

The model selector's **default** row follows the provider's default; an explicit model row selects that model. If the provider does not identify its default, the interface says so rather than inventing a model name.

### Follow and steer the work

While the agent works, a short activity line describes reported activity. Add a clarification in the same composer, for example:

```text
Keep the public API unchanged. This also needs to work on Linux.
```

During active work this is steering of that work, not a second competing assignment. Delivery depends on the provider: a message may be waiting before it is delivered. Sending it is not proof that the agent has already acted on it.

Use **Stop** when you want ongoing work to end. Stopping does not undo edits already made. If the outcome is uncertain, inspect the saved state before retrying instead of assuming nothing happened.

You can ask the agent to run relevant tests directly. The separate **Build and test** controls, where shown, let you run a command yourself; that is distinct from talking to the agent.

### Inspect the result

Read the response, the actual changes and the check results. The project chat can show working-copy changes; the standalone revision review compares commits. To use code walks on a completed development change, commit the intended result on your branch and open that revision pair in review.

Saved conversations remain available through the chat list and **Session → Conversation History…**. Reopening history does not itself send a request. Technical details belong under **Session details** or the run journal when you need to troubleshoot.

## Use an agent loop

A loop makes the responsibilities and handovers in an assignment explicit. Depending on the workflow, steps can investigate, propose, implement or assess; the graph controls how their results lead to further work and when to stop. The bundled examples below provide a smaller starting point for using these mechanics.

### Choose a loop and give it an assignment

1. Open a project and choose the agent/model you intend to use.
2. Open **Edit agent loops** and choose a loop in the editor's list.
3. Return to the project chat, enable **Use loop**, and send the assignment.

Selecting a loop or enabling Use loop does not start it. Sending the assignment does.

Until you choose one, DSpatch offers **DSpatch development loop (runnable subset)**. **Simple chat loop** stays in the list for smaller assignments, and a loop you chose earlier stays chosen.

The bundled **Simple chat loop** starts with **Do the work**, then hands its result to **Check the work** in a separate agent step. The check can accept it, request rework or report that the result could not be established. Rework follows the graph's limits; it is not an unlimited retry.

For example:

```text
Improve the error message when a settings file cannot be saved.
Keep the file format and public API unchanged. Verify the relevant behaviour
and report any checks you could not perform.
```

Replies and follow-up instructions stay in the project conversation. The graph view shows the current step and route, so you can inspect the workflow without maintaining a separate conversation for each role.

The bundled **DSpatch development loop (runnable subset)** is a larger implementation/verification/review workflow. Its name matters: it is not the full external process used to develop DSpatch, and it is not selected automatically merely because it is available.

### Decide how much to participate

Ordinary chat and step-by-step loop execution are different choices:

| Control | What it means |
| --- | --- |
| **Use loop** off | New idle sends are ordinary single-agent conversation. Turning it off during a running loop requests cancellation of that run. |
| **Use loop** on | An idle assignment starts the selected workflow. Messages during its run go to the ongoing work. |
| **Agent and command steps: start on their own** | The workflow starts its work steps automatically within its rules and limits. |
| **Agent and command steps: wait for me** | Each next work step waits for your **Continue**. |
| **Pause** | Lets the current step finish, then holds before the next work step. |
| **Continue** | Releases the held work step. In wait-for-me mode, the following work step waits again. |
| **Stop / Cancel run** | Requests cancellation now; it does not roll back project edits. |

You can change the step mode during a run without restarting the assignment or clearing its history. You can also send clarifications in the same chat while it runs.

For example, start with **wait for me**, inspect what the first agent produced, then choose **start on their own** when you are comfortable with the remaining workflow. To return to ordinary conversation, end or stop the run, turn Use loop off and ask your follow-up in the same thread.

Continuity means the visible work and conversation stay together. It does not mean every specialist shares one model context or that a cancelled process can resume at the exact instruction where it stopped. Provider recovery and resuming an interrupted loop are separate capabilities; use the continuation controls actually offered for that state.

### Explore or adapt a workflow

In **Edit agent loops**, select nodes and connections to inspect the role, task, handover and outcome routes. Editing lets you adapt the process as well as the application itself.

- **Save** writes graph changes. A running workflow keeps the graph version it started with.
- **Dry-run** exercises graph routing without contacting a provider. It does not demonstrate that a real agent will solve the task.
- **Open loop…** loads a `.loop.json` declaration and makes its workflow selectable.
- A `.graph.json` is the drawing and workflow structure. Opening a drawing alone is not the same as installing a selectable loop.

Project loop declarations live under `.dspatch/loops/`. For a custom workflow, copy a working declaration and its needed resources into your own project or branch, keep paths relative, and open the declaration in the editor. Do not edit read-only resources inside an installed application. The existing [chat-loop declaration](.dspatch/loops/dspatch-chat-loop.loop.json) and [graph](docs/loop/graphs/dspatch-chat-loop.graph.json) are useful starting points.

Some graph concepts in the design documents are not runnable yet. Use the editor's validation and the runnable examples; the full development-process drawing includes unsupported parts and is not an executable template.

## Work remotely

Remote work uses the same chat, loops and review interfaces. The difference is where files and agents live.

1. From the start page, choose **Remote Session** and enter `user@machine` or an SSH alias.
2. Complete the SSH prompts and any host installation/update confirmation.
3. Choose **Open Project** on the remote host, select your provider, and work normally.

The client obtains the host package matching its release and sends it over SSH. The repository does not have to exist on your laptop. The host needs the project's own tools and provider access, and provider setup/sign-in applies to that host. Browser authentication is presented on the client.

**Start on one computer, continue from another.** If you already work in DSpatch on a computer, install it on your laptop and connect to the same account there. You find the same projects, conversations, reviews and loop runs, and an existing provider login is reused. One client works at a time. A window left open on that computer hands over when you confirm, unless work is running there, and then shows **Use here** for your return. A job that runs in the host stays one job when you come back: you see it as running, and nothing is sent again.

**Leave** closes the connection while leaving the remote host running. If the connection drops, the client cannot know the job's current state until it reconnects. It does not automatically send the assignment again. After a host restart, an interrupted job may have an unknown outcome; inspect before continuing.

On a Linux host without a usable keyring, Copilot sign-in may not be persistable. Follow the reported error and your organization's credential-storage policy; DSpatch does not silently enable plain-text storage.

See [installation details](docs/INSTALL.md) for host paths, package matching and SSH troubleshooting.

## What to expect, and what is still developing

- A generated walk explains a change; it is not test execution or approval.
- Review progress and walk coverage measure different things. A complete walk does not prove a complete review.
- The current revision-review workflow uses a Git repository and two commits. Publishing review comments to Gerrit is not part of this tutorial's supported workflow.
- Richer delegated-review activity and more compact result presentation are areas for improvement; expect that surface to differ from short Discussion answers.
- Tool hooks are not a filter over all code sent to a model. Before using restricted repositories, read the [content-exclusion contract](docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) and confirm the approved provider and controls for your environment.
- Release notes state which operating systems and real-provider paths have been exercised. Automated simulations and dry-runs have a different scope.

For problems, record the release version, operating system, selected provider, local/remote mode, and the steps that led to the issue. Include a screenshot or a relevant diagnostic excerpt without credentials or private source code. The [issue tracker](https://github.com/nizlas/DSpatch/issues) is the place to report it.

For your own features or UI variations, follow [Run from source](README.md#run-from-source), create a branch and experiment. The [vision](docs/VISION.md) explains the intended direction; this tutorial explains how to use the current application.
