Here the script makes its last move. It starts the service in the container under debugpy, then hands control back to VS Code. The `-d` flag means `docker exec` does not wait for the process. It returns as soon as Docker has started it. The script then ends with exit code 0, and VS Code treats the pre-launch task as finished.

Inside the container, debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back because of `--wait-for-client`. The service code does not run until a debugger connects. It listens on all interfaces, not just localhost, so the port that `compose.yaml` publishes (seen in W1.4) can reach it from the host. The connection itself happens in the next step (W1.8).

**Nothing makes the script wait until debugpy is actually listening.** Once the task exits, VS Code starts the attach immediately. Whether the listener is ready by then depends on timing. If it isn't, the first attach can fail.

<!-- dspatch:details -->
A few more things follow from running the process detached:

- **Errors inside the container are not reported.** The exit code of `docker exec -d` only says whether Docker could start the process. If debugpy fails later, the script still exits 0. That could happen if the port is already in use, for example because an earlier session is still listening on it. It could also happen if `orders.main` cannot be imported. In both cases VS Code goes on to the attach, and the failure only shows up as an attach that cannot connect.
- **There is no check for an earlier run.** Nothing stops a debugpy started by an earlier F5 before a new one starts.
- **How `orders.main` is found:** `-m orders.main` works because `compose.yaml` sets `working_dir: /workspace`, the bind-mounted repository. `docker exec` uses that directory, so Python's `-m` finds the `orders` package there.
- **Port settings must match by hand.** The listen port comes from `DEBUG_PORT`, which the task sets to 5678. The attach target in the debug configuration (`connect.port`) and the published mapping `"5678:5678"` in `compose.yaml` are written separately. If one of them changes, the others do not follow.