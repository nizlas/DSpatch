# W1.5  (standard-alternative)

## Before Show more

This is the script's last command. When it returns, the script exits and the pre-launch task is done, so VS Code goes on to attach [W1.2]. What the attach needs from this line is a debugpy server inside the container, listening on $PORT, with the service not yet started.

The command has two layers:

docker exec -d runs a new process in the already-running orders-dev container and returns as soon as Docker has started it. With -d the script doesn't see the process's output and doesn't wait for its exit status.

python -m debugpy --listen "0.0.0.0:$PORT" --wait-for-client -m orders.main is the process that starts. debugpy opens a listening socket, then holds off on running the orders.main module until a debugger client connects. After the attach, main() runs: it sets up logging under /workspace/logs and calls serve(port=8000), which blocks in serve_forever().

These two flags work as a pair:

Without -d, docker exec would block for as long as the service runs, which is forever. The task would never finish, and VS Code would never attach.

Without --wait-for-client, orders.main would start running right away, and breakpoints early in main() could be passed before the editor connects.

Together they let the task finish, while startup code still runs under the debugger.

In the base revision, F5 used "request": "launch" with "module": "orders.main", so VS Code started the service itself on the host [W1.1]. Here the service is started inside the container by this line, and VS Code only connects to it. The 0.0.0.0 bind address matters for that connection, which comes from outside the container through the published port. The next step covers that path [W1.6].

What the task's success doesn't prove. set -euo pipefail only catches a failure of docker exec itself, such as the container no longer existing. It can't catch the Python process failing after it has started. If debugpy can't bind the port, or orders.main fails to import, the task still reports success. The problem then only shows up as a failed attach.

## Behind Show more

Timing between this line and the attach. docker exec -d returns once the process is created, not once debugpy is listening. The code leaves a short window where VS Code tries localhost:5678 before the socket is open. Nothing here waits for the port or retries. Whether this window causes visible failures depends on timing and on how the debugpy extension handles a refused connection, which can't be read from this repository.

Repeated F5 presses. Every run of the script starts another detached process. Nothing in the script stops an earlier one or checks whether one is already running. The script doesn't show what happens to the service when a debug session ends. It was started by Docker and not by VS Code, so ending an attach session doesn't obviously stop it. If an earlier process is still running, it holds port $PORT (and 8000 once serve is running). A new debugpy would then fail to bind, and because of -d that failure would only appear as a failed or confused attach. This is an observation from the code, not something verified by running it.

Where the process runs and as whom.

docker exec without -w uses the container's working directory. Compose sets that to /workspace, the bind-mounted project folder, so -m orders.main finds the orders package from the host checkout.

Without -u, the process runs as the container's default user, which is root. That's why orders.log is created as root even after the script has run chown on the log folder [W2.2].

Where the output goes. With -d, anything the service or debugpy writes to stdout or stderr isn't shown in the task terminal. The service's own logging goes to /workspace/logs/orders.log through logging.basicConfig. Early failures before that point, such as a debugpy bind error or an import error, are not written to that file.
