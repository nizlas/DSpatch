This task is what the debug configuration runs before it attaches. It hands the start script the container name and the debug port, and the script does the work: it starts the orders service under the debugger inside the dev container, which must already be running, and the debugger holds the service until the editor connects.

VS Code treats the task as finished when the script exits, and the script exits as soon as it has handed that start to the container. So a finished task does not by itself mean the debugger is ready to accept a connection.
