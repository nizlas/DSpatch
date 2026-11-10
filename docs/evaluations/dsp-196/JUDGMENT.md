# DSP-196 · Judgment

## 1. Compatibility with the reference

The proposed definitions agree with `docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md` (version 1.2). They restate section 4 as what each profile organises its explanation around, at the level section 6 asks for ("goals and freedom", no sentence counts or inventories). Points to align, none a contradiction:

- **"The decisive consequence" is narrower than the reference.** Section 4 says Essentials keeps "decisive conditions or consequences". The completion condition should say "condition or consequence". The condition step W1.3 needs a condition, not a consequence; the variant kept it, through the retained sentence on what would mislead.
- **Show more is not where the rest goes.** Section 4 says the deepening "is not an automatic dump of everything the short part left out". The completion condition says further facts are not automatically things to tell *here*; in the trial they moved behind Show more instead (see section 3). The principle should cover the deepening too.
- **Standard is the comparison point.** Section 4 says Standard's working behaviour is kept and its task not widened. The proposed Standard definition does not widen it. Its completion condition did not change Standard's behaviour in the trial.
- **The planner's brief conflicts in the implementation, not in the reference.** Section 6 says a brief is orientation and the profile decides which of its points the reader needs. The planner's role asks for "what the step must make comprehensible", and the briefs come out as imperative lists of operations ("Explain `-d` …", "Explain what `set -euo pipefail` does, the defaults …, and the `docker inspect` check, including how `2>/dev/null` covers …"). DSP-194 labelled the brief "written for every profile" but did not change how it is written.

## 2. What differs between baseline and variant

Exactly two lines of each prompt (`trial/variant.json`; checked by diffing the prompts):

1. **The profile's reader** (`PROFILES[profile].reader[0]`) is replaced by the proposed definition:
   - Essentials: the code's task and most important effect in the flow; several operations summarised into one meaningful action; the completion condition; the product's sentence on details that would mislead and on what goes after the marker is kept.
   - Standard: how the central mechanism achieves the effect and how the parts work together, done when the mechanism is understandable; the product's sentences on names and language details are kept.
   - Teacher: the understanding the reader must build, done when the mechanism is understandable; the product's sentences on the walk, guarantees and faults are kept.
2. **The shared scope rule** (`EXPLANATION_TASK[3]`) gets one sentence: these are the reader's perspective, not headings or a checklist; facts may recur across profiles; no profile goes on only because the material holds more facts.

No existing instruction contradicted the clarification directly. The reader texts were replaced rather than added to, so nothing is stacked. Everything else, including the planner's brief, is the product's instruction at version 10.

Scope: one invented example, one locked plan, three steps, one model. 48 calls (Essentials twice per cell) and a 6-call diagnostic without the briefs. A difference smaller than the spread between two samples is not a finding.

## 3. What the reader sees, by the request's five questions

**What stands above the explanation.** In a walk prepared by the loop, the Step panel shows the planner's summary of the step first, in every profile, and the loop path has no "Why it matters". The summary is written before the profile is known, and it is itself at the level of the operations. For W1.7 it reads: "docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends." A profile alternative after a switch replaces the whole block, summary included.

**Does Essentials summarise the operations into a task and an effect?** Mostly not, with either instruction.

- In the simple step W1.2, every Essentials text goes through the task's fields: the label match, a shell task, not a background task, the empty `problemMatcher`, the two environment variables. These are the five items of the planner's brief. Variant sample 2 adds a summarising insight ("the script must end quickly"), but keeps the list.
- In W1.7, every Essentials text explains `-d`, the exit code, the `0.0.0.0` listener and `--wait-for-client` one by one. None is organised around "makes the debugger available to the editor". The best summarising sentence came in a variant profile switch: "the task's success only means 'launch requested'".
- In the condition step W1.3, the variant helped in both paths. The baseline lists the brief's three items as bullets (settings, strict mode, the running check). The variant leads with the guard and moves strict mode behind Show more: "**The script does not start the container.** The developer must already have brought it up with compose."

**Does Standard explain the mechanism without walking through the surroundings?** It explains the mechanism in every text. Both versions also take in the surroundings, such as other failures that give the same hint (W1.3) and the port written in three places. The completion condition did not shorten Standard. That is not a regression.

**Does Teacher build understanding rather than add facts?** Yes, in both versions. For example: what `-d` changes, "like calling a function", "a rough comparison is ending a shell command with `&`", and what a problem matcher is. The variant is somewhat more concept-led in W1.7 and shorter in the switch.

**Did a profile leave out something that misleads?** The readiness gap of W1.7 is in every Essentials text. The guard's failure path in W1.3 is in every text. One text from the diagnostic without briefs did mislead by emphasis: W1.2 sample 2 moved "VS Code waits for the script to exit and judges it by the exit code" behind Show more and made the duplicated port its bold point.

**Does the text end when its task is done?** The first parts mostly end with an orientation to the next step. The deepening is where the variant fell short: with the variant it grew into lists such as "Some details that affect the outcome:" and "A few more points from the code around this line:" (Essentials W1.7 and W1.3). The facts the first part no longer carried were moved rather than left out.

**Did the difference in abstraction become clearer?** Only in the condition step, and partly in one switch text. In the simple step and the mechanism step, Essentials stayed at the level of the operations, near Standard's first part with fewer words.

## 4. The diagnostic without the planner's briefs

With the variant and no briefs, the Essentials writer organised W1.2 and W1.3 around the step's role:

> This task is new in this change. VS Code finds it because its `label` matches the configuration's `preLaunchTask` string exactly. The task is a thin wrapper: it runs `start-debugger.sh` on the host with two settings in the environment … **The task must exit before VS Code attaches.**

> This is where the script that the pre-launch task started (W1.2) does its first work. It decides which container and port to use, then makes sure the container is already up. **The script never starts the container. It only checks that it is running.**

W1.7 still went flag by flag. So in the writer path the brief is a large part of what Essentials repeats, but not all of it. The DSP-195 one-call samples, which have no brief, also stayed at the operations. Taking the brief away also lost a decisive point once (W1.2 sample 2).

## 5. Remaining weaknesses

- The step granularity is fixed by the plan for every profile. A step of one line with three flags gives Essentials few operations to summarise into one action. The reference says a profile does not change the walk structure.
- The completion condition moves facts behind Show more rather than leaving them out.
- One model, one example, two samples for Essentials, one for the others. The one-call path, the loop reviewer and the windows were not part of this trial.

## 6. Proposal, for discussion before any implementation

1. **Reference, section 4:** open each profile with what its explanation is organised around, in the proposed words, with "decisive condition or consequence" for Essentials. Add one sentence: no profile goes on because the material holds more facts, neither in the first part nor behind Show more.
2. **Product, the planner's brief and summary (the larger lever in the writer path):** have the planner write the brief as orientation, meaning what the step is for in the flow, how it is reached and what the reader takes onward, including a decisive condition. It should not list the operations to explain. Section 6 already asks for this, so this is a correction of the implementation (the planner role's "what the step must make comprehensible"), not a new rule. The step summary the Step panel shows first in every profile should likewise say what the step does in the flow, not which operations it performs.
3. **Product, the readers:** take the proposed reader definitions in only together with the brief change, and test both in one round on this example, the attach example and the connect example. Include the one-call path and the profile switch, and read the texts the same way.
4. **Not proposed:** more Essentials rules, length targets, or a calibration example in the prompts. The trial does not show that the reader wording alone changes the level.

## 7. Round 2: the planner's brief as orientation

Niclas asked for a bounded follow-up: the same code, steps, places and model, Essentials only first, comparing A (current brief, product readers), B (oriented brief, product readers) and C (oriented brief, proposed readers). Round 1's variant gives a fourth cell, D (current brief, proposed readers). Material: `round-2/` and `texts-round-2.md`.

**How B and C were made.** One call by the same model, with the same code access, rewrote each step's summary and brief as orientation and kept the facts as separate notes. Steps, titles and places were locked (`round-2/prompts/rewrite-briefs.md`, its answer in `round-2/oriented-plan.json`). The writer saw the oriented brief, plus the notes labelled as material for every profile. Nothing else changed. That makes 13 new calls: the rewrite and 2 samples × 3 steps × B and C.

**What the rewrite gave.**
- The briefs became more about the step's role. W1.7: "the point where work passes from the script to a separate process … the reader takes forward two things running in parallel".
- They still name operations where the code is a list of them. W1.3: "it sets strict error handling, settles which container and port it will use, and confirms the container is running".
- The summaries stayed close to the operations. W1.7: "The script hands off to a detached debugpy process in the container, which listens for the editor and holds the service until it attaches."
- The notes kept every fact of the old briefs and added new ones, for example that the published debug port is reachable on all host interfaces without authentication.

**What made a difference.**
- **The oriented brief alone (A to B, and D to C) did not.**
  - In W1.2 every cell goes through the label match, `isBackground`, the empty `problemMatcher` and the two environment variables.
  - In W1.3, B put strict mode back as item 1 of a numbered list, following the oriented brief's own wording.
  - In W1.7, one B sample moved the readiness gap behind Show more and brought the notes' exposure point into the first part instead.
- **The proposed reader definition (A to D, and B to C) helped a little, in the same places as in round 1.** In W1.3, C reads "This is the gate for everything inside the container … It never starts the container itself." In W1.7, both C samples carry the decisive consequence in bold in the first part: "the pre-launch task succeeds as soon as the process has been launched, not once debugpy is ready". C is not clearly better than D. W1.2 is unchanged in every cell.
- **The step summary decides part of the level in every profile.** It stands first and stays at the operations in all cells, oriented or not.

**Conditions and Show more.**
- The decisive points stayed in the first part in A, C and D: the readiness gap in W1.7, the failure path and the gate in W1.2 and W1.3. One B sample moved the readiness gap out of the first part (W1.7 sample 2).
- The deepening became a list of the remaining facts in every cell, and most of all with the notes. Examples: "Exposure", "Port coupling", "Repeated runs", "Module resolution" in C's W1.7; "Repeated values", "Platform" in B's W1.2.
- Keeping the facts as material did keep them available. It also made them a second content list, which turned up behind Show more.

| Visible characters (summary and first part) / behind Show more | A | D | B | C |
|---|---|---|---|---|
| W1.2 | 812/795, 862/429 | 995/663, 929/998 | 947/810, 965/957 | 950/921, 915/1004 |
| W1.7 | 922/804, 1098/960 | 871/981, 739/1252 | 1232/1227, 1379/1082 | 1103/1095, 1122/1123 |
| W1.3 | 1367/663, 1280/833 | 892/1164, 934/856 | 936/713, 996/483 | 1095/822, 1024/656 |

The numbers are shown for completeness; the judgment rests on the texts.

**Result.** The outcome is weak. Writing the brief as orientation, with the facts kept as material, did not change Essentials' level. The proposed reader definition gives a small, repeatable gain in the condition step and in how the mechanism step frames its consequence, but not in the simple step. No variant helped clearly enough to warrant the check of Standard, Teacher and the one-call path, so that check was not made. As Niclas asked, no further prompt round is proposed.
