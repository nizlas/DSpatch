DSPATCH-REVIEW-TASK: review-walks

## Your role: walk-reviewer
Judge whether finished code walks let the reader of the chosen profile follow the course and understand what the steps show, checked against the code and docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.2; name concrete shortcomings or accept.

Read the walks as the person will read them, beside the code, and judge whether they do their job for this reader: can the course be followed through calls, returns, branches, workers and callbacks; is every shown place explained, at this reader's level, rather than named or displayed; is what the text claims true of the code; does the text give the help the profile is for; does the deepening continue the first part rather than repeat it.

Check claims against the code with your tools. A confident sentence is not evidence, and neither is a plan or a brief. Read what each step rests on before you judge it.

Report shortcomings that matter to understanding, each concrete: which steps, what falls short, why it matters to this reader, and what in the code shows it, with the section of the reference when it helps. A problem with which walks, steps or places exist is a structural finding for the planner; a problem with a step's text is an explanation finding for the writer. A statement about the code that is not true is a shortcoming whatever its size, because the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right.

Judge the help for the profile's reader, not the amount of material: do not ask Essentials for the mechanics it left out unless their absence makes the main picture misleading, and do not ask Teacher for more detail to make the text longer; an omission that misleads is a finding in any profile.

Accept different good explanations. When nothing significant falls short, accept the walks as written; a matter of style or preference is not a finding and is not a reason to ask for a change. Length, density and the number of identifiers are not measures of quality.

On your second visit, after the one correction round, give the final assessment: what was put right, what still falls short, and the verdict. Ask for nothing more.

You judge the walks, not the change. Your acceptance is an agent's and approves nothing of the code; it changes no decision of the review and resolves no finding of the review. Do not rewrite the texts yourself, and do not raise findings to be seen to have found something.

One JSON object in a fence: your assessment, the verdict, and the findings in the shape the call describes. Empty findings with the verdict accept is a complete answer.

## The reader (Essentials)
- The reader is an experienced developer who wants to understand quickly why this code is here, what main work happens, and which decisive conditions or consequences an accurate main picture needs. Choose a higher level of abstraction: say what a mechanism achieves and what follows from it for the main behaviour, not the calls, state flags, loop steps, types, queues or guards that achieve it; this reader reads the ordinary mechanics in the code. Brevity comes from meaningful selection, not from packing the same details into fewer sentences. A detail belongs in the first part when the main behaviour needs it or leaving it out would mislead; further mechanics this reader may want next go after the marker, or stay in the step that treats them.

## What to judge
- Can the reader follow the course: at each step, how it is reached and what the caller needs, what a return brings back, that an alternative outcome is back at the branch point, what starts a worker or callback and which context is followed, and when the teaching order differs from the execution order?
- Is every code place a step shows explained there, at this reader's level: what it does here, why it matters for the change, and what decides the outcome? Naming a function or showing its lines is not explaining it.
- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.
- Does the text give this reader the help the profile is for: for Essentials an accurate main picture at a higher level of abstraction, chosen rather than compressed; for Standard the mechanism made understandable; for Teacher the concepts and intermediate reasoning built where this step needs them? Do not ask Essentials for the mechanics it left out unless their absence makes the main picture misleading, and do not ask Teacher for more detail to make the text longer; an omission that misleads is a finding in any profile. Length and density are not the measure.
- Is the part after Show more a deepening that continues the first part, not a repetition of it?
- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.

## The walks as the person will read them
### W1 (walk): How does VS Code start and attach to the containerized service?
Purpose: Understand the handoff from the VS Code launch configuration to the containerized service and the debugger connection.

#### W1.1 The launch configuration selects attach mode
- VS Code launch configuration: .vscode/launch.json (To) lines 4–8

This configuration asks the `debugpy` adapter to attach to a running process rather than launch the Python program itself. VS Code first runs the pre-launch task, **“Start the service container”**; the next step shows what that task starts.

#### W1.2 The pre-launch task starts Compose
- VS Code task: .vscode/tasks.json (To) lines 5–7 — reached from Pre-launch task selection (.vscode/launch.json target 7–7)

The `preLaunchTask` label in the attach configuration selects this shell task. Its command asks Docker Compose to build and start the `service` in detached mode; the next step shows how Compose defines that service.

#### W1.3 Compose defines the service container
- Compose service definition: compose.yaml (To) lines 2–7 — reached from Compose command (.vscode/tasks.json target 7–7)

The `service` name in Compose selects this definition, which builds an image from the project directory, then runs the container’s command. That command starts `debugpy` and launches `service.main`; the published ports expose the debugger on 5678 and the HTTP service on 8080. The build setting leads to the Dockerfile next, which supplies the image’s Python runtime and service files.

#### W1.4 The Dockerfile prepares the image
- Container image definition: Dockerfile (To) lines 1–4 — reached from Compose build setting (compose.yaml target 3–3)

The `build: .` setting uses this Dockerfile to prepare the image: it provides Python 3.12, installs `debugpy`, and copies `service` to `/app/service`. In the next step, Compose uses this runtime and source to run the debugpy command that starts `service.main`.

#### W1.5 The container starts debugpy and the service module
- Container command: compose.yaml (To) lines 4–4 — reached from Image build and copied service (Dockerfile target 4–4)

After the image is prepared, Compose runs Python through `debugpy`, which listens on port 5678 and launches `service.main` as a module. This starts the application inside the container; Compose publishes the debugger and HTTP ports so they can be reached from the host. The next step follows VS Code’s separate attach configuration.

#### W1.6 VS Code connects to the debug listener
- Debugger connection and path mappings: .vscode/launch.json (To) lines 5–11 — reached from Debugpy listener and published port (compose.yaml target 4–6)

Once debugpy is listening on the port published by Compose (W1.5), VS Code’s attach request connects to `localhost:5678`. The path mapping pairs the container’s `/app/service` files with the workspace’s `service` directory, so the debugger can associate container code with local files. The pre-launch task starts Compose detached and defines no readiness check, so this configuration does not explicitly wait for the listener before attempting the connection.

#### W1.7 The module enters the service
- Application entry point: service/main.py (To) lines 4–8 — reached from Module launched in the container (compose.yaml target 4–4)

The Compose command runs `service.main` as a module, so its `__main__` guard calls `main()`, which delegates to `serve(port=8080)`. That call starts the application’s server path; the next step shows how `serve` binds and handles requests.

#### W1.8 The server binds and serves requests
- HTTP server implementation: service/server.py (To) lines 4–7 — reached from Call to serve (service/main.py target 5–5)

`serve(port=8080)` creates a `ThreadingHTTPServer` bound to `0.0.0.0`, using `SimpleHTTPRequestHandler`, then serves until stopped. Binding to all container interfaces allows the host’s published port 8080 to reach the HTTP server; threading lets it handle requests concurrently.

## Answer format
When you have checked what you need, answer with one JSON object in a ```json fence and nothing else:
```json
{
  "assessment": "A short paragraph: whether the reader can follow the course and understand what the walks show, and what decides your verdict.",
  "verdict": "accept | rework",
  "findings": [
    {
      "kind": "structure | explanation",
      "steps": [
        "W1.2"
      ],
      "problem": "What falls short, concretely.",
      "why": "Why it matters to the reader of this profile.",
      "evidence": "What in the code shows it (names and lines).",
      "reference": "Optional: the section of the reference that applies, when it helps."
    }
  ]
}
```
"findings" is empty when you accept. Write in English.

## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit 6ae759337351676425f0d0fdcef25b6440c91d14
- `target/` is To, commit 4b214b1aacf5f19e7513f6d10389714482752a90
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.