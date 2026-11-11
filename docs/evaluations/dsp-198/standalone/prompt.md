Explain this step to an experienced developer reading the code beside your text. Give them the purpose of this code and the main connection or consequence that helps them understand its place in the program. Choose that overview yourself from the code; ordinary syntax and configuration fields are already visible to the reader. Include a detail when leaving it out would make the overview misleading. Finish when the reader has that orientation.

## Where this step is

The previous step chose the debug configuration. This step names the task that runs the start script. The next step follows the script.

## The code of this step

`.vscode/tasks.json`, target revision, lines 4–10 (the file does not exist in the base revision):

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

Your working folder holds the two revisions of the repository as files: `base/` is the code before the change (commit {BASE_COMMIT}) and `target/` is the code after it (commit {TARGET_COMMIT}). You can read them, and any surrounding code, with your Read, Glob and Grep tools. You cannot change files or run commands, and nothing outside this folder can be read.

## Your answer

Answer in plain English text. It is shown beside the code.
