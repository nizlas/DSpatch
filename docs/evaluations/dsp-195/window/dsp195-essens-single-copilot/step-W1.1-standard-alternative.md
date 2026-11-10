# W1.1  (standard-alternative)

## Before Show more

This configuration attaches VS Code’s debugger to a Python process rather than asking it to launch one locally. Before connecting to localhost:5678, VS Code runs the task named Start the service container (W1.2). That task starts the Compose service, which exposes port 5678 for debugpy (W1.3). The path mapping connects local files under service to their /app/service copies in the container, so the debugger can match the two locations. Unlike the base configuration, which launched service/main.py locally, this one debugs the containerized service.

## Behind Show more

The task starts Compose in detached mode, so its completion does not by itself establish that debugpy is ready to accept the connection; the debugger still needs the service to be listening when it attaches.
