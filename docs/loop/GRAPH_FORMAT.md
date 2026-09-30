<a id="loopgrafens-filformat"></a>

# The loop graph format

DSP-21, 15 September 2026. This is the file between [the editor](../../backlog/tasks/dsp-22%20-%20Build-a-graph-editor-for-agent-loops.md) and [the runner](../../backlog/tasks/dsp-18%20-%20Define-and-run-a-bounded-Maestro-loop-in-DSpatch.md), settled first so that both can be built against it instead of against each other's assumptions. It is a contract, not a feature.

| What | Where |
| --- | --- |
| Types and vocabularies | [`app/src/shared/loop-graph.ts`](../../app/src/shared/loop-graph.ts) |
| Reading and validation | [`app/src/shared/loop-graph-load.ts`](../../app/src/shared/loop-graph-load.ts) |
| Reaching a role on this machine | [`app/src/main/loop-graph-roles.ts`](../../app/src/main/loop-graph-roles.ts) |
| The example graph — our own development loop | [`graphs/dspatch-development-loop.graph.json`](graphs/dspatch-development-loop.graph.json) |
| Tests | [`app/tests/loop-graph.test.ts`](../../app/tests/loop-graph.test.ts) |

<a id="en-graf-i-korthet"></a>

## A graph in brief

A graph is one JSON object. It says what it is, what it is for, which framework it is drawn for, where a run starts, its nodes and its edges.

```json
{
  "format": "dspatch-loop-graph",
  "formatVersion": 1,
  "id": "dspatch-development-loop",
  "name": "DSpatch development loop",
  "purpose": "Building DSpatch itself. One bounded backlog task per run …",
  "target": "cursor",
  "entry": "niclas-mandate",
  "onRuntimeFault": "stop-and-reconcile",
  "limits": { "maxTasks": 1, "maxCalls": 12, "maxReworkRounds": 2 },
  "archive": { "path": ".dspatch-loop/runs/<run-id>/reports/", "entryPerNode": true, "referenceReturned": true },
  "failureKinds": [{ "id": "spec-error", "label": "…", "meaning": "…" }],
  "nodes": [],
  "edges": []
}
```

`id` and `purpose` are required because **there will be several loops** — a small one and a large one, or one per kind of task. Building that set is not part of DSP-21, but a format that assumed uniqueness would have to be changed later, and that change invalidates every file already written.

<a id="noder"></a>

## Nodes

Six kinds, and each one is drawn by [the reference figure](../assets/agentloop_generisk.png) rather than anticipated.

| Kind | What it is | In the figure |
| --- | --- | --- |
| `agent` | A role doing work. Requires a role reference. | Implementer, Researcher, Tech Lead, Publisher |
| `gate` | A checkpoint that admits or rejects. At least two verdicts, since a gate that cannot reject admits everything. May be performed by a role. A gate is a **judgement**, not a shell command DSpatch starts. Who forms the verdict is the role or the person; which commands a project needs is never a property of the node kind. See [INTERACTION_MODEL.md](../INTERACTION_MODEL.md). | *Plangrind Reviewer-s*, *Jobbgrind*, *Skeptic påståendegrind* — drawn as gates, but see below |
| `router` | Chooses a branch without doing the work. At least two outcomes. | the *Slicetyp* diamond |
| `human` | A step where a person acts. | *Du: godkänn och starta* |
| `external` | A participant this loop does not run and cannot bound. | *Externa agenter* |
| `terminal` | The run stops here. `ending` says whether arriving is this loop's own idea of success. | — |

**The figure's three gates are not evidence for the gate rule, and this table used to imply they were.** Transcribing the figure on 16 September 2026 showed that *Plangrind*, *Jobbgrind* and *Skeptic* each draw exactly one arrow out, so all three fail the two-verdict rule above and had to be given an invented reject verdict and an invented edge before the graph would validate. The rule is right and the drawing is loose: a checkpoint drawn with one way out is a step, and the arrow that means *rejected* is the one a whiteboard leaves off. Our own loop's plan and implementation gates are the examples that satisfy it, each declaring accept, rework and needs-decision.

Node attributes belong to the format, not to the editor: `id`, `kind`, `label`, `purpose`, `ending`, `role`, `model`, `limits`, `requirements`, `outcomes`, `whenUndeclared`, `declaredFailures`, `report`, `produces`, `consumes`, `notes`, `view`. Edges have `id`, `from`, `to`, `when`, `delivers`, `label` and `notes`.

- **`model`** is a policy rather than a slug: `{"policy":"inherit"}`, `{"policy":"fixed","model":"…"}` or `{"policy":"described","description":"…"}`. `described` exists because [DSP-8](../../backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md) has not been decided: a graph can record how the model *should* be chosen without pretending the choice is automated.
- **`limits`** bound a step, and the same shape on the graph bounds the run: `maxCalls`, `maxReworkRounds`, `maxMinutes`, `maxTasks`, `note`.
- **`outcomes`** are the named results a node produces — a router's branches, a gate's verdicts. Declaring them is what lets an edge routing on a typo be caught. A node that declares outcomes routes only on them and may not also leave on plain success; that would be ambiguous, and nothing in the file would say which edge wins.
- **`whenUndeclared`** is which of this node's own outcomes a reply that declares none of them is routed on. A step that declares outcomes is asked to name its result on a whole line, and a reply that names none is not a success — the question is only whether that is a route the author drew or a stop. Absent means the stop: the run ends as the runtime fault `undeclared-product`, with the step's own reply already filed. Validation refuses a value naming an outcome the node does not declare, and refuses one on a node that declares no outcomes at all, since there such a reply *is* the result. **This replaces the only place a name carried behaviour.** Until [DSP-103](../../backlog/tasks/dsp-103%20-%20A-routing-name-that-only-works-when-spelled-a-particular-way.md) the graceful route was given to any node whose outcome list happened to contain the literal `unclear`, or failing that `could-not-check`, so the routing depended on a spelling, the drawing did not record it and the node panel could not show it. Nothing is inferred from an outcome's name now, in either direction. A drawing that relied on the old spelling and states nothing here keeps a validation warning until it does, because its behaviour has changed.
- **`produces`** is what this step must leave: `{"required": true, "form": "markdown-file" | "stored-result" | "none", "note": "…"}`. `archive` and `report` say *where* an entry lands and *who* files it; neither could say **whether** anything has to be there, and without that there was nothing to check — which is the whole of how a missing report could read as a delivered one. A required result with form `none` is refused, and so is a required Markdown file in a graph that says nowhere for one to land.
- **`consumes`** is which earlier steps' results this step is given **on any arrival that does not say otherwise**: a list of node ids, each resolved by the runner to that node's **most recent completed visit in this run**. An arriving edge's [`delivers`](#bågar) overrides it for that route, which is what lets a first visit and a rework round at one node be handed different material. Until it existed, edges carried control flow and nothing else, so *the Verifier receives the Implementer's report* was not expressible at all. Validation refuses a node consuming itself, a node that is not in the graph, a node that declares no result, and one that no path through the graph runs first. A graph that consumes anything needs somewhere to keep results the same way one that requires them does: a **live** run given no store is refused before it walks, and a **dry** run hands nothing over and says so, because it filed nothing — which is the dry run's own silence, not a step having left nothing.
- **`ending`** is `"success"` or `"not-success"` on a terminal, and it exists because until [DSP-36](../../backlog/tasks/dsp-36%20-%20Decide-what-a-finished-run-in-the-editor-does-when-a-new-run-starts.md) the format could not say which terminals mean success — every one of them was `kind: "terminal"` and differed only in `label` and `purpose`, so the only thing left to read was the wording, and renaming *Assignment not met* to *Done* would have changed what DSpatch believed had happened. Two values and not four: `not-success` covers *not met*, *could not establish* and *stopped* alike, which are already told apart by the run's recorded outcome and by the terminal's own purpose. Absent means the author has not said, and is read as *not declared success*. It changes no route — which terminal a run arrives at is the edges' business — and it does not reach the run's recorded outcome, where arriving at a terminal still earns nothing. It is refused on any node that is not a terminal, because no walk stops there to be marked.
- **`view`** is where the editor drew it. Presentation only: it never affects meaning and the runner ignores it. It is in the format anyway, because a hand-arranged graph that loses its arrangement on save is a graph nobody arranges twice.

**Two new fields, and the shape stops there.** No report format, no result schema, no quality field. Checking that a result exists and belongs to the right step is the run engine's business; judging whether the work is any good belongs to the appointed agents or to the person, and a runner that started reading reports to grade them would be a runner nobody could predict.

<a id="attribut-som-ännu-inte-hedras"></a>

### An attribute nothing honours yet says so

Validation emits a notice per attribute a graph actually sets that nothing acts on, naming what it waits on — `model` on DSP-18 and DSP-8, and `limits` and `onRuntimeFault` on DSP-18. Recorded-and-unhonoured is the honest state. Silently ignored is not, and it is what an author would otherwise assume from a field that loads without complaint.

**And an attribute honoured on some paths and not others says which.** `role` is why one boolean was not enough. It was validated and then ignored — the prompt was the mandate and the node's `purpose`, so a drawing could name the Researcher while the agent was told only *read the project* — and the table whose whole purpose is disclosing that had no row for `role` at all. [DSP-46](../../backlog/tasks/dsp-46%20-%20Give-a-loop-agent-the-role-the-drawing-says-it-has.md) closed both halves: the live chat loop now sends the role's own text with the prompt and records what was sent, and every attribute a node or a graph can set has a row saying who honours it. Where an attribute is honoured on only some paths, the row carries a caveat and validation reports it — for `role`, that the editor's Run button walks a fixed prompt and a dry run calls no provider, so on those two paths a role is still validated and its text is still not sent.

<a id="bågar"></a>

## Edges

An edge has an `id`, `from`, `to` and a `when`. Three conditions, and no fourth:

| Condition | Taken when | In the figure |
| --- | --- | --- |
| `{"on":"success"}` | The step finished with its normal result. | a plain arrow |
| `{"on":"outcome","outcome":"kod"}` | The source produced that named outcome. | a labelled branch |
| `{"on":"declared-failure","failure":"spec-error"}` | The source reported that declared failure. | a dashed arrow, `specfel: planera om` |

The edge `id` exists so a finding can point at one edge rather than at a pair of nodes that may be joined more than once.

An edge may also carry `delivers`, `label` and `notes`. **`delivers` is a list of node ids saying what this arrival hands the step it leads to, and where it is written it decides instead of that step's `consumes`.** [DSP-100](../../backlog/tasks/dsp-100%20-%20Let-a-rework-round-carry-the-reason-it-was-sent-back.md), and the defect it closes is the reason the field is on the edge rather than anywhere else. A step's inputs were built from `consumes` whatever route arrived, so the rework edge returned the implementer to its own unanswered question with the brief again and nothing of the review — and on 22 September 2026 the implementer read the re-prompt as the answer, opened with *"I understand the clarification"* and decided the question for itself. The same single list sent the researcher the coordinator's brief instead of the question it was being asked to answer.

`consumes` could not have fixed either, and that is the argument for the shape. It is asked on **every** arrival, including the first, so an implementer that consumed the review would be required on its entry visit to receive a result no step had yet produced, and the run would stop before anything ran. An arrival is a point in the walk and can require what is true at that point.

Three rules, and the third is the one worth stating twice:

- **Nothing written falls back.** An edge with no `delivers` leaves the step's own `consumes` deciding, exactly as before, so every graph drawn before this field behaves identically.
- **`[]` is a statement, not an absence.** It says *this arrival hands over nothing*, which is how a drawing distinguishes a clean arrival at a node from one carrying material.
- **A delivered result is bound to the run, the producing node and the visit.** Where the edge delivers the node it leaves from, the visit is the one that produced the outcome that took the edge — not that node's newest result. On a third rework round the two differ, and the difference is a review of the wrong attempt arriving with nothing about it looking wrong.

Validation asks of each delivered id the same three questions `consumes` is asked, but about `from` rather than about `to`: it must be a node in the graph, it must declare a result, and some path must run it before the edge's source. Asking about the target would pass a drawing whose loop-back reaches the target by an entirely different route from the one the edge is on. At run time, an arrival that promises something the path did not produce is `required-result-missing` and names the edge, because the edge is where the promise was made.

<a id="det-som-gör-det-till-en-loop"></a>

### What makes it a loop rather than a flowchart

The dashed edges. A graph is refused when a node can report a failure and no edge carries it: a declared failure with nowhere to go is exactly where a run stops while its author believed it would recover. The same applies to a declared outcome nobody routes.

A node lists the failures it may report in `declaredFailures`, and the graph declares the vocabulary once in `failureKinds` with a `meaning` for each. An edge may only carry a failure that both the graph declares and its source node declares. Three independent statements have to agree, which is what makes a typo a refusal instead of a branch that is never taken.

<a id="deklarerat-fel-är-inte-detsamma-som-att-något-hänger-sig"></a>

## A declared failure is not the same as something getting stuck

This is the sharpest distinction in the format, and the reason it is worth stating at length.

A **declared failure** is an outcome the loop understands. The premise was wrong, the mandate does not cover what comes next, the run's bounds are spent. It changes the path, so it belongs in the graph.

A **runtime fault** is the machinery breaking: a call that hangs, a report that never arrives, a process that dies. It is **deliberately not expressible as an edge**, for two reasons.

The first is readability. Every node can hang, so every node would need a "what if this hangs" edge, and the graph would stop being readable while gaining nothing.

The second is that an edge would not help. Handling a stuck call needs a timeout, a journal written before the call, and a way to establish afterwards what actually happened — none of which is routing. We have measured the cost of that machinery being absent rather than mis-drawn: on 14 September 2026 a specialist call completed at 01:35:54 with a full report and was never delivered to the coordinator, which stayed blocked for five hours and fifty minutes. No edge would have changed that. A report written to disk did.

So the format refuses the attempt, by name. A failure kind or an edge condition whose identifier names a runtime fault is a validation error quoting the word it matched:

> Edge "e7" routes on "no-report", which names a runtime fault ("no-report") rather than a declared failure. […] Draw the outcome, not the malfunction.

Matching is narrow on purpose, in two lists — whole words and whole phrases — because over-matching would refuse legitimate failures. `missing-authority` is a real declared failure in our own loop; `missing-report` must never be one.

<a id="den-enda-fogen"></a>

### The one seam, and how it is closed

DSP-21 named the seam: when the runner finally gives up on a stuck node, either the run stops for a human, or "no outcome" becomes a condition the graph may route on.

**It is decided: the run stops for a human.** That is what our own external loop does — it enters RECONCILING and someone establishes what happened before anything is repeated — and it is the only honest answer while nothing can tell a slow call from a dead one.

It is written in the file as `onRuntimeFault`, which today has exactly one legal value, `stop-and-reconcile`. A field rather than an assumption, so the decision is visible in every graph. If we ever decide otherwise, the vocabulary of edge conditions gains one entry, this field gains one value, and nothing else changes — which is what the task predicted and what this shape preserves.

<a id="iterationsarkivet"></a>

## The iteration archive

`archive` records where reports land, that every node writes one, and that a node returns a *reference* to its entry rather than passing prose along. The figure draws this as an aside. It is not one, and the format is stricter than the figure in one place because of it.

**`archive.path` is a write path, and it does not anchor where read paths anchor.** The distinction matters exactly once and then decisively: a definition that reads its roles from another project — which is what `resourceRoot` is for — would, if results resolved the same way, write its reports *into that other project*. The standalone development-loop definition would file its reports into the DSpatch repository, which is the collapse the separation exists to undo, arriving from the other direction. So results go to the run-scoped location DSpatch owns, or to an absolute root the definition declares in `resultRoot`; never to `resourceRoot`, and never by default to a working root. [DSP-74](../../backlog/tasks/dsp-74%20-%20A-step-leaves-a-required-result-and-the-runner-checks-it.md) honours this: a run is given one directory to keep its results in — `userData/loop-runs/<run-id>/results` for the window — `archive.path` resolves under it, and a path that is absolute or climbs out of it is refused rather than quietly relocated. `resultRoot` is still only declared here.

**One body, stored once.** A result has exactly one body and everything else is a reference to it. For a Markdown file the bytes at the path are the body: the runner either wrote them, or read them back from a file the step wrote, so the stored copy and the copy anything shows are the same string and cannot drift. For a stored result the run record holds the body and `archiveRef` points into it. Nothing is serialised twice, and a report never has to be written once to be kept and again to be shown.

**A handover only means something because each agent node is its own agent.** [DSP-79](../../backlog/tasks/dsp-79%20-%20Make-a-handover-real-one-agent-per-step-and-the-development-loops-own-requirements.md): a live run opens one provider session per agent node, keyed by node so that a rework edge returning to a step continues *that step's* conversation and nothing else. Before it, one session was opened for the run and every node's prompt went into it — so the drawing's second step was the first agent asked another question, and a `consumes` that passed nothing would have behaved identically to one that worked, because the receiving agent had watched the work happen. It no longer has. What a step is told is its role, where the folders are, the run's mandate, its own purpose, and whatever the arriving edge's `delivers` or its own `consumes` hands it; if the graph does not say to hand something over, nothing is handed over. Measured on Windows with no provider turn: three sessions coexist idle in one process at roughly a megabyte each, with distinct provider agents and no child process.

**A missing required result is a runtime fault, never an edge.** `required-result-missing` names which result was required, where it was expected and who was to file it, and under `stop-and-reconcile` the run stops. That is more explicit than a branch, not less: an edge routes onward, and a missing report is exactly the case where nothing should. It is also why the refusal of a declared failure named `no-report` or `not-delivered` is right.

A node required not to write files cannot file its own report. Our read-only specialists are in exactly that position, and on 15 September 2026 one of them was asked to write both its deliverable and its report and could write neither. So `report.writtenBy` is either `self` or the id of the node that files it, and a node whose effective requirements include `no-file-writes` while its report is written by itself is a validation **error**. [HANDOFF.md](HANDOFF.md)'s delivery rule is now a rule the format enforces rather than a paragraph someone has to remember.

<a id="roller-refereras"></a>

## A role is referenced, never contained

```json
"role": {
  "id": "dspatch-implementer",
  "source": { "kind": "cursor-agent-file", "path": ".cursor/agents/dspatch-implementer.md" }
}
```

The graph stays readable, the same role can be used by more than one graph *and by more than one node in the same graph* — our example references the Reviewer twice, for the plan gate and the implementation gate — and [DSP-23](../../backlog/tasks/dsp-23%20-%20Write-agent-roles-once-and-generate-the-provider-specific-files.md) can regenerate the role files without touching a graph.

`source.kind` is `cursor-agent-file`, `cursor-skill-file` or `role-source`. The last is DSP-23's provider-neutral form. It does not exist yet, and it is named here so that a graph written today moves to it by changing two fields rather than every node; `id` is stable across that change.

Paths are relative to the **resource root** the caller supplies, not to the graph file, so moving a graph does not break its references. A path that climbs out of the resource root does not resolve.

**The resource root is not the folder being worked on, and this line used to say it was.** *"Relative to the project root"* was true while DSpatch had exactly one folder that was simultaneously the project, the anchor for roles and the only working directory. Once a graph can be carried from one project and run against another, the two come apart and taking the working folder as the anchor means a graph looks for its roles inside a project that never had them. [DSP-69](../../backlog/tasks/dsp-69%20-%20Resolve-a-definitions-resources-from-the-definition-not-from-the-open-project.md) separates them: a [loop definition](../../app/src/shared/loop-definition.ts) declares its `resourceRoot`, and that is what resolution is given. It is a **read** anchor: paths resolve under it, climbing out of it is still refused, and nothing is ever written there.

**And that root is the only base a declaration has.** It is the folder the declaration file sits in, unless the declaration moves it with `resourceRoot`; `graph` resolves under it exactly as a role path does, and meets the same refusal for climbing out of it. Where DSpatch *found* the declaration — a folder's standard `.dspatch/loops` location, or a path somebody pointed at — decides nothing about what the paths inside it mean, so a reader can work out what a declaration reaches from the file's own location and nothing else. This paragraph had a second base in it until 20 September 2026: a declaration filed in `.dspatch/loops` was read as belonging to the folder that owns `.dspatch`, so the same relative path meant two things depending on where the file sat. Niclas withdrew that rule. The practical consequence is visible in DSpatch's own [chat-loop declaration](../../.dspatch/loops/dspatch-chat-loop.loop.json): its graph is not in the bookkeeping directory it is filed in, so it names `resourceRoot` and says why — which is the dependency being written down and shown rather than a special case being applied silently.

**A reference that resolves to nothing is an error, not an empty role.** An agent with no description is an agent that will be handed whatever the runner happens to have. Resolution is injected as a function, so the window can validate a graph without a filesystem — and when it does, role references are reported as *unchecked*, which is a different answer from *resolves to nothing* and is a warning rather than an error.

<a id="två-deklarationer"></a>

### Two declarations, because the first thing anyone does is copy one

Both of these load. The difference between them is the whole rule above.

A loop that lives beside its own graph names no root, because the folder its file sits in is already the root:

```json
{
  "format": "dspatch-loop-definition",
  "formatVersion": 1,
  "id": "small-review-loop",
  "name": "Small review loop",
  "description": "One writing turn and one checking turn.",
  "graph": "graphs/small-review.graph.json"
}
```

A project's own loop, filed in `.dspatch/loops` so DSpatch finds it, has to say where it reads from — its graph is up in the project, not in the bookkeeping directory the file is filed in, and being filed there buys it nothing:

```json
{
  "format": "dspatch-loop-definition",
  "formatVersion": 1,
  "id": "our-project-loop",
  "name": "Our project's loop",
  "description": "The loop we run on this repository.",
  "resourceRoot": "../..",
  "resourceRootNote": "The project this loop belongs to, two levels up from .dspatch/loops, where its graph and roles live.",
  "graph": "docs/loop/graphs/our-project.graph.json"
}
```

The second one loads with a **notice**, `resource-root-elsewhere`, and that is not a complaint: it is the dependency being recorded, and it is what puts *Reads its resources from …* on the row before anyone chooses the loop. Leaving out `resourceRootNote` adds a warning asking for one, because a dependency nobody explained is one the next person has to work out.

Two ways of getting the second one wrong, which fail differently and are worth telling apart. Dropping `resourceRoot` but keeping `"graph": "docs/loop/graphs/our-project.graph.json"` is **not** refused — nothing about it climbs out of anything — and it resolves, correctly and uselessly, to `.dspatch/loops/docs/loop/graphs/our-project.graph.json`. You find out when the loop is opened and the file is not there. Reaching for `"graph": "../../docs/loop/graphs/our-project.graph.json"` instead **is** refused, as `graph-climbs-out`, and the refusal names the root it measured against and tells you to move the root rather than the path. That asymmetry is the rule doing its job: a path that leaves the declared root is stopped at the declaration, and a path that stays inside it is believed until the filesystem disagrees.

<a id="grafen-är-ritad-för-ett-ramverk"></a>

## A graph is drawn for a framework

`target` is one of `cursor`, `copilot`, `claude-code`. Only Cursor is described from behaviour anyone has seen; what the table in `loop-graph.ts` says about the other two is that **nothing has been run against them from this repository**, recorded as `unknown` rather than guessed. That is deliberate: a table that guessed on their behalf would be the degraded artefact that reads as though a requirement held.

Two constraints make the target safe rather than treacherous.

**It is stored in the file.** The connected account may supply a default when a graph is first *created*, and nothing more. A stored graph must not change meaning because it was opened on another machine. DSP-12's survey recorded the cost of getting this wrong outside our field: Word's Simple Markup let the reader's installation decide what the reader saw, and editors reported recipients missing changes without knowing changes existed.

**Not runnable here is reported, never refused.** A graph drawn for a framework this machine is not connected to opens and edits normally; `runnableHere` says so in a sentence. An environment nobody established is *unknown*, which is also not a refusal.

<a id="krav-är-portabla-mekanismer-inte"></a>

### Requirements are portable; mechanisms are not

A node or a role says it must not be able to write files. It does not say `readonly: true`, which is Cursor's word for it. The known requirements are `no-file-writes`, `background-execution`, `fixed-model-selection`, `no-subagent-delegation` and `tool-restriction`, and each target answers each of them in one of four ways:

| Answer | What validation does |
| --- | --- |
| `enforced` | nothing; the framework enforces it |
| `other-means` | a notice naming the mechanism, because it is *not enforced* |
| `unmet` | an **error**: running there would produce a step that reads as though the requirement held |
| `unknown` | a warning; nobody established it either way, which is not a pass |

Our own loop produces a real instance of the third column being avoided and the second being needed. Every specialist requires `no-subagent-delegation`, and Cursor's answer is `other-means`: it is stated in the role instructions and honoured by the agent, not by the platform — Cursor's documentation says subagents may launch child subagents from 2.5. The loop is valid and the notice says out loud that this particular requirement holds by instruction only. That is the distinction the whole design exists for, found by expressing a loop that genuinely runs.

<a id="att-byta-ramverk"></a>

### Changing the target is reported, never migrated

`describeTargetChange(graph, to)` returns prose and **no graph**: what stops being enforced, what becomes available, what is unestablished, what the new target cannot meet at all, and which roles have no form for it. `withTarget(graph, to)` sets the field and does nothing else — no node dropped, no requirement removed, even where the new target cannot meet it. The result may fail validation, which is the honest outcome and the author's to resolve with the report in front of them. A requirement silently dropped during a target change is the failure this design exists to prevent.

<a id="validering"></a>

## Validation

Two passes, and the split matters for the editor.

`parseLoopGraph(text)` judges what the file can be judged on alone — is this a loop graph, does it have an identity and a purpose, are its nodes and edges well-formed. `checkLoopGraph(graph, options)` judges everything that needs the whole graph, an environment, or a way to reach a role, and it is safe to call on an in-memory graph the author is halfway through editing. `loadLoopGraph(text, options)` does both.

**An invalid graph is refused, not partially loaded.** A half-loaded graph is worse than none: the editor would draw a picture that is not the file and the runner would execute a loop nobody drew. `ok: false` carries every finding and no graph.

Each finding carries a severity, a stable `code`, a `pointer` into the file, the `nodeId` or `edgeId` it concerns, and a message written for the author:

- **error** — the file would mean something nobody drew. Refused.
- **warning** — probably a mistake, normal while drawing: an unreachable node, a role that could not be checked, a requirement nobody has established for this target.
- **notice** — true and worth knowing: an attribute nothing honours yet, a requirement that holds by instruction only, a graph that cannot run here.

A newer `formatVersion` is refused and **must not be saved by this build**: a newer DSpatch may have written fields this one would drop. That is the same rule the project store already follows for the user's own data.

<a id="vad-formatet-medvetet-inte-uttrycker"></a>

## What the format deliberately does not express

Left out on purpose, so the gaps are decisions rather than oversights:

- **Any routing on a runtime fault.** Argued above.
- **Parallel or concurrent steps.** One node runs at a time, because our loop is sequential by policy. This document used to add that the figure draws no fan-out either, and that is wrong: the figure *does* draw fan-out — two unlabelled solid arrows out of *Executive*, and two out of *Sister-Project Liaison*. What it does not draw is whether either means "both at once" or "choose one", which is not recoverable from the drawing, so a transcriber has to decide and the file then reads as though the figure had decided. The omission stands on our own policy; adding a join later is additive, and guessing at one now would be a language nobody has used.
- **Data flow between steps, beyond naming which earlier results a step receives and on which arrival.** `consumes` says *the Verifier receives the Implementer's report* and `delivers` says *and the rework round carries the review*, and a node still returns a reference to its entry rather than passing prose along. What the receiving step then does with it is the step's business. There is no field for a result's structure, its format or its quality: that is judgement, and judgement belongs to the appointed agents or to the person.
- **A consultation that fetches another agent's summary.** The figure's double-headed *frågar* arrows are this, not a fourth edge condition. Niclas decided on 16 September 2026: an agent may later ask another agent for a summary through an API that is not specified yet. Forcing that into control flow invented a non-terminating ping-pong the drawing does not contain. Until the API exists, the format has no home for it and the first demo graph omits it. The `external` node remains, for a participant this loop does not run.
- **Loop counters and per-edge guards.** Rework rounds are bounded by `limits.maxReworkRounds`, not by a condition on the edge that goes back. The single number is the rule we actually operate.
- **Conditions as expressions.** An outcome is a name the source node declares, not a predicate over state. Names can be checked; expressions would need a language.
- **Sub-graphs, or one graph calling another.** `id` and `purpose` leave room for a set of loops. Nothing here composes them.
- **Roles themselves.** DSP-23 owns the role source and its generation. This format only points at one and states what it requires.
- **Anything the runner does.** Journalling, resumption, snapshots, timeouts, who is allowed to write what. The graph says what the loop *is*.

<a id="exempelgrafen"></a>

## The example graph

[`graphs/dspatch-development-loop.graph.json`](graphs/dspatch-development-loop.graph.json) is not an illustration. It is the loop that is running: the coordinator skill, the five specialists in `.cursor/agents/`, the real limits from [DEVELOPMENT_LOOP.md](../DEVELOPMENT_LOOP.md), and the failure routing we actually use — a wrong premise back to planning, a rework round back to the Implementer, a decision only Niclas can make out to a human node. Fourteen nodes, thirty-one edges, valid against the real role files on disk. It has no `external` node and no *frågar* consultation, by the decision above: those belong to the generic figure, and the figure's dialogue is omitted from this first demo rather than invented as control flow.

Expressing it found things the generic figure would not have. That read-only specialists cannot file their own reports is now an enforced rule. That `no-subagent-delegation` is our policy and not Cursor's enforcement is now a notice on seven nodes rather than a sentence in a document. And what our loop does when a call hangs turned out to be unrepresentable as an edge in the most useful way: the attempt is refused with the reason.
