# W1.7  (essens-prepared)

## Before Show more

After the task ends, VS Code attaches to localhost:5678.

This is where the debug start continues once the task from the second step has ended. VS Code connects to the host port published in the previous step, which forwards to the debugpy listener started by the container command. If debugpy is not listening yet, the connection fails and the developer has to start the session again. Nothing in the configuration retries.

## Behind Show more

(no Show more)
