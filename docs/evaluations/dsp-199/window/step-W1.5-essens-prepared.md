# W1.5  (essens-prepared)

## Before Show more

docker exec -d starts orders.main under debugpy inside the container and returns immediately, so the script and the task end. With --wait-for-client, debugpy holds main until an editor connects.

## Behind Show more

Things worth checking:

Timing: the task ends before debugpy is known to be listening. The attach can try to connect before the port is open, depending on how quickly debugpy starts and how long the attach keeps retrying.

Hidden errors: with -d, nothing debugpy prints reaches the task terminal. A failure here, such as a busy port, is not reported.

Repeat runs: nothing stops an earlier debugpy process. After a session ends, that process can keep serving. A second F5 then starts another process that cannot bind 5678 or 8000, and the attach can end up connected to the old process.

Listening on 0.0.0.0 is needed so that Docker's published port can reach debugpy.
