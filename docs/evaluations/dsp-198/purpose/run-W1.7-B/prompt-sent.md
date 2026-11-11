Write the Essentials explanation for this code-walk step.

The reader is an experienced developer with the code visible beside your explanation. They can read expressions, function calls and configuration fields themselves. They want help seeing what this step accomplishes and how it fits into the surrounding flow.

The purpose of Essentials is to let the reader follow the whole walk without repeatedly stopping to read a second, prose version of the implementation. Their attention should go to the central relationship or consequence that makes this step worth understanding.

Selecting what to leave out is part of doing this job well. Correct implementation details may be omitted even when they are relevant to the code. Include them when they materially change the reader’s understanding of the central point, rather than simply because they exist or could be useful.

The explanation does not need to stand in for the code, document every condition, or anticipate every review question. It should give a truthful, useful orientation. Keep its claims appropriately scoped instead of expanding them into an exhaustive account.

Read as deeply as needed to understand the code. Explain selectively to help the reader. Finish when the step’s role and the central relationship are clear.

## Where this step is

This is step W1.7 of the walk. The previous step, W1.6, prepares a log folder in the container for the host user. This step starts the service under the debugger. The next step, W1.8, follows the editor as it attaches.

## The code of this step

`scripts/start-debugger.sh`, target revision, lines 23–24:

```
23 | # Detached: docker exec returns at once, and debugpy waits for the editor before main runs.
24 | docker exec -d "$CONTAINER" python -m debugpy --listen "0.0.0.0:$PORT" --wait-for-client -m orders.main
```

## The revisions

Your working folder holds the two revisions of the repository as files: `base/` is the code before the change (commit 47a5e46243c37b9f9db4b3d80d53279ac0c194aa) and `target/` is the code after it (commit 57806884af74873379d7859aa962d416c6dc15c7). You can read them, and any surrounding code, with your Read, Glob and Grep tools. You cannot change files or run commands, and nothing outside this folder can be read.

## Your answer

Answer in plain English text. It is shown beside the code.
