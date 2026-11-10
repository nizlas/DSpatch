`serve()` is unchanged, and two of its properties matter in the container:

- **It binds `0.0.0.0`, all interfaces, not `localhost`.** Inside a container, `localhost` is only reachable from within that container. Traffic arriving through a published port comes in on the container's network interface. Binding to all interfaces is what lets the 8080 mapping in the next step reach the server.
- **`serve_forever()` never returns.** The process keeps running, so the container stays up and the debug session has something to stay attached to. Request handling happens later, which is why breakpoints in it can still hit after a late attach (W1.4).

<!-- dspatch:details -->
The handler is `SimpleHTTPRequestHandler`, which serves files from the process's current directory. In the container that directory is `/app` (W1.3), so port 8080 serves the copied `service` source files. In the old local launch it served whatever directory VS Code started the process in. Since `ThreadingHTTPServer` is used, each request runs on its own thread. A breakpoint hit in one request pauses only that thread.