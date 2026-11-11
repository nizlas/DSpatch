Write an orientation summary for this code-walk step. The reader is an experienced developer who can read the code and wants help seeing what it accomplishes in the larger flow. Describe the action and its significance at that level. Select the central point; leave the implementation walkthrough to the code and follow-up questions. Include any condition needed to keep that summary accurate.

The following unrelated example illustrates the level of abstraction, not a template or a required length:

Implementation walkthrough:
“The function acquires the lock, looks up the entry, creates it if missing, and signals the worker thread.”

Orientation summary:
“The function lets callers share the same resource and requests background work when that resource is first needed.”

Use the code you are given to choose the appropriate summary for this step. Do not reuse the example’s subject matter.

## Where this step is

The previous step chose the debug configuration. This step names the task that runs the start script. The next step follows the script.

## The code of this step

`.vscode/tasks.json`, target revision, lines 4–10:

```
 4 |     {
 5 |       "label": "Start debugger in dev container",
 6 |       "type": "shell",
 7 |       "command": "${workspaceFolder}/scripts/start-debugger.sh",
 8 |       "options": { "env": { "DEV_CONTAINER": "orders-dev", "DEBUG_PORT": "5678" } },
 9 |       "problemMatcher": []
10 |     }
```

## The revisions

Your working folder holds the two revisions of the repository as files: `base/` is the code before the change (commit 47a5e46243c37b9f9db4b3d80d53279ac0c194aa) and `target/` is the code after it (commit 57806884af74873379d7859aa962d416c6dc15c7). You can read them, and any surrounding code, with your Read, Glob and Grep tools. You cannot change files or run commands, and nothing outside this folder can be read.

## Your answer

Answer in plain English text. It is shown beside the code.
