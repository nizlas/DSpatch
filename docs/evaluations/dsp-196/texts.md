# DSP-196 · the texts, by step and profile

Every text as the person reads it: **before Show more** and **behind Show more** apart; a reference block (shown as links) is left out. Writer: the loop writer with the walk plan's context. Switch: the profile as an alternative with an existing explanation as material (the baseline writer's first Standard text for Essentials and Teacher, its first Essentials text for Standard), the same material for baseline and variant. Provider Claude, requested `opus`, reported `claude-opus-5-5` for every call. Nothing is edited.

## W1.2 · The pre-launch task runs the script

The simple step; code: `.vscode/tasks.json, target lines 4–10`.

**Shown first in the Step panel, in every profile (the planner's summary of the step, written before the profile is known):**

> A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.

### Essentials

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

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

##### variant, sample 1

**Before Show more**

> This task is new in this change. It is the glue between the debug configuration and the script. The configuration's `preLaunchTask` names it by its `label`, and the two strings must match exactly. If they don't, VS Code reports that it cannot find the task.
> 
> **The task runs once, to completion, before the attach.** It is a plain `shell` task. It has no `isBackground` flag, so VS Code waits for `start-debugger.sh` to exit and judges the task by the script's exit code. Only after a successful exit does VS Code go on to the `attach` from W1.1. A non-zero exit stops the attach, which W2 follows. The empty `problemMatcher` only means VS Code does not scan the output for errors.
> 
> The task also fixes the two values the script works with: `DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`). It passes them as environment variables, and the script reads them in the next step.

**Behind Show more**

> - **How the script is started:** `command` points straight at the script file, with no interpreter in front. Running it therefore depends on the file being executable and on its `#!/usr/bin/env bash` line, which in practice means a POSIX shell on the host. Nothing in the task picks a different command per platform.
> - **Fallback values:** the script uses these same two values as defaults when the variables are missing. If they are changed in only one place, the task values win.
> - **The port appears in more than one place:** `DEBUG_PORT` here has to match `connect.port` in the debug configuration and the port that compose publishes. W1.8 comes back to this.

##### baseline, sample 2

**Before Show more**

> VS Code finds this task because its `label` matches the configuration's `preLaunchTask` string exactly (W1.1). The task is new in this change. It is the only place where the debug start runs any code of its own.
> 
> It is an ordinary `shell` task that runs `start-debugger.sh`. It is not marked as a background task, and its `problemMatcher` is empty. **So VS Code waits for the script to exit and judges the task by its exit code alone.** A zero exit code lets the attach go ahead. A non-zero exit code counts as a failed pre-launch task, which is the case W2 follows.
> 
> The task passes the container name (`DEV_CONTAINER=orders-dev`) and the debug port (`DEBUG_PORT=5678`) to the script as environment variables. The script reads them in the next step.

**Behind Show more**

> The port 5678 is written here and again in the configuration's `connect` (W1.1). Nothing in the configuration reads it from this task, so the two values match only because both say 5678.
> 
> `command` names the script by path and does not call `bash`. The task therefore relies on the script being executable and on its `#!/usr/bin/env bash` line. From the files alone you cannot tell whether the repository sets the executable bit.

##### variant, sample 2

**Before Show more**

> This task is new in this change. Its `label` is exactly the `preLaunchTask` value from the debug configuration, and that string match is the whole link between the two (W1.1). When the developer starts the configuration, VS Code runs this task first.
> 
> The task runs `start-debugger.sh` as an ordinary shell task. It has no `isBackground` setting, so VS Code waits for the script to exit and then judges the task by its exit code. Exit 0 lets the attach go ahead (W1.8). A non-zero exit stops it there (W2). Because of this, **the script must end quickly**. As a later step shows, it does that by leaving the long-running debugpy process behind in the container (W1.7).
> 
> `options.env` passes `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` into the script's environment. The script reads them first, in the next step.

**Behind Show more**

> - **Empty `problemMatcher`:** VS Code doesn't scan the script's output for errors. Only the exit code decides whether the task succeeded. Without the empty value, VS Code might ask the user to choose a problem matcher when the task runs.
> - **Port and container name in several places:** The script falls back to the same two values if these variables are missing. So the task's values agree with the script's defaults, but they aren't the only source. The port is also written in `connect` and in the compose file. Nothing ties these together, so a change to one has to be repeated by hand in the others.
> - **How the script is started:** `command` points straight at the script file rather than at `bash <script>`. This works only if the file is executable in the checkout and the shell can follow its `#!/usr/bin/env bash` line. That is fine on Linux and macOS. On Windows, the default shell for tasks wouldn't run a `.sh` file this way. The file's executable bit can't be seen from the code here.

##### diagnostic: variant without the planner's briefs, sample 1

**Before Show more**

> This task is new in this change. VS Code finds it because its `label` matches the configuration's `preLaunchTask` string exactly. The task is a thin wrapper: it runs `start-debugger.sh` on the host with two settings in the environment, `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script does all the real work, starting in the next step (W1.3).
> 
> **The task must exit before VS Code attaches.** It is a plain shell task with an empty `problemMatcher` and is not marked as a background task, so VS Code waits for the script to finish. Only then does it go on to the attach. W1.7 shows the script ending without waiting for the service, and W2 covers what happens when the script fails.

**Behind Show more**

> The values `orders-dev` and `5678` are written in several places that must stay in sync:
> 
> - **Port 5678:** this task's `DEBUG_PORT`, the configuration's `connect.port` (W1.8) and the published `"5678:5678"` mapping in `compose.yaml` (target, line 9).
> - **Container name:** `DEV_CONTAINER` here must match `container_name: orders-dev` in `compose.yaml` (target, line 4).
> 
> The script falls back to the same two values if the variables are unset. So changing only one of these places would not cause an error until the attach fails.
> 
> `command` gives the script's path directly, with no interpreter in front of it. The task therefore relies on the host shell being able to run a bash script with the execute bit set. These files can't show whether that bit is set, or which shell VS Code uses on a given host (for example PowerShell on Windows).

##### diagnostic: variant without the planner's briefs, sample 2

**Before Show more**

> This task is the editor-side half of the link from the previous step (W1.1). VS Code finds it by its `label`, which must match the configuration's `preLaunchTask` string exactly. It then runs `start-debugger.sh` from the workspace on the host, not inside the container. The script does its container work through `docker exec`.
> 
> The task passes two settings to the script as environment variables: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. The script reads them in the next step (W1.3). **The port appears in two places:** here, and as `connect.port` in the debug configuration. Nothing ties the two values together, so a change to one has to be made in the other as well.

**Behind Show more**

> - **When the attach starts:** the task has no `isBackground` and no problem matcher (`problemMatcher: []`). VS Code therefore waits for the task's process to exit and uses its exit code to decide whether to attach. This works only because the script ends quickly, after starting debugpy detached (W1.7). If the script fails, the attach does not happen, which walk W2 follows.
> - **The env values only repeat the script's defaults:** `start-debugger.sh` falls back to `orders-dev` and `5678` when the variables are unset. Setting them here makes the values visible next to the debug configuration but changes nothing at runtime.
> - **The script must be executable on the host:** `command` points straight at the script file, so it runs via its `#!/usr/bin/env bash` line. That needs the file to have execute permission and needs bash on the host. The file mode can't be read from these revisions. On a Windows host, the default task shell would not run a `.sh` path like this.
> - **This file is new:** the earlier revision has only `.vscode/launch.json`, so there was no task before this change.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This is the task that `preLaunchTask` in the debug configuration names ([W1.1]). VS Code finds it by its exact `label` and runs it before it tries to attach. `tasks.json` did not exist at base. Before this change no task ran first, and the configuration started `orders.main` directly.
> 
> **The task's exit code decides whether the debugger attaches.** It is a plain `shell` task with no background settings, so VS Code waits for `start-debugger.sh` to exit before going on. The script ends with a detached `docker exec -d` (shown in [W1.7]), so it does exit quickly, and that exit is when VS Code moves on:
> 
> - Exit code 0: VS Code goes on to attach to the waiting debugpy ([W1.8]).
> - Non-zero exit, for example when the container is not running: no attach happens ([W2.1], [W2.2]).
> 
> The empty `problemMatcher` means VS Code does not scan the output for errors. What the script prints only appears in the task terminal.
> 
> The `env` block gives the script its container name (`orders-dev`) and debug port (`5678`). The script reads them in the next step ([W1.3]).

**Behind Show more**

> **The port number is written in four places, and nothing links them.** At target, the port is the same literal number in:
> 
> - the task's `DEBUG_PORT`
> - the script's fallback `${DEBUG_PORT:-5678}`
> - `connect.port` in `launch.json`
> - the published port `"5678:5678"` in `compose.yaml`
> 
> If you change only the task's `DEBUG_PORT`, debugpy listens on a port that `compose.yaml` does not publish, and `launch.json` still connects to 5678. All four values have to be changed together.
> 
> **The container name is repeated too.** `DEV_CONTAINER` matches the script's fallback and `container_name` in `compose.yaml`. As things stand, the task's `env` only repeats the script's defaults. It changes nothing unless someone edits one side and not the others.

##### variant, sample 1

**Before Show more**

> This is the task that the debug configuration's `preLaunchTask` names (see [W1.1]). VS Code finds it by its exact `label`. Its job is to run `start-debugger.sh` before VS Code tries to attach. `tasks.json` is new in this change. In the base revision, the configuration ran the service directly and there was no task.
> 
> **What decides the outcome:** this is a plain `shell` task with no background or `isBackground` settings. VS Code waits for the script to exit, and the exit code decides what happens next. Exit 0 lets the session go on to attach ([W1.8]). A non-zero exit stops the attach, which is the path [W2.2] follows. With `problemMatcher: []`, VS Code does not scan the output for errors, so only the exit code counts.
> 
> `options.env` gives the script its two inputs: the container name `orders-dev` and the port `5678`. The script reads them in the next step.

**Behind Show more**

> **The same values are written in several places.** Nothing connects these copies, so a change to one has to be made by hand in the others:
> 
> - **Port 5678** appears in:
>   - `DEBUG_PORT` here
>   - `connect.port` in `launch.json`
>   - the `"5678:5678"` mapping in `compose.yaml`
>   - the script's fallback, `${DEBUG_PORT:-5678}`
> - **Container name `orders-dev`** appears in:
>   - `DEV_CONTAINER` here
>   - `container_name` in `compose.yaml`
>   - the script's fallback, `${DEV_CONTAINER:-orders-dev}`
> 
> Because the script's fallbacks are the same as the values set here, the `env` block changes nothing at the moment. It only states the inputs openly. If someone edits only one of these copies, nothing reports an error; the attach simply fails or reaches the wrong place.
> 
> **When the task counts as finished.** The script ends with a detached `docker exec -d`, so it exits as soon as it has started debugpy. It does not wait for debugpy to be listening. The task therefore succeeds once the start command has been issued, not once the debugger is ready. Whether VS Code's connection can arrive before debugpy is listening is a question for the attach step ([W1.7], [W1.8]), and the code here does not answer it.

##### baseline, sample 2

**Before Show more**

> This step is the bridge between the debug configuration and the script. The `preLaunchTask` in the debug configuration (W1.1) names this task by its `label`, and the two strings match exactly. This task is the only one in `tasks.json`, which is a new file in this change. Before the change there was no task: the old configuration was a local `launch` of `orders.main`.
> 
> The task is a plain `shell` task with no background settings. **VS Code therefore waits for `start-debugger.sh` to exit, and the exit code decides whether the debug session goes on to attach.** Exit 0 leads to the attach in W1.8. A non-zero exit stops it, which is what W2 follows. The empty `problemMatcher` means nothing scans the output. The exit code is the only signal, and messages from the script are just text in the terminal.
> 
> This works because the script's last command starts the service detached (W1.7). So "task finished" means "debugpy has been launched in the container". It does not mean the service is ready.
> 
> `options.env` passes the container name (`orders-dev`) and the port (`5678`) to the script, which reads them in the next step. Nothing ties the port to `connect.port` in the debug configuration. Both are literals that someone has to keep in sync by hand.

**Behind Show more**

> The same values appear in more places than just these two:
> 
> - **Port:** `5678` is also the published port mapping in the compose file (W1.4). It is also the fallback in the script, `PORT="${DEBUG_PORT:-5678}"`. So four places must agree: the task env, the script default, the compose mapping and `connect.port`. If you change only the task's `DEBUG_PORT`, debugpy would listen on a port the compose file doesn't publish, and the attach would fail.
> - **Container name:** `orders-dev` must match `container_name` in the compose file. The script also uses it as its default.
> 
> **Two things this task assumes but the code doesn't settle (my observations, not verified):**
> 
> - **Unix-like shell:** a `shell` task runs `command` through VS Code's default shell. The script is bash and uses `id -u`/`id -g` on the host. On a Windows host with PowerShell or cmd as the task shell, the `.sh` path would not run as written. Nothing in `tasks.json` sets a shell or adds a `windows` override.
> - **Executable script:** the task runs the script directly by path, not as `bash script.sh`. So the file must have its executable bit set in the repository. That can't be checked from the files available here.

##### variant, sample 2

**Before Show more**

> This task is the bridge between the attach configuration from W1.1 and the shell script. The configuration's `preLaunchTask` value, `"Start debugger in dev container"`, has to equal this task's `label` exactly; that is how VS Code finds it. `tasks.json` is a new file in this change. At base there was no task: the only configuration, "Run orders locally", launched `orders.main` directly on the host.
> 
> **What decides the outcome:** this is a plain `"shell"` task with no background settings, so VS Code waits for `start-debugger.sh` to exit. Its exit code then decides whether the debug session goes on:
> 
> - **Exit 0:** VS Code goes on to attach, which W1.8 covers.
> - **Non-zero exit:** the attach does not happen, which W2 covers.
> 
> With `"problemMatcher": []`, VS Code does not scan the output. Whatever the script prints is just terminal text, and only the exit code matters.
> 
> This only works because the script exits quickly. Its final `docker exec -d` starts debugpy detached and returns at once, while debugpy waits inside the container for the editor to connect. If the script ran the service in the foreground, the task would never finish and the attach would never start. That last line is covered in W1.7.
> 
> `options.env` sets the container name (`DEV_CONTAINER=orders-dev`) and the debug port (`DEBUG_PORT=5678`) for the script, which reads them in the next step. The port has to match `connect.port` in the debug configuration, and nothing enforces that. Both are literal values kept in sync by hand.

**Behind Show more**

> **How many places hold the port and the container name.** The values here duplicate the script's own fallbacks, `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The current values would behave the same if the `env` block were removed. The block only matters once someone changes a value. Even then, changing the port here alone would not be enough. `5678` appears in four places:
> 
> - this task's `DEBUG_PORT`
> - the script's default
> - `connect.port` in the debug configuration
> - the `"5678:5678"` port mapping in `compose.yaml`
> 
> The container name is also repeated as `container_name: orders-dev` in `compose.yaml`.
> 
> **How the script runs.** The `command` is the script path alone, with no `bash` before it. The shell task therefore relies on the script's `#!/usr/bin/env bash` line and on the file having its executable bit set. On a Windows host, VS Code's default shell would not run it that way. The code does not settle which host shell is expected.

### Standard

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> When the developer starts "Debug orders in the dev container", VS Code first looks up the task named by the configuration's `preLaunchTask`. It finds it by matching that string exactly against a task `label`. This task is the one it finds. `tasks.json` is a new file in this change, so before it there was no task at all; the old configuration ran `orders.main` directly.
> 
> The task is an ordinary `"type": "shell"` task. It runs `start-debugger.sh` from the workspace's `scripts` folder and has none of the background-task settings. **VS Code therefore treats the task as finished when the script exits, and the exit code decides what happens next.** Exit code 0 lets the debug session go on to attach, which happens in a later step (W1.8). A non-zero exit stops the attach, which W2 follows. The empty `problemMatcher` means VS Code does not scan the script's output for errors. Only the exit code counts, and anything the script prints is just text in the task terminal.
> 
> `options.env` sets `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in the script's environment. The script reads them in the next step. The port given here has to match `connect.port` in the debug configuration (W1.1), but nothing ties the two together. Both are literal values that someone has to keep in sync by hand.

**Behind Show more**

> Some details that affect whether this task works:
> 
> - **The script is run directly.** `command` is the script's path, not `bash <path>`. The host shell starts it, and its shebang (`#!/usr/bin/env bash`) picks the interpreter. This only works if the file is executable in the checkout and the host's shell can run a bash script. The checkout's file mode can't be seen here, so whether the file is executable is unknown.
> - **"Finished" means the script has exited, not that the service is ready.** The script's last command (W1.7) is a detached `docker exec -d`, so the script exits as soon as that call returns. From this task's point of view, success means the script got as far as asking the container to start debugpy. It doesn't mean debugpy is already listening on `DEBUG_PORT` when VS Code tries to connect.

##### variant, sample 1

**Before Show more**

> VS Code finds this task through the debug configuration's `preLaunchTask` value from W1.1. VS Code matches it against the task's `label`, so the two strings must be identical. The task is new in this change; before it, the repository had no tasks file.
> 
> It is an ordinary `"type": "shell"` task. It is not marked `isBackground` and has no problem matcher that watches for a "ready" line. **For a task like this, VS Code waits until the command exits and uses the exit code to decide whether the pre-launch step succeeded.** If the code is 0, VS Code goes on to attach. If not, the attach is held back, which W2 follows. So the attach in W1.8 can start only after the script has finished, and only if it succeeded.
> 
> The empty `problemMatcher` tells VS Code not to scan the task's output for compiler-style errors. The exit code alone decides the outcome. As a side effect, VS Code doesn't ask the user which problem matcher to use when the task runs.
> 
> `options.env` adds two variables to the environment the script runs in:
> 
> - `DEV_CONTAINER` is `orders-dev`.
> - `DEBUG_PORT` is `5678`.
> 
> In the next step, the script reads these two variables.

**Behind Show more**

> The command is the script path itself, `${workspaceFolder}/scripts/start-debugger.sh`, with no interpreter in front of it. VS Code passes it to the user's configured shell. That works only if the script is executable and the shell understands the `#!/usr/bin/env bash` line, as a Linux or macOS shell does. The script's file mode isn't visible in these revisions, so whether it is executable can't be checked here.
> 
> The values in `options.env` match the defaults the script falls back to. The port also appears in the configuration's `connect` block. W1.8 comes back to the fact that the port is written in several places.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This task is the link between the debug configuration and the script. When you start "Debug orders in the dev container", VS Code first looks up the configuration's `preLaunchTask` value. That value must exactly match a task's `label`, and this task's label matches it ([W1.1]). The task runs `scripts/start-debugger.sh` and passes it two environment variables. `tasks.json` doesn't exist in the base revision, so the task and the file are both new in this change.
> 
> **How VS Code decides whether to attach.** `"type": "shell"` with no `isBackground` makes this an ordinary task. VS Code waits for the command to exit and treats the exit code as the result:
> - **Exit 0:** the debug session continues and attaches to `localhost:5678`.
> - **Non-zero exit:** the pre-launch task has failed, and the attach doesn't go ahead as normal. The other walk covers this path ([W2.1], [W2.2]).
> 
> `"problemMatcher": []` turns off output scanning, so the exit code is the only success signal VS Code gets.
> 
> This only works because the script exits quickly. Its last command is `docker exec -d …` (in a later step, [W1.7]), which returns immediately while debugpy waits inside the container for the editor to connect. If that command weren't detached, the script would never exit, and VS Code would never attach.
> 
> **The environment.** `options.env` adds `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` to the script's environment. In the next step ([W1.3]), the script reads them as `CONTAINER` and `PORT`.

**Behind Show more**

> **The same values are written in several places.** Neither value in `options.env` is set only here:
> - The script has its own defaults, `${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}`. Those defaults are the same as the values here, so the task's `env` doesn't change anything today. It just makes the values visible where the task is defined.
> - Port 5678 also appears in the launch configuration's `connect.port` ([W1.8]) and in the `ports` mapping `"5678:5678"` in `compose.yaml` ([W1.4]).
> - `orders-dev` is also the `container_name` in `compose.yaml`.
> 
> Nothing ties these copies together. If you changed `DEBUG_PORT` here alone, debugpy would listen on a port that isn't published from the container and that the editor doesn't connect to. The attach would fail even though the task succeeded.
> 
> **How the command runs (not established from the code).** A shell task passes `command` to the platform's default shell. Running a `.sh` path directly assumes two things:
> - The script is executable. Its shebang is `#!/usr/bin/env bash`.
> - The shell can run it.
> 
> On a Linux or macOS host this is the usual case. On a Windows host whose default shell is PowerShell or cmd, it probably won't run without extra configuration. The script also calls `id -u`/`id -g`, which assumes a POSIX host. The revision files don't show the file's executable bit, and nothing in `tasks.json` sets a shell or adds per-OS overrides.

##### variant, sample 1

**Before Show more**

> The **"Debug orders in the dev container"** configuration names this task in its `preLaunchTask` ([W1.1]). VS Code finds the task by its `label`, so the two strings must match exactly. Both `tasks.json` and this task are new in this change; the base revision has no `tasks.json`.
> 
> **How it gates the attach.** This is a plain `shell` task. It is not a background task, so VS Code waits for `start-debugger.sh` to exit and then looks at the exit code:
> - **Zero:** the debug session goes on to attach to `localhost:5678`.
> - **Non-zero:** the launch stops there (that path is [W2.2]).
> 
> The empty `problemMatcher` means VS Code doesn't scan the task's output for errors, so the exit code is the only signal.
> 
> The script only works with this model because of how it ends. Its last command is `docker exec -d …`, which starts debugpy in the background and returns at once. So the script exits soon after starting debugpy and doesn't stay running for the life of the service.
> 
> **What it hands over.** The task sets `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in the script's environment. The script reads them in the next step ([W1.3]).

**Behind Show more**

> **The variables repeat the script's defaults.** The script's first lines are `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The task passes exactly those values, so leaving out the `env` block would change nothing today. What the block does is make the values visible in the editor's configuration.
> 
> **The port is not set in one place.** `DEBUG_PORT` only controls which port debugpy listens on inside the container. Two other places have `5678` written directly:
> - the attach target in `launch.json`: `"connect": { "host": "localhost", "port": 5678 }`
> - the port mapping in `compose.yaml`: `"5678:5678"`
> 
> If someone changes `DEBUG_PORT` here and nowhere else, debugpy will listen on a port that is neither published nor the one VS Code connects to. The container name likewise has to match `container_name: orders-dev` in `compose.yaml` ([W1.4]).
> 
> **Which shell runs it.** I haven't verified this, but it looks worth checking. A `shell` task runs `command` through VS Code's default shell. Here the command is a path to a `.sh` file, so it depends on two things:
> - the file being executable, so its `#!/usr/bin/env bash` line is used;
> - the default shell being one that can run it.
> 
> On macOS or Linux that normally works. On a Windows host whose default shell is PowerShell or cmd, it may not run as written. Nothing in this change sets the shell or adds an OS-specific override.

### Teacher

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> As we saw in W1.1, the debug configuration no longer starts the program itself. Its `preLaunchTask` value names a task that VS Code must run first. This is that task. VS Code finds it by text: the `preLaunchTask` string has to match this `label` exactly, character for character. If someone renames one and not the other, the link breaks.
> 
> Here are the parts of the task that matter for this walk:
> 
> - **`"type": "shell"`**: VS Code runs `command` in a shell in a terminal panel, just as if you had typed the script's path there. `${workspaceFolder}` is VS Code's variable for the repository root, so the command always points at this repository's `start-debugger.sh`, whatever folder the shell is in.
> - **`options.env`**: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` are set as environment variables for the script's process, along with the variables it would normally inherit. In the next step (W1.3) the script reads these two names, and that is where the container name and port come from.
> - **`"problemMatcher": []`**: a problem matcher is a pattern VS Code applies to a task's output to turn compiler-style messages into entries in the Problems panel. An empty list says there is nothing to scan for. It also stops VS Code from asking the developer to choose a matcher when the task runs.
> 
> **What makes the hand-off to the attach work is what's missing:** the task has no `isBackground` setting. That makes it an ordinary task, so VS Code waits for the script process to exit and then judges the result by its exit code:
> 
> 1. The script exits with 0, so VS Code goes on with the configuration and attaches (W1.8).
> 2. The script exits with anything else, so VS Code reports the pre-launch task as failed and does not simply go on. W2 follows that path.

**Behind Show more**

> **Two consequences of this "wait for exit" design**
> 
> The script must finish for the attach to happen at all. This is why the last command in the script, which you'll see in W1.7, starts the service detached instead of running it in the foreground. If the script ran debugpy in the foreground, the task would never end, so VS Code would never attach. debugpy would wait for a client that never comes, and you'd have a deadlock.
> 
> The comparison point is a background task. With `isBackground: true` and a problem matcher that has begin and end patterns, VS Code would treat the task as ready when a certain line appeared in its output, even though the process was still running. That is the usual way to wait until a long-running server is ready. This task doesn't use it, so the exit code is the only signal VS Code gets. A zero exit code means the script's commands succeeded. It does not mean debugpy is already listening. W1.8 comes back to that gap.
> 
> **The port appears more than once**
> 
> The value `5678` given here is used by the script for debugpy's `--listen` address. The configuration's `connect` (W1.1) has its own `5678`, written separately, and so does the compose port mapping (W1.4). Nothing links these values: if one changes, the others have to be changed by hand.
> 
> **This file is new in the change**
> 
> At base there was only `launch.json`, with no tasks file. This task and its link from `preLaunchTask` come entirely from this change.

##### variant, sample 1

**Before Show more**

> This task is what the debug configuration's `preLaunchTask` (W1.1) points at. VS Code finds it by its `label`, so the two strings must match exactly. If someone renames one without the other, VS Code cannot find the task and the debug session never gets to the script. This file did not exist in the earlier revision; the task is new with this change.
> 
> A few VS Code task ideas explain how this task behaves.
> 
> - **A task is a command that VS Code runs for you.** With `"type": "shell"`, VS Code passes the `command` to the default shell in a terminal panel. Here the command is the path to `start-debugger.sh` under the workspace folder. `${workspaceFolder}` is filled in by VS Code before the shell sees the command.
> - **The task is not a background task.** It has no `isBackground` setting, so VS Code treats the task as finished when the process exits. It judges the result by the exit code: 0 is success, anything else is failure. For a pre-launch task, **VS Code goes on to attach only after the script has exited, and only if it exited with 0.**
> - **`problemMatcher` is empty.** A problem matcher tells VS Code how to read the task's output, for example to find compiler errors or to spot a line that means "ready". An empty list means VS Code reads nothing from the output. The exit code is the only signal it uses, and VS Code does not ask the developer to choose a matcher.
> 
> `options.env` adds `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` to the environment of the shell that runs the script. In the next step (W1.3) the script reads these two values first.

**Behind Show more**

> The values set here are the same as the script's own fallbacks (`${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}` in `scripts/start-debugger.sh`, target lines 5–6). So if this `env` block were removed, the script would still use the same container and port. If someone changes the port here, the change reaches the script. It does not reach the `connect` port in the debug configuration or the port mapping in compose. W1.8 comes back to those three places.
> 
> The success rule has one important consequence. Exit code 0 means only that the script reached its end without an error. Its last command starts debugpy in the background and returns at once (W1.7). So "task succeeded" does not mean "debugpy is listening". Nothing in this task waits for that.
> 
> The command is the script path alone. The shell starts it through the script's `#!/usr/bin/env bash` line. That works only if the file is marked executable and the host shell can run a bash script, for example on Linux, macOS or WSL. The file modes are not available in these revisions, so whether the executable bit was committed cannot be confirmed here.
> 
> If the script exits with an error, VS Code reports the pre-launch task as failed and does not attach. W2.2 covers that path.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> A pre-launch task is a shell command that VS Code runs before it starts a debug session. Here it is how the debug session gets the orders service running inside the container. As we saw in W1.1, the debug configuration no longer starts Python itself. It only attaches, so something else must first start a debug server for it to connect to. This task is that "something else".
> 
> **How VS Code finds this task.** The debug configuration's `preLaunchTask` is the string `"Start debugger in dev container"`. VS Code matches it by exact text against the `label` of the tasks in `tasks.json`. Nothing else connects the two files. A typo on either side gives a "could not find the task" error instead of a debug session. At the base revision there is no `tasks.json`, and the only configuration ("Run orders locally") is a `launch` that runs `orders.main` on the host. This file and the task in it are new.
> 
> **What "shell" means here.** A `"type": "shell"` task runs `command` in a shell, in VS Code's task terminal. `${workspaceFolder}` is a VS Code variable that VS Code fills in with the path of the open folder before the command runs. So the task simply runs `scripts/start-debugger.sh` from the repository.
> 
> **When the task counts as "done".** VS Code has two kinds of task:
> 
> - An **ordinary task** is done when its process exits. Its exit code is the result: 0 means success, anything else means failure.
> - A **background task** (`isBackground: true`) never exits, like a watch server. VS Code watches its output for a pattern that says "ready".
> 
> This task is the ordinary kind. That fits because the script's last command is `docker exec -d …` (W1.7). The `-d` makes `docker exec` return at once, so the script exits even though debugpy keeps running inside the container. With exit code 0, VS Code goes on to attach (W1.8). If the script fails, for example `exit 1` when the container isn't running, the failure path in W2 follows.
> 
> **`"problemMatcher": []`.** A problem matcher is a set of regex rules that turns a task's output lines into entries in the Problems panel. The empty list switches that off. The script's `echo` messages, including its "not running" error, appear only as text in the terminal. Success or failure is decided by the exit code alone.
> 
> **`options.env`.** These two variables are added to the script's environment. The script reads them in the next step (W1.3) as `CONTAINER="${DEV_CONTAINER:-orders-dev}"` and `PORT="${DEBUG_PORT:-5678}"`. The `:-` form means "use this default if the variable is unset or empty". The values here happen to equal the script's defaults, so today the `env` block changes nothing. It only makes the values visible and changeable here.
> 
> That points to something the reviewer should keep in mind. The same two values are written as literals in several places, and nothing checks that they agree:
> 
> - the port: `DEBUG_PORT` here, `connect.port` in the debug configuration, the `ports` mapping in `compose.yaml`, and the script's default;
> - the container name: `DEV_CONTAINER` here, `container_name` in `compose.yaml`, and the script's default.

**Behind Show more**

> **Why changing the port in only one place breaks the session.** The connection goes through three hops:
> 
> 1. debugpy listens on `0.0.0.0:$PORT` *inside* the container (W1.7).
> 2. Docker forwards host port 5678 to container port 5678, through the `ports` entry in `compose.yaml` (W1.4).
> 3. VS Code connects to `localhost:5678` on the host (W1.8).
> 
> Suppose someone sets `DEBUG_PORT` to 5679 here only. debugpy would then listen on 5679 inside the container, but Docker forwards only 5678, and VS Code still dials 5678. Because of `--wait-for-client`, the service would sit waiting for a debugger that never arrives. The task itself would still exit 0, so VS Code would try the attach and fail with a connection error rather than a clear message. Changing the container name in only one place fails earlier and more clearly: the script's `docker inspect` check (W1.3) does not find a running container and exits non-zero.
> 
> **What a non-zero exit actually does.** In VS Code, a failed `preLaunchTask` doesn't silently cancel the session. Normally VS Code shows a dialog saying the task terminated with an exit code, with choices such as *Debug Anyway*, *Show Errors* and *Abort*. That is editor behaviour, not something this repository configures; W2.2 follows that path.
> 
> **Two practical points (observations, not verified here):**
> 
> - The task runs the script file directly, not through `bash script.sh`. So the file must be marked executable in git, and a shell that understands the `#!/usr/bin/env bash` line must be available. On a Linux or macOS host that is normal. On a Windows host whose default task shell is PowerShell or cmd, the command probably won't run as intended. The executable bit is not visible in the files available here.
> - Since output is not parsed, the only error feedback is the script's own `>&2` message in the task terminal (W1.3). That is enough because the script prints a clear fix ("Start it with: docker compose up -d dev").

##### variant, sample 1

**Before Show more**

> A debug configuration in VS Code can name a **task** that has to run before the debugger starts. This step shows that task. As we saw in W1.1, the configuration "Debug orders in the dev container" has `"preLaunchTask": "Start debugger in dev container"`. VS Code finds the task by matching that string exactly against a task's `label`, and this task is the match. In the base revision, `tasks.json` did not exist. The old configuration, "Run orders locally", was a `"request": "launch"` that ran `orders.main` directly, so nothing ran first.
> 
> **What a pre-launch task is, and when it is "done"**
> 
> A task is a command that VS Code runs in a terminal. For a pre-launch task, what matters is when VS Code considers it finished, because the debug session waits until then:
> 
> - An ordinary task, like this `"type": "shell"` one, is finished when its process exits. If the exit code is 0, the debug session goes on to attach. If it is non-zero, VS Code does not attach. W2 follows that failure path.
> - A *background* task would be marked with `isBackground` and a problem matcher that recognises "ready" output. That is for commands that keep running, such as a dev server. This task has neither setting.
> 
> So the design depends on `start-debugger.sh` *exiting* once the service has been started, not running for the whole debug session. A later step shows how the script does this: it ends with a detached `docker exec -d`, which returns at once (W1.7). The empty `problemMatcher` tells VS Code not to scan the output for errors, so whatever the script prints is just text in the task terminal. Only the exit code decides.
> 
> **Where the script runs**
> 
> `command` points to `${workspaceFolder}/scripts/start-debugger.sh`. It runs on the **host**, in VS Code's shell, not inside the container. It reaches into the container through `docker exec`, as the next steps show.
> 
> **Handing values to the script**
> 
> `options.env` adds two variables to the script's environment:
> 
> - `DEV_CONTAINER=orders-dev`: the container to work in.
> - `DEBUG_PORT=5678`: the port that debugpy will listen on.
> 
> The script reads them in the next step (W1.3). If they are missing, it falls back to the same values (`${DEV_CONTAINER:-orders-dev}`, `${DEBUG_PORT:-5678}`).
> 
> The port has to agree with `connect.port` in the debug configuration (W1.1). It also has to agree with the port that `compose.yaml` publishes (W1.4). Nothing in the code links these. They are separate literal values that someone has to keep in sync by hand.

**Behind Show more**

> **Port 5678 is written in four places.** These are the task's `env`, the script's default, `connect.port`, and the compose mapping `"5678:5678"`. If you change it in the task only, the script listens on the new port inside the container. But compose still publishes 5678 and the debugger still connects to 5678, so the attach fails. The container name works the same way: `orders-dev` is in the task, in the script default, and in `container_name` in `compose.yaml`.
> 
> **"Task finished" only means the command was sent.** The task ends when the script exits, and the script's last command is `docker exec -d`. That returns as soon as Docker has started the process, not when debugpy is actually listening. The code does nothing to make the attach in W1.8 wait until debugpy has bound the port. Whether a fast attach can arrive too early depends on timing and on how the debugpy extension retries. That cannot be settled from this repository, so treat it as an open question, not an observed failure.
> 
> **How the command is run.** A `shell` task passes `command` to VS Code's default shell. The script path is called directly, so it depends on two things this repository's files can't show:
> - The file must be executable (the exec bit isn't visible in these files).
> - The shell must be able to run a `#!/usr/bin/env bash` script. That works in a Linux or macOS terminal. It does not work in plain PowerShell or cmd on Windows unless VS Code is set to use something like WSL or Git Bash.
> 
> The script also uses `id -u` / `id -g` on the host (W1.6), which likewise assumes a Unix-like host shell.

## W1.7 · The service starts detached under debugpy

The several mechanisms interact step; code: `scripts/start-debugger.sh, target lines 23–24`.

**Shown first in the Step panel, in every profile (the planner's summary of the step, written before the profile is known):**

> docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.

### Essentials

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

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

##### variant, sample 1

**Before Show more**

> This is the hand-off. With `docker exec -d`, Docker starts debugpy inside `orders-dev` and returns at once. The script ends there, so the pre-launch task ends too, normally with exit code 0. debugpy keeps running in the container on its own. It listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.
> 
> **From here two things can run at the same time:** VS Code moves on to attach (next step, W1.8), and debugpy starts listening in the container. Nothing in the script or the task waits until debugpy is actually listening. The task's exit code also says nothing about whether debugpy started. Because the process is detached, its output and any startup error never reach the task terminal.

**Behind Show more**

> Some details that affect the outcome:
> 
> - **What a success means here.** With `-d`, `docker exec` reports only whether Docker could start the command in the container. If debugpy or `orders.main` fails after that, `set -e` cannot catch it, because the script is already done. Such a failure would most likely show up only as a failed attach in W1.8.
> - **How `-m orders.main` finds the module.** The `docker exec` call sets no working directory. The command therefore runs in the container's default, `working_dir: /workspace` from the `dev` service in `compose.yaml` (target, line 5), which is the bind-mounted repository from W1.4. That is why the `orders` package resolves.
> - **Pressing F5 again.** The script does not check for, or stop, a debugpy that an earlier run left behind. From the code, a second run would start another debugpy on the same port while the first one may still hold it. What happens then depends on that earlier process; it cannot be read from this change.

##### baseline, sample 2

**Before Show more**

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

##### variant, sample 2

**Before Show more**

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

##### diagnostic: variant without the planner's briefs, sample 1

**Before Show more**

> This is the last thing the script does. It starts the orders service inside `orders-dev` under debugpy and hands control back to VS Code at once.
> 
> - **`-d` (detached):** `docker exec` returns as soon as the process has been started inside the container. The script therefore ends with exit code 0, and VS Code treats the pre-launch task as finished.
> - **`--wait-for-client`:** debugpy opens its listener and then holds `orders.main` until a debugger connects. The service has not started yet when the script exits. It starts only after the attach in the next step (W1.8).
> - **`--listen "0.0.0.0:$PORT"`:** debugpy listens on all interfaces inside the container. Listening only on the container's loopback would not be enough, because the editor connects from the host through the port that compose publishes.
> 
> **Nothing makes the script wait until debugpy is actually listening.** The task's exit code says only that `docker exec -d` could start the process, not that debugpy came up. If debugpy fails to start, or is slower than the editor's connect, the task has still succeeded. The failure would then appear when the editor tries to attach, not in the task output.

**Behind Show more**

> A few more points from the code around this line:
> 
> - **Port values must match.** `$PORT` comes from `DEBUG_PORT`, which the task sets to `5678`. The mapping in compose.yaml (`"5678:5678"`, target lines 8–9) and `connect.port` in launch.json (target line 9) are both written as the fixed value 5678. Changing `DEBUG_PORT` alone would make debugpy listen on a port that is neither published nor the one the editor connects to.
> - **Running as root.** There is no `-u` option, so the service runs as the container's default user. The `python:3.12-slim` image does not set a different user, which makes that root. The folder handed to the host user in W1.6 is therefore filled with files created by root. `orders.log` is one example (W1.9). Whether the host user can still edit those files depends on their permissions, not on who owns the folder.
> - **Where the output goes.** Because the process is detached, its stdout and stderr are not attached to the task's terminal. The service's own output goes to the log file and to the debug session once the editor is attached.
> - **How `-m orders.main` is resolved.** The module is found because the container's `working_dir` is `/workspace`, where the repository is bind-mounted (compose.yaml target lines 5–7). The code that runs is the host's current source.

##### diagnostic: variant without the planner's briefs, sample 2

**Before Show more**

> Here the script makes its last move. It starts the service in the container under debugpy, then hands control back to VS Code. The `-d` flag means `docker exec` does not wait for the process. It returns as soon as Docker has started it. The script then ends with exit code 0, and VS Code treats the pre-launch task as finished.
> 
> Inside the container, debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back because of `--wait-for-client`. The service code does not run until a debugger connects. It listens on all interfaces, not just localhost, so the port that `compose.yaml` publishes (seen in W1.4) can reach it from the host. The connection itself happens in the next step (W1.8).
> 
> **Nothing makes the script wait until debugpy is actually listening.** Once the task exits, VS Code starts the attach immediately. Whether the listener is ready by then depends on timing. If it isn't, the first attach can fail.

**Behind Show more**

> A few more things follow from running the process detached:
> 
> - **Errors inside the container are not reported.** The exit code of `docker exec -d` only says whether Docker could start the process. If debugpy fails later, the script still exits 0. That could happen if the port is already in use, for example because an earlier session is still listening on it. It could also happen if `orders.main` cannot be imported. In both cases VS Code goes on to the attach, and the failure only shows up as an attach that cannot connect.
> - **There is no check for an earlier run.** Nothing stops a debugpy started by an earlier F5 before a new one starts.
> - **How `orders.main` is found:** `-m orders.main` works because `compose.yaml` sets `working_dir: /workspace`, the bind-mounted repository. `docker exec` uses that directory, so Python's `-m` finds the `orders` package there.
> - **Port settings must match by hand.** The listen port comes from `DEBUG_PORT`, which the task sets to 5678. The attach target in the debug configuration (`connect.port`) and the published mapping `"5678:5678"` in `compose.yaml` are written separately. If one of them changes, the others do not follow.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This is the script's last command, and its job is to hand off. `docker exec -d` starts debugpy inside the container and returns as soon as the process has been created. The script then ends with exit 0, and VS Code treats the pre-launch task from [W1.2] as finished. The debugpy process keeps running in `orders-dev`, which stays up because of its `sleep infinity` command ([W1.4]).
> 
> Inside the container, debugpy listens on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it does not run `orders.main` until a debugger attaches. Listening on all interfaces is needed: the editor's connection arrives through the port that compose publishes, and from inside the container that traffic does not come from localhost.
> 
> **What decides the outcome:**
> 
> - **Timing between the two sides.** Once the task has finished, VS Code moves straight on to attach ([W1.8]). Nothing in the script checks that debugpy is already listening before it exits, so whether the port is open first or the attach happens first depends on timing.
> - **Errors after the start are not reported.** With `-d`, the exit code covers only creating the exec. If debugpy fails after that, for example because the port is taken or the module can't be imported, the task still succeeds. The only sign is a failed attach in the next step.

**Behind Show more**

> **The port is set in three places.** `PORT` comes from `DEBUG_PORT`, which defaults to 5678 and is set to 5678 in the task's environment. But the published port in `compose.yaml` and the `connect.port` in `launch.json` are both fixed at 5678. If only `DEBUG_PORT` changes, debugpy listens on a port that is neither published nor the one the editor connects to.
> 
> **A second run can collide with the first.** Nothing here stops an earlier debugpy/`orders.main` process that may still be running in the container. If one is still alive and holding 5678, the new debugpy cannot listen there. Because the start is detached, that failure is not reported, and the attach may reach the old process instead. This comes from reading the script; I haven't seen it happen.
> 
> **The service runs as root.** `docker exec` runs as the container's default user, which the comment on the log-folder lines says is root. So the service runs as root too. That is why the script hands the log folder to the host user beforehand ([W1.6]); what the service writes there is covered in [W1.9].
> 
> This script is new in the target revision. The base revision has no `scripts/` folder.

##### variant, sample 1

**Before Show more**

> This is the hand-off point of the walk. The script starts the service inside `orders-dev` under debugpy, and then it ends. Two things happen here:
> 
> - **The script stops here, the service doesn't.** With `-d`, `docker exec` returns as soon as it has started the command. Since this is the last line, the script exits 0, and VS Code treats the pre-launch task from [W1.2] as successful. The debugpy process keeps running in the container on its own, which the `sleep infinity` from [W1.4] keeps alive.
> - **The service is held until the editor attaches.** debugpy listens on `0.0.0.0:$PORT` so that a connection forwarded through the port compose publishes can reach it. `--wait-for-client` stops it before `orders.main` runs, so no service code runs until a debugger has connected.
> 
> The decisive consequence is that **the task's success only means "launch requested"**. The script never checks that debugpy actually started or is listening. VS Code moves straight on to attach [W1.8] while debugpy may still be starting. Nothing in this change orders those two events, so whether the first connection attempt finds a listener depends on timing.

**Behind Show more**

> Some details that follow from `-d` and the fixed values around this line:
> 
> - **Failures here are invisible.** A detached `docker exec` gives no output to the task terminal and doesn't report the process's exit status. If debugpy fails, the script still exits 0. That covers an import error, a crash in startup, or a port that is already bound. You would only notice when the attach in the next step fails.
> - **A repeated launch can collide.** Nothing stops a debugpy started by an earlier run. If an earlier session is still alive, for example still waiting for a client, a second run starts another debugpy on the same port. Its bind would be expected to fail, silently as described above, and the attach could reach the old process instead. This is a reading of the code, not something observed.
> - **`PORT` is configurable on one side only.** The script reads `DEBUG_PORT` (default 5678), and the task sets it to `"5678"`. But compose publishes `"5678:5678"` as a fixed value, and the launch configuration connects to port `5678` as a fixed value too. If you change `DEBUG_PORT` alone, debugpy listens on a port that is neither published nor attached to.
> - **The process runs as the container's user (root).** `docker exec` here passes no `-u`. That is why the previous step [W1.6] gives the `logs` folder to the host user up front. Without that, the folder the service writes to in [W1.9] would be owned by root.
> - **`-m orders.main` relies on the working directory.** compose sets `working_dir: /workspace`, and `docker exec` uses it. The bind-mounted package can be imported from there, and that is also the path that `pathMappings` maps to `remoteRoot`.
> 
> The script is new in the target revision. In the base revision only `launch.json`, `compose.yaml` and the `orders` package exist.

##### baseline, sample 2

**Before Show more**

> This line is where the script hands control to another process. `docker exec -d` starts `python -m debugpy … -m orders.main` inside the container and returns as soon as the exec has been created. The script then reaches its end and exits 0. The pre-launch task (W1.2) has no background or readiness matcher, so VS Code treats it as finished and goes on to attach (W1.8). The debugpy process keeps running in the container, which stays alive because of `sleep infinity` (W1.4).
> 
> What the started process does:
> 
> - **Listens on all interfaces in the container** (`0.0.0.0`). The editor connects to `localhost:5678` on the host, and compose forwards that port into the container. A listener bound only to the container's own localhost would not receive that traffic.
> - **Waits for a client before running `orders.main`.** The service code does not run until the editor has attached. Anything written before that point, such as the log file in W1.9, has not happened yet.
> 
> **The decisive point is that nothing makes the attach wait for the listener.** The script exits without checking that debugpy has bound the port. VS Code's attach and debugpy's start-up therefore run in parallel, and either can come first. If the attach is first, the connection is refused, or (depending on how Docker forwards the published port) dropped. Whether the attach retries is up to the debugpy extension, not this code.

**Behind Show more**

> The task can report success in cases where the service never started. A detached `docker exec` reports only whether the process could be started in the container. It does not report what the process does afterwards. The following cases all leave the task green and show up only as a failed or hanging attach:
> 
> - **debugpy dies at start-up**, for example because the port is taken or an import fails. Its output goes nowhere the editor can see.
> - **A run from an earlier session is still alive.** Its debugpy may still hold port 5678. In that case the new process cannot bind, and the editor may attach to the old process instead.
> - **The ports don't match.** `DEBUG_PORT` can be overridden (tasks.json sets it to `5678`, which is also the script's default). But compose publishes a fixed `5678:5678`, and launch.json connects to the fixed port `5678`. Changing the variable alone moves the listener without moving the other two.
> 
> This script is new in this change. The base revision has no `scripts/` folder and no `tasks.json`.

##### variant, sample 2

**Before Show more**

> This line is where the script hands the service to the container and gets out of the way. It starts `orders.main` inside `orders-dev` under debugpy, then lets `start-debugger.sh` finish. Because of `-d`, `docker exec` returns as soon as the exec has been created. The script ends with status 0, so the pre-launch task "Start debugger in dev container" counts as complete. The debugpy process keeps running inside the container, which is kept alive by `sleep infinity` ([W1.4]).
> 
> The process is set up to be attached to from outside:
> 
> - **`--listen "0.0.0.0:$PORT"`**: binds on all container interfaces. The editor's connection reaches the container through the `5678:5678` mapping in compose, so a localhost-only bind would not be reachable.
> - **`--wait-for-client`**: keeps `orders.main` from running until a debugger attaches. Nothing in the service runs before the editor is connected.
> 
> **The deciding consequence: the task finishing does not mean debugpy is ready.** The script does not check that the port is listening before it exits. VS Code moves on to attach to `localhost:5678` ([W1.8]) while debugpy may still be starting in the container. Which happens first depends on timing. Nothing in this change waits for readiness or retries the attach. The code here doesn't show how the debugpy extension behaves if it connects too early.

**Behind Show more**

> **What `-d` hides.** With `-d`, the exit status of `docker exec` only says the exec was started. It says nothing about whether debugpy came up. Two failures would go unnoticed, and the attach would just fail to connect:
> 
> - debugpy crashes on startup.
> - The port is already taken, for example by a debugpy or service process left over from an earlier session. Nothing in the script stops an earlier process.
> 
> Its output also goes nowhere you can see, so the task's terminal shows none of it. This is an observation from reading the code, not something seen at run time.
> 
> **The port is set in three places.** The script reads `DEBUG_PORT` (default 5678, and `tasks.json` sets it to `"5678"`). The compose file publishes `5678:5678`, and `launch.json` connects to port `5678`, both fixed values. They match today. If only `DEBUG_PORT` changed, debugpy would listen on a port that is neither published nor the one the editor attaches to.
> 
> **Execution context.** `docker exec` runs as the container's default user. That is root, as the comment at lines 18–19 of the script says (the compose file sets no `user`). It runs in `working_dir: /workspace`, the bind-mounted repository, which is why `-m orders.main` resolves. Once the editor has attached, `main()` creates `/workspace/logs/orders.log` and serves on port 8000 ([W1.9]).
> 
> **Compared with base.** Base has no `scripts/` folder and no `tasks.json`. This detached exec is the new way the service gets started for debugging.

### Standard

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> This is the script's last command, and it hands work off to another process. The `-d` flag tells `docker exec` to start the command inside `orders-dev` and return straight away without waiting for it. So the script reaches its end and exits with 0, and the pre-launch task from W1.2 counts as finished. The `debugpy` process keeps running in the container by itself, under the container's idle `sleep infinity` (W1.4).
> 
> That process does two things in a fixed order:
> 
> 1. `--listen "0.0.0.0:$PORT"` opens debugpy's server on every interface in the container. Listening on `0.0.0.0` rather than localhost matters here, because the editor's connection comes in through the port that compose publishes, which arrives from outside the container.
> 2. `--wait-for-client` stops it before `-m orders.main` runs. The service code does not run until a debugger has attached.
> 
> **From this point two things run in parallel.** VS Code sees the task finish and moves on to attach (next step). At the same time, debugpy is still starting up in the container. The script does not wait for the port to be listening before it exits, so the order of those two events depends on timing.

**Behind Show more**

> Because the process is detached, its output goes nowhere the developer can see. If debugpy is missing, `$PORT` is already in use, or the module fails to import, nothing about it reaches the task terminal. The script's exit code is decided only by whether `docker exec -d` could start the process, not by whether debugpy came up. If the attach in W1.8 fails, the cause has to be found inside the container.
> 
> `-m orders.main` resolves against the container's working directory. `docker exec` inherits that from the compose service's `working_dir: /workspace` (compose.yaml, target, line 5). So Python finds the `orders` package in the bind-mounted repository, the same `/workspace` that `pathMappings` refers to.
> 
> The script does not check whether an earlier debugpy process from a previous start is still running. Pressing F5 again would start a second process that tries to bind the same port. Nothing in the script prevents this, and its effect would not show in the task terminal.

##### variant, sample 1

**Before Show more**

> This is the last command in the script, and the point where the work passes from the script to a separate process in the container.
> 
> Without `-d`, `docker exec` would stay attached to the command until it ended, and the script would block because debugpy is told to wait. **With `-d`, Docker starts the process inside `orders-dev` and returns at once.** That process is `python -m debugpy` with `--listen "0.0.0.0:$PORT"` and `--wait-for-client`. Because this is the last command, the script's exit code is the exit code of `docker exec -d`. That code only shows whether Docker could start the process. It says nothing about whether debugpy started listening.
> 
> From here, two things run independently:
> 
> 1. **On the host:** the script exits with 0, so the plain shell task from W1.2 counts as successful, and VS Code moves on to the attach in the next step.
> 2. **In the container:** debugpy opens a listener on `$PORT` on all interfaces. It needs `0.0.0.0` rather than localhost, because compose's `5678:5678` mapping from W1.4 forwards traffic from outside the container. `--wait-for-client` makes debugpy hold `orders.main` back until a debugger connects.
> 
> The module name `orders.main` resolves because `docker exec` uses the container's working directory, which compose sets to `/workspace`, the bind-mounted repository.

**Behind Show more**

> Some consequences of handing off to a detached process:
> 
> - **Output and errors are not visible.** Whatever debugpy or `orders.main` prints goes to the detached exec, not to the task terminal. If debugpy fails at startup (the port is already in use, the module is missing, or the import fails), the task has already succeeded and nothing on the host reports the failure. The developer would only see the attach in W1.8 fail.
> - **Nothing makes the attach wait for debugpy.** The script does not check that debugpy is listening before it exits. So the order between "debugpy is listening" and "VS Code connects" is decided by timing, not by the code. The code allows the attach to arrive before the listener is ready. Whether that happens in practice cannot be read from the code.
> - **Each run starts a new process.** The script never checks for or stops an earlier debugpy process. If a session from a previous run is still holding the port, the new process has nothing to bind to. It fails silently, for the reason in the first point.
> - **What `set -e` covers.** `set -e` still applies to this line. If `docker exec -d` itself fails, for example because the container stopped after the check in W1.3, the script exits non-zero and the task fails. Failures inside the detached process are not covered.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> Here the script hands control from VS Code to the container. As we saw in the earlier steps, the script has confirmed that `orders-dev` is running, installed debugpy if it was missing, and prepared `/workspace/logs`. This line starts the service under debugpy. In the base revision none of this existed: the configuration was a plain local `launch` of `orders.main`.
> 
> **How the line works.** `docker exec -d` asks Docker to start a new process inside the running container. It returns as soon as Docker has started it, without waiting for it to finish. Because this is the script's last command and `set -euo pipefail` is on, the exit status of `docker exec -d` decides the script's exit status, and so whether the pre-launch task in `tasks.json` succeeds. That status only says whether Docker could create and start the process. It says nothing about whether debugpy then started successfully.
> 
> **What runs inside the container:**
> - `python -m debugpy` runs debugpy as a wrapper around the real program, which is named by the trailing `-m orders.main`.
> - `--listen "0.0.0.0:$PORT"` opens the debug-adapter port on every interface in the container. Binding to `0.0.0.0` matters here. Docker forwards the published port `5678:5678` (from `compose.yaml`, [W1.4]) to the container's network interface, not to its loopback. A listener on `127.0.0.1` would not be reachable from the host.
> - `--wait-for-client` stops debugpy before any code in `orders.main` runs, until a debugger attaches. So breakpoints in `main()` can still be hit.
> - `orders.main` resolves because `docker exec` uses the container's default `working_dir`, which is `/workspace`, the bind-mounted repository.
> 
> **Two things now run at the same time.** VS Code sees the task end and goes on to connect to `localhost:5678` (next step, [W1.8]). Inside the container, debugpy is still starting up. Nothing in the script waits for the listener to be ready, and nothing checks that debugpy started at all. A wrong module path, a port already in use, or an import error happens in the detached process. Its output never reaches the task terminal, so the only visible symptom is a failed or hanging attach in the next step.

**Behind Show more**

> **Points that can change the outcome:**
> 
> - **Fixed port numbers in three places.** `PORT` defaults from `DEBUG_PORT`, which `tasks.json` sets to `5678`. The attach target in `launch.json` is a literal `5678`, and so is the published mapping in `compose.yaml`. The script's `DEBUG_PORT` override therefore only works if the other two files are changed with it. Otherwise debugpy listens on a port the host cannot reach.
> - **Leftover processes on a second start.** The detached debugpy process is tied to nothing on the host. If a session ends while the service is still running, or the attach never happens and debugpy keeps waiting, the next debug start runs this line again. The new debugpy then tries to bind a port the old one still holds. That is my reading of the code, not something it handles. The script does not look for or stop an existing debugpy process.
> - **Timing of the first connect.** Whether VS Code's first connection can arrive before debugpy is listening depends on how quickly the container process starts compared with the client. The code does not order the two. A failure from this race would look the same as a real startup failure.
> - **Root process.** The process runs as the container's default user, which the script's own comment at lines 18–19 says is root. So anything the service creates under `/workspace/logs` is owned by root, even though the folder itself was handed to the host user in the previous step [W1.6]. That ownership question is what the last step [W1.9] covers.

##### variant, sample 1

**Before Show more**

> The script hands the service over to the container here and then ends.
> 
> `docker exec -d` asks Docker to start a new process inside the running `orders-dev` container (checked in [W1.3]). With `-d` (detached), Docker returns as soon as that process has been created. It does not wait for the process to run or finish. Line 24 is the last command, and `set -euo pipefail` (line 3) only stops the script early on a failing command. So the exit status of `docker exec -d` becomes the script's exit status. VS Code's pre-launch task "Start debugger in dev container" ([W1.2]) therefore counts as successful as soon as Docker has accepted the process. Whether Python and debugpy actually came up has no effect on it.
> 
> The process started is `python -m debugpy … -m orders.main`. debugpy launches first and runs the module `orders.main` as its debuggee. Two of its flags work together with the rest of the walk:
> 
> - **`--listen "0.0.0.0:$PORT"`** opens debugpy's own debug server inside the container. It binds to all interfaces, not `127.0.0.1`, because the editor connects through Docker's published port `5678:5678` (compose.yaml, [W1.4]). Docker forwards that traffic to the container's network interface, not to its loopback. `$PORT` comes from `DEBUG_PORT`, which the task sets to `5678`. That matches both the compose mapping and `connect.port` in launch.json.
> - **`--wait-for-client`** keeps the program from running until a debugger has attached. Nothing in `orders.main` (opening the log, `serve(port=8000)`) runs until then, so breakpoints near the start of `main()` will still be hit.
> 
> From here, two things happen independently. On the host, VS Code sees the task end and starts the attach ([W1.8]). In the container, Python starts, imports debugpy and opens the listener. Nothing in the script or the task makes the attach wait until the listener is ready, and nothing checks that it ever came up. The process's stdout and stderr belong to the detached exec, so they never reach the task terminal. A wrong module path, a missing dependency or a port already in use would only show up later, as a failed or refused attach.
> 
> This replaces the base revision's "Run orders locally" configuration. That was a `launch` request: VS Code itself started `orders.main` on the host.

**Behind Show more**

> **Things the code allows but does not handle**
> 
> - **Timing of the attach.** The task finishes the moment the process is created. Python and debugpy may need a short time before the listener accepts connections. Whether the first attach can arrive before that depends on timing and on how the VS Code debugpy adapter retries a refused connection. The code does not settle that either way.
> - **Repeat runs.** The script never records or stops the process it starts. If a debuggee from an earlier session is still running in the container, a second run starts another `debugpy --listen` on the same port. That one would fail to bind, and the failure would not be visible here. The attach might then connect to the old process instead. These are observations from reading the code, not tested behaviour.
> - **Which user and directory.** `docker exec` runs with the container's defaults. The image is `python:3.12-slim` and compose sets no `user:`, so the process runs as root. compose sets `working_dir: /workspace`, which is the bind-mounted project, so `orders` is importable as a package from there. Running as root is why [W1.6] hands `/workspace/logs` to the host user before this line. As we'll see in [W1.9], `main()` writes `orders.log` into that folder once the debugger releases it.

### Teacher

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> Here the script hands its work to another process and then ends. Up to now each `docker exec` ran a command in the container and waited for it to finish, with its output in the task terminal (W1.5, W1.6). This last one is different.
> 
> **What `-d` changes.** Without `-d`, `docker exec` stays attached to the command: it streams the output and returns only when the command ends, with the command's exit code. With `-d` (detached), Docker starts the command inside the container and `docker exec` returns at once. The exit code then only says whether Docker could start the command, not how the command went. Here, the started command is `python -m debugpy ...`, and from this point it runs in the container on its own.
> 
> **What the started process does.** debugpy is the Python debug server installed in W1.5. Two of its options matter here:
> - `--listen "0.0.0.0:$PORT"` opens a socket on the debug port, 5678 by default (`PORT` comes from the task's `DEBUG_PORT`, as in W1.2). The address `0.0.0.0` means "every network interface in the container". This is needed because the connection from the host arrives through Docker's port publishing (W1.4), not on the container's own loopback interface. If debugpy listened on `127.0.0.1`, the published port would lead nowhere.
> - `--wait-for-client` makes debugpy hold back the program until a debugger client connects. Only then does it run `-m orders.main`. It's like a door that is unlocked but stays closed until someone knocks. The service code has not started yet, so no breakpoint can be missed during startup.
> 
> `-m orders.main` can be found because the container's `working_dir` is `/workspace` (compose.yaml, target, line 5). That is the bind-mounted repository, and `docker exec` runs in that directory by default.
> 
> **What happens next.** This line is the script's last command. It succeeds as soon as Docker has started the process, so the script exits with 0 and VS Code treats the pre-launch task as finished successfully (W1.2). From here, two things run side by side:
> 1. VS Code continues with the debug configuration and connects to the port (the next step, W1.8).
> 2. In the container, debugpy starts Python and opens its listening socket.
> 
> No step in the script or the task waits for the second to be ready before the first happens.

**Behind Show more**

> **Where output and errors go.** A detached process has no connection to the task terminal. If debugpy fails after Docker has started it, nobody on the host sees the message, and the task has already reported success. For example, it could fail because the port is already taken. The developer would only notice the effect: the attach in W1.8 fails or times out. As the code reads, one way this could happen is starting the configuration twice without the first debugpy process having ended. The script does not check for or stop an earlier debugpy before starting a new one. This is a conclusion from the code, not something seen running.
> 
> **Which failures still stop the script.** `set -euo pipefail` (W1.3) still applies to this line, but only to Docker's part of it. Suppose the container stopped between the running check and here: `docker exec -d` would fail, the script would exit with a non-zero code, and VS Code would not attach (see W2.2 for how a failed task is handled). A failure inside debugpy after it has started does not reach the script.
> 
> **Lifetime.** The debugpy process, and later `orders.main` under it, belongs to the container, not to the task or the VS Code session. It keeps running until it exits or the container stops. W1.9 shows what it does once the client connects.

##### variant, sample 1

**Before Show more**

> Up to here, every `docker exec` in the script ran in the foreground: the script waited for each command in the container to finish and, because of `set -e` (W1.3), stopped if one failed. This last line works differently, and **that difference decides how the rest of the walk runs**.
> 
> **What `-d` changes.** `docker exec` normally keeps the host side connected to the process it starts in the container. It passes that process's output back and returns that process's exit code. With `-d` (detached), Docker starts the process inside `orders-dev` and returns right away. The host-side command and the container process are no longer connected. The new process belongs to the container and keeps running after the script has gone.
> 
> **What the started process does.** `python -m debugpy` is a wrapper that loads the debugger and then runs your program:
> 
> - `--listen "0.0.0.0:$PORT"` opens a debug server on the port taken from the task (W1.2, default 5678). The address `0.0.0.0` means "every network interface in the container". This matters because traffic from the host's published port (W1.4) arrives from outside the container. A server listening only on `127.0.0.1` inside the container would never see it.
> - `--wait-for-client` makes debugpy wait before running any of the program. It holds `orders.main` back until a debugger client connects.
> - `-m orders.main` names the module to run once that happens. The module is found relative to the container's working directory, `/workspace`, which is the bind-mounted repository (W1.4).
> 
> **What happens next.** This is the script's last command, so the script exits with that command's exit status. The pre-launch task then counts as finished (W1.2). From this moment, two things run independently:
> 
> 1. VS Code sees the task end successfully and goes on to attach to `localhost:5678` (next step, W1.8).
> 2. Inside the container, debugpy starts up, opens its port and waits.
> 
> Nothing in the script or the task makes step 1 wait until step 2 has actually opened the port. What decides the order between them is how fast each one runs, not anything in the code.

**Behind Show more**

> **What the task's success means here.** With `-d`, the exit code says only that Docker managed to start the process in the container. It does not say that debugpy is listening, or that `orders.main` will import. Some failures happen after the hand-off, for example a failed import, or a port that is already taken because an earlier debugpy from a previous F5 is still running in the container. Their output is never connected to the task terminal, and they do not change the exit code. From the code alone, the developer would see such a failure only as an attach that does not connect. Any trace of it would be inside the container, not in VS Code's task output. This follows from how detached exec works; it has not been seen in an actual run.
> 
> **Who owns the service.** The process started here is the one that later runs `main` (W1.9). Like every exec in this script, it runs as the container's default user, root. Its lifetime is tied to the container, not to the debug session. Stopping the debugger or closing VS Code only ends what that process does once the client goes away. Nothing in the script stops or replaces an earlier instance before starting a new one.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This is the last line of the script. Here it hands the debug session over to a process that keeps running after the script has finished. The script is new in the target revision. The base revision had no script and ran `orders.main` locally with a `"launch"` configuration.
> 
> **What `docker exec -d` does here**
> 
> `docker exec` runs a command inside a container that is already running. In this case that is `orders-dev`, the container the earlier steps checked and prepared (W1.3–W1.6). Without `-d`, `docker exec` stays attached until the command ends, and it returns that command's exit code. With `-d` ("detached"), Docker starts the command inside the container and returns straight away. The exit status then only tells you whether Docker managed to start the process. It says nothing about whether Python, debugpy or `orders.main` work.
> 
> This matters for the pre-launch task in W1.2. VS Code waits for that task to finish before it attaches. If this line ran in the foreground, the task would never finish: the service runs until it is stopped, so the attach would never happen. With `-d` the script reaches its end and exits with 0, and VS Code continues. The debugpy process stays alive in the container, next to the container's own `sleep infinity` command (W1.4). That idle command is what keeps the container running between debug sessions.
> 
> **What the started process does**
> 
> `python -m debugpy … -m orders.main` uses debugpy as a wrapper around the service. Python first runs debugpy, and debugpy then runs the module `orders.main` as if it had been started with `python -m orders.main`. Two options control that:
> 
> - `--listen "0.0.0.0:$PORT"` makes debugpy open a TCP server for a debugger client. `0.0.0.0` means "every network interface of the container". This is needed because the editor connects from the host to `localhost:5678`. Docker forwards that connection into the container through the port mapping `"5678:5678"` in `compose.yaml`, so it does not arrive on the container's own loopback interface. A debugpy listening on `127.0.0.1` inside the container would not receive it.
> - `--wait-for-client` makes debugpy block before running any code from `orders.main` until a client has attached. Without it, the service would already be running, and could have passed early breakpoints, before VS Code connects.
> 
> **What is now true, and what is not**
> 
> When the script exits, Docker has started the process, and nothing more is known. The script does not check that debugpy has opened the port, that `import orders.main` will succeed, or that the port was free. Because of `-d`, anything the process prints goes nowhere the task output shows. From here, two things run at the same time: VS Code moves on to attach (W1.8), and the process in the container is still starting Python and debugpy. Which of the two reaches the port first depends on timing. The code does nothing to order them.

**Behind Show more**

> **Failures that `-d` hides**
> 
> Because only Docker's start-up result reaches the script, `set -euo pipefail` on line 3 only catches errors from Docker itself. For example, `docker exec` fails if the container stopped right after the check. Some cases that would end the task as successful even though nothing is listening:
> 
> - **A second debug session.** If a debugpy from an earlier run is still alive in the container, it may still be holding port 5678. The new debugpy then cannot bind the port and exits, and nobody sees it. If the old process is still listening, the editor may attach to that old process instead. The script has no step that stops a previous instance. This is my reading of the code, not something I have seen happen.
> - **Import or start-up errors** in `orders.main` show up only after the attach, and only as output inside the debug session (W1.9 shows what `main` does next).
> 
> **Port configuration is in two places**
> 
> The script reads `DEBUG_PORT` (line 6), and the task sets it to `"5678"` (tasks.json line 8). But `compose.yaml` publishes a fixed `"5678:5678"`, and `launch.json` connects to a fixed `5678`. If `DEBUG_PORT` were changed only in the task, debugpy would listen on a port that is not published, and the attach would fail. Today all three values match.
> 
> **Who the process runs as**
> 
> `docker exec` uses the container's default user. `compose.yaml` sets no `user:`, so with `python:3.12-slim` that is root. W1.6 handed the `logs` folder to the host user, but files the service creates there are still created by root. Whether that matters is covered in W1.9.
> 
> **The race in more detail**
> 
> How the attach behaves if it arrives before debugpy is listening depends on VS Code's debugpy extension and on Docker's port forwarding. Neither is part of this repository, so I cannot tell from the code whether the attach retries, fails, or only fails sometimes. The script could close the race by waiting for the port before it exits, but it does not.

##### variant, sample 1

**Before Show more**

> This line hands work from the editor's task to the container. It starts the service under the debugger and lets the script end without waiting for the service to start.
> 
> **`docker exec` with and without `-d`.** `docker exec` runs a command inside a container that is already running (here `orders-dev`, the container checked in [W1.3]). Without `-d`, it is like calling a function: the script waits until the command finishes and gets its exit code back. The earlier `docker exec` calls in the script work that way. With `-d` ("detached"), Docker starts the command and returns at once. The new process keeps running inside the container on its own, next to the container's `sleep infinity` main process from [W1.4]. A rough comparison is ending a shell command with `&`, except that the process lives in the container, not on your machine.
> 
> That is why this is the script's last line. Once the script exits with 0, VS Code treats the `preLaunchTask` from [W1.2] as finished. If the service ran in the foreground, the task would never end and the attach would never start.
> 
> **What the detached process does.** `python -m debugpy` starts debugpy's server first. That server is what a debugger client connects to. Two options control it:
> 
> - `--listen "0.0.0.0:$PORT"` accepts connections on every network interface in the container. Compose publishes container port 5678 to host port 5678 (the `ports:` mapping in [W1.4]). A connection arriving through that mapping comes from outside the container's own loopback, so a server listening only on `127.0.0.1` would not be reachable that way.
> - `--wait-for-client` holds the program before `-m orders.main` runs. None of your service code runs until a debugger attaches, so breakpoints near the start of `main` still get hit.
> 
> **What the exit code tells you, and what it doesn't.** The script runs under `set -euo pipefail`, so any failing command stops it. With `-d`, though, the exit code of `docker exec` only says that Docker started the process. It says nothing about whether debugpy started listening. Suppose debugpy fails right after starting, for example because the port is already taken. The script still exits 0, and with `-d` that error output never reaches the task terminal.
> 
> **Two things now run at the same time.** The editor moves on to attach (next step, [W1.8]). Meanwhile, Python inside the container is still importing debugpy and opening the port. The script never checks that the port is listening, so nothing in the code makes sure the listener is ready before the attach. Which comes first depends on timing.

**Behind Show more**

> **What can go wrong when the attach arrives first.** The attach config in [W1.1] connects to `localhost:5678`. If that connection arrives before debugpy is listening, it is refused, or Docker's port forwarder may accept it and then close it. Whether VS Code's debugpy extension retries is not defined in this repository, so the code does not show what happens next. One usual fix is to have the script poll the port before exiting, for example by retrying `docker exec … python -c` with a socket connect until it succeeds or a timeout runs out. That would also turn a startup failure into a non-zero exit code. This is an observation, not something the change does.
> 
> **Starting the session a second time.** Each run of the task starts another detached debugpy, and nothing stops the previous one. If an earlier session's process is still in the container (for example, the service is still running after the debugger disconnected), the new one cannot bind `0.0.0.0:5678`. As described above, that failure is silent, and the editor may end up attaching to the old process. Whether the old process is still alive depends on how the service and debugpy behave after disconnect, which this line does not decide.
> 
> **The port is configurable in only one place.** `PORT` comes from `DEBUG_PORT` (the task sets it to `"5678"`), but compose publishes a fixed `5678:5678` and the launch config connects to a fixed `5678`. If you change `DEBUG_PORT` on its own, debugpy listens on a port that is neither published nor attached to.
> 
> **Who owns the files the service writes.** `docker exec` runs as the container's default user. This compose file sets no `user:`, so that is root. That is why the earlier step [W1.6] gives `/workspace/logs` to the host user: the service started here runs as root and writes its log there in [W1.9].
> 
> **Compared with base.** The base revision has no `scripts/` directory and no `tasks.json`, so this detached start is entirely new in the target.

## W1.3 · The script checks that the container is running

The a condition and a failure path the main picture needs step; code: `scripts/start-debugger.sh, target lines 3–11`.

**Shown first in the Step panel, in every profile (the planner's summary of the step, written before the profile is known):**

> The script reads the container name and port, and stops with a hint if the container is not running.

### Essentials

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

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

##### variant, sample 1

**Before Show more**

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

##### baseline, sample 2

**Before Show more**

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

##### variant, sample 2

**Before Show more**

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

##### diagnostic: variant without the planner's briefs, sample 1

**Before Show more**

> This is the script's guard: it decides which container the rest of the script works on, and it refuses to go further unless that container is already running. **The script never starts the container itself.** The developer has to bring it up beforehand, and the hint printed here (`docker compose up -d dev`) tells them how.
> 
> `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. The task in W1.2 sets these to `orders-dev` and `5678`, and the script falls back to the same values when it is run without them. The running check uses `docker inspect`. If the container is stopped, or doesn't exist at all, the check fails and the script exits with 1. Walk W2 follows that failing branch back to VS Code. On the success path, the next step (W1.4) shows where `orders-dev` is defined.

**Behind Show more**

> - **One check covers both cases.** `docker inspect`'s error output is thrown away (`2>/dev/null`). A missing container produces empty output, and a stopped one produces `false`. Both differ from `true`, so both cases print the same message.
> - **The port is set in more than one place.** `PORT` is only used later, as debugpy's listen port inside the container (W1.7). The host side is fixed separately: compose publishes `5678:5678`, and the debug configuration connects to `localhost:5678` (lines 8–9 of `compose.yaml` and line 9 of `.vscode/launch.json`, target). Changing `DEBUG_PORT` in the task alone would make the editor try to attach to the wrong port.
> - **Strict mode.** `set -euo pipefail` means any later `docker exec` that fails also stops the script with a non-zero code. That failure blocks the attach in the same way as the explicit `exit 1` here.

##### diagnostic: variant without the planner's briefs, sample 2

**Before Show more**

> This is where the script that the pre-launch task started (W1.2) does its first work. It decides which container and port to use, then makes sure the container is already up. **The script never starts the container. It only checks that it is running.** If it isn't, the script stops with a non-zero exit code and a hint to run `docker compose up -d dev`. The next step shows where that container is defined.
> 
> `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. The task sets both, so the defaults `orders-dev` and `5678` only matter when the script is run by hand. W2 follows what happens in VS Code when this check fails.

**Behind Show more**

> - **Every failure looks the same.** `docker inspect` writes its errors to `/dev/null`, and the script treats anything other than the exact output `true` as "not running". So a stopped container, a missing container and an unreachable Docker daemon all produce the same "Container … is not running" message. In the last case, the hint to run `docker compose up -d dev` won't help. `set -e` doesn't stop the script early here: the failing `docker inspect` runs inside a command substitution that is an argument to `[`, and only the result of `[` decides the branch.
> - **The settings live in several files.** The container name `orders-dev` must match `container_name` in `compose.yaml` (target, line 4). The port 5678 appears in three places: `DEBUG_PORT` in the task, `connect.port` in the debug configuration (`.vscode/launch.json`, target, line 9) and the published port in `compose.yaml` (target, line 9). Changing only `DEBUG_PORT` would make debugpy listen on a port that is neither published nor the one the editor connects to.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This is the script's guard step. It is new in this change, as is the whole script; the base revision has no `scripts/` folder. As we saw in [W1.2], the pre-launch task runs the script with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Here the script settles those two values. Then it refuses to go on unless the container is actually running. The script doesn't start the container itself; that stays a manual `docker compose up -d dev`.
> 
> What matters for the walk:
> 
> - **The script fails fast.** `set -euo pipefail` makes the script exit with a non-zero code when any later `docker exec` step fails. The task's result is the script's exit code, and VS Code attaches only if the task succeeds. So any failure in this script, including this check, stops the attach.
> - **The defaults only apply when you run the script by hand.** The fallbacks `orders-dev` and `5678` are the same values the task passes. `PORT` isn't used in this step; it's used when debugpy starts listening in [W1.7].
> - **The check passes only on an exact `true`.** If the container is running, the walk continues. If the container is stopped or doesn't exist at all, the check fails the same way: the script prints a hint to stderr and exits with 1. That branch is followed in [W2.1].
> 
> The name `orders-dev` matches the `container_name` that the compose file sets for the `dev` service, shown in the next step [W1.4].

**Behind Show more**

> **Why a missing container fails the check too.** For a container that doesn't exist, `docker inspect` fails, and `2>/dev/null` discards its error message. Its stdout is then empty, so the comparison with `"true"` fails. Strict mode doesn't stop the script there: the failure happens inside a command substitution that is part of an `[ … ]` test, and `-e` doesn't apply in an `if` condition. So control reaches the hint in both cases. A side effect is that other `docker inspect` failures look exactly like "not running" — for example, Docker not being reachable at all. Either way the user gets the same `docker compose up -d dev` hint.
> 
> **`DEBUG_PORT` changes only one end of the connection (observation).** `DEBUG_PORT` changes only the port debugpy listens on inside the container. The compose file publishes `5678:5678`, and the debug configuration connects to `localhost:5678`. Both are fixed values. If the task passed a different port, the script would still run without error, but VS Code would not be able to connect. Today the values match, so this only matters if someone changes one of them.

##### variant, sample 1

**Before Show more**

> This is the script's guard. It uses the settings from `DEV_CONTAINER` and `DEBUG_PORT` (with defaults), then checks that the container is already running. If it isn't, the script stops at once with a hint. **The script never starts the container. It expects someone to have run `docker compose up -d dev` first.**
> 
> Recall from W1.2 that the pre-launch task runs this script with both variables set. The script's exit code is the task's result. Because of `set -euo pipefail`, a failed `docker exec` in any later step also ends the script with a non-zero code. Every failure in this walk therefore reaches VS Code the same way, and VS Code then skips the attach.
> 
> The check passes only when `docker inspect` prints exactly `true`. Two other cases fail it:
> - The container exists but is stopped.
> - No container has that name. The error is discarded, so the output is empty.
> 
> In both cases the script prints the hint to stderr and exits with 1. W2 follows that branch. In this walk the container is running, so the script goes on to set up debugpy (W1.5). The next step (W1.4) shows that `orders-dev` is the `container_name` set in the compose file.

**Behind Show more**

> **The defaults only matter for manual runs.** `${VAR:-default}` also covers a variable that is set but empty, and it keeps `-u` from failing when the script runs outside the task. The task passes the same values as the defaults (`orders-dev`, `5678`), so the fallbacks only apply when someone runs the script by hand.
> 
> **`DEBUG_PORT` doesn't change the port end to end (my observation from the target files).** `PORT` is used in only one place: debugpy's `--listen "0.0.0.0:$PORT"` inside the container (W1.7). Two other settings fix the port at 5678 on their own:
> - the compose file publishes `"5678:5678"`
> - the launch configuration connects to `localhost` port `5678`
> 
> If you changed only `DEBUG_PORT` in the task, debugpy would listen on a port that is neither published nor the one VS Code attaches to. The variable looks like a knob, but in practice it has to stay at 5678 unless all three places change together.
> 
> **The check doesn't use the compose service name.** It looks up the container by name (`container_name: orders-dev`), not by `dev`. If the container was started under a different name, it fails even when the service is running.
> 
> **The script is new in this change.** The base revision has no `scripts/` folder, so there is no earlier version to compare with.

##### baseline, sample 2

**Before Show more**

> This is the script's guard. The task from the previous step [W1.2] started it with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Before the script runs anything inside the container, it settles which container to use and checks that the container is up. The script is new in this change; the base revision has no `scripts/` folder.
> 
> **Why it matters:** the script's exit status is the result of the pre-launch task, and that result decides whether VS Code attaches. `set -euo pipefail` makes any failing command end the script with a non-zero status. So a failure in this check, or in any later `docker exec` step, means no attach.
> 
> **The check:** the script continues only when `docker inspect` reports the container's running state as exactly `true`. Two cases fail it:
> - **The container exists but is stopped.** The output is `false`.
> - **No container has that name.** `docker inspect` fails, its error goes to `/dev/null`, and the captured output is empty.
> 
> In both cases the script prints a hint to run `docker compose up -d dev` and exits with 1. W2 follows that path. This walk continues with the container running.
> 
> **Defaults:** `orders-dev` and `5678` are the same values the task passes, so the defaults only matter when someone runs the script by hand. `PORT` is not used here; it is used when debugpy starts listening [W1.7].

**Behind Show more**

> Some points that affect how far the check and the defaults can be trusted:
> 
> - **The two failure cases look the same.** A missing container and a stopped one produce the same message. A typo in `DEV_CONTAINER` therefore shows up as "not running" rather than "no such container". The hint also assumes the name refers to the `dev` service, which only holds while compose's `container_name: orders-dev` matches [W1.4].
> - **Why the `:-` form is needed.** Under `-u`, a plain `$DEV_CONTAINER` would abort the script when it runs outside the task. The `:-` form also falls back when the variable is set but empty.
> - **Changing the port in one place is not enough (my observation).** `DEBUG_PORT` only changes the port debugpy listens on inside the container. The attach target in `launch.json` (`port: 5678`) and the published port in `compose.yaml` (`"5678:5678"`) are both fixed. If you set `DEBUG_PORT` to anything else, you also have to change those two files; otherwise the attach does not reach debugpy [W1.8].
> - **This check only proves the container was running at that moment.** The later `docker exec` steps can still fail, for example if the container stops in between. `-e` turns any such failure into a failed task as well.

##### variant, sample 2

**Before Show more**

> This is the script's guard step. Before it runs anything inside the container, it decides which container and port to use and stops early if that container isn't running. The script is new in this change: `base` has no `scripts/` folder.
> 
> The important consequence is in `set -euo pipefail`. With it, any later `docker exec` that fails ends the script with a non-zero code. That code is the result of the pre-launch task we saw in [W1.2], so a failure here or later in the script means VS Code doesn't attach. The `-u` flag would also make an unset variable fatal. The `:-` defaults avoid that, so the script still works when you run it by hand without the task's environment.
> 
> The running check gives one of two outcomes:
> - **Running:** `docker inspect` prints exactly `true`, and the script goes on to set up debugpy. This walk follows that path.
> - **Anything else:** the container is stopped (`false`) or doesn't exist (empty output, with the error discarded). The script prints the `docker compose up -d dev` hint to stderr and exits 1. [W2.1] follows this branch.
> 
> `PORT` isn't used in this step. It's only read when debugpy starts listening in [W1.7].

**Behind Show more**

> **What the defaults actually cover.** The task always passes `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Those are the same as the fallbacks, and `orders-dev` is also the `container_name` in `compose.yaml` ([W1.4]). Inside VS Code, then, the defaults never take effect.
> 
> **The port is set in three places.** Changing `DEBUG_PORT` alone would not move the debugger. It changes where debugpy listens inside the container, but two other values stay at 5678: the port that `compose.yaml` publishes (`"5678:5678"`) and the attach target in `launch.json` (`connect.port: 5678`). If you changed only the variable, the attach would fail. I found this while reading the code; it is not one of the review's findings.
> 
> **Why only an exact `true` passes.** The command substitution sits inside `[ ... ]`. A missing container makes `docker inspect` fail, but that failure doesn't trigger `set -e` here: the substitution only produces the string being tested, and the `!=` test decides which branch runs. Because only the exact string `true` passes, a missing container and a stopped one end at the same exit 1.

### Standard

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> The task from the previous step started this script with `DEV_CONTAINER` and `DEBUG_PORT` in its environment. Before the script runs anything in the container, it settles those two values and makes sure the container is up.
> 
> **Strict mode.** `set -euo pipefail` makes the script stop at the first command that fails (`-e`). It also turns the use of an unset variable into an error (`-u`), and makes a pipeline fail when any part of it fails (`pipefail`). This matters for the whole walk: the script's exit code is the task's result, and VS Code uses that result to decide whether to attach. Any failure in the later `docker exec` steps therefore ends the script with a non-zero code, and VS Code does not attach.
> 
> **Defaults.** `${DEV_CONTAINER:-orders-dev}` and `${DEBUG_PORT:-5678}` use the value from the environment if it is set and not empty, and the fallback otherwise. The `:-` form also keeps `-u` from failing when the script runs outside the task. The defaults match what the task passes, so they only matter when someone runs the script by hand. `PORT` is not used in the check. It is used later, when debugpy starts listening (W1.7).
> 
> **The running check.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false` for an existing container. The script continues only if the output is exactly `true`:
> - If the container is running, the output is `true`, and the script continues. This walk follows that case.
> - If the container exists but is stopped, the output is `false`. The script prints the `docker compose up -d dev` hint to stderr and exits with 1. W2 follows this branch.
> - If no container has that name, `docker inspect` fails. Its error message is discarded by `2>/dev/null` and its output is empty, so the comparison goes to the same branch.

**Behind Show more**

> **Why `-e` doesn't stop the script on a failed inspect.** `docker inspect` fails for a missing container, but `-e` does not end the script there. The failing command runs inside `$(...)`, and its output is only an argument to the `[` test in an `if` condition. Bash does not apply `-e` to commands in an `if` condition, so the failure just becomes an empty string that the test compares.
> 
> **Other failures get the same hint.** Reading the code, I expect a few other failures to end up in the "not running" branch too. This is my inference, not something I ran:
> - The Docker daemon is not reachable.
> - The `docker` command is not installed. Bash's "command not found" message goes to the redirected stderr as well.
> - `docker inspect` finds a different kind of Docker object with that name, for example an image called `orders-dev`. That object has no `.State.Running`, so the template fails and the output is not `true`.
> 
> In each case the developer sees the hint to start the container, even though the real cause is something else.
> 
> The container name `orders-dev` that the default and the task both use is defined by `container_name` in the compose service. The next step shows that service.

##### variant, sample 1

**Before Show more**

> The task from the previous step has started the script, and the script's first job is to make sure there is a container to work in.
> 
> **Settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`, the two variables the task's `env` passed in. The form `${VAR:-default}` uses the default when the variable is unset or empty. The defaults, `orders-dev` and `5678`, are the same values the task passes, so when the script runs from the task the defaults are never used. They only matter if someone runs the script by hand. `CONTAINER` is used in every `docker` command that follows. `PORT` is not used until the debugpy start in step W1.7.
> 
> **Strict mode.** `set -euo pipefail` makes the script stop at the first command that fails (`-e`). It also treats an unset variable as an error (`-u`), and makes a pipeline fail if any command in it fails (`-o pipefail`). This matters for the task: whatever stops the script gives a non-zero exit code, and VS Code reads that as a failed pre-launch task.
> 
> **The running check.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false` for an existing container. The script compares its output with the exact string `true`, so any other output takes the error branch:
> 
> - **Container stopped:** the output is `false`.
> - **Container does not exist:** `docker inspect` writes an error to stderr and prints nothing. `2>/dev/null` discards the error, so the comparison sees an empty string.
> 
> `set -e` does not stop the script when `docker inspect` fails inside `$( … )`. The substitution is only an argument to `[`, and `[` itself succeeds, so the script goes on to its own message and `exit 1`.
> 
> This walk continues on the path where the container is running. The failing branch, and what VS Code then shows the developer, is walk W2. The next step leaves the script for a moment to look at the compose service that defines `orders-dev`.

**Behind Show more**

> If the `docker` command itself is missing or cannot reach the Docker daemon, the substitution also comes back empty. The script then reports "Container … is not running", which hides the real cause.
> 
> The check only tells you that the container is running at this moment. It says nothing about the container's contents, such as whether debugpy is installed or the repository is mounted at `/workspace`. The next lines of the script and the compose service in step W1.4 deal with those.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> The script is new in this change; the base revision has no `scripts/` folder. As we saw in [W1.2], the task "Start debugger in dev container" runs it before VS Code attaches. This first part decides which container the remaining `docker exec` calls go to, and makes sure there is a running container to send them to.
> 
> **Which container and port.** `${VAR:-default}` uses the default when the variable is unset *or* empty. The task sets `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`, and the defaults are the same values. So running the script from a terminal behaves just like running it through VS Code. `orders-dev` matches the `container_name` in `compose.yaml`, which the next step [W1.4] shows.
> 
> **Strict mode.** `set -euo pipefail` sets three options:
> - `-e`: stop at the first failing command.
> - `-u`: treat an unset variable as an error.
> - `-o pipefail`: a pipeline fails if any command in it fails.
> 
> `-e` matters most for the later steps. If `pip install`, `mkdir`, `chown` or the final `docker exec -d` fails, the script ends with a non-zero code, and VS Code treats the pre-launch task as failed.
> 
> **The running check.** `docker inspect -f '{{.State.Running}}'` prints `true` or `false`. Any output other than `true` leads to the hint on stderr and `exit 1`. There are two failing cases:
> - **Stopped container:** the output is `false`.
> - **Container that doesn't exist:** `docker inspect` fails. `2>/dev/null` hides its error and the substitution gives an empty string.
> 
> `set -e` doesn't stop the script on the failed `docker inspect`. The failure happens inside a command substitution that is only an argument to `[`, and `-e` looks at the exit status of `[`. So the script reaches the `if` and prints its own hint, not a raw Docker error. The same is true when the `docker` command itself is missing: Docker's error text is hidden, and the developer sees "is not running".
> 
> This walk continues on the branch where the check passes. Walk W2 follows the failing branch ([W2.1]).

**Behind Show more**

> **The port setting only reaches one of three places.** In the script, `PORT` is used only in the final `debugpy --listen "0.0.0.0:$PORT"` (target `scripts/start-debugger.sh` line 24). Two other places have `5678` written in directly:
> - `compose.yaml` publishes `"5678:5678"`.
> - `launch.json` connects to `localhost:5678`.
> 
> So if you change `DEBUG_PORT` in the task alone, debugpy listens on a port that isn't published, and the attach fails. I'm noting this from reading the code, not as a confirmed problem. The defaults and the task values agree, so nothing breaks as the code stands.
> 
> **What the check doesn't cover.** It only checks that a container with that name is running. It doesn't check that it was started from this project's compose file, or that `/workspace` is this workspace. Any running container named `orders-dev` passes. Later steps rely on the bind mount (`.:/workspace` in `compose.yaml`) for the log folder and for `orders.main` to import.

##### variant, sample 1

**Before Show more**

> This is the script's first gate. The pre-launch task from [W1.2] starts it with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` set. Before the script runs anything inside a container, it makes sure the container is there and running. The whole script is new in this change: the base revision has no `scripts/` folder.
> 
> **How the check works.** `docker inspect -f '{{.State.Running}}'` prints the Go-template field `State.Running` of the named container. That is the text `true` or `false`. The `$(...)` captures this output, and `[ ... != "true" ]` checks for the exact string `true`. Anything else counts as "not running":
> 
> - **Stopped container:** the output is `false`.
> - **No such container:** `docker inspect` fails. `2>/dev/null` hides its error message, and the captured output is empty.
> 
> Both cases print the same hint on stderr (`>&2`) and end with `exit 1`. VS Code then reports the task as failed, which is walk [W2.1]/[W2.2].
> 
> **How this fits with `set -euo pipefail`.** `-e` stops the script at the first failing command, and later steps rely on that. Here, though, a failed `docker inspect` does not stop the script. It runs inside a command substitution that is an argument to `[`. Only `[`'s own exit status counts, and that status is the result of the string comparison. So this part reports a missing container through the explicit comparison, not through `-e`. `-u` makes the script fail if it reads a variable that was never set. `${VAR:-default}` avoids that and also covers a variable that is set but empty.
> 
> **The settings.** `CONTAINER` falls back to `orders-dev`, which is the `container_name` of the `dev` service in the compose file (next step, [W1.4]). The hint's `docker compose up -d dev` starts exactly that service. `PORT` falls back to `5678`, which is what the task passes. So the script behaves the same when you run it by hand.

**Behind Show more**

> **`PORT` only looks configurable.** Here `PORT` is only read. Its one use is the port debugpy listens on inside the container ([W1.7]). The other two places that depend on it are fixed. The compose file publishes `"5678:5678"`, and the debug configuration connects to `localhost` port `5678` ([W1.8]). If you change `DEBUG_PORT` in the task alone, debugpy listens on a port that is neither published nor the one VS Code dials, and the attach fails. The same applies to `DEV_CONTAINER`: the hint always says `docker compose up -d dev`, but the compose service only creates a container named `orders-dev`. The variable lets you point the script at another container, but the hint would then be wrong.
> 
> **A misleading message in one more case.** The only thing the check looks at is the captured output. So the "not running" hint also appears in these cases:
> 
> - `docker` is not on the `PATH`.
> - The Docker daemon is not reachable.
> - The user has no permission to talk to it.
> 
> In all of them stderr is discarded, the output is empty, and the developer is told to start the container, which also fails. This is an observation about the code's behaviour, not something the review has marked as a finding.
> 
> **Running is not the same as ready.** The check passes once `State.Running` is `true`. The compose service's command is `sleep infinity`, so "running" here means the container is idle and ready for `docker exec`. The script doesn't expect the service to be up yet, because it starts the service itself in a later step.

### Teacher

#### Writer (walk plan context)

##### baseline, sample 1

**Before Show more**

> The task from the previous step started this script. The script now has to answer one question before it does anything inside Docker: **is the dev container actually running?** Every later command in the script uses `docker exec`, and that only works in a running container.
> 
> **`set -euo pipefail`** changes how bash handles errors for the rest of the script. By default bash just moves on to the next line when a command fails. With this line:
> 
> - `-e`: the script stops as soon as a command fails, and that failure becomes the script's exit code. This matters later in the walk: a failed `docker exec` stops the script, so the task also fails.
> - `-u`: using a variable that was never set is an error, not a silent empty string.
> - `-o pipefail`: a pipeline such as `a | b` fails if any part of it fails, not only the last part. This script has no pipelines, so this flag has nothing to act on here.
> 
> **The two settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`, which the task put into the environment in the previous step. The form `${DEV_CONTAINER:-orders-dev}` means "use the variable's value, or `orders-dev` if it is unset or empty". It does not break the `-u` rule, because the default covers the missing case. So the script also works when you run it by hand from a terminal. The defaults are the same values the task passes. That means the container name and port are written in two places that must match.
> 
> **The running check.** `docker inspect -f '{{.State.Running}}' "$CONTAINER"` asks Docker for the container's details. It prints only the `Running` field, as the text `true` or `false`. `$( … )` captures that text, and the `[ … != "true" ]` test compares it.
> 
> - **Stopped container:** Docker prints `false`, so the test fails.
> - **No container with that name:** `docker inspect` writes an error and exits non-zero. `2>/dev/null` throws away the error text, so the captured string is empty and the test fails the same way. The `-e` rule does not stop the script here, because a command whose result is tested by `if` doesn't trigger `-e`.
> 
> In both cases the script prints the `docker compose up -d dev` hint to stderr and exits with 1. That branch is followed in W2.1.
> 
> This walk takes the other outcome: Docker printed `true`, so the script goes on past the `if`. The next step looks at the compose service that the name `orders-dev` is expected to refer to.

**Behind Show more**

> The check accepts exactly one answer: the text `true`. Anything else counts as "not running". This also covers cases the hint doesn't mention. Reading the code, if the `docker` command is missing from the PATH, or the Docker daemon can't be reached, the substitution also comes out empty, because its stderr is discarded. The developer would then see "Container orders-dev is not running" when the real cause is that Docker itself isn't available. This is what the code allows, not something observed running.
> 
> The check is a snapshot taken at one moment. If the container stops between this check and the `docker exec` calls after it, those calls fail. Because of `-e`, the script then stops with Docker's own error and does not print this hint.

##### variant, sample 1

**Before Show more**

> Here the task from the previous step has started the script in a host shell, with `DEV_CONTAINER` and `DEBUG_PORT` in its environment. Before the script touches the container, it sets strict error handling, picks up its two settings and makes sure the container is up.
> 
> **Strict mode.** `set -euo pipefail` turns on three Bash options:
> - `-e`: the script exits as soon as a plain command fails, meaning it returns a non-zero exit status.
> - `-u`: using a variable that was never set is an error. It does not silently become an empty string.
> - `-o pipefail`: a pipeline fails if any command in it fails, not only the last one.
> 
> This matters for the whole walk. VS Code judges the task only by the script's exit code (step W1.2), so `-e` is what turns a failed `docker exec` in later steps into a failed task.
> 
> **Settings with defaults.** `${DEV_CONTAINER:-orders-dev}` means "the value of `DEV_CONTAINER`, or `orders-dev` if it is unset or empty". `PORT` works the same way, with `5678` as its default. The `:-` form is also safe under `-u`. The defaults match what the task passes, so they only take effect when someone runs the script without the task, for example by hand in a terminal.
> 
> **The running check.** `docker inspect -f '{{.State.Running}}' "$CONTAINER"` asks Docker for one field of the container's state. The `-f` option takes a Go template, and this one prints only that field, so the output is `true` or `false`. `$( … )` captures that output as a string, and the `[ … != "true" ]` test compares it with the exact text `true`.
> 
> **The container is running**, so the output is `true`, the test is false and the script skips the `if` body. That is the path this walk follows next.
> 
> If the container is stopped or does not exist, the script prints a hint to stderr and exits with 1. Walk W2 follows that branch.

**Behind Show more**

> **How `2>/dev/null` covers a missing container.** If no container has that name, `docker inspect` writes nothing to stdout. It writes an error message to stderr and exits with a non-zero status. `2>/dev/null` discards that error text, so the captured string is just empty, and an empty string is not `"true"`. A stopped container and a missing container therefore end up in the same branch, and the developer sees only the script's own hint, not Docker's error.
> 
> **Why `-e` doesn't stop the script here.** The failing `docker inspect` sits inside a command substitution, and that substitution is an argument to the `[` test. Only the exit status of the test counts for the `if`. Commands tested by an `if` are exempt from `-e` anyway. So a failing `inspect` leads to the hint and `exit 1`, not to an early silent exit.
> 
> **A case the check can't tell apart (my reading of the code, not something observed running):**
> - Docker isn't installed, or the Docker daemon can't be reached.
> - `docker inspect` fails, and its error is also discarded.
> - The script then says the container "is not running" and suggests `docker compose up -d dev`. That message would point the developer in the wrong direction.
> 
> **What the check proves.** It confirms only that a container with this name is running when it runs. It doesn't confirm that this is the container defined in `compose.yaml`, with the expected mount and port. That link rests on the name alone, and the next step shows where the name is defined.

#### Profile switch (existing explanation as material)

##### baseline, sample 1

**Before Show more**

> This is the first code that runs on the host after the editor starts the task. As [W1.2] showed, the task "Start debugger in dev container" runs this script with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in its environment. What the task needs back is one exit code: zero means "go ahead and attach", and anything else means "stop". These lines decide which settings the script uses and whether there is a container to work with at all. The script is new in this change; the base revision has no `scripts/` folder.
> 
> **Strict mode: how a failure gets back to VS Code.** By default, bash carries on after a command fails. `set -euo pipefail` changes three things:
> - `-e`: the script exits as soon as a command fails.
> - `-u`: using a variable that was never set is an error, not an empty string.
> - `pipefail`: a pipeline such as `a | b` fails if any part fails, not only the last command.
> 
> This matters for the whole walk. Each later `docker exec` (W1.5–W1.7) can fail, and `-e` turns any such failure into a non-zero exit of the script. That makes the task fail, and the editor does not attach (that path is shown in [W2.2]). You can think of it as the shell version of "an unhandled exception ends the program".
> 
> **Defaults that also work with `-u`.** `${DEV_CONTAINER:-orders-dev}` means "use `DEV_CONTAINER` if it is set and not empty, otherwise use `orders-dev`". Because of the fallback, `-u` has nothing to complain about when someone runs the script by hand without these variables. The fallbacks are the same values the task passes, and `orders-dev` is also the `container_name` in the compose file ([W1.4]). So with or without the task, the script looks for the same container. `PORT` is not used here; it is used in [W1.7], where debugpy starts listening.
> 
> **The running check.** `docker inspect -f '{{.State.Running}}' NAME` looks up the object called NAME. The `-f` option takes a Go template that picks one field, so for a container it prints just `true` or `false`. The `$( … )` around it captures that output as a string, and `[ … != "true" ]` compares the string. The script continues only when the output is exactly `true`. Everything else goes into the `if`:
> - **Container running:** the output is `true` and the script continues. This walk follows that case.
> - **Container exists but is stopped:** the output is `false`. The script prints the hint to stderr (`>&2`) and runs `exit 1`. [W2.1] follows this branch.
> - **No container with that name:** `docker inspect` fails, `2>/dev/null` discards its error message, and the captured output is empty. Empty is not `true`, so this ends in the same branch.
> 
> One thing that may look surprising under `-e`: in the last case, `docker inspect` fails, but the script does not exit at that point. The failing command is inside a command substitution that only builds an argument for `[`. Only the exit status of `[` counts, and bash does not apply `-e` to the condition of an `if`. That is why the script reaches its own clear message instead of dying silently.

**Behind Show more**

> **Why "compare to `true`" is a safe design.** The check accepts one exact value instead of trying to recognise failure. So any outcome nobody planned for ends in the error branch, not in a script that carries on against a container that isn't there. A few cases that are not listed above show this:
> - **Docker not installed, or the Docker daemon not running:** `docker inspect` fails and the output is empty. The script says "Container orders-dev is not running" and suggests `docker compose up -d`. That is the safe outcome, but the message points at the container when the actual cause is Docker itself. This is my reading of the code, not something I saw happen.
> - **A non-container object with the same name:** without `--type container`, `docker inspect` can also match an image, a volume or a network. Those have no `.State`, so the template fails and the output is empty again. The result is still "not running", which is safe.
> - **Container restarting or paused:** `.State.Running` describes the container's state flags, and the script trusts it as it is. This step does not check whether the container is healthy or ready, only whether Docker reports it as running.
> 
> **The port is set in more than one place.** `DEBUG_PORT` lets you change the port the script passes to debugpy. But the launch configuration connects to the fixed port `5678` (`.vscode/launch.json` lines 9 in target), and compose publishes `"5678:5678"` (`compose.yaml` line 9 in target). Changing only `DEBUG_PORT` in the task would make debugpy listen on a port that is neither published nor the one the editor connects to. This is an observation from reading the files, not a finding of the review. In practice, the variable is only safe to change together with those two places.
> 
> **What is known once these lines are done.** The variables are set, and Docker reported the named container as running when it was checked. Nothing locks that state in. If the container stops between this check and the later `docker exec` calls, those calls fail, and `-e` again ends the script with a non-zero code. The check gives a friendly message for the common case; strict mode handles the rest.

##### variant, sample 1

**Before Show more**

> This step is the script's first check. In the previous step [W1.2], the pre-launch task started `start-debugger.sh` with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` in its environment. The task needs one thing back from the script: its **exit code**. Exit code 0 means success and VS Code goes on to attach. Any other code means failure and the attach does not happen. Everything in these lines helps make that exit code tell the truth. The whole script is new in this change; the base revision has no `scripts/` folder.
> 
> **Strict mode turns failures into a non-zero exit.** By default, bash keeps going after a command fails, and the script's exit code is the status of whatever ran last. A failed `docker exec` in the middle could then be hidden by a later command that succeeds. `set -euo pipefail` changes three rules:
> - `-e`: stop as soon as a command fails.
> - `-u`: treat use of an unset variable as an error.
> - `pipefail`: a pipeline fails if any command in it fails, not only the last one.
> 
> This script has no pipes, so `pipefail` is just a precaution. The rule that matters is `-e`: if a later `docker exec` step fails (W1.5–W1.7), the script ends right there with a non-zero code.
> 
> **Defaults through parameter expansion.** `"${DEV_CONTAINER:-orders-dev}"` means "use the value of `DEV_CONTAINER` if it is set and not empty, otherwise use `orders-dev`". This form is also allowed under `-u`, so you can run the script by hand without setting either variable. The defaults are the same values the task passes, so they only matter for manual runs. `PORT` is not used here; the last step that runs inside the container uses it [W1.7].
> 
> **The running check.** `docker inspect -f '{{.State.Running}}' NAME` looks up the container and prints one field of its state. The `-f` argument is a Go template, and the result is the text `true` or `false`. `$( … )` captures that output as a string, and `[ … != "true" ]` compares it. There are three cases:
> - **Running:** the output is `true`, the test is false, and the script continues. This walk follows that case.
> - **Exists but stopped:** the output is `false`. The script prints the hint to stderr (`>&2`) and runs `exit 1`. The other walk, "When the dev container is not running", follows this branch [W2.1].
> - **No container with that name:** `docker inspect` fails and writes an error. `2>/dev/null` discards the error, so the captured string is empty. Empty is not `"true"`, so the script takes the same exit-1 branch.
> 
> The name `orders-dev` is not arbitrary. It matches the `container_name` that the compose file gives the `dev` service, as the next step shows [W1.4].

**Behind Show more**

> **Why `-e` does not stop the script when `docker inspect` fails.** In the "no such container" case, the `docker inspect` command fails, yet the script does not stop at line 8 and prints its own message instead. Two rules explain this:
> - Bash ignores `-e` for any command that is the condition of an `if`.
> - The status `[` reports comes from the comparison, not from the command inside `$( … )`.
> 
> So a failed `docker inspect` here only produces an empty string, and the explicit `exit 1` ends the script. That is the intended behaviour: the reader gets the `docker compose up -d dev` hint instead of Docker's raw error. The same rule explains the debugpy check in a later step [W1.5], which uses `if ! docker exec …` on purpose so that a failure means "not installed" and does not abort the script.
> 
> **What `exit 1` causes.** VS Code sees a non-zero exit from the pre-launch task and does not attach. The other walk shows that effect [W2.2]. The message goes to stderr so it shows as an error in the task terminal and does not mix with normal output.
> 
> **What the check does not guarantee.** These are my own reading of the code, not something verified by running it:
> - The check is a single snapshot. If the container stops between line 8 and the later `docker exec` calls, those calls fail and `-e` ends the script with a non-zero code. The attach is still blocked, but the reader sees Docker's error and not the friendly hint.
> - An exact match on `"true"` also sends a paused container down the "not running" path only if Docker reports `false` for it. As far as I know, `State.Running` stays `true` for a paused container, so the check would pass and a later `docker exec` would fail. Nothing in this repository settles that point.
