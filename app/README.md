# DSpatch – runnable skeleton

This is DSpatch's first product code. It displays a window with the app's name,
runtime versions and adapter capabilities. **It does not connect to an agent
provider.**

The adapter consists of an interface and a placeholder whose unimplemented
operations throw. This is deliberate: substep 2 establishes that the stack
works, substep 3 that the skeleton can be packaged, and substep 4 that the
agent connection works. Keeping these separate makes failures attributable.

This document is intended for a developer who did not write the code. It covers
fetching the repository, installation, development mode, building and running
the packaged artifact.

## Prerequisites

- Windows. Linux is a target but remains untested; none of these instructions
  have been tested there.
- Node 22.12 or later, with npm. Tested with Node 24.21.0 and npm 11.19.0.
- Git.
- Internet access for initial installation and packaging, when the Electron
  binary and distribution archive are downloaded.

No account, key or secret environment variable is needed. There is no agent
connection to authenticate yet.

## Fetch and install

Clone the repository and install dependencies. All product code is in `app/`;
run the commands below from that directory.

```powershell
git clone <repository URL>     # see `git remote -v` in an existing working copy
cd DSpatch\app
npm install
```

Electron 44 does not download its binary during installation: the package has
no `postinstall`. The download happens on first use, during the first
`npm run dev`, and takes a little time. This is expected.

If `node` or `npm` cannot be found in an already open terminal, its PATH may be
stale. Open a new terminal or update the session:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:PATH"
```

## Run in development mode

```powershell
npm run dev
```

The command compiles the main process and preload with `tsc`, starts Vite's
renderer development server on port 5273 and opens Electron against it.
`strictPort` fixes the port: startup fails if it is occupied rather than
silently switching ports.

## Build and run the packaged artifact

```powershell
npm run clean     # removes dist/
npm run package   # builds and packages everything
```

`npm run package` runs `npm run build` followed by `electron-builder` using
`electron-builder.yml`. The output is an unpacked executable directory:

```text
app\release\win-unpacked\DSpatch.exe
```

Double-click it or run:

```powershell
.\release\win-unpacked\DSpatch.exe
```

The artifact needs **no** development server or `npm`. It loads the renderer
from its own `resources\app.asar`. Keep the entire directory together;
`DSpatch.exe` cannot be moved out on its own.

The directory is approximately 370 MB, mostly Electron's runtime. It is
Git-ignored and must not be committed.

### Packaging scope

The target is `dir`, an executable directory. There is **no installer, code
signing or automatic update mechanism**. These are outside the task.

### Unsigned `DSpatch.exe`

The binary has no digital signature (`Get-AuthenticodeSignature` reports
`NotSigned`). Practical implications:

- **Locally built artifact:** it started without a warning in the observed
  Windows test. The local file had no internet-origin marker.
- **Artifact transferred from another computer or downloaded as a ZIP:**
  internet-origin marking and Windows policy may trigger SmartScreen's
  *“Windows protected your PC”* dialog, identifying the publisher as unknown.
  Where policy permits, **More info** and **Run anyway** are the available
  controls. This distribution scenario has not been verified by the local
  build test; copying a file does not always give it an internet-origin marker.
- Antivirus software may also flag an unsigned Electron binary. This was not
  tested here.

## Startup smoke test

Set `DSPATCH_SMOKE=1` to start the app, load the renderer, report observations
and exit with a code. A launched command is not evidence of a window: the probe
passes only after the window is shown **and** the renderer has painted and
acknowledged readiness through preload.

```powershell
$env:DSPATCH_SMOKE="1"; npm run dev                         # development mode
$env:DSPATCH_SMOKE="1"; npx electron .                      # built files; run npm run build first
$env:DSPATCH_SMOKE="1"; .\release\win-unpacked\DSpatch.exe   # packaged artifact
```

Clear the variable afterwards (`Remove-Item Env:\DSPATCH_SMOKE`) or the app
will immediately exit on its next launch.

| Exit code | Meaning |
| --- | --- |
| 0 | The window was shown and the renderer painted. |
| 2 | The renderer could not be loaded. |
| 3 | Both conditions were not met within 30 seconds. |
| 4 | The renderer process disappeared. |

Interpret output carefully. `did-finish-load` is also logged when Chromium
displays its own error page, so it cannot distinguish success from failure.
The decisive lines are `renderer-ready …` and `startup smoke test passed …`.
Earlier Swedish logs used `startprovet lyckades …`; retain those logs verbatim.

When `DSpatch.exe` starts as a Windows GUI process, logs do not automatically
appear in the terminal. Redirect them to files:

```powershell
$env:DSPATCH_SMOKE="1"
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput smoke.log -RedirectStandardError smoke.err
```

`-PassThru` returns the process object whose `ExitCode` should be read.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development mode: Vite server and Electron. |
| `npm run build` | Compile main/preload with `tsc` and bundle the renderer with Vite. |
| `npm start` | Launch Electron against built files. Requires `npm run build` first. |
| `npm run package` | Build and package into `release/win-unpacked/`. |
| `npm run typecheck` | Type-check main, preload, renderer and build tools. |
| `npm run clean` | Remove `dist/`. |

`npm run clean` does not touch `release/`. To package from a clean state:

```powershell
npm run clean
Remove-Item -Recurse -Force release
npm run package
```

## What the window shows

- The `DSpatch` heading and a notice that no provider is connected.
- **Runtime environment:** Electron, Chromium, Node and V8 versions, platform,
  app version and whether the renderer loaded from the development server or
  built files. The last field identifies the mode being run.
- **Adapter `not-implemented`:** the integration contract's seven capabilities:
  starting runs, streaming responses, cancellation, resumption, model selection,
  approvals, and usage/cost reporting.

All seven are **unsupported**, deliberately. The placeholder supports nothing;
this is a truthful report for that instance, not a prediction of a connected
Cursor adapter's capabilities. `unknown` is also a valid value and is never
presented as a positive result.

Niclas approved the current colour palette as the visual starting point on
13 September 2026. Preserve it as features are added. This feedback does not
by itself accept the usability of future chat and code-review workflows.

## Not implemented yet

- **Agent connection:** no SDK is installed, no provider is called and no
  network connection is opened. Unimplemented adapter operations throw
  `AdapterNotImplementedError`; capability reporting and disposal are implemented.
- Chat view, input and connection status.
- Application menu: Electron's default menu is removed because its actions
  have not been built.
- Installer, signing and automatic updates.
- Linux testing.

Do not present these features as available before they are implemented.

## Structure

```text
src/main/             Main process. Compiled by tsc, not bundled.
src/preload/          Sandboxed bridge, exposing one interface via contextBridge.
src/renderer/         React UI, bundled by Vite.
src/shared/           Renderer/main contract. Types only.
src/adapter/          Provider adapter interface and placeholder.
scripts/dev.mjs       Starts the development server and Electron.
electron-builder.yml Packaging configuration.
dist/                 Build output. Git-ignored.
release/              Packaging output. Git-ignored.
```

The main process is deliberately not bundled. Cursor SDK lazily loads parts
of itself that a single-file bundle cannot follow; its documentation describes
such a bundle failing on the first `Agent.create()`. Compiling to ordinary
modules with normal `node_modules` resolution avoids that problem.

The renderer never accesses Node. The window uses `contextIsolation`, disables
`nodeIntegration`, enables the sandbox and communicates through preload.

The artifact contains no `node_modules`. Vite bundles the renderer; the main
process requires only `node:path`, `electron` and its own compiled files.
`react` and `react-dom` are therefore build-time dependencies in practice.
This changes when the agent connection is added: its package carries executable
files that must be unpacked from asar. `electron-builder.yml` records the
required packaging follow-up; its existing configuration is for the skeleton.
