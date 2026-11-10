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
