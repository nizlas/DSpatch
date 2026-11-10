This file is unchanged. debugpy runs it as the module `service.main`, so `__name__` is `"__main__"` and `main()` calls `serve(port=8080)`.

**How it is started now decides whether its first import works.** `from service.server import serve` needs the folder that *contains* `service` to be on Python's import path.

- **Now:** `-m service.main` is run from the working directory `/app`, and `-m` puts that directory on the path. `/app` contains `service` (W1.3), so the import resolves.
- **Before:** the old launch ran `main.py` as a script. Python then puts the script's own folder, `service/`, on the path, not the workspace root. Unless the environment added the root some other way, the `service.server` import would have failed.

This comes from reading the imports and Python's path rules. Neither start was observed running. From here the call goes into `serve`, the next step.