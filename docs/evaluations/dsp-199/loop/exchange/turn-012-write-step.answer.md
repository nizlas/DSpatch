Back in the editor, the pre-launch task has ended with exit code 1. What happens next is decided by the editor, not by code in this repository. Usually it reports the failed task and doesn't attach, so **the developer has to start the container and press F5 again**. The base "Run orders locally" configuration could never fail this way, because it needed no container.

<!-- dspatch:details -->
Because the task has `problemMatcher: []`, the editor has nothing structured to show. The failure appears only as the exit code and the script's message in the task terminal, which tells the developer to run `docker compose up -d dev`.

Editors commonly let the user debug anyway after a failed pre-launch task. If the developer does that here, the attach to `localhost:5678` has nothing to connect to: the container that would publish the port isn't running, and no debugpy was started in it.