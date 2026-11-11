This is where the work leaves the script. `docker exec -d` starts debugpy as a separate process **inside the container**, and debugpy holds back `orders.main` until a debugger connects. `docker exec` returns immediately, so the script exits successfully and the editor counts the pre-launch task as done.

<!-- dspatch:details -->
After this line nothing on the host is tied to the debugpy process. It keeps running in the container when the host shell exits. debugpy listens on `0.0.0.0` at `$PORT` inside the container, so it is reachable through the published port shown in the next step. With `--wait-for-client`, it runs `orders.main` only once a client attaches.

`docker exec -d` reports success once the process has been started, not once debugpy is listening or has started without error. Three points follow from the code and are worth checking; they are not observed behaviour:

- **Timing.** Nothing in the script waits for the port to accept connections. The editor may try to attach before debugpy listens. Whether that fails or is retried depends on the editor's attach behaviour.
- **A second F5.** The script doesn't stop or look for an earlier debugpy process. If an earlier run is still alive, it still holds `$PORT` and, once `main()` runs, port 8000 as well (`serve(port=8000)` in `orders/main.py` on the target side). A new start would then fail to bind, or the editor might attach to the old process.
- **Silent failures.** Any error from the detached process, such as a bind failure or an import error, appears neither in the task's output nor in its exit code.