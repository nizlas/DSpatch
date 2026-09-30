# DSP-13: What has actually been measured about people understanding code and changes

Status: research synthesis deliverable for DSP-13, milestone m-1. Compiled 15 September 2026.
**Revised 16 September 2026** after an independent review read the **full text** of §9.1's
load-bearing citation, which this document's author reached only in abstract. Nine corrections
are applied in place and left visible; they are listed together in §14. The central conclusion
survives and two of the corrections strengthen it.
Governing direction: [VISION.md](../VISION.md) sections 1.1, 3, 3.1 and 3.2; [REVIEW_RESEARCH.md](../REVIEW_RESEARCH.md).
Companion: [DSP-12 interaction gallery](dsp-12-interaction-survey.md), which catalogued what has been *built*.
Audience: DSP-14, which compares concepts and runs small trials with Niclas.

DSP-12 asked what exists. This asks what has been *measured about people*. The two
deliverables are meant to disagree in places, and they do: three of DSP-12's conclusions are
corrected here on the evidence, and they are named as corrections rather than quietly
replaced.

This document is not an exhaustive literature review. It is a bounded appraisal of 22 primary
studies and prototypes, chosen for what they let DSP-14 decide.

## 1. How to read the labels

Two independent labels travel with every entry, because they answer different questions.

**Evidence class** — the same scheme DSP-12 used, for continuity:

- **Documented** — stated in a peer-reviewed paper, official documentation or a first-party
  announcement. Described; not seen running.
- **Demonstrated** — a published figure, screenshot or video on the cited page shows it.
- **Personally observed** — we ran it ourselves.

**No entry here is personally observed.** This session had no shell and no ability to install,
run or purchase anything. Where a number below describes an effect, it is an author's reported
measurement, not ours.

**Reading depth** — added because it is the honest constraint on this pass:

- **Read: abstract + quoted passages** — I retrieved the abstract plus verbatim excerpts of
  the results, method or limitations sections, typically from an author-hosted PDF.
- **Read: abstract only** — nothing beyond the abstract and bibliographic record.
- **Not read** — a pointer I am passing on without having opened it. Named as such.
- **Read: full text (16 September 2026, by another role)** — added after this document was
  compiled. Exactly **one** entry carries it: Tufano and colleagues in §9.1, read in full from
  the arXiv HTML rendering of 2411.11401v1 by the Reviewer in run `20260915-224600-w7h3`,
  call 005, including study design, all four results subsections, actionable recommendations,
  threats to validity and related work. Every correction in §9.1 comes from that reading.

**Nothing below was read cover to cover when this document was compiled**, and that remains
true of 21 of the 22 entries. An abstract is not a study you have read, and a
quoted results passage is not a full method section. Where a figure came from my search
tool's summary rather than from a verbatim excerpt, it is marked **(reported, unverified)**
and must not be repeated as established.

Untested proposals are labelled as proposals. Where a finding comes from outside programming,
the transfer to code review is **my inference** and is marked.

## 2. Search record (AC#1)

### Stopping rule, recorded before searching

Verbatim, as fixed before the first query:

> Stop at roughly 12–20 primary studies or prototypes, selected for decision value rather
> than coverage. Prefer depth: an entry whose design, participants, tasks and limitations I
> can summarise is worth more than five citations. Stop a thread when it stops changing what
> DSP-14 would build first. Do not expand a named question into a landscape survey.

### Where I stopped, and the overrun

**22 primary entries against a stated bound of 12–20.** I report the overrun rather than
hiding it. Two causes: the handoff named task resumption as substantially under-weighted in
this project, and covering it honestly needed both the programming studies and the cognitive
model they rest on; and one handed-over reference (Jul & Furnas) turned out to contain no
evaluation, which required a companion empirical source to say anything about the phenomenon
at all. If DSP-14 wants the list cut to bound, cut §9's HOPs entry and §6's foraging entry
first — both are the least directly actionable.

I stopped when the two decision-relevant threads stopped moving: the resumption literature
converged on one consistent picture after four sources, and the AI-explanation literature
converged on one after four.

### Dates and method

All retrieval 15 September 2026, by web search over paper titles, authors and venues,
following through to author-hosted PDFs, conference programme pages, publisher landing pages
and DOI records. No library subscription was used; where a paper sat behind a paywall I relied
on an author-hosted copy where one existed and recorded the limitation where it did not.

Selection was deliberately skewed toward: findings with participant counts and task
descriptions I could state; negative, mixed and context-dependent results; and older work.
**Twelve of the 22 entries predate 2020; six predate 2010; the oldest is 1987.**

### Areas searched where the thing we wanted was not found

Recorded separately from unsearched areas, per REVIEW_RESEARCH.md.

- **No controlled study of an agent-generated *walkthrough* improving reviewer comprehension
  or defect discovery.** This was DSP-12's question 1. Searched; not found. What exists is
  adjacent and is reported in §9: an ICSE 2025 experiment on an automatically generated
  *review*, a field experiment measuring *preference* for AI summaries, and an ESEM 2025
  experiment measuring *perceived quality* of generated PR descriptions. None measures
  comprehension or defect discovery from a walkthrough.

  **Correction, 16 September 2026 — this search record understated what exists.** The sentence
  above is still true of a generated *walkthrough*, but the framing around it implied that the
  change-comprehension measurement space is empty, and it is not. The Reviewer's full-text read
  of Tufano and colleagues found five controlled experiments catalogued in that paper's own
  related-work table, none of which appears anywhere in this document, three of them measuring
  comprehension of a reviewed change by questionnaire. **All five are Not read** and are
  recorded here as pointers, not citations: Zhang and colleagues 2015 (12 participants —
  CRITICS, whose comprehension arm §8.3 does not mention); Huang and colleagues, CLDIFF,
  ASE 2018; Huang and colleagues, ESEC/FSE 2018 (salient-class location); Spadini and
  colleagues, ICSE 2020 (85 participants, 57 of them practitioners, finding that showing a
  reviewer existing review comments before inspection **helped** them identify bug types that
  would otherwise have been overlooked); and Fregnan and colleagues, ESEC/FSE 2022 (106
  participants, finding that the *position* of a file in a review changes the odds of finding
  its bugs). Tao & Kim 2015 (18 participants, 36 review tasks) and Hanam and colleagues,
  ICSME 2019 (11 participants) sit in the same table and bear on §13's principle 3.

  **Named follow-up, not done here:** reading that one table is a bounded task for DSP-14, and
  the Reviewer assesses it as the cheapest available test of the conclusion this document turns
  on. Spadini and colleagues in particular is a genuine counterweight to §9.1's anchoring
  story, with practitioner participants in the same space, and **§11's item 2 is contestable
  while it is unread.** Fregnan and colleagues bears directly on §8.2's eccentricity argument;
  Tao & Kim supplies precisely the reviewer-outcome measure §8.4 notes was missing from
  CLUSTERCHANGES, which would strengthen rather than weaken principle 3.
- **No controlled comparison of an editor minimap against no minimap.** Searched. What exists
  compares a standard minimap against an augmented one (§7).
- **No user study of the desert-fog navigation aids.** Their own paper says the studies were
  planned (§7).
- **No comprehension or defect-discovery study of execution-difference tools.** The tools
  exist (§10); evaluation is by author-run bug scenario.

### Areas not searched at all

- The full program-comprehension theory canon: Brooks, Letovsky, Soloway & Ehrlich,
  von Mayrhauser & Vans. I used the empirical navigation and question-asking work instead.
- Siegmund and colleagues' methodological work on *measuring* program comprehension,
  including fMRI studies and programming-experience instruments. This is a real gap against
  AC#4 and the most valuable single thing a follow-up could add.
- Eye-tracking of diff or code reading; review ordering and working-memory studies
  (Baum and colleagues); test-driven code review.
- Coordinated multiple views evaluation; animated transitions for preserving context
  (Heer & Robertson and successors); provenance and history visualisation.
- Delta debugging as a literature in its own right (only encountered as a citation).
- Accessibility of change cues beyond colour, and keyboard-only review paths. VISION's own
  criteria mention these; no study was sought.
- Legal redlining, film editing and medical imaging comparison — left unsearched by DSP-12
  and still unsearched.
- Sourcegraph-class code search and cross-repository navigation — likewise.

### Access limits

No paper was read in full **in this pass**. ACM Digital Library, IEEE Xplore and ScienceDirect
landing pages returned abstracts only; where I have results detail it came from an author-hosted
preprint or the authors' institutional copy. Three entries carry figures I could not confirm
verbatim and are marked **(reported, unverified)**. One entry (§6, the code-canvas null
result) I could not identify by title, author or venue at all, and is recorded as a lead for
DSP-14 to resolve rather than as a citation.

**Both limits were partly lifted on 16 September 2026, by the Reviewer rather than by this
author.** §9.1's paper is now read in full from its arXiv HTML rendering, which is why that
entry alone carries results, threats and related-work detail the rest of this document cannot
match — and why five of the nine corrections listed in §14 fall in that one section. §6.4's
unidentified entry is now identified. Neither the paywalls nor the remaining
**(reported, unverified)** figures changed.

## 3. Why this document is organised the way it is

AC#5 forbids organising this review around the five concept seeds, so the structure comes
from the evidence. Six clusters formed on their own, and their order reflects how close each
sits to a problem this project has actually observed:

1. Returning to interrupted work — the best match to our only real trial, and the most
   quantified literature here.
2. What people want to know, and who formulates the question.
3. Reducing and co-locating what is on screen.
4. Overviews, zoom and orientation.
5. Noticing that something changed, and decomposing it.
6. Explanations, confidence and trust.

Then three short sections that exist because the evidence demanded them: prior work
occupying a space DSP-12 believed was open (§10), where the evidence cuts against ideas
already recorded in this project (§11), and how any of this could be assessed with one user
(§12, which is probably the most useful part).

### The weighting, and why

From DSP-5's Implementation Notes, 15 September 2026, our only real trial. Niclas read a
complete text diff of a README change on his own C++ project and **did not report difficulty
understanding it.** What he reported was orientation and state: reopening "read as being asked
to choose the repository again"; "use the composer above" sent him the wrong way; an
unresolved-attempt acknowledgement was demanded on every message; the remembered-projects
list had accumulated dead entries he could not remove.

One user, one small change, on code he wrote himself. That does not establish that
comprehension is fine — and §9 gives a specific reason to distrust the absence of a complaint,
since self-assessed comprehension is a weak predictor of measured comprehension. But it does
mean a review weighted entirely toward *reading changed lines* would answer a question our use
has not raised while leaving the observed problem unexamined. So §4 comes first and is the
longest, and it turns out to contain the most directly quantified findings in this document.

---

## 4. Returning to interrupted work

The literature this project had not looked at. It is older than the current tooling, it has
numbers, and it is about precisely what we observed.

### 4.1 How long resumption actually takes

**Parnin & Rugaber, "Resumption Strategies for Interrupted Programming Tasks."** ICPC 2009;
extended in *Software Quality Journal*, 2011, DOI 10.1007/s11219-010-9104-9.
**Method:** exploratory analysis of 10,000 recorded programming sessions from 85 programmers
(86 in the journal version), plus a survey of 414 programmers in the extended version.
**Findings, in the authors' words:** only **10%** of sessions have coding activity start in
less than a minute; only **7.5%** (91 of 1,213) involved editing without first navigating to
another method; in **17%** (209 of 1,213) the programmer navigated away and eventually
returned to the last method edited. In the majority of sessions they navigated somewhere else
entirely. Where the "last edit location" cue *was* applicable it worked well — **35%** of
those sessions resumed in under a minute, against 10% overall — but it applied in only 17% of
sessions, and even then still required navigation elsewhere. Their conclusion: considerable
doubt on the sufficiency of the last edit as an environmental cue.
**Limitations:** observational, from interaction logs; "interruption" is inferred from session
boundaries rather than observed; no task correctness measure; the population is one set of
instrumented Eclipse users.
**How we know:** documented. Read: abstract + quoted results passages.

**Why this matters to DSpatch.** We have no equivalent number for our own tool, and it would
cost almost nothing to get one (§12, probe 1). Also note what the 7.5% figure says about
review design: resuming almost always involves going somewhere *other* than where you left
off. A "take me back to where you were" feature aimed at the last position is aiming at the
minority case.

### 4.2 Which resumption cue works, and which one people want

**Parnin & DeLine, "Evaluating cues for resuming interrupted programming tasks."** CHI 2010,
pp. 93–102, DOI 10.1145/1753326.1753342.
**Method:** a contextual inquiry and survey of **371 programmers**, then a controlled lab study
comparing two automated cues against note-taking alone. The cues differed on two axes:
activities summarised **in aggregate** versus presented **chronologically**, and activities
shown as **program symbols** versus as **code snippets**.
**Findings:** the survey found programmers rely heavily on note-taking across several media.
In the lab study, **both** automated cues performed well — developers using either completed
their tasks with **twice the success rate** of those using note-taking alone. Despite similar
performance, developers **strongly preferred** the cue presenting activities *chronologically
as code snippets*.
**Limitations:** I could not establish the lab study's participant count from the material I
reached, which weakens how much weight the "twice the success rate" figure can carry. Tasks
were laboratory tasks. Preference and performance were measured in the same short session.
**How we know:** documented. Read: abstract + publisher record. **The participant count is a
gap in my reading, not in the paper.**

**Why this matters to DSpatch.** This is the closest thing in this document to a direct
recommendation for something we observed breaking. Phase 0 already stores a conversation with
its attempts; the finding says the useful thing to show on return is a **chronological trail of
the actual code touched**, not an aggregated summary of the session. It also says people prefer
the form that happens to work, which is rarer than §9 will make it sound.

### 4.3 Why a cue works or fails — the mechanism

**Altmann & Trafton, "Memory for goals: an activation-based model."** *Cognitive Science*
26(1):39–83, 2002, DOI 10.1207/s15516709cog2601_2.
**Method:** an activation-based model of goal-directed cognition, formulated algebraically and
tested by simulation against latency and error data from the Tower of Hanoi.
**Findings:** three predictive constraints. The **interference level**, from residual memory for
old goals. The **strengthening constraint**, which predicts the time needed to encode a new
goal. And the **priming constraint**, which predicts what makes a retrieval cue work. On the
authors' account a usable cue must be (i) obvious enough that the system finds it hard *not* to
process, and obvious **both when the goal is suspended and when it is resumed**, since a cue
present at retrieval is useless if no link to the target was established at suspension; and
(ii) specific — it must prime the target and "relatively few distractors", the general
principle being that cues work better when not overloaded.
**Limitations:** the model is validated on a puzzle task, not on software work. Transfer to a
development tool is **my inference**.
**How we know:** documented. Read: abstract + quoted passages.

**Companion.** Trafton, Altmann, Brock & Mintz, "Preparing to resume an interrupted task:
effects of prospective goal encoding and retrospective rehearsal," *IJHCS* 58(5):583–603, 2003,
DOI 10.1016/S1071-5819(03)00023-5. A brief warning interval before an interruption lets people
encode a prospective goal and rehearse retrospectively, reducing resumption lag. Read: abstract
+ quoted passages. (A specific lag duration appears in secondary summaries; **reported,
unverified**, so I omit it.)

**Why this matters to DSpatch — marked as inference.** Applying the priming constraint to
DSP-5's friction list gives an explanation, not just a complaint:

- The **remembered-projects list full of dead entries** is an *overloaded* cue. By the priming
  constraint it primes many distractors along with the target, so it degrades as a retrieval
  aid precisely as it grows. That predicts the problem gets worse with use, which matches what
  he reported.
- **Reopening reading as a fresh repository choice** is a cue that did not co-occur with the
  suspended goal. It is salient, it is specific, and it primes the wrong target.
- The **per-message acknowledgement** is a cue that fires when there is nothing to retrieve.

That is a theory-driven prediction about our own product, derived from a puzzle-task model.
It is cheap to audit without any study (§12, probe 5) and it is not evidence until we do.

---

## 5. What people want to know, and who formulates the question

### 5.1 The questions people actually ask

**Sillito, Murphy & De Volder, "Questions programmers ask during software evolution tasks."**
FSE 2006, pp. 23–34, DOI 10.1145/1181775.1181779.
**Method:** two qualitative studies — newcomers on assigned change tasks in a medium-sized code
base, and industrial programmers on their own change tasks in code they knew. Analysis focused
on what a programmer needs to know and how they go about finding it, including inferred
implicit questions where participants were not explicit.
**Findings:** a catalogue of **44 kinds of question**, in four categories: finding initial focus
points; building on those points; understanding a connected subgraph, including control-flow
and data-flow relationships; and questions spanning multiple subgraphs or the wider system.
The authors also describe how existing tools do and do not support answering them.
**Limitations:** qualitative, two studies, generalised question forms abstracted from specific
utterances, some inferred rather than stated.
**How we know:** documented. Read: abstract + quoted passages.

**Why this matters to DSpatch.** If we ever build a question-driven review interaction, this is
the menu, and it is free. It also tells us the shape of the problem: the categories are ordered
by how far the question reaches, and the hard ones are the last two — relationships inside a
subgraph and across subgraphs. A summary of changed lines answers none of those.

### 5.2 The strongest measured comprehension benefit in this document, and it inverts the burden

**Ko & Myers, the Whyline.** "Debugging reinvented: asking and answering why and why not
questions about program behavior," ICSE 2008, DOI 10.1145/1368088.1368130. Handed to DSP-13 by
DSP-12 without analysis.

**The interaction.** The program runs and is traced. The developer scrubs a slider through
recorded output history, selects a screen element, and the tool derives *from the code and the
trace* a menu of concrete questions about that output — "Why did thickness = 5?", "Why didn't
thickness change?". The developer picks one; the tool answers with static and dynamic slicing,
precise call graphs, value-source analysis and a dedicated algorithm for why a line was never
reached, presented as a navigable causal chain.

**The authors' framing of the problem, which is the transferable part.** To understand a
behaviour, developers "must translate their questions about the behavior into a series of
questions about code, speculating about the causes in the process." Every tool of the era was
garbage-in-garbage-out: breakpoint debuggers make you pick a line, slicers a variable, query
tools an expression. Pick the wrong starting point and the answer is irrelevant. And none could
answer questions about things that *did not happen*, which the authors note are often the
majority of developers' questions.

**Evaluation 1 (pilot, ICSE 2008).** 9 people with the Whyline, mostly self-described novices,
against **18 expert Java developers** using Eclipse 2.1 without it, on one task: find the cause
of a paint program's incorrect blue-slider behaviour. Whyline median **4 minutes** (range 1–12);
control median **10 minutes** (range 3–38); **p < .05**, Wilcoxon rank sums. Novices with the
tool beat experts without it. The authors' observation about *why* is the interesting part:
novices said "Why is the line blue?" aloud and asked that question directly; experts speculated
about mechanisms first ("Why didn't this slider's event get handled?") and only asked about the
colour after failing to find a question matching their speculation. One expert explained that
he "did not expect the Whyline to be able to make the connection between the slider and the
colour," so he thought he had to make it himself.
**The authors' own limitation, verbatim:** "this was a single task, a small sample of people,
and tested unfamiliar code."

**Evaluation 2 (ArgoUML).** 10 Whyline participants against 10 using conventional tools, on two
tasks adapted from real bug reports in ArgoUML, a 150,000-line Java application; 30 minutes per
task; participants wrote a change recommendation rather than editing code. Task 1: **10/10**
completed with the Whyline versus **3/10** controls (χ² = 10.6, p < .05), and twice as fast
(t = 4.5, p < 0.05). Task 2, considerably harder: **4/10** versus **0/10** (χ² = 5, p < .05).
Controls who succeeded "got lucky in their searches and explored hundreds of files, whereas the
Whyline participants only explored a median of three."
**Citation caution:** I read these figures in Ko & Myers, "Source-Level Debugging with the
Whyline." DSP-12 attributed the same study to CHI 2009 (DOI 10.1145/1518701.1518942). I did not
resolve which is the paper of record; DSP-14 should check before citing.

**Limitations the authors state themselves.** Trace-based, therefore "not practical for
executions that span more than a few minutes, or those that process or produce substantial
amounts of data". Useless for bugs that only reproduce without instrumentation. It "feels
heavier" than a breakpoint debugger because you wait for a trace before asking anything. Memory
demand grows with trace size. Java-only, requiring standard Java I/O. Never productised.
**How we know:** documented, including the authors' limitations sections. Read: abstract +
extensive quoted passages from both papers.

**Why this matters to DSpatch, and it is the sharpest design contrast in this document.**
The Whyline and a generated walkthrough are opposites, and the one with the better measured
record is the opposite of the one that ships today. In the Whyline the *user* picks the
question from a menu the tool derived from real code and a real run; the tool's job is to answer
checkably. In a generated walkthrough the *tool* picks what to say and the user's job is to
audit prose. §9 shows what happens when the tool picks.

A concrete, cheap variant for DSP-14 to argue with: given a change, derive a menu of **checkable
questions about that change** — which unchanged code calls this; what behaviour differs; which
recorded test touches this line; what did this line depend on before and after — and let Niclas
pick. Answer each from analysis and from the revision-bound test result Phase 0 already stores.
No trace required, so none of the Whyline's cost limitations apply. This is a proposal, not a
finding: nobody has evaluated it, and the transfer from "why did this output happen" to "what
did this change do" is mine.

---

## 6. Reducing and co-locating what is on screen

Three measured wins and one measured null, all on roughly the same idea.

### 6.1 Reduction driven by measured interaction

**Kersten & Murphy, "Using task context to improve programmer productivity."** FSE 2006,
pp. 1–11. The evaluation behind Mylyn, which DSP-12 identified as the strongest prior art for
DSP-5's friction.
**Method:** longitudinal field study. **99** practising developers using Eclipse enrolled; two
weeks of baseline logging, then an invitation to install Mylar. To keep baseline and treatment
comparable the authors set an acceptance threshold of **3,000 edit events**, which **16**
participants met. The measure was **edit ratio** — editing events divided by
selection/navigation events.
**Findings:** edit ratios were log-transformed and compared with a paired t-test:
**p = 0.003**. Developers edited more and navigated less. The authors then tested the
arbitrariness of their threshold: significance at p < 0.05 holds until the threshold is loosened
enough to include people whose logs show they never used Mylar beyond initial experimentation,
and until it is raised to the point where only six subjects remain.
**Limitations, and they are substantial.** Voluntary adoption, so self-selection is built in:
the people who kept using it are the people it suited. 16 of 99. **Edit ratio is a proxy for
productivity, not a measure of comprehension** — it says nothing about whether they understood
more, only that they searched less. The authors' own threshold-sensitivity analysis is
admirable and also shows the result is not robust to much.
**How we know:** documented. Read: abstract + quoted method and results passages.

**Why this matters.** The design property is the transferable part, not the number: interest is
computed from **measured interaction**, so it is predictable, and the reduction is always
reversible through documented escape hatches. DSP-12 recorded those. But the evidence supports
"people navigated less", not "people understood better".

### 6.2 Focus and context inside a source file

**Jakobsen & Hornbæk, "Evaluating a fisheye view of source code."** CHI 2006, pp. 377–386,
DOI 10.1145/1124772.1124830.
**Method:** **16 participants** — 7 students, 9 professional programmers, all with at least a
year of object-oriented programming. Within-subjects comparison of a fisheye source view
against a conventional linear presentation, across nine task types.
**Findings:** average completion time lower with the fisheye view, **F(1,14) = 4.76, p = .047**
— but tasks and interfaces **interact**, F(8,7) = 9.57, p = .004, so the authors analysed per
task. One-step navigation: no difference. **Two-step navigation: 18% faster, p = .008.**
Delocalisation tasks also substantially faster *(reported, unverified — I did not see the
figure verbatim)*. No loss of accuracy. Participants generally preferred it and rated it more
satisfying. Some control-structure tasks were slower.
**The authors' own recommendation:** compute degree of interest from parts of the code
**semantically related** to the current focus, not merely syntactically near it.
**Limitations:** 16 participants, laboratory tasks, one language and environment, and the
benefit is confined to specific task types — the headline "faster" conceals a significant
interaction.
**How we know:** documented. Read: abstract + quoted results passages.

### 6.3 Co-location, and the mechanism its authors propose

**Bragdon and colleagues, Code Bubbles.** CHI 2010 (quantitative) and ICSE 2010 (qualitative).
DSP-12 catalogued the interaction; the evaluations were not analysed.
**Quantitative method:** **20** third-year, fourth-year and graduate students from Brown's
computer science programme, **between-subjects**, Code Bubbles versus Eclipse. Introduction, a
warm-up task not counted, then two code-understanding tasks with up to 45 minutes each. Each
task was to fix a bug **by reading and understanding the code** — debuggers and trace
statements were not permitted.
**Findings:** Code Bubbles users had **33.2%** lower overall completion time and completed
significantly more tasks. They performed **46.6%** fewer navigations per minute, **50.5%**
fewer repeated navigations, and spent **68.6%** less time navigating.
**The authors' most interesting claim.** The reduction in navigation time accounted for only
**one third** of the total time reduction. The first author hypothesises that the remaining
two thirds is explained by the limits of human working memory: users offloaded working memory
onto persistent working sets, which helped them remember context, compare and refer back
between methods, and re-find methods — "above and beyond reducing navigations."
**Qualitative method and findings:** 23 professional developers recruited via Facebook ads,
roughly 10 years' average experience. Overall rating **4.33 ± 0.26** on a 5-point convenience
scale; **4.7 ± 0.44** for seeing multiple functions side by side; **4.04 ± 0.36** for reviewing
code compared with their preferred IDE; 22 of 23 would consider adopting it as their primary
IDE. Four of the 23 rated review below 4.0.
**Limitations:** the quantitative arm is students, between-subjects, two tasks, Java, and
debugger use was prohibited — which is exactly the condition that most favours a reading-and-
co-location tool. The professional arm measures **preference**, not performance, and the
recruitment channel is self-selecting. The working-memory explanation is the author's
hypothesis, not a measured mechanism.
**How we know:** documented. Read: abstract + quoted results passages, including from the
first author's own summary paper.

**Why this matters to DSpatch, and it is the most directly usable finding in this section.**
VISION section 3 already requires that "relevant functions from multiple files should be
viewable together". This is the strongest measured support for that requirement in this
document — and the authors' hypothesis says the benefit is not mainly saved navigation but
reduced memory load. For change review that argues for showing the changed function **together
with its callers and the relevant unchanged code**, in one persistent arrangement, rather than
building better ways to jump between them. Marked as a proposal: nobody has measured
co-location for reviewing a *change*, only for understanding code.

### 6.4 The null result that stops this from being a clean story

**Bouraffa, Fuhrmann & Maalej, "Developers' Visuo-spatial Mental Model and Program
Comprehension."** University of Hamburg, arXiv 2304.09301, submitted 18 April 2023.
An online **between-subject** experiment with **20 developers**, roughly one hour, comparing a
**code canvas** against a conventional tab-based tool on three code-comprehension tasks, each
with a navigation and a comprehension phase, with a Corsi Block test of visuo-spatial working
memory. **Result: no significant effect of code representation — or of visuo-spatial working
memory — on comprehension performance.** Participants in the canvas condition behaved
differently: the significant differences are in the **time dedicated to different comprehension
activities** — navigation, annotation and UI interaction — **not** a correlation with
comprehension performance.

**Correction, 16 September 2026 — identity resolved, and the entry is weaker than it looked.**
This entry was published with the honest admission that I reached it as arXiv 2304.09301 and
**could not establish its title, authors or publication venue**, and it was recorded as a lead
rather than a citation. The Reviewer resolved it in run `20260915-224600-w7h3`, call 005, and
confirmed every substantive claim above, including the null for both spatial representation and
visuo-spatial working memory. Two things the resolution adds, and one of them cuts against
using this entry as a counterweight:

- **No peer-reviewed venue was found**, and there is a single version. So §6.3's counterweight
  is an **unrefereed 20-participant null**, which is thinner than the entry's placement here
  implies. It remains worth keeping — a null on spatial code layout is the honest complement to
  Code Bubbles — but it cannot carry more weight than an unrefereed preprint carries.
- **It manipulated a canvas within a one-hour session**, not the *persistent working sets across
  a long task* that Code Bubbles' first author hypothesised were the mechanism. The two studies
  therefore may not be measuring the same thing at all. §13's conflicts table anticipated
  exactly this, which was good judgement on thin information, and the resolution confirms it.

The vague clause about "a significant negative correlation at the 0.01 level whose terms I could
not determine" is **withdrawn** and replaced by the activity-time finding stated above. It was
an artefact of reading an excerpt, not a result of the paper as characterised.
**How we know:** documented (unrefereed preprint). Read: quoted passages only, no abstract page
reached in this pass; identity and the activity-time finding verified by the Reviewer.

### 6.5 Why navigation behaves the way these studies find

**Lawrance, Bogart, Burnett, Bellamy, Rector & Fleming, "How Programmers Debug, Revisited: An
Information Foraging Theory Perspective."** *IEEE TSE* 39(2):197–215, DOI 10.1109/TSE.2010.111.
**Method:** an information foraging theory of debugging — navigation as a predator following
*scent* through a *topology* — tested in two ways: an empirical study of **10 professional
programmers** debugging a real open-source program, and an executable predictive model (PFIS)
validated against navigation logs.
**Findings:** participants' verbalisations concerned **scent-following far more often than
hypotheses**; non-scent hypotheses were concentrated almost entirely in the "fix" phase, one of
six debugging modes observed. The executable model predicted navigation more accurately than
comparable models that ignored scent. Notably, the **issue report predicted navigation better
than the participants' own verbalised hypotheses did** — which the authors attribute partly to
hypotheses being "invisible" in verbal protocols and partly to natural language being too
context-dependent to analyse automatically. The biggest trigger for scent-following was the
source code itself, with the bug report and runtime behaviour also contributing.
**Limitations:** 10 participants; predictive accuracy varied by task and by bug; a model of
navigation, not of understanding. The authors are explicit that their theory deliberately makes
no claim about mental states.
**How we know:** documented. Read: abstract + quoted RQ-answer passages. Companion: PFIS2,
CHI 2010, DOI 10.1145/1753326.1753332 — a seven-month field study of daily navigation with
evolving goals; read: abstract only.

**Why this matters, and there is a warning in it.** The finding that the *artefact* predicted
navigation better than the programmer's own stated hypotheses is a caution for us specifically:
the authors conclude that tools have more potential using "the artifacts of the environment
than attempting to somehow harvest programmers' verbalizations." DSpatch has an unusual amount
of verbalisation lying around — the whole conversation — and this says the conversation is a
weaker predictor of where attention should go than the change and the code are.

---

## 7. Overviews, zoom and orientation

The cluster where the evidence most often contradicts intuition, and where DSP-12's framing
needs two corrections.

### 7.1 An overview was preferred and did not improve accuracy

**Hornbæk, Bederson & Plaisant, "Navigation patterns and usability of zoomable user interfaces
with and without an overview."** *ACM TOCHI* 9(4):362–389, 2002, DOI 10.1145/586081.586086.
**Method:** **32 subjects** solved navigation and browsing tasks on two maps, in zoomable
interfaces with and without an overview window.
**Findings, all four of which matter:**
1. **No difference** between interfaces in subjects' ability to solve tasks correctly.
2. **80% preferred the interface with an overview**, saying it supported navigation and helped
   them keep track of their position.
3. Subjects were **faster without the overview** on one of the two maps. The authors conjecture
   this was because that map was organised in multiple levels, which rendered the overview
   unnecessary by providing richer navigation cues through **semantic zooming**.
4. That same combination — multi-level map, no overview — also **improved recall of objects**.
   And subjects who switched between the overview and detail windows **used more time**,
   suggesting that integrating two windows adds complexity and costs mental and motor effort.
**Limitations:** maps, not code; 2002 displays; laboratory tasks; the semantic-zoom explanation
is the authors' conjecture, not a manipulated variable. Transfer to a change overview is **my
inference**.
**How we know:** documented. Read: abstract (which contains all four findings verbatim).

**Why this matters, and it is the single most decision-relevant result in this section.**
Preference and benefit came apart in a controlled study, in the same direction we should expect
to be flattered by: 80% liked the thing that did not make them more accurate and sometimes made
them slower. If DSP-14 sketches a change overview and Niclas likes it, this study says that
tells us close to nothing about whether it helped. It also offers a cheaper alternative to
argue for: structure the detail view so it carries its own cues, rather than adding a second
window whose cost is real and measured.

### 7.2 Desert fog is a proposal, not a finding — correction to DSP-12

**Jul & Furnas, "Critical Zones in Desert Fog: Aids to Multiscale Navigation."** UIST 1998,
pp. 97–106, DOI 10.1145/288392.288578.
**What it is.** It introduces the problem of "desert fog" — a view of an information world
containing no information on which to base a navigational decision — and derives, from a formal
analysis using view-navigation theory, the concept of **critical zones** and **critical-zone
analysis**: grouping objects by their visibility in views rather than by spatial layout. Two
prototypes in Pad++, **Landmarking** and **ZTracker**. ZTracker traces the outlines of critical
zones in each view; the indicators are multiscale but have a fixed minimum size so they never
disappear, which makes "zoom out until one appears" the correct strategy in a fog view, and they
change colour when the whole world is contained in the current view so the navigator does not
zoom out forever.
**Evaluation: none.** In the authors' own words: "We are planning user studies to test the
sufficiency of critical zones for navigational purposes and to learn about the significance of
their dynamic nature." And: "Along with basic usability, we would like to investigate the need
for indicating nested critical zones and the need for refinement of overlapping critical zones."
**How we know:** documented, and the absence of an evaluation is documented in the paper's own
future-work section. Read: abstract + quoted passages including future work. **Label: untested
proposal.**

**The correction.** DSP-12 recorded this as "Jul & Furnas's 'desert fog' disorientation finding
for zoomable interfaces," marked unverified, and passed it to DSP-13. Verified: it is a problem
formulation and a design proposal, **not an empirical finding**. Nothing in it measures
disorientation or shows that the aids reduce it. The concept is genuinely useful and the
analysis is careful, but it cannot be cited as evidence that a zoomable change overview will
disorient anyone.

### 7.3 Desert fog measured, twenty-five years later

**Berli & Touya, "The FogDetector: A User Survey to Measure Disorientation in Pan-Scalar Maps."**
GIScience 2023 short paper, DOI 10.4230/LIPIcs.GIScience.2023.73. Raw data: Zenodo
10.5281/zenodo.7561925.
**Method:** an online study with **more than 150 participants completing the survey**, measuring
disorientation when zooming or panning in interactive multi-scale maps, via a memorising task.
**Findings:** a **very small** difference between the time to succeed after a zoom and after a
pan — but the difference becomes **more significant when comparing zooming in with a large scale
gap against panning**. And disorientation is **not symmetric**: zooming in and zooming out are
not alike.
**Limitations:** maps, online, a memorising task, and a short paper. The related modelling work
(Touya, Gruget & Muehlenhaus, *IJGI* 12(2):62, 2023) is explicit that its model of pan-scalar
disorientation "requires experimental results" to show how much it explains. Transfer to code is
**my inference**.
**How we know:** documented. Read: abstract + quoted passages.

**Why this matters.** If a change overview supports zoom, the expensive operation is **zooming
in across a large scale gap** — not zoom in general and not panning. That is a specific,
testable design constraint: prefer small scale steps, or give the large jump a landmark. It also
independently supports the pointer-anchored-zoom property DSP-12 found in Niclas's own code:
anchoring is a way of keeping a cue across the scale gap.

### 7.4 What the one minimap experiment actually shows

**"The Code Mini-Map Visualisation: Encoding Conceptual Structures Within Source Code."**
VISSOFT 2018, DOI 10.1109/VISSOFT.2018.00023. *(I did not capture the authorship.)*
**Method:** **60 participants** randomly split into two groups. Group A saw a **standard** code
minimap; Group B saw a minimap with an added **scope-information layer** encoding the scope
chain and the cursor's current scope. Both groups saw the same source code and the same
questions about scope relationships, with correct answers used as a proxy for code understanding.
**Findings:** the augmented minimap improved scope-understanding accuracy — **71.2% versus
59.3%, p < 0.001** *(reported, unverified: these figures come from my search tool's summary, not
from a verbatim excerpt)*. The authors conclude that incorporating additional layers of
information onto the minimap can have a positive effect on code understanding.
**Limitations:** one language (JavaScript scope questions), one document, a between-group design,
and — critically — **the comparison is minimap versus augmented minimap, not minimap versus no
minimap.**
**How we know:** documented. Read: abstract + quoted method passage.

**What this settles and what it does not.** DSP-12 asked DSP-13 to appraise whether minimaps
help. **The question of minimap versus nothing remains unanswered**; I searched and did not find
it. What we now have is better than that for our purposes: in the one controlled study, the
measurable improvement came from **the derived information layered onto the miniature, not from
the miniature**. That is consistent with DSP-12's central observation about SeeSoft — that the 1992
original coloured by a measured statistic and today's minimaps colour by syntax, and the original
was the better design.

*Corrected 16 September 2026.* This paragraph originally called the minimap experiment "a
controlled, modern corroboration" of the SeeSoft argument and claimed "two independent routes to
the same conclusion". That overstates it. One route is a scope-layer experiment whose headline
figures are **reported, unverified**; the other is DSP-12's **design argument** about SeeSoft, not
a second measurement. Consistent evidence and a converging argument are worth having; they are not
two independent measurements of the same thing.

A secondary pointer, not appraised: "Semantic Zoom and Mini-Maps for Software Cities" (2025)
reports two user studies finding semantic zoom and a mini-map useful additions for large
landscapes and collaborative exploration, with good usability and some implementation
shortcomings. Read: abstract only; the reported outcomes are usability and user feedback rather
than measured comprehension.

### 7.5 CodeCity appraised, not restated

**Wettel, Lanza & Robbes, "Software Systems as Cities: A Controlled Experiment."** ICSE 2011.
Artifacts: Zenodo 10.5281/zenodo.268463. Handed to DSP-13 by DSP-12 for appraisal.
**Method.** **41 participants** from academia and industry, four locations, three countries.
CodeCity against a baseline of **Eclipse plus spreadsheets of metric data**. Two object systems
of different sizes (Azureus and Findbugs). Reverse-engineering and program-comprehension tasks:
structural understanding, concept location, metric-based analysis. Time limits per task. The
authors designed the experiment against an explicit twelve-item wish list extracted from prior
software-visualisation evaluations — including industry participants, a tutorial, relevant tasks,
**deliberately disadvantageous tasks**, time limits, real systems, two systems, and replicable
artifacts.
**Findings.** **+24.26% task correctness and −12.01% completion time, both statistically
significant.** Tool effect significant; system size effect significant; **no interaction**.
**Appraisal — three things that change how much this supports a visual overview for us.**
1. **The benefit was task-specific.** The authors' task-level analysis reports CodeCity better on
   **overview** tasks and **not better on focused** tasks *(from a third-party lecture summary of
   the paper — secondary, unverified)*. If that holds, the 24% is a gain on "get oriented in an
   unfamiliar system", not on "answer a specific question".
2. **The baseline is weak for our purposes.** The comparison was against metric data in a
   spreadsheet. This does not establish that a spatial overview beats a good code or diff view;
   it establishes that it beats a metric table.
3. **The task was unfamiliar-system comprehension**, which is not our task. Our user knows his
   code and is reviewing a change to it.
**Threats the authors list:** subject competency and experience, task bias in difficulty and
allotted time, a two-tool baseline, data differences, session differences, training differences;
externally, subjects, tasks, object systems and experimenter effect. One task was removed from
analysis because it required untrained expertise *(secondary, unverified)*. A count of initially
recruited participants with outliers removed appears in secondary summaries; **reported,
unverified.**
**How we know:** documented, with published artifacts. Read: abstract + conference record +
a third-party summary of the threats and task analysis, which is why the task-level claims are
marked secondary.

**DSP-12's framing, refined.** DSP-12 placed CodeCity beside the minimap and concluded that in
this field adoption and evidence are close to uncorrelated. That stands. The refinement is that
CodeCity's evidence is narrower than "3D cities help you understand software": it is "a spatial
overview beats a metric spreadsheet for overview questions about an unfamiliar system, and not
for focused ones."

### 7.6 How much any single visualisation result should move us

**Merino, Ghafari, Anslow & Nierstrasz, "A systematic literature review of software visualization
evaluation."** *Journal of Systems and Software*, 2018, DOI 10.1016/j.jss.2018.06.027.
**Method:** review of the complete body of **387** full papers published in SOFTVIS/VISSOFT, of
which **181** yielded extractable evaluation data.
**Findings:** **62%** (113) of proposed approaches include **no evaluation or a weak one** —
anecdotal evidence or usage scenarios. **29%** (53) ran experiments; of those, only 30% (16)
included appropriate participants for their target audience, and **70%** (37) used **only
students and academics** — convenience samples vulnerable to selection bias. **7%** (12) ran case
studies with professional developers on real systems. **3%** (4) ran surveys. Their own
conclusion is worth keeping: an effective software visualisation should be judged not only on
time and correctness but on **recollection, usability and engagement**.
**Limitations:** a secondary study; scoped to two conference series, so visualisation work
published at ICSE, CHI or elsewhere is outside it.
**How we know:** documented. Read: abstract + quoted results passages.

**Why this matters.** It is the calibration for everything in §7. In a field where 62% of
proposals were never properly evaluated and 70% of the experiments used students, a single
positive result — including CodeCity's — is a reason to try something, not a reason to build it.
And their suggestion to measure **recollection** is directly useful to us: Hornbæk's study found
its recall benefit in the *no-overview* condition, and recall is closer to what DSP-5's friction
was about than correctness is.

---

## 8. Noticing that something changed, and decomposing it

### 8.1 Understanding, not defect-finding, is the reviewer's actual problem

**Bacchelli & Bird, "Expectations, Outcomes, and Challenges of Modern Code Review."** ICSE 2013,
pp. 712–721, DOI 10.1109/ICSE.2013.6606617.
**Method:** observations, interviews and surveys of developers and managers across diverse teams
at Microsoft, plus manual classification of hundreds of review comments.
**Findings:** finding defects remains the main motivation, but **reviews are less about defects
than expected**, delivering knowledge transfer, team awareness and alternative solutions instead.
Their central finding: **code and change understanding is the key aspect of code reviewing**, and
developers use a wide range of mechanisms to meet their understanding needs, **most of which are
not met by current tools** — which largely offer a diff and inline comments.
On familiarity, from the programmers' survey: **798 respondents (91%)** said it takes longer to
review files they are not familiar with, because "big-picture impact analysis requires contextual
understanding. When reviewing a small, unfamiliar change, it is often necessary to read through
much more code than that being reviewed." **716 (82%)** said reviewers familiar with the changed
files give different feedback — as one put it, "It takes a lot longer to understand unknown code,
but even then understanding isn't very deep. With code I am familiar with I have more to say."
Reviewers who own the changed files often do not read the description at all and go straight to
their files; reviewers who do not need the description, and judge it good when it states "what
was changed and why."
**Limitations:** one company, self-report for the survey portion, 2013 tooling.
**How we know:** documented. Read: abstract + quoted survey passages.

**Two things this gives DSpatch.** First, external support for VISION section 3's premise, from
a large industrial study: the gap is understanding, and tools do not fill it. Second, and more
immediately useful, a **design constraint on our own trials**: familiarity dominates review
behaviour. A comprehension probe run on code Niclas wrote, on a change he specified, will measure
almost nothing. §12 builds on this.

### 8.2 Change blindness — from outside programming

**"Looking but not seeing."** ECCE 2007, DOI 10.1145/1362550.1362584.
**Method:** a review of **21 key studies** of change blindness and its relatives — inattentional,
repetition and comparison blindness — published between 1976 and 2005, analysed by Emergent
Themes Analysis to extract effects relevant to interface design.
**Findings:** five effects designers must account for — the effect of **rate of change**, of
**eccentricity** (distance from the point of fixation), of **conspicuity**, of **significance**,
and of the **task's relevance**. Failures or delays in noticing changes in complex, dynamic,
safety-critical displays can have serious consequences.
**Limitations:** a secondary review, in a domain of operators monitoring displays. **The transfer
to reading a code diff is my inference and is not established.** Ronald Rensink's "Change
Detection", *Annual Review of Psychology* 53:245–277, 2002, is the canonical primary review; I
**did not read it** and pass it on as a pointer.
**How we know:** documented (secondary). Read: abstract + quoted findings.

**Why it belongs here despite the inference.** It supplies the mechanism behind DSP-12's most
important caution — Word's Simple Markup causing readers to miss edits without knowing edits
existed. Two of the five effects name that failure exactly: **significance** and **task
relevance** determine whether a change is noticed, which is precisely what a collapsed change bar
removes. And **eccentricity** predicts that a change cue in a margin or a separate overview
window is noticed less reliably than one at the point of reading — a specific, cheap prediction
for anyone designing a change overview.

### 8.3 Finding the edit that was *not* made

**Zhang, Song, Pinedo & Kim, "Interactive Code Review for Systematic Changes" (CRITICS).**
ICSE 2015, DOI 10.1109/ICSE.2015.33.
**The interaction:** the reviewer selects a diff region; CRITICS generalises it into a change
template which the reviewer **interactively customises and progressively refines**; the template
is matched against the codebase to summarise systematic edits and to locate **inconsistent or
missing** edits.
**Method and findings, two studies.** First, **six professional engineers at Salesforce.com** used
it on diff patches authored by their own team, followed by semi-structured interviews; all six
wanted it integrated into their existing review environment, and found the missing/inconsistent
edit detection valuable. Second, a controlled experiment: **12 participants** reviewed diff
patches with both CRITICS and Eclipse diff, answering questions about systematic changes
**47.3% more correctly and 31.9% faster** with CRITICS. A third comparison found that interactive
template customisation matched or exceeded fixed-template accuracy (LASE) in five of six cases
within a few iterations. *(Per-task detection counts appear in secondary summaries; reported,
unverified.)*
**Limitations:** 12 participants; the tasks are specifically about **systematic** changes, which
is the case the tool is built for; Java and Eclipse; the industrial study measures enthusiasm,
not performance.
**How we know:** documented. Read: abstract + quoted results passages.

**Why this matters.** It is the one measured result in this document aimed at the failure mode
§8.2 describes — a change that should have been made and was not. And the interaction is worth as
much as the number: the reviewer **builds and refines the pattern**, so the classifier's basis is
inspectable and contestable. That is the property DSP-12 argued for from Difftastic and Gerrit,
here with a correctness measure attached.

### 8.4 Decomposing a change by dependency analysis

**Barnett, Bird, Brunet & Lahiri, "Helping Developers Help Themselves: Automatic Decomposition of
Code Review Changesets" (CLUSTERCHANGES).** ICSE 2015, pp. 134–144, DOI 10.1109/ICSE.2015.35.
**The technique:** partition the diff regions of a changeset into related groups, using
same-method grouping and def-use / use-use dependencies. No model; an inspectable rule.
**Method and findings.** Quantitative: **1,000 randomly selected changesets** from the development
of Microsoft Office 2013. **Over 40%** are potentially decomposable into multiple partitions;
the most common case is a single non-trivial partition but that is only 45%, so **nearly 42%**
contain more than one non-trivial partition; and **66%** of changed methods, on average per
review, fall into non-trivial partitions. Qualitative: **20 developers**, each the author of a
changeset they were shown; **16** said the non-trivial partitions were both correct and complete
— independent, internally related, with no missing conceptual groups. Some asked for the prototype
to use on their own reviews.
**The authors' stated problem:** "Code review is dependent on understanding the change being
made… the presence of multiple independent changes make matters worse," forcing reviewers to make
sense of more code than they would need to if the independent changes were examined separately.
**Limitations, from the authors:** missing relationships for changesets with ten or more trivial
partitions; algorithm and implementation limitations they document. And the user study asks
authors to judge decompositions of **their own** changes — agreement about structure, not a
measure of any reviewer's comprehension.
**How we know:** documented. Read: abstract + quoted results passages.

**Why this matters.** VISION 3.1 asks to "group changes by intent". This is the measured version
of that idea with the narrative removed: the grouping is derived from dependencies, so every group
is checkable against the code, and the authors of the changes agreed with 16 of 20. It also
quantifies how often the problem arises — 42% of a thousand real changesets contained more than
one independent change. That is the number to put beside any claim that grouping is premature.

---

## 9. Explanations, confidence and trust

The cluster with the most consistent direction of finding, and it is not the flattering direction.

### 9.1 The direct answer to DSP-12's open question 1

DSP-12 found CodeRabbit-class walkthroughs shipping by default with no controlled evaluation, and
asked DSP-13 whether an agent-generated walkthrough improves reviewer comprehension or defect
discovery. **The specific study still does not exist.** But the adjacent interaction — an
automatically generated *review* offered as a starting point — has now been measured, and the
result changes what DSP-14 should build first.

**Tufano and colleagues, "Deep Learning-based Code Reviews: A Paradigm Shift or a Double-Edged
Sword?"** ICSE 2025, DOI 10.1109/ICSE55347.2025.00060; arXiv 2411.11401.
**Method:** a controlled experiment with **29 professional developers** reviewing different
programs, in Python and Java, with and without the support of an automatically generated code
review. Reviewer activity was monitored across **over 50 hours** of recorded reviews. Three
outcomes were measured: review **quality** (ability to identify issues), review **cost** (time),
and reviewer **confidence**. **72 reviews** were performed and **89%** of the LLM-identified
issues were retained by reviewers — *both figures were published here marked "reported,
unverified" and are **verified** as of 16 September 2026, read in the paper itself.*

**There were three treatments, not two** *(added 16 September 2026; see the correction below)*:
fully manual review; review started from a **ChatGPT-generated** review; and review started from
a **complete and correct** review naming every planted issue, presented to the reviewer as
generated. The material reviewed was **48 planted issues** across **whole programs of 75 to 528
lines** — Rosetta Code exercises, two Apache Commons utility classes and one artificial to-do
list — which no participant had seen before, presented with **no diff, no before-and-after and
no change at all**. The planted issues were predominantly maintainability rather than behaviour:
**78% evolvability in Java, 64% in Python**.

**Findings, in the authors' own terms:**
- Reviewers consider **most** of the LLM-identified issues valid — 89% retained.
- The availability of an automated review as a starting point **strongly influences their
  behaviour**: "Reviewers tend to focus on the code locations indicated by the LLM rather than
  searching for additional issues in other parts of the code."
- Reviewers who started from an automated review identified a **higher number of low-severity
  issues** while **not identifying more high-severity issues** than a fully manual process.
- The automated support **did not save time** and **did not increase reviewers' confidence**.
- **The authors draw this document's central distinction themselves, in the programming domain.**
  Explaining why confidence did not rise, they write that the generated review "does not help in
  better understanding the program, but only highlights potential issues". Their **Actionable
  Recommendations** then say to "adopt automated reviews as a further check only after the manual
  inspection. This will not save time but it could help in identifying additional quality
  issues." *(Added 16 September 2026 — correction 1 in §14's list, and the one that matters most
  for how much weight the rest of §9 can carry.)*
- **What the attention shift did and did not cost, measured** *(added 16 September 2026)*.
  Covered code locations showed **no significant difference** across the three treatments,
  confirmed by regression. The assisted arm found a median **50%** of the injected issues —
  **identical to manual**, regression coefficient **−0.004, not significant**. What narrowed was
  the **diversity of locations across different reviewers**: pooled distinct lines were **484**
  for manual review, 263 of them unique to it, against **371** for the assisted arm, 181 unique.
- **The third arm, and it is the arm that bounds the conclusion** *(added 16 September 2026)*.
  Given the complete and correct review, reviewers **kept all of it**, and detection of the
  planted issues **rose decisively** — logistic coefficient **4.710, p < 0.001**. The authors
  attribute the second arm's null partly to ChatGPT itself having **missed more than half** the
  planted issues. So the binding constraint on the measured null was **generator recall**, not
  anything intrinsic to a generated account. **What survives regardless:** even with the perfect
  review, reviewers **saved no time** (57 minutes mean against 42 manual) and **gained no
  confidence** (3.8 against 3.5, not significant).

**Limitations.** One model generation, two languages, a laboratory setting, 29 participants.
*Added 16 September 2026, from the full text:*

- **The authors call their own results preliminary**, verbatim: "our study could be statistically
  underpowered, thus leading to biased conclusions. For this reason, replications are needed in
  order to corroborate or contradict our **preliminary** observations." A document that keeps a
  standing list of figures it could not confirm (§14) must carry its key citation's own
  self-description too.
- **The severity judgement is weak.** It was made by two external raters on a 1–3 scale with
  **weighted κ = 0.315** — weak agreement. This entry originally said only that "severity
  classification is a judgement the authors had to operationalise", which understates it, and
  the judgement in question is the one carrying "no more high-severity issues".
- **The task is not change review, and this is the single strongest limitation of the transfer.**
  Participants reviewed whole unfamiliar programs with no diff and no change, and the planted
  issues were mostly maintainability. DSpatch's task is a **change** to code **its user wrote
  himself**. §8.1 is the reason this matters and not merely a caveat: 91% of Bacchelli & Bird's
  798 respondents said unfamiliar files take longer, and 82% said familiarity changes the
  feedback given. This document applies that finding rigorously to DSpatch's own probes — §12
  calls a probe on familiar code "the most likely way for DSP-14's trials to waste Niclas's
  time" — and did not apply it here, where it cuts the other way: **anchoring was measured under
  the condition most favourable to it.** Unfamiliar whole-program reading with no change to
  anchor on is close to the worst case for independent search and the best case for following
  whatever the generated text names.

**How we know:** documented. **Read: full text (16 September 2026, by another role)** — the
arXiv HTML rendering of 2411.11401v1, including study design, all four results subsections,
actionable recommendations, threats to validity and related work. When compiled, this entry read
the abstract verbatim only, and the abstract does contain the four headline findings above; it
does not contain the third treatment, the covered-location null, the diversity figures, the
severity agreement or the authors' preliminary caveat.

**Correction, 16 September 2026, and why it makes the conclusion below stronger rather than
weaker.** This entry was compiled from the abstract, and the abstract is accurate as far as it
goes. Reading the paper changed five things, and only one of them cuts against this section.
The numbering below is §14's, where all nine corrections are listed together:

1. **Correction 1 — the central distinction is the authors' own, in-domain.** §9.1's conclusion below and
   §9.3's commit-first countermeasure were built here as *my* reading of an abstract plus a
   transfer from crowd-worker studies marked "my inference". The authors make **both** moves
   themselves, about software, on software data: the generated review "does not help in better
   understanding the program, but only highlights potential issues", and adopt automated review
   "only after the manual inspection". The attention-versus-comprehension distinction and the
   commit-first design therefore rest on a **documented software-engineering recommendation**,
   not only on a transfer from nutrition tasks. The inference markers on that specific move are
   demoted accordingly — here, in §9.3, in §11's item 2 and in §13's principle 6. This is worth
   the trouble because those markers are exactly what a later sceptical reader would attack.
2. **Correction 4 — the third arm bounds the conclusion.** The null was produced by a generator that missed
   more than half the planted issues; a complete generated review raised detection decisively.
   The "not a comprehension feature" half of the conclusion survives cleanly, because even the
   perfect review saved no time and added no confidence. The "generated accounts cannot raise
   detection" reading, which nobody stated but which this section invited, does not survive. It
   matters directly for us: §13's proposals are precisely to attach **checkable, high-recall**
   material rather than narrative.
3. **Correction 2 — the attention shift has no measured per-reviewer cost.** See §11's item 2,
   which is where this document overstated it.
4. **Corrections 3 and 5 — the task and the caveats**, both folded into the limitations above.

None of this touches the conclusion in the indented box below, which was stated at the right
strength, including "until someone measures otherwise" and the note that a generated review and
a generated walkthrough are different artefacts.

**What this means for DSpatch, stated carefully.** A generated review is not the same artefact as
a generated walkthrough: one proposes issues, the other narrates a change. But the mechanism the
experiment measured — **the generated text determines where the reviewer looks** — applies to both
and is the mechanism a walkthrough depends on. So the honest reading is:

> A generated overview of a change should be treated as an **attention-steering** feature, not a
> comprehension feature, until someone measures otherwise. The one study we have of the adjacent
> interaction found attention redirection with no gain in high-severity findings, no time saved
> and no gain in confidence.

That is a finding, and per the handoff it changes priorities: it argues against making a generated
walkthrough DSpatch's first review investment, and it makes the planted-defect probe in §12 the
single highest-value cheap experiment available to us.

**Provenance of that box, corrected 16 September 2026.** It was written as my reading of an
abstract. It is now also **the authors' own reading of their own data**: the generated review
"does not help in better understanding the program, but only highlights potential issues". The
distinction between steering attention and aiding comprehension is theirs, in the programming
domain, and this document was reconstructing it rather than proposing it. Read the box as
better founded than it claimed to be, not as weaker.

**Two nearby studies that measure the wrong outcome, recorded so nobody mistakes them.**
- *"Rethinking Code Review Workflows with LLM Assistance: An Empirical Study"* (arXiv 2505.16339,
  2025), a field study plus field experiment at WirelessCar Sweden AB, comparing an AI-led mode
  that summarises the change up front against an on-demand mode. AI-led reviews were **overall
  more preferred**, conditional on the reviewer's familiarity with the codebase and the severity of
  the pull request. The field study identified frequent context switching and insufficient
  contextual information as key challenges, and trust and false positives as key concerns.
  **Measures preference, not comprehension or defect discovery.** Read: abstract + quoted passages.
- *"From Assessment to Enhancement of Pull Requests at Scale"* (ESEM 2025,
  DOI 10.1109/ESEM64174.2025.00061). A controlled experiment with **38 software professionals** in
  a 6×6 Latin square, comparing original PR descriptions against LLM-degraded and LLM-improved
  variants. The variant improved **from the degraded** version was rated significantly higher than
  both; the variant improved **from the original** was **not** significantly better, and
  participants complained about **verbosity and "AI tone"**. **Measures perceived quality.** Read:
  abstract verbatim.

The second is quietly useful: generated prose helped where structure was missing and did not help
where it was already present, and the cost was verbosity. That is an argument for generating
*structure* rather than *narrative*.

### 9.2 Explanations raise acceptance, not accuracy

**Bansal, Wu, Zhou, Fok, Nushi, Kamar, Ribeiro & Weld, "Does the Whole Exceed its Parts? The
Effect of AI Explanations on Complementary Team Performance."** CHI 2021,
DOI 10.1145/3411764.3445717.
**Method:** large-scale mixed-method user studies on three tasks chosen so crowd workers could do
them with little training — beer-review sentiment, Amazon book sentiment, and LSAT logical
reasoning — with an AI of accuracy comparable to the humans. Conditions included AI recommendation
plus confidence, explaining the top prediction, explaining the top two, and adaptive explanations
from both AI and expert sources, against a no-AI baseline.
**Findings:**
- **Complementary performance was achieved** by AI augmentation: on Beer, humans alone 0.82 ± 0.09,
  AI alone 0.84, team with recommendation and confidence **0.89 ± 0.05**.
- **Explanations did not beat simply showing the AI's confidence.** Beer: 0.89 ± 0.05 with
  confidence versus 0.88 ± 0.06 with explanation, z = −1.18, p = .24. Same pattern on Amazon books
  (z = 1.23, p = .22) and LSAT (z = 0.427, p = .64).
- Explaining the top prediction versus the top two: no significant difference. Adaptive
  explanations: no significant improvement. Switching to **expert-generated** explanations instead
  of AI-generated: no significant improvement.
- **The important one:** splitting results by whether the AI was correct, explanations "lead to
  better accuracy when the AI recommendation was correct but worse when the AI was incorrect."
  Explanations increased the chance that humans accept the recommendation **regardless of its
  correctness**.
**Limitations:** crowd workers, common-sense tasks, not code, not review, and an AI at
human-comparable accuracy. Transfer to code review is **my inference**.
**How we know:** documented. Read: abstract + quoted results passages with test statistics.

### 9.3 What reduces overreliance, and what it costs

**Buçinca, Malaya & Gajos, "To Trust or to Think: Cognitive Forcing Functions Can Reduce
Overreliance on AI in AI-assisted Decision-making."** CSCW 2021, DOI 10.1145/3449287.
**Method:** an experiment with **N = 199** on Amazon Mechanical Turk, comparing **three cognitive
forcing designs** against two simple explainable-AI approaches and a no-AI baseline. The three
designs are all cheap to build: **on demand** (the AI's suggestion stays hidden until the user
asks for it), **update** (the user commits to their own answer first, then sees the AI's and may
revise), and **wait** (a delay of roughly 30 seconds before the suggestion appears). Their premise,
from dual-process theory: people rarely engage analytically with each recommendation and instead
develop general heuristics about when to follow the AI.
**Findings:**
- Cognitive forcing **significantly reduced overreliance** compared with the simple explainable-AI
  approaches. When the AI's top predictions were incorrect, cognitive forcing improved the objective
  measures significantly more than simple explanation did.
- It **did not eliminate** overreliance. Participants still relied on incorrect predictions in cases
  where they would have decided better without the AI.
- **The trade-off:** "people assigned the least favorable subjective ratings to the designs that
  reduced the overreliance the most."
- The benefit was **unequal**: on average, cognitive forcing helped participants **higher in Need
  for Cognition** more.
- Secondary summaries report that on trials where the AI was wrong, participants with **no AI at
  all** outperformed every AI-assisted condition. *(Reported, unverified.)*
**Limitations:** crowd workers, a nutrition task, a single encounter — repeated professional use
could rate the friction very differently in either direction. Transfer to code review is **my
inference**.
**How we know:** documented. Read: abstract + quoted results passages.

**Why this pair matters so much to DSpatch.** VISION 3.1 already requires that "a persuasive agent
narrative must not replace access to real code" and that users be able to challenge a convincing
but incorrect explanation. These two studies say the requirement is harder than it sounds and name
the trap: **the intervention that works is the one the user will rate worst.** So if DSP-14 tests a
commit-first design with Niclas and he says he dislikes it, that is the predicted outcome and not
evidence against it. Preference must not be the acceptance criterion for anything in this area —
which is the same conclusion §7.1 reached from a completely different study.

**Correction, 16 September 2026 — the commit-first design no longer rests on this transfer
alone.** As published, §9.3's recommendation to try Buçinca's **update** design in DSpatch was a
transfer from a nutrition task performed by crowd workers, and it was marked "my inference"
accordingly. The full text of §9.1's paper contains the same recommendation, made by software
engineering researchers on software engineering data, in their Actionable Recommendations: adopt
automated reviews "as a further check only after the manual inspection. This will not save time
but it could help in identifying additional quality issues." That is commit-first, in domain,
including the explicit warning that it costs time. **The inference marker on Buçinca's study
stands** — a nutrition task is still a nutrition task, and the *overreliance-reduction mechanism*
and the *unfavourable subjective ratings* are still measured only there. What is no longer an
inference is the **design**: reading the code before the machine's account is now a documented
recommendation from a code-review experiment, and probe 3 in §12 tests a recommendation rather
than a hunch.

### 9.4 Assistance raising confidence while lowering quality

**Perry, Srivastava, Kumar & Boneh, "Do Users Write More Insecure Code with AI Assistants?"**
CCS 2023, DOI 10.1145/3576915.3623157; arXiv 2211.03622. Apparatus and anonymised data released.
**Method:** a user study in which participants solved five security-related programming tasks with
or without access to an AI assistant based on OpenAI's codex-davinci-002. Outcomes were modelled
per task with logistic regression controlling for prior security exposure, programming experience
and student status, with Benjamini–Hochberg correction.
**Findings:** participants with assistant access wrote **significantly less secure code** than
those without, on **four of five** tasks. And: they "were also more likely to believe they wrote
secure code, suggesting that such tools may lead users to be **overconfident** about security flaws
in their code." The authors' own framing is that assistants may give inexperienced users a false
sense of security. *(Per-task figures — for example encryption 3% versus 21% secure — appear in the
paper's results tables, which I did not read; reported, unverified.)*
**Limitations:** security tasks specifically, a 2022-era model, and it measures **code written, not
code reviewed**. Many participants were students.
**How we know:** documented. Read: abstract + quoted results passages.

**Why it is here.** It is the clearest measured instance of the pattern VISION 3.1 warns about:
quality down, confidence up, in the same population at the same time. It is about authoring rather
than reviewing, so its relevance to us is by analogy — but it is the same analogy DSP-12 drew from
the Devin evaluation, now with a controlled design and a confidence measure.

### 9.5 Why self-reported comprehension cannot be the gate

**Glenberg & Epstein, "Inexpert calibration of comprehension."** *Memory & Cognition* 15(1):84–93,
1987, DOI 10.3758/BF03197714.
**Method:** across a series of experiments, readers read short expositions, rated their confidence
in their ability to use a principle from the text, and then judged whether an inference using that
principle was valid. Calibration was measured as the relationship between confidence and test
performance.
**Findings:** "Readers are very poorly calibrated: confidence in comprehension (belief) does not
predict performance." Their explanation is the **self-classification hypothesis** — subjects are
not assessing what they learned from *this* text but responding from beliefs about their abilities
in the domain, and those beliefs "are not sufficiently fine-grained to accurately predict
performance within a domain." They further reported expertise to be *inversely* related to
calibration, the "illusion of knowing".
**The qualification, which matters for how we measure.** Weaver, "Constraining factors in
calibration of comprehension," *JEP: LMC* 16(2):214, 1990, DOI 10.1037/0278-7393.16.2.214, replicated
poor calibration with a single inference per paragraph but demonstrated that **studies assessing
comprehension with a single inference per text seriously underestimate calibration.** Griffin, Jee
& Wiley (CogSci 2006) also challenged the expertise conclusion. Read: abstract + citation records.
**Limitations:** prose comprehension, not code; 1980s student populations; and relative-accuracy
measures in this literature are known to be confounded with task performance in tasks that permit
guessing (*Metacognition and Learning*, 2020, DOI 10.1007/s11409-020-09257-1; read: abstract only).
Transfer to code comprehension is **my inference**.
**How we know:** documented. Read: abstract + quoted passages.

**Two consequences for DSpatch, and the first one is about our own evidence.**
1. **"Niclas read the diff and did not report difficulty" is weak evidence that he understood it.**
   That is not a criticism of the DSP-5 trial, which recorded exactly what he said and labelled it
   correctly. It is a reason to add a checkable question to the next trial rather than relying on the
   absence of a complaint.
2. **Measure comprehension with several checkable items per change, not one.** Weaver's finding is
   the specific reason: one inference per text underestimates how well people know what they know.
   Three to five per change is the cheap fix, and it costs one extra minute.

### 9.6 Communicating uncertainty: one transferable idea, with a caveat

**Hullman, Resnick & Adar, "Hypothetical Outcome Plots Outperform Error Bars and Violin Plots for
Inferences about Reliability of Variable Ordering."** *PLOS ONE*, 2015,
DOI 10.1371/journal.pone.0142444.
**Method:** an Amazon Mechanical Turk experiment, between-subjects by representation. Participants
made inferences about distributions of one, two and three random variables using **HOPs** — an
animation of a finite set of individual draws — versus error bars and violin plots.
**Findings:** for two- and three-variable inferences such as "how often is B larger than A", HOPs
users had **much lower mean absolute error** (for example F(2,573) = 73, 57, 84, 220, all
p < 0.001). For most single-variable questions all three were comparable; HOPs were **worse** for
estimating the mean of high-variance data. The authors' explanation is that HOPs let viewers infer
distribution properties by **counting and integrating concrete outcomes**, which needs less
statistical background than interpreting a summary statistic. Follow-up work (Kale, Nguyen, Kay &
Hullman) found HOPs improved sensitivity to trends in noisy time series versus error bars and static
line ensembles, best at roughly 400 ms per frame.
**Limitations:** crowd workers, abstract statistical judgements, and **animation**, which is a poor
fit for reviewing a static change. Transfer to code review is **my inference** and the animation
mechanism does not transfer.
**How we know:** documented. Read: abstract + quoted results passages.

**What transfers and what does not.** The animation does not. The **frequency framing** does: people
reasoned better about uncertainty when it was expressed as **concrete enumerated outcomes** rather
than as a summary statistic. Applied to a change: "this test passed on this revision; these three
lines are not covered by any recorded test" is the frequency-framed form. "Medium confidence" is the
summary-statistic form. This corroborates, from outside programming, the wording discipline DSP-12
recommended from `intentdiff` — prefer "no syntax-level change detected" and "behavioural
significance unknown" to a confidence score. And §9.2 supplies the reason to be careful with
confidence displays at all: confidence was as effective as explanation at moving people, which means
it moves people.

---

## 10. Prior work already occupies a space DSP-12 believed was open

DSP-12 named "a walkthrough of the *difference between two executions*" as "the most concrete
unclaimed space the survey found", with two honest caveats: that "not found in this search" is not
"never done", and that it had not searched the differential and relative debugging literature, which
it assigned to DSP-13. I searched it. **The space is claimed.**

**Dufloer, Sayar, Etien & Costiou, "Divergence-Driven Debugging: Understanding Behavioral Changes
Between Two Program Versions."** ICPC 2025 (Early Research Achievements), pp. 221–225,
DOI 10.1109/ICPC66645.2025.00031; preprint HAL hal-05114444.
**The interaction.** **D3**, an experimental time-travelling debugger built in Pharo, executes a
**reference** and a **modified** version of the same program and captures every message send (for
control-flow divergence and convergence) and every state modification (for state divergence). It
presents the detected divergences as a list; each leads to a location; the developer can **time-travel
back to the point of a divergence** and explore both versions' executions in full, side by side, with
live variable state.
**Evaluation.** Applied by the authors to a simplified version of a real bug in the Pillar program,
where an introduced instance variable and its accessor caused a failure. They report that the debugger
highlighted the live state and behaviour needed to understand why the change produced the bug and to
identify its root cause.
**Limitations:** an ERA-track short paper; **a single author-run bug scenario, not a user study**; no
comprehension or defect-discovery measure; Pharo and Smalltalk, so nothing about a C++ project on
Windows; and the divergence capture is at message-send and state-modification granularity, which
implies a cost the paper's scenario does not stress.
**How we know:** documented. Read: abstract + quoted passages from the HAL preprint.

**Adjacent prior art, recorded so the lineage is visible.** *DiffTrace* (Cluster 2019) compares
whole-program function-call traces and visualises aligned common and different blocks via **diffNLR**,
explicitly positioning itself as a **relative debugging** tool in Abramson's sense, where relative
debugging compares selected data-structure states between a reference and a modified run. Read:
abstract + quoted passages. Delta debugging is a separate and older line that minimises
failure-inducing inputs or changes rather than visualising executions; encountered only as a citation
and **not read**.

**The correction, and what survives of DSP-12's claim.** The *mechanism* — detect where two runs of
two versions diverge, and take the developer there — has been built at least twice, most recently at
ICPC 2025, and it sits inside an older relative-debugging tradition. What I found **no** evidence for
is any evaluation of whether it improves a reviewer's comprehension or defect discovery. So the
refined version of DSP-12's finding is: **the interaction is not unclaimed; the evidence about it is.**
That is a weaker opportunity claim and a cleaner research question. For DSpatch it also lands where
DSP-12 put the cost question: this requires two recorded executions, and DSP-12 already established
that rr is Linux-only and Windows Time Travel Debugging is documented at 10–20× overhead with
multi-gigabyte traces. That remains an Implementer or Verifier probe, not a researcher's.

---

## 11. Where the evidence cuts against ideas already recorded in this project

Per the handoff, stated plainly and evidence-first, without organising around the recorded concept
seeds.

1. **An overview of a change is supported as a preference, not as a comprehension aid.** The one
   controlled study comparing overview against no overview found **no correctness difference**, 80%
   preference for the overview, one map where the no-overview interface was **faster**, better object
   recall without it, and a measured time cost for switching between the two windows (§7.1). The
   canonical source for zoom disorientation is a **proposal with no evaluation** (§7.2). The one
   minimap experiment moved its measure by **adding derived information**, not by adding a miniature
   — *its 71.2% versus 59.3% split is **reported, unverified**, and its comparison is augmented
   minimap against standard minimap, never minimap against nothing* (§7.4). Anyone arguing for a
   change overview should argue from §4 instead — the problem we observed
   was returning, and the measured intervention for returning is a resumption cue.
2. **A generated conceptual overview of a change should not be DSpatch's first review investment.**
   The nearest measured interaction redirected attention to the locations it named, produced more
   low-severity findings and **no more high-severity findings**, saved no time and raised no
   confidence (§9.1). Two adjacent 2025 studies measure preference and perceived quality, both
   positive, neither about comprehension or defects (§9.1). The evidence is not that walkthroughs are
   bad; it is that the thing they demonstrably do is steer attention — and **what that steering
   costs was not measured**, which is the correction below.

   **Correction, 16 September 2026 — this item ended in a claim its own source does not support,
   and it is the sentence that drove this ranking.** As published it read: *"The evidence is not
   that walkthroughs are bad; it is that the thing they demonstrably do is steer attention, and
   steering attention has a measured cost in what stops being examined."* The full text measures
   no such cost per reviewer. **Covered code locations showed no significant difference** across
   the three treatments, confirmed by regression, and the assisted arm found a median **50%** of
   the injected issues, **identical to manual** (coefficient −0.004, not significant). What
   narrowed was the **diversity of locations across different reviewers**: 484 pooled distinct
   lines for manual review, 263 unique to it, against 371 and 181 for the assisted arm. That is a
   property of a reviewer **population**, and **DSpatch has one user**, so the measured mechanism
   cannot apply as stated. The honest form, which is what this item now claims: **no measured gain
   in high-severity findings, and reduced variability in where reviewers looked, whose consequence
   for a single user is unmeasured.** A null plus a between-reviewer diversity effect does not
   license "a measured cost in what stops being examined". This document is scrupulous about
   exactly that distinction elsewhere, which is why the lapse is left visible rather than tidied
   away. Two further qualifications, both from the same reading: the null came from a generator
   that had itself missed more than half the planted issues, and the arm given a complete correct
   review detected decisively more (§9.1); and Spadini and colleagues, ICSE 2020 — 85
   participants, 57 practitioners, **unread here** — found that showing reviewers existing review
   comments before inspection **helped** them find bug types they would otherwise have overlooked
   (§2), which makes this item's priority claim contestable until someone reads it.
   **The item's conclusion stands.** A generated account is not a measured comprehension aid; even
   the perfect one saved no time and added no confidence; and the authors themselves write that
   such a review "does not help in better understanding the program, but only highlights potential
   issues" and recommend adopting it **only after manual inspection** (§9.1). It stands on that
   null and on that in-domain recommendation — not on a measured cost.
3. **Displaying confidence is the risky half of "explain benefits and risks".** Explanations did not
   beat a bare confidence display, and both raised acceptance of the recommendation **regardless of
   its correctness** (§9.2). Assistance has been measured to raise users' confidence while lowering
   their output quality (§9.4). The one family of interventions measured to reduce overreliance is
   friction users rate worst (§9.3). A visual annotation layer expressing predicted benefit or risk is
   therefore an overreliance mechanism by default, and needs a countermeasure designed in from the
   start rather than added later.
4. **The unglamorous candidates are the best supported.** Ranked by the strength of their measured
   record: a **chronological code-snippet resumption cue** (doubled task success against note-taking
   — *the lab study's **participant count is unestablished**, so the multiplier travels without a
   denominator* — and the form people also preferred, §4.2); **co-locating the relevant fragments**
   rather than
   improving navigation between them (33% faster comprehension, with the authors attributing two
   thirds of the gain to memory offload rather than navigation, §6.3); and **analysis-based
   decomposition of a change with an inspectable, contestable basis** (47.3% more correct on
   systematic-change questions, §8.3; 16 of 20 authors endorsing dependency-derived partitions, §8.4).
   None of these needs a model. All three are consistent with VISION section 3 as written.
5. **Our own absence of a comprehension complaint is not evidence of comprehension.** Self-rated
   comprehension is a weak predictor of measured comprehension, and readers appear to rate their
   domain self-image rather than the specific text (§9.5). This does not make DSP-5's record wrong —
   it recorded what he said and labelled it correctly. It means the next trial needs a checkable
   question.

---

## 12. Assessing comprehension, orientation and confidence with one user (AC#4)

### The constraint, stated first

DSpatch has **one user**. A controlled experiment is not available to us, and no amount of care
turns one person's performance on one change into an effect. Everything below is therefore aimed at a
different goal: **producing a signal that is honest about being a signal**, and avoiding the specific
measurement mistakes this literature has already identified.

### Methods that survive a single participant

**Single-case experimental design (SCED).** The established family for n = 1, from behavioural and
health research. The relevant variant is the **alternating-treatments design**: two or more conditions
are switched rapidly, preferably with randomised order, and the participant serves as their own
control through repeated measurement.
*Requirements the methodological literature imposes* — from Dallery, Cassidy & Raiff,
*J Med Internet Res* 2013;15(2):e22, DOI 10.2196/jmir.2227, and the CHI 2019 N-of-1 evaluation
framework, DOI 10.1145/3290607.3312923: a dependent variable that yields a quantifiable index,
measured repeatedly at regular intervals; a **minimum of three to five data points per phase**; a
**stable baseline** that would predict future performance absent the intervention; conditions
described with replicable precision; **fidelity** of delivery measured; and at least three
demonstrations of an effect.
*Threats they name, all of which apply to us*: **reactivity** to being measured; **carryover and
sequence effects** between conditions, mitigated by randomising order and by extending conditions
since carryover is typically transient; and **experimenter bias** in deciding when to change
conditions, mitigated by fixing phase durations in advance. Analysis should be autocorrelation-aware;
conventional t-tests on these data are explicitly criticised in that literature.
*Evidence status:* documented, read: abstract + quoted passages. **The source domain is
behaviour-change and health interventions. Transfer to evaluating a developer tool is my inference.**

**Correctness against ground truth, borrowed task designs.** The only way "comprehension" becomes
measurable is a question with a checkable answer. Three designs in this document are worth copying
directly:
- **Write a change recommendation instead of editing** (Whyline, §5.2). The output is a statement that
  can be graded against the code, and it removes the confound of coding skill.
- **Plant an inconsistent or missing edit** (CRITICS, §8.3). Discovery is binary and unambiguous.
- **Separate overview questions from focused questions** (CodeCity, §7.5). Their benefit appeared only
  on the former; ours might too, or might not, and averaging the two would hide it.

**Confidence paired with correctness, several items per change.** Ask for a confidence rating
**before** any answer is revealed, then score against the code and the recorded test result. Use
**three to five** checkable questions per change, not one — Weaver's specific finding is that
single-item comprehension tests seriously underestimate calibration (§9.5). Accumulated across
changes this yields a picture of *when* he is confident and wrong, which is more useful than any
single coefficient.

**Resumption lag, timed.** Parnin & Rugaber's edit lag (§4.1) is a real measure, it needs no new
instrumentation to approximate by hand, and it targets the friction we actually observed. *Corrected
16 September 2026: this originally said "with published comparison figures", which invited the
comparison probe 1's correction below withdraws. Their figures come from instrumented Eclipse logs
with interruption inferred from session boundaries; ours would be hand-recorded wall-clock with a
self-classified endpoint. The measure transfers; the numbers do not compare.*

**Cue-specificity audit — no participant required.** Altmann & Trafton's priming constraint (§4.3)
gives three checkable properties for any cue DSpatch shows on return. This is a design review, not a
study; it produces predictions, not evidence.

**Cognitive forcing as a buildable variant.** Buçinca's three designs (§9.3) are cheap, and the
**commit-first** variant does double duty for us: it prevents anchoring on the agent's account *and*
it captures his unaided understanding as a measurable artefact. Build it as a switch, not a default.

### Methods that do not survive, and should not be reported as if they did

- **Any p-value from one user on one change.** There is no test to run.
- **Preference and satisfaction ratings as effectiveness evidence.** Two independent studies in this
  document found preference diverging from benefit in opposite directions (§7.1: liked and no better;
  §9.3: disliked and better). Preference is worth recording as its own outcome — adoption matters —
  and must never be the acceptance criterion.
- **Time on task and click counts as comprehension measures.** VISION 3.1 already says fewer opened
  files is not a goal; Merino and colleagues argue effectiveness should include recollection and
  usability, not only time and correctness (§7.6).
- **A probe on code he wrote, on a change he specified in detail.** 91% of Bacchelli & Bird's 798
  respondents said unfamiliar files take longer, and 82% said familiarity changes the feedback given
  (§8.1). A comprehension probe on familiar code measures almost nothing. **This is the most likely
  way for DSP-14's trials to waste Niclas's time.**

### Five probes he could run on himself, with what each would and would not show

Ordered by value per minute spent — **corrected 16 September 2026: they are not.** The order below
is left as published so the correction stays visible, but the claim was wrong on its own criterion.
**Probe 5 costs zero of Niclas's minutes** — it is a design audit with no participant — and it sits
last. Probe 2 costs one sentence per session and answers a sharper question, whether the defect is
his memory or our presentation, than a lag figure does. The defensible reading: **probe 5 is the
cheapest first move, probe 1 the cheapest first *measurement*, and probe 2 the best value per minute
of his time.** Recommended order for whoever plans the trials: **5, then 2, then 1**, with 1 reported
against itself. One interaction this section could not see: probe 1's payoff depends on intending to
build a resumption cue, which is §13's principle 1 and sits inside the review work Niclas deferred
on 15 September 2026.

**Probe 1 — Resumption-lag baseline. Zero build required.**
For the next several sessions, record two timestamps: opening DSpatch on an existing conversation,
and the first action that *advances the task* rather than orienting to it. Also record whether the
first action was where he left off or somewhere else.
*Shows:* whether our observed friction is measurable at all and how large it is, **against itself**.
Establishes the stable baseline that any SCED needs, before we change anything.
*Does not show:* cause, or whether any particular cue would help. **And it does not show how we
compare with the published 10%-within-a-minute figure** — see the correction.
*Reactivity, which this probe omitted and §12 names for probe 3:* a man timing his own resumption
resumes differently. It arguably bites hardest here, because the measure is the very thing he knows
he is timing. Record the timestamps as a baseline of his instrumented behaviour, not of his
behaviour.
*Why first:* DSP-5 identified resumption as the friction and we have no number for it. Every later
comparison is worth more if this exists — **but see the ordering correction above; "first" is not
established, and probe 5 is cheaper.**

**Correction, 16 September 2026 — probe 1 invited a comparison that is not valid.** As published it
said the probe shows "how it compares with the published 10%-within-a-minute figure". It cannot.
Parnin & Rugaber derived that figure from **Eclipse interaction logs** with interruption *inferred
from session boundaries*, measuring time to first coding activity in an instrumented population —
limitations §4.1 records accurately and this probe then set aside. Probe 1 measures **hand-recorded
wall-clock** from opening a chat-based tool to a **self-classified** task-advancing action.
Different population, different instrumentation, different definition of both endpoints. The probe
establishes **our own baseline**, which is worth having on its own; offering the comparison is
precisely how an incommensurable number ends up in a decision document.

**Probe 2 — "Where was I" recall, before the app speaks.**
On reopening, before DSpatch displays any recap, he writes one sentence: what he was doing, and what
he intended to do next. Then compare against the stored conversation state.
*Shows:* whether the problem is memory or presentation. If his sentence is accurate and the app still
disorients him, the defect is in what we display, not in what he retained — and that distinction
changes what to build. Directly operationalises the prospective-encoding question in §4.3.
*Does not show:* which cue design fixes it.
*Cost:* one sentence per session.

**Probe 3 — Planted defect, with and without the agent's account first.**
Two comparable real changes of similar size, in code he does **not** know well, each containing a
defect the agent's own summary does not mention. In one condition the summary appears first; in the
other he reads the complete diff and **commits a written account before the summary is shown**
(Buçinca's update design). Randomise which change gets which condition. Record whether he finds the
defect, and where he looked.
*Shows:* whether summary-first narrows discovery **in our tool** — the effect Tufano and colleagues
measured elsewhere (§9.1) — and whether commit-first counteracts it. It also directly exercises
VISION 3.1's requirement that a user be able to challenge a convincing but incorrect explanation, which
is currently an aspiration with no test attached.
*Does not show:* an effect size, or anything general. Two changes, one person, and he will know he is
being tested, which the SCED literature names as reactivity.
*Warning:* §9.3 predicts he will rate the commit-first condition worse even if he performs better in
it. Record the preference; do not let it decide.

**Probe 4 — Calibration pairs.**
For each reviewed change, three to five questions with answers checkable against the code or the
recorded test result: what behaviour differs; which *unchanged* code is affected; which recorded test
covers this line and on which revision; what the change explicitly does **not** do. Confidence rating
first, score after.
*Shows:* accumulating per-change calibration points, and specifically whether his confidence tracks
his correctness in our tool. The last question type is the most valuable and the cheapest — "what does
this change not do" is where an over-helpful summary does its damage.
*Does not show:* a calibration coefficient worth reporting from few items; and §9.5's own literature
warns that relative-accuracy measures are confounded with task performance where guessing is possible,
so prefer reporting the raw pairs over any derived statistic.

**Probe 5 — Cue-specificity audit. No participant at all.**
For every artefact DSpatch shows on return, check Altmann & Trafton's three properties: did it
co-occur with the goal when work was suspended; is it salient at resumption; is it specific rather
than overloaded?
*Shows:* which existing surfaces are predicted to fail as retrieval cues, before building anything.
The remembered-projects list fails the third property by construction, and the prediction is that it
degrades further as it grows.
*Does not show:* that fixing them helps. This is a theory-driven prediction transferred from a puzzle
task, and it is **my inference**.

### If DSP-14 wants something more than a signal

Run probes 3 and 4 as a proper alternating-treatments design: two views, roughly five comparable real
changes per condition, order randomised in advance, phase lengths and the primary measure fixed before
starting, and the defect-planting done by someone other than the person scoring. That satisfies most of
the SCED quality indicators and still will not produce a generalisable effect — it produces a
defensible within-person comparison, which is the most this project can honestly obtain and is enough
to choose what to build next.

---

## 13. Handoff to DSP-14 (AC#5)

### Principles the evidence supports, ordered by how much of that support is measured

1. **Show a chronological trail of the code actually touched when the user returns.** Both automated
   cues doubled task success against note-taking — ***participant count unestablished**, corrected
   16 September 2026: this principle is top-ranked in a list whose ranking criterion is strength of
   measured support, and the denominator of its headline multiplier is unknown to us. §4.2 and §14
   both record the gap; this line carried the figure bare* — the chronological-code-snippet form was
   also the one developers strongly preferred (§4.2). Only 10% of programming sessions resume coding
   within a
   minute, and only 7.5% resume without navigating elsewhere first (§4.1). This is the best-matched
   finding in this document to the friction our one real trial actually produced, and Phase 0 already
   stores the material it needs.
2. **Put the relevant fragments on screen together instead of improving the jumps between them.**
   33.2% faster comprehension, with navigation frequency and time down 46.6% and 68.6% — and the
   authors attribute two thirds of the time saving to **working-memory offload**, not saved navigation
   (§6.3). VISION section 3 already requires this. Counterweight: **Bouraffa, Fuhrmann & Maalej's**
   20-developer experiment found no comprehension advantage for a spatial canvas over tabs (§6.4).
   *Corrected 16 September 2026: the paper is identified — it was "unidentified" here — and it is an
   **unrefereed preprint** manipulating a canvas within a one-hour session, not the persistent
   working sets Code Bubbles' author hypothesised. The counterweight is real and thinner than this
   line implied.*
3. **Decompose and classify changes by inspectable analysis, and let the user contest the basis.**
   47.3% more correct and 31.9% faster on systematic-change questions with an interactively refined,
   user-owned change template (§8.3); 42% of a thousand real changesets contained more than one
   independent change, and 16 of 20 authors judged dependency-derived partitions correct and complete
   (§8.4). This is DSP-12's conservative-classification conclusion with measurements attached.
4. **Let the user pick the question; make the tool answer it checkably.** The strongest measured
   comprehension result here — novices beating experts, 10/10 versus 3/10, a median of three files
   explored versus hundreds — came from deriving a **menu of questions** from real code and a real run
   and letting the user choose (§5.2). *Two markers restored here on 16 September 2026, both of which
   §5.2 carries and this line dropped: the authors' own verbatim limitation on the first evaluation
   is that it was "**a single task, a small sample of people, and tested unfamiliar code**", and this
   principle combines both Whyline evaluations into one sentence when **which paper is the citation
   of record is unresolved** — §5.2 read the ArgoUML figures in "Source-Level Debugging with the
   Whyline", DSP-12 attributed the same study to CHI 2009, and nobody has settled it. Check before
   citing.* Sillito's 44 question kinds are the menu's contents (§5.1). A
   version that needs no execution trace, answering questions about a change from static analysis plus
   the revision-bound test result Phase 0 already stores, is a **proposal** and the most interesting
   one in this document.
5. **Attach measured facts to code positions, and frame uncertainty as concrete outcomes rather than a
   confidence level.** The one controlled minimap study moved its measure by adding a derived
   information layer — *its 71.2%/59.3% split is **reported, unverified**, its authorship was not
   captured, and it compares an augmented minimap against a standard one; marker restored
   16 September 2026* (§7.4). People reasoned better about uncertainty from enumerated concrete
   outcomes than from summary statistics (§9.6). DSpatch already has a revision-bound test result that
   demotes itself — so "passed on this revision; these lines are covered by nothing recorded" is
   available, true, and in the better-supported form.
6. **Treat any generated account of a change as attention steering, and build the countermeasure with
   it.** §9.1 measured the steering. §9.3 gives three cheap designs that reduce the resulting
   overreliance, and the warning that users rate them worst. *Strengthened 16 September 2026: this
   principle no longer rests on my reading of an abstract plus a transfer from crowd-worker studies.
   §9.1's authors write that a generated review "does not help in better understanding the program,
   but only highlights potential issues", and their own Actionable Recommendations say to adopt
   automated review "as a further check **only after the manual inspection**. This will not save
   time but it could help in identifying additional quality issues." Both halves of this principle —
   the steering and the commit-first countermeasure — are now **recommended in domain, on
   in-domain data**. What remains inference is Buçinca's measured overreliance-reduction mechanism
   and its unfavourable subjective ratings, which are still from a nutrition task (§9.3). And what
   remains unmeasured is what the steering costs a single reviewer (§11, item 2).*

### Competing approaches that cannot both be right

| Conflict | Side A | Side B | What DSP-14 must decide |
| --- | --- | --- | --- |
| Overview for orientation | 80% preferred an overview and said it helped them keep their place | Same study: no accuracy gain, faster without it on one map, better recall without it, measured cost for switching windows (§7.1) | Whether we build an overview at all, or invest the same effort in resumption cues (§4) — and how we will tell the difference given that he will probably prefer the overview |
| Spatial co-location of code | Code Bubbles: 33.2% faster, navigation down 46–68% (§6.3) | Bouraffa, Fuhrmann & Maalej, 20 developers, canvas versus tabs: no significant comprehension effect — *unrefereed preprint, identity resolved 16 September 2026* (§6.4) | Whether co-location's benefit is the persistent *working set* or merely the spatial layout — the two studies differ on which was manipulated, and the resolved identity confirms it: a one-hour canvas session is not a persistent working set across a long task |
| Who formulates the question | Whyline: the user picks from a derived menu; measured large gains (§5.2) | Generated review/walkthrough: the tool decides; measured attention shift with no high-severity gain (§9.1) | Whether DSpatch's first review feature asks or tells |
| How to reduce overreliance | Better explanations | Explanations did not beat a bare confidence display and raised acceptance regardless of correctness (§9.2); friction reduced overreliance but was rated worst (§9.3) | Whether we are willing to ship something Niclas will say he dislikes |
| What a "conceptual difference" should be | Prose about the change | Generated prose helped only where structure was missing, and drew complaints about verbosity and "AI tone" where it did not (§9.1) | Whether to generate *structure* — a before/after specification, a question menu, a partition — rather than narrative |

### Unresolved questions, and who can settle each

1. **Does a generated walkthrough improve comprehension or defect discovery?** Still no study of that
   artefact. The nearest evidence says the adjacent artefact redirects attention without adding
   high-severity findings, time saving or confidence — *and, corrected 16 September 2026, that null
   came from a generator that missed more than half the planted issues, while a complete correct
   review raised detection decisively* (§9.1). **Settled better by probe 3 (§12) than by more
   searching** — *with one qualification added 16 September 2026: there is reading left that is
   cheaper than any probe. Five controlled experiments sit in the related-work table of §9.1's own
   paper, three measuring change comprehension by questionnaire and one (Spadini and colleagues,
   ICSE 2020) finding that prior review comments **helped** reviewers. See §2. Read that table
   before running probe 3, not instead of it.*
2. **Is the benefit of co-location the working set or the spatial layout?** Two studies disagree
   (§6.3, §6.4). *Corrected 16 September 2026: this said "needs the unidentified paper resolved
   first — a literature task, not a probe". **The paper is resolved** — Bouraffa, Fuhrmann & Maalej,
   Hamburg, unrefereed. The question is not, and the resolution sharpens it: their canvas was
   manipulated within a one-hour session, so it may never have tested the mechanism Code Bubbles'
   author proposed. What is now needed is a **design decision about which of the two we would
   build**, not more literature.*
3. **What is the unit of "since I last looked" when the agent commits nothing?** DSP-12's question 4,
   unchanged. The resumption literature adds a constraint rather than an answer: the cue must have
   co-occurred with the goal at suspension (§4.3), which rules out anything reconstructed after the
   fact.
4. **Can DSpatch obtain two recorded executions affordably on Windows for a C++ project?** Unchanged
   from DSP-12, and now more pointed, because §10 shows the execution-difference interaction has been
   built and the open question is cost plus evaluation. **Implementer or Verifier probe.**
5. **Does our own tool's orientation friction respond to a resumption cue?** **Probes 1 and 2, then a
   bounded build.** Only Niclas can answer it, and unlike most items here it is cheap to attempt.
6. **Named gap in this review:** the methodological literature on *measuring* program comprehension —
   Siegmund and colleagues in particular — was not searched. If DSP-14 wants better instruments than
   §12 offers, that is where to look first.

---

## 14. Evidence status of this review, stated plainly

**22 primary entries: 22 documented, 0 demonstrated, 0 personally observed.** No tool was run,
nothing was installed or purchased. This session had no shell, so the third category was unavailable
by construction rather than by choice. *Corrected 16 September 2026: this sentence also said "no
paper was read cover to cover", which was true when compiled and is now true of 21 of the 22
entries. §9.1's paper has since been read in full by the Reviewer in run `20260915-224600-w7h3`,
call 005.*

**Reading depth.** 18 entries: abstract plus verbatim quoted passages of results, method or
limitations. 3 entries: abstract or bibliographic record only (Parnin & DeLine's lab-study details,
the PFIS2 field study, the metacognitive-accuracy confound paper). **1 entry read in full**, added
16 September 2026 and by another role: Tufano and colleagues, §9.1. That single upgrade produced
five of the nine corrections listed at the end of this section, which is the most useful thing this
document can say about the difference between an abstract and a paper.

**Figures I could not confirm verbatim, marked in place and not to be repeated as established:** the
minimap study's 71.2%/59.3% accuracy split; the fisheye study's ~51% delocalisation improvement;
Perry and colleagues' per-task security
percentages; CRITICS' per-task detection counts; CodeCity's initial recruitment count, removed task
and task-level analysis; Buçinca and colleagues' no-AI-versus-assisted comparison on incorrect trials;
the interruption-lag duration in Trafton and colleagues.

**Two figures moved off that list on 16 September 2026, verified in the paper:** Tufano and
colleagues' **72 reviews** and **89%** acceptance rate. They were listed here as unconfirmed and may
now be carried as established. The rest of the list is unchanged; nothing else was re-verified.

**~~One entry could not be identified at all~~ — resolved 16 September 2026.** The code-canvas null
result (arXiv 2304.09301) is **Bouraffa, Fuhrmann & Maalej, "Developers' Visuo-spatial Mental Model
and Program Comprehension"**, University of Hamburg, submitted 18 April 2023. It was recorded as an
unidentified lead precisely because it is the counterweight to §6.3, and leaving it out would have
been the more comfortable and less honest choice; keeping it in is what made resolving it possible.
Two qualifications came with the identity: **no peer-reviewed venue was found**, so the counterweight
is unrefereed, and the canvas was manipulated within a one-hour session rather than across a long
task (§6.4).

**One citation is ambiguous:** the Whyline ArgoUML study. I read it in "Source-Level Debugging with the
Whyline"; DSP-12 attributed it to CHI 2009. **Still unresolved**, and as of 16 September 2026 the
ambiguity is also stated at the point of use in §13's principle 4, which previously carried the
figures without it.

**Untested proposals, labelled:** Jul & Furnas's critical-zone navigation aids (§7.2) — the authors'
own future-work section says the user studies were planned. D3's divergence debugging (§10) is
evaluated on a single author-run bug scenario, which is a demonstration of capability rather than a
measurement of benefit.

**Transfers marked as my inference, not as established:** change blindness to diff reading (§8.2);
goal-activation theory to DSpatch's return-to-work surfaces (§4.3); crowd-worker
AI-explanation findings to code review (§9.2, §9.3 — *partly demoted 16 September 2026: the
**commit-first design** is independently recommended in domain by §9.1's authors, so it is no longer
a transfer at all. The measured overreliance-reduction mechanism and the unfavourable subjective
ratings remain crowd-worker findings from a nutrition task*); prose-comprehension calibration to code
comprehension (§9.5); uncertainty-visualisation framing to change evidence (§9.6); map navigation to
change overviews (§7.1, §7.3); and single-case experimental design from behaviour-change research to
evaluating a developer tool (§12).

**Three of DSP-12's conclusions are corrected here, in place and with the reasoning shown:** desert
fog is a proposal rather than a finding (§7.2); the minimap question is answered more precisely than
either of us expected, in a way **consistent with** DSP-12's SeeSoft argument (§7.4 — *"corroborates"
was overstated and is corrected there*); and the
"diff of two executions" space is occupied by prior work, so the gap is in the evidence rather than
in the tooling (§10). DSP-12 flagged all three as things it could not settle and handed them over.
That worked, and it is worth saying so.

**Named follow-up, not done here, recorded 16 September 2026:** the correction runs one way only.
This document links to DSP-12 as its companion; **DSP-12 links nowhere**, so a reader who opens the
survey in three months will believe those three questions are open when they are answered here, and
will read "the most concrete unclaimed space the survey found" without the correction. Three
cross-reference lines in DSP-12 fix it. That belongs to **DSP-11's criterion #5 pass**, which already
requires corrections to be made in place rather than left standing, and not to a new research call.

**The weakest part of this review** is that the two highest-value sections rest on the fewest studies.
§4's resumption argument rests on two programming studies and one cognitive model, and I could not
establish the participant count of the lab study carrying its headline number. §9's conclusion rests
on one code-review experiment plus three studies from outside programming. Both conclusions are
consistent internally and with what DSP-5 observed, and neither is safe. *Sharpened 16 September
2026: that one code-review experiment is now read in full, and its own authors call their results
**preliminary** and possibly **underpowered**, asking for replication. The severity judgement
carrying "no more high-severity issues" had **weighted κ = 0.315**. So §9's foundation is one
self-described preliminary experiment, on whole-program review with no change, plus three transfers —
which is exactly why §11's item 2 had to be rewritten and why §2's five unread experiments are worth
one hour of somebody's time.*

**The cheapest fix** is not more reading. It is probe 1 in §12 — timing how long it takes Niclas to
resume work in DSpatch — which would give this project its first number about its own most-observed
problem, and which needs nobody's permission and nothing built. *Corrected 16 September 2026 on two
counts. Probe 1 is the cheapest first **measurement**, not the cheapest fix: **probe 5 costs zero of
his minutes** and needs nothing built (§12). And "not more reading" is too strong — the one
related-work table named in §2 is cheaper than any probe and tests the conclusion this document turns
on. The honest ordering is: read the table, run probe 5, then probe 2, then probe 1.*

### The nine corrections of 16 September 2026, in one place

Applied in place, each left visible at the point of use. They come from a Reviewer's independent
full-text reading of §9.1's citation in run `20260915-224600-w7h3`, call 005 — the first time anybody
in this project read that paper — and from two identity searches it ran. **The verdict was rework,
bounded; the research passed and the central conclusion survives.** Two of the nine make it better
founded than it claimed to be.

| # | What changed | Where | Direction |
| --- | --- | --- | --- |
| 1 | The attention-versus-comprehension distinction and the commit-first countermeasure are the **authors' own**, in the programming domain, on programming data. Inference markers demoted accordingly. | §9.1, §9.3, §11 item 2, §13 principle 6, §14 transfers | **Strengthens** |
| 2 | "Steering attention has a measured cost in what stops being examined" **withdrawn**. Covered locations showed no significant difference; median 50% of injected issues in both arms. What narrowed was diversity *across* reviewers, which cannot apply to a single user. | §11 item 2 | Weakens a claim, not the conclusion |
| 3 | The experimental task was **whole unfamiliar programs of 75–528 lines, no diff and no change**, predominantly maintainability issues — the condition most favourable to anchoring, and the opposite of DSpatch's task. Connected to §8.1's familiarity finding. | §9.1 limitations | Weakens the transfer |
| 4 | The **third treatment** added: a complete correct generated review was kept in full and raised detection decisively, so the binding constraint on the null was **generator recall**. Even so, no time saved and no confidence gained. | §9.1, §13 unresolved question 1 | Bounds the conclusion |
| 5 | The authors' own **"preliminary"** and possibly underpowered caveat, and the severity judgement's **weighted κ = 0.315**. | §9.1 limitations, §14 | Weakens |
| 6 | Strength markers carried into the summary sections, where they had thinned: the resumption study's unestablished participant count, the minimap study's unverified figures and augmented-versus-standard comparison, the Whyline's verbatim limitation and ambiguous citation of record. §7.4's "corroborates … two independent routes" corrected to "consistent with". | §11 items 1 and 4, §13 principles 1, 4 and 5, §7.4 | Weakens |
| 7 | **72 reviews** and **89%** acceptance **verified** in the paper; both were marked "reported, unverified". | §9.1, §14 | **Strengthens** |
| 8 | arXiv 2304.09301 identified as **Bouraffa, Fuhrmann & Maalej**, Hamburg, 18 April 2023, with **no peer-reviewed venue found**; its significant differences are in time spent on comprehension activities, not a comprehension correlation. | §6.4, §13 principle 2, conflicts table, unresolved question 2, §14 | Resolves an unknown; weakens the counterweight |
| 9 | Probe 1's comparison with the published 10%-within-a-minute figure is **not commensurable** and is withdrawn; reactivity added; the "ordered by value per minute" claim corrected, since probe 5 costs nothing and sits last. | §12, §14 | Weakens a claim, keeps the probe |

**Not done here, and named rather than silently dropped:** the five unread controlled experiments in
§9.1's related-work table, three of which measure change comprehension directly (§2) — a reading task
for DSP-14; and DSP-12's missing cross-references back to this document, which belong to DSP-11's
criterion #5 pass (above). Nothing else in this document was re-verified, and no figure outside the
two named in correction 7 changed status.
