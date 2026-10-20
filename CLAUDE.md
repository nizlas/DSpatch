@AGENTS.md

## Claude Code

AGENTS.md above is the governing instruction for this repository; this file adds only what is specific to Claude Code.

- Work in the main checkout of this repository unless Niclas asks for a worktree. The external development loop shares one working copy.
- The development loop's entry point here is the `dspatch-loop` skill in `.claude/skills/dspatch-loop/SKILL.md`, which follows [docs/loop/COORDINATOR.md](docs/loop/COORDINATOR.md). The specialists are in `.claude/agents/` and are generated: change `docs/loop/roles/` and run `npm run roles:generate` from `app/`, never edit the generated files.
- Claude Code running this loop is not Claude Code as a runtime provider for DSpatch. DSpatch's own run engine has no Claude Code adapter, and its capability answers for `claude-code` remain unknown.
