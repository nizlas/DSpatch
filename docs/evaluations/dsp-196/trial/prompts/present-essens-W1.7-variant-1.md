DSPATCH-REVIEW-TASK: review-question

You are helping a person review a code change. Explain and review the code as it is at the revisions named. You can read both revisions as files with your Read, Glob and Grep tools; you cannot change code, run commands or reach anything else. When the question is about a type, function or term in the code, find and read its real definition at the revision that matters, and the uses that show its role here, before you answer. If you cannot find or read it, say so briefly and say what you looked for: never describe a definition you have not read.

## Review
Title: Code walks · exec-debug c6eff39→f66dae6
Repository: exec-debug
Base revision: c6eff399b5473d8eba5da3f9ce3ffecf47a69c2d (base commit)
Target revision: f66dae63bc3b48aac899224e9748e7755f7db6f9 (target commit)
The code below is read from these commits, not from any working copy.
Language: English. The person reads the review in it; answer in it, and keep code names, identifiers and quoted code as they are.

## Subject
Walk 1 › The service starts detached under debugpy › Detached debugpy start · scripts/start-debugger.sh 23–24 @f66dae6

## Prepared explanation
Walk 1: Starting "Debug orders in the dev container"
Step: The service starts detached under debugpy
Place: Detached debugpy start

Summary:
docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.

What happens:
This is the script's last command, and it hands work off to another process. The `-d` flag tells `docker exec` to start the command inside `orders-dev` and return straight away without waiting for it. So the script reaches its end and exits with 0, and the pre-launch task from W1.2 counts as finished. The `debugpy` process keeps running in the container by itself, under the container's idle `sleep infinity` (W1.4).

That process does two things in a fixed order:

1. `--listen "0.0.0.0:$PORT"` opens debugpy's server on every interface in the container. Listening on `0.0.0.0` rather than localhost matters here, because the editor's connection comes in through the port that compose publishes, which arrives from outside the container.
2. `--wait-for-client` stops it before `-m orders.main` runs. The service code does not run until a debugger has attached.

**From this point two things run in parallel.** VS Code sees the task finish and moves on to attach (next step). At the same time, debugpy is still starting up in the container. The script does not wait for the port to be listening before it exits, so the order of those two events depends on timing.

## Code

### focus · scripts/start-debugger.sh lines 23–24 · target @ f66dae63bc3b48aac899224e9748e7755f7db6f9
```
23 | # Detached: docker exec returns at once, and debugpy waits for the editor before main runs.
24 | docker exec -d "$CONTAINER" python -m debugpy --listen "0.0.0.0:$PORT" --wait-for-client -m orders.main
```

## How to present (Essentials)
Explain this step for a reader who chose Essentials. The first part is what this reader reads at once; the deepening goes after the marker line the answer format below names.
Instruction version: 10

Every explanation:
- Explain this code to a person reviewing the change, who reads your text beside the code itself: what this reader needs in order to understand the step and judge the change. Which of what the code does here, why it matters for the change, how it connects to what the reader has seen and will see, and what decides the outcome (a condition, a risk, work only requested or reused) this reader needs, and at what level, the reader's profile decides.
- Read the code you rest on before you write: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. Do not infer the architecture from names, and do not present what you have not read. The code decides, also where the prepared explanation or an earlier answer says more than the code supports; then say plainly what the code does.
- Add understanding beyond what the lines and their comments already say: do not retell statements in prose, and keep what the code shows apart from an interpretation of why it is written so. Be exact about guarantees: a lock protects only the accesses under it, a notification is not a completed hand-over, a private method is not proof that nothing else calls it. When a part cannot be read, explain the general concept and say what cannot be established about this implementation.
- Let the scope follow the code and the reader: a simple step is said in a few words in every profile, and a step where several mechanisms interact takes the room understanding needs. There is no length to hit and no required form; use a paragraph, a list or a small code excerpt where it helps, and let every sentence add understanding. Point at the code you rest on with references, so the person can open it. These are the reader's perspective, not headings or a checklist, and the same facts may appear in several profiles; no profile goes on only because the material holds more facts.
- A profile changes which of the relevant material is selected and at what level it is explained, not what is true of the code or what the review has decided: state nothing the code does not support, treat a new observation of yours as an observation rather than a verified fact, and change no decision of the review. The review's findings stay in the review's state; an explanation need not restate them.
- The prepared explanation and earlier answers given to you are material, not a list of what must be said: the code decides what is true, and the profile decides what this reader needs to understand it. Present this step; do not start a new broad review and do not retell the whole discussion. An important objection may be summarised in one line that points to its thread.

Essentials:
- The reader is an experienced developer who wants to orient quickly. Organise the explanation around what this code is for and its most important effect in the flow: summarise several code operations into one meaningful action that helps this reader orient, rather than going through the operations; this reader reads the ordinary mechanics in the code. When the reader understands the step's task, its connection to the flow and the decisive consequence, the base explanation is done; further relevant facts are not automatically further things to tell here. A detail belongs in the first part when the main picture would otherwise mislead; mechanics this reader may want next go after the marker, or stay in the step that treats them. What the walk has already established need not be repeated, and more complex code may need more room.

After the marker:
- After the marker line comes the deepening only: relevant continued explanation for the same reader at the same level (for Essentials the mechanics an experienced developer may want next, for Teacher the next layer of a concept or its consequences), the special cases that change the outcome, longer evidence and more references, readable even when long. It is not an inventory of what the first part left out. It continues the first part rather than restating it: nothing said above the line is said again below it, also not in other words or under a heading of its own, and the comparison with the earlier revision is made once. Leave the line out when there is nothing to add.

## Where this step is in the walk
Walk: Starting "Debug orders in the dev container"
1. [W1.1] The debug configuration now attaches (code: .vscode/launch.json 5–12 (To))
2. [W1.2] The pre-launch task runs the script (code: .vscode/tasks.json 4–10 (To))
3. [W1.3] The script checks that the container is running (code: scripts/start-debugger.sh 3–11 (To))
4. [W1.4] The container the script expects (code: compose.yaml 2–11 (To))
5. [W1.5] debugpy is installed if missing (code: scripts/start-debugger.sh 13–16 (To))
6. [W1.6] The log folder is prepared for the host user (code: scripts/start-debugger.sh 18–21 (To))
7. [W1.7] The service starts detached under debugpy (code: scripts/start-debugger.sh 23–24 (To))  <- this step
8. [W1.8] VS Code attaches through the published port (code: .vscode/launch.json 9–12 (To))
9. [W1.9] The released service writes its log (code: orders/main.py 6–12 (To))

Other walks of this review:
- When the dev container is not running: [W2.1] The check fails and the script exits; [W2.2] The failed task blocks the attach

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
- `base/` is From, commit c6eff399b5473d8eba5da3f9ce3ffecf47a69c2d
- `target/` is To, commit f66dae63bc3b48aac899224e9748e7755f7db6f9
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.
