# W1.1  (standard-prepared)

## Before Show more

The debug configuration asks VS Code to attach to a process that the pre-launch task starts.

The previous configuration launched service/main.py locally; this one uses an attach request and names Start the service container as its pre-launch task. VS Code connects to localhost:5678. The path mapping relates the local service directory to /app/service in the container, so debugger source locations can be matched across the two environments. justMyCode: false allows stepping into code beyond the user's own code.

## Behind Show more

(no Show more)
