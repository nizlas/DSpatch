# DSP-199 · What the person sees, before and behind Show more

Real generations at instruction version 12 with the configured provider: Claude, requested `opus`, reported `claude-opus-5-5`. The example is the invented `app/tests/support/synthetic-exec-debug.ts`. Reference blocks (shown as links) are left out. In an Essentials walk from version 12 the Step panel shows no separate summary above the short part, and "Why it matters" is empty; both are noted where they exist in the data. Nothing is edited.

## 1. The loop writer and the profile switch, on the locked plan (W1.2 the pre-launch task; W1.7 the detached start)

### Loop writer, W1.2

**Before Show more** (364 characters)

> The `preLaunchTask` value in the debug configuration names this task by its `label`. The task runs the start script and gives it the container name and debug port as environment variables, which the script reads in the next step. **Because this is an ordinary task that finishes when the script exits, VS Code waits for the script to exit and only then attaches.**

**Behind Show more**

> - **Matching by name:** VS Code finds the task by its exact `label` text. If the label or the `preLaunchTask` value is renamed and the other is not, the task cannot be found.
> - **When the task counts as done:** the task is not marked as a background task, and its `problemMatcher` is empty. VS Code therefore treats it as finished when the script exits, and judges success or failure by the exit code alone. The script's own output is not checked.
> - **Where the port is set:** `DEBUG_PORT` is `5678` here. The same number is written separately in `connect` in the debug configuration and in the ports in compose.yaml. Nothing ties these three places together.
> - **How the script is run:** `command` points straight at the `.sh` file. That only works if the file is executable and the shell can run a bash script. This change sets no Windows-specific variant of the task.

### Profile switch to Essentials (after the run's own Standard), W1.2

**Before Show more** (355 characters)

> This task is what the debug configuration's `preLaunchTask` names: it runs `start-debugger.sh` with `DEV_CONTAINER` and `DEBUG_PORT` set in its environment. Because it is a plain foreground shell task, VS Code waits for the script to exit and attaches only if the exit code is zero. The script's exit is therefore the signal that lets the attach go ahead.

**Behind Show more**

> **What "done" means here.** `isBackground` is not set, so VS Code doesn't watch the output for a ready pattern. It only waits for the process to end. The empty `problemMatcher` turns off output scanning and the prompt asking you to pick a matcher. Anything the script prints just stays in the task terminal. `tasks.json` is new in this change; the base revision has only `launch.json`.
>
> **The exit comes early.** The script's last command is `docker exec -d … debugpy --listen … --wait-for-client`. With `-d`, `docker exec` returns as soon as the process has been started in the container, not when debugpy is listening. So the task can finish, and the attach can start, slightly before the port is open. This is something I noticed in the code, not something I saw happen at runtime. Whether it causes a problem depends on how the debugpy attach handles a refused first connection. That logic isn't in this repository.
>
> **The same values live in several places.**
> - `DEBUG_PORT` is `5678` here, and the attach uses its own `connect.port` of `5678`. Nothing ties the two together, so changing one without the other breaks the attach.
> - Both env values here are the same as the script's built-in fallbacks (`${DEV_CONTAINER:-orders-dev}`, `${DEBUG_PORT:-5678}`). Setting them in the task makes them explicit, but they aren't needed for the default case.

### Loop writer, W1.7

**Before Show more** (269 characters)

> Here debugpy is handed off to run on its own inside the container, and the script ends. **From now on two things run side by side:** the task finishes so VS Code can move on to attach, while debugpy starts listening and holds `orders.main` back until a client connects.

**Behind Show more**

> `-d` makes `docker exec` return as soon as the process has been started in the container. It does not wait for the process to finish. This is the last command in the script, so its exit status becomes the script's exit status, and that decides whether the task succeeded. This status only says whether the process was started. It says nothing about whether debugpy is listening yet, or about whether it is listening at all.
>
> Some consequences of handing off the process this way:
>
> - **Output is lost to the developer.** debugpy and `orders.main` print nothing to the task terminal. If `python -m debugpy` fails at startup, for example because the port is already taken, the task still ends successfully, and the failure only shows when the attach in the next step fails to connect.
> - **Nothing synchronises the two sides.** The script does not wait for the port to open. Whether debugpy is listening by the time VS Code connects depends on timing that this code does not control.
> - **`--listen "0.0.0.0:$PORT"`** binds to all interfaces inside the container. That is needed for the published port from compose (as we saw earlier) to reach it from the host. `$PORT` is the `DEBUG_PORT` value from the task, or 5678 by default.
> - **`--wait-for-client`** stops debugpy from running `orders.main` until the editor connects, so breakpoints near the start of `main` can still be hit.
> - Each run starts a new detached process. The script never checks for or stops one left over from an earlier session.

### Profile switch to Essentials (after the run's own Standard), W1.7

**Before Show more** (358 characters)

> Here the script starts `orders.main` inside the container under a debugpy server and exits right away. The process keeps running in the container, but `orders.main` is held back until a debugger connects to `$PORT`. When the script exits, the pre-launch task is done and VS Code goes on to attach, but nothing makes sure debugpy is already listening by then.

**Behind Show more**

> **What `-d` guarantees.** With `-d`, `docker exec` only reports whether the process could be started in the container. It does not report what happens next. If debugpy fails after starting, the script cannot see it, and `set -euo pipefail` does not help. That covers an import error in `orders.main`, a debugpy that will not start, or a port that is already taken. The process's output is not attached to the task terminal either, so these failures leave no trace there.
>
> **The race with the attach.** The task in `tasks.json` has no background or readiness settings, so VS Code treats it as finished when the script exits. The attach in `launch.json` then connects to `localhost:5678`, which `compose.yaml` publishes to the container. Whether debugpy is listening by that moment depends on timing, and nothing in this change waits for it. If it is not, the attach fails with a connection error. The service stays blocked in `--wait-for-client` until something connects.
>
> **Running it again (my observation, not checked).** The script never stops an earlier debugpy process. Suppose a previous session's process is still in the container, either still waiting or still running `orders.main`. A second run would start another debugpy on the same port. That bind would probably fail, and because of `-d` the failure would not show up. The attach would then reach the old process, if anything.
>
> **Why `0.0.0.0`.** debugpy has to listen on all interfaces inside the container. The published port forwards host traffic to the container's network interface, not to its loopback address.

## 2. The one-call preparation (the product default), whole walk

The definition records `presentation` = `{"profile":"essens","version":12}`, so the Step panel leaves out the step summary.

### W1.1 · The attach configuration

**Before Show more** (180 characters; summary not shown: "Launch becomes attach"; why: empty)

> The configuration no longer starts Python itself. It attaches to a debugpy server on `localhost:5678`, and before that, `preLaunchTask` makes VS Code run a task found by its label.

**Behind Show more**

> The old configuration launched `orders.main` on the host in the integrated terminal. That way of running the service is gone, and no configuration replaces it.
>
> `pathMappings` maps the workspace folder to `/workspace`, the bind mount in `compose.yaml`. This lets breakpoints set in host files match the paths that the code inside the container reports.

### W1.2 · The task that runs the script

**Before Show more** (182 characters; summary not shown: "Shell task with container and port"; why: empty)

> The task runs the script as a shell command and passes the container name and the debug port in as environment variables. VS Code starts the attach only after this task has finished.

**Behind Show more**

> The task is not marked `isBackground`, so VS Code waits for the script to exit. That is why the script must return quickly, which is what the detached start in a later step does.
>
> The command runs the script file directly. The diff adds `scripts/start-debugger.sh` with mode `100644`, without the executable bit. Unless the bit is set some other way, a shell on Linux or macOS refuses to run the file directly.

### W1.3 · Stop early if the container is down

**Before Show more** (150 characters; summary not shown: "Container running check"; why: empty)

> The script asks Docker whether the container is running and stops with a hint if it is not. Because the task then fails, the attach does not go ahead.

**Behind Show more**

> `docker inspect` errors are discarded, so a container that does not exist gives the same message as one that is stopped. `set -euo pipefail` near the top makes any later failing `docker exec` stop the script as well.

### W1.4 · Install debugpy on first use

**Before Show more** (112 characters; summary not shown: "One-time debugpy install"; why: empty)

> If `import debugpy` fails inside the container, the script installs debugpy with pip. Later runs skip this step.

**Behind Show more**

> The install lives only in the container's writable layer. Recreating the container (for example with `docker compose down`) removes it, and the next run installs it again. The install needs network access from the container.

### W1.5 · Start the service under debugpy, detached

**Before Show more** (191 characters; summary not shown: "Detached debugpy start"; why: empty)

> `docker exec -d` starts `orders.main` under debugpy and returns at once, so the script and the task finish. Thanks to `--wait-for-client`, debugpy holds `main` back until the editor connects.

**Behind Show more**

> Because the start is detached, the script never learns whether debugpy actually started or began listening. Its output stays inside the container. Two cases the code allows:
>
> - The task finishes as soon as `docker exec -d` returns, which can be before debugpy is listening. The attach can then hit a port that is not open yet. Nothing in the script waits for the port.
> - If a debug session from an earlier run is still alive in the container, the new process cannot bind port 5678 (and the service cannot bind port 8000). That failure is invisible here, because the error goes to the detached process.

### W1.6 · The editor attaches

**Before Show more** (167 characters; summary not shown: "Attach through the published port"; why: empty)

> Once the task is done, VS Code connects to `localhost:5678`. That port reaches debugpy only because `compose.yaml` publishes container port 5678 on the same host port.

**Behind Show more**

> debugpy listens on `0.0.0.0` inside the container, which is what makes the published port reachable. After the editor connects, `main` runs and serves HTTP on port 8000, which compose also publishes.

### W2.1 · Create and hand over the logs folder

**Before Show more** (204 characters; summary not shown: "chown of the folder only"; why: empty)

> Before starting the service, the script creates `/workspace/logs` as root and changes the owner of the folder to the host user's IDs. Only the folder changes owner, not files that are created in it later.

**Behind Show more**

> `id -u` and `id -g` run on the host, inside the script, not in the container. Owning the folder lets the host user add, rename and delete files in it. It does not change who owns a file that a root process creates there.
>
> On Docker Desktop (Windows or macOS), file ownership on bind mounts is handled by the file-sharing layer, so this step may have no visible effect there.

### W2.2 · The service writes its log as root

**Before Show more** (274 characters; summary not shown: "orders.log created by root"; why: empty)

> `main` opens `orders.log` in that folder. Because `docker exec` runs as root by default, the file is created owned by root. So, going by the code, the log file itself is not editable by the host user on a native Linux bind mount, which is what the script's comment promises.

**Behind Show more**

> The `LOG_DIR.mkdir(exist_ok=True)` call here makes the script's `mkdir` redundant, but harmless. The script would need to start the service as the host user, for example with `docker exec -u`, or change the owner of the files afterwards, for the comment to hold for the files themselves.

### W3.1 · Port in the task, launch configuration, script and compose file

**Before Show more** (267 characters; summary not shown: "Four copies of 5678"; why: empty)

> The task's `DEBUG_PORT` reaches the script, but the attach configuration hard-codes 5678 and `compose.yaml` publishes only 5678. Changing `DEBUG_PORT` alone would make debugpy listen on a port that the editor never connects to and that the container does not publish.

**Behind Show more**

> The container name is in the same situation. The task's `DEV_CONTAINER` must match `container_name` in `compose.yaml`, and the script's error message tells the user to start the `dev` service by name. The values agree today.

## 3. The walk loop with its reviewer, whole walk (the reviewer accepted at once)

The definition records `presentation` = `{"profile":"essens","version":12}`, so the Step panel leaves out the step summary.

### W1.1 · The debug configuration now attaches

**Before Show more** (237 characters; summary not shown: "The configuration changes from launching orders.main locally to attaching to port 5678, after a pre-launch task."; why: empty)

> This is where F5 starts. The configuration no longer starts `orders.main` on the host. It now **attaches** to a debugger that must already be listening, and its `preLaunchTask` names the task that sets that listener up before the attach.

**Behind Show more**

> In the base version, this file's only configuration was "Run orders locally". It used `request: "launch"` with `module: "orders.main"` and `console: "integratedTerminal"`, so the editor started the service itself on the host. That configuration has been replaced, not added to, so the change leaves no local-run configuration.
>
> With `request: "attach"`, the editor starts no process. It only connects. Something else has to provide the debugpy listener. The `preLaunchTask` value, "Start debugger in dev container", has to match a task label exactly, and the editor runs that task before it tries to attach. In the next step, that label leads to the task in the repository's tasks file. `connect` and `pathMappings` are covered in a later step.

### W1.2 · The pre-launch task runs the script on the host

**Before Show more** (301 characters; summary not shown: "A shell task with the matching label runs start-debugger.sh with DEV_CONTAINER and DEBUG_PORT set."; why: empty)

> This is the task that `preLaunchTask` names, matched by its label. It runs `start-debugger.sh` in a shell **on the host**, not in the container, and passes the container name `orders-dev` and port `5678` as `DEV_CONTAINER` and `DEBUG_PORT`. The editor waits until the command exits before it attaches.

**Behind Show more**

> - **When the editor counts the task as done.** `problemMatcher: []` means the editor doesn't scan the output for a "ready" signal, so it treats the task as finished when the command exits. The script therefore has to return instead of keeping the service in the foreground. Its last line does that by starting debugpy detached, covered in a later step. The exit code is the only success or failure signal. Walk W2 follows the failure case.
> - **Two values that must match elsewhere.** `DEV_CONTAINER` and `DEBUG_PORT` repeat values that appear in other places: the container name from the compose file and the port in the attach configuration's `connect`. The script also has its own defaults for both, shown in the next step.
> - **Point to check: how the script is started.** `command` points straight at the script file. The script starts with `#!/usr/bin/env bash`, so starting it directly needs the file's executable bit on the host. If the script is committed with mode 100644 (not executable), a fresh checkout may refuse to run it until the mode is fixed or the command calls `bash` explicitly. This is a reading of the configuration; it hasn't been observed running.

### W1.3 · Settings and the running-container guard

**Before Show more** (299 characters; summary not shown: "The script reads the container and port with defaults and stops if the container is not running."; why: empty)

> Still on the host, the script picks up the container name and port, falling back to `orders-dev` and `5678` when they aren't set. It then makes sure that container is running before it touches it. In this walk the container is running, so the script goes on; walk W2 follows the case where it isn't.

**Behind Show more**

> - **Strict mode.** `set -euo pipefail` makes the script stop at the first failing command, at any use of an unset variable, and at any failure inside a pipeline. A failed `docker exec` later on therefore ends the task with a non-zero exit, which the editor sees.
> - **How the guard works.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false` for a container that exists. For a missing container it fails, with its error output thrown away. Anything other than exactly `true` takes the exit-1 branch. Because the check sits inside an `if` test, the failing `docker inspect` doesn't trigger `set -e`; the branch handles it.
> - **One port, four places.** The defaults repeat the values the task already sets, so these two settings matter only when the script runs outside the task. The port appears in four places that must agree: the task's `DEBUG_PORT`, this default, the `5678:5678` mapping in the compose file (lines 8–9 of `compose.yaml` on the target side), and `connect.port` in the attach configuration. The container name must also match `container_name: orders-dev` there.

### W1.4 · debugpy is installed into the container on demand

**Before Show more** (254 characters; summary not shown: "If importing debugpy fails in the container, pip installs it there."; why: empty)

> The script makes sure debugpy is available **inside the container**, which runs the plain `python:3.12-slim` image without it. It installs debugpy only when the import check fails, so normally just the first run in a fresh container pays for the install.

**Behind Show more**

> Both `docker exec` commands run the container's Python, not the host's. The host doesn't need debugpy for this, and its Python environment isn't involved.
>
> The install lands in the container's own filesystem, in the image's site-packages, not under the bind-mounted `/workspace`. The repository contains no requirements file or Dockerfile that adds debugpy. So the install lasts as long as that container exists: it survives stopping and starting the same container, but a recreated container (for example after `docker compose down`) installs it again on the next F5. That install needs network access from the container. If it fails, `set -e` from the previous step ends the script with an error before anything is started.

### W1.5 · The log folder is created and given to the host user

**Before Show more** (352 characters; summary not shown: "The script creates /workspace/logs in the container and chowns it to the host user's uid:gid."; why: empty)

> The script creates the log folder inside the container and **makes the host user its owner**. Because `/workspace` is the bind-mounted repository, the folder also shows up in the developer's checkout. This sets the owner of the folder only; whether the log file the service later writes there can be edited from the host comes up again in a later step.

**Behind Show more**

> `$(id -u):$(id -g)` is expanded by the host shell before `docker exec` starts. So `chown` inside the container receives the host user's numeric ids, not the container user's.
>
> The container runs as root because the compose file sets no `user:`, and `python:3.12-slim` defaults to root. That is why the folder would otherwise be root-owned.
>
> The comment says files the service writes there "stay editable". The code doesn't give that guarantee. `chown` changes the folder alone, and files created inside it later get the creating process's owner, which here is root. What the folder's owner can do with those files depends on their permission bits, so the question stays open until `main()` writes `orders.log`.
>
> On Docker Desktop, how bind mounts handle file ownership can differ from Linux. This is a general point; the repository doesn't show which setup is used.

### W1.6 · The service starts detached under debugpy

**Before Show more** (304 characters; summary not shown: "docker exec -d starts debugpy with --wait-for-client in the container and returns at once; the script and the task end."; why: empty)

> This is where the work leaves the script. `docker exec -d` starts debugpy as a separate process **inside the container**, and debugpy holds back `orders.main` until a debugger connects. `docker exec` returns immediately, so the script exits successfully and the editor counts the pre-launch task as done.

**Behind Show more**

> After this line nothing on the host is tied to the debugpy process. It keeps running in the container when the host shell exits. debugpy listens on `0.0.0.0` at `$PORT` inside the container, so it is reachable through the published port shown in the next step. With `--wait-for-client`, it runs `orders.main` only once a client attaches.
>
> `docker exec -d` reports success once the process has been started, not once debugpy is listening or has started without error. Three points follow from the code and are worth checking; they are not observed behaviour:
>
> - **Timing.** Nothing in the script waits for the port to accept connections. The editor may try to attach before debugpy listens. Whether that fails or is retried depends on the editor's attach behaviour.
> - **A second F5.** The script doesn't stop or look for an earlier debugpy process. If an earlier run is still alive, it still holds `$PORT` and, once `main()` runs, port 8000 as well (`serve(port=8000)` in `orders/main.py` on the target side). A new start would then fail to bind, or the editor might attach to the old process.
> - **Silent failures.** Any error from the detached process, such as a bind failure or an import error, appears neither in the task's output nor in its exit code.

### W1.7 · How localhost:5678 and /workspace reach the container

**Before Show more** (279 characters; summary not shown: "compose.yaml publishes port 5678 and bind-mounts the repository at /workspace, which the attach relies on."; why: empty)

> This unchanged compose service is what the debugging setup relies on. It publishes the container's port 5678 on the host, so the editor's `localhost:5678` reaches debugpy, and it **mounts the repository at `/workspace`**, so the container runs the same files the developer edits.

**Behind Show more**

> How each setting is used by the earlier steps:
>
> - `container_name: orders-dev` gives the fixed name that the task's `DEV_CONTAINER` and the script's default use. A container started under another name fails the running-container check.
> - `working_dir: /workspace` is the default directory for `docker exec`. Python's `-m` puts that directory on the import path, which is why `-m orders.main` finds the `orders` package in the mounted repository.
> - `command: sleep infinity` only keeps the container alive. The developer starts it once with `docker compose up -d dev`, and the script then adds processes to it.
> - The `"8000:8000"` mapping publishes the port that `main()` serves on, so the running service can be reached from the host too.
>
> The base revision already had both port mappings and the mount. This change relies on them rather than adding them.

### W1.8 · The editor attaches and maps paths

**Before Show more** (344 characters; summary not shown: "After the task, the editor connects to localhost:5678 and maps the workspace folder to /workspace."; why: empty)

> Once the task has finished, the editor connects to `localhost:5678`, which the published port forwards to debugpy in the container. `pathMappings` translates between the editor's `${workspaceFolder}` and the container's `/workspace`, **the same pairing as the bind mount**, so breakpoints set in host files land on the files the container runs.

**Behind Show more**

> The translation works in both directions. Breakpoints in a host file are sent to debugpy as `/workspace/...` paths, and stack frames that debugpy reports under `/workspace/...` open as the matching host files. The mapping is correct only while `${workspaceFolder}` is the folder that holds the compose file, since the mount's `.` is the repository root. If the editor opens a parent or child folder, the mapping no longer matches the mount and breakpoints can go unbound.
>
> Once the editor attaches, debugpy stops waiting and runs `orders.main` inside the container. The next step follows that.

### W1.9 · main() runs in the container and writes the log

**Before Show more** (395 characters; summary not shown: "The unchanged main() creates /workspace/logs if needed, logs to orders.log and serves on port 8000."; why: empty)

> This is the service itself, running in the container process that debugpy started once the editor attached. `main()` creates the log folder if it doesn't exist, writes `orders.log` into it, and serves HTTP on port 8000, which the compose file publishes. Here the question from the log-folder step comes back: **the host user owns the folder, but the service, running as root, creates the file**.

**Behind Show more**

> `LOG_DIR.mkdir(exist_ok=True)` would create `/workspace/logs` without the script's help. So the script's `mkdir` matters only so that its `chown` has a folder to act on.
>
> `logging.basicConfig(filename=...)` opens `orders.log` from inside the container process, so the file gets that process's owner, not the folder's. Whether the developer can edit it from the host depends on the file's own permission bits and on how the bind mount maps ownership, and neither is set anywhere in this repository. Owning the folder lets the host user rename or delete entries in it. That isn't the same as being able to write into a root-owned file. The script's comment says the files "stay editable", and that claim rests on this distinction.
>
> `serve(port=8000)` runs `HTTPServer(...).serve_forever()` (`orders/http.py` on the target side), so the process keeps running until something stops it. That makes the earlier question about a second F5 relevant while this process is alive.

### W2.1 · The guard fails and the script exits 1

**Before Show more** (250 characters; summary not shown: "docker inspect gives no "true", so the script prints how to start the container and exits with status 1."; why: empty)

> This is the same guard as in the first walk, now with the container stopped or missing. The script prints how to start the container and exits with status 1 before it touches the container, so **the pre-launch task fails** and no debugger is started.

**Behind Show more**

> For a stopped container, `docker inspect` prints `false`. For a missing one, it fails, and `2>/dev/null` discards its error. Either way the result isn't `true`.
>
> The same branch also catches cases the message doesn't describe, because the discarded error was the only clue:
>
> - the Docker daemon isn't reachable;
> - `docker` isn't installed on the host;
> - the container runs under a different name than `DEV_CONTAINER`.
>
> In all of these the developer sees the same hint to run `docker compose up -d dev`.
>
> The message goes to stderr in the task's terminal, and the exit code is the only signal the editor gets. The next step shows what the editor does with it.

### W2.2 · The failed pre-launch task stops the attach

**Before Show more** (369 characters; summary not shown: "The task's non-zero exit is reported back to the debug configuration that required it."; why: empty)

> Back in the editor, the pre-launch task has ended with exit code 1. What happens next is decided by the editor, not by code in this repository. Usually it reports the failed task and doesn't attach, so **the developer has to start the container and press F5 again**. The base "Run orders locally" configuration could never fail this way, because it needed no container.

**Behind Show more**

> Because the task has `problemMatcher: []`, the editor has nothing structured to show. The failure appears only as the exit code and the script's message in the task terminal, which tells the developer to run `docker compose up -d dev`.
>
> Editors commonly let the user debug anyway after a failed pre-launch task. If the developer does that here, the attach to `localhost:5678` has nothing to connect to: the container that would publish the port isn't running, and no debugpy was started in it.

## 4. Standard and Teacher on the locked plan, first part / behind Show more (characters)

| Text | v10 baseline (DSP-196) | v12 (now) |
|---|---|---|
| writer-standard-W1.2 | 1294 / 811 | 1256 / 736 |
| writer-standard-W1.7 | 1165 / 982 | 892 / 1489 |
| writer-pedagog-W1.2 | 1759 / 1450 | 1704 / 1229 |
| writer-pedagog-W1.7 | 2292 / 1297 | 1752 / 1586 |
| present-pedagog-W1.2 | 3098 / 1952 | 2215 / 1651 |
| present-pedagog-W1.7 | 2906 / 1977 | 3135 / 1906 |
