# W1.3  (standard-alternative)

## Before Show more

The service Compose entry is what the pre-launch task starts (W1.2). Compose builds its image from the current directory; the next step shows the Dockerfile used for that build (W1.4). The container command runs service.main as a Python module under debugpy, which listens on port 5678. The ports entries publish that debugger port and the service’s HTTP port, 8080, to the host; later, service.main passes 8080 to serve (W1.5).

The 0.0.0.0 listener makes debugpy listen on the container’s network interfaces, while the port mapping lets VS Code connect through localhost:5678 as configured in W1.1.

## Behind Show more

(no Show more)
