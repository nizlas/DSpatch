# Generic agent network

Run the loop from live chat for a conversational workflow. Opening the graph in the editor is for inspection and editing; the editor's live Run binding does not run this template. `stored-result` carries reply bodies for handoffs during the run; supplying a results directory alone does not write those bodies as files. Do not assume durable reports or resumability from this graph: verify the recording and recovery behavior of the chosen run path, and save any needed report through an authorized project mechanism.

This template has write-capable steps. DSpatch may read the working folders for snapshots even when the agent is instructed not to read them; the instructions neither disable host observation nor enforce permissions. Do not use this template when the mandate prohibits all project access or observation. Whether observation is allowed, and which runtime or provider controls apply, must be established for the actual environment.

Every role returns a carry-forward ledger of accepted slices with attributed evidence. Each edge supplies only the named results, and each step must carry the ledger in its actual reply, including failures. Agent instructions are not a guarantee of model compliance; inspect results and reconcile missing or uncertain evidence.

The call limit is checked after each step. If a limit is routed, later reporting calls may exceed it. If the limit is first spent at a reporting node, those nodes have no limit route and the run stops without reaching the report-delivered ending; it may stop before the final report step runs. Without limit routing, the run stops at the limit. A report-delivered ending is not human approval or proof of verification.
## Choosing and running it

The loop ships with DSpatch and is listed as **Generic agent network** in the loop editor's **Loop** list, beside the other bundled loops, in every project. Opening or choosing it starts nothing, and it is never preselected: a workspace keeps the loop it last chose. Run it from the project chat with **Use loop**. The agent and base model are those chosen in the chat; every step inherits them. Requirements are checked against that agent's actual integration.

Project instructions come from the open project, through the context DSpatch gives every chat loop run: the first step is told which instruction files are present in the working folder (names only, such as `AGENTS.md`), and every step works in that folder and reads what its task needs. Later steps receive the person's words rather than the whole snapshot, so they find the instruction files in the working folder themselves. The template adds no instructions of its own beyond the roles and node tasks shown in the editor.

## Behaviour the run engine does not provide

These parts of the orchestration are carried by instructions or by ending the run, not enforced by DSpatch:

- **Small, medium and large variants share one model.** Implementer, Explorer, Researcher, Reviewer, Skeptic and Tech Lead variants differ in their instructions and in where Tech Lead dispatches work, not in model or capacity. A step can fix a model of its own in the graph, but such a model is specific to one provider, so the template does not set any.
- **No pause for human authorization.** When Infrastructure needs a job approved, the job plan is reviewed and the run goes to wrap-up and reports. Approving and launching the job happens outside the run; a new run continues afterwards. The graph has no human step.
- **One slice at a time.** Workers run one after another; the template does not use DSpatch's parallel fan-out, and subagent delegation is off unless the user authorizes it.
- **The carry-forward ledger is not verified.** The runner delivers the named results along each edge; that each reply carries the ledger is the agents' instruction, not a check.
- **Limits are bounds on routing, not a hard cap.** See the paragraph on the call limit above.
- **Not yet tried with a real provider.** Its integration was checked with simulated adapters for each agent and in the packaged application without a model call.
