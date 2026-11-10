# W1.3  (standard-prepared)

## Before Show more

Compose builds the image, runs debugpy with the service module, and publishes both ports.

The task's command reaches this Compose configuration. build: . uses the repository root as the build context, and the command runs service.main under debugpy, listening on port 5678 inside the container. The port mappings expose that debug port on the host for the attach configuration and expose the service's port 8080.

## Behind Show more

(no Show more)
