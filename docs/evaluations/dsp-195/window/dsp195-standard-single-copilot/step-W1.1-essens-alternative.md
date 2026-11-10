# W1.1  (essens-alternative)

## Before Show more

Unlike the base configuration, this one attaches VS Code’s debugger to the service instead of launching service/main.py locally. Before connecting to localhost:5678, VS Code runs the pre-launch task; the container’s debugger startup and port publishing are shown in the next steps (W1.2–W1.3). The path mapping lets debugpy match local service files to their container paths, and justMyCode: false allows stepping into code outside the project. Attachment depends on debugpy being ready at the published port; this configuration does not specify a readiness check.

## Behind Show more

(no Show more)
