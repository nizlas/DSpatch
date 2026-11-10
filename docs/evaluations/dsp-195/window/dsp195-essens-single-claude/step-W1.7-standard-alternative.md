# W1.7  (standard-alternative)

## Before Show more

This is where the debug start continues after the pre-launch task finishes. With request: "attach", VS Code starts no process ([W1.1]). The connect setting is the only thing that tells the debug adapter where to find a debugger. Here it opens a connection to localhost:5678 on your machine.

To get to the debugger, that connection goes through two pieces set up in earlier steps:

The port mapping. Compose publishes "5678:5678", so a connection to host port 5678 is forwarded into the container [W1.6].

The listener. Inside the container, the service was started with python -m debugpy --listen 0.0.0.0:5678 [W1.4]. Because it binds 0.0.0.0 and not only the container's own loopback, the forwarded connection can reach it.

So the port number 5678 appears in three places, and all three must agree: the connect address here, the published port in compose.yaml, and the --listen argument. Nothing ties them together except that they were written the same.

When the connection happens. VS Code connects only after the task "Start the service container" has finished. That task is a plain shell task running docker compose up -d --build service ([W1.2]). It finishes when that command returns. Nothing in it waits until debugpy is actually listening. If the connection comes before the listener is up, the attach fails. These files configure no retry or readiness check. Whether the debugpy adapter itself retries on its own can't be determined from this repository.

## Behind Show more

Once attached, you are joining a service that is already running, not starting one. The compose command has no --wait-for-client, so the service keeps running whether or not this connection ever succeeds. A failed attach therefore doesn't stop the service. You can start the debug session again, which runs the pre-launch task again and then tries to connect again.

Some details about the address:

localhost assumes Docker runs on the same machine as VS Code. That holds for a local Docker Desktop or Engine. If the Docker context points at a remote daemon, the published port is on that remote host, and localhost:5678 would reach nothing. This configuration has no variable or input for the host.

Port 5678 also has to be free on the host. If another process, or another debug container, already uses host port 5678, docker compose up cannot publish the port. Then this connection may fail or reach the wrong listener.

The open port is unauthenticated. debugpy listens on 0.0.0.0 inside the container, and the compose mapping "5678:5678" has no host IP in front of it. Docker normally publishes such a mapping on all host interfaces. That means the debug port, which allows running arbitrary code in the service, may be reachable from other machines on the network, not just from localhost. This is an observation from the mapping syntax, not something these files restrict or test.

After the connection succeeds, the debugger needs to match file paths in the container to files in your workspace. The next setting in this configuration handles that, and Walk 2 covers it [W2.2].
