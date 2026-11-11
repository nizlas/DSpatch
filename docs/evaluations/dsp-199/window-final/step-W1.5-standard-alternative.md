# W1.5  (standard-alternative)

## Before Show more

This step is the end of the task that started in W1.2. It starts the service under debugpy, the Python debugger, inside the container, and it is written so that the task finishes immediately. VS Code waits for the preLaunchTask to finish before it attaches, so the order works only because two separate things wait for each other:

docker exec -d runs the command in the container detached. docker exec returns once the process has been started and does not wait for it to end. The script ends here, so the task ends, and VS Code moves on to attach (W1.1).

--wait-for-client makes debugpy open its listener and stop before it runs the target module. -m orders.main is passed to debugpy, not to Python. debugpy runs orders.main as a module, so the __name__ == "__main__" branch calls main(). That happens only after a debugger has connected. Until then, nothing in main() runs: it doesn't create the log folder or call serve(port=8000). As a result, breakpoints set early in main() are hit.

--listen "0.0.0.0:$PORT" binds to all interfaces in the container, not only its loopback. Docker's published port forwards traffic into the container's network interface, which a listener bound to 127.0.0.1 inside the container would never receive. $PORT is DEBUG_PORT from the task. The next step follows the port from here to the editor's connect (W1.6).

This replaces the base revision's setup. There, the debug configuration was a "request": "launch" with "module": "orders.main", so VS Code started the service on the host itself. Now the service runs in the container and the editor only attaches.

## Behind Show more

What "returns at once" does and doesn't guarantee. docker exec -d returning means the process was started. It doesn't mean debugpy is already listening on the port. The script doesn't wait for or check the port before it ends, so the editor's attach can, in principle, reach the port before debugpy has bound it. Whether that happens in practice depends on timing and on how the attach handles a refused connection, and neither can be read from these files. This is an observation, not a verified failure.

No feedback from the detached process. With -d, the process's stdout and stderr don't reach the task terminal. If debugpy or orders.main fails to start, for example with an import error or a port already in use, the script has already exited successfully. The only sign is that the attach fails. set -euo pipefail doesn't help here: it only sees the exit code of docker exec -d itself.

Running the session a second time. Once attached, main() reaches serve(port=8000), which calls HTTPServer(...).serve_forever() in orders/http.py. The process therefore keeps running after the editor disconnects. Nothing in the script stops an earlier instance before starting a new one. A second start would probably find 5678, and later 8000, already in use in the container. This follows from the code as written. It has not been observed.

Who the process runs as. The command has no --user, so it runs as the container's default user. The script's own comment says that is root. When main() runs after the attach, it creates /workspace/logs with exist_ok=True and writes orders.log. The script has already created that folder and handed it to the host user just before this line. What that means for the log file's owner is covered in walk 2 (W2.1, W2.2).
