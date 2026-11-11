# DSpatch Code Understanding and Explanation Profiles

Reference for code walks and the design of agent instructions

11 November 2026 · Version 1.3 · Adopted direction

**Source and status.** Niclas adopted this document's direction on 9 November 2026 ([VISION.md section 3.4](VISION.md#code-understanding-and-explanation-profiles-one-reference-niclass-decision-9-november-2026)). It owns the detail definition of code understanding, the walk's pedagogical flow and the explanation profiles; VISION.md records the decisions, [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) the general agent principles, and the host's technical contracts stay in their own documents and code. It describes intended behaviour: what of it is built and verified is recorded in the tasks (DSP-152, DSP-176, DSP-181, DSP-184 to DSP-186, which implemented parts of sections 7 to 10 the same day from Niclas's evaluation of 0.1.11, the follow-up DSP-188, and DSP-192), never here. This Markdown file is the maintained source; a Word edition is a reading copy generated from it. Version 0.2 of 9 November 2026 was the draft Niclas reviewed; version 1.0 was that text with this status. Version 1.1 of 10 November 2026 clarifies, on Niclas's instruction after his use of the profiles, each profile's pedagogical responsibility and the common ground in section 4, adds the background-worker calibration example to section 5, says in section 6 that the original text is material rather than a content list and how a reviewer judges help for the profile's reader, and asks in section 11 that every evaluation name its generation path; nothing else changed in meaning. Version 1.2 of the same day (DSP-194) says in section 4 what Essentials selects in positive terms, what a mechanism achieves rather than the operations that achieve it, and adds to section 6 that a plan's brief and a general answer format reach the agent outside the profile and must not act as its content list; nothing else changed in meaning. Version 1.3 of 11 November 2026 (DSP-199) records Niclas's explicit decision that Essentials is extremely short: about two natural sentences before Show more, correct but not comprehensive, with depth behind Show more. It replaces the Essentials definition of versions 1.1 and 1.2, which let the short part grow with the step, and the wording in the introduction and sections 4, 5, 6 and 11 that conflicted with it; Standard and Teacher are unchanged.

### Purpose

DSpatch should help users understand the purpose, mechanisms, and consequences of a change, find relevant code, and form their own judgment. A code walk should guide readers through how execution may move through the code and how the parts work together. The explanation should provide understanding that readers would otherwise have to develop through their own searches and analysis.

This document is a lasting reference for product behavior and pedagogy. It should be maintainable as Markdown and usable to derive concise, coherent agent definitions and preprompts. It is not intended to be pasted in full into every explanation request. Implementation status and release decisions belong in separate tasks.

### How to read these requirements

Invariant product requirements concern identity, correct source attribution, preserved history, and truthful presentation. Pedagogical guidelines describe goals, audiences, and judgment. They do not prescribe sentence counts, identifier counts, mandatory headings, or a fixed structure for every response. Essentials' target of about two natural sentences (section 4) is a size guideline for its short part, judged by reading, not a count. The examples illustrate what creates understanding and must not become universal templates.

When pedagogical goals pull in different directions, correctness and clarity take precedence over brevity or format. The agent adapts the scope to the complexity of the code and the reader's needs. In Essentials, brevity is itself a primary goal: correctness still comes first, and an overreaching claim is made precise rather than surrounded with reservations. An explicit user request should guide the current explanation without silently changing the saved profile or review decisions.

### Responsibilities

- Walk planning selects relevant code locations, steps, and transitions so that the change can be followed.

- The shared explanation task grounds the text in the code and orients the reader within the current step.

- The profile determines the teaching level and which intermediate reasoning needs explanation. It does not replace investigation of the code.

- DSpatch supplies context and tools and is responsible for navigation, rendering, revisions, storage, and asynchronous state.

### Reading order

Sections 1–3 describe walk progression and code understanding. Sections 4–6 describe profiles, calibration examples, and how to derive instructions. Sections 7–10 describe product presentation and state. Section 11 describes verification. The code examples are generic and do not constitute an analysis of an actual product implementation.

## 1 A walk presents a comprehensible execution flow

A walk addresses a behavior or a review question. For executable code, the reader should be able to follow what leads to the next location: a call, a return, a branch, an event, or a transfer of work between threads. File order or a collection of nearby functions is not a sufficient structure.

### Orient the reader at transitions

When a transition would otherwise be unclear, explain why we are here and which context we are following. Recall relevant earlier state or conditions. Do this naturally where needed, rather than requiring an introductory paragraph for every trivial step.

- At a function call: show what the caller needs from the function and where the result is used.

- On return: reconnect to where the caller continues and what is now known or has changed.

- For an alternative outcome: explicitly return to the branch point and state which condition applies in the new walkthrough.

- For a worker or callback: identify what starts or triggers the work and which execution context we are following.

### Branches are alternative paths

After walking through a successful connection, a transition might say: “Now we return to the connection attempt and follow the case where the service does not respond.” The reader needs to remember both the branch point and where we were. Alternatives must not be presented as though they execute one after another in a single run.

Revisit the same code location when it helps show another branch, a return, or changed state. That is a meaningful revisit. Do not duplicate steps merely to transport the reader between functions when the panel and a short transition are sufficient.

### Concurrent work needs an explicit transition

A start function may create a thread that executes run(), while the caller continues registering work. The walk may follow registration first and then switch to the worker that has already been started. It needs to say so. Appearing later in the walk does not mean that run() is called from the registration function or that the thread only starts executing at that point.

Teaching order may differ from execution order. Make it clear when we switch paths, examine a possible failure path, or investigate a mechanism separately. A statically inferred path must not be presented as an observed execution trace. For configuration, data types, and tests, a dependency or a use may be the natural route through the code; do not force a fictional execution sequence.

## 2 Steps give each code location a comprehensible role

A step has a clear purpose and normally one focused code location with its own explanation. The text should primarily explain what is actually shown and connect it to its surroundings. Describing a callback that uses a class does not replace explaining the responsibility and mechanism of the displayed class.

### Divide steps according to what the reader needs to understand

Code fragments with substantially different roles should normally become separate steps. A list with Next place and the same overall text for every location risks leaving important functions unexplained. Including a line in a displayed region or mentioning a function name does not amount to explaining it.

Multiple locations in one step are a justified exception when seeing them together is genuinely necessary to understand a comparison or a close relationship. The benefit must be for the reader, not merely the generator's formatting. Even in this exception, every significant part needs a comprehensible role.

### Follow important implementation without following every call

The agent should assess new or substantially changed functions called from the selected code. If their implementation is central to the main flow, they should have their own step. Relevant additional detail can have a clear clickable reference. A self-explanatory function name is not sufficient reason to skip important new logic.

A generic example is a caller that first starts a background service and then registers which resources should be fetched. A comprehensible walk introduces startup and the worker thread, explains registration, and then follows how the worker handles the work. Startup must not disappear behind “starts a thread” while only registration is followed into its implementation.

### Overlap between walks is allowed when needed

Covering a function in another walk does not relieve this walk of explaining its relationship to that function. A central mechanism may have a focused step here as well. If the other walk provides optional depth, a link should lead to the correct step and allow an easy return. Walks may overlap in code without counting the same changed lines twice in coverage.

### Know the whole and explain the current part

The agent needs awareness of earlier and later steps to choose useful boundaries. Brief orientation about a later step is often necessary. The goal is to avoid unnecessary repetition, not to prohibit reading the next step or mentioning where a request goes.

Switching profiles within an existing walk preserves step order, code locations, and coverage. If the structure is inadequate, walk planning needs improvement; longer profile text must not conceal that problem. The profile also governs explanation style during new generation, but a prompt does not guarantee that separate model runs will produce identical walks.

## 3 Investigate the context and explain the relationships

A short explanation may require careful investigation. The agent should use the available workspace and relevant dependencies to understand the code. It need not inventory the entire project, but must not settle for function names, comments, or a limited context excerpt when the decisive relationship is elsewhere.

### Look for what determines the interpretation

Relevant callers, types, readers and writers of shared state, and waiting or called code should be examined when needed. For asynchronous flows, startup, signaling, waiting, and shutdown may be central. Investigation should concern the revision under review. External code must have a clear relationship to the review material.

“Not in the supplied excerpt,” “not found in the directory examined,” and “not available in the workspace” are different conclusions. The agent should search available sources reasonably before claiming that an implementation cannot be read. At the same time, having a repository available does not automatically mean that the source of every external dependency is present.

### Add understanding beyond reading the code aloud

The text should clarify purpose, responsibilities, relationships, and consequences that help the reader interpret the code. Translating statements into Swedish or English does not automatically provide that value. A comment can, however, convey important intent; use and check it in context rather than merely repeating “the comment says.”

Detailed explanation is justified when a detail is difficult to interpret or necessary to understand the mechanism. Explain how it contributes to the whole. A short string expression may need a syntax explanation for an unfamiliar reader, whereas a long loop can sometimes be summarized effectively at a higher level. The number of code lines does not alone determine the length of the explanation.

### Distinguish evidence from conclusions

The agent should distinguish observable code structure, documented contracts, its own inferences, and behavior actually tested. A lock protects only accesses covered by the appropriate synchronization. A method being private does not prove that other member functions never call it. A startup guard alone does not prove that a service can start only once during the lifetime of the process.

When implementation is unavailable, general language and library concepts can still be explained. Make clear which product-specific conclusions remain to be checked. Communicate uncertainty where it affects understanding, without filling every paragraph with generic caveats.

### Investigation scope is not explanation scope

The agent may need to read all relevant accesses involving a lock but explain only the relationships the reader needs to see. Shutdown, for example, needs explanation when it affects lifetime or safety. It should not become a mandatory inventory item in every discussion of threads.

## 4 Profiles adapt the help to the reader

All profiles must be correct, grounded in the same reviewed code, and preserve the review's decisions. They differ in how much of the relevant material they select and at which level they explain it: a different abstraction level, a different selection, a different amount of teaching. They are not fixed text formats, none of them is another profile's content at a different density, and none should automatically change review depth, decisions, or walk structure.

Preserving truth, risks, and findings does not mean that every explanation's short part must restate every fact, uncertainty, or detail of the original text. Existing findings remain available in the review's state and must be neither distorted nor lost; the explanation chooses what this reader needs here. A detail belongs in the short part when it is needed to understand the main behavior or to avoid a misleading conclusion. Other relevant mechanics may go under Show more or be explained in the walk step that treats them. Not everything the agent investigated needs to be retold.

For complex code, the profiles' different pedagogical tasks must be clearly noticeable. For Standard and Teacher, length is a consequence of the help chosen, not a measure of quality; Essentials keeps its short part extremely short by design (below). Whatever the profile, the reader must not lose track of where in the flow they are: the coherent execution flow, the comprehensible transitions between calls, branches, and threads, the focused steps, and the relevant code access of sections 1 to 3 hold for every profile. In Essentials the short part places the step in the flow with its central role; a transition that needs more than that goes after the marker.

### Essentials gives an experienced developer the main picture in about two sentences

Extreme brevity is a primary goal of Essentials (Niclas's decision, 11 November 2026, replacing the earlier definition under which the short part grew with the step). The short part aims at about two natural sentences: what the step accomplishes, and its central role or relationship in the flow. It adapts to the size of the code where it must, and a very large piece of code can need more, but this is a guideline rather than a sentence quota, and the short part still gives only the main picture. Two long sentences that pack in a whole walkthrough do not meet it.

The reader sees the code and can always open Show more, so the short part need not restate calls, flags, fields, mechanisms, every condition, or the failure paths. Leaving such detail out is part of the job, not a shortcoming: Essentials selects actively and puts useful depth behind Show more. What the short part says must be correct, though not comprehensive; an overreaching claim is corrected by saying it more precisely, not by adding a list of reservations.

Show more may give a coherent deepening for the same reader. It is not a required inventory of everything the agent read.

### Standard makes the central mechanism comprehensible

Standard is for a developer with ordinary experience who does not know this particular code. Explain how the parts work together and why their relationship matters. Choose a natural entry point into what makes the behavior understandable, rather than mechanically listing the parts in source-code order.

Standard may explain a language detail when it is needed for interpretation. It need not teach every basic concept or accumulate more facts merely to be longer than Essentials. A good response helps the reader understand the mechanism and relate it to the code without having to fill in the central gaps themselves.

Standard as it now works is the comparison point for the other two profiles. Its reader description and its task are not widened to make the profiles symmetrical; when a shared instruction changes, Standard's working behavior is checked and kept.

### Teacher builds the understanding the reasoning presupposes

Teacher helps a reader who can program but lacks prior knowledge of the language, library, or mechanism at hand. What distinguishes it from Standard is that Teacher builds the understanding the reasoning presupposes: what the concepts mean here, why the mechanism is needed, and how the parts work together. A concrete example or a relevant comparison can make this clearer.

Teacher is not Standard with more facts or a few extra lines. It need not inventory every line of code or teach every term. Choose the concepts and intermediate steps the reader actually needs to understand this step; the presence of the words mutex and shared_ptr is not enough, the reader needs to understand what they do together. A local explanation beats a detached textbook discussion.

Teacher may take the room understanding requires, and it uses what the walk has already established. A short reminder with a reference suffices in a later step; the same foundation is not derived anew everywhere.

### Deeper explanation and individual adaptation

Show more gives relevant continued explanation for the selected reader: for Essentials a coherent deepening of the main picture, for Teacher the next layer of a concept or its consequences. It is not an automatic dump of everything the short part left out, it does not repeat the short part, and it need not exist when there is no meaningful depth to add. Facts may overlap between profiles. Explain more simply simplifies the current reasoning without silently changing the profile. The user's questions may reveal what needs elaboration or can be skipped; profiles should support that judgment, not obstruct it.

## 5 Generic calibration examples

These examples illustrate relationships an explanation may need to make comprehensible. They should not be copied into every prompt or become checklists of mandatory terms. Project-specific names and code have been replaced with independent scenarios.

### A shared snapshot

Suppose a SnapshotSlot class holds a shared_ptr to an immutable DataSnapshot. A callback replaces the pointer through set(), and consumer threads retrieve a copy through get(). Both methods lock the same mutex when accessing the slot's pointer.

A useful explanation starts with the collaboration: the slot lets the updater publish a new snapshot while a reader already in progress can continue using the old one. get() copies the pointer under the lock; the copy keeps the object alive after the lock is released. set() can then replace the slot's pointer without destroying the earlier reader's object.

These are central mechanisms for Standard. Teacher may, when needed, explain the difference between protecting the shared pointer and keeping the pointed-to object alive. Shared ownership does not automatically make the object's contents thread-safe. Which callbacks and readers actually exist must be established from the implementation under review.

### Retrieve or register new work

Suppose acquire(key) looks up a slot in a map and creates it if missing. The same lock protects lookup and creation. For a new entry, a work flag is set and a waiting worker is notified. The return value is a shared_ptr to the slot.

“Get-or-create and safe to repeat” leaves important questions unanswered. At the appropriate level, the explanation needs to connect why the same key is reused, what the lock protects, why the object can remain alive with the caller, and how the worker learns that work is available. Notification does not mean that the work has already been performed. Read the waiting loop to explain its actual conditions.

### A short expression can have an important role

Suppose resourceName(index) constructs a name such as “ITEM:7”. The name serves both as a key in a map and as an identity in an external call. The explanation should connect the result, its construction, and its use. Standard may focus on the identity's role; Teacher may also explain the string conversion if it is difficult to interpret.

This is justified detail because it resolves a comprehension problem. Prohibiting all syntax explanation would be as wrong as requiring every line to be paraphrased. The profile's level and the reader's needs determine what is helpful.

### A background worker, in the three profiles

Suppose a background worker's code creates a client, establishes a connection, and then processes subscriptions registered by the main thread; blocking requests run outside the lock the two threads share; a connection failure is retried, a failure to create the client ends the worker. An Essentials short part for such code might read:

“The background worker connects and then serves the subscriptions the main thread registers, keeping its blocking requests outside the shared lock so registration never waits on the network. Lost connections are retried, but if the client cannot be created the worker ends for good.”

What makes this the Essentials level is the selection: the purpose, the main interaction, and one important difference between outcomes, in about two sentences. How the lock is held, where a retry resumes and what the failure paths leave behind can follow behind Show more. It is not a template for every worker; a worker with a different shape gets a different selection. (Versions 1.1 and 1.2 gave a three-sentence example here, under the earlier definition.)

Standard develops the central mechanics and why the parts work together as they do: what the lock protects and why the blocking request is made outside it, how the worker learns of new subscriptions, where a retry resumes, and what the two failure paths leave behind. Teacher builds, where this reader needs it, the understanding of a background thread, shared state, a lock, and blocking work, and ties those concepts to the code's behavior with a concrete example or comparison, using what earlier steps already established. That list of concepts is what this example happens to need; it is not a list every Teacher answer must cover.

### Why Explain this is an important comparison

During evaluation, Explain this produced better responses by focusing on the selected code and connecting it to writers, readers, and usage. This is a quality reference for the prepared walk. The difference may come from the supplied context, opportunities to investigate, the task's focus, or the instructions. Investigate it before adding more rules.

## 6 Derive concise, coherent instructions

Claude should be able to use this reference to formulate agent definitions at the same level of abstraction: purpose, reader needs, relevant investigation, and sound judgment. Copying every paragraph as yet another prohibition risks creating overloaded instructions that make explanations worse.

### Separate three parts of the request

- Shared task: explain the current code in the context of the walk, ground claims in relevant evidence, and make important relationships comprehensible.

- Profile-specific addition: state whom the explanation helps and what kind of support the reader needs. Retain only what distinguishes the level.

- Current context and technical contract: revision, code location, the walk's purpose and transitions, relevant sources, available access, and the necessary output format.

The technical contract may contain fields genuinely needed for storage or rendering. Those fields should not become a prescribed rhetorical template for the visible text. Requirements concerning deletion, panel identity, or call counts belong in the product implementation and should not fill the persona's pedagogical instructions.

### Preserve goals and freedom in profile definitions

A derived Essentials instruction might, for example, express the goal of giving an experienced developer the main picture of the step in about two natural sentences, correct but not comprehensive, with depth behind Show more. A Standard instruction might focus on how the central mechanism works in context. A Teacher instruction might ask the agent to build the conceptual understanding the reader needs to follow that same mechanism.

These are starting points to develop, not finished, fixed prompts. Do not add exact sentence counts, a particular number of identifiers, mandatory bullet lists, or a universal inventory of locks, failure paths, and shutdown. Essentials' about two sentences is the size its definition states, not a count to enforce or clip to. Choose according to the code. Keep relevant exceptions within the principle itself rather than stacking conflicting rules.

### Give the agent what it needs to succeed

The explanation request needs sufficient orientation about the walk and access to relevant code. If pregeneration receives only a narrow excerpt while Explain this can search the entire workspace, no style instruction alone can eliminate the difference. Check both what is sent and what the agent is actually allowed to read.

Shared instructions should be reused between original text and alternative profile explanations where the tasks are the same. Switching profiles should not create a second, contradictory definition of a good explanation. This does not mean that every path must share the same agent session or copy the same chat.

A shared instruction must leave room for the profile's selection. A wording that asks the agent to keep every fact, risk, uncertainty, finding, and recommendation in each answer makes every profile retell the same material, and an original text sent along reads as a list of what must be said. The original text and earlier answers are material, never a mandatory content list: the code is the source of what is true, the review's state is where findings live, and the profile decides what help this reader needs to understand the code. The boundary a profile keeps is that it states nothing the code does not support and changes no decision of the review.

The same holds for what reaches the agent outside the profile's own instruction. A plan's brief for a step is written before the profile is known: it is orientation about what the step is for and what the planner saw, and the profile decides which of its points the reader needs. An answer format shared with general review questions may carry content rules of its own, such as a risk said in the first part or what could not be read named; for a profile's explanation the format gives the form only, and what to say is the profile's. Otherwise these sources act as a content list every profile meets the same way.

The reviewer in a loop judges whether the explanation helps the profile's intended reader. For Essentials it judges the short part apart from Show more: whether it gives a very short, comprehensible orientation, whether its claims are correct, and whether any extra length is justified by the size of the step or detail has leaked in. A detail it would ask for can go behind Show more; a missing detail, condition, risk or failure path is not by itself a finding, since the review's findings stay in the review's state, and a correct but detailed walkthrough is not an Essentials text. It does not ask Teacher for more detail merely to make the text longer; a claim that misleads is a finding in any profile. Judging the explanation's quality stays apart from approving the code.

### Improve by simplifying and testing

When an explanation fails, investigate whether the problem lies in the walk plan, code context, the agent's reading, the instructions, or presentation. Replace the faulty wording at the appropriate layer. Then assess new responses from the actual request path across several different cases. The text should become more comprehensible, not merely more compliant with rules.

## 7 Code panels and external context

### One panel per code location, even within the same file

Different code locations should be able to appear side by side in the panorama even when they belong to the same file. Panel identity must therefore include the code location and its revision context. A shared file path must not collapse them into a single panel that jumps up and down as the user steps through.

Next and previous step activate the appropriate panel and bring it into view horizontally. Each panel's manually adjusted position, width, and viewing context should be preserved during forward and backward navigation. Normal vertical scrolling within a panel remains possible; the problem is using it as a substitute for separate code locations.

Shift + mouse drag should navigate the panorama horizontally even when the drag starts over code. Input must not be intercepted in a way that forces the user to find an empty area to drag. Panel reuse and mouse event handling need separate verification.

### The same presentation order in every profile

Code navigation and explanation should have a consistent order for original text and subsequently generated alternatives. Essentials must not place code locations after all the text while Standard places them in the middle. Long Teacher text must not make step or code navigation difficult to reach.

The exact placement of controls is an implementation matter, but users should be able to switch profiles without relearning the view. Equivalent content should use the same typography, paragraph margins, and line spacing. Docked and standalone views, zoom, and restart should preserve a usable experience.

### The overview remains an overview

The left column displays walk and step titles and purposes. Profile text belongs in the selected explanation. Switching profiles must not rewrite the left column or fill it with deeper explanations. The navigation structure should remain stable while the explanation level changes.

### References lead to the code view

Use clickable references to the appropriate walk step when the code is covered there. Necessary side references open the correct revision, file, diff side, and code range in the Gerrit-style view, with a clearly highlighted target. For code outside the change itself, make the source context clear. Unresolved references must not be guessed. Returning restores the original location.

Avoid redundant filenames and line numbers in prose when navigation already points to the right place. Function names and other identifiers may be used when they aid understanding. In older walks, references must distinguish the next code location from the next step.

## 8 Evidence should be traceable without disrupting reading

### Explain and link external context

In the explanation, the agent should convey the relevant meaning of external evidence. If a library runs a callback on its own thread, that is the relationship the reader needs to understand. Entire header excerpts with flattened line numbers and comments must not be pasted into the running explanation or discussion.

The actual code should open in the intended code view with preserved line breaks, indentation, readable syntax, and highlighting. Present the source, revision, and relationship to the review compactly at the reference or in the source view. Short, clearly formatted code examples may be used for teaching when helpful; the problem is accidental source dumps and broken rendering.

### Version uncertainty should be precise and proportionate

A contract read at a dependency's HEAD is not automatically the contract for the version used by the product under review. The agent should try to establish the relationship using available version and build information. If that is not possible, qualify the relevant conclusion briefly and make the source's exact revision available for inspection.

The same large warning block need not recur in every explanation. Uncertainty must not be hidden when it affects a conclusion, but metadata should not dominate the reading flow. External code shown as context must not appear approved or part of the change currently under review.

### Instructions are inspectable at the appropriate level

What it asks for, the full persona definition, and the instruction version should not appear above every step. Show more about the code should remain available. The instructions DSpatch actually uses should be explicit, version-controlled, and inspectable at an appropriate internal or configuration level.

Inspectability does not require every internal prompt to appear in the normal review flow. The existing guideline on visible contracts addresses, among other things, the graph editor. If the current repository definition is ambiguous, clarify it rather than using it as a reason to reintroduce instruction text the user has asked to remove.

### A lasting source for maintenance

This reference is maintained as Markdown in the repository, at `docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md`, with Word as a reading edition generated from it. Derived agent instructions should be traceable to the version they are based on. New clarifications should be incorporated by revising the whole and removing superseded rules. The document should not grow into a chronological list of every historical prompt change.

## 9 Review state and explanation history

A review concerns an identified review target and has its own persistent identity. The same codebase, and even the same commit pair, may have multiple independent reviews. The repository path is therefore insufficient as the identity for walks or explanations.

### What belongs to the review

Walks, steps, generated profile explanations, follow-up questions, discussion, review progress, and decisions must belong to the correct review. Revisions and the comparison base must be identified. Relevant profile and instruction versions should be traceable so that older material does not appear newly generated with today's settings.

A new review starts without the previous review's walks, responses, or approvals. It uses current settings for new work. Any future reuse workflow must be explicit and show provenance; reuse must not happen automatically because the repository is the same.

### Closing is not deleting

- Closing a review preserves its contents so the user can continue later.

- Reopening restores the correct review with its material and position. Restart must not mix up instances.

- Deleting removes the review's own walks, explanations, history, and state. Source code and other reviews remain untouched.

- A late agent response must neither recreate a deleted review nor write its files back after deletion.

### When code or instructions change

An ongoing review should continue to concern the revision being reviewed. Newer code must be identified and must not silently replace the basis for earlier reasoning or approvals. Currency is a separate property: earlier judgments may need reconsideration even when a directly displayed line is unchanged, if a relevant dependency has changed.

Older walks and explanations should remain openable without rewriting their provenance. A changed prompt must not silently regenerate the entire history. New generation and any migration should have clear rules. Migration must be safe and repeatable, and actual user reviews must not be treated as disposable test data.

### Coverage and decisions are distinct from understanding

Planned code coverage indicates which changed lines the walks include. Explanatory coverage indicates whether relevant mechanisms are actually explained. Review status indicates what has been assessed and by whom. Displaying or mentioning code is not approval. Overlap must not be counted twice, unchanged context does not increase the denominator of changed-line coverage, and open findings must remain visible.

## 10 Step and Discussion serve different purposes

### Step owns the explanation and its continuation

Switching profiles displays the correct saved explanation for the current review, walk, and step. The walk's original text counts as the explanation for the profile used to generate it. The original must remain retrievable. Regeneration must not obscure provenance.

Tell me more and Explain more simply from Step continue within the current profile's context and history. Users should be able to return to earlier explanations. A simplification should make the current reasoning easier to understand, not silently select another profile or place the response in a shared stream that mixes profiles.

The exact design of history navigation needs to fit the existing product. The requirement is that users can return to previous versions and that different profiles do not overwrite or mix up each other's responses. Profile selection and relevant drafts should survive navigation and restart.

### Discussion is the user's actual conversation

Automatic profile switches and regenerations must not become visible chat questions or copies of Step text. Discussion retains the actual dialogue. It may receive the current code and displayed explanation as context without pasting them in as chat messages.

The dialogue may adapt its responses to the user's questions and feedback. There is no decision that every profile switch should split or switch the entire discussion history. The safe direction is a coherent conversation that respects explicitly requested tone and level. Old, genuine messages must not be deleted based on guesses about what was automatic.

### Storage and asynchronous responses must follow the correct owner

Explanations and pending requests need to distinguish review, walk, step, and profile, as well as the relevant revision or version. Opening, reopening, and returning to saved material must not create new calls. A missing alternative is generated according to the established arrival delay, without calls for steps the user merely passes through.

Late responses must not appear on another step or under another profile. Switching profiles during generation must be handled clearly and safely. A failed attempt waits for an explicit retry; it must not start resending automatically without end. Multiple views running the same component must not duplicate generation.

### Profile selection before and after generation

Profile selection should be consistent between the panel and selector even before the first walk exists. A walk opens with its original profile. Language selection changes visible names such as Essentials or Essens and Teacher or Pedagog without changing their internal identities. Original and alternative text should follow the same presentation principles.

## 11 Verify understanding and product behavior separately

### Test product behavior in real windows

Automated tests should check identities, storage, reference targets, and call behavior. Window tests should additionally demonstrate that users can actually navigate, read, and interact. Passing type checks or a test of a prompt string does not replace these checks.

- Two reviews of the same code remain separate through closing, reopening, and restart. Deleting one does not affect the other, and late responses cannot recreate the deleted review.

- Profiles can be selected before generation and switched afterward. Saved text reappears without new calls, and Discussion receives no automatic profile messages.

- Follow-up explanations and history belong to the correct profile and step. Errors, late responses, and multiple open views cause no loops, duplicates, or mixing of state.

- Separate locations in the same file appear side by side. Next, previous, and Shift + mouse drag work, as do internal links, diff references, and returning to the original location.

- Docking, standalone windows, zoom, Swedish profile names, readable typography, and preserved drafts work with the installed client.

### Assess pedagogical quality in actual text

Have a real model generate all profiles using the final instructions and relevant code context. Assess the text against the reader's needs: does Essentials give a correct main picture in about two natural sentences, with depth behind Show more, does Standard explain the mechanism, and does Teacher make the concepts and their interaction understandable? Assess relevance, clarity, and accuracy. Sentence counts, identifier counts, or keyword presence must not serve as acceptance criteria, and a length difference must not be forced where it does not help the reader.

Name the generation path of every text assessed: the one call that writes the whole walk, the loop's writer with its reviewer, or a profile alternative made by a step explanation after the walk. The paths differ in what the agent is given and whether a reviewer read the result, so a difference between texts from different paths must not be attributed to the profile alone. Compare profiles on the same locked walk plan, revision, and steps, with the same model and comparable code access, keeping the path the same within each comparison. Include a profile alternative made after the walk exists and check that it chooses its own level rather than paraphrasing the original text.

### Test variety and natural explanation

Use several synthetic cases: simple settings, multiple significant calls, alternative branches, a worker with waiting and retries, a shared snapshot, and external context. Vary languages and mechanisms so that one successful example does not become the only template. A simple change and a complex loop should not require equally long or identically formatted responses.

Compare pregenerated walk text with Explain this using equivalent context and profile intent. Assess whether both orient the reader, explain the displayed code, and make central relationships comprehensible. Investigate differences in prompts, context, and tool access before attributing the cause to the persona.

After a significant prompt change, assess new explanations from the final request path. Passing type checks does not demonstrate better pedagogy. Present the actual texts and supporting context, along with remaining gaps. Pass labels or counted sentences do not replace the reader's judgment.

### State the limits of the evidence

A simulated provider can substantiate interface behavior, prompt transmission, data flow, rendering, and call behavior. It cannot substantiate a real model's explanation quality. Report window tests and automated checks with their scope. Human assessment on real code is a separate part of the evaluation.

A release for further evaluation should contain the verified implementation and disclose its limitations. Builds, version numbers, pushing, and publishing are governed by the delivery task, not persona instructions. A delivered version is not, by itself, pedagogical approval.
