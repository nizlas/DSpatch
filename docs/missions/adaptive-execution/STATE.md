# Adaptive execution and shared context: working state

The mission's working memory ([BRIEF.md](BRIEF.md), section 6). The mission coordinator writes it before every outcome it names. Niclas may correct it between runs. A run reconciles this file with Git before it chooses anything.

## Where the mission stands

- **Status:** prepared, not started. The first run maps the vision and plans.
- **Engine commit the runs use:** not recorded yet. The first run records the commit of the DSpatch that runs it, and every later run checks it.
- **Last recorded commit of mission work:** none.
- **Sub-goal in progress:** none.
- **Waiting on Niclas:** nothing.

## Plan

No plan yet. The first run's mapping fills this table. Each sub-goal has:
- an id (`S1`, `S2`, …);
- its result and acceptance criteria;
- its dependencies;
- the files or areas it concerns;
- the governing decisions it touches;
- its targeted checks.

| Id | Sub-goal | Depends on | Status | Attempts | Commit |
| --- | --- | --- | --- | --- | --- |

Statuses:
- **pending**;
- **in progress**;
- **reviewed** (accepted by agent review; not Niclas's approval);
- **skipped** (with the reason; not met);
- **blocked**;
- **awaiting decision**.

## Sub-goal records

One section per sub-goal once it starts, with:
- what was done;
- the review's verdict and findings;
- what was checked, by which command;
- what Niclas should try himself;
- steps skipped and why.

## Decisions needed from Niclas

None yet. Give each one:
- the question;
- the decisions it affects;
- the recommendation;
- what can continue without it.

## Run log

One line per run, appended at its end: the date, the batch, the ending and why.
