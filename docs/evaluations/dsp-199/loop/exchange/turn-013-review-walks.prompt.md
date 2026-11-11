DSPATCH-REVIEW-TASK: review-walks

## Your role: walk-reviewer
Judge whether finished code walks let the reader of the chosen profile follow the course and understand what the steps show, checked against the code and docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.2; name concrete shortcomings or accept.

Read the walks as the person will read them, beside the code, and judge whether they do their job for this reader: can the course be followed through calls, returns, branches, workers and callbacks; is every shown place explained, at this reader's level, rather than named or displayed; is what the text claims true of the code; does the text give the help the profile is for; does the deepening continue the first part rather than repeat it.

Check claims against the code with your tools. A confident sentence is not evidence, and neither is a plan or a brief. Read what each step rests on before you judge it.

Report shortcomings that matter to understanding, each concrete: which steps, what falls short, why it matters to this reader, and what in the code shows it, with the section of the reference when it helps. A problem with which walks, steps or places exist is a structural finding for the planner; a problem with a step's text is an explanation finding for the writer. A statement about the code that is not true is a shortcoming whatever its size, because the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right.

Judge the help for the profile's reader. For Essentials, judge the first part apart from what follows the marker, as a very short orientation of about two natural sentences: a correct but detailed walkthrough is not Essentials, and a missing detail is not by itself a finding. Do not ask Teacher for more detail to make the text longer. A claim that misleads is a finding in any profile.

Accept different good explanations. When nothing significant falls short, accept the walks as written; a matter of style or preference is not a finding and is not a reason to ask for a change. Length, density and the number of identifiers are not measures of quality.

On your second visit, after the one correction round, give the final assessment: what was put right, what still falls short, and the verdict. Ask for nothing more.

You judge the walks, not the change. Your acceptance is an agent's and approves nothing of the code; it changes no decision of the review and resolves no finding of the review. Do not rewrite the texts yourself, and do not raise findings to be seen to have found something.

One JSON object in a fence: your assessment, the verdict, and the findings in the shape the call describes. Empty findings with the verdict accept is a complete answer.

## The reader (Essentials)
- The reader is an experienced developer who sees the code beside your text and can always open Show more. Extreme brevity is the primary goal: the first part aims at about two natural sentences on what this step accomplishes and its central role or relationship in the flow. Adapt to the size of the code only where you must; a very large piece of code can need more, but the first part still gives only the main picture, and two long sentences that pack in a walkthrough do not meet it. Leave out the calls, flags, fields, mechanisms, every condition and the failure paths: the reader sees them in the code, and what is worth reading of them goes after the marker. Choosing what to leave out is the job. What the first part says must be correct, not comprehensive: make an overreaching claim precise rather than adding reservations.

## What to judge
- Can the reader place each step in the walk's course: what it does there and where the walk goes next? A transition the step's role needs must not be wrong; the rest of the course may follow the marker.
- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.
- Judge the first part apart from what follows the marker. Does it give this reader a very short, comprehensible orientation, about two natural sentences on what the step accomplishes and its central role? Is any extra length justified by the size of the step, or has detail leaked in? A correct but detailed walkthrough is not an Essentials first part.
- Does the first part leave a wrong picture of the step's role? Correct an overreaching claim by making it precise, not by adding reservations. A detail, condition, risk or failure path that is missing is not by itself a finding; one you would ask for can go after the marker, and the review's findings stay in the review.
- Is the part after the marker a coherent deepening rather than an inventory of what was read, and does it avoid repeating the first part?
- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?
Report only shortcomings that matter to the reader's understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step's text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.

## The walks as the person will read them
### W1 (walk): What happens when the developer starts "Debug orders in the dev container"
Purpose: Follow F5 from the debug configuration through the task and the script into the container, and back to the attach.

#### W1.1 The debug configuration now attaches
- Debug configuration (attach with preLaunchTask): .vscode/launch.json (To) lines 5–12

This is where F5 starts. The configuration no longer starts `orders.main` on the host. It now **attaches** to a debugger that must already be listening, and its `preLaunchTask` names the task that sets that listener up before the attach.

Show more:
In the base version, this file's only configuration was "Run orders locally". It used `request: "launch"` with `module: "orders.main"` and `console: "integratedTerminal"`, so the editor started the service itself on the host. That configuration has been replaced, not added to, so the change leaves no local-run configuration.

With `request: "attach"`, the editor starts no process. It only connects. Something else has to provide the debugpy listener. The `preLaunchTask` value, "Start debugger in dev container", has to match a task label exactly, and the editor runs that task before it tries to attach. In the next step, that label leads to the task in the repository's tasks file. `connect` and `pathMappings` are covered in a later step.

#### W1.2 The pre-launch task runs the script on the host
- Task definition: .vscode/tasks.json (To) lines 4–10 — reached from preLaunchTask that names this task (.vscode/launch.json target 8–8)

This is the task that `preLaunchTask` names, matched by its label. It runs `start-debugger.sh` in a shell **on the host**, not in the container, and passes the container name `orders-dev` and port `5678` as `DEV_CONTAINER` and `DEBUG_PORT`. The editor waits until the command exits before it attaches.

Show more:
- **When the editor counts the task as done.** `problemMatcher: []` means the editor doesn't scan the output for a "ready" signal, so it treats the task as finished when the command exits. The script therefore has to return instead of keeping the service in the foreground. Its last line does that by starting debugpy detached, covered in a later step. The exit code is the only success or failure signal. Walk W2 follows the failure case.
- **Two values that must match elsewhere.** `DEV_CONTAINER` and `DEBUG_PORT` repeat values that appear in other places: the container name from the compose file and the port in the attach configuration's `connect`. The script also has its own defaults for both, shown in the next step.
- **Point to check: how the script is started.** `command` points straight at the script file. The script starts with `#!/usr/bin/env bash`, so starting it directly needs the file's executable bit on the host. If the script is committed with mode 100644 (not executable), a fresh checkout may refuse to run it until the mode is fixed or the command calls `bash` explicitly. This is a reading of the configuration; it hasn't been observed running.

#### W1.3 Settings and the running-container guard
- Defaults and container check: scripts/start-debugger.sh (To) lines 3–11

Still on the host, the script picks up the container name and port, falling back to `orders-dev` and `5678` when they aren't set. It then makes sure that container is running before it touches it. In this walk the container is running, so the script goes on; walk W2 follows the case where it isn't.

Show more:
- **Strict mode.** `set -euo pipefail` makes the script stop at the first failing command, at any use of an unset variable, and at any failure inside a pipeline. A failed `docker exec` later on therefore ends the task with a non-zero exit, which the editor sees.
- **How the guard works.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false` for a container that exists. For a missing container it fails, with its error output thrown away. Anything other than exactly `true` takes the exit-1 branch. Because the check sits inside an `if` test, the failing `docker inspect` doesn't trigger `set -e`; the branch handles it.
- **One port, four places.** The defaults repeat the values the task already sets, so these two settings matter only when the script runs outside the task. The port appears in four places that must agree: the task's `DEBUG_PORT`, this default, the `5678:5678` mapping in the compose file (lines 8–9 of `compose.yaml` on the target side), and `connect.port` in the attach configuration. The container name must also match `container_name: orders-dev` there.

#### W1.4 debugpy is installed into the container on demand
- Conditional debugpy install: scripts/start-debugger.sh (To) lines 13–16

The script makes sure debugpy is available **inside the container**, which runs the plain `python:3.12-slim` image without it. It installs debugpy only when the import check fails, so normally just the first run in a fresh container pays for the install.

Show more:
Both `docker exec` commands run the container's Python, not the host's. The host doesn't need debugpy for this, and its Python environment isn't involved.

The install lands in the container's own filesystem, in the image's site-packages, not under the bind-mounted `/workspace`. The repository contains no requirements file or Dockerfile that adds debugpy. So the install lasts as long as that container exists: it survives stopping and starting the same container, but a recreated container (for example after `docker compose down`) installs it again on the next F5. That install needs network access from the container. If it fails, `set -e` from the previous step ends the script with an error before anything is started.

#### W1.5 The log folder is created and given to the host user
- mkdir and chown of the log folder: scripts/start-debugger.sh (To) lines 18–21

The script creates the log folder inside the container and **makes the host user its owner**. Because `/workspace` is the bind-mounted repository, the folder also shows up in the developer's checkout. This sets the owner of the folder only; whether the log file the service later writes there can be edited from the host comes up again in a later step.

Show more:
`$(id -u):$(id -g)` is expanded by the host shell before `docker exec` starts. So `chown` inside the container receives the host user's numeric ids, not the container user's.

The container runs as root because the compose file sets no `user:`, and `python:3.12-slim` defaults to root. That is why the folder would otherwise be root-owned.

The comment says files the service writes there "stay editable". The code doesn't give that guarantee. `chown` changes the folder alone, and files created inside it later get the creating process's owner, which here is root. What the folder's owner can do with those files depends on their permission bits, so the question stays open until `main()` writes `orders.log`.

On Docker Desktop, how bind mounts handle file ownership can differ from Linux. This is a general point; the repository doesn't show which setup is used.

#### W1.6 The service starts detached under debugpy
- Detached debugpy start: scripts/start-debugger.sh (To) lines 23–24

This is where the work leaves the script. `docker exec -d` starts debugpy as a separate process **inside the container**, and debugpy holds back `orders.main` until a debugger connects. `docker exec` returns immediately, so the script exits successfully and the editor counts the pre-launch task as done.

Show more:
After this line nothing on the host is tied to the debugpy process. It keeps running in the container when the host shell exits. debugpy listens on `0.0.0.0` at `$PORT` inside the container, so it is reachable through the published port shown in the next step. With `--wait-for-client`, it runs `orders.main` only once a client attaches.

`docker exec -d` reports success once the process has been started, not once debugpy is listening or has started without error. Three points follow from the code and are worth checking; they are not observed behaviour:

- **Timing.** Nothing in the script waits for the port to accept connections. The editor may try to attach before debugpy listens. Whether that fails or is retried depends on the editor's attach behaviour.
- **A second F5.** The script doesn't stop or look for an earlier debugpy process. If an earlier run is still alive, it still holds `$PORT` and, once `main()` runs, port 8000 as well (`serve(port=8000)` in `orders/main.py` on the target side). A new start would then fail to bind, or the editor might attach to the old process.
- **Silent failures.** Any error from the detached process, such as a bind failure or an import error, appears neither in the task's output nor in its exit code.

#### W1.7 How localhost:5678 and /workspace reach the container
- Dev service: name, mount, ports: compose.yaml (To) lines 2–11

This unchanged compose service is what the debugging setup relies on. It publishes the container's port 5678 on the host, so the editor's `localhost:5678` reaches debugpy, and it **mounts the repository at `/workspace`**, so the container runs the same files the developer edits.

Show more:
How each setting is used by the earlier steps:

- `container_name: orders-dev` gives the fixed name that the task's `DEV_CONTAINER` and the script's default use. A container started under another name fails the running-container check.
- `working_dir: /workspace` is the default directory for `docker exec`. Python's `-m` puts that directory on the import path, which is why `-m orders.main` finds the `orders` package in the mounted repository.
- `command: sleep infinity` only keeps the container alive. The developer starts it once with `docker compose up -d dev`, and the script then adds processes to it.
- The `"8000:8000"` mapping publishes the port that `main()` serves on, so the running service can be reached from the host too.

The base revision already had both port mappings and the mount. This change relies on them rather than adding them.

#### W1.8 The editor attaches and maps paths
- connect and pathMappings: .vscode/launch.json (To) lines 9–12

Once the task has finished, the editor connects to `localhost:5678`, which the published port forwards to debugpy in the container. `pathMappings` translates between the editor's `${workspaceFolder}` and the container's `/workspace`, **the same pairing as the bind mount**, so breakpoints set in host files land on the files the container runs.

Show more:
The translation works in both directions. Breakpoints in a host file are sent to debugpy as `/workspace/...` paths, and stack frames that debugpy reports under `/workspace/...` open as the matching host files. The mapping is correct only while `${workspaceFolder}` is the folder that holds the compose file, since the mount's `.` is the repository root. If the editor opens a parent or child folder, the mapping no longer matches the mount and breakpoints can go unbound.

Once the editor attaches, debugpy stops waiting and runs `orders.main` inside the container. The next step follows that.

#### W1.9 main() runs in the container and writes the log
- main(): log setup and serve: orders/main.py (To) lines 6–12

This is the service itself, running in the container process that debugpy started once the editor attached. `main()` creates the log folder if it doesn't exist, writes `orders.log` into it, and serves HTTP on port 8000, which the compose file publishes. Here the question from the log-folder step comes back: **the host user owns the folder, but the service, running as root, creates the file**.

Show more:
`LOG_DIR.mkdir(exist_ok=True)` would create `/workspace/logs` without the script's help. So the script's `mkdir` matters only so that its `chown` has a folder to act on.

`logging.basicConfig(filename=...)` opens `orders.log` from inside the container process, so the file gets that process's owner, not the folder's. Whether the developer can edit it from the host depends on the file's own permission bits and on how the bind mount maps ownership, and neither is set anywhere in this repository. Owning the folder lets the host user rename or delete entries in it. That isn't the same as being able to write into a root-owned file. The script's comment says the files "stay editable", and that claim rests on this distinction.

`serve(port=8000)` runs `HTTPServer(...).serve_forever()` (`orders/http.py` on the target side), so the process keeps running until something stops it. That makes the earlier question about a second F5 relevant while this process is alive.

### W2 (walk): What happens when the dev container is not running
Purpose: Follow the failing branch of the container guard back to the editor.

#### W2.1 The guard fails and the script exits 1
- Not-running branch: scripts/start-debugger.sh (To) lines 8–11

This is the same guard as in the first walk, now with the container stopped or missing. The script prints how to start the container and exits with status 1 before it touches the container, so **the pre-launch task fails** and no debugger is started.

Show more:
For a stopped container, `docker inspect` prints `false`. For a missing one, it fails, and `2>/dev/null` discards its error. Either way the result isn't `true`.

The same branch also catches cases the message doesn't describe, because the discarded error was the only clue:

- the Docker daemon isn't reachable;
- `docker` isn't installed on the host;
- the container runs under a different name than `DEV_CONTAINER`.

In all of these the developer sees the same hint to run `docker compose up -d dev`.

The message goes to stderr in the task's terminal, and the exit code is the only signal the editor gets. The next step shows what the editor does with it.

#### W2.2 The failed pre-launch task stops the attach
- preLaunchTask dependency: .vscode/launch.json (To) lines 7–8

Back in the editor, the pre-launch task has ended with exit code 1. What happens next is decided by the editor, not by code in this repository. Usually it reports the failed task and doesn't attach, so **the developer has to start the container and press F5 again**. The base "Run orders locally" configuration could never fail this way, because it needed no container.

Show more:
Because the task has `problemMatcher: []`, the editor has nothing structured to show. The failure appears only as the exit code and the script's message in the task terminal, which tells the developer to run `docker compose up -d dev`.

Editors commonly let the user debug anyway after a failed pre-launch task. If the developer does that here, the attach to `localhost:5678` has nothing to connect to: the container that would publish the port isn't running, and no debugpy was started in it.

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
- `base/` is From, commit baba2c69c8f5bd5f359edb09d32ec66316806ad6
- `target/` is To, commit 4916a8041ce4b85a3b147dece00cb5a9d3270449
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.