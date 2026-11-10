# W1.1  (standard-alternative)

## Before Show more

This step changes who starts the Python process.

Before (base, launch.json lines 5–9), the configuration was a launch. When you pressed F5, VS Code ran service/main.py itself, under the debugger, in the integrated terminal. The process ran on your machine, and its lifetime was the debug session's lifetime.

Now (target, lines 5–8), request is attach. The debugpy adapter starts nothing. It connects to a debugpy server that something else has already started. That changes what the configuration depends on:

Something else must start the program. Here that is preLaunchTask. VS Code runs the task whose label matches "Start the service container", and only after that does it try to connect. The label is matched exactly as a string. It does match the one task defined in tasks.json, but nothing checks the two if one is renamed later. The next step [W1.2] shows that the task runs docker compose up -d --build service. A later step [W1.4] shows the container starting the service under debugpy --listen.

The debugger has to be reachable. An attach needs to know where to connect. That is the connect setting on the next line, which the last step of this walk covers [W1.7].

The code runs in a different place. The source the debugger sees is inside the container, not in your workspace. So the configuration also needs pathMappings, which Walk 2 covers [W2.2].

The result: pressing F5 builds and starts a container and then connects to it. The debugger runs inside the container, not as a local child process of VS Code.

## Behind Show more

Some consequences of the attach model show up when you read this configuration together with the files it relies on. These are observations from reading the code, not behaviour I have seen run:

Stopping the debugger probably leaves the container running. In an attach session, ending the session disconnects from the debugger. The service was started with docker compose up -d, in the background, and no postDebugTask or other teardown is configured. As far as these files show, the service keeps running after you stop debugging. Under launch, stopping ended the process.

There is a possible race at startup. The task is a plain shell task, so VS Code treats it as done when docker compose up -d returns. That happens once the container has started, not once debugpy is listening on port 5678. If the attach comes too early, the connection may fail. I don't know how VS Code handles that here, because these files set no retry or readiness check.

The service doesn't wait for you. The compose command runs debugpy --listen without --wait-for-client. The service starts running immediately, whether or not a debugger is attached. Breakpoints in startup code, such as main() calling serve(port=8080), may already have been passed before the attach completes. Under the old launch, the debugger was there from the first line.

The entry point changed slightly. Base ran service/main.py as a script path. The container runs it as a module, -m service.main. That suits the absolute import from service.server import serve in main.py.
