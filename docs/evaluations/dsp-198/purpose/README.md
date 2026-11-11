# DSP-198 purpose trial

Does a description of what Essentials is for help the model choose the level? Four standalone generations on 11 November 2026, with no product change.

| Path | What it is |
| --- | --- |
| `JUDGMENT.md` | The judgment of the four texts against the code. |
| `TEXTS.md` | The four answers verbatim, by step and variant. |
| `task-B.md` | Variant B's writing task, verbatim. Variant A's is the first part of `../standalone/prompt-2-orientation.md`. |
| `prompt-<step>-<variant>.md` | The four prompts, before the commit hashes were filled in. |
| `run-<step>-<variant>/` | Each call: the prompt sent, the answer, the record, and `call.md` with the whole request from Claude Code's transcript and its checks. |

Made with `app/scripts/standalone-call.mjs --prompt <prompt> --out <dir> --model opus`, one call per prompt, each in a new session.
