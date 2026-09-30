---
id: DSP-26
title: 'One identified run behind the chat, the graph and the record'
status: Review
assignee: []
created_date: '2026-09-17 18:45'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-25
priority: high
type: feature
ordinal: 15100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

The chat window, the graph editor and the saved record are three places that can each form their own opinion of what a run did. They already have. The first real trial on 17 September 2026 drew a green “completed” badge over a run that had stopped at the *Failed or abandoned* terminal, because the badge read the walk’s own status while the sentence beside it read the terminal. One run, two state models, two answers.

This story is the rule that prevents the class, not another instance of the fix: chat, graph and record read the same identified run and the same recorded events.

### The distinctions that must survive

The trial also showed that “did it work” is not a boolean. A gate that ran no command reported the user’s tests as failed — a false statement about his code. These are five different things and the product must never merge them:

1. Work that succeeded.
2. Tests that ran and failed.
3. Verification that was not performed, for example because no command was configured.
4. A command that could not be started.
5. Cancellation, waiting, and unknown outcome.

Reaching the end of a graph walk is not, on its own, evidence of any of them. The format cannot say which terminals mean success, so success cannot be inferred from arrival.

### Relationship to DSP-25

DSP-25 is the record; this is the single identity and the vocabulary written into it. They are separate because one is storage and the other is meaning, and they will be built together in the first increment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The chat, the graph view and the saved history are driven by the same identified run and the same recorded events, with no second state model that can begin to contradict the first.
- [ ] #2 Successful work, tests that ran and failed, verification that was not performed, a command that could not be started, and cancellation or waiting or unknown outcome are distinguished from one another, both in what the user sees and in what is recorded.
- [ ] #3 Completing the graph walk never by itself produces a green successful result.
- [ ] #4 The run uses the command and working directory the user actually chose, and invokes them correctly, including a PowerShell build script.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
17 September 2026, 21:05 local. Two defects arriving from run `20260917-182500-gate18` call 002 belong to criterion #2 and are folded into the first increment rather than left as follow-ups, because both are the same subject: telling the truth about a command that did not run.

**W2 — a command that cannot be started makes the run hang, not fail.** `finishCommand` in `main/loop-live.ts` registers a `close` listener and no `error` listener. A working directory deleted between Send and the gate therefore produces an uncaught `ENOENT` in the main process and a promise that never settles. Measured by the Verifier, pre-existing rather than a regression. Until this is fixed, criterion #2s fourth state is unreachable by the very path it was written for.

**W3 — a mistyped command is indistinguishable from a failing test suite.** Measured, not assumed: because `shell: true` is used, a missing executable comes back as exit code **1** — not `9009` — so nothing downstream can tell it from a genuine test failure. The Verifier ruled out the two cheap answers: the exit code cannot carry it, and parsing stderr would break on a localised Windows. Resolving the executable before spawning is the honest option and is real work.

Related and recovered from the compiled artifact rather than from anyone's account: the pre-fix code fabricated `exitCode: 1` for “nothing to run”, which is the complete causal chain for the false “tests failed” Niclas read on his first trial.

---

Run `20260917-204500-obs18` call 001 Implementer **COMPLETE** on this card and DSP-25 together. 444 tests passing across 47 suites; typecheck exit 0; no provider turn.

**One derivation, not three.** `RunOutcomeKind` is `work-verified | tests-failed | verification-not-performed | command-could-not-start | unresolved`, and `runOutcomeFrom` is the only place any of them is decided. It is computed in the main process when the record is closed, written into the ending line, and returned to the renderer in the same object, so the chat column, the badge and any later reader of the file report one value rather than three derivations of it. **That is the fix for what Niclas met** — a green badge over a run whose own sentence said it had failed was two derivations disagreeing, so the second derivation was removed rather than corrected.

The order of the checks inside `runOutcomeFrom` carries the meaning and is commented as such: the two states only a command can report come first, because the gate's runtime fault is how “we started no process” reaches the runner, and a general `unresolved` branch ahead of them would swallow exactly the distinction #2 exists for.

**#3 is now a property of the vocabulary rather than of a colour table.** `work-verified` requires a command that ran to the end and exited 0; there is no path to it from the walk alone. A walk that reached a terminal having run no command reads “DSpatch did not test the project … that is not a test failure”. Proven by reverting to “reached a terminal means verified”, which fails on four sentences each quoting the false claim.

**W2 fixed, and measured rather than assumed.** Spawning into a directory that does not exist makes Node emit `error` even with `shell: true`, because it cannot start `cmd.exe` there; with nothing listening that was an uncaught exception in the Electron main process and a promise that never settled. Both listeners are now registered with a settled flag deciding which wins, and the new test carries a timeout so a regression to hanging fails the suite rather than stalling it. Two revert proofs, because the defect has two halves: removing the listener reproduces the uncaught `ENOENT`, and swallowing the error reaches the second half, where the run reports the meaningless “exit -4058”.

**W3 fixed properly, with three rules that keep it honest.** `command-start.ts` resolves the first word against the working directory, `PATH` and, on Windows, `PATHEXT`, mirroring `cmd.exe`'s search order. It **never gates the spawn** — the command is always started exactly as typed and the module is consulted only after a non-zero exit, so a gap in its own knowledge (a `doskey` alias, an App Execution Alias, a shell function) can at worst word a failure badly rather than refuse a command that works. It **answers only when it is sure**: any shell syntax in the line — a pipe, a redirect, `&&`, `%VAR%`, an unclosed quote — is undecidable and DSpatch says nothing, because half a shell parser is the thing the module exists to avoid. And **the shell's own message is passed through rather than replaced**, which on Niclas's machine means it will be in Swedish and will name the word that was not found.

**#4 met for the command and directory, with one caveat worth knowing before the trial.** A bare `.\script.ps1` is still not runnable through `cmd.exe`, which does not execute `.ps1` directly. That is the shell's behaviour and predates this work; what changed is that such a command is no longer *misreported* — the resolver finds the file, says nothing, and the shell's own message stands. The field should contain `powershell -NoProfile -File .\script.ps1`.

**#1 is met for the chat and the record and is only prepared for the graph.** DSP-28's live graph does not exist yet, so “the graph reads the same run” is not demonstrated. That is the honest state and it is what DSP-28 must not undo by introducing a second model.

---

Call 002 Verifier on candidate `sha256:f4b03df8e7e9e9e75937ee6bb2b6eb9d062e4158557b5fb9e77a4e181328f2fe`, confirmed matching three times, nothing in the repository modified. **The record format held; the outcome vocabulary did not.** Numbers reproduced exactly: 444 pass / 47 suites / 0 fail, typecheck exit 0. The claim the handoff was most sceptical of was checked properly and is true — comparing **test-name sets** rather than counts, nothing green at baseline is missing, and “30 added, 0 removed” reconciles once node's per-suite lines are accounted for (450 = 414 + 36, 491 = 444 + 47).

**DSP-25 #4 proven against a process that was really killed**, not against the parser: a child wrote a header, a reply and a stream of journal lines, `taskkill /T /F` ended it, and the record read back as `interrupted` at both 8 kB and 8 MB, with everything written before the kill intact and no parse error. One honest gap — `truncatedLastLine` stayed false because `appendFileSync` proved atomic at both sizes on this file system, so the truncation branch remains proven only by unit test. The Verifier tried twice and recorded the failure to reproduce rather than claiming the pass.

**Three defects, all in the outcome vocabulary — which is precisely what DSP-27 and DSP-28 were about to be built on.**

**D3, the most serious, and it lands on Niclas's own build command.** `.ps1` has no file association on this account, so `cmd.exe` hands a bare `.\scripts\build-windows.ps1` to `ShellExecute`. Measured twice: either the command returns **exit 0 having run nothing at all** — the script's own `Write-Output` never executed — which the product's own functions turn into `work-verified`, badge “your command passed”, and the sentence *“The command you chose ran and exited 0 … That is a statement about your project, made by your own command”*; or it **never returns**, observed sitting for 154 seconds until the process tree was killed. So #3 is satisfied to the letter by `runOutcomeFrom` and defeated in effect through the gate. The structural half outlives the `.ps1` case: **the gate command has no deadline.** `deadlineAt` is raced against the provider turn in the agent branch, while the gate branch is a bare `await runTest(...)` with nothing racing it. Call 001's caveat understated this — there is no shell message to stand.

**D2 — the resolver claims a program is missing when it is not, live on this machine today.** `winget --version` prints `v1.29.290` and exits 0; the resolver says it does not exist. Measured root cause: App Execution Aliases are reparse points that `fs.statSync` refuses with `EACCES`, and while `resolveExecutable` has an `undecidable` branch for exactly this, `resolveExecutableHere`'s `exists` callback catches **every** error and returns false — so **the module's own safety valve is unreachable in production**. Two further over-claims measured by differential test (`mytool,arg` and `mytool=arg`, since `cmd` treats `,` and `=` as separators while the shape guard breaks only on space and tab; and a tool reachable only through a quoted `PATH` entry, which is not live on Niclas's machine — 23 entries, none quoted). **And the stated harm bound is wrong:** “the worst a wrong answer can do is word a failure badly” does not hold as built, because `notRun !== null` makes the gate return a runtime fault, which *stops the run* instead of taking the graph's `fail` edge. The Verifier also corrected its own first pass, withdrawing `python3` as a false positive.

**D1 — the outcome and the sentence beside it are derived from different commands.** `runOutcomeFrom` quantifies over every command; `describeRunOutcome` reads only the last one. A run recording exit 1 then exit 0 writes `tests-failed` with the sentence “…ran to the end and exited **0**” into the same ending line — the shape of the defect Niclas met, one level down. Not reachable on today's graph, which has one gate reached once, but three things point that way: `inspection.commands` is an array, the replay cache keys on `node:occurrence` so a re-entered gate runs again, and DSP-22's editor lets a person draw the retry edge. The search for a second derivation of the outcome *value* found none, so call 001's claim holds for the value; it is the **text** that has the second derivation.

**Criterion state after verification: #1 FAIL (D1 is the contradiction the criterion forbids), #2 FAIL (D2 puts a real, working program into `command-could-not-start`), #3 structurally PASS and defeated in effect by D3, #4 FAIL on the clause that names a PowerShell build script.** `powershell -NoProfile -File .\script.ps1` works correctly, so #4 is one documented convention plus a deadline away.

Rework round 1 opened as call 003, on D3 first, then D2, then D1 — none needs a provider turn to fix or to re-verify.

---

Call 003 Implementer **COMPLETE** on all three defects and the DSP-25 start-time item. **468 passing across 53 suites**, against a measured 444/47 baseline; typecheck exit 0; no provider turn.

**D3 was two defects sharing one symptom, and the second is the more serious.** Diagnosing the bare `.ps1` found that **a gate command had no deadline of any kind** — not a long one, none. `finishCommand` waited on process exit forever and the gate awaited `runTest` without racing the step's own `deadlineAt`, so anything that fails to return — a hung test runner, a prompt waiting on stdin, the invisible "How do you want to open this file?" chooser — holds the run open with no ending and nothing on screen. The Implementer fixed both halves rather than choosing, and its reason is right: shipping the chat surface and the live graph on top of a run that can silently never end would be building a live view over the one failure a live view cannot render.

Three parts. The unrunnable form is **refused before anything is spawned**, naming the file found and giving the pasteable working form, with four deliberate guards each tested — not Windows, not a simple line, `.PS1` present in `PATHEXT` (a statement by this account that DSpatch defers to rather than overrules), or the file not existing (an ordinary typo already has a message, and answering it with PowerShell advice would be worse than silence). The command gets a 15-minute deadline that kills the **process tree**, because `cmd.exe /c` is the parent of the thing that hangs and killing it alone orphans the child. And the gate races its own deadline, catching a `runProjectTest` that never settles at all.

**A stopped command needed its own word**: `did-not-finish`, mapped to `unresolved`, reading "The command was still running after 15 minutes, so DSpatch stopped it." The fault kind is `step-timed-out` rather than `no-outcome-delivered`, because an outcome *was* delivered — it says the command was stopped.

**The best revert log in this run is `10`.** With the deadline removed, the test asserting the timeout fails *and the test runner itself never exits* — killed at 45 seconds, because the reverted code leaves the child alive and node holds its stdio pipes open. The product's own failure reproduced on the harness. The log is truncated with no totals line and says so.

**D2 had three distinct causes**, each reproduced against the real shell before the module was asked. A bare `catch { return false; }` turned every `statSync` error into "no such program", which is why the `undecidable` branch was unreachable — only `ENOENT`, `ENOTDIR`, `ENAMETOOLONG` and `EINVAL` now mean "nothing there" and everything else is rethrown. `,` and `=` are accounted for as argument separators. Quoted `PATH` entries are unquoted the way the shell does it. **And the harm bound is corrected in the code's own comment**, which is the part that matters for the next reader: a program the resolver cannot see does not merely get worded badly, it changes the **walk**, and the record then tells the user the exit code came from the shell rather than from their project — a false statement about their code.

**D1** is closed by one exported `decidingCommandFor(outcome, commands)` that both the outcome and its sentence go through, so any future surface asks the same function and cannot disagree with the badge.

**Two things named rather than hidden.** The 15-minute deadline is a guess — the first this code has ever had, with no measurement to size it from; it is an exported constant and should become a per-node budget once the editor owns step budgets. And the refusal table has one entry: `.vbs`, `.js` and `.py` have the same shape of problem on Windows and were deliberately not added speculatively.

Call 004 Verifier on candidate `sha256:975e701897bc3a6654f0aefc11830e59f1be2cf5c938c4eec76d427084927b80`, confirmed three times. **All four earlier findings genuinely closed, each reproduced against the real machine rather than read.** 468/53/fail 0 reproduced; nothing green at baseline missing, checked by name (491 → 521 lines, 0 absent, and the 30 new reconcile exactly as 24 tests plus 6 suites). **#1, #2, #3 and #4 all move from FAIL to PASS.**

Worth recording as measurements rather than claims: `winget` now reaches `undecidable` and DSpatch says nothing about it, while a genuinely absent program still gets its message — so caution did not cost the useful case. The recommended `powershell -NoProfile -File …` form was run for real and its exit 3 arrived unchanged as a true `tests-failed`, which is what makes the refusal defensible. And the refusal was attacked from the over-eager side with six commands that would have worked, including a typo'd `.ps1`, a different host, a non-simple line and a `.ps1` passed as an argument: **none was refused.**

**A correction that makes the work look better than its author claimed.** Call 003 listed `.vbs`, `.js` and `.py` as unhandled cases of the same problem. Measured, this machine's `PATHEXT` contains `.VBS`, `.JS` and `.PY` but not `.PS1` — so `cmd.exe` starts those as programs and they do not have the problem at all. `.ps1` is conspicuously the one extension Windows leaves out, which is why it was the one that bit, and the single-entry table is better justified than its own author believed.

**D4 — the deadline reports a kill it has not always achieved.** New, found by attacking the newest code as instructed. `killCommandTree` was driven in three shapes with each descendant's pid written to a file so `Get-Process` could witness from outside. An ordinary tree dies correctly. But where an intermediate **exits before the deadline fires** — the shape of every tool that starts a daemon, watcher or compile server and returns — `taskkill /T` follows a parent link to a process that no longer exists, and the descendant survives. Measured: DSpatch's record said “so DSpatch stopped it” while `Get-Process` showed a `node` process alive and its heartbeat file still advancing 34 seconds later.

Two things compound, and the second is the real defect: `killCommandTree` **never consults `taskkill`'s exit code** — the error handler is empty by design — so DSpatch cannot know whether the kill worked; and the sentence claims it unconditionally. In the tree that died and the tree that survived, **the message DSpatch wrote was byte-identical**. A statement that reads the same whether or not it is true is not evidence, which is the one thing this product's records are for.

**The fix is already written forty lines away.** The gate's outer backstop, added in the same call, says the command *may still be running: check for it before starting another run.* `finishCommand`'s inner message says “so DSpatch stopped it” with no such caveat. Split accordingly, on the Verifier's recommendation and my agreement: **the sentence is corrected in the next implementation call**, and the containment becomes [DSP-34](dsp-34%20-%20Make-a-stopped-command-actually-stop-including-its-descendants.md). Neither holds DSP-27 or DSP-28. Narrowness stated so it can be weighed: it needs a command that does not return **and** a descendant started through an intermediate that has since exited, and it only fires after the bound, which is 15 minutes by default.

**Two smaller findings.** A sub-minute bound reads “still running after 0 minutes” — harmless at today's default, but the plan is for this to become a per-node budget owned by the editor, and the first person to draw a 45-second gate budget will read that sentence. And `app/tests/gate-command-reality.test.ts` is the only file in the repository with a UTF-8 BOM, plausibly from the same shell scripts that failed to restore the constant; functionally harmless, worth sweeping so the next encoding check does not have to distinguish a benign BOM from a real one.

**Method note from the Verifier that is worth more than the finding it enabled:** its first test-name comparison silently matched zero lines, because the tick mark in these logs is cp437 mojibake stored as UTF-16 and decodes to characters that are all Unicode word characters. A comparison that matches nothing looks exactly like a comparison that passes. It caught its own false clean and wrote the warning into the script.

**A process-honesty note worth keeping.** Mid-call a revert script failed to restore a constant in `loop-live.ts`. The Implementer found it by auditing every intended change against the source afterwards, restored it, confirmed the affected test passes on three consecutive isolated runs, and checked all eleven touched files for encoding damage from the same scripts. The reported 468/53 is from the restored tree. This is the second time in two days that a revert script has left the tree dirty; the audit-afterwards habit is what caught it both times and should stay.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Unaffected in principle; its vocabulary changes. The rule that "worked", "failed", "was not checked", "the machinery broke" and "unknown" must never be merged survives intact. The five current outcome names are written in terms of a command DSpatch spawned and must be restated against a step's declared verdict plus what was observed. One consequence worth keeping: reaching the end of the drawing still never earns a positive outcome on its own — a step must declare the assignment met **and** something must have been observed to support it.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
