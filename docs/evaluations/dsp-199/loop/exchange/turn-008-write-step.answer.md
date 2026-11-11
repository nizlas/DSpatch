This unchanged compose service is what the debugging setup relies on. It publishes the container's port 5678 on the host, so the editor's `localhost:5678` reaches debugpy, and it **mounts the repository at `/workspace`**, so the container runs the same files the developer edits.

<!-- dspatch:details -->
How each setting is used by the earlier steps:

- `container_name: orders-dev` gives the fixed name that the task's `DEV_CONTAINER` and the script's default use. A container started under another name fails the running-container check.
- `working_dir: /workspace` is the default directory for `docker exec`. Python's `-m` puts that directory on the import path, which is why `-m orders.main` finds the `orders` package in the mounted repository.
- `command: sleep infinity` only keeps the container alive. The developer starts it once with `docker compose up -d dev`, and the script then adds processes to it.
- The `"8000:8000"` mapping publishes the port that `main()` serves on, so the running service can be reached from the host too.

The base revision already had both port mappings and the mount. This change relies on them rather than adding them.