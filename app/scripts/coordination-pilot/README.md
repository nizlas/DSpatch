# Coordination pilot (DSP-227)

A bounded pilot of whether messaging between parallel branches improves their work, with real agents. The findings are in [docs/loop/pilots/branch-messaging-pilot.md](../../../docs/loop/pilots/branch-messaging-pilot.md).

- `scenario/` is the synthetic repository every run starts from (copied and committed fresh per run).
- `roles/` holds the pilot graph's three roles.
- `pilot.ts` builds the graph with the reusable sections, runs it through DSpatch's run engine with the Claude adapter (the lead's turn is scripted, so both variants start from one split), and checks each branch's commit and the integrated result against figures no agent sees.

Run from `app/`, in a clean environment and an empty output folder outside every project:

```bash
env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 node --import ./scripts/ts-resolve.mjs scripts/coordination-pilot/pilot.ts mailbox /path/to/empty/folder
```

`mailbox` offers the branches the mailbox tools; `none` offers none and says nothing of them. It uses the Claude login DSpatch already has; it calls the provider, so it costs a few short agent turns per run.
