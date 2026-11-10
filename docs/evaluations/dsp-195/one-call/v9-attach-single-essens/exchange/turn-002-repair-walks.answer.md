```json
{
  "summary": "The VS Code debug configuration now attaches to the service running in Docker instead of launching Python locally. A pre-launch task builds and starts the container, which runs the service under debugpy with ports and source paths mapped for debugging.",
  "background": "",
  "walks": [
    {
      "kind": "walk",
      "title": "How does VS Code attach to the containerized service?",
      "question": "What starts the service, and how does the debugger connect to its code?",
      "purpose": "Follow the debug configuration from its pre-launch task through the container startup to the service entry point.",
      "steps": [
        {
          "title": "Choose the attach configuration",
          "summary": "VS Code runs a startup task before attaching to debugpy.",
          "body": "When this configuration is selected, VS Code runs the task named in `preLaunchTask`, then connects to `localhost:5678`. The path mapping relates local files under `service` to `/app/service` in the container, so breakpoints can correspond to the code Python runs there. `justMyCode: false` allows stepping beyond user-code-only filtering.",
          "why": "Unlike the previous launch configuration, this one expects the service to be started separately and waits for a debugger endpoint.",
          "details": "",
          "places": [
            {
              "label": "VS Code debug configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 14,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "Run the startup task",
          "summary": "The task asks Docker Compose to build and start the service.",
          "body": "The `preLaunchTask` name leads here: the shell task runs `docker compose up -d --build service`. Compose is asked to build the service image and start that service in detached mode. The task does not itself wait for a debugger connection.",
          "why": "The attach configuration depends on this task to start the process that provides the debug endpoint.",
          "details": "",
          "places": [
            {
              "label": "VS Code startup task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 3,
              "end": 8,
              "anchor": "\"command\": \"docker compose up -d --build service\"",
              "from": {
                "label": "pre-launch task reference",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Configure the Compose service",
          "summary": "Compose defines the image build, container command, and published ports.",
          "body": "The task's `service` argument selects this Compose service. Compose builds from the repository root, starts Python with debugpy listening on port 5678 and running `service.main`, and publishes ports 5678 and 8080 to the host. There is no health check or explicit debugger-readiness wait here, so the attach connection depends on debugpy being ready when VS Code connects.",
          "why": "This configuration connects the container's debugger and HTTP service to host ports.",
          "details": "",
          "places": [
            {
              "label": "Compose service configuration",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "command: python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Compose command",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "Build the container image",
          "summary": "The Dockerfile supplies Python, debugpy, and the service source.",
          "body": "Because Compose builds from the repository root, this Dockerfile provides the image: it uses Python 3.12, sets `/app` as the working directory, installs debugpy, and copies `service` into `/app/service`. The service command configured in Compose can then import `service.main` from that working directory.",
          "why": "The image includes the debugger and source code needed by the container command.",
          "details": "",
          "places": [
            {
              "label": "Image build instructions",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "Compose build context",
                "path": "compose.yaml",
                "side": "target",
                "start": 2,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "Enter the service module",
          "summary": "The Compose command runs `service.main` under debugpy.",
          "body": "After the image is built and the container starts, its configured command launches Python's module runner through debugpy. The `-m service.main` argument reaches `main()`; when the module is run as the program, its guard calls that function, which starts the HTTP server in the next step.",
          "why": "This is the transition from container startup to the application's normal entry point.",
          "details": "",
          "places": [
            {
              "label": "Service entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "Compose runtime command",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Serve HTTP requests",
          "summary": "`main()` starts a threaded HTTP server on port 8080.",
          "body": "Called by `main()`, `serve()` binds `ThreadingHTTPServer` to `0.0.0.0` on the supplied port and serves requests until the server loop ends. Here, `main()` supplies port 8080, matching the port Compose publishes to the host.",
          "why": "The debugger connection is on port 5678; the service's HTTP traffic uses the separate 8080 mapping.",
          "details": "",
          "places": [
            {
              "label": "HTTP server implementation",
              "path": "service/server.py",
              "side": "target",
              "start": 3,
              "end": 6,
              "anchor": "def serve(port: int) -> None:",
              "from": {
                "label": "Call from main",
                "path": "service/main.py",
                "side": "target",
                "start": 3,
                "end": 4
              }
            }
          ]
        }
      ]
    }
  ]
}
```