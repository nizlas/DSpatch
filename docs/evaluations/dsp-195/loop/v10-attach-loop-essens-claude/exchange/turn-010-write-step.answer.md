When the attach succeeds, VS Code and debugpy see the same code under different paths. The local file is under the workspace's `service` folder, while the container runs it from `/app/service`. `pathMappings` translates between the two: a breakpoint set locally is sent to the matching container path, and stack frames reported by the container open the local file.

**The `remoteRoot` is only correct because it equals the COPY destination shown beside it.** If the Dockerfile ever copies the code somewhere else, breakpoints silently stop binding. Nothing checks that the two stay in step.

The mapping matches files by path, not by content. It is only accurate while the container runs the same code as the local files. The task's `--build` rebuilds the image on every F5, which keeps them in sync at the start of each session. If a file is edited during a session, the container keeps running the old copy until the next F5, so lines in the editor and in the running code can differ.

`justMyCode: false` makes the debugger step into and stop in library code too, such as `http.server`, which handles every request here (W1.6), not only in the service's own files.