This is the script's last command. Here the work moves out of the script and into a separate process inside the container. The script started from the pre-launch task, so this is also where that task ends.

`docker exec -d` starts debugpy in the background inside `orders-dev` and returns as soon as the process has been launched. The script has nothing left to run, so it exits 0, and VS Code treats the pre-launch task as successful. From here, two things happen in parallel:

- **In the container**, debugpy starts listening on `PORT` (5678 by default). Because of `--wait-for-client`, it holds `orders.main` back until a debugger connects.
- **In VS Code**, the configuration moves on to the attach, which the next step (W1.8) follows.

**The task's success only means the process was launched, not that debugpy is listening or will keep running.** The process is detached, so its output never reaches the task terminal. If debugpy fails to import or the port is already taken, the task still reports success, and the only sign of trouble is a failed attach later on.

<!-- dspatch:details -->

A few consequences of the command as written:

- **Exposure.** `--listen "0.0.0.0:$PORT"` makes debugpy accept connections on every interface in the container, and the published port needs that. But compose publishes `"5678:5678"` without a host address (`compose.yaml`, target, line 9), so this debug server is reachable on all host interfaces. Nothing in this setup adds authentication, and anyone who can connect to a debug server can run code in the process.
- **Repeated runs.** Nothing checks whether an earlier debugpy or service process is still running in the container. Pressing F5 again launches another debugpy process. The earlier process would still hold the debug port (and port 8000, if its service was already released), so the new one can fail to bind. Because it runs detached, that failure would not show in the task.
- **Port coupling.** The container side of the published mapping is fixed at 5678, so a `DEBUG_PORT` other than 5678 would make debugpy listen on a port compose does not publish (see W1.4).
- **Finding the module.** `-m orders.main` works because `docker exec` runs in the service's `working_dir`, `/workspace`, which is the bind-mounted repository (`compose.yaml`, target, lines 5 and 7).