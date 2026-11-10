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
- Is every code place a step shows explained there, at this reader's level, so that this reader understands what it contributes to the change? Naming a function or showing its lines is not explaining it.
- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.
- Does the text give this reader the help the profile is for: for Essentials an accurate main picture at a higher level of abstraction, chosen rather than compressed; for Standard the mechanism made understandable; for Teacher the concepts and intermediate reasoning built where this step needs them? Do not ask Essentials for the mechanics it left out unless their absence makes the main picture misleading, and do not ask Teacher for more detail to make the text longer; an omission that misleads is a finding in any profile. Length and density are not the measure.
- Is the part after Show more a deepening that continues the first part, not a repetition of it?
- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.

## The walks as the person will read them
### W1 (walk): What happens when you press F5 to debug the service
Purpose: Follow the debug start from the launch configuration through the task, the image and the container command to the attach and the source mapping.

#### W1.1 From launching to attaching
- Old configuration: launch main.py locally: .vscode/launch.json (From) lines 4–10
- New configuration: attach, with a pre-launch task: .vscode/launch.json (To) lines 4–8

This is where debugging starts: the user picks this configuration and presses F5. **It no longer starts the service. It attaches to a service that something else has to start.**

- **Before:** the `launch` request ran `main.py` directly on the developer's machine, in VS Code's terminal. VS Code started the process and debugged it from the first line.
- **Now:** the `attach` request starts nothing. VS Code first runs the task that `preLaunchTask` names, "Start the service container". Then it connects to a debugger that should already be listening in the container (W1.8).

The service now starts outside VS Code. Debugging only works if that start has finished and the debugger is listening by the time VS Code tries to connect. The following steps show how the start happens. The next step is the task itself. Its `label` matches the `preLaunchTask` value exactly, and that match is how VS Code finds it.

Show more:
The configuration's name changed along with its behaviour. If a developer has the old "Run the service" entry selected, they now see "Attach to the service in the container" instead. No configuration left in this file runs the service locally without Docker.

#### W1.2 The pre-launch task starts the container
- Task that builds and starts the service container: .vscode/tasks.json (To) lines 4–8 — reached from preLaunchTask names this task (.vscode/launch.json target 8–8)

When F5 is pressed, VS Code runs this one shell command before it attaches:

- `--build` rebuilds the image from the current workspace first, so the container gets the code as it is now (the image comes in the next step).
- `service` starts only that one service from the compose file.
- `-d` (detached) makes the command return once the container has started. It does not wait for the program inside to be ready.

**VS Code counts the task as finished when the command exits, and then attaches.** The task has no `isBackground` flag and no problem matcher, so nothing tells VS Code to wait until the debugger inside the container is listening. "Container started" and "debugger listening on 5678" are different moments. Keep this gap in mind until the attach in W1.8.

Show more:
If the command fails, for example because Docker isn't running or the build breaks, it exits with an error. VS Code then reports the pre-launch task as failed instead of attaching. Docker Compose has a `--wait` flag that waits for the container to be running or healthy. This task doesn't use it, and the compose file defines no health check, so the compose file gives no readiness signal tied to debugpy.

#### W1.3 The image the service runs in
- Dockerfile: Dockerfile (To) lines 1–4 — reached from compose builds the image from this folder (compose.yaml target 3–3)

The `--build` in the task builds this image from the repository root. It is a minimal Python 3.12 image with two additions that the rest of the walk depends on:

- **debugpy is installed in the image.** The container command in the next step needs it there to wrap the service.
- **The service code is copied to `/app/service`, and `/app` is the working directory.** That lets the service run as the package `service` (W1.4–W1.5). `/app/service` is also the container path that the path mapping in W1.9 must match.

Nothing else is installed. The service only needs the standard library, and debugpy is the only extra package the image gets.

Show more:
- The `service` folder has no `__init__.py`. Imports such as `service.main` still work, because Python 3 treats a folder without that file as a namespace package.
- `pip install debugpy` is unpinned, so each rebuild of the image can pick up a newer debugpy release.
- The COPY puts a snapshot of the code into the image. Edits only reach the container through a rebuild, which the task's `--build` does on every F5.

#### W1.4 The container command: debugpy wraps the service
- Service command in compose: compose.yaml (To) lines 1–4

This is what the container started by the task runs. **debugpy starts first and the service runs inside it.**

1. debugpy opens a debug listener on port 5678 on all of the container's interfaces (`0.0.0.0`). That is the port VS Code will attach to through the host (W1.7, W1.8).
2. debugpy then runs `service.main` as a module from the working directory `/app`. The next step shows why running it as a module matters for the imports.

**There is no `--wait-for-client`, so the service runs at once without waiting for VS Code.** Code that runs early, such as the imports and the server setup, can finish before VS Code has attached and set breakpoints. Breakpoints in that code may then never hit. Code that runs per request comes later and isn't affected. Since the task in W1.2 doesn't wait for the listener either, nothing in this setup makes the start and the attach wait for each other.

Show more:
Adding `--wait-for-client` would make debugpy hold the program until a debugger connects. Every container start would then block until someone attaches, including a plain `docker compose up` run outside VS Code. This command chooses to start without waiting.

#### W1.5 service.main runs as a module
- Entry module: service/main.py (To) lines 1–9 — reached from debugpy runs this module (compose.yaml target 4–4)

This file is unchanged. debugpy runs it as the module `service.main`, so `__name__` is `"__main__"` and `main()` calls `serve(port=8080)`.

**How it is started now decides whether its first import works.** `from service.server import serve` needs the folder that *contains* `service` to be on Python's import path.

- **Now:** `-m service.main` is run from the working directory `/app`, and `-m` puts that directory on the path. `/app` contains `service` (W1.3), so the import resolves.
- **Before:** the old launch ran `main.py` as a script. Python then puts the script's own folder, `service/`, on the path, not the workspace root. Unless the environment added the root some other way, the `service.server` import would have failed.

This comes from reading the imports and Python's path rules. Neither start was observed running. From here the call goes into `serve`, the next step.

#### W1.6 The server listens on all interfaces
- serve(): service/server.py (To) lines 4–7 — reached from main() calls serve (service/main.py target 5–5)

`serve()` is unchanged, and two of its properties matter in the container:

- **It binds `0.0.0.0`, all interfaces, not `localhost`.** Inside a container, `localhost` is only reachable from within that container. Traffic arriving through a published port comes in on the container's network interface. Binding to all interfaces is what lets the 8080 mapping in the next step reach the server.
- **`serve_forever()` never returns.** The process keeps running, so the container stays up and the debug session has something to stay attached to. Request handling happens later, which is why breakpoints in it can still hit after a late attach (W1.4).

Show more:
The handler is `SimpleHTTPRequestHandler`, which serves files from the process's current directory. In the container that directory is `/app` (W1.3), so port 8080 serves the copied `service` source files. In the old local launch it served whatever directory VS Code started the process in. Since `ThreadingHTTPServer` is used, each request runs on its own thread. A breakpoint hit in one request pauses only that thread.

#### W1.7 Publishing the debug and HTTP ports
- Port mappings: compose.yaml (To) lines 5–7

These two mappings connect host ports to the two listeners inside the container. They use the same port numbers on both sides:

- `5678` leads to the debugpy listener from W1.4. VS Code attaches here in the next step.
- `8080` leads to the HTTP server from W1.6.

**Neither mapping names a host address, so Docker publishes both ports on all of the host's network interfaces, not only on `localhost`.** That matters most for 5678. Anyone who can connect to a debugpy port can run arbitrary code in the process. As written, any machine that can reach the developer's host on that port can connect, unless a firewall or Docker setup outside this repository blocks it. Writing `"127.0.0.1:5678:5678"` would limit it to the local machine. The same applies to 8080, which serves the files under `/app` (W1.6).

VS Code only needs `localhost:5678`, and that is what the next step connects to.

Show more:
Docker's published ports on Linux are usually set up through iptables rules that bypass host firewalls such as ufw. So a host firewall can't be relied on to hide a port published on all interfaces. That is general Docker behaviour. Nothing in this repository changes it.

#### W1.8 VS Code connects to the debug port
- Attach target: .vscode/launch.json (To) lines 9–9

The walk is back in VS Code. Once the task from W1.2 has exited, VS Code connects to `localhost:5678`, the host port that W1.7 publishes to debugpy in the container.

**Nothing in this setup makes the attach wait for debugpy to be listening.** These two things happen independently:

1. The task finishes when `docker compose up -d` has started the container.
2. Inside the container, Python still has to start and debugpy has to open its listener (W1.4).

From the configuration alone, the attach could therefore come before the listener exists, especially on a cold start or a slow machine. This is an open question from reading the code, not an observed failure. If it happens, the user would see the attach fail and would have to press F5 again. On a retry, the container is usually already running and the listener is ready.

Once the attach succeeds, the last step shows how breakpoints in local files find the code running in the container.

Show more:
The configuration has no retry or readiness check: `connect` holds only a host and a port. How long VS Code's debugpy extension keeps retrying a refused connection is up to the extension, and nothing in this repository sets it. A readiness wait in the task would close the gap. Examples are a background task with a problem matcher that waits for debugpy's output, or a wait loop on the port. Separately, as W1.4 noted, even a successful attach comes after the service's startup code has already run.

#### W1.9 Mapping container paths back to the workspace
- Path mapping and justMyCode: .vscode/launch.json (To) lines 10–13
- Where the code lands in the image: Dockerfile (To) lines 4–4

When the attach succeeds, VS Code and debugpy see the same code under different paths. The local file is under the workspace's `service` folder, while the container runs it from `/app/service`. `pathMappings` translates between the two: a breakpoint set locally is sent to the matching container path, and stack frames reported by the container open the local file.

**The `remoteRoot` is only correct because it equals the COPY destination shown beside it.** If the Dockerfile ever copies the code somewhere else, breakpoints silently stop binding. Nothing checks that the two stay in step.

The mapping matches files by path, not by content. It is only accurate while the container runs the same code as the local files. The task's `--build` rebuilds the image on every F5, which keeps them in sync at the start of each session. If a file is edited during a session, the container keeps running the old copy until the next F5, so lines in the editor and in the running code can differ.

`justMyCode: false` makes the debugger step into and stop in library code too, such as `http.server`, which handles every request here (W1.6), not only in the service's own files.

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
- `base/` is From, commit 481890131888b79be79becbb804e416ed318d6a2
- `target/` is To, commit abf269bd5b561bcf88886eed620340ddede2d581
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.