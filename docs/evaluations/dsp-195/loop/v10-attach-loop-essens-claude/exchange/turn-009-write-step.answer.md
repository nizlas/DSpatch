The walk is back in VS Code. Once the task from W1.2 has exited, VS Code connects to `localhost:5678`, the host port that W1.7 publishes to debugpy in the container.

**Nothing in this setup makes the attach wait for debugpy to be listening.** These two things happen independently:

1. The task finishes when `docker compose up -d` has started the container.
2. Inside the container, Python still has to start and debugpy has to open its listener (W1.4).

From the configuration alone, the attach could therefore come before the listener exists, especially on a cold start or a slow machine. This is an open question from reading the code, not an observed failure. If it happens, the user would see the attach fail and would have to press F5 again. On a retry, the container is usually already running and the listener is ready.

Once the attach succeeds, the last step shows how breakpoints in local files find the code running in the container.

<!-- dspatch:details -->
The configuration has no retry or readiness check: `connect` holds only a host and a port. How long VS Code's debugpy extension keeps retrying a refused connection is up to the extension, and nothing in this repository sets it. A readiness wait in the task would close the gap. Examples are a background task with a problem matcher that waits for debugpy's output, or a wait loop on the port. Separately, as W1.4 noted, even a successful attach comes after the service's startup code has already run.