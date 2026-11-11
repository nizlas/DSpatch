Once the task has finished, the editor connects to `localhost:5678`, which the published port forwards to debugpy in the container. `pathMappings` translates between the editor's `${workspaceFolder}` and the container's `/workspace`, **the same pairing as the bind mount**, so breakpoints set in host files land on the files the container runs.

<!-- dspatch:details -->
The translation works in both directions. Breakpoints in a host file are sent to debugpy as `/workspace/...` paths, and stack frames that debugpy reports under `/workspace/...` open as the matching host files. The mapping is correct only while `${workspaceFolder}` is the folder that holds the compose file, since the mount's `.` is the repository root. If the editor opens a parent or child folder, the mapping no longer matches the mount and breakpoints can go unbound.

Once the editor attaches, debugpy stops waiting and runs `orders.main` inside the container. The next step follows that.