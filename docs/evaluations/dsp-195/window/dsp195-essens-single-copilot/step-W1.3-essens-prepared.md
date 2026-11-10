# W1.3  (essens-prepared)

## Before Show more

Compose builds the image, runs debugpy with the service module, and publishes both ports.

This is the configuration used by the task's Compose command. The build: . setting points to the Dockerfile, covered next. The command starts debugpy listening on port 5678 and runs service.main as a module; the port mappings make the debugger port 5678 and HTTP port 8080 available on the host.

## Behind Show more

(no Show more)
