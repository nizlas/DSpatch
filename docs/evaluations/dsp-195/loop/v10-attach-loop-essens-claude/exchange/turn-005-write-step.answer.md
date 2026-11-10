This is what the container started by the task runs. **debugpy starts first and the service runs inside it.**

1. debugpy opens a debug listener on port 5678 on all of the container's interfaces (`0.0.0.0`). That is the port VS Code will attach to through the host (W1.7, W1.8).
2. debugpy then runs `service.main` as a module from the working directory `/app`. The next step shows why running it as a module matters for the imports.

**There is no `--wait-for-client`, so the service runs at once without waiting for VS Code.** Code that runs early, such as the imports and the server setup, can finish before VS Code has attached and set breakpoints. Breakpoints in that code may then never hit. Code that runs per request comes later and isn't affected. Since the task in W1.2 doesn't wait for the listener either, nothing in this setup makes the start and the attach wait for each other.

<!-- dspatch:details -->
Adding `--wait-for-client` would make debugpy hold the program until a debugger connects. Every container start would then block until someone attaches, including a plain `docker compose up` run outside VS Code. This command chooses to start without waiting.