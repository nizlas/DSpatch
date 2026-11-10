```json
{
  "summary": "VS Code now attaches to the service running in Docker instead of launching it locally. A pre-launch task builds and starts the container with debugpy listening, while Compose publishes the debugger and HTTP ports.",
  "background": "",
  "walks": [
    {
      "kind": "walk",
      "title": "How does VS Code start and attach to the containerized service?",
      "question": "What happens when someone starts the new VS Code debug configuration?",
      "purpose": "Follow the configuration from VS Code's pre-launch task through container startup to the Python service and debugger connection.",
      "steps": [
        {
          "title": "Choose attach mode",
          "summary": "VS Code is configured to attach to an existing debugpy process.",
          "body": "This configuration requests an **attach**, not a local Python launch. Before attaching, VS Code runs the named `preLaunchTask`, then connects to `localhost:5678`. The task that starts the container is the next step.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "VS Code debug configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "Run the container task",
          "summary": "The pre-launch task asks Docker Compose to build and start the service.",
          "body": "The `preLaunchTask` from the previous step names this task. Its shell command runs `docker compose up -d --build service`: Compose builds the `service` image if needed and starts that service in the background. The task does not include a separate check that debugpy is ready to accept the later attach.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "VS Code task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "\"command\": \"docker compose up -d --build service\"",
              "from": {
                "label": "preLaunchTask reference",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Build the service image",
          "summary": "Compose uses the repository's Dockerfile to build the service image.",
          "body": "The task names the `service` Compose service, whose `build: .` setting uses the repository root as the build context. That build uses the Dockerfile shown next.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Compose build setting",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 3,
              "anchor": "build: .",
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
          "title": "Prepare the image contents",
          "summary": "The image installs debugpy and copies in the service code.",
          "body": "For the build requested by Compose, the Dockerfile starts from Python 3.12, sets `/app` as the working directory, installs `debugpy`, and copies the local `service` directory to `/app/service`. Compose then uses this image to run the service command.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Dockerfile",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "Compose build setting",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "Start Python under debugpy",
          "summary": "The container command opens a debugpy listener and runs the service module.",
          "body": "After building the image, Compose runs `python -m debugpy --listen 0.0.0.0:5678 -m service.main`. The listener binds inside the container on port 5678, and Python runs `service.main` as a module. That module's `main` function calls `serve(port=8080)`, shown in the next step.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Compose service command",
              "path": "compose.yaml",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "command: python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Compose startup task",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "Enter the service",
          "summary": "`service.main` starts the HTTP server on port 8080.",
          "body": "Because the container command runs `service.main`, Python reaches this module's `main` function and calls `serve(port=8080)`. The implementation of `serve` determines how the HTTP server binds and handles requests.",
          "why": "",
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
                "label": "Compose service command",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Bind and serve HTTP requests",
          "summary": "`serve` binds on all container interfaces and serves requests until the server stops.",
          "body": "The `serve` call from the previous step creates a `ThreadingHTTPServer` bound to `0.0.0.0` on the supplied port, then calls `serve_forever()`. This is the container-side HTTP listener; the port publication is covered in the Compose settings below.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "HTTP server implementation",
              "path": "service/server.py",
              "side": "target",
              "start": 3,
              "end": 6,
              "anchor": "httpd.serve_forever()",
              "from": {
                "label": "serve call",
                "path": "service/main.py",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Publish the container ports",
          "summary": "Compose maps the debugger and HTTP ports to the host.",
          "body": "These port mappings make container port 5678 available on host port 5678, matching the address in the VS Code configuration, and expose container port 8080 on host port 8080 for HTTP requests. The server's `serve(port=8080)` call in the previous step supplies the HTTP port.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Compose port mappings",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"5678:5678\"",
              "from": {
                "label": "HTTP server port",
                "path": "service/main.py",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Map container source to the workspace",
          "summary": "The debugger maps the copied container code back to local service files.",
          "body": "The Dockerfile copies `service` to `/app/service`; this mapping tells VS Code how that container path corresponds to `${workspaceFolder}/service` on the host when resolving source locations. `justMyCode: false` also allows debugging to include code outside the user's own files.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Source path mapping and debugger scope",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 10,
              "end": 14,
              "anchor": "\"remoteRoot\": \"/app/service\"",
              "from": {
                "label": "Container source copy",
                "path": "Dockerfile",
                "side": "target",
                "start": 4,
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