# DSP-198 · Essentials, A against B

The loop writer on one locked plan (the DSP-196 plan of the invented example `app/tests/support/synthetic-exec-debug.ts`), Claude, requested `opus`, reported `claude-opus-5-5` for every call. **A** is the product's prompt at instruction version 11; **B** is the same prompt with Essentials' pedagogical instruction replaced by the one writing task (`compare/prompts/` holds both). The visible text is the planner's step summary, which the Step panel shows first in every profile, then the writer's first part; the deepening is behind Show more. Nothing is edited.

## W1.2 · The pre-launch task runs the script (a simple configuration step)

**The planner's brief (A: an instruction; B: shown as notes):**

> The configuration reaches this task through its `preLaunchTask` value, which matches this `label` exactly. Explain that the task is an ordinary shell task, not a background task, and has an empty `problemMatcher`. VS Code therefore treats the task as finished when the script exits and judges it by the exit code. Then it attaches. Point out that `DEV_CONTAINER` and `DEBUG_PORT` are passed here and that the script reads them next.

### A · the product's prompt

#### Sample 1

**Before Show more** (the summary, then the first part)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> This task is the link between the editor and the container. VS Code finds it because the configuration's `preLaunchTask` names this `label` exactly, and the task is new in this change. It does one thing: it runs `start-debugger.sh` with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` added to its environment. The script reads both values in the next step (W1.3).
> 
> **VS Code attaches only after this task has finished, and only if it succeeds.** This is an ordinary shell task, not a background task, so VS Code treats it as finished when the script exits. The empty `problemMatcher` means no output is scanned for errors, so the exit code alone decides success. A non-zero exit means no attach; W2 follows that case.

**Behind Show more**

> The port appears in three places, and nothing links them. It is the value of `DEBUG_PORT` here, the `connect.port` in the debug configuration, and the published port in the compose file. If you change one, you have to change the others by hand. W1.8 comes back to this.
> 
> Two consequences follow from what is written here:
> 
> - **The script is run directly.** `command` points at the script file and gives no interpreter. So the script must be executable and must run in a shell that understands its `#!/usr/bin/env bash` line. On a Linux or macOS host that is normal. A Windows host with a default shell would need more setup, and nothing in the change provides it.
> - **The script must exit soon.** VS Code waits for the script to exit before it attaches. The script can exit before the service is ready because it starts the service detached (W1.7), and that is why this works.

#### Sample 2

**Before Show more** (the summary, then the first part)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> This task is new in this change. The debug configuration finds it through its `preLaunchTask` value, which must match this `label` exactly. The task runs one script, `start-debugger.sh`, and puts two values into its environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script reads these two values in the next step (W1.3).
> 
> This is an ordinary shell task: it isn't marked as a background task. **VS Code treats the task as finished when the script exits, and the exit code decides what happens next.** With exit code 0, VS Code goes on to attach. With any other code, the task counts as failed, which is what W2 follows. The empty `problemMatcher` means VS Code doesn't read the script's output for errors, so the exit code is the only result it uses.

**Behind Show more**

> This timing only works because the script ends quickly, as later steps show (W1.7). It starts debugpy in the background and exits straight away. A shell task that kept running would hold back the attach.
> 
> The port is written down separately in three places: here, in `connect` in the debug configuration, and in the compose service. Nothing makes them match except keeping them the same by hand. The script's defaults (W1.3) are the same values as here, so if this `env` block were removed, nothing would change.
> 
> `command` is the script's path run through the shell. On a host whose default shell can't run a bash script directly, this task would need extra setup. Nothing here checks for that.

### B · the replacing writing task

#### Sample 1

**Before Show more** (the summary, then the first part)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> This task is the work the debug configuration from W1.1 asks for before it attaches. VS Code finds it because the configuration's `preLaunchTask` matches this task's `label` exactly. The task is new in this change; there was no tasks file before.
> 
> It is a plain `shell` task: VS Code runs `start-debugger.sh` and passes two values to the script as environment variables, **`DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`)**. The script reads them in the next step.
> 
> The task is not marked as a background task, and its `problemMatcher` is empty. VS Code therefore waits until the script exits and then decides from the exit code whether to go on to the attach. The script exits quickly because its last command starts the service detached (W1.7). The attach that follows is W1.8; what happens when the script fails is W2.
> 
> The port appears twice: here as `DEBUG_PORT`, and again as the attach target in the configuration's `connect`. Nothing in these files ties the two values together, so changing one means changing the other by hand.

**Behind Show more**

_(empty)_

#### Sample 2

**Before Show more** (the summary, then the first part)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> The debug configuration's `preLaunchTask` names this task by its exact `label`, "Start debugger in dev container", so VS Code runs this task before it tries to attach. The task is new in this change. It is a plain `shell` task that runs the `start-debugger.sh` script and passes two environment variables to it: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`.
> 
> **VS Code waits for the script to exit, then looks at its exit code before it attaches.** The task has no `isBackground` flag and an empty `problemMatcher`, so it counts as finished when the script finishes. A non-zero exit code stops the launch, as W2 shows. This works only because the script, in W1.7, starts the service detached and exits instead of keeping it in the foreground.
> 
> The port appears in two places. The script receives `DEBUG_PORT` from here, but the configuration's `connect` has its own fixed `5678`, so changing one doesn't change the other. In the next step the script reads both variables. If either is missing, it falls back to the same values: `orders-dev` and `5678`.

**Behind Show more**

_(empty)_

## W1.7 · The service starts detached under debugpy (interacting mechanisms and a decisive condition)

**The planner's brief (A: an instruction; B: shown as notes):**

> Explain `-d`: `docker exec` returns at once, and the debugpy process goes on in the container on its own. This is a handoff to another process. The script exits and the task finishes, while debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back until a client connects. Its output and any startup error do not reach the task terminal. The reader takes from this step that two things now run in parallel: VS Code moving on to attach, and debugpy starting to listen in the container.

### A · the product's prompt

#### Sample 1

**Before Show more** (the summary, then the first part)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> In this last command, the script hands the service over to a separate process in the container. With `-d`, `docker exec` starts `python -m debugpy … -m orders.main` and returns straight away without waiting for it. The script then ends, and because the task is an ordinary shell task (W1.2), VS Code counts the pre-launch task as finished and successful.
> 
> Inside the container, debugpy runs by itself:
> 
> - it listens on `0.0.0.0:$PORT`, so it accepts connections that come in through the compose port mapping (W1.4), not only from inside the container;
> - `--wait-for-client` makes it hold `orders.main` back. The service's own code does not start until a debugger has attached.
> 
> **From this point two things run at the same time:** VS Code goes on to attach (next step), and debugpy starts up and begins listening in the container. Nothing in the script or the task waits for debugpy to be ready first.

**Behind Show more**

> A detached exec has two consequences for what the developer sees:
> 
> - **Errors are hidden from the task.** The script's exit code only says that `docker exec -d` could start the process. If debugpy fails afterwards (for example, the port is already taken or `orders.main` cannot be imported), the task still counts as successful. The process's output does not appear in the task terminal either. The problem would only show up later, as an attach that fails.
> - **Earlier runs are not stopped.** The script never ends a debugpy process left over from a previous run. If such a process still holds the port, the new one cannot listen on it. This is my reading of the code, not something observed running.
> 
> `-m orders.main` can find the package because the compose service sets `working_dir: /workspace`, which is the bind-mounted repository (W1.4). `docker exec` uses that directory by default.

#### Sample 2

**Before Show more** (the summary, then the first part)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the script's last command, and the point where **the work passes to another process**. With `-d`, `docker exec` starts the command inside `orders-dev` and returns at once. It doesn't wait for debugpy. The script then reaches its end, so it exits with 0 and the pre-launch task from W1.2 counts as successful.
> 
> From here on, two things run in parallel:
> 
> - **In VS Code:** the task is finished, so the editor moves on to attach (next step).
> - **In the container:** debugpy starts and listens on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it doesn't run `orders.main` until a debugger connects.
> 
> Nothing makes the first wait for the second. The task finishing tells you only that the `docker exec` command was accepted. It doesn't tell you that debugpy is already listening, or that it started at all. Also, because the process is detached, debugpy's output and any startup error don't appear in the task terminal.

**Behind Show more**

> Some details that link this command to the setup you've already seen:
> 
> - **Listening on `0.0.0.0`:** debugpy listens on all of the container's network interfaces, not just its own loopback. That matters because the editor will reach it from outside through the published port in compose (W1.4).
> - **Port value:** `$PORT` is the `DEBUG_PORT` value from the task environment, or `5678` if that variable isn't set (W1.3). The compose port mapping is fixed at `5678:5678`. So if `DEBUG_PORT` were changed only in the task, debugpy would listen on a port that compose doesn't publish.
> - **How `orders.main` is found:** `-m orders.main` is resolved from the container's working directory. In compose, `working_dir` is `/workspace`, which is the bind-mounted repository. So debugpy runs the code from the host's working tree, the same files the editor shows.
> - **Ownership of the process:** the service process isn't tied to the task or to the debug session. As far as this script shows, nothing stops it later. Whether the debugpy process ends when the editor disconnects depends on debugpy's own behaviour, which this code doesn't settle.

### B · the replacing writing task

#### Sample 1

**Before Show more** (the summary, then the first part)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the last command the script runs, and the point where control passes from the script to the container. `docker exec -d` starts `python -m debugpy` inside the container and **returns at once**, without waiting for that process. The script then ends with exit code 0. Because the task has no background setting, VS Code waited for the script to exit, and now treats the pre-launch task as successful.
> 
> Inside the container, debugpy keeps running on its own:
> 
> - `--listen "0.0.0.0:$PORT"` makes it listen on every interface of the container, not only on its own loopback address. The editor's connection reaches it through the port that `compose.yaml` publishes, as shown in W1.4.
> - `--wait-for-client` holds `orders.main` back. None of the service's code runs until a debugger attaches.
> 
> From here on, two things happen at the same time: VS Code moves on to attach (next step), and debugpy starts up in the container. Nothing in the script waits until debugpy is actually listening. If the editor connects before the port is open, that attach could fail; how likely that is cannot be told from the code. Since the process is detached, its output and any startup error (for example, a broken `orders.main` import) do not appear in the task's terminal. The task's success only means `docker exec` started the process. It does not show that debugpy came up.

**Behind Show more**

_(empty)_

#### Sample 2

**Before Show more** (the summary, then the first part)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the script's last command, and it hands the work to another process. `docker exec -d` starts `python -m debugpy` inside `orders-dev` and returns right away. Nothing in the script waits for that process, so the script ends and the pre-launch task finishes.
> 
> Inside the container, debugpy listens on `0.0.0.0:$PORT`. That is the port compose publishes to the host (W1.4). Because of `--wait-for-client`, debugpy holds `orders.main` back until a debugger connects. The module runs from the container's `/workspace` working directory, which is the bind-mounted repository.
> 
> **From here, two things run independently:**
> - VS Code sees that the task has ended and goes on to attach (next step).
> - debugpy is still starting up in the container.
> 
> The script never checks that debugpy is actually listening before it exits. With `-d`, debugpy's output and any startup error (for example, the port is already taken) also don't appear in the task terminal. The task's exit code only shows whether `docker exec` managed to start the process, not whether the debugger came up.

**Behind Show more**

> The task doesn't set `isBackground`, so VS Code treats it as an ordinary task and waits for the script to exit before it attaches. That makes the detach necessary. Without `-d`, `docker exec` would block on a debugpy that is waiting for a client, the task would never end, and the attach would never start.
> 
> The cost is a possible race. Nothing makes debugpy listen before VS Code tries to connect. In practice debugpy probably starts fast enough, but the code doesn't guarantee it. If the attach fails, the debugpy process left in the container is the place to look.
