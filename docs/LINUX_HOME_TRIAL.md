# First Linux trial at home (DSP-131, DSP-117)

A short, ordered trial for the first run of DSpatch on the home Linux machine. Everything it relies on has been **prepared and verified offline on Windows only**; none of it has run on Linux, and no Claude turn has run through the DSpatch window. Requirements, the sandbox step and the background are in [app/README.md, Linux (prepared, not yet run)](../app/README.md#linux-prepared-not-yet-run) and [Claude in the main chat](../app/README.md#claude-in-the-main-chat-offline-prepared-not-yet-run-live).

Part A needs no provider. Part B is the live Claude trial and needs the decisions listed before it. Part C runs loops with Claude after Part B, including a change that DSpatch verifies with a real test (DSP-138, DSP-139).

## Part A - start, example review, stop (no provider)

1. **Install.** In a new login shell (not a terminal started from Claude Code):

   ```sh
   git clone <repository URL> DSpatch
   cd DSpatch/app
   npm ci
   node node_modules/electron/install.js
   ```

   Expected: `npm ci` ends without errors and installs the Linux build of the Cursor SDK. It installs no Claude SDK and no Claude Code binary: `node_modules/@anthropic-ai` does not exist (DSP-133). Part A needs none.

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
- **Cursor:** the review discussion uses the agent chosen for it (DSP-132; from the main window, or chosen in the review window); Cursor there needs a Cursor login. Claude there runs with no tools under `REVIEW_PERMISSIONS`, configured but not yet observed live. With Claude chosen the window does not check Cursor's connection at all (DSP-136).

## Part B - Claude in the main chat (live, with authorization)

**Before step 7 - install Claude support** (DSP-133), once, on the Linux machine itself:

```sh
cd DSpatch/app
npm run claude:install
```

Expected: it prints the SDK version it installs (`@anthropic-ai/claude-agent-sdk 0.3.306`) and the folder (`app/claude-support/node_modules`), runs `npm ci` there, and ends with *Claude support installed*. No login and no model run. Without it, step 7's *Agent* select reads *Claude (not installed)* and says how to install it. To remove support afterwards, delete `app/claude-support/node_modules`.

7. **Start with Claude enabled**, from a new login shell:

   ```sh
   cd DSpatch/app
   DSPATCH_CLAUDE_AUTHORIZATION="<reference text>" npm run dev
   ```

   Expected: in *Open a project*, the *Agent* select offers *Claude* (without the variable it reads *Claude (off)*; without Claude support, *Claude (not installed)*).

8. **Open the sample as Claude.** Choose *Claude* under *Agent*, then *Use a generated sample project*. Expected: the composer shows Agent Claude and Model claude-haiku-4-5; Session details show the tool policy (Read, Glob, Grep, Edit, Write; no Bash) and the authorization note; no Cursor agent is created.

9. **One question, one change.** Ask a question about a file, then request one small change. Expected: an answer; the change appears in the diff; DSpatch's own Run button runs the test (Claude has no Bash).

10. **Stop during a turn.** Start a longer request and press Stop. Expected: the turn reads *stopped · provider work unknown* (or *Stop not confirmed · provider work unknown* if the end could not be confirmed) - never a plain "cancelled".

11. **Reopen.** Quit and start again with the same variable. Expected: the conversation opens as Claude. *Agent* keeps *Claude* from the last start (DSP-136); if another agent is chosen, the conversation opens with its history and offers *Resume with Claude*. Whether the provider session itself resumes is not established (DSP-122 is offline-verified only); DSpatch says which it did.

12. **Without the variable.** Start once with plain `npm run dev`. Expected: the Claude conversation is not resumed through Cursor; the window says the session belongs to another agent and offers *Start new Cursor session*.

## Part C - a loop with Claude (live, after Part B)

Loop runs use the chosen agent since DSP-138, and since DSP-139 a bundled example lets DSpatch run a real test between Claude's change and Claude's check. Before this trial all of it has run with Claude only offline: the real Claude adapter on a substituted SDK, in tests, with DSpatch running a real `node --test` in a generated repository. Run Part C only after Part B behaved as expected, in the same kind of launch: Claude support installed, `DSPATCH_CLAUDE_AUTHORIZATION` set, Claude chosen, and **one** folder open (Claude works in one folder; with more open, the run is refused before it starts).

Claude's loop steps can read and edit files but cannot run commands (no Bash; the same permissions as the main chat). In a loop, tests are therefore run by DSpatch itself in a **gate** step, and the check step judges the change against that real result.

**Node for the gate.** The example's gate runs `node --test test/duration.test.ts` through the shell, and the test file is TypeScript, so `node` must strip types without a flag: Node 23.6 or later, or 22.18 or later in the 22 line. Record `node --version` from the shell you start DSpatch in. With an older Node the gate ends *Tests failed* with an error about the `.ts` file in its output: an honest result, not a defect in the work. If the gate instead stops with a fault saying the command *could not start*, `node` is not on DSpatch's PATH (for example Node installed through nvm while DSpatch was started from the desktop rather than from that shell); that is a runtime fault, not a test failure.

13. **See which agent will run it.** Open the generated sample project as Claude, open the graph editor and choose the chat loop (`dspatch-chat-loop`). Expected: the line under the drawing reads *Runs with Claude (claude-haiku-4-5)…*, says that agent steps cannot run commands and that a gate's command is run by DSpatch, and adds that the drawing's `cursor` target is only a label. (The line assumes one folder, as the editor's Run does; with more open, *Use loop* refuses even though this line reads *Runs with Claude*.) Select the `check` node: its requirement answers say they describe **Claude**, not the drawing's target. No Cursor agent is created (main log: no `building a cursor` line).

14. **A reading assignment (chat loop).** In the chat, tick *Use loop* and send a small question that needs no command, for example *"Which function in this project formats durations? Name the file."* Expected: *work* then *check*, ending at *done* or *not established*; each step's answer appears under its own step; the run record in `userData/loop-runs/` has `"provider":"claude"`. The chat loop has no gate, so a check there that needs a build still ends *not established*; steps 15-17 are the test-backed runs.

15. **A change verified by a real test (the example).** In the graph editor choose **`dspatch-duration-check`**. Before pressing Run, select the `test` node: its panel says that no agent works in this step and that DSpatch runs `node --test test/duration.test.ts` itself, through the shell, in the run's working folder, with pass or fail taken from its exit code. Select `check`: the panel's description of the message shows the rule that a command result counts only for the snapshot it tested. Press **Run**. It runs in a freshly generated repository in a temporary folder (`dspatch-live-<run id>-…/duration-repo`), never in the open project. Expected:
    - *work* (Claude) edits `src/duration.ts`;
    - *test* shows the command, the folder, **exit code 0** and output reporting 3 passing tests;
    - *check* (Claude) is given that record (command, folder, exit code, output and the tested snapshot) and declares *met*;
    - the run ends at **Change met and tested**; the record has `"provider":"claude"`; the main log has no Cursor line.

    If *check* itself edits a file after the test, the run ends *Could not establish* instead (as in step 17). That is the rule working, not a failure of the trial.

16. **A failing test.** Still in the editor, change the `work` node's purpose on the canvas (Run walks the canvas, including unsaved edits) to *"Do not change any file. Reply RESULT: succeeded."* and press Run. Expected, if Claude leaves the file unchanged: *test* shows a **non-zero exit code** with the real assertion failure in its output; the run ends at **Tests failed**; *check* never starts. The drawing's own purpose, sent to every step as the mandate, still asks for the function to be completed, so Claude may complete it anyway (the run then ends at *Change met and tested*) or declare a specification error (*Stopped without doing the work*); record what it did. That is not a defect: the failing path is shown offline by `app/tests/loop-gate-check.test.ts`. Undo the edit afterwards and do not save it.

17. **A stale result is not accepted (optional).** Change the `check` node's purpose to *"Add the comment `// checked` as the first line of src/duration.ts, then reply RESULT: met."* and press Run. Expected, if Claude makes the edit: the run ends at **Could not establish**, and the check step's record says DSpatch recorded `could-not-check` because the command result no longer described the working folder (`verification-stale`). If Claude declines the edit, note that and what it declared. Undo the edit afterwards.

18. **Cancel during *work*.** Press Run on the example (or send a longer *Use loop* assignment) and press Cancel while *work* is running. Expected: the run stops on *work* (the record names the cancel on that step); neither *test* nor *check* starts. Restarting DSpatch shows the run in history and does not start it again. (A cancel while the *test* command itself runs stops the run before *check*, but the command runs until it ends or reaches its time bound.)

19. **Refusals, no run.** (a) With Claude's conversation open, add a second folder to the workspace and try *Use loop*. Expected: a plain sentence that Claude works in one folder, ending *Nothing was started.* (b) Quit, start once with plain `npm run dev` (no `DSPATCH_CLAUDE_AUTHORIZATION`), **do not start a Cursor session** when the window offers one, and open the graph editor. Expected: the line under the drawing reads *No loop run can start: …* naming why Claude cannot be used. In both cases nothing contacts Cursor and nothing is installed or downloaded. (c) The older duration drawing `dspatch-live-duration` fixes a Cursor model, so its Run is refused under Claude in any launch; that is expected. Use `dspatch-duration-check`.

Record for Part C: `node --version`; the agent line as shown; for each run its end status, the *test* step's command, folder and exit code, and whether the check's message contained them; whether the record carries `provider`; and the session details' reported model and tool list.

## What to record

Distribution and version, kernel, desktop session (X11 or Wayland), `node --version`, `npm --version`, Electron's version, `git --version`; whether the sandbox step was needed; per step: as expected or what happened instead (a screenshot helps); for Part B, from Session details: the reported model, the `apiKeySource` and account fields if shown, and the tool list the session reported. Anything not tried is "not tried", not "works".
