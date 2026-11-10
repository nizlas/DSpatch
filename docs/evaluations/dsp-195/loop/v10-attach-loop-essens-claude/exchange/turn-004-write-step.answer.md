The `--build` in the task builds this image from the repository root. It is a minimal Python 3.12 image with two additions that the rest of the walk depends on:

- **debugpy is installed in the image.** The container command in the next step needs it there to wrap the service.
- **The service code is copied to `/app/service`, and `/app` is the working directory.** That lets the service run as the package `service` (W1.4–W1.5). `/app/service` is also the container path that the path mapping in W1.9 must match.

Nothing else is installed. The service only needs the standard library, and debugpy is the only extra package the image gets.

<!-- dspatch:details -->
- The `service` folder has no `__init__.py`. Imports such as `service.main` still work, because Python 3 treats a folder without that file as a namespace package.
- `pip install debugpy` is unpinned, so each rebuild of the image can pick up a newer debugpy release.
- The COPY puts a snapshot of the code into the image. Edits only reach the container through a rebuild, which the task's `--build` does on every F5.