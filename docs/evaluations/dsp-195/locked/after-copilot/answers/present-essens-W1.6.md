This configuration attaches VS Code to the container’s debug listener at `localhost:5678` and maps the workspace’s `service` directory to `/app/service` in the container, so the debugger can match the container’s source paths to local files. The attach request itself doesn’t launch Python: its pre-launch task starts the container, whose command starts `debugpy` and `service.main` (W1.2, W1.5). In the next step, `service.main` calls `serve` (W1.7).

```dspatch-references
{"references":[{"label":"Attach configuration and source mapping","path":".vscode/launch.json","side":"target","start":5,"end":11},{"label":"Pre-launch task","step":"W1.2"},{"label":"Container debug listener","step":"W1.5"},{"label":"Service entry point","step":"W1.7"}],"insufficient":false}
```