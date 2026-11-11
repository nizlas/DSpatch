```json
{
  "assessment": "The walks can't be followed yet. Ten of the eleven steps (W1.1–W1.6, W1.8, W1.9, W2.1, W2.2) have no text at all. The reader sees the code but gets no orientation: not the F5 → preLaunchTask → script → detached debugpy → attach course, not the failure branch that blocks the attach, and not how the steps connect. Only W1.7 has text. What it says is accurate: the exit code covers only `docker exec -d`, `--wait-for-client` holds back `orders.main`, the attach and debugpy's startup run at the same time, and `working_dir: /workspace` comes from compose. But its first part is a detailed walkthrough of several paragraphs with bullets, not the two-sentence Essentials orientation. The missing texts decide the verdict: rework. The order and choice of steps themselves fit the course, so there is no structural finding.",
  "verdict": "rework",
  "findings": [
    {
      "kind": "explanation",
      "steps": ["W1.1", "W1.2", "W1.3", "W1.4", "W1.5", "W1.6", "W1.8", "W1.9"],
      "problem": "No explanation was written for these steps. The walk from F5 to the attach has text only at W1.7. The reader isn't told what each place does in the course or where the walk goes next. Examples: W1.1 doesn't say the configuration is an attach with a pre-launch task. W1.2 doesn't say the shell task runs the script with the container name and port. W1.4 doesn't say the dev service is the `orders-dev` container that publishes 5678 and bind-mounts the repository at `/workspace`. W1.8 doesn't say VS Code connects to localhost:5678 and maps `${workspaceFolder}` to `/workspace`. W1.9 doesn't say that once the debugger attaches, `main` creates the log folder, logs to `orders.log` and serves on port 8000.",
      "why": "The Essentials reader needs about two sentences per step to place it in the course. Without them the walk is a list of code ranges, and W1.7 refers back to W1.2, W1.4 and the next step, none of which has any text.",
      "evidence": ".vscode/launch.json target 5–12; .vscode/tasks.json target 4–10; scripts/start-debugger.sh target 3–21; compose.yaml target 2–11; orders/main.py target 6–12."
    },
    {
      "kind": "explanation",
      "steps": ["W2.1", "W2.2"],
      "problem": "No explanation was written for the failure walk. The reader isn't told that a container that is missing or stopped makes the script print a hint and exit 1, or that VS Code then treats the pre-launch task as failed and doesn't attach.",
      "why": "The walk's stated purpose is to follow this branch back to VS Code's handling, and without text it shows only a code range and a single line.",
      "evidence": "scripts/start-debugger.sh target 8–11 (`docker inspect … .State.Running` != \"true\" → message to stderr, `exit 1`, under `set -euo pipefail` on line 3); .vscode/launch.json target 8 (`preLaunchTask`)."
    },
    {
      "kind": "explanation",
      "steps": ["W1.7"],
      "problem": "The first part is a full walkthrough, not an Essentials orientation. It explains the `-d` semantics, the script's end and the task's success, then gives bullets on `0.0.0.0:$PORT` and `--wait-for-client`, and finally a bold paragraph on the concurrency. The core fits in about two sentences: the script starts the service detached under debugpy, which waits for a debugger before running `orders.main`, and the script and the pre-launch task finish at once, so VS Code moves on to attach while debugpy is still starting. The listen-address and flag details belong after the marker. What the step says is correct.",
      "why": "For this profile the first part must be a very short orientation. Details that leak in bury the step's role, which is the hand-off from the task to the attach.",
      "evidence": "scripts/start-debugger.sh target 23–24 (a single command line plus its comment), so the size of the code doesn't justify the length."
    }
  ]
}
```