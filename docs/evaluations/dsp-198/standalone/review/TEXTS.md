# DSP-198 · Two editorial review calls: the texts

Each original as the reviewer received it, and the reviewer's whole answer split at its own heading into the revised explanation and its editorial assessment. Everything is verbatim. The whole calls, with tool calls and results, are in `run-W1.2/call.md` and `run-W1.7/call.md`. The judgment is in `JUDGMENT.md`.

## W1.2

### The original

> This task is what the debug configuration from the previous step runs before it attaches. Its job is to get the orders service running under the debugger inside the already-running dev container, so the editor has something to connect to. The task itself does very little. It names the start script and gives it the container name and port to use, and the script does the actual work.
>
> For this to stay accurate, these values have to match across files:
>
> - **Task label:** "Start debugger in dev container" must match `preLaunchTask` in `launch.json` exactly. If it doesn't, VS Code can't find the task.
> - **Port 5678:** it has to be the same here, in `launch.json`'s `connect` port, and in the port mapping in `compose.yaml`.
> - **Container name `orders-dev`:** it has to match `container_name` in `compose.yaml`.
>
> The script falls back to these same values if the variables aren't set. That means a mismatch introduced here wouldn't fail loudly; the editor would simply try to attach to the wrong place.

### The reviewer's revised explanation

> **Revised explanation**
>
> The debug configuration from the previous step runs this task before it attaches. VS Code finds the task by its label, so "Start debugger in dev container" has to match the `preLaunchTask` value in `launch.json` exactly.
>
> The task's job is to start the orders service under debugpy inside the dev container, which must already be running. That gives the editor something to connect to. The task itself does very little. It runs on the host as a shell command, calls the start script and passes it two values: the container name and the debug port. The script does the real work.
>
> VS Code waits for this task to finish before it attaches. That works because the script starts debugpy in detached mode and returns straight away. Meanwhile, debugpy holds the service until the editor connects.
>
> The two values link this task to the rest of the setup:
>
> - `orders-dev` is the `container_name` in `compose.yaml`. The script runs its commands inside that container.
> - `5678` is the port debugpy listens on inside the container. `compose.yaml` publishes container port 5678 as host port 5678, and that host port is the one `launch.json` connects to.
>
> The script uses these same values as defaults if the variables aren't set. So right now the `env` block restates the defaults rather than changing anything. It matters once someone edits it, and only then does it have to stay consistent with the other files.

### The reviewer's editorial assessment

> **Editorial assessment**
>
> - **Wrong claim about failures removed.** The original said that because of the fallbacks, a mismatch here "wouldn't fail loudly" and the editor would "attach to the wrong place." That's wrong. The fallbacks (`start-debugger.sh` lines 5–6, `${VAR:-default}`) only apply when a variable isn't set. A wrong value set here is used as given.
>   - A wrong container name fails loudly: the script checks the container, prints an error and exits 1 (lines 8–11, plus `set -e`).
>   - A wrong port makes debugpy listen on a port that isn't published (`compose.yaml` line 9). The editor still connects to 5678 (`launch.json` line 9), so the attach fails rather than reaching the wrong place.
>
>   I replaced this with what the fallbacks actually mean: the `env` block currently matches the defaults.
> - **Port rule made precise.** "Same in all three places" only works because the mapping is `5678:5678`. Each file actually links to a different side of the mapping. debugpy listens on the container side (script line 24), and `connect` uses the host side. Stating that stops a reader from changing one number and expecting the rest to follow.
> - **Added why the task can finish before attach.** This is the missing central relationship: a pre-launch task has to finish before VS Code attaches. The detached `docker exec -d` together with `--wait-for-client` (script lines 23–24) is what lets this task play that role. I kept it to one sentence because the next step covers the script.
> - **Checklist turned into prose.** The label match stays as orientation. The two remaining links are kept as a short list because each one ties this task to a different file. The bolded checklist is gone.
> - **Left out on purpose:** `problemMatcher: []`, installing debugpy and creating the log folder. None of them is needed to understand this step's role.

## W1.7

### The original

> In this last command, the script hands the service over to a separate process in the container. With `-d`, `docker exec` starts `python -m debugpy … -m orders.main` and returns straight away without waiting for it. The script then ends, and because the task is an ordinary shell task (W1.2), VS Code counts the pre-launch task as finished and successful.
>
> Inside the container, debugpy runs by itself:
>
> - it listens on `0.0.0.0:$PORT`, so it accepts connections that come in through the compose port mapping (W1.4), not only from inside the container;
> - `--wait-for-client` makes it hold `orders.main` back. The service's own code does not start until a debugger has attached.
>
> **From this point two things run at the same time:** VS Code goes on to attach (next step), and debugpy starts up and begins listening in the container. Nothing in the script or the task waits for debugpy to be ready first.

### The reviewer's revised explanation

> I found no outright factual errors in the explanation. My changes mostly sharpen what "successful" means and add one practical consequence.
>
> **Revised explanation**
>
> This last command hands the service over to a separate process in the container. With `-d`, `docker exec` starts `python -m debugpy … -m orders.main` and returns straight away without waiting for it. The script then exits with status 0. The pre-launch task is an ordinary shell task, not a background one (W1.2), so VS Code treats it as finished and successful as soon as the script exits. Here "successful" only means Docker accepted the command. It says nothing about whether debugpy actually came up.
>
> Inside the container, debugpy now runs on its own, and it keeps running after the task has ended. Because it is detached, its output and the service's output don't appear in VS Code's task terminal.
>
> - It listens on `0.0.0.0:$PORT`. That means it accepts connections arriving through the compose port mapping (W1.4), not just connections from inside the container.
> - `--wait-for-client` makes it hold back `orders.main`. None of the service's own code runs until a debugger has attached.
>
> **From this point two things happen at the same time.** VS Code goes on to attach to `localhost:5678` (next step), while debugpy starts up and begins listening in the container. Nothing in the script or the task waits for debugpy to be ready, so the attach can arrive before anything is listening.

### The reviewer's editorial assessment

> **Editorial assessment**
>
> - **"Successful" needed narrowing.** The original says VS Code counts the task as successful, which is true, but a reader could take that to mean the debugger is ready. The script's exit status only reflects whether `docker exec -d` launched the command (`set -euo pipefail` at line 3; the detached exec at line 24). If debugpy then failed, for example because the port was taken, the task would still succeed. I said this directly and linked it to the last paragraph. I also gave the actual reason VS Code waits for the script to exit: `tasks.json` defines a plain `"type": "shell"` task with no `isBackground`.
> - **Said the process outlives the task and its output isn't shown.** A reader might expect the service's output to show up in the task terminal like the earlier steps' output did. With `-d` the output goes nowhere VS Code shows. I kept this to one sentence.
> - **Stated the consequence of running in parallel.** The original says nothing waits, but stops short of the point that matters for W1.8: the attach to `localhost:5678` (`launch.json`, `connect`) can arrive before debugpy is listening. I added that in one clause and didn't explain how the attach handles it, since that belongs to the next step.
> - **Kept unchanged:** the `0.0.0.0` explanation (correct, because the compose file publishes `5678:5678`) and the `--wait-for-client` explanation (correct).
