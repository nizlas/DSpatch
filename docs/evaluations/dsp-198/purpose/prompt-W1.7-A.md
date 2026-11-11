Write an orientation summary for this code-walk step. The reader is an experienced developer who can read the code and wants help seeing what it accomplishes in the larger flow. Describe the action and its significance at that level. Select the central point; leave the implementation walkthrough to the code and follow-up questions. Include any condition needed to keep that summary accurate.

The following unrelated example illustrates the level of abstraction, not a template or a required length:

Implementation walkthrough:
“The function acquires the lock, looks up the entry, creates it if missing, and signals the worker thread.”

Orientation summary:
“The function lets callers share the same resource and requests background work when that resource is first needed.”

Use the code you are given to choose the appropriate summary for this step. Do not reuse the example’s subject matter.

## Where this step is

This is step W1.7 of the walk. The previous step, W1.6, prepares a log folder in the container for the host user. This step starts the service under the debugger. The next step, W1.8, follows the editor as it attaches.

## The code of this step

`scripts/start-debugger.sh`, target revision, lines 23–24:

```
23 | # Detached: docker exec returns at once, and debugpy waits for the editor before main runs.
24 | docker exec -d "$CONTAINER" python -m debugpy --listen "0.0.0.0:$PORT" --wait-for-client -m orders.main
```

## The revisions

Your working folder holds the two revisions of the repository as files: `base/` is the code before the change (commit {BASE_COMMIT}) and `target/` is the code after it (commit {TARGET_COMMIT}). You can read them, and any surrounding code, with your Read, Glob and Grep tools. You cannot change files or run commands, and nothing outside this folder can be read.

## Your answer

Answer in plain English text. It is shown beside the code.
