# DSP-196 round 2 · Essentials with the planner's brief as orientation

The Essentials writer on the same locked plan, steps and model (Claude, reported `claude-opus-5-5`). The visible text is the planner's step summary, shown first in every profile, followed by the writer's first part; the deepening is behind Show more. Reference blocks are left out. A and D are round 1's answers; B and C are new. Nothing is edited.

## W1.2 · The pre-launch task runs the script (simple)

**The planner's brief, current (A, D):**

> The configuration reaches this task through its `preLaunchTask` value, which matches this `label` exactly. Explain that the task is an ordinary shell task, not a background task, and has an empty `problemMatcher`. VS Code therefore treats the task as finished when the script exits and judges it by the exit code. Then it attaches. Point out that `DEV_CONTAINER` and `DEBUG_PORT` are passed here and that the script reads them next.

**The planner's brief, oriented (B, C):**

> The configuration reaches this task by name. The reader should understand how VS Code treats the task: it waits for the script to exit and uses the exit code to decide whether the attach goes ahead. That makes the script's exit the gate for the rest of the walk. The reader takes on to the script the two values the task passes in its environment.

**The planner's notes from the code (B, C), given to the writer as material:**

> Target .vscode/tasks.json line 5: the label "Start debugger in dev container" exactly matches the preLaunchTask value at .vscode/launch.json (target) line 8, and that match is how VS Code finds the task. Line 6: type "shell". The task has no isBackground setting, so it is not a background task and VS Code considers it finished when the command exits. Line 7: the command is ${workspaceFolder}/scripts/start-debugger.sh, run directly, so it depends on the host shell being able to execute it (the bash shebang at scripts/start-debugger.sh line 1 and the executable bit). tasks.json defines no Windows-specific variant. Line 8: options.env sets DEV_CONTAINER=orders-dev and DEBUG_PORT=5678 for the script's environment. Line 9: problemMatcher is empty, so VS Code scans no output for errors and judges the task by exit code alone. A non-zero exit makes VS Code report the pre-launch task as failed (see W2.2). The values in this file repeat values found elsewhere: the container name is also in compose.yaml line 4, and the port is also in compose.yaml line 9 and .vscode/launch.json line 9.

### A · current brief, product readers (round 1 baseline)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> The debug configuration's `preLaunchTask` reaches this task through its `label`, which must match exactly. This task is new in this change, and so is the whole `tasks.json`.
> 
> It is an ordinary `shell` task that runs `start-debugger.sh`. It is not marked as a background task, so **VS Code counts it as finished when the script exits, and the exit code decides whether the debug session goes on to attach.** The empty `problemMatcher` means VS Code does not scan the output for errors, so the exit code is the only signal.
> 
> The task passes the container name and the debug port to the script as the environment variables `DEV_CONTAINER` and `DEBUG_PORT`. The script reads them in the next step (W1.3).

**Behind Show more**

> Because the task ends when the script exits, the attach happens as soon as the script's last command returns. W1.7 shows that this last command starts debugpy detached, so the task does not wait for debugpy to be listening.
> 
> The values passed here are the same as the script's built-in defaults (`orders-dev` and `5678`). They have to agree with the container name and port in compose (W1.4) and with the `connect` port in the debug configuration. Nothing links these settings, so each one has to be kept in step by hand.
> 
> `command` runs the script file directly. That depends on the file being executable and on its `#!/usr/bin/env bash` line finding bash on the host. The repository doesn't show how this works for a developer whose VS Code task shell is not a POSIX shell, such as on Windows.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> VS Code finds this task because its `label` matches the configuration's `preLaunchTask` string exactly (W1.1). The task is new in this change. It is the only place where the debug start runs any code of its own.
> 
> It is an ordinary `shell` task that runs `start-debugger.sh`. It is not marked as a background task, and its `problemMatcher` is empty. **So VS Code waits for the script to exit and judges the task by its exit code alone.** A zero exit code lets the attach go ahead. A non-zero exit code counts as a failed pre-launch task, which is the case W2 follows.
> 
> The task passes the container name (`DEV_CONTAINER=orders-dev`) and the debug port (`DEBUG_PORT=5678`) to the script as environment variables. The script reads them in the next step.

**Behind Show more**

> The port 5678 is written here and again in the configuration's `connect` (W1.1). Nothing in the configuration reads it from this task, so the two values match only because both say 5678.
> 
> `command` names the script by path and does not call `bash`. The task therefore relies on the script being executable and on its `#!/usr/bin/env bash` line. From the files alone you cannot tell whether the repository sets the executable bit.

### B · oriented brief, product readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The pre-launch task runs the start script with the container name and debug port, and VS Code waits for it to finish before attaching.*
> 
> This task is new in this change. The debug configuration's `preLaunchTask` finds it by matching its `label` exactly, so the two strings must stay identical.
> 
> VS Code runs `start-debugger.sh` as an ordinary shell task and waits for it to exit before it attaches. There is no `isBackground`, so the task counts as finished only when the script exits. `problemMatcher` is empty, so VS Code doesn't read the output for errors and decides by the exit code alone. **The script's exit code decides whether the attach in W1.8 happens:**
> - exit 0: VS Code goes on to connect.
> - non-zero exit: the pre-launch task is reported as failed (W2 follows that path).
> 
> The task passes two values to the script through its environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The next step shows how the script reads them.

**Behind Show more**

> - **The values are written out separately in each file.** The container name also appears as `container_name` in `compose.yaml`. The port also appears in the attach target `connect` and in the port publishing in `compose.yaml`. Nothing links these copies. If you change `DEBUG_PORT` here and nowhere else, debugpy listens on a container port that compose doesn't publish, and VS Code still connects to 5678.
> - **The script needs a POSIX shell.** The command runs the script file directly, so it relies on the `bash` shebang and the executable bit. `tasks.json` has no Windows variant, so the task assumes a host that can run bash scripts.
> - **The script falls back to the same defaults.** It uses `orders-dev` and `5678` if these variables are unset, so running it by hand outside the task does the same thing.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The pre-launch task runs the start script with the container name and debug port, and VS Code waits for it to finish before attaching.*
> 
> This task is new in this change: before, there was no tasks file. The debug configuration finds it through its `label`, which must match the `preLaunchTask` string exactly.
> 
> VS Code runs the task before it attaches. It is an ordinary shell task, not a background task, so **VS Code waits for `start-debugger.sh` to exit and uses its exit code to decide whether the attach goes ahead**. `problemMatcher` is empty, so VS Code doesn't read the script's output for errors. The exit code is the only signal. From here on, whatever makes the script exit with an error stops the session before it attaches. W2 follows that path.
> 
> The task sets two values in the script's environment and passes them on to the next step:
> - `DEV_CONTAINER=orders-dev` names the container to work in.
> - `DEBUG_PORT=5678` sets the port debugpy will listen on.

**Behind Show more**

> **Repeated values.** Both values also appear in other files, and nothing links the copies. The container name is set by `container_name` in `compose.yaml` (target, line 4). The port appears in the port mapping in `compose.yaml` (target, line 9) and as a literal in the configuration's `connect` block, which we saw in W1.1. If you change `DEBUG_PORT` here and nowhere else, debugpy listens on a port that compose doesn't publish and the attach doesn't target. The script falls back to the same two values when the variables are unset (W1.3), so running it by hand gives the same result.
> 
> **Platform.** `command` points at the script file itself. The host shell has to run it through its `#!/usr/bin/env bash` shebang, and that requires the file to be executable. The task has no `windows` variant, so on a Windows host whose default terminal is PowerShell or cmd, the command probably won't run as written. In that case the task fails and no attach happens.

### C · oriented brief, proposed readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The pre-launch task runs the start script with the container name and debug port, and VS Code waits for it to finish before attaching.*
> 
> VS Code finds this task through the label: the `preLaunchTask` value from W1.1 must match `label` exactly. The task runs `start-debugger.sh` as a shell command and gives it two environment variables, `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. In the next step the script reads these as its container name and port. The file is new in this change, since the old configuration had no pre-launch task.
> 
> **The script's exit code decides whether the attach happens.** VS Code treats the task as finished when the script exits, because no `isBackground` is set. `problemMatcher` is empty, so VS Code doesn't check the output for errors and goes only by the exit code. If the script exits with 0, VS Code goes on to attach (W1.8). If it exits with anything else, VS Code reports the pre-launch task as failed (W2.2).

**Behind Show more**

> - **The task is finished before the service is running.** The script's last command is a detached `docker exec -d` (W1.7), so the task succeeds once debugpy has been started, not once it is listening. This step does not wait for the service to be ready.
> - **The script runs directly, without a shell in front of it.** `command` is the script path itself, so the host must be able to run it: it needs the `#!/usr/bin/env bash` line and the executable bit set. No Windows-specific variant of the task is defined.
> - **The values are copied by hand.** The container name also appears as `container_name` in `compose.yaml`. Port 5678 also appears in `compose.yaml`'s port mapping and in `connect` in `launch.json` (target line 9). Nothing ties these copies together. If someone changes `DEBUG_PORT` here and not in the other places, debugpy listens on a port that isn't published or that VS Code doesn't connect to (see W1.4).

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The pre-launch task runs the start script with the container name and debug port, and VS Code waits for it to finish before attaching.*
> 
> VS Code finds this task through its label: `"Start debugger in dev container"` is the exact string the debug configuration names in `preLaunchTask` (W1.1). The file is new in this change. Before, nothing ran ahead of the debug session.
> 
> The task runs the start script as a plain shell command. It doesn't set `isBackground`, so **VS Code waits for the script to exit and goes on to the attach only if the exit code is 0**. `problemMatcher` is empty, so VS Code reads none of the output. Anything the script prints shows up only in the task terminal. From here on, the script's exit code decides whether the editor attaches.
> 
> The task gives the script two values in its environment: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The next step shows how the script picks them up.

**Behind Show more**

> - **What a successful exit means.** The script reports success once it has *started* the debugger, not once the debugger is ready. W1.7 shows that its last command returns right away. So an exit code of 0 tells VS Code that every step before that one worked. It doesn't tell VS Code that the debugger is already listening.
> - **Running the script directly.** `command` points straight at `scripts/start-debugger.sh`. This relies on the shell running the bash shebang and on the file being executable. `tasks.json` has no `windows` variant, so on a Windows host this depends on how the task's shell handles a `.sh` path.
> - **Repeated values.** The values here are copies, not references. The container name also appears as `container_name` in `compose.yaml` (target line 4). The port also appears in the `connect` block of the debug configuration and in the published ports in `compose.yaml` (target line 9). Nothing keeps these in step: changing `DEBUG_PORT` here changes only the port debugpy listens on.

### D · current brief, proposed readers (round 1 variant)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> This task is new in this change. It is the glue between the debug configuration and the script. The configuration's `preLaunchTask` names it by its `label`, and the two strings must match exactly. If they don't, VS Code reports that it cannot find the task.
> 
> **The task runs once, to completion, before the attach.** It is a plain `shell` task. It has no `isBackground` flag, so VS Code waits for `start-debugger.sh` to exit and judges the task by the script's exit code. Only after a successful exit does VS Code go on to the `attach` from W1.1. A non-zero exit stops the attach, which W2 follows. The empty `problemMatcher` only means VS Code does not scan the output for errors.
> 
> The task also fixes the two values the script works with: `DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`). It passes them as environment variables, and the script reads them in the next step.

**Behind Show more**

> - **How the script is started:** `command` points straight at the script file, with no interpreter in front. Running it therefore depends on the file being executable and on its `#!/usr/bin/env bash` line, which in practice means a POSIX shell on the host. Nothing in the task picks a different command per platform.
> - **Fallback values:** the script uses these same two values as defaults when the variables are missing. If they are changed in only one place, the task values win.
> - **The port appears in more than one place:** `DEBUG_PORT` here has to match `connect.port` in the debug configuration and the port that compose publishes. W1.8 comes back to this.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.*
> 
> This task is new in this change. Its `label` is exactly the `preLaunchTask` value from the debug configuration, and that string match is the whole link between the two (W1.1). When the developer starts the configuration, VS Code runs this task first.
> 
> The task runs `start-debugger.sh` as an ordinary shell task. It has no `isBackground` setting, so VS Code waits for the script to exit and then judges the task by its exit code. Exit 0 lets the attach go ahead (W1.8). A non-zero exit stops it there (W2). Because of this, **the script must end quickly**. As a later step shows, it does that by leaving the long-running debugpy process behind in the container (W1.7).
> 
> `options.env` passes `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` into the script's environment. The script reads them first, in the next step.

**Behind Show more**

> - **Empty `problemMatcher`:** VS Code doesn't scan the script's output for errors. Only the exit code decides whether the task succeeded. Without the empty value, VS Code might ask the user to choose a problem matcher when the task runs.
> - **Port and container name in several places:** The script falls back to the same two values if these variables are missing. So the task's values agree with the script's defaults, but they aren't the only source. The port is also written in `connect` and in the compose file. Nothing ties these together, so a change to one has to be repeated by hand in the others.
> - **How the script is started:** `command` points straight at the script file rather than at `bash <script>`. This works only if the file is executable in the checkout and the shell can follow its `#!/usr/bin/env bash` line. That is fine on Linux and macOS. On Windows, the default shell for tasks wouldn't run a `.sh` file this way. The file's executable bit can't be seen from the code here.

## W1.7 · The service starts detached under debugpy (several mechanisms interact)

**The planner's brief, current (A, D):**

> Explain `-d`: `docker exec` returns at once, and the debugpy process goes on in the container on its own. This is a handoff to another process. The script exits and the task finishes, while debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back until a client connects. Its output and any startup error do not reach the task terminal. The reader takes from this step that two things now run in parallel: VS Code moving on to attach, and debugpy starting to listen in the container.

**The planner's brief, oriented (B, C):**

> This is the last command in the script, and the point where work passes from the script to a separate process in the container. The reader should understand that the script, and so the task, finishes right away while the debugger server starts up on its own and waits for a client before running the service. The reader takes forward two things running in parallel, VS Code moving on to attach and debugpy starting to listen, and also that anything that goes wrong in the detached process is out of the task's sight.

**The planner's notes from the code (B, C), given to the writer as material:**

> Target scripts/start-debugger.sh line 23: the comment says docker exec returns at once and debugpy waits for the editor before main runs. Line 24: docker exec -d "$CONTAINER" python -m debugpy --listen "0.0.0.0:$PORT" --wait-for-client -m orders.main. With -d, docker exec does not attach to the process's output and returns once the process has been started. The script then reaches its end and exits 0, which ends the task successfully. The task terminal does not show debugpy's output or errors, such as an import failure or a port already in use. --listen 0.0.0.0 makes debugpy accept connections on all container interfaces, which the compose port publishing needs. Together with compose.yaml line 9 this exposes an unauthenticated debug server on all host interfaces. --wait-for-client holds orders.main back until a debugger client connects. The script does not check whether an earlier debugpy or service process is still running in the container. A second run would start another one on the same ports.

### A · current brief, product readers (round 1 baseline)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the handoff. With `-d`, `docker exec` starts the debugpy process inside `orders-dev` and returns at once without waiting for it. The script has nothing left to run, so it exits with 0 and the pre-launch task counts as successful.
> 
> **From this point two things run in parallel:**
> - VS Code sees the task finished and goes on to attach (next step).
> - In the container, debugpy starts up and opens its listener on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it holds `orders.main` back until a debugger connects.
> 
> Nothing in the script or the task checks that debugpy actually came up. Its output and any startup error, such as a bad module path or a port already in use, go to the detached process and never reach the task terminal. A failure here would only show up when the attach fails.

**Behind Show more**

> Two details make the command work as written:
> 
> - `--listen "0.0.0.0:$PORT"` binds on all interfaces inside the container. This is what lets the compose port mapping (`5678:5678` in compose.yaml, target line 9) forward the host's connection to it. A listener on `127.0.0.1` would be unreachable from the host.
> - `-m orders.main` is resolved from the container's working directory. `docker exec` inherits that directory from the service's `working_dir: /workspace` (compose.yaml, target line 5), which is the bind-mounted repository, so the module found there is the developer's current source.
> 
> The script can exit 0 even if debugpy dies right after it starts. That's because `set -e` only sees the exit code of `docker exec -d` itself, and that code only says whether Docker managed to start the process.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the script's last command, and it is where the work leaves the script. Because of `-d`, `docker exec` only starts debugpy inside `orders-dev` and returns at once. It does not wait for the service. debugpy then runs in the container independently of the script and the task.
> 
> debugpy's options decide what that process does:
> - `--listen "0.0.0.0:$PORT"` makes it accept a debugger client on every interface in the container. That is what lets the published port from compose (step W1.4) reach it.
> - `--wait-for-client` makes it hold `orders.main` back until a client connects. Until then the service does not run, so it writes no log and does not serve on 8000.
> 
> When the command returns, the script ends and the task finishes. **From here two things run in parallel:**
> 1. VS Code moves on to attach.
> 2. debugpy starts up and opens its listener in the container.
> 
> Nothing in the script or the task waits for the listener to be ready. Step W1.8 picks up the attach side.

**Behind Show more**

> Because this is the last command, its exit code becomes the script's exit code, and VS Code judges the task by that code. With `-d`, the exit code only reports whether Docker could start the exec. If debugpy fails later, for example because the port is taken or the module cannot be imported, the task still counts as successful.
> 
> The process also has no terminal attached. Its output and any startup error do not appear in the task terminal. You would see such a failure only indirectly, as an attach that does not connect.
> 
> Two more points:
> - **Repeated starts.** The script does not check whether an earlier debugpy process from a previous start is still running in the container. A second start launches another process on the same port.
> - **User.** The `docker exec` call sets no user, so the process runs as the container's default user, which this setup treats as root (step W1.6). This matters again in step W1.9, when the service creates its log file.

### B · oriented brief, product readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script hands off to a detached debugpy process in the container, which listens for the editor and holds the service until it attaches. The script then exits.*
> 
> This is the script's last command. Here the work moves out of the script and into a separate process inside the container. The script started from the pre-launch task, so this is also where that task ends.
> 
> `docker exec -d` starts debugpy in the background inside `orders-dev` and returns as soon as the process has been launched. The script has nothing left to run, so it exits 0, and VS Code treats the pre-launch task as successful. From here, two things happen in parallel:
> 
> - **In the container**, debugpy starts listening on `PORT` (5678 by default). Because of `--wait-for-client`, it holds `orders.main` back until a debugger connects.
> - **In VS Code**, the configuration moves on to the attach, which the next step (W1.8) follows.
> 
> **The task's success only means the process was launched, not that debugpy is listening or will keep running.** The process is detached, so its output never reaches the task terminal. If debugpy fails to import or the port is already taken, the task still reports success, and the only sign of trouble is a failed attach later on.

**Behind Show more**

> A few consequences of the command as written:
> 
> - **Exposure.** `--listen "0.0.0.0:$PORT"` makes debugpy accept connections on every interface in the container, and the published port needs that. But compose publishes `"5678:5678"` without a host address (`compose.yaml`, target, line 9), so this debug server is reachable on all host interfaces. Nothing in this setup adds authentication, and anyone who can connect to a debug server can run code in the process.
> - **Repeated runs.** Nothing checks whether an earlier debugpy or service process is still running in the container. Pressing F5 again launches another debugpy process. The earlier process would still hold the debug port (and port 8000, if its service was already released), so the new one can fail to bind. Because it runs detached, that failure would not show in the task.
> - **Port coupling.** The container side of the published mapping is fixed at 5678, so a `DEBUG_PORT` other than 5678 would make debugpy listen on a port compose does not publish (see W1.4).
> - **Finding the module.** `-m orders.main` works because `docker exec` runs in the service's `working_dir`, `/workspace`, which is the bind-mounted repository (`compose.yaml`, target, lines 5 and 7).

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script hands off to a detached debugpy process in the container, which listens for the editor and holds the service until it attaches. The script then exits.*
> 
> This is where the script hands its work over. It does not run the service itself. It starts a separate debugpy process inside the container and returns. Because this is the script's last command, the script exits successfully right away, and that is the exit the pre-launch task waits for (W1.2).
> 
> From this point **two things run independently**:
> 
> - **VS Code** sees the task succeed and goes on to attach (next step).
> - **debugpy** starts up in the container, opens its listener on `PORT`, and holds `orders.main` back until a debugger client connects. The service only starts after the attach.
> 
> Two consequences matter when judging the change:
> 
> - **The task cannot see this process.** The `-d` flag detaches it, so its output and errors never reach the task terminal. If debugpy fails to start, for example because the import fails or the port is taken, the task has still succeeded. The only sign is that the attach finds nothing listening.
> - **The debug server is exposed.** debugpy listens on `0.0.0.0`, which the compose port publishing needs. But compose publishes 5678 without a host address, so the debug server, which has no authentication, can be reached on every host interface, not just localhost (W1.4).

**Behind Show more**

> The success the task reports means only that `docker exec -d` started the process. It does not mean debugpy is listening yet. Nothing in the script or the task waits until the listener is up, so the attach can arrive before the server is ready. The next step picks this up.
> 
> The script does not check whether an earlier run's debugpy or service process is still alive in the container. A second F5 without restarting the container starts another debugpy on the same `PORT`. That one most likely fails to bind because the port is taken, and the failure stays invisible for the reason above.
> 
> `-m orders.main` resolves because the compose service sets `working_dir: /workspace` (compose.yaml, target, line 5), and `docker exec` uses that directory, which holds the bind-mounted repository. The process runs as root, which is what the log file ownership in W1.9 depends on.
> 
> The listen port comes from `PORT`, but compose publishes container port 5678 only (compose.yaml, target, line 9). If `DEBUG_PORT` were set to anything else, debugpy would listen on a port that is not published.

### C · oriented brief, proposed readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script hands off to a detached debugpy process in the container, which listens for the editor and holds the service until it attaches. The script then exits.*
> 
> This is the script's last command, and here the work passes from the script to a separate process. `docker exec -d` starts debugpy in the container and returns straight away. The script then ends with exit 0, so **the pre-launch task succeeds as soon as the process has been launched, not once debugpy is ready**.
> 
> Inside the container, debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back until a debugger client connects (`--wait-for-client`). So the service code does not run yet. It is released by the attach in the next step (W1.8).
> 
> From here, two things happen in parallel with nothing to coordinate them: VS Code moves on to attach, and debugpy is still starting up. Because of `-d`, the task terminal shows none of debugpy's output. If debugpy fails to start, for example on an import error or a port already in use, the task still reports success. The failure only shows up later, when the attach finds nothing listening.

**Behind Show more**

> - **Where the module is found:** `-m orders.main` works because the container's working directory is `/workspace` (`working_dir` in compose.yaml target line 5, and `docker exec` uses it by default). That folder is the bind-mounted repository, so debugpy runs the host's current source.
> - **What `-d` still catches:** the exit code of `docker exec -d` only covers starting the process. Under `set -e` a failure at that point would still fail the task. Anything that goes wrong after the process starts does not reach the task.
> - **Exposure:** listening on `0.0.0.0` is needed for compose's port publishing to reach debugpy. But `"5678:5678"` in compose.yaml (target line 9) gives no host address, so the debug server, which has no authentication, is reachable on every host interface, not just localhost.
> - **Running it again:** the script never checks for an earlier debugpy or service process in the container. If one is still running, a second F5 starts another process on the same ports. The new one would most likely fail to bind, and because of `-d` that failure would not show in the task.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script hands off to a detached debugpy process in the container, which listens for the editor and holds the service until it attaches. The script then exits.*
> 
> This is the handoff point. The script's last command starts debugpy as a **separate, detached process inside the container** and does not wait for it. Then the script reaches its end and exits 0, so the pre-launch task succeeds and VS Code moves on to attach (next step, W1.8).
> 
> Two things now happen in parallel:
> 
> - **In VS Code:** the editor goes ahead with the `connect` target from W1.1.
> - **In the container:** debugpy starts up, listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects. The service's own setup only runs after the attach (W1.9).
> 
> What this means for judging the change: **the task's success only shows that the process was launched. It doesn't show that debugpy is listening.** Because of `-d`, nothing debugpy writes reaches the task terminal. If debugpy fails to import or the port is already taken, the task still succeeds, and the developer only notices when the attach fails.

**Behind Show more**

> **Exposure.** `--listen 0.0.0.0` is needed so that compose's port publishing can reach debugpy inside the container. But compose publishes `"5678:5678"` with no host address (compose.yaml, target line 9), so the debug server is reachable on all host interfaces, not only on localhost. Nothing in this code configures authentication for it, and a debugpy connection can run arbitrary code in the container, which runs as root.
> 
> **Port coupling.** `$PORT` comes from the task's `DEBUG_PORT`. Compose publishes only container port 5678. If `DEBUG_PORT` is set to anything else, debugpy listens on a port that isn't published.
> 
> **Repeated runs.** The script doesn't look for a debugpy or service process left over from an earlier run. Starting the configuration again while one is still alive launches a second debugpy that tries to bind the same port. Since its output is detached, that failure is only visible through a failed or misdirected attach.
> 
> **Module resolution.** `-m orders.main` resolves because the container's `working_dir` is `/workspace`, the bind-mounted repository root (compose.yaml, target lines 5 and 7).

### D · current brief, proposed readers (round 1 variant)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> This is the hand-off. With `docker exec -d`, Docker starts debugpy inside `orders-dev` and returns at once. The script ends there, so the pre-launch task ends too, normally with exit code 0. debugpy keeps running in the container on its own. It listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.
> 
> **From here two things can run at the same time:** VS Code moves on to attach (next step, W1.8), and debugpy starts listening in the container. Nothing in the script or the task waits until debugpy is actually listening. The task's exit code also says nothing about whether debugpy started. Because the process is detached, its output and any startup error never reach the task terminal.

**Behind Show more**

> Some details that affect the outcome:
> 
> - **What a success means here.** With `-d`, `docker exec` reports only whether Docker could start the command in the container. If debugpy or `orders.main` fails after that, `set -e` cannot catch it, because the script is already done. Such a failure would most likely show up only as a failed attach in W1.8.
> - **How `-m orders.main` finds the module.** The `docker exec` call sets no working directory. The command therefore runs in the container's default, `working_dir: /workspace` from the `dev` service in `compose.yaml` (target, line 5), which is the bind-mounted repository from W1.4. That is why the `orders` package resolves.
> - **Pressing F5 again.** The script does not check for, or stop, a debugpy that an earlier run left behind. From the code, a second run would start another debugpy on the same port while the first one may still hold it. What happens then depends on that earlier process; it cannot be read from this change.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.*
> 
> Here the script hands the service to a separate process in the container and ends. `docker exec -d` starts `python -m debugpy` and returns at once without waiting for it. So the script exits with 0, and the pre-launch task finishes as successful (W1.2). Inside `orders-dev`, debugpy listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.
> 
> **From here two things run side by side:** VS Code goes on to attach (next step), and debugpy starts up and opens its port in the container. Nothing between them makes sure the port is open before the attach is tried.

**Behind Show more**

> What the detached start means for the developer:
> 
> - **Errors are hidden.** With `-d`, debugpy's output does not reach the task terminal. A startup failure (for example a bad module path, or the port already in use) does not appear there. The task has already succeeded by then, so the failure only shows up when the attach fails.
> - **The exit code only covers the hand-off.** `set -e` stops the script only if `docker exec -d` itself fails, for example if the container stops between the earlier check and this line. Once the process has started, its failures are not reported back to the script.
> - **A second press can collide.** Each run starts a new debugpy process. If one from an earlier run is still waiting or running, the new one may not be able to bind the same port. Nothing in the script looks for an existing process. This is a conclusion from the code, not something seen running.
> - **The module is found through the working directory.** `-m orders.main` resolves because the compose service sets `working_dir: /workspace`, the bind-mounted repository (W1.4).
> - **Listening on `0.0.0.0`** makes debugpy reachable through the container's published port, not only from inside the container. That is the path the attach uses in the next step.

## W1.3 · The script checks that the container is running (a condition and a failure path)

**The planner's brief, current (A, D):**

> Execution is now in the shell script, started by the task. Explain what `set -euo pipefail` does, the defaults that apply when the task's environment variables are missing, and the `docker inspect` check, including how `2>/dev/null` covers a container that does not exist. This walk follows the outcome where the container is running. The failing branch is its own walk.

**The planner's brief, oriented (B, C):**

> Execution has moved into the shell script that the task started. The reader should understand the script's guard: it sets strict error handling, settles which container and port it will use, and confirms the container is running before it does anything inside it. This walk takes the branch where the container is running. The failing branch is W2. The reader takes forward that, from here on, any failing command ends the script and so fails the task.

**The planner's notes from the code (B, C), given to the writer as material:**

> Target scripts/start-debugger.sh line 3: set -euo pipefail. A failing command exits the script, an unset variable is an error, and a pipeline fails if any part fails (the script has no pipelines). Lines 5–6: CONTAINER=${DEV_CONTAINER:-orders-dev} and PORT=${DEBUG_PORT:-5678}. The defaults apply when the variables are unset or empty, and the :- form keeps set -u from failing on them. The defaults match the task's values, so running the script outside the task gives the same result. Line 8: the check compares the output of docker inspect -f '{{.State.Running}}' "$CONTAINER" with "true". Its stderr goes to /dev/null, so a container that does not exist produces empty output and no visible error. Because the command substitution is an operand of [ ], a failing docker inspect does not trigger set -e. Only the test's result decides the branch. A container that exists but is stopped prints "false" and takes the same failing branch (lines 9–10). The script does not start the container itself.

### A · current brief, product readers (round 1 baseline)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script reads the container name and port, and stops with a hint if the container is not running.*
> 
> The task from the previous step has started the script. This first part fixes which container and port the script works with, and stops early unless that container is running.
> 
> - **Settings:** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT` in the task's environment. If either variable is missing or empty, the script uses `orders-dev` or `5678`. These defaults are the same values the task passes, so running the script by hand outside VS Code targets the same container and port.
> - **Strict mode:** `set -euo pipefail` makes the script stop at the first command that fails. That matters for the rest of the script: a failed step ends it with a non-zero exit code, and VS Code sees the task as failed.
> - **Running check:** the script asks Docker whether the container's `State.Running` is `true`. A container that is stopped gives `false`. A container that doesn't exist makes `docker inspect` fail, and `2>/dev/null` discards its error message, so the comparison gets an empty string. **Both cases lead to the same hint and `exit 1`.**
> 
> This walk continues with the outcome where the container is running. The failing branch, and what the developer sees then, is walk W2. The next step looks at the `orders-dev` container that this check expects.

**Behind Show more**

> `set -e` does not end the script when `docker inspect` fails, because the failure happens inside a command substitution that is an argument to the `[` test in an `if` condition. Only the result of the comparison decides what happens. `pipefail` has no effect in this part because there are no pipelines here. `-u` would stop the script on an unset variable, but the `${VAR:-default}` form means `DEV_CONTAINER` and `DEBUG_PORT` never trigger that.
> 
> The hint tells the developer to run `docker compose up -d dev`. That uses the compose service name `dev`, not the container name. The two connect through `container_name` in compose.yaml, which the next step shows.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script reads the container name and port, and stops with a hint if the container is not running.*
> 
> The task from the previous step has started the script. Here it settles two values and makes sure the target container exists before doing anything in it.
> 
> - **Settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. The fallbacks `orders-dev` and `5678` are the same values the task passes. They only take effect when the script runs outside the task, for example from a terminal.
> - **Strict mode.** `set -euo pipefail` means a failing command or an unset variable stops the script with a non-zero exit code. The task reports that failure, which keeps VS Code from attaching to a half-prepared container.
> - **Running check.** The script continues only if `docker inspect` prints exactly `true` for the container's running state. A stopped container prints `false`. A missing container makes `docker inspect` fail, its error is thrown away by `2>/dev/null`, and the result is an empty string. **Both cases fall into the same branch:** it prints a hint to run `docker compose up -d dev` and exits with 1. W2 follows that branch.
> 
> This walk continues with a running container. The next step shows the compose service this check expects to find under that name.

**Behind Show more**

> A few edge cases the code allows (read from the code, not seen running):
> 
> - **Hint can be wrong.** Any failure of `docker inspect` is hidden the same way: Docker not installed, the daemon not reachable, or no permission to the Docker socket. The script then says the container "is not running" and suggests `docker compose up`, which may not be the actual problem.
> - **Strict mode does not apply to the check.** The `docker inspect` call runs inside the `[ ... ]` test, so its failure does not trigger `set -e`. Only the comparison decides the outcome. That is why a missing container produces the hint instead of an abrupt exit.
> - **Paused containers pass.** Docker still reports a paused container as running, so the check lets it through. The later `docker exec` calls would then fail, and strict mode would stop the script there.

### B · oriented brief, product readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script picks up its settings and stops early unless the dev container is already running.*
> 
> The task has started the script. Before the script touches the container, it does three things:
> 
> 1. It switches on strict mode with `set -euo pipefail`. **From here on, any command that fails ends the script with a non-zero exit, and VS Code then treats the pre-launch task as failed**, so the attach doesn't happen (W1.2).
> 2. It sets `CONTAINER` and `PORT` from the `DEV_CONTAINER` and `DEBUG_PORT` values the task passes. If a variable is unset or empty, it falls back to `orders-dev` and `5678`. These defaults are the same values the task passes, so running the script by hand gives the same result.
> 3. It checks that the container is already running. The script never starts the container itself. If the check fails, it prints a hint and exits 1. This walk follows the branch where the container is running; W2 follows the failing branch.

**Behind Show more**

> The check passes only when `docker inspect` prints exactly `true` for `.State.Running`. Several cases print something else and take the failing branch:
> 
> - **Stopped container:** `docker inspect` prints `false`.
> - **Missing container:** `docker inspect` fails. Its error goes to `/dev/null`, so the output is empty.
> - **Docker itself unavailable:** for example, the daemon can't be reached. The output is empty, the same as for a missing container.
> 
> In all of these cases the script prints the same message: the container is not running.
> 
> A failing `docker inspect` here doesn't trigger `set -e`. The command runs inside the `[ … ]` test, so only the result of the comparison decides which branch the script takes.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script picks up its settings and stops early unless the dev container is already running.*
> 
> The task starts this new script, which does one thing before any other work: it confirms that the dev container is already running. Three points matter for the rest of the walk:
> 
> - **From here on, any failing command ends the script with an error.** `set -euo pipefail` turns that failure into a failed pre-launch task, so VS Code does not attach (the gate from W1.2).
> - **The container name and port come from the task's environment.** If either is missing, it falls back to a built-in default (`orders-dev` and `5678`). These are the same values the task passes, so running the script by hand behaves the same way.
> - **The script never starts the container.** It only asks Docker whether the container is running. If the answer is anything other than `true`, it prints how to start the container and exits. This walk follows the case where the container is running. W2 follows the case where it isn't.

**Behind Show more**

> The check sends `docker inspect`'s error output to nowhere. Because that call sits inside the `[ ]` test, its failure doesn't trip `set -e`. The only thing that decides the branch is whether its output equals `true`. So several situations all end in the same "not running" message:
> 
> - the container exists but is stopped (Docker prints `false`)
> - the container doesn't exist
> - Docker itself can't be reached (both give empty output)
> 
> W2.1 covers what the developer sees in that case.

### C · oriented brief, proposed readers

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script picks up its settings and stops early unless the dev container is already running.*
> 
> The script is new in this change. This first block guards it: it decides which container and port to use, then refuses to continue unless that container is **already running**. The script never starts the container itself.
> 
> - **Settings:** `CONTAINER` and `PORT` come from the `DEV_CONTAINER` and `DEBUG_PORT` values the task passed in (W1.2). If those are unset or empty, the script falls back to `orders-dev` and `5678`. The fallbacks match the task's values, so running the script by hand gives the same result.
> - **Running check:** the script asks `docker inspect` for `.State.Running` and goes on only if the answer is exactly `"true"`. The walk takes that branch here. The other branch prints a hint and exits 1, which W2.1 follows.
> 
> From here on the script runs under `set -euo pipefail`. **From this point, any failing command ends the script with a non-zero exit, so the task fails and VS Code does not attach.** This is why each later step in the container is a point where the walk can stop.

**Behind Show more**

> Three details of the check are easy to miss:
> 
> - `docker inspect`'s error output is sent to `/dev/null`. A container that doesn't exist gives empty output with no error message, and that fails the `"true"` comparison in the same way as a stopped container (which prints `"false"`).
> - The `docker inspect` call sits inside the `[ ]` test. So when it fails, `set -e` does not stop the script, and only the comparison decides the branch. The same holds when Docker itself can't be reached, so that case also lands on the "not running" message (W2.1).
> - The `:-` form of the fallbacks is also what keeps `set -u` from stopping the script when the variables are missing.
> 
> `PORT` is not used until the script starts debugpy in W1.7. The container name `orders-dev` is defined in the compose service shown in the next step (W1.4).

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script picks up its settings and stops early unless the dev container is already running.*
> 
> This is the gate for everything inside the container. The script settles which container and port to use, then refuses to go further unless that container is **already running**. It never starts the container itself.
> 
> - **Settings:** `CONTAINER` and `PORT` come from the `DEV_CONTAINER` and `DEBUG_PORT` values that the task passed in (W1.2). If either is unset or empty, it falls back to `orders-dev` or `5678`. These are the same values the task sets, so running the script by hand outside VS Code behaves the same.
> - **Running check:** the script asks `docker inspect` for `.State.Running` and goes on only if the answer is exactly `true`. This walk follows that branch. W2 follows the other one.
> 
> Take this forward: `set -euo pipefail` means that from here on, **any command that fails ends the script with a non-zero exit, so the task fails and VS Code does not attach**. Every later step in the script can only fail this way.

**Behind Show more**

> How the check behaves in the edge cases:
> 
> - **The container is stopped:** `docker inspect` prints `false`, so the script prints its message and exits 1.
> - **The container does not exist, or `docker inspect` fails for some other reason:** its error output is thrown away, the result is an empty string, and the script takes the same failing branch. The `docker` failure itself doesn't trigger `set -e`, because the command substitution is only an argument to `[`. Only the result of the comparison decides the branch.
> - **`set -u` and the variables:** the `:-` defaults keep `set -u` from stopping the script when `DEV_CONTAINER` or `DEBUG_PORT` is missing.

### D · current brief, proposed readers (round 1 variant)

#### Sample 1

**Before Show more** (the summary, then the explanation)

> *The script reads the container name and port, and stops with a hint if the container is not running.*
> 
> The script gets the container name and debug port from the task's environment in `CONTAINER` and `PORT`, then makes sure the container is up before it does anything else. The task in the previous step (W1.2) sets `DEV_CONTAINER` and `DEBUG_PORT`. The defaults, `orders-dev` and `5678`, are the same values, so they only matter if someone runs the script outside the task.
> 
> The check accepts only one result: `docker inspect` must print `true` for `.State.Running`. A stopped container prints `false`. A container that doesn't exist makes `docker inspect` fail, and its error message is thrown away, so the output is empty. **Both cases lead to the same hint and `exit 1`, and that exit code is how the task fails.** Walk W2 follows that branch. This walk continues with the container running.

**Behind Show more**

> How the opening options play out here:
> 
> - `set -u` makes the script stop if it uses a variable that was never set. The `${VAR:-default}` form avoids that, because it falls back to the default when the variable is unset or empty.
> - `set -e` makes the script stop at the first command that fails. The failure of `docker inspect` happens inside a command substitution that is only an argument to `[ ... ]`, and the `[` test sits in an `if` condition. So `set -e` does not stop the script there, and the `if` decides what happens. For the rest of the script, `set -e` means that any failing `docker exec` ends the script with a non-zero code, so the task fails as well.
> - `pipefail` makes a pipeline fail if any command in it fails. The script has no pipelines, so it has no effect here.
> 
> The name must match exactly. The check uses `container_name: orders-dev` from the compose file, shown in the next step (W1.4), not the compose service name `dev`.
> 
> One case the check may not catch (from Docker's documented behaviour, not from this code): Docker generally reports a paused container with `Running` still `true`. If so, a paused `orders-dev` would pass this check.

#### Sample 2

**Before Show more** (the summary, then the explanation)

> *The script reads the container name and port, and stops with a hint if the container is not running.*
> 
> The task from the previous step (W1.2) has started the script. This first part makes sure there is a container to work in before anything else is sent to it:
> 
> 1. **Settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. When the variables are missing, which happens only if someone runs the script outside the task, they fall back to `orders-dev` and `5678`. These are the same values the task passes.
> 2. **Running check.** `docker inspect` reads the container's `State.Running` flag. Anything other than the exact output `true` stops the script with exit code 1 and prints a hint to run `docker compose up -d dev`.
> 
> **The script does not start the container.** The developer must already have brought it up with compose. This walk follows the case where the container is running. W2 follows the failing branch.

**Behind Show more**

> - **`set -euo pipefail`** makes the rest of the script fail fast. Any failing `docker exec` in the later steps ends the script with a non-zero code, so the task fails too. With `-u`, an unset variable is an error, which is why the settings use the `${VAR:-default}` form.
> - **Why one test covers both failure cases.** A stopped container makes `docker inspect` print `false`. A container that doesn't exist makes it fail with an error message, which `2>/dev/null` throws away, and the command substitution then returns an empty string. Neither value is `true`, so both cases take the same branch. The failing `docker inspect` inside `$(...)` doesn't trigger `set -e` here, because it is part of the `if` test.
> - **Where the default name comes from.** `orders-dev` matches `container_name` in compose.yaml (target, line 4). The next step shows that service.
