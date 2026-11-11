# DSP-198 · Judgment

## 1. What reaches an Essentials writer today (instruction version 11)

Each path's built prompt is in `baseline/`. Outside the Essentials reader itself, these parts ask for content or set a level:

**Shared by every path that explains a step:**
- **The shared task (`EXPLANATION_TASK`).** Its first line lists what an explanation may cover: what the code does, why it matters, connections, conditions, risks. Its third asks for understanding beyond the lines and exactness about guarantees, a mechanism-level demand. Its fourth carries version 11's rule to keep the first part compact and move secondary detail behind Show more.
- **The walk reading rules.** The transition rule lists what to make comprehensible: how the step is reached, what the caller needs, returns, branch points, workers and callbacks, the execution order.
- **The Show more contract (`DEEPENING_RULES`).** For Essentials it asks for "the mechanics an experienced developer may want next".

**Loop writer:**
- **The writer's role.** It repeats a definition of every profile ("for Essentials an accurate main picture …"), says how to keep the walk in view, and gives the scope rule again.
- **The planner's brief, "written for every profile".** It is an instruction in practice: "Explain that the task is an ordinary shell task … Point out that `DEV_CONTAINER` and `DEBUG_PORT` are passed here". Every step's brief is also in the walk outline.
- **The writing rules.** "Say who does what" and "keep the real names" are form rules that still pull towards naming each part.
- **The reading instruction.** "Read whole files … keep looking until you can explain or judge from the code itself" gives the writer much more material than an orientation needs.
- **Session history.** After the first step, a writer's later turns in the same session carry only the step section. The earlier steps' prompts and answers stay in the session and act as examples of the level.

**One-call preparation:**
- **The step summary.** The schema describes it as "A short line: what happens here." The writer writes it, and the Step panel shows it first.
- **The walk's own rules** on places, a coherent path and the change's summary decide structure, not the level.

**Profile switch and regeneration:**
- **The framing** is the review question's: "Explain and review the code …".
- **The prepared text** of the walk, starting with the planner's step summary, comes as material.
- **Regeneration** adds the earlier explanation as material.

**Loop reviewer:**
- **Transitions.** It checks the course of transitions with the same list as the writer.
- **Every place.** It checks that every place is explained at this reader's level.
- **Version 11's calibration check.** It checks that the first part is neither too thin nor too dense.

**Loop path display:**
- **The planner's summary** is shown first in every profile, written before the profile is known. For W1.2 it reads: "A shell task with the matching label runs start-debugger.sh with the container name and port in its environment."

## 2. What B changed (loop writer, the only path tried)

The difference is visible in `compare/prompts/`, sample 1 of each step:

1. **The Essentials section** ("Every explanation" with the shared task, the boundary rules, and the Essentials reader) is replaced by the new writing task. Kept with it: the instruction to read the code, one fact line ("keep what the code shows apart from your interpretation …, be exact about what it guarantees …"), and the two boundary rules on facts and review decisions.
2. **The Show more contract** is replaced, for this prompt, by "Show more is optional … it is not where the rest of the material goes".
3. **The role's Essentials clause** becomes "for Essentials the purpose and the main connection or consequence, chosen from the code".
4. **The planner's brief** for this step is shown as "The planner's notes from planning this step (observations to check against the code, not a list of what to say)". The other steps' briefs are taken out of the outline.

Kept unchanged: the walk reading rules, the rest of the role, the writing and answer-format rules, the code access, the step's place, summary and neighbours. No sentence quotas, limits or clipping.

## 3. Result: B is not a clear improvement

**W1.2, the simple configuration step.**
- **Both versions list the fields.** A and B both name the label match, the shell task, the two environment variables, `isBackground` and the empty `problemMatcher`.
- **B made it worse.** It put the environment variables in bold, "**`DEV_CONTAINER` (`orders-dev`) and `DEBUG_PORT` (`5678`)**", and left Show more empty. The port duplication that A had kept behind Show more moved into the first part.
- **Neither is organised around the step's purpose.** A sample 1 opens closest to it: "This task is the link between the editor and the container."

**W1.7, interacting mechanisms and a decisive condition.**
- **Both versions go flag by flag:** `-d`, `0.0.0.0`, `--wait-for-client`.
- **B is not more orientating.** Its first part is longer in both samples, because it took in what A put behind Show more.
- **The decisive condition is kept in all eight texts.** For example, B sample 1: "The task's success only means `docker exec` started the process. It does not show that debugpy came up."

**The summary.** The planner's summary stands first in both versions and is itself at the level of the fields ("runs start-debugger.sh with the container name and port in its environment").

The new task did not change what the writer selects. Saying "ordinary syntax and configuration fields are already visible to the reader" and "Finish when the reader has that orientation" did not stop the writer from going through them. Making Show more optional moved material up rather than leaving it out.

## 4. What this suggests, without a new prompt round

The replaced lines were not what held the level. Four things still pull towards the details:

- **the planner's notes,** which still say "Explain that …";
- **the reading instruction,** which sends the writer through whole files;
- **the role and the walk rules,** which still ask for transitions and the walk's course;
- **the model's own habit** of accounting for what it read.

Earlier trials (DSP-195, DSP-196) found the same. As asked, no further prompt changes are proposed here, and the product is unchanged. The loop reviewer step was not run, since there was no good Essentials text to give it.
