# A standalone Essentials call for W1.2: prepared, not run

Prepared on 11 November 2026 for Niclas's reading. No model has been called and nothing in the product has changed. The call isolates the writing task from every other instruction DSpatch's walk writer sends. It uses the simple configuration step W1.2 of the invented example `app/tests/support/synthetic-exec-debug.ts`, with the same code and the same code access as DSP-198.

## 1. The prompt, verbatim

This is the whole of what DSpatch would send as the user message. It is also in [`prompt.md`](prompt.md), the file the run would read. Two values are filled in when the call is made, because the sample repository is built afresh for each run and its commit hashes differ each time: `{BASE_COMMIT}` and `{TARGET_COMMIT}`. Nothing else changes.

~~~~markdown
Explain this step to an experienced developer reading the code beside your text. Give them the purpose of this code and the main connection or consequence that helps them understand its place in the program. Choose that overview yourself from the code; ordinary syntax and configuration fields are already visible to the reader. Include a detail when leaving it out would make the overview misleading. Finish when the reader has that orientation.

## Where this step is

The previous step chose the debug configuration. This step names the task that runs the start script. The next step follows the script.

## The code of this step

`.vscode/tasks.json`, target revision, lines 4–10:

```
 4 |     {
 5 |       "label": "Start debugger in dev container",
 6 |       "type": "shell",
 7 |       "command": "${workspaceFolder}/scripts/start-debugger.sh",
 8 |       "options": { "env": { "DEV_CONTAINER": "orders-dev", "DEBUG_PORT": "5678" } },
 9 |       "problemMatcher": []
10 |     }
```

## The revisions

Your working folder holds the two revisions of the repository as files: `base/` is the code before the change (commit {BASE_COMMIT}) and `target/` is the code after it (commit {TARGET_COMMIT}). You can read them, and any surrounding code, with your Read, Glob and Grep tools. You cannot change files or run commands, and nothing outside this folder can be read.

## Your answer

Answer in plain English text. It is shown beside the code.
~~~~

**What it leaves out, as asked:**
- the walk-writer role and the shared pedagogical rules;
- the planner's brief, notes and step summary;
- earlier explanations and session history;
- the review-question instructions;
- Show more, Why it matters and the other explanation fields;
- any heading, sentence, word or identifier count;
- an example answer.

**Choices to check in your reading:**
- **The base revision.** The parenthesis "(the file does not exist in the base revision)" was removed on Niclas's instruction before the run; the prompt above is the one that was sent.
- **The task marker.** The `DSPATCH-REVIEW-TASK:` line that DSpatch's job service puts first is left out, since no job service reads this call.

## 2. What else reaches the model

DSpatch's Claude adapter sets no system prompt of its own. The rest is added by Claude Code, which the Claude Agent SDK runs.

**Known from the code (DSpatch's analysis policy in `app/src/adapter/claude-agent-sdk-adapter.ts`, unchanged since DSP-198):**
- **Folder and model:** `cwd` is the revisions folder, holding `base/` and `target/`, and `model` is `"opus"`.
- **Tools:** `tools: ["Read", "Glob", "Grep"]` and `allowedTools: ["Read(/**)", "Glob", "Grep"]`.
- **Refused tools:** `disallowedTools: ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "Agent", "WebFetch", "WebSearch", "Skill", "mcp__*"]`.
- **Permissions and settings:** `permissionMode: "dontAsk"`, `settingSources: []` and `strictMcpConfig: true`.
- **Confinement:** a hook that refuses any read or search outside the folder.
- **Session:** a session title of DSpatch's choosing, `includePartialMessages: true`, and a new session for this one call.

**Known from the DSP-196 transcript** of an identical adapter configuration (Claude Code 2.1.306; see `../../dsp-196/call-W1.2-essentials-C-1.md`). These are expected again but can only be confirmed at run time:
- **System prompt:** "You are a Claude agent, built on Anthropic's Claude Agent SDK."
- **Tool definitions:** Glob, Grep, `DeferredToolPlaceholder`, Read and `advisor`. The last two are Claude Code's own, beyond the three DSpatch asks for.
- **Account context:** Claude Code attaches it in the user message, before the prompt. It holds the account's email address with Claude Code's note on using it.
- **A system-role message with the environment:**
  - the working folder;
  - "Is a git repository: false";
  - the platform, shell and OS version;
  - a paragraph on untrusted downloads;
  - the model identity line ("You are powered by the model named Opus 5.5 …");
  - the date.
- **Request parameters:** model `claude-opus-5-5`, `max_tokens` 128000, adaptive thinking, effort `medium`, Claude Code's beta flags, and context management that clears thinking.

**Determinable only at run time:**
- the installed Claude Code version and therefore the exact system prompt, tool set and tool descriptions;
- the model "opus" resolves to (`claude-opus-5-5` in DSP-198);
- the effort level;
- the texts of the attached reminders and the date;
- the temporary folder path and the two commit hashes;
- anything a managed policy setting on the machine adds;
- the model's tool calls and their results.

## 3. How the call would be made

1. **Build the code.** A new evaluation script under `app/scripts/`, not part of the product, builds the invented repository with `makeSyntheticRepo(…, EXEC_DEBUG_CASE)`. It writes the two revisions as `base/` and `target/` into a fresh temporary folder, in the same way `profile-locked-compare.mjs` does.
2. **Fill the hashes.** It reads `prompt.md` and replaces `{BASE_COMMIT}` and `{TARGET_COMMIT}` with the new repository's commits. Nothing else in the text is generated.
3. **Create the adapter only.** It creates the product's Claude adapter for analysis through `providerAdapters(…).createAdapter({ provider: 'claude', purpose: 'analysis' })`, with `presentation: false`. It does not load the walk loop's graph or roles, read any plan, or call `writeStepPrompt`, `walksPrompt`, `stepExplanationPrompt` or `presentationPromptSection`.
4. **Send once in a new session.** It starts a new session with `modelRequested: 'opus'` and `workspacePath` set to the revisions folder. It sends the filled prompt once and keeps the full answer and the model the provider reports, then closes the session.
5. **Check what was sent.** Afterwards it reads Claude Code's own session transcript of that call and writes out every part of the request, as `call-W1.2-essentials-C-1.md` did. That confirms that nothing from DSpatch beyond `prompt.md` was sent, and shows what Claude Code added.

The answer would be judged as text shown beside the code. It is plain text, with no split into a first part and Show more.
