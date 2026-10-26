# First Linux trial at home (DSP-131, DSP-117)

A short, ordered trial for the first run of DSpatch on the home Linux machine. Everything it relies on has been **prepared and verified offline on Windows only**; none of it has run on Linux, and no Claude turn has run through the DSpatch window. Requirements, the sandbox step and the background are in [app/README.md, Linux (prepared, not yet run)](../app/README.md#linux-prepared-not-yet-run) and [Claude in the main chat](../app/README.md#claude-in-the-main-chat-offline-prepared-not-yet-run-live).

Part A needs no provider. Part B is the live Claude trial and needs the decisions listed before it.

## Part A - start, example review, stop (no provider)

1. **Install.** In a new login shell (not a terminal started from Claude Code):

   ```sh
   git clone <repository URL> DSpatch
   cd DSpatch/app
   npm ci
   node node_modules/electron/install.js
   ```

   Expected: `npm ci` ends without errors and installs the Linux builds of both SDKs.

2. **Sandbox step, only if the distribution restricts unprivileged user namespaces** (for example recent Ubuntu; if unsure, try step 3 first - Electron then says the sandbox is not configured):

   ```sh
   sudo chown root:root node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
   ```

   Never use `--no-sandbox`.

3. **Build and start.**

   ```sh
   npm run typecheck
   npm run build
   npm run dev
   ```

   Expected: the DSpatch window opens with the *Open a project* panel. A missing system library shows as Electron failing to start with the library's name in the error.

4. **The bundled example.** Choose **File → Open Example Review** (no project needed).
   Expected: a separate review window on `5e445c3 → 73aaddc` with three walks (10, 8 and 4 steps). Step through a few points, add a note, close the review window, quit DSpatch, start it again and reopen the example: the position and the note are back. Nothing is sent to any provider.

5. **Stop a command.** Open the generated sample project (*Use a generated sample project*, agent *Cursor* or *Claude* - opening alone sends nothing). Run a long command through DSpatch's command field (for example `sleep 120 && echo done`), press Stop, then in a terminal:

   ```sh
   ps -o pid,pgid,cmd -u "$USER" | grep -v grep | grep sleep
   ```

   Expected: no `sleep` left. If one survives, note its `pgid` and stop it with `kill -- -<pgid>`.

6. **Reopen.** Quit DSpatch and run `npm run dev` again. Expected: the project and its conversation come back.

## Before Part B - decisions and preparation for the live Claude trial

- **Scope (open question Q3):** does the subscription authorization accepted on 22 October 2026 for personal Max use (worded as "Niclas's home computer") cover the home Linux machine? Decide before step 7.
- **Login:** sign in with Claude Code's own login on the Linux machine, and confirm that extra usage is off. DSpatch reads, copies and stores no credential, and has no API-key fallback: any API credential, OAuth or auth-token variable in the environment makes it refuse.
- **Reference text:** choose the text recorded as this launch's authorization reference, for example `Niclas, personal Max subscription, home Linux, <date>`.
- **Cursor:** the review discussion runs on Cursor (text-only) and needs a Cursor login; without one, leave it unused. The window may report Cursor's connection as a problem; that does not block Claude.

## Part B - Claude in the main chat (live, with authorization)

7. **Start with Claude enabled**, from a new login shell:

   ```sh
   cd DSpatch/app
   DSPATCH_CLAUDE_AUTHORIZATION="<reference text>" npm run dev
   ```

   Expected: in *Open a project*, the *Agent* select offers *Claude* (without the variable it reads *Claude (off)*).

8. **Open the sample as Claude.** Choose *Claude* under *Agent*, then *Use a generated sample project*. Expected: the composer shows Agent Claude and Model claude-haiku-4-5; Session details show the tool policy (Read, Glob, Grep, Edit, Write; no Bash) and the authorization note; no Cursor agent is created.

9. **One question, one change.** Ask a question about a file, then request one small change. Expected: an answer; the change appears in the diff; DSpatch's own Run button runs the test (Claude has no Bash).

10. **Stop during a turn.** Start a longer request and press Stop. Expected: the turn reads *stopped · provider work unknown* (or *Stop not confirmed · provider work unknown* if the end could not be confirmed) - never a plain "cancelled".

11. **Reopen.** Quit and start again with the same variable. Expected: the conversation opens as Claude. If you reopen it from *Open a project* and *Open* is disabled because Cursor is not connected, choose *Claude* under *Agent* first (the panel's choice currently decides that gate even for an existing conversation, which still opens with its recorded agent). Whether the provider session itself resumes is not established (DSP-122 is offline-verified only); DSpatch says which it did.

12. **Without the variable.** Start once with plain `npm run dev`. Expected: the Claude conversation is not resumed through Cursor; the window says the session belongs to another agent and offers *Start new Cursor session*.

## What to record

Distribution and version, kernel, desktop session (X11 or Wayland), `node --version`, `npm --version`, Electron's version, `git --version`; whether the sandbox step was needed; per step: as expected or what happened instead (a screenshot helps); for Part B, from Session details: the reported model, the `apiKeySource` and account fields if shown, and the tool list the session reported. Anything not tried is "not tried", not "works".
