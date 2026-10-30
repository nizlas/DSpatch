# First Linux trial at home (DSP-131, DSP-117)

A short, ordered trial for the first run of DSpatch on the home Linux machine. Everything it relies on has been **prepared and verified offline on Windows only**; none of it has run on Linux, and no Claude turn has run through the DSpatch window. Requirements, the sandbox step and the background are in [app/README.md, Linux (prepared, not yet run)](../app/README.md#linux-prepared-not-yet-run) and [Claude in the main chat](../app/README.md#claude-in-the-main-chat-offline-prepared-not-yet-run-live).

Part A needs no provider. Part B is the live Claude trial and needs the decisions listed before it. Part C gives Claude an ordinary development task, in the chat and as a loop, in which it runs the build and tests itself (DSP-145).

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

8. **Open the sample as Claude.** Choose *Claude* under *Agent*, then *Use a generated sample project*. Expected: the composer shows Agent Claude and Model claude-haiku-4-5; Session details show the tool policy (Read, Glob, Grep, Edit, Write, Bash, PowerShell; Claude Code's own shell tools in the foreground only, recorded through DSpatch's hooks; no MCP servers) and the authorization note; no Cursor agent is created.

9. **One question, one change.** Ask a question about a file, then request one small change. Expected: an answer; the change appears in the diff; Claude may run the tests itself with its own Bash tool (Part C tries that properly); DSpatch's own Run button still works.

10. **Stop during a turn.** Start a longer request and press Stop. Expected: the turn reads *stopped · provider work unknown* (or *Stop not confirmed · provider work unknown* if the end could not be confirmed) - never a plain "cancelled".

11. **Reopen.** Quit and start again with the same variable. Expected: the conversation opens as Claude. *Agent* keeps *Claude* from the last start (DSP-136); if another agent is chosen, the conversation opens with its history and offers *Resume with Claude*. Whether the provider session itself resumes is not established (DSP-122 is offline-verified only); DSpatch says which it did.

12. **Without the variable.** Start once with plain `npm run dev`. Expected: the Claude conversation is not resumed through Cursor; the window says the session belongs to another agent and offers *Start new Cursor session*.

## Part C - an ordinary development task with Claude (live, after Part B)

Claude runs builds and tests itself with Claude Code's own Bash tool (DSP-145, corrected in DSP-146): DSpatch pre-approves it, keeps every command in the foreground (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, so a command that reaches Claude Code's timeout - two minutes unless Claude asks for more, at most ten - stops instead of moving to the background), and records each command through the SDK's hooks with the code it ran on. DSpatch does not start the command and it is not a sandbox: the command runs with your own rights. On Cancel, DSpatch refuses further tool calls and asks Claude Code to stop; whether the command and anything it started actually end is up to Claude Code and is not documented, which is why step 14 checks for leftovers. Nobody types a test command. Before this trial all of it has run only offline: the real Claude adapter on a substituted SDK whose Bash is simulated after Claude Code's documentation, with a scripted model and real `npm test` / `node --test` commands; `npm run typecheck:claude` passed against the pinned SDK. **Whether Claude itself chooses the right commands and keeps going after a failure, and whether Claude Code's hooks report them as documented, is what this trial shows.** Run it in the same kind of launch as Part B: Claude support installed, `DSPATCH_CLAUDE_AUTHORIZATION` set, Claude chosen, **one** folder open.

Two things to know first:
- **Old Claude conversations** recorded with a DSpatch version from before DSP-146 cannot be resumed: the tools DSpatch gives Claude changed, and a session is not continued under other rules. The window reads *Could not resume the agent session*; its *Details* say the tool policy changed and to start a new session. Start a new session; the old conversation stays readable.
- **Node:** the sample's tests are TypeScript run by `node --test`, so `node` must strip types without a flag: Node 23.6 or later, or 22.18 or later in the 22 line. Record `node --version` from the shell you start DSpatch in. If a command reports it *could not start* `npm`/`node`, they are not on DSpatch's PATH (for example nvm and a desktop-started DSpatch).

13. **One ordinary task in the chat.** Open a **new** generated sample project as Claude (*Use a generated sample project*). Send, without naming any command: *"formatDuration in src/duration.ts only handles seconds. Make it handle minutes and hours as the project expects, and make sure it works."* Expected:
    - Claude reads the code and the README, edits `src/duration.ts`, and runs the project's tests itself (likely `npm test`); under the reply, quiet lines such as *Ran `npm test`: exit 1 (…)* then *exit 0*;
    - if a run fails, Claude reads the output, fixes and runs again in the same turn;
    - the reply says what changed, what was run and what it showed, and what remains;
    - *Session details → Commands the agent ran* lists each command with folder, how it ended, duration, output and *Still current: yes/no* for the code as it is now (an earlier failing run reads *no*: the working copy has changed since it ran);
    - the diff shows the change; no Cursor line in the main log.
    Record what Claude ran, in which order, and whether it stopped too early or looped.

14. **Cancel during a command.** Send *"Run `node -e \"setTimeout(() => {}, 120000)\"` and tell me when it finishes."* (a harmless two-minute wait, named here only to have something to stop) and press Stop while it runs. Expected: the turn ends as stopped; under the reply the command reads *Cancelled (end not confirmed)*, and Session details carries the note that DSpatch did not establish whether it ended. Then check, and record, whether a `node` process from it is left - this is the one thing about Cancel that only a live run can show:
    ```sh
    ps -o pid,pgid,cmd -u "$USER" | grep -v grep | grep -e setTimeout -e "node --test"
    ```

15. **The same task as a loop.** Open another new sample project as Claude, tick *Use loop* and send the task from step 13. Expected:
    - *work* edits and runs the tests itself, possibly several times, and declares it is done;
    - *check* (an independent agent with its own session) runs the checks itself and is handed the commands DSpatch recorded, each marked current or stale; it declares *met*, or *rework* with concrete findings, which sends the work back (at most 2 correction rounds), then checks again;
    - the run ends at *done* (*Assignment met*), *Assignment not met* (including when the correction rounds are spent) or *Could not establish*;
    - a *met* is only accepted if a command completed on the code exactly as the run left it, or nothing changed; otherwise DSpatch records *could not check* (`verification-stale`) and the run does not end at *done*;
    - the run record in `userData/loop-runs/` has `"provider":"claude"` and the commands per step, with `requestedBy: "provider-reported"`; the ending line says the agents' commands are their choice of check, not a verification by DSpatch.

16. **Cancel during a loop command.** Start the loop from step 15 again and press Cancel while *work* runs a command. Expected: the run stops on *work*, the command is recorded as stopped, *check* never starts; record whether any process is left (the `ps` line above). Restarting DSpatch shows the run in history and does not start it again.

17. **The review discussion runs no commands.** Open the review discussion with Claude (Part B) and ask it to run the tests. Expected: it answers in text; no command runs and none is listed. (Since 30 October 2026 it may read the two revisions with read-only tools; it still cannot run anything.)

18. **Refusals, no run.** (a) With Claude's conversation open, add a second folder and try *Use loop*: a plain sentence that Claude works in one folder, ending *Nothing was started.* (b) Quit, start once with plain `npm run dev` (no `DSPATCH_CLAUDE_AUTHORIZATION`), **do not start a Cursor session**, open the graph editor: the line under the drawing reads *No loop run can start: …*. Nothing contacts Cursor or installs anything.

The bundled drawing `dspatch-duration-check` (a gate step in which DSpatch runs a fixed test command) remains as test material for the editor's Run; it is no longer the way to verify work and need not be tried.

Record for Part C: `node --version`; for each task the commands Claude ran in order with exit codes, whether it corrected after a failure, the end status, whether Session details and the run record show the commands with current/stale, and anything where Claude stopped early, looped, or claimed a check it did not run.

## What to record

Distribution and version, kernel, desktop session (X11 or Wayland), `node --version`, `npm --version`, Electron's version, `git --version`; whether the sandbox step was needed; per step: as expected or what happened instead (a screenshot helps); for Part B, from Session details: the reported model, the `apiKeySource` and account fields if shown, and the tool list the session reported. Anything not tried is "not tried", not "works".

## Ubuntu, a remote host and Copilot

The exact commands for Ubuntu 24.04, for a DSpatch host on another machine and for Copilot are in [REMOTE_TRIAL.md](REMOTE_TRIAL.md). Since 31 October 2026 a window that goes through the Wayland compositor is compared with `--ozone-platform=x11` there, and known remaining Linux differences are listed in that document's section 7. Not fixed, and safe: file names that are not UTF-8 appear replaced in a revision folder, and names with `\` or `C:` are skipped there with a reason that speaks of Windows. A desktop launch does not read a login shell's PATH, so start DSpatch from a terminal when Node comes from nvm.
