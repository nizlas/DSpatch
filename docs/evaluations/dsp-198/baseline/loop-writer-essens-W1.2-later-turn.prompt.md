DSPATCH-REVIEW-TASK: write-step

## This step: W1.2 The pre-launch task runs the script
Walk W1 (walk): Starting "Debug orders in the dev container". Follow the F5 press from the launch configuration through the pre-launch task and the script into the container, and back to the editor's attach.
Summary: A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.
- The "Start debugger in dev container" task: .vscode/tasks.json (To) lines 4–10 — reached from preLaunchTask in the debug configuration (.vscode/launch.json target 8–8)
The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.
The planner's brief, written for every profile: The configuration reaches this task through its `preLaunchTask` value, which matches this `label` exactly. Explain that the task is an ordinary shell task, not a background task, and has an empty `problemMatcher`. VS Code therefore treats the task as finished when the script exits and judges it by the exit code. Then it attaches. Point out that `DEV_CONTAINER` and `DEBUG_PORT` are passed here and that the script reads them next.
The step before: W1.1 The debug configuration now attaches — The configuration changes from launching orders.main locally to attaching after a pre-launch task.
The step after: W1.3 The script checks that the container is running — The script reads the container name and port, and stops with a hint if the container is not running.

Answer with the explanation of this step only, as before.