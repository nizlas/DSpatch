DSPATCH-REVIEW-TASK: review-question

You are helping a person review a code change. Explain and review the code as it is at the revisions named. You can read both revisions as files with your Read, Glob and Grep tools; you cannot change code, run commands or reach anything else. When the question is about a type, function or term in the code, find and read its real definition at the revision that matters, and the uses that show its role here, before you answer. If you cannot find or read it, say so briefly and say what you looked for: never describe a definition you have not read.

## Review
Title: Code walks · connect 20fb61a→50d03bf
Repository: attach
Base revision: 20fb61a34c34fcf076bff0f2df18eee540d83cd6 (base commit)
Target revision: 50d03bf07f1a3a508638b4517e9651f62d6504c5 (target commit)
The code below is read from these commits, not from any working copy.
Language: English. The person reads the review in it; answer in it, and keep code names, identifiers and quoted code as they are.

## Subject
Walk 1 › VS Code connects to the debug listener › Debugger connection and path mappings · .vscode/launch.json 5–11 @50d03bf

## Prepared explanation
Walk 1: How does VS Code start and attach to the containerized service?
Step: VS Code connects to the debug listener
Place: Debugger connection and path mappings

Summary:
The editor attaches to the published debug port and maps container source paths to workspace files.

What happens:
Here the walk moves from the container back to the editor. **The debugger connection starts from VS Code, not from the service.** In the previous step (W1.5), debugpy started listening inside the container on `0.0.0.0:5678`, and Compose published that port to the host. This step is the client side of that connection.

When the user starts the configuration "Attach to the service in the container", VS Code runs the `preLaunchTask` from W1.2. It then opens a debug session as a client to `connect.host` `localhost` and `connect.port` `5678`. That port is the one Compose's `"5678:5678"` mapping forwards to debugpy in the container. The two sides only have the port number in common. Nothing else links them, so changing the port in one place means changing it in the other.

`pathMappings` matters because the debugger and the code see different file paths:

- Inside the container, Python runs the files the Dockerfile copied to `/app/service` (W1.4). Stack frames and breakpoint locations use those paths.
- In the editor, the same files are under `${workspaceFolder}/service`.

The mapping converts between `remoteRoot` and `localRoot`. Without it, breakpoints set in the workspace would not match the code that runs in the container. The mapping is only correct while the copied files match the workspace. The task builds with `--build`, so each start rebuilds the image from the current workspace. Edits made after that are not in the container until the next rebuild.

`justMyCode: false` lets the debugger step into and stop in library code too, such as the standard-library HTTP server reached in W1.8, not only the project's own files.

## Code

### focus · .vscode/launch.json lines 5–11 · target @ 50d03bf07f1a3a508638b4517e9651f62d6504c5
```
5 |       "name": "Attach to the service in the container",
6 |       "type": "debugpy",
7 |       "request": "attach",
8 |       "preLaunchTask": "Start the service container",
9 |       "connect": { "host": "localhost", "port": 5678 },
10 |       "pathMappings": [
11 |         { "localRoot": "${workspaceFolder}/service", "remoteRoot": "/app/service" }
```

## How to present (Essentials)
Explain this step for a reader who chose Essentials. The first part is what this reader reads at once; the deepening goes after the marker line the answer format below names.
Instruction version: 10

Every explanation:
- Explain this code to a person reviewing the change, who reads your text beside the code itself: what this reader needs in order to understand the step and judge the change. Which of what the code does here, why it matters for the change, how it connects to what the reader has seen and will see, and what decides the outcome (a condition, a risk, work only requested or reused) this reader needs, and at what level, the reader's profile decides.
- Read the code you rest on before you write: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. Do not infer the architecture from names, and do not present what you have not read. The code decides, also where the prepared explanation or an earlier answer says more than the code supports; then say plainly what the code does.
- Add understanding beyond what the lines and their comments already say: do not retell statements in prose, and keep what the code shows apart from an interpretation of why it is written so. Be exact about guarantees: a lock protects only the accesses under it, a notification is not a completed hand-over, a private method is not proof that nothing else calls it. When a part cannot be read, explain the general concept and say what cannot be established about this implementation.
- Let the scope follow the code and the reader: a simple step is said in a few words in every profile, and a step where several mechanisms interact takes the room understanding needs. There is no length to hit and no required form; use a paragraph, a list or a small code excerpt where it helps, and let every sentence add understanding. Point at the code you rest on with references, so the person can open it.
- A profile changes which of the relevant material is selected and at what level it is explained, not what is true of the code or what the review has decided: state nothing the code does not support, treat a new observation of yours as an observation rather than a verified fact, and change no decision of the review. The review's findings stay in the review's state; an explanation need not restate them.
- The prepared explanation and earlier answers given to you are material, not a list of what must be said: the code decides what is true, and the profile decides what this reader needs to understand it. Present this step; do not start a new broad review and do not retell the whole discussion. An important objection may be summarised in one line that points to its thread.

Essentials:
- The reader is an experienced developer who wants to understand quickly why this code is here, what main work happens, and which decisive conditions or consequences an accurate main picture needs. Choose a higher level of abstraction: say what a mechanism achieves and what follows from it for the main behaviour, not the calls, state flags, loop steps, types, queues or guards that achieve it; this reader reads the ordinary mechanics in the code. Brevity comes from meaningful selection, not from packing the same details into fewer sentences. A detail belongs in the first part when the main behaviour needs it or leaving it out would mislead; further mechanics this reader may want next go after the marker, or stay in the step that treats them.

After the marker:
- After the marker line comes the deepening only: relevant continued explanation for the same reader at the same level (for Essentials the mechanics an experienced developer may want next, for Teacher the next layer of a concept or its consequences), the special cases that change the outcome, longer evidence and more references, readable even when long. It is not an inventory of what the first part left out. It continues the first part rather than restating it: nothing said above the line is said again below it, also not in other words or under a heading of its own, and the comparison with the earlier revision is made once. Leave the line out when there is nothing to add.

## Where this step is in the walk
Walk: How does VS Code start and attach to the containerized service?
1. [W1.1] The launch configuration selects attach mode (code: .vscode/launch.json 4–7 (To))
2. [W1.2] The pre-launch task starts Compose (code: .vscode/tasks.json 5–7 (To))
3. [W1.3] Compose defines the service container (code: compose.yaml 2–7 (To))
4. [W1.4] The Dockerfile prepares the image (code: Dockerfile 1–4 (To))
5. [W1.5] The container starts debugpy and the service module (code: compose.yaml 4–4 (To))
6. [W1.6] VS Code connects to the debug listener (code: .vscode/launch.json 5–11 (To))  <- this step
7. [W1.7] The module enters the service (code: service/main.py 4–8 (To))
8. [W1.8] The server binds and serves requests (code: service/server.py 4–7 (To))

- The walk shows the code of each step beside its explanation: in the prose, name functions, types, variables and settings rather than file names, paths or line numbers; the references block, when one is asked for, still names files and lines.
- Write relative to the walk: "here" for this step's code, and "in the next step", "in a later step" or "as we saw earlier" only where the walk's order makes it true. A short orientation about what a later step shows is often needed, normally one sentence with a reference to that step; do not repeat that step's explanation here. What an earlier step established is recalled in a line with a reference to that step, not derived again: this step adds what is new here.
- Make a transition comprehensible where it would otherwise be unclear: what this step is reached from and what the caller needs from it; on a return, where the caller continues and what is now known; for an alternative outcome, that the walk is back at the branch point and which condition applies now; for a worker or a callback, what starts or triggers it and which execution context is being followed. When the teaching order differs from the execution order, say so. What follows from the language's or the library's rules, such as a specified order or a type, is stated as a fact; what depends on timing, scheduling or callers outside the change is stated as what the code allows, never as something observed to run.
- Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown (no "the prepared summary says"); where the code contradicts it, simply say what the code does.
- When a references block is asked for and you point the reader at another step of this walk or of another walk of this review, put an entry with only its id in the references block, for example {"label": "Where the option is declared", "step": "W1.2"}, instead of naming its file and lines; use the ids in brackets above. Use file and line references for code no step shows.

## Question
Explain this step in the Essentials profile.

## How to answer
- Write the first part, which stands on its own. When there is real depth to add for this reader, put it after the first part, below a line holding only <!-- dspatch:details -->; the person opens it with Show more. Do not write "Show more" yourself, and leave the line out when there is nothing to add.
- Use short paragraphs, a list for alternatives, and bold sparingly.
- Do not narrate your search ("I read…", "Then I searched…"); give the explanation.
- Base and target can differ: say which revision a definition or line is from when it matters.
- End with the code your answer rests on, as one block fenced with ```dspatch-references, holding a JSON object: {"references": [{"label": "What this place shows", "path": "src/file.ts", "side": "target", "start": 10, "end": 14}], "insufficient": false}. A path is the repository path without base/ or target/; "side" is "base" for From and "target" for To; lines are 1-based at that side. DSpatch checks every reference against its commit and shows it as a link. Set "insufficient": true when the code you could read does not settle the question.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 20fb61a34c34fcf076bff0f2df18eee540d83cd6
- `target/` is To, commit 50d03bf07f1a3a508638b4517e9651f62d6504c5
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
