```json
{
  "summary": "The VS Code debug configuration no longer starts `service/main.py` on the developer's machine. It now runs the service inside a Docker container and attaches the debugger to it. Pressing Start Debugging first runs a new shell task, `docker compose up -d --build service`. That task builds an image from the new `Dockerfile` and starts the service under `debugpy`, which listens on port 5678. VS Code then connects to `localhost:5678` and maps `service/` on the host to `/app/service` in the container, so breakpoints set in the editor apply to the code that runs in the container.",
  "background": "No application code changes: `service/main.py` and `service/server.py` are the same at both commits. Everything new is tooling, so the review is mainly about whether the pieces agree with each other: names, paths, ports and startup order.\n\nThe container gets a copy of the code made at build time and has no volume mount. Edited code only reaches the container because the task passes `--build` on every debug start.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the user starts debugging",
      "question": "When the user picks \"Attach to the service in the container\" and presses Start Debugging, how does the code end up running with a debugger attached?",
      "purpose": "Follow the chain from the launch configuration through the task, compose and the image to the service, and back to the attach.",
      "steps": [
        {
          "title": "The launch configuration changes from launch to attach",
          "summary": "VS Code no longer starts the program itself; it connects to one that is already running.",
          "body": "A VS Code debug configuration has one of two `request` modes:\n\n- **launch**: VS Code starts the Python process itself, with the debugger already inside. This is what the From side did with `program` pointing at `service/main.py`.\n- **attach**: VS Code starts nothing. It connects over the network to a debugger server that some other process already runs.\n\nThe To side uses `attach`. As a result, `program` and `console` are gone, and something else has to start the service and its debugger server. That job goes to `preLaunchTask`, the next step. `connect` tells VS Code where to find the debugger server, and `pathMappings` tells it how to translate file paths. Later steps cover both.\n\nThe old local run is removed, not kept next to the new one. With this file, the debug menu can only run the service through Docker.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Debug configuration, From and To",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "preLaunchTask runs the compose command",
          "summary": "The task's label matches the name in preLaunchTask, and the task runs `docker compose up -d --build service` in a shell.",
          "body": "VS Code finds the task to run by matching the text of `preLaunchTask` with a task `label` in `tasks.json`. Both say `Start the service container`, so they match. If they ever differ, VS Code reports that it cannot find the task and does not start debugging.\n\nThe command does three things:\n\n- `--build` rebuilds the image first. The image holds a copy of the code (see the Dockerfile step), so this flag is what gets the user's latest edits into the container.\n- `-d` (detached) starts the container in the background and returns, so the task ends and VS Code goes on to attach.\n- `service` limits the command to the compose service with that name.\n\n**What \"the task finished\" means:** with `-d`, `docker compose up` returns once the container has been started. It does not wait for the Python process inside to open port 5678. VS Code attaches right after the task ends, so a slow container start could make the first attach fail. The configuration has nothing that waits for the port.",
          "why": "",
          "details": "The task has no `problemMatcher`, which is the setting that tells VS Code how to read a task's output for errors. Depending on the user's settings, VS Code may ask about that before it runs the task.\n\nThere is no `postDebugTask`. When the user stops debugging, VS Code only disconnects, and the container keeps running in the background until someone runs `docker compose down` or `stop`. The next debug start runs `up -d --build` again: compose recreates the container if the image changed and otherwise leaves the running one alone.",
          "places": [
            {
              "label": "The task VS Code runs before attaching",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
              "from": {
                "label": "preLaunchTask names the task",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "The image: Python, debugpy and a copy of the code",
          "summary": "`build: .` in compose points at this Dockerfile, which installs debugpy and copies `service/` to `/app/service`.",
          "body": "In `compose.yaml`, the `service` entry says `build: .`. That means \"build an image from the `Dockerfile` in the repository root\", and this is the file.\n\nLine by line:\n\n1. It starts from the official slim Python 3.12 image.\n2. `WORKDIR /app` makes `/app` the current directory for the commands after it and for the process the container runs.\n3. It installs `debugpy`, the debugger server that VS Code's Python debugger talks to.\n4. It copies the host's `service` folder to `/app/service`.\n\nTwo things here matter in later steps:\n\n- The current directory `/app` is what lets `-m service.main` find the `service` package (next step).\n- The path `/app/service` must equal `remoteRoot` in `pathMappings` (last step).\n\nThe code is **copied** into the image, not mounted from the host. An edit only reaches the container after a rebuild, which is why the task passes `--build`.",
          "why": "",
          "details": "There is no `.dockerignore`, so Docker sends the whole repository (including `.vscode/`) to the build as context. Only `service` is copied into the image, so this affects build speed, not the image's contents.",
          "places": [
            {
              "label": "Dockerfile",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "build: .",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container starts the service under debugpy",
          "summary": "The container's command runs debugpy as a debugger server on port 5678, and debugpy then runs the module `service.main`.",
          "body": "`command` replaces the image's default start command. Read it in two parts:\n\n- `python -m debugpy --listen 0.0.0.0:5678` starts debugpy, which opens a debugger server on port 5678 on every network interface of the container. Listening on `0.0.0.0` is required here: inside a container, a server that listens only on `127.0.0.1` cannot be reached through a published port.\n- `-m service.main` tells debugpy what to run once its server is up: the module `service.main`, run the same way `python -m service.main` would.\n\n**Running as a module rather than as a file path** matters. `main.py` begins with `from service.server import serve`, so Python must be able to find a package called `service`. With `-m`, the current directory `/app` is on the import path, and `/app/service` exists there. Python 3 treats a folder without `__init__.py` as a namespace package, so the import works without one.\n\nThe command has no `--wait-for-client`, so debugpy does not wait for VS Code. The service starts running at once. If a breakpoint sits in code that runs before VS Code has attached, such as the start of `main()`, the program can pass it before anyone is attached. Breakpoints in request handling are not affected, because those requests come later.",
          "why": "",
          "details": "Compare the From side. It launched `service/main.py` as a file. Python then puts the folder that holds the script (`service/`) on the import path, not the repository root, so `from service.server import ...` could only work if the root was on the path for some other reason. The new `-m` form avoids that question inside the container.",
          "places": [
            {
              "label": "Container start command",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The service itself starts an HTTP server on 8080",
          "summary": "`main()` calls `serve(port=8080)`, which serves forever on all interfaces.",
          "body": "This code is unchanged. It is shown because the container's port setup has to match it.\n\nRunning the module `service.main` reaches the `if __name__ == \"__main__\"` block, because a module run with `-m` gets that name. `main()` then calls `serve(port=8080)` in `service/server.py`. There, `ThreadingHTTPServer((\"0.0.0.0\", port), ...)` listens on port 8080 on every interface, which is what makes it reachable from outside the container. `serve_forever()` never returns, so the process, and the container with it, keeps running.\n\nThe next step shows how 8080 and debugpy's 5678 are made reachable from the host.",
          "why": "",
          "details": "`ThreadingHTTPServer` handles each request on its own thread. When the debugger stops at a breakpoint in a handler, it pauses that thread. With `justMyCode: false` (see the last step), the user can also step into the `http.server` standard library code.",
          "places": [
            {
              "label": "serve binds 0.0.0.0:port",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer((\"0.0.0.0\", port), handler)",
              "from": {
                "label": "main() calls serve(port=8080)",
                "path": "service/main.py",
                "side": "target",
                "start": 4,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "Port publishing connects host and container",
          "summary": "5678 (debugger) and 8080 (HTTP) are forwarded from the host to the same ports in the container.",
          "body": "A container has its own network. A port opened inside it can only be reached from the host when it is **published**. `\"HOST:CONTAINER\"` means \"forward the host's port HOST to the container's port CONTAINER\".\n\n- `5678:5678` is the path VS Code uses. It connects to `localhost:5678` on the host, and Docker forwards that to the debugpy server from the earlier step.\n- `8080:8080` lets the user send requests to the service at `localhost:8080`, matching `serve(port=8080)` from the previous step.\n\nThese numbers must agree with `--listen ...:5678`, with `connect.port` in `launch.json` and with the port in `main.py`. They do at this commit.",
          "why": "Without a host address, Docker publishes on all of the host's interfaces, not just localhost. Port 5678 then exposes a debugger server, and anyone on the network who can reach it can run code in the container. The separate walk on exposure covers this.",
          "details": "",
          "places": [
            {
              "label": "Published ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"5678:5678\""
            }
          ]
        },
        {
          "title": "VS Code attaches and maps paths",
          "summary": "Once the task has finished, VS Code connects to localhost:5678 and translates `service/` to `/app/service`.",
          "body": "This is where VS Code continues after the task from the second step ends.\n\n- `connect` makes VS Code open a connection to `localhost:5678`, which reaches debugpy in the container through the published port from the previous step.\n- `pathMappings` is needed because the debugger and the editor see different file paths. The user sets a breakpoint in `<workspace>/service/server.py`, but the running process knows that file as `/app/service/server.py`. The mapping replaces the `localRoot` prefix with `remoteRoot` when VS Code sends breakpoints, and the other way round when debugpy reports where the program stopped. `remoteRoot` must equal the `COPY` target in the Dockerfile, and it does.\n- `justMyCode: false` lets the debugger stop in and step into library code (the standard library, debugpy's surroundings), not only the user's files.\n\nThe mapping only helps if the copy in the container matches what is in the editor. As the Dockerfile step showed, the `--build` in the task gives that on each start. A file edited during a running session is not updated in the container.",
          "why": "",
          "details": "Library files outside `service/` have no mapping. They exist only in the container (for example under `/usr/local/lib/python3.12`). When the user steps into them, VS Code has no local file at that path to show. Whether it can display those files in another way depends on VS Code's Python debugger, not on anything this change sets.",
          "places": [
            {
              "label": "connect, pathMappings, justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 13,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ],
          "revisit": "The first step showed the switch to attach; here the parts that say where to attach and how paths translate."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What the container exposes on the network",
      "question": "Who can reach the debugger port and the HTTP server, and what does the server hand out?",
      "purpose": "See which addresses the two ports are open on and what the HTTP handler serves inside the container.",
      "steps": [
        {
          "title": "debugpy listens on every container interface",
          "summary": "`--listen 0.0.0.0:5678` opens the debugger server to anything that can reach the container.",
          "body": "A debugpy server accepts any client that connects, and nothing in this setup adds a password or other check. A connected client can evaluate expressions in the program, which in practice means it can run any Python code inside the process.\n\nListening on `0.0.0.0` inside the container is needed for port publishing to work (see the container start step of the first walk). So whether this is safe depends on how the port is published, which is the next step.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "debugpy listen address",
              "path": "compose.yaml",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "--listen 0.0.0.0:5678"
            }
          ]
        },
        {
          "title": "The ports are published on all host interfaces",
          "summary": "`\"5678:5678\"` gives no host address, so Docker binds it on every interface of the host.",
          "body": "Docker's short port form `\"HOST:CONTAINER\"` with no IP in front publishes the port on all of the host's network interfaces. That includes the Wi-Fi or LAN address, not only `localhost`.\n\nTaken with the previous step: while the container runs, **other machines that can reach the developer's computer can connect to the debugger and run code in the container.** The container also stays up after a debug session ends (see the task step of the first walk), so this lasts longer than the session.\n\nVS Code only needs `localhost`. Writing the mapping as `\"127.0.0.1:5678:5678\"` would limit the debugger port to the host itself. The same applies to 8080 if the HTTP server is only meant for local use.",
          "why": "",
          "details": "Docker writes its own firewall rules, so on Linux a host firewall such as ufw does not necessarily block published ports. Docker Desktop on Windows and macOS forwards published ports through its own proxy, and the result can depend on that machine's firewall. This cannot be settled from the repository.",
          "places": [
            {
              "label": "Port mappings without a host address",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"5678:5678\""
            }
          ]
        },
        {
          "title": "What the HTTP server serves",
          "summary": "`SimpleHTTPRequestHandler` serves files from the current directory, which in the container is `/app`.",
          "body": "This code is unchanged, but the change moves where it runs. `SimpleHTTPRequestHandler` is the Python standard library's static file server: by default it serves the files and directory listings of the process's current directory.\n\nWhen launched locally on the From side, that directory was whatever VS Code started the program in (normally the workspace folder). In the container it is `/app`, set by `WORKDIR` in the Dockerfile, which holds only `service/`. So on port 8080 the service now hands out its own source code, and, following the previous step, it does so on all of the host's interfaces.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Static file handler",
              "path": "service/server.py",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "SimpleHTTPRequestHandler"
            }
          ]
        }
      ]
    }
  ]
}
```