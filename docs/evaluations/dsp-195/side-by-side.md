# DSP-195 · the texts side by side

Every text as the person reads it: what stands **before Show more** and what is **behind Show more**, apart. A reference block (shown as the links "The code it rests on") is left out of both. Generated from the runs in this folder; nothing is edited.

## 1. One-call preparation (the product default): the attach step

Each sample is a whole walk the one-call preparation planned and wrote; the step shown is the first one whose place is in `.vscode/launch.json`. Visible: the summary, the body and "Why it matters". Version 9 samples `v9r-*` are the version 10 harness with the prompt put back to version 9 exactly (checked against a real version 9 prompt: identical apart from revisions and paths).

### abl-claude-essens-asbuilt-2 · essens · claude/opus · reported (not captured)

Step W1.1 "The debug configuration now attaches instead of launching". Visible 752 characters, behind 406.

**Before Show more**

> VS Code no longer starts the program. It runs a task first and then connects to a debug server.
> 
> This is the entry point: the configuration the developer picks in VS Code's Run and Debug view.
> 
> Old configuration (`request: "launch"` with `program`): VS Code's debugpy extension started `service/main.py` itself, in the integrated terminal, on the host's Python.
> 
> New configuration (`request: "attach"`): VS Code starts no process. It does two things, in this order:
> 1. It runs `preLaunchTask`, the task labelled "Start the service container" (next step).
> 2. It connects to a debugpy server at the `connect` address (a later step).
> 
> The launch configuration is replaced, not added to. **Running the service locally under the debugger now needs Docker.**

**Behind Show more**

> One likely side benefit, read from the code rather than tested: the old way started `service/main.py` as a script. That puts `service/` itself first on `sys.path`, so `from service.server import serve` in `main.py` would only resolve if the workspace root were importable some other way. The new command, `-m service.main` run from `/app`, imports `service` as a package, which is how `main.py` is written.

### abl-claude-essens-neutral · essens · claude/opus · reported (not captured)

Step W1.1 "The configuration switches from launch to attach". Visible 631 characters, behind 306.

**Before Show more**

> VS Code no longer starts the program. It runs a task first and then connects to a debugger that is already running.
> 
> In the base version, `request: "launch"` with `program` made VS Code start `service/main.py` locally under debugpy. In the target version, `request: "attach"` means VS Code starts nothing itself. It expects a debugpy server to be listening already.
> 
> Before it connects, VS Code runs the task named in `preLaunchTask`. The name must match a task `label` exactly. The next step shows that task. `connect` then points the debugger at `localhost:5678`, which a later step shows is the container's published debug port.

**Behind Show more**

> The base `program` approach ran `main.py` as a script. That puts `service/` on `sys.path`, so `from service.server import serve` likely failed with a module-not-found error. Starting the service as a module in the container, shown in a later step, avoids this. This is inferred from the code, not observed.

### abl-claude-standard · standard · claude/opus · reported (not captured)

Step W1.1 "The debug configuration switches from launch to attach". Visible 961 characters, behind 484.

**Before Show more**

> VS Code no longer starts the program itself. It runs a task first and then connects to a debugger that is already listening.
> 
> This is the entry point: the developer picks this configuration and presses F5.
> 
> In From, `"request": "launch"` told the debugpy extension to start `service/main.py` itself, in the integrated terminal. In To, `"request": "attach"` means VS Code starts no process. It only connects a debug client to `connect.host`/`connect.port` (`localhost:5678`), where something else must already be listening.
> 
> That something is started by `preLaunchTask`. VS Code looks up a task with the label `"Start the service container"` and runs it **before** it tries to connect. The next step shows that task.
> 
> The removed `console` and `program` keys belong to launch mode. With attach, the service's output goes to the container's logs, not to a VS Code terminal.
> 
> Why it matters: Where the service runs, and who starts it, moves from VS Code to Docker.

**Behind Show more**

> Running `service/main.py` as a script (the From way) puts `service/` itself on `sys.path`, not the workspace root. The file then imports `from service.server import serve`, which needs the folder that contains `service/` to be importable. Whether From worked depended on the working directory or `PYTHONPATH`. The container runs `-m service.main` from `/app` instead, which fits that absolute import. That fit is a side effect of the change, not something the diff states as its goal.

### v10-attach-single-essens-claude-1 · essens · claude/opus · reported (not captured)

Step W1.1 "The debug configuration now attaches". Visible 630 characters, behind 0.

**Before Show more**

> F5 now attaches to a running debugpy instead of starting the program locally.
> 
> The old configuration used `request: launch`, so VS Code started `service/main.py` itself. The new one uses `request: attach`, so VS Code starts nothing. It connects to a debugpy server that something else must already have started.
> 
> That something is `preLaunchTask`. Before attaching, VS Code runs the task named "Start the service container" (next step). Only after that task ends does VS Code try `localhost:5678`.
> 
> Why it matters: **Attaching depends on debugpy already listening when the task ends.** Later steps show why that is not guaranteed.

**Behind Show more**

_(empty)_

### v10-attach-single-essens-claude-2 · essens · claude/opus · reported (not captured)

Step W1.1 "The debug configuration now attaches". Visible 507 characters, behind 0.

**Before Show more**

> F5 no longer starts Python locally. It attaches to a debugpy server and runs a task first.
> 
> The old configuration had VS Code start `service/main.py` itself. The new one uses `request: attach`: VS Code starts no process. It connects to a debugpy server that is already listening on `localhost:5678`.
> 
> The server has to come from somewhere, so `preLaunchTask` names a task that VS Code runs before it tries to connect. The next steps follow that task. A later step comes back to `connect` and `pathMappings`.

**Behind Show more**

_(empty)_

### v10-attach-single-essens-claude-3 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "Launch becomes attach". Visible 491 characters, behind 348.

**Before Show more**

> The configuration no longer starts a program; it runs a task first and then attaches.
> 
> In the old version, VS Code started `service/main.py` itself, so the debugger owned the process. In the new version, `request` is `attach`. VS Code starts nothing directly: **it runs `preLaunchTask` first and only then connects to a debugpy server that something else has started**.
> 
> This also removes the local way of running the service from the debugger. The only remaining configuration needs Docker.

**Behind Show more**

> The old `launch` config ran `main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root, so `from service.server import serve` in `main` would not obviously resolve. The new setup runs the code as a module (`-m service.main`) from `/app`, so the package import works there (see the later step on the Compose `command`).

### v10-attach-single-essens-claude-4 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "The debug configuration switches from launch to attach". Visible 547 characters, behind 398.

**Before Show more**

> VS Code no longer starts the Python process. It runs a task first and then connects to a debugger that is already listening.
> 
> Before, `request: launch` with `program` meant VS Code started `service/main.py` itself, and the debugger was there from the first line.
> 
> Now `request: attach` means VS Code starts nothing in Python. It runs the `preLaunchTask` and then connects to `localhost:5678`. The service is only debuggable if something else has already started it **with a debugpy listener on that port**. The following steps show what does that.

**Behind Show more**

> There is a small difference in how the module is loaded. Run as a `program`, the script directory `service/` comes first on `sys.path`, so `from service.server import serve` in `main.py` depends on how the workspace root reaches the path. In the container the service runs as `-m service.main` from `/app` (see the compose step), so the `service` package import resolves from the working directory.

### v10-attach-single-essens-claude-5 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "From launch to attach". Visible 639 characters, behind 0.

**Before Show more**

> The configuration changes from starting a local process to attaching to a running one, after a task has run.
> 
> Before, VS Code started `service/main.py` itself in the integrated terminal. Now `request` is `attach`: **VS Code starts no Python process**. It expects one that is already listening for a debugger.
> 
> The `preLaunchTask` names the task that starts that process. VS Code runs the task first and starts the attach only when the task has finished. The task is shown in the next step.
> 
> Why it matters: Anyone who used "Run the service" for local runs without Docker loses that option. This file has no local launch configuration left.

**Behind Show more**

_(empty)_

### v10-attach-single-essens-copilot-1 · essens · copilot/default · reported gpt-6-luna

Step W1.1 "Choose attach mode". Visible 396 characters, behind 113.

**Before Show more**

> VS Code runs a startup task before attaching to the debug listener.
> 
> This configuration no longer launches `main.py` on the host. It asks VS Code to run **Start the service container** first, then connect to `localhost:5678`. The path mapping relates the container's `/app/service` files to the workspace's `service` directory, so the attached debugger can associate remote code with local files.

**Behind Show more**

> The configuration also sets `justMyCode` to `false`, allowing debugging to include code outside the user's files.

### v10-attach-single-pedagog-claude-1 · pedagog · claude/opus · reported (not captured)

Step W1.1 "The launch configuration changes from launch to attach". Visible 911 characters, behind 0.

**Before Show more**

> VS Code no longer starts the program itself; it connects to one that is already running.
> 
> A VS Code debug configuration has one of two `request` modes:
> 
> - **launch**: VS Code starts the Python process itself, with the debugger already inside. This is what the From side did with `program` pointing at `service/main.py`.
> - **attach**: VS Code starts nothing. It connects over the network to a debugger server that some other process already runs.
> 
> The To side uses `attach`. As a result, `program` and `console` are gone, and something else has to start the service and its debugger server. That job goes to `preLaunchTask`, the next step. `connect` tells VS Code where to find the debugger server, and `pathMappings` tells it how to translate file paths. Later steps cover both.
> 
> The old local run is removed, not kept next to the new one. With this file, the debug menu can only run the service through Docker.

**Behind Show more**

_(empty)_

### v10-attach-single-standard-claude-1 · standard · claude/opus · reported (not captured)

Step W1.1 "The launch configuration: from launch to attach". Visible 772 characters, behind 407.

**Before Show more**

> The debug configuration now attaches to a debugger that is already listening, after running a task first.
> 
> This is where F5 starts. In the old version (From), VS Code started `service/main.py` itself as a local process (`request: launch`, `program`).
> 
> In the new version (To), `request: "attach"` means VS Code starts nothing. It connects to a `debugpy` server that is expected to be listening at `connect` (`localhost:5678`). Something else must start that server first. This is the job of `preLaunchTask`: VS Code runs the task whose **label** is exactly `"Start the service container"` and only connects once the task has finished.
> 
> The next steps follow that task. `pathMappings` and `justMyCode` matter once the debugger is connected; they come back in the last step.

**Behind Show more**

> The old `launch` configuration ran `${workspaceFolder}/service/main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root, so `from service.server import serve` in `main` could only resolve if the workspace root was on the path in some other way (for example through `PYTHONPATH`). The new setup runs `-m service.main` from `/app` (see a later step), which avoids this question.

### v10-attach-single-standard-copilot-1 · standard · copilot/default · reported gpt-6-luna

Step W1.1 "Choose attach mode". Visible 280 characters, behind 0.

**Before Show more**

> VS Code is configured to attach to an existing debugpy process.
> 
> This configuration requests an **attach**, not a local Python launch. Before attaching, VS Code runs the named `preLaunchTask`, then connects to `localhost:5678`. The task that starts the container is the next step.

**Behind Show more**

_(empty)_

### v9-attach-single-essens · essens · copilot/default · reported (not captured)

Step W1.1 "Choose the attach configuration". Visible 544 characters, behind 0.

**Before Show more**

> VS Code runs a startup task before attaching to debugpy.
> 
> When this configuration is selected, VS Code runs the task named in `preLaunchTask`, then connects to `localhost:5678`. The path mapping relates local files under `service` to `/app/service` in the container, so breakpoints can correspond to the code Python runs there. `justMyCode: false` allows stepping beyond user-code-only filtering.
> 
> Why it matters: Unlike the previous launch configuration, this one expects the service to be started separately and waits for a debugger endpoint.

**Behind Show more**

_(empty)_

### v9-attach-single-essens-2 · essens · copilot/default · reported gpt-6-luna

Step W1.1 "Configure the attach". Visible 535 characters, behind 0.

**Before Show more**

> VS Code runs a pre-launch task, then connects to the debug listener.
> 
> This configuration changes the launch from running `main.py` locally to attaching to a process at `localhost:5678`. It names the task VS Code runs first; the next step shows that task. `pathMappings` relates local files under `service` to `/app/service` in the container, so the debugger can associate container paths with workspace files.
> 
> Why it matters: The debugger attaches after the task completes; this configuration does not itself start the Python process.

**Behind Show more**

_(empty)_

### v9-attach-single-essens-claude · essens · claude/opus · reported (not captured)

Step W1.1 "The debug configuration switches from launch to attach". Visible 517 characters, behind 395.

**Before Show more**

> VS Code no longer starts the service itself. It connects to a service that already runs.
> 
> In the old configuration, the debugpy extension started `service/main.py` as a local process (`request: launch`, `program`, `console`). In the new one, `request` is `attach`: VS Code starts nothing itself. It expects a debugpy server to be listening already, and `preLaunchTask` names the task that is meant to make that true.
> 
> This was the only configuration, so **no way to debug the service locally without Docker remains**.

**Behind Show more**

> The old local launch ran `main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root. So `from service.server import serve` in `main.py` resolved only if the workspace root reached the path some other way, for example through `PYTHONPATH`. The new container command (a later step) runs `-m service.main` from `/app`, where the package import works by Python's rules.

### v9r-attach-single-essens-claude-3 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "Before: the service ran on the local Python". Visible 621 characters, behind 0.

**Before Show more**

> The old configuration launched `service/main.py` directly in VS Code's terminal.
> 
> In the base revision, F5 started `service/main.py` with `"request": "launch"`. That means debugpy started the program itself, on whatever Python the developer had selected, in the integrated terminal. No container was involved, and the debugger was there from the first line.
> 
> The next steps show what replaces this. The program is now started somewhere else, and VS Code only connects to it.
> 
> Why it matters: This way of running the service is removed from the workspace. Anyone who relied on F5 to debug without Docker loses that option.

**Behind Show more**

_(empty)_

### v9r-attach-single-essens-claude-4 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "The launch configuration switches from launch to attach". Visible 829 characters, behind 360.

**Before Show more**

> VS Code no longer starts the service itself; it connects to a debugger that is already running.
> 
> With `"request": "launch"`, VS Code started `service/main.py` locally under debugpy, in the integrated terminal. With `"request": "attach"`, VS Code starts no process at all. It only connects to a debugpy server at `localhost:5678`.
> 
> Something else must therefore start the service with debugpy listening first. That is the job of `preLaunchTask`, which names a task by its label. The next steps follow that task.
> 
> This is the only configuration in the file, so **the local way to run and debug the service is removed**, not kept as an alternative.
> 
> Why it matters: Debugging from VS Code now needs Docker. The service's output also goes to the container log (`docker compose logs service`) instead of VS Code's integrated terminal.

**Behind Show more**

> The old configuration ran `service/main.py` as a script, while `main.py` imports `service.server` as a package. Run that way, Python puts `service/` on `sys.path`, not the workspace root. So the old setup worked only if the root was on the path some other way. The new setup avoids this question by running `-m service.main` from `/app` (see the Compose step).

### v9r-attach-single-essens-claude-5 · essens · claude/opus · reported claude-opus-5-5

Step W1.1 "The launch configuration now attaches, after a task". Visible 621 characters, behind 0.

**Before Show more**

> F5 picks an attach configuration that first runs the task "Start the service container".
> 
> The only configuration has changed from `launch` to `attach`. VS Code no longer starts any Python process itself. It expects a debugpy server that is already listening, and `connect` in a later step says where.
> 
> Before attaching, VS Code runs `preLaunchTask`. This task is what brings that server up. The name has to match a task `label` exactly, which is the link to the next step.
> 
> Why it matters: If the task fails, for example because Docker is not running, VS Code reports the task error instead of starting the debug session.

**Behind Show more**

_(empty)_

## 2. Locked plan: the loop writer and the profile switch, W1.1 and W1.6

The plan is the Copilot loop planner's answer at version 9 (`locked/plan.json`), fixed for every run. Writer: the loop writer's prompt for the step in the profile. Switch: the step explanation channel's prompt for the profile as an alternative after that run's own Standard.

### present-essens-W1.1

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 316 characters, behind 116.

**Before Show more**

> `request: "attach"` changes VS Code’s role: unlike the base configuration, which asked it to launch `service/main.py`, this one attaches to a Python process started elsewhere. The `preLaunchTask` selects the task that starts the container (W1.2); a later step shows how VS Code connects to the debug listener (W1.6).

**Behind Show more**

> Starting the task first does not itself guarantee that the debug listener is ready when VS Code attempts the attach.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 342 characters, behind 266.

**Before Show more**

> Here, `request: "attach"` changes the configuration from launching `service/main.py` locally to attaching the debugger to a process started separately. VS Code runs the `Start the service container` pre-launch task before attempting that attach; the next step shows the task. The later connection settings specify where the debugger connects.

**Behind Show more**

> The pre-launch task starts Compose in detached mode, but this configuration does not itself wait for the debug listener to be ready; it requests the attach after the task completes. The base configuration used `"request": "launch"` and named a local program instead.

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1163 characters, behind 792.

**Before Show more**

> This is the debug configuration you pick in VS Code's Run and Debug view, and the walk starts here. It still uses the Python debugger (`"type": "debugpy"`), but `"request"` is now `"attach"` instead of `"launch"`. **VS Code no longer starts the service. It connects to a debugpy session that something else must already have started.**
> 
> That is the main change from the base revision. There, "Run the service" was a `launch` request with `program` set to `service/main.py`, so VS Code ran the file on the host and debugged it directly. In the target revision there is no `program` entry. The service process has to come from somewhere else, and the rest of the walk shows that it runs inside a container.
> 
> The trigger for that container is the `preLaunchTask` value just below these lines: `"Start the service container"`. VS Code finds the task with that label in the workspace's tasks file and runs it before it tries to attach. The next step covers that task (W1.2). The remaining settings, `connect` and `pathMappings`, decide where the debugger connects and how file paths match up. They come back in W1.6, after the walk has shown what listens on that port.

**Behind Show more**

> There are two practical effects for a reviewer:
> 
> - **The only way to debug the service is now inside the container.** The target revision has just this one configuration, and the base revision's `launch` entry was replaced rather than kept next to it. Running and debugging the service directly on the host is no longer offered.
> - **The pre-launch task finishing does not prove the service is ready.** The task runs `docker compose up -d --build service`. The `-d` flag returns once the container has started, and the task defines no readiness check. Whether debugpy is already listening when VS Code tries to connect depends on how fast the container starts. I haven't verified whether this causes problems in practice; W1.5 and W1.6 show what starts the listener and where VS Code connects.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 825 characters, behind 994.

**Before Show more**

> This is where the debug session begins, and the change turns it around. On the base revision, this entry was "Run the service" with `"request": "launch"` and a `program` pointing at `service/main.py`. VS Code started the service itself, as a Python process on the host. On the target revision, `"request": "attach"` means VS Code starts no Python process at all. It only connects to a debugpy listener that something else must already have running.
> 
> So the configuration now depends on outside setup. That setup is the `preLaunchTask`, "Start the service container", on the line just after this excerpt. VS Code finds the task by its exact label, and the next step [W1.2] follows that label to the Compose command. Where VS Code connects, and how files on the host map to files in the container, comes in a later step [W1.6].

**Behind Show more**

> The base revision had no `tasks.json`, Compose file or Dockerfile. The whole container path is new in this change, so attach mode only works together with the files the next steps show. The configuration was also renamed from "Run the service" to "Attach to the service in the container". Anyone who selected it by its old name has to pick it again.
> 
> One thing to keep in mind as you follow the walk (my reading, not checked by running it): `attach` only succeeds if the listener is already accepting connections when VS Code tries. The task runs `docker compose up -d --build service`, and `-d` returns once the container has started, not once debugpy inside it is listening. Whether that gap matters depends on how long debugpy takes to start, and the configuration doesn't wait for it explicitly. The container also starts debugpy without `--wait-for-client` (compose.yaml line 4, target). So the service doesn't wait for the debugger: code that runs before VS Code attaches runs without it.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 940 characters, behind 724.

**Before Show more**

> This is the one debug configuration VS Code offers in this change, and here it switches from running the service to **attaching** to it. With `request: "attach"`, the `debugpy` debugger starts no Python process of its own. It connects to a debugpy listener that something else must already have started. Who starts the service, and where, is now decided outside this file.
> 
> In the base revision this was a `"launch"` configuration named "Run the service". VS Code ran `service/main.py` directly on the host, so the debugger owned that process from its first line. In the target, the process belongs to a container. The debugger only joins it, and only if a listener is reachable when the session starts.
> 
> What starts that process is the `preLaunchTask` named right after these lines: `"Start the service container"`. VS Code runs it before attaching. The next step [W1.2] shows that this label matches a shell task that runs Docker Compose.

**Behind Show more**

> Joining instead of owning has two effects that matter for review:
> 
> - **Early code can run before you attach.** Compose starts debugpy without `--wait-for-client`, so the service doesn't wait for a debugger before it starts. Breakpoints in startup code may already have been passed when VS Code connects. [W1.5] covers the container command.
> - **The process outlives the debug session.** The pre-launch task runs `docker compose up -d`, which starts the container in the background and returns. Nothing here stops it when the session ends.
> 
> The address the debugger connects to (`connect`) and how container paths map to workspace files (`pathMappings`) come back in [W1.6], once the walk has shown what listens on that port.

#### after-claude-3 · version 10 · claude/opus · reported claude-opus-5-5

Visible 1179 characters, behind 779.

**Before Show more**

> The debug session starts here, and this is the central change of the commit. On the base revision, this configuration was **"Run the service"** with `request: "launch"`. VS Code ran the service locally from its `program` entry, `service/main.py`. On the target revision, the configuration has a new name and uses `request: "attach"`, so VS Code no longer starts any Python process. It connects to a debugpy listener that something else has already started. That is why the `program` and `console` entries are gone.
> 
> That "something else" is the container. Just below these lines, `preLaunchTask: "Start the service container"` tells VS Code to run a task before it attaches. VS Code finds that task by its exact label, and in the next step we follow the label to the task ([W1.2]). The connection settings (`connect` to `localhost:5678` and `pathMappings`) are covered in W1.6.
> 
> The main consequence for the review: the program being debugged now runs inside Docker, not on the developer's machine. Whether a breakpoint works depends on three things: the container starting, debugpy listening on the published port, and the path mapping matching where the code sits in the image.

**Behind Show more**

> The configuration also adds `justMyCode: false`, which the base revision did not have. With this setting, the debugger can step into library code as well as the service's own code.
> 
> `request: "attach"` sets no timing contract. The task runs `docker compose up -d --build service`, and `-d` means the command returns once the container has been started, not once debugpy is listening. The container command in `compose.yaml` runs `debugpy --listen` without `--wait-for-client`. Two things follow from that:
> - Attaching might race with debugpy's startup.
> - The service runs its startup code without waiting for the debugger, so breakpoints in startup code can be missed.
> 
> This is my reading of the configuration; I have not seen it fail. Later steps (W1.5, W1.6) show those pieces.

### present-essens-W1.6

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 528 characters, behind 269.

**Before Show more**

> After the earlier pre-launch task starts the Compose service (W1.2), this configuration connects VS Code to the container’s debug listener at `localhost:5678`; it attaches rather than launching `service/main.py` locally. Its path mapping lets the debugger relate container files under `/app/service` to the workspace’s `service` directory. This is the change from the base configuration, which used launch mode with a local program. The container command and published port that make the connection possible are covered in W1.5.

**Behind Show more**

> The mapping tells the debugger how to match source paths; it does not itself copy or mount files. Also, the pre-launch task starts Compose, but this configuration does not specify a separate check that `debugpy` is ready to accept the connection when the task finishes.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 451 characters, behind 0.

**Before Show more**

> This configuration attaches VS Code to the container’s debug listener at `localhost:5678` and maps the workspace’s `service` directory to `/app/service` in the container, so the debugger can match the container’s source paths to local files. The attach request itself doesn’t launch Python: its pre-launch task starts the container, whose command starts `debugpy` and `service.main` (W1.2, W1.5). In the next step, `service.main` calls `serve` (W1.7).

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1595 characters, behind 979.

**Before Show more**

> This is the point where the editor reaches the running process. The pre-launch task (W1.2) has started the container, and debugpy is already listening inside it (W1.5). VS Code now **connects to it as a client**. Here it starts nothing itself. In the base revision, this configuration was `"request": "launch"` with a local `program`, so VS Code ran `service/main.py` on the host. In the target revision, the program runs in the container and the editor only attaches to it.
> 
> Two settings decide whether the attach works:
> 
> - **`connect` → `localhost:5678`.** This address means the host machine, not the container. It reaches debugpy only because Compose publishes `5678:5678` and debugpy listens on `0.0.0.0` (W1.3, W1.5). If either of those changes, nothing is listening at this address.
> - **`pathMappings`.** debugpy reports file paths as the container sees them, under `/app/service`, which is where the Dockerfile's `COPY` put the source (W1.4). The mapping translates those paths to `${workspaceFolder}/service`, in both directions. This makes breakpoints set in the editor bind to the files that actually run. `remoteRoot` must stay in step with the Dockerfile's `COPY` destination. If they drift apart, breakpoints silently stop binding.
> 
> **Nothing makes the attach wait for the listener.** The task's `docker compose up -d` returns once the container is started, not once debugpy is listening, and no readiness check is defined. Also, debugpy is not run with `--wait-for-client`, so `service.main` runs straight away (W1.7). Startup code may already have run before the editor attaches.

**Behind Show more**

> What follows from those two timing points:
> 
> - **First connection attempt.** Whether VS Code's first attempt arrives before debugpy is listening depends on timing. Whether the debugpy extension retries cannot be told from this repository. If it does not retry, the first attach may fail and simply rerunning the configuration may work.
> - **Early breakpoints.** A breakpoint in `main()` or at the start of `serve` (W1.7, W1.8) is likely to be passed before the editor connects. Code that handles each request runs after the attach, so breakpoints there are reliable. Adding `--wait-for-client` to the command in `compose.yaml` would make the service wait for the editor before running anything.
> 
> `justMyCode: false` (line 13, just outside this excerpt) lets the debugger step into library code too, for example the standard library's server code under `serve`. Those files have no local mapping, so they open as files fetched from the remote process rather than as workspace files.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 1616 characters, behind 1226.

**Before Show more**

> Here VS Code acts as the **client** of the debug connection. As we saw in W1.5, the container starts debugpy listening on `0.0.0.0:5678`, and Compose publishes that port to the host. Once the `preLaunchTask` from W1.2 has started the container, this configuration connects to `localhost:5678` and joins the Python process that is already running. The service never connects out to the editor.
> 
> Two things decide whether this works:
> 
> - **The port number is the only link between the two sides.** `connect.port` here, the `"5678:5678"` mapping and the `--listen` address in the Compose `command` all have to agree. Nothing checks this, so if you change one, you have to change the others by hand.
> - **`pathMappings` translates file paths in both directions.** The container runs the copy that the Dockerfile placed under `/app/service` (W1.4). The editor shows the same files under `${workspaceFolder}/service`. Without the mapping, breakpoints set in the editor would not bind to the running code, and stack frames would point to files the editor can't open. The mapping is only correct while the container's copy matches the workspace. The task's `--build` rebuilds the image from the workspace each time the debugger starts, but edits made after that are not in the container until the next start.
> 
> `justMyCode: false` allows stepping into and stopping in library code, such as the standard-library HTTP server that W1.8 reaches, not just the project's own files.
> 
> Compared with base, this replaces a local launch (`"request": "launch"` of `service/main.py` on the host) with attaching to the containerized process.

**Behind Show more**

> **What attaching means for timing.** The Compose `command` starts debugpy without `--wait-for-client`. The service therefore goes straight into `main()` and `serve(port=8080)` (W1.7, W1.8) whether or not VS Code has connected. This follows from the code, but I haven't observed it running:
> 
> - Breakpoints in startup code that runs before the attach completes will probably be missed. Breakpoints in request-handling code are hit, because requests arrive after the debugger has connected.
> - `docker compose up -d` returns once the container has started. That is not necessarily when debugpy is accepting connections. The task does nothing to wait for the listener, so the first connect attempt can fail if it arrives too early. VS Code's retry behaviour isn't defined in this repository.
> 
> **Exposure.** debugpy listens on `0.0.0.0` inside the container, and Compose publishes `5678` without a host IP. With Docker's usual defaults, that makes the debug port reachable on all of the host's network interfaces, not just from `localhost`. The `localhost` in `connect.host` only controls where VS Code connects; it doesn't limit who else can connect. Binding the port as `"127.0.0.1:5678:5678"` would limit it to the local machine.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1438 characters, behind 1157.

**Before Show more**

> Here VS Code is the **client**. Once the pre-launch task returns, the debugger connects to `localhost:5678`. Compose's `"5678:5678"` mapping forwards that port into the container ([W1.3]), where `debugpy --listen 0.0.0.0:5678` accepts it ([W1.5]). The listener binds to `0.0.0.0` so that forwarded traffic can reach it. Without that, it would only accept connections from inside the container.
> 
> **`pathMappings` is what makes breakpoints work.** The container runs the code from `/app/service`, because the Dockerfile's `COPY` put it there ([W1.4]). In the workspace the same files are under `${workspaceFolder}/service`. The mapping converts between the two: breakpoints you set in the editor go to container paths, and stack frames come back as workspace paths. If `remoteRoot` drifted from the `COPY` destination, the debugger would still attach, but breakpoints would never bind. Nothing in the repository checks that the two stay in sync.
> 
> **One consequence for the main picture:** the container command has no `--wait-for-client`. So the service starts running as soon as the container starts, whether or not VS Code has attached. This means:
> - Breakpoints in request handling ([W1.8]) work, because requests arrive after the attach.
> - Breakpoints in startup code ([W1.7]) may already have run before the debugger connects.
> 
> `justMyCode: false` lets the debugger step into library code too, such as the standard-library HTTP server.

**Behind Show more**

> **Compared with the base revision:** the base had a single `"request": "launch"` configuration. It ran `${workspaceFolder}/service/main.py` directly on the host in the integrated terminal, so it needed no port, task or path mapping. This change replaces it completely: the repository no longer has a configuration for running the service locally without Docker.
> 
> **A possible timing gap (my reading, not verified):** the pre-launch task runs `docker compose up -d --build service`. `up -d` returns once the container has started, not once debugpy is listening on 5678. Whether VS Code's first connection attempt can arrive too early depends on how the debugpy extension retries, and the repository doesn't settle that. If it did fail, starting the configuration again would succeed because the container is already up.
> 
> **Other notes:**
> - The mapping covers only the `service` folder. That's enough, because `COPY` brings in nothing else and the module is started as `service.main` from `WORKDIR /app`.
> - Library frames (from `justMyCode: false`) are container paths with no mapping. VS Code can show them only as read-only source fetched from the debugger.

### present-pedagog-W1.1

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 487 characters, behind 238.

**Before Show more**

> `type: "debugpy"` selects VS Code’s Python debugger, and `request: "attach"` tells it to connect to a Python process that is already running with debug support—not to launch `service/main.py` itself. That differs from the base revision, where the request was `"launch"` and named the program for VS Code to start. Here, `preLaunchTask` names the task that runs first; the next step follows it, and a later step shows the container starting `debugpy` with the service module (W1.2, W1.5).

**Behind Show more**

> The task runs Compose in detached mode, but has no explicit readiness check. So its completion orders the attach attempt after the startup command; it does not by itself establish that the debug listener is ready to accept the connection.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 727 characters, behind 0.

**Before Show more**

> Here, `"request": "attach"` tells VS Code’s `debugpy` extension to connect to an already-running Python process, rather than start the program itself. The target needs to be listening for a debugger connection; the `preLaunchTask` asks VS Code to start the container first, and a later step shows how Compose starts that listener. The task runs before the attach request, but this setting alone does not guarantee that the listener is ready when VS Code connects.
> 
> That is a change from the base revision, where `"request": "launch"` and `"program"` told VS Code to start `service/main.py` itself. The target instead uses the connection details and path mapping later in this configuration to attach to the container’s process.

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1780 characters, behind 1583.

**Before Show more**

> This configuration is what you pick in VS Code's Run and Debug view, and the walk starts here. Two fields decide how debugging works:
> 
> - **`type: "debugpy"`** tells VS Code to use the Python debugger. debugpy is a Python package. It runs inside a Python process and accepts connections from a debugger client such as VS Code. The value is the same in both revisions.
> - **`request`** is what changed. VS Code debug configurations come in two kinds:
>   - **`"launch"`**: VS Code starts the program itself, with the debugger already inside it.
>   - **`"attach"`**: VS Code starts nothing. It connects to a process that is already running and already has a debugger waiting for a connection.
> 
> In the base revision, the configuration "Run the service" used `"launch"` with `program` set to `service/main.py`. VS Code ran that file with the host's Python interpreter. In the target revision the request is `"attach"` and there is no `program` field. **This configuration no longer starts the service at all.** Something else has to start a Python process with debugpy running inside it, and that is the container.
> 
> A comparison: `launch` is like starting a program from your own terminal. `attach` is like dialling into a program someone else has started, so you need its address, and it has to be answering the line.
> 
> The configuration also includes the steps that make attaching possible. The `preLaunchTask` value, `"Start the service container"`, is the label of a task that VS Code looks up and runs before it attaches. That task is the next step [W1.2]. The address VS Code dials is in `connect` (`localhost:5678`), and `pathMappings` tells it how file paths inside the container map to your local files. Both come back in [W1.6], after the walk has shown what listens on that port.

**Behind Show more**

> **What "attach" leaves to other parts.** With `launch`, VS Code owns the whole lifecycle: it starts the process, so the debugger is present from the first line, and stopping the debug session ends the program. With `attach`, VS Code owns only the connection. Three consequences follow from this configuration and the files it relies on:
> 
> - **Starting the process is done by the task.** The task runs `docker compose up -d --build service`. The `-d` flag means detached: the command returns as soon as the container has started. VS Code then moves on and attaches.
> - **Timing.** In `compose.yaml` (target), the container runs `python -m debugpy --listen 0.0.0.0:5678 -m service.main` without `--wait-for-client`. debugpy only uses that flag when it is given, so here the service starts running at once and does not wait for VS Code. Breakpoints in code that runs during startup may be hit before the debugger is attached. Also, nothing in the task waits for port 5678 to be listening. Whether the connection always succeeds on the first try depends on timing that these files do not control. Treat both points as observations to keep in mind, not as verified failures.
> - **Stopping.** Ending an attach session normally disconnects the debugger and leaves the process running. The containers are started with `-d`, and none of these files stops them, so they keep running after you stop debugging.
> 
> **`justMyCode: false`** is a new setting in the target revision. With it, the debugger also steps into library code instead of skipping it. It does not affect how the connection is made.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 1985 characters, behind 1556.

**Before Show more**

> This is where the debug session starts. A VS Code launch configuration is a named recipe in `launch.json`. When you pick it in the Run and Debug view, VS Code passes the recipe to the debugger extension named by `type`. Here that is `debugpy`, the Python debugger extension.
> 
> **Two ways to start debugging.** The `request` field tells the debugger what its job is:
> 
> - **`launch`**: the debugger starts the program itself, so the program runs inside the debugger from the first line. The base revision used this. `"request": "launch"` pointed `program` at `${workspaceFolder}/service/main.py` and ran it in the integrated terminal, so the service ran directly on your machine.
> - **`attach`**: the debugger starts nothing. It connects to a program that is already running and has opened a debug listener. The target revision uses this, and renames the configuration from "Run the service" to "Attach to the service in the container".
> 
> A comparison: `launch` is like starting a car yourself with a passenger watching. `attach` is like climbing into a car that is already running. Someone else must have started it, and the door must be open.
> 
> **Why this matters for the change.** With `attach`, VS Code no longer controls how the service starts, so two things now live elsewhere:
> 
> 1. **Who starts the program.** The line after this excerpt, `preLaunchTask: "Start the service container"`, names a task that VS Code runs before the session begins. It finds the task by matching that label exactly to the `label` in `tasks.json`. The next step [W1.2] follows that task.
> 2. **What it connects to.** The `connect` and `pathMappings` settings say which listener to connect to and how file paths in the container match your files. These lines follow right after the excerpt; [W1.6] covers them.
> 
> So the line `"request": "attach"` is what makes the rest of the walk necessary. The container has to start the service with a debugpy listener, because the debugger no longer starts anything itself.

**Behind Show more**

> **What `attach` changes about when the program starts.** With `launch`, the debugger owns the process from the beginning, so breakpoints on startup code are hit reliably. With `attach`, the service starts before VS Code connects. The `command` in `compose.yaml` (target, line 4) starts the listener with `--listen 0.0.0.0:5678`. It does not pass debugpy's `--wait-for-client` option, so `service.main` can start running before the debugger connects. That means breakpoints in code that runs only once at startup may be missed. Code that runs for each request, after the connection is made, is not affected. [W1.5] covers this command.
> 
> **A possible timing gap (an observation, not something that has been run).** The pre-launch task runs `docker compose up -d --build service`. The `-d` flag runs the container in the background. As far as these files show, `docker compose up -d` returns once the container has started, not once debugpy is listening on port 5678. When the task finishes, VS Code connects right away. If the listener isn't up yet, the first connection attempt may fail. Nothing in `tasks.json` waits for the port, for example with a `problemMatcher` or a background-task pattern.
> 
> **Other things dropped with `launch`.** `console: "integratedTerminal"` meant something only when VS Code started the process. With `attach`, the service's output goes to the container's logs (`docker compose logs`), not to a VS Code terminal. The target revision also adds `justMyCode: false`, which lets you step into library code, not only your own files.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1920 characters, behind 1218.

**Before Show more**

> A debug configuration in `launch.json` tells VS Code's debugger how to get hold of a program. The `request` field picks one of two ways:
> 
> - **`"launch"`**: the debugger starts the program itself and owns that process. That is how the base revision worked. The configuration was named "Run the service" and pointed `program` at `service/main.py`, which ran on the host in the integrated terminal.
> - **`"attach"`**: the debugger starts nothing. It connects to a program that is already running and has already opened a debug port. This is the mode used here, and the new `name` says so.
> 
> `type: "debugpy"` stays the same in both revisions. It picks the Python debugger extension, which speaks debugpy's protocol. In launch mode the extension starts debugpy and your program together. In attach mode it only acts as a client: it needs a debugpy server listening somewhere, and it fails if nothing answers.
> 
> So the important change here is a change of responsibility. VS Code no longer creates the process it debugs, so the configuration has to say two things:
> 
> 1. **Who starts the program.** `preLaunchTask: "Start the service container"`, just below this step's lines, names a task that VS Code runs before it attaches. The name is a plain string that must exactly match a task's `label`. The next step [W1.2] follows it to the Docker Compose command.
> 2. **Where to connect, and how to match files.** `connect` (localhost, port 5678) and `pathMappings` hold this. The service runs inside a container, so the debugger reports file paths under `/app/service`, and these have to be translated to your workspace files. [W1.6] comes back to both once the walk has shown what is listening on that port.
> 
> Compare it to a phone call. In launch mode you start the program yourself. In attach mode you dial a number and someone must already be waiting to pick up. The rest of this walk is about how that listener gets there in time.

**Behind Show more**

> **What attach mode does not guarantee.** VS Code waits for `preLaunchTask` to finish before it attaches. Here the task runs `docker compose up -d --build service`, and `-d` means the command returns once the container has started. It does not wait for the process inside to be ready. The container's command is `python -m debugpy --listen 0.0.0.0:5678 -m service.main` (shown in [W1.5]). Two things follow from the code. This is my reading of it, not observed behaviour:
> 
> - Nothing makes VS Code wait until debugpy is actually listening on port 5678. The attach can arrive while the Python process is still starting. Whether that happens depends on timing.
> - The command has no `--wait-for-client`, so debugpy does not pause the service until a debugger connects. `service.main` starts running right away. Breakpoints in startup code can run before VS Code attaches. In the base revision this could not happen, because launch mode started the program under the debugger.
> 
> **One more change in this configuration.** It sets `"justMyCode": false` (line 13), which the base configuration did not have. With this setting the debugger also steps into library code and stops at breakpoints there, not only in your own files.

#### after-claude-3 · version 10 · claude/opus · reported claude-opus-5-5

Visible 1843 characters, behind 1325.

**Before Show more**

> This step is where a debug session starts. In VS Code's Run and Debug view the user picks the entry whose `name` is **"Attach to the service in the container"**. `type: "debugpy"` tells VS Code to use the Python debugger extension (debugpy) for this session.
> 
> **What changed here.** In the base revision, the only entry in this file was a different configuration:
> 
> - It was called "Run the service" and used `request: "launch"`.
> - It pointed `program` at `${workspaceFolder}/service/main.py`.
> - It used `console: "integratedTerminal"`.
> 
> With `"launch"`, VS Code starts the Python process itself on your machine, with the debugger already inside it. This change replaces that entry. The only configuration now uses `request: "attach"`.
> 
> **What "attach" means.** A debugger can come into play in two ways:
> 
> - **Launch:** the debugger starts the program. It's like clicking Run in an IDE.
> - **Attach:** the program is already running somewhere, with a small debug server (a "listener") on a network port. The debugger only connects to that listener.
> 
> This is why the target configuration has no `program` field. VS Code doesn't start any Python here. It expects that something else has already started the service, with debugpy listening. In this repository that "somewhere else" is a Docker container. As a comparison: launch is starting a phone call yourself, and attach is dialling into a conference call someone else has already opened.
> 
> **Who starts the process.** Right after this step's lines comes `preLaunchTask: "Start the service container"`. VS Code runs that task before it tries to connect. It finds the task by its exact label among the workspace tasks, and the target's tasks file defines a task with that same label. The next step [W1.2] follows that label. The connection target (`connect`, `pathMappings`) is covered in [W1.6].

**Behind Show more**

> **Things the switch to attach implies.** These are observations from reading the target files, not behaviour anyone has watched run:
> 
> - **The program doesn't wait for the debugger.** The container's command (shown in [W1.5]) starts debugpy with `--listen 0.0.0.0:5678` but without `--wait-for-client`. So the service starts running at once, whether or not VS Code has connected yet. Breakpoints in code that runs early (module import, server setup in [W1.7]/[W1.8]) may already have been passed by the time the debugger attaches. Code that runs on each request will still hit breakpoints.
> - **The task finishing doesn't mean the listener is ready.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once the container has started, not once debugpy is listening on port 5678. Whether VS Code's first connection attempt can arrive too early depends on timing and on how the debugpy extension handles a refused connection. The repository's code doesn't settle that.
> - **The base's `console: "integratedTerminal"` is gone.** It only makes sense for launch, where VS Code owns the process's input and output. With attach, the service's output goes to the container's logs instead. The task starts the container with `-d` (detached), so that output won't appear in VS Code's terminal.

### present-pedagog-W1.6

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 871 characters, behind 307.

**Before Show more**

> Here, `request: "attach"` means VS Code connects to a Python process that is started separately; unlike the base revision’s `launch` configuration, this configuration does not start the Python program itself. The pre-launch task runs Compose before VS Code attempts the connection (W1.2). Compose starts `debugpy` with a listener on port 5678 and the service module (W1.5); the published port lets VS Code reach that listener at `localhost:5678` (W1.3).
> 
> The debugger also needs to relate paths inside the container to files in your workspace. This mapping pairs `/app/service` with `${workspaceFolder}/service`, so a container source path such as `/app/service/main.py` corresponds to the local `service/main.py`. It tells the debugger how to find and associate source files; it does not copy or synchronize them. In the next step, `main` enters the service code (W1.7).

**Behind Show more**

> The task starts Compose, but the configuration does not explicitly make it wait for `debugpy` to be ready before attempting to attach. The listener must be reachable for the connection to succeed; the port mapping and path mapping address reachability and source correspondence, respectively, not readiness.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 852 characters, behind 0.

**Before Show more**

> The configuration connects VS Code to the debug listener on `localhost:5678`; it does not launch Python through the attach request. The pre-launch task starts the container, whose command runs `debugpy` and the service module, and Compose publishes the listener’s port to the host. The connection therefore depends on that listener being available. Compared with the base configuration, which launches `service/main.py` locally, this target configuration attaches to the containerized process instead. (W1.2, W1.5)
> 
> A debugger also needs to match source paths reported by the container to files in the workspace. Here, a remote path such as `/app/service/main.py` maps to `${workspaceFolder}/service/main.py`, allowing VS Code to locate the corresponding local source for debugging. In the next step, `service.main` is followed into the service. (W1.7)

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 3303 characters, behind 2066.

**Before Show more**

> Here VS Code attaches its debugger to a service that the earlier steps have already started inside a container. The configuration has to do two things: reach the debugger across the container boundary, and translate file paths between the container and your workspace.
> 
> **Launch versus attach.** In the base revision this configuration used `"request": "launch"` with a `program`. That means VS Code started `service/main.py` itself, on your machine, with the debugger built in. In the target revision it uses `"request": "attach"`. Now VS Code starts nothing. Something else has already started the program with a debugger inside it, and VS Code only connects to it. That "something else" is the compose `command` from W1.5: `python -m debugpy --listen 0.0.0.0:5678 -m service.main`. debugpy is the Python debugger. With `--listen` it opens a network port and waits, like a small server. VS Code is the **client** that dials in. The connection always goes from the editor to the container, never the other way.
> 
> **What the startup order looks like.** When you press F5, VS Code first runs the task named in `preLaunchTask` (W1.2). VS Code runs a `preLaunchTask` for both launch and attach configurations; it is not tied to attach. That task is `docker compose up -d --build service`. It has no `isBackground` setting, so VS Code waits for the command to exit. Then it opens the connection described in `connect`.
> 
> **Why `localhost:5678` reaches the container.** VS Code runs on the host, so `localhost` here means your machine, not the container. The address works only because two settings from earlier steps line up:
> 
> - Compose publishes `"5678:5678"`. A connection to port 5678 on the host is forwarded to port 5678 inside the container (W1.3).
> - debugpy listens on `0.0.0.0`, which means every network interface in the container. If it listened on `127.0.0.1`, it would accept only connections made from inside the container, and forwarded traffic from the host would not reach it (W1.5).
> 
> If either of these changes, this address no longer reaches debugpy.
> 
> **Why `pathMappings` is needed.** The debugger and the editor name the same file differently. The Dockerfile copies the source to `/app/service` (W1.4), so inside the container debugpy sees `/app/service/server.py`. You have the same file open as `<workspace>/service/server.py`. The mapping replaces one prefix with the other, in both directions:
> 
> - You set a breakpoint on `server.py` line 7 in the editor. VS Code sends it to debugpy as `/app/service/server.py:7`.
> - debugpy stops there and reports `/app/service/server.py`. VS Code opens your local `service/server.py`.
> 
> `remoteRoot` has to match the `COPY` destination in the Dockerfile. If they differ, breakpoints you set in the editor don't match any file that runs.
> 
> **What this code does not guarantee.** Nothing makes the attach wait until debugpy is actually listening. `docker compose up -d` returns once the container has started, not once the listener is ready, and the task has no readiness check. And debugpy is started without `--wait-for-client`, so `service.main` runs at once, whether or not an editor is attached. Code that runs at startup, like `main()` calling `serve` (W1.7) and the server binding its port (W1.8), can be past a breakpoint before VS Code connects.

**Behind Show more**

> **Why the timing matters less for request handling.** The setup code in `serve` runs once, at startup, so it is the code most likely to be missed. After that, `httpd.serve_forever()` keeps the process alive and handles each request as it arrives. A breakpoint on code that runs per request can still be hit after a late attach, as long as the request comes in after VS Code has connected.
> 
> **What the client side can't tell you.** If the first connection attempt arrives before debugpy is listening, the outcome depends on how the VS Code Python debugger extension handles a refused connection. That code isn't in this repository, so whether it retries or fails can't be settled here. Two common ways to make the startup deterministic, neither of which this change uses:
> 
> - Add `--wait-for-client` to the debugpy command. The program then pauses until an editor attaches. The cost is that the service stays stopped when nobody attaches.
> - Make the task wait until the port is ready, for example with a health check plus `docker compose up --wait`, or a background task with a problem matcher that watches for a "ready" message.
> 
> **`justMyCode: false` (line 13) and paths outside the mapping.** With this setting the debugger also steps into library code, not only your own. That matters here, because the request handler is the standard library's `SimpleHTTPRequestHandler` (`service/server.py` line 5). Those library files live under the container's Python install, which no `pathMappings` entry covers. How VS Code shows such unmapped files depends on the extension, not on anything in this repository.
> 
> **Why `/app` is the right base.** The Dockerfile sets `WORKDIR /app`, and the service runs as the module `service.main`. With `-m`, Python puts the working directory on its import path, so `/app/service` is imported as the package `service`. That is also why `main.py` can write `from service.server import serve`. So the container path `/app/service` really is the folder debugpy reports, and the mapping's `remoteRoot` points at the files actually being run.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 2421 characters, behind 2223.

**Before Show more**

> VS Code is the **client** here. Earlier steps started the server side: debugpy is listening inside the container (W1.5), and Compose forwards port 5678 from the host to it (W1.3). This configuration tells VS Code where to dial and how to translate file paths once the connection is up.
> 
> **Attach versus launch.** A debugger can be set up in two ways:
> 
> - In *launch* mode, the editor starts the Python process itself, with the debugger built in.
> - In *attach* mode, some other mechanism starts the process, and the editor connects to a debugger that is already running inside it.
> 
> The base revision used launch mode. Its "Run the service" configuration ran `service/main.py` directly on the host. Here, `"request": "attach"` is needed because Docker owns the process. VS Code cannot start a program inside the container. It can only reach a port.
> 
> **The connection.** `connect` names the address VS Code dials: `localhost:5678`. Nothing in this file proves that something is listening there. The link to the server side exists only because the same number appears in three places:
> 
> - `--listen 0.0.0.0:5678` in the Compose `command`
> - the `"5678:5678"` port mapping in Compose
> - `connect.port` here
> 
> If you change one, you have to change the others by hand. Nothing checks that they agree.
> 
> **Path mappings.** Once connected, the editor and debugpy talk about code as *file path + line number*. They don't agree on paths, though. The Dockerfile copied the sources to `/app/service` (W1.4), and the workspace has them under `${workspaceFolder}/service`. `pathMappings` rewrites the prefix in both directions. For example:
> 
> - You set a breakpoint on line 7 of `<workspace>/service/server.py`. VS Code sends debugpy `/app/service/server.py`, line 7.
> - The process stops in `/app/service/main.py`, line 5. VS Code opens `<workspace>/service/main.py` at line 5.
> 
> The translation only rewrites file names. It doesn't check that the two copies have the same content. If you edit `server.py` after the container was built, line 7 locally may no longer be line 7 in the container. The pre-launch task's `docker compose up -d --build` rebuilds the image from the current workspace on each start, which keeps the copies in sync at start time only.
> 
> **`justMyCode: false`** lets the debugger stop in, and step into, code outside the project. An example is the standard-library `http.server` that the service hands requests to in W1.8.

**Behind Show more**

> **What `preLaunchTask` waits for.** As far as these files show, the task is a plain shell command, `docker compose up -d --build service`. With `-d`, Compose returns once the container has been started, not once debugpy inside it has bound port 5678. Nothing in `tasks.json` or `launch.json` waits for the listener to be ready, so the code alone doesn't settle that the port is accepting connections when VS Code dials it. Whether the attach retries or fails on a slow start depends on VS Code and the debugpy extension, not on anything in this repository.
> 
> **Breakpoints in startup code.** The Compose command uses `--listen` without `--wait-for-client`. So debugpy does not hold the program until a debugger attaches. `service.main` runs straight away, calls `serve(port=8080)`, and ends up in `serve_forever()`. By the time VS Code attaches, the code in `main()` and the start of `serve()` has most likely already run. Breakpoints there will not be hit on a normal start. Breakpoints in request handling will be, because those paths run each time a request arrives. This follows from the flags as written. It is an observation, not something verified at runtime.
> 
> **Library files have no mapping.** The only mapping covers `/app/service`. The standard library in the container lives under the image's Python installation (the `python:3.12-slim` base), which has no local counterpart. When `justMyCode: false` lets execution stop in `http.server`, VS Code cannot map that frame to a workspace file. Normally the debug adapter supplies the source instead. That behaviour comes from the debugger, not from this configuration.
> 
> **Who can reach the port.** `connect.host` is `localhost`, but this setting only controls where VS Code dials. Who else can connect is decided on the Compose side. A port entry written as `"5678:5678"` with no host IP publishes on all of the host's network interfaces by default, so the debug port can also be reached from other machines that can reach this host. Anyone who connects to a debugpy listener can run code in the process. Writing the mapping as `"127.0.0.1:5678:5678"` would limit it to the local machine. This is an observation about the Compose entry, not a finding of this review.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 2179 characters, behind 1986.

**Before Show more**

> Here VS Code becomes a debugger **client**. It opens a TCP connection to a debug server that is already running inside the container. The service never reaches out to the editor. That's what `"request": "attach"` means (as we saw in [W1.1]): VS Code starts no Python process. It only connects to one that is already running.
> 
> **What `connect` reaches.** When the pre-launch task finishes, VS Code connects to `localhost:5678`. The connection passes through two pieces from earlier steps:
> 
> 1. Compose's `"5678:5678"` port mapping forwards host port 5678 into the container ([W1.3]).
> 2. Inside the container, `python -m debugpy --listen 0.0.0.0:5678` accepts the connection ([W1.5]). It binds to `0.0.0.0` (all interfaces) rather than `127.0.0.1`. Inside a container, loopback means the container's own loopback, so traffic forwarded from the host would never reach a listener bound there.
> 
> You can think of it like a remote shell: the container runs the "server" (debugpy), and VS Code is the client that connects to it.
> 
> **Why `pathMappings` is needed.** A debugger works with file paths. When you set a breakpoint, VS Code sends a path and a line number. When the program stops, debugpy sends back a stack whose frames name files. The two sides see the same source under different paths:
> 
> - On your machine: `${workspaceFolder}/service/server.py`
> - In the container: `/app/service/server.py`, because the Dockerfile sets `WORKDIR /app` and runs `COPY service /app/service` ([W1.4]). The module is then started as `-m service.main` from `/app`.
> 
> The mapping rewrites one prefix into the other in both directions. Breakpoints go out with container paths, and stack frames come back as workspace files you can open. If `remoteRoot` didn't match the `COPY` destination, the connection would still work, but breakpoints would stay unbound because debugpy would never see code at the paths it was given.
> 
> **Compared with the base revision**, this is a different model. Before, the configuration was `"request": "launch"` with `"program": "${workspaceFolder}/service/main.py"`, so VS Code started Python itself on the host. Paths were identical on both sides and no mapping was needed.

**Behind Show more**

> **What happens before the debugger is attached.** debugpy is started without `--wait-for-client` (compose.yaml line 4). The service therefore starts running as soon as the container starts, whether or not VS Code is connected. The consequences:
> 
> - Startup code (`main()` calling `serve(port=8080)`, and the server setup in [W1.7] and [W1.8]) may already have run by the time VS Code attaches. Breakpoints there can be missed.
> - Code that runs per request, inside `serve_forever()`'s handler threads, does run after attach, so breakpoints there work as expected.
> 
> Adding `--wait-for-client` would make the service block until a debugger connects. That would change how the container behaves when nobody attaches.
> 
> **Timing of the connection (an observation, not something I verified at runtime).** The pre-launch task is a plain `shell` task running `docker compose up -d --build service` (.vscode/tasks.json lines 5–7). VS Code waits for that command to exit. `-d` returns once the container has started, but that doesn't guarantee debugpy is already listening on 5678. Whether the attach succeeds on the first try then depends on that timing and on how the VS Code Python debugger handles a refused connection. These files don't settle either point.
> 
> **`justMyCode: false`** (line 13, just below this excerpt) lets the debugger stop in and step into library code, such as `http.server.ThreadingHTTPServer` and `SimpleHTTPRequestHandler` from [W1.8]. With the default (`true`), stepping would skip over them.
> 
> **Exposure of the debug port (an observation).** `"5678:5678"` without a host IP makes Docker publish the port on all host interfaces, not only on `localhost`. A debugpy server accepts any connection and lets the client evaluate arbitrary code in the process. Anyone who can reach the host on that port can therefore run code in the container. Writing the mapping as `"127.0.0.1:5678:5678"` would limit it to the local machine, and the `connect` setting here would still work.

### writer-essens-W1.1

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 314 characters, behind 0.

**Before Show more**

> This configuration asks the `debugpy` debugger to attach rather than launch a Python program. It also names **Start the service container** as the pre-launch task, handing startup to VS Code before the attach request; the next step follows that task to its Compose command (`.vscode/tasks.json`, target lines 5–7).

**Behind Show more**

_(empty)_

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 274 characters, behind 0.

**Before Show more**

> VS Code uses `request: "attach"`, so this configuration connects the debugger rather than launching the Python program. Its `preLaunchTask` selects **Start the service container**; the next step follows that task into Docker Compose (`.vscode/tasks.json`, target lines 5–7).

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 916 characters, behind 347.

**Before Show more**

> This is where the change starts. The debug configuration "Attach to the service in the container" still uses the `debugpy` debugger type, but `request` is now `"attach"` instead of `"launch"`. **VS Code no longer starts the Python program itself. It connects to a debugpy process that something else has already started.** In the earlier revision, this configuration ran `service/main.py` directly on the host, in the integrated terminal. The `program` and `console` settings were removed because an attach request does not use them.
> 
> Because VS Code no longer starts the service, something else has to. The next line, `preLaunchTask` (just below this step's lines, line 8), names the task "Start the service container". VS Code runs that task before it makes the attach request. The next step (W1.2) follows that label to the task definition. The connection details, `connect` and `pathMappings`, come back in W1.6.

**Behind Show more**

> With an attach request, VS Code only connects as a client. Starting the debuggee, and starting it with debugpy listening, is now the job of the container setup that the walk follows from W1.2 to W1.5. Here, the only link between the editor and that setup is the task label. VS Code matches it by exact string against the `label` in the tasks file.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 601 characters, behind 438.

**Before Show more**

> This is where debugging begins. **The configuration no longer runs the program itself.** Its `request` is now `attach`: VS Code expects a debugpy process to be running already and connects to it. In the earlier revision, the `request` was `launch` and VS Code started `service/main.py` locally in the integrated terminal.
> 
> Since VS Code no longer starts the service, something else has to. Just below the `request` line, `preLaunchTask` names a task, `"Start the service container"`, which VS Code runs before it tries to attach. The next step follows that label to the task that starts the container.

**Behind Show more**

> With `launch`, the debugger owns the process: it starts it, and the process ends when the session ends. With `attach`, the debugger only connects to a process that is already running, so starting it and stopping it are now handled outside this configuration. The `connect` and `pathMappings` settings in this same configuration tell VS Code where to find that process and how to match its files to the workspace. A later step covers them.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 916 characters, behind 301.

**Before Show more**

> This is where the debug session starts. The configuration changes from **launching** the Python program to **attaching** to one that is already running. Before this change, the debugger started `main.py` on the host in the integrated terminal. With `"request": "attach"`, the debugger doesn't start the service at all. It expects some other process to run it with a debugpy listener, and it only connects.
> 
> That raises the question of what starts the service. The answer is `preLaunchTask`, on the line right after the highlighted lines. It names "Start the service container", and VS Code runs that task before it attaches. This label is the link to the next step (W1.2), where the task with that name starts the container.
> 
> The remaining attach settings are `connect` (host and port) and `pathMappings`. They decide where the debugger connects and how container file paths map to workspace files. W1.6 covers them.

**Behind Show more**

> The `type` stays `debugpy` on both sides, so the change is in the request mode, not the debugger. The base settings `program` and `console` are removed because an attach request starts no process. Setting `justMyCode: false` lets the debugger step into library code as well as the service's own files.

#### after-claude-3 · version 10 · claude/opus · reported claude-opus-5-5

Visible 588 characters, behind 500.

**Before Show more**

> This is where debugging begins. The configuration, "Attach to the service in the container", still uses the `debugpy` debugger type, but `request` is now `"attach"` instead of `"launch"`. **VS Code no longer starts the Python program. It connects to a debugger that is already running somewhere else**, and in this setup that place is the container.
> 
> Since nothing in this configuration starts the service, it names a `preLaunchTask` that VS Code runs first: `"Start the service container"`. That label is the link to the next step (W1.2), where the task of that name runs Docker Compose.

**Behind Show more**

> In the earlier revision this same configuration was called "Run the service". It used `"launch"` with `program` pointing at the workspace's `service/main.py` and `console` set to `integratedTerminal`, so VS Code ran the service locally as a child process. All of that is gone now. The fields that tell VS Code where to connect (`connect` to `localhost:5678`) and how to match container paths to workspace files (`pathMappings`) are covered in W1.6, after the walk has shown what listens on that port.

### writer-essens-W1.6

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 347 characters, behind 233.

**Before Show more**

> VS Code’s attach request connects to `localhost:5678`, the host port Compose publishes for the container’s debugpy listener (as shown earlier in `compose.yaml`, target lines 4–6). Its path mapping pairs `/app/service` in the container with the workspace’s `service` directory, so the debugger can associate container source paths with local files.

**Behind Show more**

> The pre-launch task runs Compose in detached mode and defines no readiness check (`.vscode/tasks.json`, target lines 5–7). It therefore does not explicitly wait for the debugpy listener to be ready before VS Code attempts the attach.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 520 characters, behind 226.

**Before Show more**

> VS Code attaches to debugpy at `localhost:5678`, the host port published for the container’s listener (compose.yaml, target lines 4–6). This is a debugger connection, not a command to start the service; the container command starts it separately. The pre-launch task starts Compose in detached mode and configures no readiness check, so the launch configuration does not explicitly wait for the listener before attaching. Next, `service.main` leads into the application’s server call (service/main.py, target lines 4–8).

**Behind Show more**

> `pathMappings` links the container’s `/app/service` source path to `${workspaceFolder}/service`, allowing VS Code to match debugged files to the workspace. `justMyCode: false` disables debugpy’s usual restriction to user code.

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1274 characters, behind 423.

**Before Show more**

> With the container running and debugpy listening (W1.5), this is the editor's half of the handoff. The service never calls VS Code. VS Code opens a connection to `localhost:5678` itself, and that address only works because Compose maps host port 5678 to the debugpy listener inside the container.
> 
> `pathMappings` is what makes breakpoints work. Inside the container, the code runs from `/app/service`, the folder the Dockerfile copied it into (W1.4). The editor shows the same files under the workspace's `service` folder. With this mapping, a breakpoint set in the workspace matches a running frame in the container. Without it, or if either path were wrong, the debugger would attach but breakpoints would not be hit.
> 
> **Nothing makes the attach wait for the listener to be ready.** The pre-launch task (W1.2) runs `docker compose up -d --build`, which returns once the container has started. The task defines no readiness check. So the attach can fire before debugpy is listening, and whether that happens depends on timing. There is a second, separate effect: the Compose command does not pass `--wait-for-client` to debugpy, so the service starts running without waiting for a debugger. Breakpoints in code that runs before the attach completes can therefore be missed.

**Behind Show more**

> This replaces the base revision's configuration, which used `"request": "launch"` to run `service/main.py` directly on the host in the integrated terminal. In this revision the editor no longer starts the program. The container owns the process, and VS Code only connects to it.
> 
> `justMyCode: false` lets the debugger step into library code as well, such as the standard library's `http.server` that the server uses (W1.8).

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 1063 characters, behind 614.

**Before Show more**

> Once the pre-launch task returns, the walk moves from the container to the editor. Nothing in the service calls VS Code. VS Code itself acts on this attach request: it connects as a client to `localhost:5678`. That works because, as shown in W1.5, the container's debugpy listens on 5678 and Compose publishes that port to the host.
> 
> `pathMappings` makes breakpoints work. The code runs from `/app/service`, which is where the image copies the source (W1.4). The editor shows the same files under `${workspaceFolder}/service`. The mapping translates between the two locations. Without it, breakpoints set in the workspace would not match the running code. It only works while the copied files are the same as the workspace files, and a new copy is made only when the task rebuilds the image.
> 
> **Nothing makes the attach wait until the listener is up.** The task starts Compose with `-d` (detached), and VS Code has no readiness check to wait on. So the attach can be sent before debugpy is listening. Whether that happens depends on how fast the container starts.

**Behind Show more**

> In the earlier revision this configuration used `request: "launch"` and ran `service/main.py` directly on the host, with no task and no path mapping. Debugging now always goes through the container.
> 
> The container command in W1.5 has no `--wait-for-client`, so the service doesn't wait for the debugger. It starts serving right away whether or not the editor attaches. Code that runs at startup, before the attach succeeds, will not stop at breakpoints.
> 
> `justMyCode: false` lets the debugger step into library code as well, such as the standard-library HTTP server used in W1.8. It's not just the workspace files.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1384 characters, behind 718.

**Before Show more**

> Here VS Code acts as the **client**. The service does not call out to the editor. Once the pre-launch task finishes, VS Code's debugpy adapter connects to `localhost:5678`. Compose forwards that port to the debugpy listener started in the container (W1.5).
> 
> `pathMappings` matters because the code runs from a different place than the files you edit. The container runs the copy that the image placed under `/app/service` (W1.4), while you set breakpoints in the workspace's `service` folder. With this mapping, VS Code can match breakpoints and stack frames between the two. The mapping only lines up while the image holds the current source. The task passes `--build` on each start, and Compose mounts no source into the container, so edits made after startup don't reach the running container until the next start.
> 
> Two timing points decide what you can actually debug:
> 
> - **Nothing makes the attach wait for the listener.** The task runs `docker compose up -d`, which returns once the container has started, not once debugpy is listening. No readiness check exists. Whether the first attach succeeds depends on how fast the container starts.
> - **The service also doesn't wait for the debugger.** The container command uses `--listen` without `--wait-for-client`, so `service.main` starts running right away (W1.7). Breakpoints in startup code can pass before VS Code has attached.

**Behind Show more**

> In the base revision this configuration was a `launch` request that ran `service/main.py` directly on the host, in the integrated terminal. The change replaces that with this attach-to-container setup, so the program now runs only inside the container.
> 
> `justMyCode: false` lets the debugger step into code outside the workspace, such as `http.server` from the standard library, which the server in W1.8 is built on.
> 
> If the attach fails because of the timing above, running the configuration again usually works. That second run starts the task again, but `compose up` leaves an up-to-date running container alone. This is a conclusion from how Compose usually behaves, not something this repository sets up or tests.

### writer-pedagog-W1.1

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 322 characters, behind 0.

**Before Show more**

> `request: "attach"` tells VS Code to connect its debugger to a Python process that is started separately; unlike a launch request, this configuration does not start the service program itself. The `preLaunchTask` label tells VS Code to run **Start the service container** first, handing startup to the task explained next.

**Behind Show more**

_(empty)_

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 299 characters, behind 0.

**Before Show more**

> `request: "attach"` tells VS Code to connect the debugger to a service that is started separately, rather than launch the Python program itself. Before starting the debug session, VS Code runs the task named by `preLaunchTask`; the next step follows that label to the task that starts the container.

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1589 characters, behind 965.

**Before Show more**

> This configuration is what you choose in VS Code's Run and Debug view. Its `name`, "Attach to the service in the container", is the label shown in that view's dropdown. The other two settings decide how the debug session begins.
> 
> - `type: "debugpy"` sends the session to the Python Debugger extension, which talks to **debugpy**. debugpy is the Python library that does the actual debugging work: breakpoints, stepping, and inspecting variables.
> - `request: "attach"` decides who starts the Python program. VS Code supports two modes:
>   - **launch**: VS Code starts the Python process itself, with the debugger already loaded in it.
>   - **attach**: some other tool has already started a Python process that runs a debugpy listener. VS Code only connects to that listener over the network.
> 
> **In the earlier revision this configuration used `launch`.** It was named "Run the service" and pointed `program` at `service/main.py` in the workspace, so VS Code ran the file on the host. With `attach`, VS Code no longer runs the service at all. Something else has to start it, inside a container, with debugpy listening. That is why the configuration has no `program` setting any more.
> 
> The setting that arranges this startup is `preLaunchTask`, on the line just after `request`. Its value, `"Start the service container"`, is a task **label**. Before VS Code begins the debug session, it looks up the task in the workspace's task definitions whose `label` matches this text exactly, and runs it. Keep that label in mind: the next step (W1.2) shows the task it names, which starts the container.

**Behind Show more**

> A comparison may help. `launch` is like starting a program under a debugger from the command line. `attach` is like connecting a debugger to a server that is already running and waiting for one. Attach mode depends on two things, and later steps cover both:
> 
> 1. Something must start the process with a debugpy listener on a known port. Steps W1.3 and W1.5 show this.
> 2. VS Code must know where that listener is, and how file paths inside the container match files in the workspace. This configuration's `connect` and `pathMappings` settings hold that information. Step W1.6 explains them.
> 
> The match between `preLaunchTask` and the task's `label` is plain string equality. If the two texts drift apart, VS Code cannot find the task and reports an error, so no session starts. This is general VS Code behaviour, not something defined in this repository.
> 
> Whether VS Code then waits for the listener to be ready depends on what the task does. Step W1.6 looks at that.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 1375 characters, behind 1000.

**Before Show more**

> Here a person starts debugging in VS Code. They pick the entry named "Attach to the service in the container" from the Run and Debug list. VS Code then follows the settings in that entry.
> 
> Two settings decide what happens:
> 
> - **`type: "debugpy"`** gives the session to the Python debugger extension. On the Python side, the debugger is a library called debugpy.
> - **`request: "attach"`** sets the mode. VS Code has two kinds of debug request:
>   - `"launch"`: VS Code starts the program itself, under the debugger.
>   - `"attach"`: VS Code starts nothing. It connects to a program that is already running and already waiting for a debugger.
> 
> **This entry uses attach, so pressing Start does not run `service/main.py` on the developer's machine.** Something else has to start the service and its debugger listener first. The rest of the walk shows what does that. A good comparison is the difference between running a program under a debugger and connecting a debugger to a server that is already up.
> 
> The setting just below the lines shown here, `preLaunchTask: "Start the service container"`, names that "something else". VS Code runs the task with this label before it tries to attach. The match is by exact text, so this string must be the same as a task's `label` in the workspace's task file. The next step (W1.2) follows that label to the task that starts Docker Compose.

**Behind Show more**

> **Compared with the earlier revision:** this replaces a launch-mode configuration called "Run the service" (`.vscode/launch.json`, base, lines 4–10). That one had `request: "launch"` and a `program` setting pointing at `${workspaceFolder}/service/main.py`, with output going to VS Code's integrated terminal. That base configuration ran the service directly on the host, with no container and no pre-launch task. The new configuration has no `program` setting. In attach mode it would not be used anyway, because VS Code is not the one starting the process.
> 
> **What attach still needs:** the settings for where to connect (`connect`) and how to match container file paths to workspace files (`pathMappings`) are also in this configuration. W1.6 explains them, after the walk has shown what listens on the other end.
> 
> **About timing:** `preLaunchTask` makes VS Code run the task before attaching. It does not make VS Code wait until the service is ready. W1.6 returns to what that means for this task.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1463 characters, behind 1095.

**Before Show more**

> Here the editor gets a single debug configuration, named "Attach to the service in the container". When the user picks it and starts debugging (for example with F5), VS Code reads three settings from it:
> 
> - **`type: "debugpy"`** chooses the debugger. The Python Debugger extension handles the session, and it uses **debugpy**, the Python debugging library.
> - **`request: "attach"`** chooses how the session begins. With `"launch"`, VS Code starts the Python program itself. With `"attach"`, VS Code starts no Python process. It connects to a debugpy listener that something else has already started, and that listener runs inside the program being debugged.
> - **`preLaunchTask: "Start the service container"`** is on the line right after the shown range. It names a task that VS Code runs before the debug session begins. The name is a label, not a command: VS Code looks up the task whose `label` has this exact text.
> 
> The difference from the earlier revision is the main point. In base, this configuration was named "Run the service". It used `request: "launch"` with `program` pointing at the workspace's `service/main.py` file, so VS Code ran the service on the user's own machine. In target, the configuration has no `program` at all. **Starting the service is now someone else's job, and the editor only connects to it.** The task named by `preLaunchTask` fills that gap, and the next step (W1.2) follows that label to the task that brings up the container.

**Behind Show more**

> Attach mode only works if something has already started debugpy in listening mode. Here the process being debugged runs inside a container, so debugpy must be started there. A later step (W1.5) shows where that happens, in the container's command.
> 
> The rest of this object (`connect`, `pathMappings`, `justMyCode`) belongs to the attach itself. W1.6 explains it: the host and port the editor connects to, and how file paths inside the container are matched to files in the workspace.
> 
> How VS Code handles a pre-launch task is decided by VS Code, not by this repository. Here is what it normally does:
> 
> 1. It runs the task named by `preLaunchTask`.
> 2. A task that is not marked as a background task counts as finished when its command exits, so VS Code waits for that.
> 3. Then it sends the attach request.
> 
> That makes it important that the task in the next step starts the container in detached mode (`-d`). In that mode, Compose's command can return before the service inside the container is listening, and the configuration defines nothing that waits for the listener. W1.6 comes back to this.

#### after-claude-3 · version 10 · claude/opus · reported claude-opus-5-5

Visible 1699 characters, behind 544.

**Before Show more**

> This is the entry in VS Code's debug configuration list. When the user picks **"Attach to the service in the container"** in the Run and Debug view and presses F5, VS Code reads this object to decide what to do.
> 
> Two settings shape everything that follows:
> 
> - `type: "debugpy"` sends the session to the Python debugger extension, which uses the `debugpy` library to talk to a Python process.
> - `request: "attach"` tells that debugger **not to start any Python program itself**. It should connect to a Python process that is already running and already waiting for a debugger.
> 
> **What "attach" means here.** VS Code debug configurations come in two kinds:
> 
> - With `launch`, the editor starts the program, so it controls the process from the first line.
> - With `attach`, someone else starts the program, and the editor joins it over a network connection.
> 
> The earlier revision used `launch`, with a `program` setting that pointed at `service/main.py` in the workspace (base `.vscode/launch.json` lines 7–8). VS Code ran the service on the user's own machine. With `attach`, the service will run somewhere else (here, a container), and this entry only describes how to reach it. The `connect` and `pathMappings` settings that say how are covered in step W1.6.
> 
> Because attach starts nothing, something else has to get the process running first. That is the job of the next setting, `preLaunchTask: "Start the service container"`, just below the lines shown (`.vscode/launch.json` target line 8). VS Code runs the task with that exact label before it starts the debug session. **Carry that label to the next step**, where it matches a task in the workspace's task definitions that starts Docker Compose.

**Behind Show more**

> The label is the only link between the two files. VS Code matches the `preLaunchTask` string against the `label` of a task in `.vscode/tasks.json`. Nothing checks this while you edit, so a typo only shows up when you press F5, as a "could not find the task" error.
> 
> VS Code waits for the pre-launch task to finish before it attaches. But "finished" only means that the task's shell command exited. Whether that is enough for the attach to succeed depends on what the command does, which is followed in step W1.2 and taken up again in step W1.6.

### writer-pedagog-W1.6

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 498 characters, behind 362.

**Before Show more**

> This configuration tells VS Code to **attach to an existing debugpy process**, rather than launch the Python program itself. It connects to `localhost:5678`, the host port published for the container’s debug listener (see `compose.yaml`, target lines 4–6). The editor’s `pathMappings` pairs the container’s `/app/service` paths with the workspace’s `service` directory, so debugger paths can correspond to files open in VS Code. The next step follows the application code that the container starts.

**Behind Show more**

> The attach request runs after the `preLaunchTask`, which invokes `docker compose up -d --build service` (see `.vscode/tasks.json`, target lines 5–7). Detached startup does not itself establish that debugpy is ready, and this task defines no readiness check; the configuration therefore does not explicitly wait for the listener before VS Code attempts to attach.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 515 characters, behind 344.

**Before Show more**

> This configuration tells VS Code to **attach to an already-starting process**, rather than launch Python itself. VS Code first runs the “Start the service container” task, then connects to `localhost:5678`; Compose publishes that port from the container’s debug listener (target `compose.yaml`, lines 4–6). The task starts Compose in detached mode and defines no readiness check, so the configuration does not ensure the listener is ready before VS Code attempts to connect (target `.vscode/tasks.json`, lines 5–7).

**Behind Show more**

> The path mapping pairs the service files in the workspace with their copies under `/app/service` in the container. This lets VS Code relate the paths used by the attached process to local files—for example, when resolving source locations for debugging. `justMyCode: false` also means the configuration does not restrict debugging to user code.

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 2139 characters, behind 1300.

**Before Show more**

> Here the editor side of the handoff begins. As we saw in W1.5, the container runs debugpy as a listener on port 5678, and Compose publishes that port to the host. This configuration makes **VS Code act as the client that connects to that listener**. The service never calls VS Code. VS Code connects to it.
> 
> Three settings carry the connection:
> 
> - **`request: "attach"`** tells the Python debugger extension not to start a program. It joins a process that is already running. That process is the one Compose started through `preLaunchTask` (W1.1, W1.2).
> - **`connect`** with `localhost` and `5678` is the address VS Code dials. On the host nothing listens on 5678 itself. Docker forwards the connection from the `"5678:5678"` port mapping to debugpy inside the container. debugpy binds `0.0.0.0` so that it accepts connections arriving from outside the container's own loopback interface.
> - **`pathMappings`** translates file paths between the two machines. Inside the container, Python sees the code as `/app/service/...`, because the Dockerfile copies it there (W1.4). On your machine the same file is `${workspaceFolder}/service/...`. Suppose you set a breakpoint in the workspace's `service/server.py`. VS Code tells debugpy to break in `/app/service/server.py`. When the program stops there, debugpy reports the container path and VS Code opens the local file. Without this mapping, breakpoints would not match any file debugpy knows about.
> 
> `justMyCode: false` means the debugger also stops in and steps into library code, such as the standard library's `http.server` that the service uses in W1.8. Without it, the debugger stays in your own files.
> 
> **Timing is something to judge here.** The task runs `docker compose up -d --build service`. The `-d` flag makes Compose return as soon as the container has started, and the task defines no readiness check. So nothing in this configuration waits until debugpy is actually listening before VS Code attempts the attach. The code allows the attach to arrive before the listener is ready. How often that happens, and whether the extension retries, cannot be established from these files.

**Behind Show more**

> Two consequences follow from how the container command in W1.5 and this attach fit together:
> 
> 1. **The service does not wait for you.** The Compose command passes `--listen` but not `--wait-for-client`. debugpy opens the port and then runs `service.main` at once. The startup code in W1.7, and the server binding in W1.8, can run before the debugger is attached. A breakpoint on those lines may never be hit. A breakpoint in request handling still works, because a request can arrive after the attach.
> 2. **The mapping only lines up while the files match.** The image gets a copy of `service` at build time. Compose mounts no volume, so the container does not see the workspace files live. `--build` rebuilds the image on every launch, so the copy is current when you start debugging. If you edit a file during the session, the container keeps running the old code while VS Code shows the new file. Breakpoints and the highlighted line can then point at the wrong place until the next launch.
> 
> In the base revision this configuration was a `launch` request that ran `${workspaceFolder}/service/main.py` directly on the host. No container, port or path translation was involved. Everything in this step exists because the code now runs somewhere else and the debugger has to reach it over the network.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 2003 characters, behind 1815.

**Before Show more**

> Here the walk switches sides. The earlier steps followed the container: in W1.5, debugpy started listening on port 5678 inside it, and Compose published that port to the host. This step is the **VS Code side of that connection**. The service never calls VS Code. VS Code's debugger connects, as a client, to the listener that is already waiting.
> 
> **Attach instead of launch.** A debug configuration with `"request": "launch"` makes VS Code start the Python program itself. In the base revision, that is how this configuration worked: it ran `main.py` directly. With `"request": "attach"`, VS Code starts nothing. It expects a program that is already running with a debug server inside it, and connects to that server. Starting the program is now the job of the pre-launch task (W1.2) and the Compose command (W1.5).
> 
> **Where it connects.** `connect` points at `localhost`, port `5678`. On the host there is no debugpy process. The `"5678:5678"` entry under `ports` in Compose makes Docker forward the host's port 5678 to port 5678 in the container. That is where `--listen 0.0.0.0:5678` has debugpy waiting. The `0.0.0.0` matters: it makes debugpy accept connections on every network interface in the container, including the one Docker forwards to. A listener bound only to the container's own loopback address would not be reachable this way.
> 
> **Why `pathMappings` is needed.** The debugger and the running code see the same files under different paths:
> 
> - VS Code knows the file as `${workspaceFolder}/service/server.py`.
> - The Python process in the container knows it as `/app/service/server.py`, because the Dockerfile copies `service` to `/app/service` (W1.4).
> 
> Suppose you set a breakpoint in the workspace file. The mapping tells VS Code to ask debugpy for a breakpoint in `/app/service/...`. When the debugger stops, debugpy reports a container path, and VS Code maps it back to the workspace file so it can open it. Without the mapping, breakpoints would not match any file the container runs.

**Behind Show more**

> **Timing: what the code guarantees and what it leaves open.**
> 
> 1. VS Code runs the `preLaunchTask` first. That task is `docker compose up -d --build service`. The `-d` (detached) flag makes the command return once Compose has started the container. It does not wait for the process inside to reach any particular state.
> 2. The task defines no readiness check. Nothing in it waits until debugpy is actually listening on 5678. As far as these files show, VS Code may send the attach request before the listener exists. Whether that fails or VS Code retries depends on VS Code and the debugpy extension, not on code in this change.
> 3. The Compose command does not pass `--wait-for-client` to debugpy. So debugpy does not hold `service.main` back until a debugger attaches. The service starts at once, whether or not VS Code is connected. Breakpoints only take effect after the attach, so a breakpoint on code that runs during startup can be passed before the debugger is there.
> 
> The next step (W1.7) goes back to the container's Python process. That is a change of order: the module was started in W1.5, before this attach. The walk only explains it now.
> 
> **The mapping depends on the image being current.** The container runs copies made by `COPY` when the image was built. It does not run the workspace files themselves. `pathMappings` only translates paths; it assumes both sides hold the same content. The task's `--build` flag rebuilds the image on each start, so edits made before starting a debug session end up in the container. Edits made during a session do not, so lines can stop matching until the next start.
> 
> **`justMyCode: false`** lets the debugger stop in and step into code outside the workspace too. One example is the standard library's `http.server` module, which the server step (W1.8) builds on.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1951 characters, behind 1901.

**Before Show more**

> **The editor makes this connection; the service does not call out to it.** The `"request": "attach"` from the first step (W1.1) means VS Code starts no Python process. Its Python debugger acts as a client and opens a network connection to a debugpy server that is already running. In the earlier revision this configuration used `"request": "launch"` with a `program`, so VS Code ran `service/main.py` locally. Now the program runs in the container, and VS Code only connects to it.
> 
> **`connect`: where the editor dials.** `host: "localhost"` and `port: 5678` point at the developer's own machine, not at the container. The connection still reaches debugpy because of two settings seen earlier:
> 
> 1. The `ports` entry `"5678:5678"` in the Compose file (W1.3) tells Docker to forward the host's port 5678 to port 5678 inside the container.
> 2. The container command (W1.5) makes debugpy listen on `0.0.0.0:5678`, which means all of the container's network interfaces. That is what lets traffic forwarded from outside reach it. If it listened only on `127.0.0.1` inside the container, the forwarded traffic would not arrive.
> 
> **`pathMappings`: why the editor and the container need a translation.** A debugger names code by file path. Breakpoints are sent as "file X, line N", and each stack frame comes back as "file Y, line M". But the two sides see different paths:
> 
> - The editor has the source at `${workspaceFolder}/service/...`.
> - The container's Python runs the copies the Dockerfile placed under `/app/service` (W1.4).
> 
> The mapping is a prefix swap between `localRoot` and `remoteRoot`. For example, a breakpoint on line 6 of the workspace's `service/server.py` is sent as `/app/service/server.py`, line 6. When the program stops there, the reported path is turned back into the workspace file, so the editor can open and highlight it. Without the mapping, debugpy would get paths that don't exist in the container, and breakpoints would not bind.

**Behind Show more**

> **The mapping assumes both sides hold the same files.** It translates paths only; it does not check that the contents match. The image gets the source through `COPY` when the task runs `docker compose up -d --build`. The Compose file mounts no volume. So the container runs the source as it was when the image was last built. If a file is edited after that and not rebuilt, breakpoints in it can land on lines that no longer match the code that runs. Starting the debug configuration again runs the task again, which rebuilds the image. That resolves the mismatch for that session.
> 
> **What is ordered and what is left to timing.**
> 
> - **Ordered:** VS Code runs the `preLaunchTask` before attaching. The task is a plain shell task, and nothing in the task file marks it as a background task, so VS Code waits for `docker compose up -d --build service` to exit.
> - **Left to timing:** `-d` (detached) makes Compose return once the container has been started. It does not wait for the process inside to be ready. The task file has no readiness check, and the Compose file has no healthcheck. So nothing in this configuration guarantees that debugpy is already listening on 5678 when the attach request is sent. In practice debugpy probably starts quickly, but that is timing, not a guarantee. What the editor does if the connection is refused (an error or a retry) is up to the debugger extension, not this code.
> 
> **The service does not wait for the debugger either.** The container command has no `--wait-for-client`. Without it, debugpy starts listening and then runs `service.main` at once, whether or not anyone has attached. Code that runs before VS Code connects, such as module imports and the start of `serve` (followed in W1.7 and W1.8), runs without pausing at breakpoints. Breakpoints in the request-handling code still work, because that code runs later, when HTTP requests arrive on port 8080.

### writer-standard-W1.1

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 315 characters, behind 0.

**Before Show more**

> This configuration uses a `debugpy` **attach** request, so VS Code connects to a Python process started outside the debugger rather than launching `service/main.py` itself. Before attaching, VS Code runs the task named by `preLaunchTask`, `Start the service container`; the next step follows that label to the task.

**Behind Show more**

_(empty)_

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 257 characters, behind 0.

**Before Show more**

> This configuration tells VS Code’s `debugpy` extension to attach to a Python process rather than launch one. Before making that attach request, VS Code runs the `preLaunchTask` labelled `Start the service container`; the next step shows what that task does.

**Behind Show more**

_(empty)_

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1150 characters, behind 495.

**Before Show more**

> This is the configuration the user picks in VS Code's Run and Debug view, and it is where the walk begins. It uses the Python debugger (`"type": "debugpy"`) with `"request": "attach"`. **VS Code does not start the Python program itself. It connects to a debugger that something else has already started.**
> 
> That replaces the earlier configuration. In the base revision, "Run the service" used `"request": "launch"` with a `program` pointing at `service/main.py`. VS Code ran that file on the host and debugged it directly. In this revision there is no `program` entry, so the service's own process must be started elsewhere. In this setup it is started inside a container.
> 
> Before attaching, VS Code runs a task. The `preLaunchTask` value just after the shown lines, `"Start the service container"`, names that task by its label. VS Code finds the task with the same label in the workspace's tasks file and runs it first. That task is the next step (W1.2). The rest of this configuration (`connect` to `localhost:5678` and `pathMappings`) controls where the debugger connects. It comes back in W1.6, once the walk has shown what listens on that port.

**Behind Show more**

> The label only works as a link if the task's `label` matches the `preLaunchTask` value exactly. In this revision, `.vscode/tasks.json` (target, line 5) defines `"label": "Start the service container"`, which is the same string. If the two drifted apart, VS Code would report that the task cannot be found and would not start the debug session.
> 
> The `name` "Attach to the service in the container" is only the text shown in VS Code's configuration picker. Nothing else in the change refers to it.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 888 characters, behind 453.

**Before Show more**

> This is where the debug session starts. When the user picks "Attach to the service in the container" in VS Code's Run and Debug view, the Python debugger extension (`"type": "debugpy"`) reads this entry.
> 
> **`"request": "attach"` is the key change.** Before this change, the same configuration used `"request": "launch"` with a `program` pointing at the workspace's `service/main.py`. VS Code then started that Python process on the host itself. With `attach`, VS Code starts no Python process. It connects to a debugpy listener that something else has to have started already. In this walk, that's the container.
> 
> The configuration also names a task to run before the session starts: `"preLaunchTask": "Start the service container"` (the line just after this excerpt). VS Code finds the task in `tasks.json` by matching that exact label text. **That label is what the next step follows.**

**Behind Show more**

> The rest of this configuration, `connect` and `pathMappings`, tells VS Code where to attach and how to match files in the container to workspace files. That's covered in W1.6, after the walk has shown what starts the listener.
> 
> With `preLaunchTask`, VS Code runs the task first and only then starts the debug session. Whether the debugger's listener is actually up when the attach happens depends on what the task waits for. W1.6 picks up that question.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 983 characters, behind 1034.

**Before Show more**

> This configuration no longer starts the service. In the earlier revision it was a `"launch"` configuration named "Run the service": VS Code ran `service/main.py` on the host in the integrated terminal, and the debugger owned that process. Here `request` is `"attach"`, so the `debugpy` debugger starts no Python program. **It connects to a debugpy listener that something else must already have started.** The rest of the walk follows where that listener comes from.
> 
> Two settings decide that handoff:
> 
> 1. `preLaunchTask`, the line just after this step's lines, names the task VS Code runs before it tries to attach: `"Start the service container"`. VS Code matches that string against task labels. In the next step (W1.2) it leads to the shell task that runs Docker Compose.
> 2. The `connect` and `pathMappings` settings below it say where the debugger attaches and how container paths match workspace files. W1.6 comes back to them once the walk has shown what listens on that port.

**Behind Show more**

> Some details of the configuration:
> 
> - **Same debugger type.** `type` is `"debugpy"` in both revisions. Only the request kind changed, and with it the settings that make sense. A `launch` request needs `program` and `console`, and those are gone. An `attach` request needs `connect` and, when the code runs somewhere else, `pathMappings`.
> - **The name is just a label.** The configuration's `name` ("Attach to the service in the container") is what the user picks in the Run and Debug view. Nothing else in the repository refers to it.
> - **The task link is a plain string match.** The link between `preLaunchTask` and the task is the label text and nothing more. If either side is renamed and the other is not, VS Code cannot find the task. In this revision the two strings match exactly.
> - **The two sides are not explicitly synchronized.** The task starts the container in detached mode and defines no readiness check, as W1.2 and W1.6 show. So this configuration does not explicitly make the attach wait until the listener is ready.

#### after-claude-3 · version 10 · claude/opus · reported claude-opus-5-5

Visible 1007 characters, behind 554.

**Before Show more**

> This is where the debug session begins. The user picks **"Attach to the service in the container"** in VS Code's Run and Debug view, and the `debugpy` debugger type handles it.
> 
> The key setting is `request: "attach"`. In a `"launch"` configuration, VS Code starts the Python process itself. With `"attach"`, VS Code starts no program. It connects to a debugpy listener that something else has already started. That is why this configuration has no `program` entry: **the service runs somewhere else, and VS Code only connects to it.** The connection details (`connect` and `pathMappings`) are just below this step, and W1.6 covers them.
> 
> So what starts that process? The next field, `preLaunchTask: "Start the service container"`, names a task that VS Code runs before it tries to attach. The label is the only link between the two files. VS Code finds the task in the workspace's task definitions by its exact label, so the two strings must match exactly. In the next step we follow that label to the task.

**Behind Show more**

> In the earlier revision, this configuration was called "Run the service". It used `request: "launch"` with `program` pointing at `service/main.py` and `console: "integratedTerminal"`. Back then, VS Code started the service directly on the host, with no task beforehand. The change moves the service into a container and turns VS Code from the process starter into a client that attaches. The two settings depend on each other: the attach request expects the listener to exist, and the pre-launch task is the only thing in the editor setup that starts it.

### writer-standard-W1.6

#### before-copilot · version 9 · copilot/(the provider default) · reported gpt-6-luna

Visible 352 characters, behind 377.

**Before Show more**

> VS Code uses `request: "attach"` to connect to the running `debugpy` process at `localhost:5678`; it does not launch the service itself. Compose publishes that port from the container (target `compose.yaml`, lines 4–6). The `pathMappings` entry lets the debugger match files under `/app/service` in the container to the workspace’s `service` directory.

**Behind Show more**

> The `preLaunchTask` runs the task whose command starts Compose in detached mode (target `.vscode/tasks.json`, lines 5–7). That task has no readiness check: its completion does not establish that `debugpy` is listening, so this configuration does not guarantee the attach will succeed immediately. `justMyCode: false` also allows debugging code beyond the workspace’s own files.

#### after-copilot · version 10 · copilot/(the provider default) · reported gpt-6-luna

Visible 476 characters, behind 281.

**Before Show more**

> The attach request connects VS Code to `localhost:5678`, the host port published for `debugpy` in the container (as shown in the previous step). `pathMappings` pairs the workspace’s `service` directory with `/app/service` in the container so the debugger can match container source paths to workspace files. This is an editor-side connection; it does not start the Python program. The next step follows that program into `service.main` ([`service/main.py`, target lines 4–8]).

**Behind Show more**

> The `preLaunchTask` starts Compose in detached mode, and the task defines no readiness check. It therefore does not explicitly wait for `debugpy` to be ready before VS Code attempts the attach. `justMyCode: false` also configures the debugger not to restrict stepping to user code.

#### before-claude · version 9 · claude/opus · reported (not captured)

Visible 1985 characters, behind 1218.

**Before Show more**

> Here VS Code connects to a debugger that is already running; it does not start the program. Because `request` is `"attach"`, VS Code first runs the `preLaunchTask` (W1.2). Once that task finishes, VS Code acts as a **client** and connects to the address in `connect`. Nothing in the service calls the editor. The connection goes from VS Code to the debugpy listener started in W1.5.
> 
> Two settings make the connection work:
> 
> - **`connect`: `localhost`, port `5678`.** VS Code runs on the host, so `localhost` is the host machine, not the container. The address leads to debugpy only because Compose publishes `5678:5678` and debugpy listens on `0.0.0.0` inside the container (W1.5). If either of those changes, this address points at nothing.
> - **`pathMappings`.** debugpy reports file paths as the container sees them. The Dockerfile copied the source to `/app/service` (W1.4). The mapping turns `/app/service/...` into `${workspaceFolder}/service/...` and back again, so a breakpoint set in the editor matches the file the container runs, and stopping at a breakpoint opens the right local file. The `remoteRoot` must match the `COPY` destination in the Dockerfile. If the two differ, VS Code can't match its breakpoints to the files that run.
> 
> **The start-up is not synchronised in this code.** The task runs `docker compose up -d --build service`. With `-d`, Compose returns once the container has been started, not when debugpy is listening. The task defines no readiness check, so nothing here makes the attach wait for the listener. Whether the first connection attempt arrives early depends on timing, and this repository does not show how the debugpy extension retries.
> 
> The compose command also does not pass `--wait-for-client` to debugpy. As written, `service.main` starts running straight away, without waiting for the editor to attach. Code that runs before the attach, such as the start of `serve` (W1.7, W1.8), may be past any breakpoint by the time the editor connects.

**Behind Show more**

> **Compared with the earlier revision.** The earlier configuration used `"request": "launch"` with `program` set to `service/main.py`. VS Code then started Python on the host itself, so there was no separate process to reach and no path translation to do. The new configuration moves the process into the container, and that is why `connect` and `pathMappings` are now needed.
> 
> The earlier setup also ran `main.py` as a script. That file starts with `from service.server import serve` (`service/main.py` target line 1). Run as a script, Python puts the `service/` folder on the import path, not its parent, so that import would normally fail. The container avoids this by running `python -m ... -m service.main` from `WORKDIR /app` (W1.5). This is a reading of how Python resolves imports, not an observed run.
> 
> **What the mapping does not cover.** The mapping only covers the project's own `service` package. The configuration also sets `justMyCode` to `false` (just below this step's lines), which lets the debugger step into library code such as `http.server`, used by the server in W1.8. Those library files live at container paths that have no mapping. Stepping into them probably won't find a matching local file.

#### after-claude · version 10 · claude/opus · reported (not captured)

Visible 1647 characters, behind 1510.

**Before Show more**

> Here the walk moves from the container back to the editor. **The debugger connection starts from VS Code, not from the service.** In the previous step (W1.5), debugpy started listening inside the container on `0.0.0.0:5678`, and Compose published that port to the host. This step is the client side of that connection.
> 
> When the user starts the configuration "Attach to the service in the container", VS Code runs the `preLaunchTask` from W1.2. It then opens a debug session as a client to `connect.host` `localhost` and `connect.port` `5678`. That port is the one Compose's `"5678:5678"` mapping forwards to debugpy in the container. The two sides only have the port number in common. Nothing else links them, so changing the port in one place means changing it in the other.
> 
> `pathMappings` matters because the debugger and the code see different file paths:
> 
> - Inside the container, Python runs the files the Dockerfile copied to `/app/service` (W1.4). Stack frames and breakpoint locations use those paths.
> - In the editor, the same files are under `${workspaceFolder}/service`.
> 
> The mapping converts between `remoteRoot` and `localRoot`. Without it, breakpoints set in the workspace would not match the code that runs in the container. The mapping is only correct while the copied files match the workspace. The task builds with `--build`, so each start rebuilds the image from the current workspace. Edits made after that are not in the container until the next rebuild.
> 
> `justMyCode: false` lets the debugger step into and stop in library code too, such as the standard-library HTTP server reached in W1.8, not only the project's own files.

**Behind Show more**

> **Timing between the task and the attach.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once Compose has started the container. It does not wait for the Python process inside. The task has no readiness check, so VS Code sends the attach request when the shell command ends. Nothing in these files makes sure debugpy is already listening by then. The code therefore allows an attach that tries before the listener is ready, and whether that attach fails depends on timing and on how VS Code retries. Neither can be determined from this repository.
> 
> **The service does not wait for the debugger.** The Compose command uses `--listen` without `--wait-for-client`. debugpy therefore starts running `service.main` right away, whether or not anyone has attached. Code that runs before the attach finishes, such as the start of `main` and the call to `serve` in the next steps, can run before any breakpoints are set. Once the server is in its request loop (W1.8), requests handled after the attach can stop at breakpoints.
> 
> **Compared with the base revision.** In the base, this configuration was `"request": "launch"` with `program` set to `${workspaceFolder}/service/main.py`. VS Code started the script itself on the host, in the integrated terminal. In the target, VS Code starts no program. The container runs the service, and the editor only connects to it. That change is why the target needs the task, the Compose file, the Dockerfile and the path mapping.

#### after-claude-2 · version 10 · claude/opus · reported (not captured)

Visible 1312 characters, behind 1574.

**Before Show more**

> Here VS Code acts as the **client**. The service never contacts the editor. The `"request": "attach"` we saw in step W1.1 means VS Code starts no Python process of its own. Once the pre-launch task finishes, it opens a connection to whatever is listening at `connect`.
> 
> The connection goes through three pieces we've already seen:
> 
> 1. VS Code connects to `localhost:5678` on the host.
> 2. Compose's `"5678:5678"` mapping forwards that host port into the container (step W1.3).
> 3. In the container, `debugpy --listen 0.0.0.0:5678` accepts the connection (step W1.5). It binds to `0.0.0.0` rather than the container's own loopback, so the forwarded traffic can reach it.
> 
> **`pathMappings` is what makes breakpoints work.** The debugger in the container reports files under `/app/service`, the folder where the Dockerfile's `COPY` put the source (step W1.4). VS Code knows them as `${workspaceFolder}/service`. With this mapping, a breakpoint you set in a workspace file gets translated to the matching container path, and stack frames get translated back. If `remoteRoot` didn't match the `COPY` destination, the debugger would still connect, but breakpoints wouldn't bind.
> 
> `justMyCode: false` means the debugger also stops in and steps into library code, such as `http.server`, which the server uses in step W1.8.

**Behind Show more**

> **Timing between startup and attach.** The pre-launch task runs `docker compose up -d --build service` (step W1.2). With `-d`, the command returns once Compose has started the container, not once debugpy is listening. The task has no readiness check and no background or problem-matcher signal, so nothing in this configuration makes VS Code wait for port 5678 before attaching. Whether a too-early attach fails or gets retried is up to the VS Code Python debugger, which can't be determined from this code.
> 
> **The service doesn't wait for the debugger.** The command in step W1.5 uses `--listen` without `--wait-for-client`, so `service.main` starts right away whether an editor is attached or not. Anything that runs before the attach completes, such as startup in `main` or the bind in `serve`, can run before your breakpoints are set. Once attached, breakpoints in request handling are hit normally.
> 
> **The mapped files are a copy.** `/app/service` holds the source as it was when the image was built. The `--build` flag rebuilds the image on every launch, so workspace and container match at the start of a debug session. Edits you make during the session don't reach the running container until the next launch.
> 
> **Compared with the earlier revision.** In base, this configuration was `"request": "launch"` with `program` set to `${workspaceFolder}/service/main.py`. VS Code ran the script itself, on the host, with no container, port or path mapping involved. In target, the service runs only inside the container, and the editor's role is reduced to attaching to it.

## 3. The connect case with Copilot, version 9 and 10 (W1.1, W1.5)

### present-essens-W1.1

#### version 9 (DSP-194 final-v9)

Visible 437 characters, behind 196.

**Before Show more**

> Here `startSession` adds a status notification alongside the connection attempt: it registers a handler before calling `connect`, mapping `connected` to “session ready” and `gave-up` to “offline mode.” The awaited result is separate; on `gave-up`, `startSession` also reports “retrying later.” Unlike the base revision, which only awaited `connect`, this version can report the outcome. The next step shows how `Link` stores the handler.

**Behind Show more**

> The notification only has a settled outcome to report. If `transport.open` rejects, `connect` rejects instead of settling, so this handler does not report an outcome; that path is covered in W3.2.

#### version 10

Visible 433 characters, behind 0.

**Before Show more**

> Compared with the base revision, `startSession` now accepts a `report` callback and registers an outcome-specific notification before connecting. A `connected` outcome reports “session ready”; the other `Outcome`—currently `gave-up`—reports “offline mode”. Separately, once `connect` resolves, `gave-up` also triggers “retrying later”, so those are distinct reports.
> 
> The next step shows how `whenSettled` stores the callback [W1.2].

**Behind Show more**

_(empty)_

### present-essens-W1.5

#### version 9 (DSP-194 final-v9)

Visible 281 characters, behind 188.

**Before Show more**

> On the successful path, `settle` schedules the registered notification for a later timer turn rather than running it inline. `connect` can return `'connected'` first; then `startSession` resumes after its `await`, and the callback reports `'session ready'` in the next step (W1.6).

**Behind Show more**

> `settle` clears the registration before scheduling, so that callback is used at most once. The timer closes over this call’s `outcome`; if no callback is registered, no timer is scheduled.

#### version 10

Visible 293 characters, behind 409.

**Before Show more**

> After the successful branch reaches `settle` (W1.4), the outcome is returned by `connect` and also sent to the registered handler—but the handler is deferred, not called inline. This lets `startSession` resume after its `await` before the timer reports “session ready” in the next step (W1.6).

**Behind Show more**

> The registration is consumed before scheduling, so a later settlement cannot invoke that same registration again; if no callback is registered, no timer is scheduled. A delay of `0` defers the callback to a later timer turn, not an exact zero-delay deadline. Unlike the base revision, where `connect` simply returned `transport.open`’s boolean, the target also settles a registered callback with an `Outcome`.

### present-pedagog-W1.1

#### version 9 (DSP-194 final-v9)

Visible 367 characters, behind 458.

**Before Show more**

> Here, `report` is a function that sends a text message, and the callback translates `Link`’s `Outcome`—`'connected'` or `'gave-up'`—into the corresponding message. Registering the callback does not report immediately: it gives `Link` work to do if it later settles. `startSession` then waits for `connect`; in the next step, `whenSettled` stores that callback (W1.2).

**Behind Show more**

> The callback report is separate from the result `startSession` receives from `connect`: after a `'gave-up'` result, `startSession` also reports `'retrying later'` (W2.5). In the base revision, `startSession` only awaited `connect`; this revision adds the `report` argument and settlement callback. One boundary to keep in mind: if `transport.open` rejects, the walk shows that `Link` does not settle, so this callback does not report an outcome (W3.1, W3.2).

#### version 10

Visible 445 characters, behind 331.

**Before Show more**

> `whenSettled` takes a callback—a function for `Link` to call later—and `Outcome` limits its input to `'connected'` or `'gave-up'`. `startSession` registers that callback before it awaits `connect`, so the handler is in place when `Link` settles. It passes the resulting message to the caller-provided `report` function. Unlike the `await` below, registering the callback does not pause `startSession`; the next step shows where `Link` stores it.

**Behind Show more**

> These are two separate reporting paths: the callback reports “session ready” or “offline mode,” while the code after the `await` reports “retrying later” when `connect` returns `'gave-up'`. The callback runs only if `Link` settles; if `transport.open` rejects, the code does not reach either `settle` call (see the rejection walk).

### present-pedagog-W1.5

#### version 9 (DSP-194 final-v9)

Visible 486 characters, behind 489.

**Before Show more**

> `settle` is reached after `connect` gets an outcome from an attempt, as in W1.4. It takes the registered callback and clears the registration before scheduling the callback, so that settlement consumes that registration rather than leaving it for another call. `setTimeout(..., 0)` asks JavaScript to run the callback in a later timer task; it does not call it immediately or guarantee it runs exactly zero milliseconds later. In the base revision, `connect` had no settlement callback.

**Behind Show more**

> The callback closes over this call’s `outcome`, so it will report `'connected'` or `'gave-up'` even though `connect` has already returned that outcome to its caller. The timer does not wait for the callback to finish: `startSession` resumes after awaiting `connect` and handles the returned outcome, while the callback reports through `report` in the later step (W1.6). On the failure path, that means `startSession` can report `'retrying later'` before the timer reports `'offline mode'`.

#### version 10

Visible 392 characters, behind 203.

**Before Show more**

> `settle` takes the callback registered with `whenSettled` and clears the stored slot before scheduling anything. If there is a callback, `setTimeout` schedules it for a later timer turn; it does not call it inside `connect`. So after `connect` returns its outcome, `startSession` can continue through its `await` before the timer callback runs. The next step follows both paths. [W1.2] [W1.6]

**Behind Show more**

> A delay of `0` does not mean “run immediately”: it makes the timer eligible to run later, and other work can delay it. If no callback was registered, the slot is still cleared, but no timer is scheduled.

### writer-essens-W1.1

#### version 9 (DSP-194 final-v9)

Visible 338 characters, behind 0.

**Before Show more**

> `startSession` accepts a `report` function and registers a callback with `link.whenSettled` before connecting. That callback turns a `connected` outcome into `session ready` and any other outcome into `offline mode`; `startSession` then awaits `link.connect(address)`. The next step shows where `Link` keeps the callback until it settles.

**Behind Show more**

_(empty)_

#### version 10

Visible 260 characters, behind 0.

**Before Show more**

> `startSession` now accepts a `report` function and registers a callback with `Link` before awaiting `connect`. When that callback runs, it reports “session ready” for a `connected` outcome and “offline mode” otherwise; the next step shows how `Link` stores it.

**Behind Show more**

_(empty)_

### writer-essens-W1.5

#### version 9 (DSP-194 final-v9)

Visible 291 characters, behind 200.

**Before Show more**

> After W1.4’s successful path calls `settle('connected')`, `settle` schedules the registered callback instead of running it inside `connect`. This lets `connect` return and `startSession` resume after its `await` before the timer callback runs; W1.6 follows that order through to the reports.

**Behind Show more**

> `settle` clears `onSettled` before scheduling, so the callback is used at most once; if no callback is registered, it schedules nothing. When called, the timer passes the same outcome to the callback.

#### version 10

Visible 276 characters, behind 236.

**Before Show more**

> On the successful path, `connect` calls `settle('connected')` before returning. `settle` schedules the registered callback on a timer instead of running it inside `connect`, so `startSession` resumes from its `await` before the callback runs; the next step follows that order.

**Behind Show more**

> `settle` takes the callback from `onSettled` and clears the field before scheduling it. This makes the registration one-shot, and if no callback is registered, no timer is scheduled. The `setTimeout` callback runs later as a timer task.

### writer-pedagog-W1.1

#### version 9 (DSP-194 final-v9)

Visible 339 characters, behind 0.

**Before Show more**

> `startSession` now accepts a `report` function and registers a callback with `Link.whenSettled` before calling `connect`. The callback reports “session ready” for `'connected'` and “offline mode” for any other outcome. `startSession` then awaits `connect`; the next step shows where `whenSettled` keeps the callback until the link settles.

**Behind Show more**

_(empty)_

#### version 10

Visible 435 characters, behind 0.

**Before Show more**

> `startSession` now takes a caller-provided `report` function and registers a callback with `Link` before awaiting `connect`. When `Link` supplies an outcome, that callback reports “session ready” for `connected” and “offline mode” otherwise. The awaited result is handled separately after `connect` returns; in the next step, `whenSettled` shows where the callback is stored. Unlike the base version, callers must now provide `report`.

**Behind Show more**

_(empty)_

### writer-pedagog-W1.5

#### version 9 (DSP-194 final-v9)

Visible 245 characters, behind 353.

**Before Show more**

> `settle` takes the registered callback out of `onSettled` before scheduling it, so this settlement can invoke that callback at most once; if none is registered, it schedules nothing. The callback runs in a later timer task, not inside `connect`.

**Behind Show more**

> As established in W1.2, `onSettled` holds one callback. Copying it to a local variable lets `settle` clear the field while still scheduling that callback with the outcome. On the success path, `connect` then returns `'connected'`; its promise continuation resumes `startSession` before the timer task runs. W1.6 follows that order through to the report.

#### version 10

Visible 315 characters, behind 421.

**Before Show more**

> After the successful `connect` path calls `settle`, it takes the registered callback out of `onSettled` and clears the field. If there is a callback, `setTimeout` schedules it with the outcome; if not, `settle` does nothing further. This makes the registered callback one-shot, and it does not run inside `connect`.

**Behind Show more**

> The timer callback closes over the saved callback and outcome, so clearing `onSettled` does not prevent the scheduled call. `connect` returns its outcome after `settle`; then `startSession` resumes from `await` as a promise continuation. JavaScript runs that continuation before moving on to the timer task, so `startSession` handles the returned outcome first. The next step follows what each of those two paths reports.

### writer-standard-W1.1

#### version 9 (DSP-194 final-v9)

Visible 278 characters, behind 0.

**Before Show more**

> `startSession` now accepts a `report` function and registers a callback with `Link` before awaiting `connect`. When `Link` later settles, the callback reports “session ready” for `connected` and “offline mode” for the other outcome. The next step follows where `Link` stores it.

**Behind Show more**

_(empty)_

#### version 10

Visible 341 characters, behind 0.

**Before Show more**

> `startSession` registers a callback with `Link` before it awaits `connect`. When the Link later settles, the callback reports “session ready” for `connected` and “offline mode” for the other outcome. The `report` parameter is also used directly after the await when the outcome is `gave-up`; the next step shows where the callback is stored.

**Behind Show more**

_(empty)_

### writer-standard-W1.5

#### version 9 (DSP-194 final-v9)

Visible 321 characters, behind 330.

**Before Show more**

> `settle` takes the registered callback out of `onSettled` and clears the field before scheduling it. If there is no callback, it does nothing; otherwise, it passes the outcome captured by this call to `setTimeout` with a zero-millisecond delay. This makes the callback one-shot and keeps it from running inside `connect`.

**Behind Show more**

> Because the successful branch calls `settle` before returning, the timer is scheduled before `connect` returns `'connected'`. The `await` in `startSession` then resumes in a promise microtask; the timer callback runs later as a separate task. The next step follows that callback back to `startSession` to explain the report order.

#### version 10

Visible 368 characters, behind 338.

**Before Show more**

> `settle` takes the registered callback out of `onSettled` before scheduling it, so that registration is consumed even if there is no callback to call. If one was registered, `setTimeout` queues it for later rather than running it inside `connect`; here, `connect` returns `'connected'` first. The next step follows that return to `startSession` and the later callback.

**Behind Show more**

> Because `connect` is async, returning `'connected'` fulfills its promise, and `startSession` resumes after its `await` in a microtask. That continuation runs before the queued timer callback, so the callback can report only after `startSession` has handled the returned outcome. This is the order implied by the code, not an observed run.

## 4. The loop reviewer: first answer and after rework

Copilot, version 10, Essentials. The reviewer asked for one correction, on W1.6; the writer's first answer and its rework:

**Finding**

> {
>   "assessment": "The walk traces the attach setup through container startup to the HTTP server, and its claims about the configuration and execution path match the target code. W1.6 still leaves the server's main behavior unclear: it identifies the listener but not what handles requests.",
>   "verdict": "rework",
>   "findings": [
>     {
>       "kind": "explanation",
>       "steps": ["W1.6"],
>       "problem": "The step does not explain that the server uses SimpleHTTPRequestHandler, so it leaves unclear what the service actually does with HTTP requests.",
>       "why": "For Essentials, this is part of the main behavior, not incidental server mechanics: without it, “HTTP service” could suggest an application API rather than a static file server.",
>       "evidence": "In target service/server.py lines 4–5, serve assigns SimpleHTTPRequestHandler to handler and passes it to ThreadingHTTPServer; target Dockerfile line 2 sets the working directory to /app."
>     }
>   ]
> }

**First answer (turn 7)**

> `serve(port=8080)` binds a `ThreadingHTTPServer` to `0.0.0.0`, making it listen on all container interfaces, then keeps serving requests with `serve_forever()`. Compose publishes container port 8080 as host port 8080, making the HTTP service reachable from the host.

**After rework (turn 9)**

> `serve(port=8080)` runs Python’s `SimpleHTTPRequestHandler`, so this is a static file server rather than an application API. Because the container’s working directory is `/app`, requests are served from there. The server binds to all container interfaces and serves continuously; Compose publishes port 8080 to host port 8080.

Claude (claude-opus-5-5), version 10, Essentials: the reviewer accepted the walk at once, so no text changed after the writer's first answer (`loop/v10-attach-loop-essens-claude/`).

## 5. The window trials: what the Step panel showed

### dsp195-essens-single-claude

#### step-W1.1-essens-prepared

Pictures: [step-W1.1-essens-prepared-show-more.png](window/dsp195-essens-single-claude/step-W1.1-essens-prepared-show-more.png) (the picture before Show more could not be drawn; this one shows the same first part with Show more open)


**Before Show more**

VS Code no longer starts the program. It connects to a debugger that is already running.

Before the change, VS Code started service/main.py itself, as a local process in the integrated terminal. Now the configuration is an attach: VS Code starts no Python process. It expects a debugpy server to be waiting somewhere and connects to it.

Before it connects, VS Code runs the task named in preLaunchTask. That task is the only thing in this setup that brings the container up. The next step shows it.

**Behind Show more**

VS Code matches the preLaunchTask value against a task label in tasks.json. If the two strings drift apart, VS Code reports that it cannot find the task, and the attach fails.


#### step-W1.1-standard-alternative

Pictures: [step-W1.1-standard-alternative.png](window/dsp195-essens-single-claude/step-W1.1-standard-alternative.png), [step-W1.1-standard-alternative-show-more.png](window/dsp195-essens-single-claude/step-W1.1-standard-alternative-show-more.png)


**Before Show more**

This step changes who starts the Python process.

Before (base, launch.json lines 5–9), the configuration was a launch. When you pressed F5, VS Code ran service/main.py itself, under the debugger, in the integrated terminal. The process ran on your machine, and its lifetime was the debug session's lifetime.

Now (target, lines 5–8), request is attach. The debugpy adapter starts nothing. It connects to a debugpy server that something else has already started. That changes what the configuration depends on:

Something else must start the program. Here that is preLaunchTask. VS Code runs the task whose label matches "Start the service container", and only after that does it try to connect. The label is matched exactly as a string. It does match the one task defined in tasks.json, but nothing checks the two if one is renamed later. The next step [W1.2] shows that the task runs docker compose up -d --build service. A later step [W1.4] shows the container starting the service under debugpy --listen.

The debugger has to be reachable. An attach needs to know where to connect. That is the connect setting on the next line, which the last step of this walk covers [W1.7].

The code runs in a different place. The source the debugger sees is inside the container, not in your workspace. So the configuration also needs pathMappings, which Walk 2 covers [W2.2].

The result: pressing F5 builds and starts a container and then connects to it. The debugger runs inside the container, not as a local child process of VS Code.

**Behind Show more**

Some consequences of the attach model show up when you read this configuration together with the files it relies on. These are observations from reading the code, not behaviour I have seen run:

Stopping the debugger probably leaves the container running. In an attach session, ending the session disconnects from the debugger. The service was started with docker compose up -d, in the background, and no postDebugTask or other teardown is configured. As far as these files show, the service keeps running after you stop debugging. Under launch, stopping ended the process.

There is a possible race at startup. The task is a plain shell task, so VS Code treats it as done when docker compose up -d returns. That happens once the container has started, not once debugpy is listening on port 5678. If the attach comes too early, the connection may fail. I don't know how VS Code handles that here, because these files set no retry or readiness check.

The service doesn't wait for you. The compose command runs debugpy --listen without --wait-for-client. The service starts running immediately, whether or not a debugger is attached. Breakpoints in startup code, such as main() calling serve(port=8080), may already have been passed before the attach completes. Under the old launch, the debugger was there from the first line.

The entry point changed slightly. Base ran service/main.py as a script path. The container runs it as a module, -m service.main. That suits the absolute import from service.server import serve in main.py.


#### step-W1.7-essens-prepared

Pictures: [step-W1.7-essens-prepared.png](window/dsp195-essens-single-claude/step-W1.7-essens-prepared.png)


**Before Show more**

After the task ends, VS Code attaches to localhost:5678.

This is where the debug start continues once the task from the second step has ended. VS Code connects to the host port published in the previous step, which forwards to the debugpy listener started by the container command. If debugpy is not listening yet, the connection fails and the developer has to start the session again. Nothing in the configuration retries.

**Behind Show more**

(no Show more)


#### step-W1.7-standard-alternative

Pictures: [step-W1.7-standard-alternative.png](window/dsp195-essens-single-claude/step-W1.7-standard-alternative.png), [step-W1.7-standard-alternative-show-more.png](window/dsp195-essens-single-claude/step-W1.7-standard-alternative-show-more.png)


**Before Show more**

This is where the debug start continues after the pre-launch task finishes. With request: "attach", VS Code starts no process ([W1.1]). The connect setting is the only thing that tells the debug adapter where to find a debugger. Here it opens a connection to localhost:5678 on your machine.

To get to the debugger, that connection goes through two pieces set up in earlier steps:

The port mapping. Compose publishes "5678:5678", so a connection to host port 5678 is forwarded into the container [W1.6].

The listener. Inside the container, the service was started with python -m debugpy --listen 0.0.0.0:5678 [W1.4]. Because it binds 0.0.0.0 and not only the container's own loopback, the forwarded connection can reach it.

So the port number 5678 appears in three places, and all three must agree: the connect address here, the published port in compose.yaml, and the --listen argument. Nothing ties them together except that they were written the same.

When the connection happens. VS Code connects only after the task "Start the service container" has finished. That task is a plain shell task running docker compose up -d --build service ([W1.2]). It finishes when that command returns. Nothing in it waits until debugpy is actually listening. If the connection comes before the listener is up, the attach fails. These files configure no retry or readiness check. Whether the debugpy adapter itself retries on its own can't be determined from this repository.

**Behind Show more**

Once attached, you are joining a service that is already running, not starting one. The compose command has no --wait-for-client, so the service keeps running whether or not this connection ever succeeds. A failed attach therefore doesn't stop the service. You can start the debug session again, which runs the pre-launch task again and then tries to connect again.

Some details about the address:

localhost assumes Docker runs on the same machine as VS Code. That holds for a local Docker Desktop or Engine. If the Docker context points at a remote daemon, the published port is on that remote host, and localhost:5678 would reach nothing. This configuration has no variable or input for the host.

Port 5678 also has to be free on the host. If another process, or another debug container, already uses host port 5678, docker compose up cannot publish the port. Then this connection may fail or reach the wrong listener.

The open port is unauthenticated. debugpy listens on 0.0.0.0 inside the container, and the compose mapping "5678:5678" has no host IP in front of it. Docker normally publishes such a mapping on all host interfaces. That means the debug port, which allows running arbitrary code in the service, may be reachable from other machines on the network, not just from localhost. This is an observation from the mapping syntax, not something these files restrict or test.

After the connection succeeds, the debugger needs to match file paths in the container to files in your workspace. The next setting in this configuration handles that, and Walk 2 covers it [W2.2].


### dsp195-essens-single-copilot

#### step-W1.1-essens-prepared

Pictures: [step-W1.1-essens-prepared.png](window/dsp195-essens-single-copilot/step-W1.1-essens-prepared.png)


**Before Show more**

The launch configuration asks VS Code to start a task, then attach to debugpy.

Here, request is attach, not a request for VS Code to launch a local Python program. The preLaunchTask names the task in the next step; the connection settings target port 5678 on localhost, and pathMappings relate local files under service to the container's /app/service files.

**Behind Show more**

(no Show more)


#### step-W1.1-standard-alternative

Pictures: [step-W1.1-standard-alternative.png](window/dsp195-essens-single-copilot/step-W1.1-standard-alternative.png), [step-W1.1-standard-alternative-show-more.png](window/dsp195-essens-single-copilot/step-W1.1-standard-alternative-show-more.png)


**Before Show more**

This configuration attaches VS Code’s debugger to a Python process rather than asking it to launch one locally. Before connecting to localhost:5678, VS Code runs the task named Start the service container (W1.2). That task starts the Compose service, which exposes port 5678 for debugpy (W1.3). The path mapping connects local files under service to their /app/service copies in the container, so the debugger can match the two locations. Unlike the base configuration, which launched service/main.py locally, this one debugs the containerized service.

**Behind Show more**

The task starts Compose in detached mode, so its completion does not by itself establish that debugpy is ready to accept the connection; the debugger still needs the service to be listening when it attaches.


#### step-W1.3-essens-prepared

Pictures: [step-W1.3-essens-prepared.png](window/dsp195-essens-single-copilot/step-W1.3-essens-prepared.png)


**Before Show more**

Compose builds the image, runs debugpy with the service module, and publishes both ports.

This is the configuration used by the task's Compose command. The build: . setting points to the Dockerfile, covered next. The command starts debugpy listening on port 5678 and runs service.main as a module; the port mappings make the debugger port 5678 and HTTP port 8080 available on the host.

**Behind Show more**

(no Show more)


#### step-W1.3-standard-alternative

Pictures: [step-W1.3-standard-alternative.png](window/dsp195-essens-single-copilot/step-W1.3-standard-alternative.png)


**Before Show more**

The service Compose entry is what the pre-launch task starts (W1.2). Compose builds its image from the current directory; the next step shows the Dockerfile used for that build (W1.4). The container command runs service.main as a Python module under debugpy, which listens on port 5678. The ports entries publish that debugger port and the service’s HTTP port, 8080, to the host; later, service.main passes 8080 to serve (W1.5).

The 0.0.0.0 listener makes debugpy listen on the container’s network interfaces, while the port mapping lets VS Code connect through localhost:5678 as configured in W1.1.

**Behind Show more**

(no Show more)


### dsp195-standard-single-copilot

#### step-W1.1-essens-alternative

Pictures: [step-W1.1-essens-alternative.png](window/dsp195-standard-single-copilot/step-W1.1-essens-alternative.png)


**Before Show more**

Unlike the base configuration, this one attaches VS Code’s debugger to the service instead of launching service/main.py locally. Before connecting to localhost:5678, VS Code runs the pre-launch task; the container’s debugger startup and port publishing are shown in the next steps (W1.2–W1.3). The path mapping lets debugpy match local service files to their container paths, and justMyCode: false allows stepping into code outside the project. Attachment depends on debugpy being ready at the published port; this configuration does not specify a readiness check.

**Behind Show more**

(no Show more)


#### step-W1.1-standard-prepared

Pictures: [step-W1.1-standard-prepared.png](window/dsp195-standard-single-copilot/step-W1.1-standard-prepared.png)


**Before Show more**

The debug configuration asks VS Code to attach to a process that the pre-launch task starts.

The previous configuration launched service/main.py locally; this one uses an attach request and names Start the service container as its pre-launch task. VS Code connects to localhost:5678. The path mapping relates the local service directory to /app/service in the container, so debugger source locations can be matched across the two environments. justMyCode: false allows stepping into code beyond the user's own code.

**Behind Show more**

(no Show more)


#### step-W1.3-essens-alternative

Pictures: [step-W1.3-essens-alternative.png](window/dsp195-standard-single-copilot/step-W1.3-essens-alternative.png)


**Before Show more**

The pre-launch task invokes Compose here to build and start the service container. Its command runs service.main under debugpy, listening on container port 5678; publishing that port lets VS Code’s attach configuration connect from the host. Port 8080 is published for the HTTP server, which listens on that port (W1.6). The next step shows how the image is built (W1.4).

**Behind Show more**

(no Show more)


#### step-W1.3-standard-prepared

Pictures: [step-W1.3-standard-prepared.png](window/dsp195-standard-single-copilot/step-W1.3-standard-prepared.png)


**Before Show more**

Compose builds the image, runs debugpy with the service module, and publishes both ports.

The task's command reaches this Compose configuration. build: . uses the repository root as the build context, and the command runs service.main under debugpy, listening on port 5678 inside the container. The port mappings expose that debug port on the host for the attach configuration and expose the service's port 8080.

**Behind Show more**

(no Show more)

