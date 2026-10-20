<a id="role-sources"></a>

# Role sources and the provider files generated from them

A role is written once, in `docs/loop/roles/<id>.role.md`, and the file a framework expects is generated from it. Only Cursor is generated today, because that is where this loop runs.

The reason for the split is not tidiness. Niclas set the premise on 15 September 2026: **once you are working in a framework you rarely port anything**, so the goal is not write-once-run-anywhere. The goal is that a role can be *targeted* at a framework and that nothing is quietly lost when it is.

The same one-source rule is a principle in [AGENT_BEHAVIOUR_AND_ORCHESTRATION.md](../AGENT_BEHAVIOUR_AND_ORCHESTRATION.md): an instruction has one maintained source, a separately kept summary must not stand in for it, and generated provider files stay derived from that source rather than becoming a second thing to edit. That document also proposes how the editor might show and edit a role, which parts of a call are included, referenced or fetched when needed, and what a change means for a role several nodes share. Those are proposals; the format and the generator below are what exists.

<a id="requirements-not-mechanisms"></a>

## Requirements are portable; mechanisms are not

A source says `no-file-writes`. It never says `readonly: true`, which is Cursor's word for it.

That single field shaped this project's whole delivery contract on 15 September 2026, when a read-only Researcher was asked to write files it cannot write and [HANDOFF.md](HANDOFF.md) had to state the delivery rule per role. So each target answers a requirement in one of three ways, and the third is said out loud:

| Answer | What generation does |
| --- | --- |
| Enforced natively | Emits the mechanism and records a note naming it |
| Achieved another way | Generates, and **warns**, naming the requirement and the mechanism |
| Not met, or unestablished | **Refuses** (`unmet`) or warns that it is unestablished (`unknown`) |

A generated file that reads as though a requirement holds when the target cannot enforce it is the one outcome this design forbids. The requirement vocabulary and the capability table are [the graph format's](GRAPH_FORMAT.md) `REQUIREMENTS` and `TARGET_CAPABILITIES`, imported rather than restated, so the two formats cannot disagree about what a requirement means.

Cursor's mapping is four lines of code: `readonly` answers `no-file-writes`, `is_background` answers `background-execution`, `model` answers `fixed-model-selection`. Where a role states no such requirement the field carries Cursor's own way of saying *no constraint* — `false`, `false` and `inherit`. **`model: inherit` is the absence of a fixed-model requirement, not one that was met.**

<a id="the-file"></a>

## The file

```
---
role: dspatch-researcher
title: Researcher
summary: "Investigate a bounded uncertainty ... and return evidence for a decision."
targets: cursor
requires: no-file-writes, no-subagent-delegation
---

## Purpose

...

## Responsibilities

## Boundaries

## Delivery

<!-- target: cursor -->
anything only Cursor understands, carried through byte for byte
<!-- end target -->
```

The four sections are the four things a role has to hold: what it is for, what it does, what it may not do, and what it owes back. They are a closed set — an unrecognised heading is an error rather than a section that travels to one target and is dropped by the next. Cursor renders them as prose paragraphs under the title, in the order the source declares them, because that is the shape of Cursor's own agent files; the headings remain available to a target that wants them.

`targets` is required, and **one target is a legitimate answer**. Generating for a target a role does not declare is refused rather than guessed at.

A `<!-- target: x -->` block is copied out untranslated, so a provider feature this format has never heard of can be expressed without waiting for the format to learn about it. A block for an undeclared target is an error: it would never be generated, and reads as though it would be.

<a id="regeneration"></a>

## Regeneration

```
cd app
npm run roles:generate                                   # compare only, writes nothing
npm run roles:generate -- --out ../staged --write --flat  # stage somewhere safe
npm run roles:generate -- --write                         # write the live files
```

The default writes nothing: it generates in memory, diffs against what is on disk and exits non-zero if they differ. That default exists because the files being replaced are the definitions of the agents that run this loop, and a call dispatched while they were mid-rewrite would get whatever happened to be on disk.

A generated file carries four YAML comments at the top of its front matter: that it is generated, where from, how to regenerate it, and a SHA-256 digest of everything below them. Those comments are why:

- **A hand edit is reported, not overwritten.** If the digest does not match, regeneration refuses and names the source file to move the edit into. `--force` does not override this.
- **A file with no provenance is treated as somebody else's.** The five hand-written originals came back as `foreign`, which is correct: replacing them is a decision a person makes once, not something a re-run does quietly. `--force` is for exactly that decision.

Line endings are CRLF, matching the five live definitions, and normalised before hashing — a checkout convention is not a hand edit.

<a id="targets"></a>

## The three targets, and what we actually know

Cursor, Copilot and Claude Code are on the map. **Cursor and Claude Code are implemented; Copilot is not.** Asking for Copilot refuses and says why: nothing has been run against it from this repository, so whatever we believe about its role files is documentation somebody read, not behaviour anybody saw.

Without `--target`, `npm run roles:generate` generates each role for every implemented target it declares. `--flat` needs `--target`, because the targets use the same file names.

**Claude Code (DSP-107)** writes `.claude/agents/<role>.md` for the external development loop. Its row in `TARGET_CAPABILITIES` answers for the *generated agent file only*, from Claude Code's sub-agent documentation (read 20 October 2026):

| Requirement | Mechanism in the generated file | Evidence |
| --- | --- | --- |
| `no-file-writes` | a `tools` allowlist of Read, Grep, Glob, WebFetch and WebSearch: no Edit, Write or Bash. The role has **no shell**, read-only commands included. | documentation |
| `no-subagent-delegation` | the allowlist leaves out `Agent` and `Skill`. The field is always written, because an omitted `tools` inherits `Agent`. Roles with Bash could still start another agent program; generation warns about this. | documentation |
| `tool-restriction` | the `tools` allowlist | documentation |
| `fixed-model-selection` | `model`, written as `inherit` when the role fixes none | documentation |
| `background-execution` | `background: true`, written only when required | documentation |

Roles that may write files get Edit, Write and Bash with no path limit; a narrower write scope in their prose is an instruction. Claude Code's files use LF, since they had no predecessor. A `<!-- target: claude-code -->` block carries what only a Claude Code agent needs to be told — today, that the read-only roles have no shell.

**On DSpatch's own path, every Claude Code answer is still `unknown`.** Each cell carries an explicit `whenDSpatchWalksTheRun` of *nothing has been run*, because no adapter opens a Claude Code session and every run is checked against `connectedTargets: ['cursor']`. Generating these files makes Claude Code usable for the external loop; it does not make it a runtime provider for DSpatch.
