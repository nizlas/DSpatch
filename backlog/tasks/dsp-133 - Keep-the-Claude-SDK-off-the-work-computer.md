---
id: DSP-133
title: Keep the Claude SDK off the work computer
status: Review
assignee: []
created_date: '2026-10-26 13:04'
updated_date: '2026-10-26 22:54'
labels: []
dependencies: []
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Proposal P-4 (run 20261026-200000-linux-claude), before step 3 of Niclas's 26 Oct order (Copilot SDK at work). Claude must not run on the work computer, neither as a development agent nor as a provider in DSpatch. Today @anthropic-ai/claude-agent-sdk is an ordinary dependency, so npm ci on the work computer downloads Claude Code's binary even though DSpatch never starts it there (DSPATCH_CLAUDE_AUTHORIZATION is absent by default). Open question Q4 for Niclas: is installing that binary without running it allowed? If not, make the Claude SDK an optional dependency or install profile that the work setup omits, with the Claude path refusing plainly when the SDK is absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Niclas's answer to Q4 recorded
- [x] #2 If installation is not allowed, a documented work install contains no Claude SDK or Claude Code binary and DSpatch states plainly that Claude is unavailable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Niclas, 26 Oct 2026 (answers Q4): the Claude binary must not be downloaded by an ordinary installation; it is installed only when he explicitly chooses to install Claude support. Plain npm ci and basic build/start must work without it; no hidden install at startup, reopen or rendering a provider choice; choosing Claude without support shows a clear offer or instruction; download only after the explicit choice; missing Claude support must not block review without an agent or other providers. Find what actually causes the download (transitive and install scripts; making one dependency optional is not enough if the default install still fetches it). Reuse existing install patterns; no plugin system. Verify the default install and build in a clean environment and that no Claude binary is fetched; verify the optional path separately without login or model run. Focus (run 20261026-230000-host-review): planning.

Paused 26 Oct 2026 (Niclas) during verification. State: I-1 implemented, uncommitted (report 003 of run 20261026-230000-host-review): the Claude SDK removed from the root package and lockfile (90 entries), installed only by npm run claude:install into app/claude-support/; claude-support.ts status/loader; DSpatch's own SDK shapes + typecheck:claude; guard extended; Claude available only when authorized and installed, with a visible install line. Implementer checks pass (typecheck, build, fast 1253, provider 85, chat 376, presentation 294; scratch-copy npm ci with no @anthropic-ai; claude:install + typecheck:claude in a scratch copy). V-1 (fresh copy, fresh cache proof) running at pause. Next: V-1 result, short review, commit 1.

Result (run 20261026-230000-host-review, commit 977a359 + follow-ups in 9deb086): Q4 answered by Niclas on 26 Oct 2026 (the binary must not be downloaded by an ordinary installation). Plain npm ci installs no Claude SDK or Claude Code binary (verified on Windows in a fresh copy with a fresh npm cache: no @anthropic-ai request, empty cache index, no claude/claude.exe); Claude support is installed only by npm run claude:install into app/claude-support/ (verified separately, no login or run); the window says 'Claude (not installed)' with the install command; a partial install (no binary file) reads as not installed; libc detection only after the SDK is found; typecheck:claude checks DSpatch's SDK shapes incl. key presence. The work computer: plain npm ci only. Not verified: Linux; the work computer itself.
<!-- SECTION:NOTES:END -->
