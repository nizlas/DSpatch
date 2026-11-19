# Role sources

- `catalog/` — **DSpatch's shared role catalog** (DSP-231): one file per role version and `catalog.json` with their digests. Every bundled graph DSpatch runs uses these. See [ROLE_CATALOG.md](../ROLE_CATALOG.md).
- `dspatch-*.role.md` — the sources of DSpatch's **external** development loop's agents, generated into `.cursor/agents/` and `.claude/agents/` by `npm run roles:generate`. Not product roles.
- `generic/`, `project/`, `run/`, `review/` — the roles the bundled graphs used before DSP-231. Kept unchanged so that older graphs and project copies keep resolving, and so an upgrade can recognise an unedited copy by its digest. New graphs use the catalog.
