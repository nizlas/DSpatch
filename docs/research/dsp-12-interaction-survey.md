# DSP-12: Interaction gallery for understanding a code change

Status: survey deliverable for DSP-12, milestone m-1. Compiled 15 September 2026.
Governing direction: [VISION.md](../VISION.md) sections 1–3 and 15; [REVIEW_RESEARCH.md](../REVIEW_RESEARCH.md).
Audience: DSP-14, which compares concepts and runs small trials with Niclas.

This is a comparison gallery of concrete interactions, not a recommendation, a competitor
list or a feature checklist. It exists so DSP-14 can argue from examples rather than from
intuition. Where two examples contradict each other, the contradiction is the point.

## How to read the evidence labels

Every claim carries one of three labels:

- **Documented** — stated in official documentation, a changelog, a peer-reviewed paper or
  a first-party announcement. The capability is described; we have not seen it run.
- **Demonstrated** — a published screenshot, diagram or video on the cited page shows the
  interaction.
- **Personally observed** — we ran it ourselves.

**No entry in this gallery is personally observed.** The session that produced it had no
shell available, so not even the local `git` options could be exercised. A vendor's claim
is never restated here as an observed capability.

## Scope and its limits

Recorded before searching, per REVIEW_RESEARCH.md's "A bounded first study":

- 16 examples across six categories.
- 12 are non-AI; 10 predate 2015. Both minimums exceeded deliberately, because these
  interaction problems are older than the current tooling.
- 6 carry a limitation, negative result or abandonment.

### What this survey does not cover

Recorded because "not found in this search" is not "never done":

- **No access:** Google Critique and Tricorder (internal to Google). JetBrains Air and
  Augment Intent, both cited in VISION 1.1, were not trialled. No GUI of any AI-first tool
  was exercised. Nothing was purchased or installed.
- **Not searched:** Sourcegraph-class code search and cross-repository reference
  navigation; Graphite; Reviewable; Sapling's interactive smartlog; structural merge tools
  such as Mergiraf; live-programming environments; differential and relative debugging
  research; review interactions in legal redlining, film editing and medical imaging.
- **No stored images.** Where a published screenshot is cited, the citation is the page
  containing it. There are no local captures.
- **Deliberately excluded, worth a pointer:** Light Table (2012–2016, final release 0.8.1
  on 22 January 2016) showed expression values inline in the editor as the program ran —
  "watches", a next-generation `println` streaming values back into the source
  (https://chris-granger.com/2013/08/22/light-table-050/). It is the closest prior art to
  seed 4 that this survey found, and its author's own retrospective is the more valuable
  part: he concluded that shortening the feedback loop was not the real problem, and that
  unobservability, indirectness and incidental complexity were
  (https://chris-granger.com/2014/03/27/toward-a-better-programming/;
  https://witheve.com/deepdives/lighttable.html). Left out to respect this pass's bound.

### Handed to DSP-13, not analysed here

Ko & Myers's Whyline evaluations (ICSE 2008; CHI 2009). Wettel, Lanza & Robbes's CodeCity
controlled experiment (ICSE 2011). Unverified in this pass but directly relevant to seed 5:
Jul & Furnas's "desert fog" disorientation finding for zoomable interfaces (1998).

## What Phase 0 use actually surfaced

From DSP-5's Implementation Notes, 15 September 2026 — Niclas's own observations on the
packaged Windows build, build identity `b4a87678dd5203cd`, working on his C++ project
`MiniDAWLab-spike01`.

He read a complete text diff of a README change and did not report difficulty understanding
it. What he did report was orientation and state: reopening the app "read as being asked to
choose the repository again"; the sentence "use the composer above" sent him looking in the
wrong direction; an unresolved-attempt acknowledgement had to be repeated for every message;
the remembered-projects list had accumulated dead entries he could not remove.

So the observed problem in real use is **where am I, and how do I get back** — not *I cannot
read these changed lines*. One sample, one user, one small change; this does not establish
that comprehension is fine. But it does mean the gallery should not assume a comprehension
crisis that use has not yet shown, and it explains why the return-to-position and
evidence-freshness interactions below are weighted heavily.

Two things Phase 0 already does that turn out to be prior-art-endorsed patterns: it demotes
a recorded test pass when the file changes underneath it, and it declines to guess a test
command for a CMake project rather than inventing one. Niclas recorded the second as honest
rather than wrong.

---

# Category A — Code review and diff tools

## A1. Gerrit — comparing patch sets, and naming rebase noise

**Version/date:** Gerrit Code Review, documentation at HEAD and 3.11.2, retrieved
15 September 2026. Project public since 2008.
**Source:** https://gerrit-review.googlesource.com/Documentation/user-review-ui.html

**User problem.** I reviewed version 2 of this change last week. The author has since
uploaded version 5. What do I actually need to look at again?

**Interaction sequence.** The change screen shows one pair of patch sets at a time, A and B,
where A is always the earlier upload and serves as the diff base. A patch-set strip appears
on each side of the diff header; clicking a patch set changes the comparison and refreshes
the diff, with the current selection highlighted. `Base` on the left means *the parent of the
selected patch set* — not a fixed historical base. The documentation names the two audiences
explicitly: first-time reviewers diff against the base, while reviewers who saw an older
version compare that old patch set against the current one. When the two patch sets have
different parents, Gerrit diffs the parents too, identifies which hunks moved because of the
rebase, marks them as **rebase edits** in a distinct colour, and may exclude files touched
only by the rebase from the file list.

**Strengths.** "Compare against what I last saw" is a first-class control, not a
reconstruction. The overview strip doubles as the navigation control. Machine-derived noise
is labelled as a named category rather than silently dropped, so the reviewer can see the
classifier's opinion and disagree with it.

**Limitations.** Only one pair at a time. `Base` shifting meaning per patch set has confused
users for years (https://groups.google.com/g/repo-discuss/c/jCFPnrIIdLI). Rebase-edit
exclusion works at file granularity, so a file that the amendment genuinely touched can still
contain rebase hunks inside it — a documented partial solution, not a fix.

**How we know:** documented, with published screenshots of the patch-set strip and
rebase-edit colouring on the cited page (**demonstrated** for those two elements).

## A2. Phabricator Differential — pre-commit review, then abandonment

**Version/date:** Phabricator, open source from 2011 (Facebook-internal earlier). Active
maintenance ended **1 June 2021**.
**Sources:** https://secure.phabricator.com/w/changelog/2021.22/ ·
https://blog.phacility.com/post/11/phacility_is_winding_down_operations/ ·
https://github.com/phacility/phabricator/commit/9ceb66453501d461800617b9fb2d4af4ba2c9514

**User problem.** Review a change *before* it lands, as a revision object with its own
identity and history, rather than as a branch.

**Interaction sequence.** The author runs `arc diff`; Differential creates a revision with an
identifier (`D21664`) that persists across updates. Reviewers comment inline; new uploads
become new diffs on the same revision, and the reviewer can compare between them. Revision
state (`Needs Review`, `Accepted`) is explicit and separate from whether the code landed —
visibly so: the wind-down commit's own revision "was not accepted when it landed; it landed
in state Needs Review."

**Strengths.** The revision as a durable object outliving individual uploads is exactly what
VISION section 3 requires when it says review must apply to an identified version and earlier
approval must not automatically carry forward. Approval state and landing state were
decoupled, which made the mismatch visible instead of implicit.

**Limitations and abandonment.** The README now reads only "Effective June 1, 2021:
Phabricator is no longer actively maintained." Hosted instances stopped being creatable, and
there is no route to request features. A community fork, Phorge, exists; **we did not verify
its current state.** Note carefully what the wind-down documents say and do not say: nothing
attributes the ending to the review interaction failing. It was a company winding down.

**How we know:** documented, including the primary announcement and the commit that changed
the README.

## A3. Git's own diff options — `--color-moved` and `range-diff`

**Version/date:** `diff --color-moved` shipped experimental in **Git 2.15** (October 2017),
with `--color-moved-ws` and the `dimmed-zebra` rename in 2.19. `git range-diff` was
introduced in **Git 2.19** (September 2018) as a reimplementation of `git tbdiff`.
**Sources:** https://github.com/git/git/blob/v2.15.1/Documentation/RelNotes/2.15.1.txt ·
https://public-inbox.org/git/xmqqin3dru2u.fsf@gitster-ct.c.googlers.com/ ·
https://github.blog/open-source/git/highlights-from-git-2-19/

**User problem.** Two questions the plain diff answers badly. Did this code change, or did it
merely move? And: how does this version of my patch series differ from the version I sent
last week?

**Interaction sequence.** `git diff --color-moved` colours moved lines differently from
genuinely added and removed ones, so a large relocation stops reading as a large rewrite.
Because moved lines had to be byte-identical, re-indented code was missed unless you passed a
whitespace option that then affected the whole diff — 2.19 added `--color-moved-ws` so move
detection's whitespace tolerance is configurable independently of the rest of the diff.
`git range-diff old..oldtip new..newtip` pairs up commits between two iterations of a series
and shows, per pair, reordering, commit-message edits and content changes, rendered as a
dual-colour diff-of-diffs.

**Strengths.** Both are pure classification with no model and no server: the rule is
inspectable and the same input always produces the same output. `range-diff` is the CLI
equivalent of Gerrit's patch-set comparison, which is itself evidence that "what changed
since my last read" is a durable need rather than a product quirk.

**Limitations.** Neither is a default; you have to know the flag exists. `range-diff`'s
diff-of-diffs is genuinely hard to read — Git's own history shows repeated tuning of colour
and dimming cues to make dual-colour mode legible, and the mode had to be made the default to
be usable at all. Move detection is heuristic and can mis-pair blocks.

**How we know:** documented in release notes and the maintainer's announcements. **Not
personally observed** — worth a thirty-minute local probe.

## A4. Difftastic — structural diff that refuses to overclaim

**Version/date:** `difft`, actively developed; documentation retrieved 15 September 2026.
We did not verify the current release number. Structure-preserving behaviour on invalid
syntax dates from v0.58.
**Sources:** https://github.com/Wilfred/difftastic ·
https://difftastic.wilfred.me.uk/tricky_cases.html

**User problem.** I reformatted this file and the line diff exploded. Show me what actually
changed in the syntax, not in the whitespace.

**Interaction sequence.** `difft old new` parses both files with tree-sitter and diffs the
trees, so a reflowed expression reads as unchanged and a genuine edit inside a moved block
stays visible. When it cannot do that honestly, it degrades in a documented, visible way:
falling back to a line-oriented diff with word highlighting on unsupported languages, on
parse errors beyond `DFT_PARSE_ERROR_LIMIT` (default 0), on files over
`DFT_BYTE_LIMIT` (default 1,000,000 bytes), and on structural graphs over
`DFT_GRAPH_LIMIT` (default 3,000,000 vertices). The fallback announces itself in the file
header, including the parse-error count and the position of the first error.

**Strengths.** The design principle is directly transferable and stated by the author: the
conservative fallback exists "to ensure that difftastic never claims that two syntactically
different files are the same." When the smart view cannot be trusted, the tool shows *more*,
not less, and says why in the header. That is the correct default for any DSpatch view that
narrows attention.

**Limitations.** C and C++ are called out specifically: languages relying on a preprocessor
produce parse errors even on valid code, so a C++ project — Niclas's actual project — is the
case most likely to fall back. It scales poorly on files with many changes and can use a lot
of memory. Explicitly not a merge tool; AST merging is deferred to Mergiraf. Tree diffs make
the "replacement problem", where too few common nodes produce a nonsensical pairing, *more*
common than line diffs do, not less.

**How we know:** documented, with worked before/after examples in the manual
(**demonstrated** for the fallback header format).

## A5. SemanticDiff — separating refactoring from behaviour

**Version/date:** SemanticDiff, VS Code extension and GitHub integration, 14+ languages;
retrieved 15 September 2026.
**Source:** https://semanticdiff.com/

**User problem.** This change is 400 lines, of which 380 are a rename. Which twenty matter?

**Interaction sequence.** Irrelevant changes — whitespace, optional commas, unnecessary
parentheses — are hidden. Remaining changes are analysed further to detect moved code,
renames and other refactorings, then grouped so that the changes belonging to one refactoring
read as one thing. The marketing example is precise about the failure it targets: a debug
`print` statement added inside a large moved block, buried in red and green.

**Strengths.** Grouping by *detected refactoring* is close to VISION 3.1's "group changes by
intent", but derived from analysis rather than from a narrative. Changes within moved code
stay visible, which is the specific failure mode that makes reviewers skim relocations.

**Limitations.** "Selectively hide certain or all refactorings" is listed as **coming soon**,
so the flagship attention-narrowing control is not shipped. Language coverage is bounded. And
a caution about vocabulary rather than the tool: syntax-level equality is not behavioural
equivalence. A sibling tool, `intentdiff`, makes this discipline explicit and states it
"intentionally avoids unsafe claims like 'no behavioral change'", preferring "No syntax-level
change detected" and "Behavioral significance unknown"
(https://github.com/harivilasp/intentdiff). That wording is free for DSpatch to adopt and
costs nothing.

**How we know:** documented on the vendor's own site, with published before/after images
(**demonstrated** for the moved-code case). Capability is the vendor's claim; we have not run
it.

---

# Category B — Code browsers and task-context navigation

## B1. Eclipse Mylyn — degree-of-interest filtering with an escape hatch

**Version/date:** Eclipse Mylyn, originally Mylar, public from 2005; documentation live on
help.eclipse.org, retrieved 15 September 2026. **We did not establish its current maintenance
status or adoption.**
**Sources:** https://help.eclipse.org/latest/topic/org.eclipse.mylyn.help.ui/Mylyn/User_Guide/Task-Focused-Interface.html ·
https://help.eclipse.org/latest/topic/org.eclipse.mylyn.help.ui/Mylyn/FAQ/Task-Focused-UI.html

**User problem.** My workspace has ten thousand files. Six matter to what I am doing right
now. Every tree I open shows me the ten thousand.

**Interaction sequence.** Activating a task starts recording a *task context*: Mylyn watches
which files, types, methods and fields you interact with and assigns each a degree of
interest, weighted by frequency and recency — decaying on further selections, not on elapsed
time. Toggling "Focus on Active Task" collapses the Package or Project Explorer to only the
interesting elements. Interest also decorates rather than filters elsewhere: interesting types
sort first in the Open Type dialog, and context methods rise to the top of autocomplete. The
escape hatch is deliberate and documented: toggle focus off to browse, or Alt+click a node, or
click the `[+]` that appears on hover, to pull an uninteresting element into the context
without leaving focused mode. A slider on the task's Context tab sets the minimum interest for
display, from everything to landmarks only, and elements can be removed by hand before the
context is shared.

**Strengths.** This is the strongest prior art for DSP-5's actual friction. Orientation is
restored per task, not per session, and returning to a task restores its context. Filtering
is driven by *measured* interaction rather than by a model's judgement, so the user can
predict it. The manual escape hatch and the interest slider mean the reduction is always
reversible and adjustable — the design property VISION section 3 demands when it says grouping
must not hide remaining changes.

**Limitations.** The documentation records a revealing side-effect: when focus is applied to a
navigator view, that view's **working-set filter is disabled**, so that a task spanning
working sets still shows all its interesting elements. One filter had to be switched off to
keep another honest — a concrete warning about layering filters in DSpatch. Optional
behaviour is aggressive by default: "Manage open editors to match task context" closes editors
as files become less interesting, and "Remove file from context when editor is closed" treats
closing a tab as declaring disinterest. The documentation itself suggests unchecking the
latter if you tend to close files you will return to.

**How we know:** documented, with the interaction sequence spelled out step by step in the
user guide.

## B2. Code Bubbles and Debugger Canvas — the call chain laid out in space

**Version/date:** Code Bubbles, Brown University, CHI 2010. Debugger Canvas, a Microsoft
Research / DevLabs / Visual Studio collaboration, released June 2011; version 1.1 followed;
**Visual Studio 2010 Ultimate SP1 only, never carried forward to Visual Studio 2012.**
**Sources:** https://www.microsoft.com/en-us/research/blog/debugger-canvas-released-on-devlabs/ ·
https://learn.microsoft.com/en-us/archive/blogs/kaelr/debugger-canvas-1-1-is-released ·
https://marketplace.visualstudio.com/items?itemName=DebuggerCanvasTeam.DebuggerCanvas

**User problem.** Following a call chain means opening seven files in seven tabs and losing
track of how they connect. I want to see the path, not the tabs.

**Interaction sequence.** Instead of tabbed files, code appears as *bubbles* — individual
methods — on a single pan-and-zoom canvas. As you hit breakpoints and step into code,
Debugger Canvas adds only the methods you are actually debugging, draws call lines between
them, and shows local variables alongside. The result is a spatial map of the execution path
you took, assembled by stepping rather than by hand.

**Strengths.** The closest shipped realisation of seed 1: an execution path made visible as
structure, with the code itself present in each node rather than a label standing in for it.
Bubbles are built by the act of debugging, so the overview is a by-product of work rather than
a separate authoring task.

**Limitations and abandonment.** Ultimate-only, and the team explained why in public: it was
built on Visual Studio Ultimate's dependency-diagram technology, which was what made shipping
an out-of-band power tool feasible at all. It required SP1 and worked only partially on RTM.
The marketplace listing openly lists "tradeoffs and workarounds" from bolting it onto VS 2010.
It never moved to VS 2012; Microsoft pointed users to Code Map instead, and the team noted
that Code Map "doesn't actually show the code itself in the bubbles (just a text label for the
method name)" — the successor kept the graph and dropped the thing that made it useful.

**Note for DSP-14.** Nothing in the public record attributes the discontinuation to users
disliking the interaction. It was tied to a platform dependency that did not survive. Read
this as a warning against treating abandonment as refutation.

**How we know:** documented, with a demo video and screenshots linked from the cited posts
(**demonstrated** for the canvas layout).

---

# Category C — Debuggers and execution-trace tools

## C1. Whyline — asking "why did" and "why didn't" about output

**Version/date:** Java Whyline, Ko & Myers, ICSE 2008; research prototype, never productised.
**Sources:** https://www.cs.cmu.edu/~NatProg/papers/Ko2008JavaWhyline.pdf ·
https://dl.acm.org/doi/10.1145/1368088.1368130 ·
https://dl.acm.org/doi/10.1145/1518701.1518942

**User problem.** Stated by the authors better than we can: to understand a behaviour,
developers "must translate their questions about the behavior into a series of questions about
code, speculating about the causes in the process." Every tool of the era had the same
weakness — breakpoint debuggers make you pick a line, slicing tools make you pick a variable,
query tools make you write an expression. All of them are "garbage-in garbage-out": pick the
wrong starting point and the answer is irrelevant. And none could answer questions about
things that *did not* happen, which the authors note are often the majority of developers'
questions.

**Interaction sequence.** The program runs and is traced. The developer then moves a slider
back and forth through recorded output history and selects a screen element of interest. The
Whyline derives from the code and the trace a menu of concrete questions about *that output* —
"Why did thickness = 5?", "Why didn't thickness change?" — and the developer picks one. The
tool answers by combining static and dynamic slicing, precise call graphs, value-source
analysis and a dedicated algorithm for explaining why a line was never reached, then presents
the causal chain as a compact, navigable visualisation.

**Strengths.** The interaction inverts the burden in exactly the direction seed 1 points. The
user starts from something observable — output, which they can see and which usually defines
correctness for them — and the tool constructs the code path. "Why didn't" is the part almost
nothing since has replicated. Evaluations reported by the authors: on one task novices with
the Whyline were about twice as fast as experts without it; in a later study on two real bug
reports from an open-source project, Whyline users were successful about three times as often
and about twice as fast as a breakpoint-debugger control group.

**Limitations, stated by the authors themselves.** Trace-based, therefore "not practical for
executions that span more than a few minutes, or those that process or produce substantial
amounts of data". Useless for bugs that only reproduce without instrumentation. It "feels
heavier" than a breakpoint debugger because you wait for a trace to load before asking
anything. Memory demand grows with trace size until the tool starts relying on virtual memory.
Java-only, requiring standard Java I/O. Never became a product.

**How we know:** documented in the peer-reviewed papers, including the authors' own
limitations section. The evaluation figures are theirs, from small task-specific studies —
DSP-13's territory to appraise, not ours.

## C2. Reverse execution — rr on Linux, Time Travel Debugging on Windows

**Version/date:** rr (Mozilla, then rr-debugger), Linux only, actively developed;
requirements retrieved 15 September 2026. WinDbg Time Travel Debugging, shipped in WinDbg
Preview from 2017, documented on Microsoft Learn.
**Sources:** https://rr-project.org/ · https://github.com/rr-debugger/rr ·
https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-overview ·
https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/time-travel-debugging-replay

**User problem.** I can see the symptom. The cause happened thousands of instructions ago, and
every attempt to get back there means restarting and guessing where to break.

**Interaction sequence.** Record once, then debug the recording as many times as you like,
with the same execution replayed identically every time. Under rr you `rr record`, then
`rr replay`, then set a breakpoint or data watchpoint and `reverse-continue` — the program
runs *backwards* to the last time that condition held. `reverse-step`, `reverse-next` and
`reverse-finish` behave as expected. Under WinDbg TTD the same shape appears with Windows
commands: `g-` runs backward, `p-` steps back over, `t-` steps back into; `!tt 50` travels to
halfway through the trace and `!tt 1A0:12F` to an exact two-part position; `!positions` lists
every thread's current position; and `!tt br-`, `!tt ba-` and `!tt bm-` search backwards for
register changes, memory accesses and module boundaries. TTD also renders **timelines**: a
visual band of recorded events — breakpoints, memory reads and writes, function calls and
returns, exceptions — that you click to travel to.

**Strengths.** This is what seed 1 looks like when it is grounded in a real execution rather
than in a plausible reading of the code. Every position is a fact about a run that happened,
and the same run can be revisited indefinitely, which is precisely the property VISION section
3.1 asks for when it says evidence must bind to an identified revision. TTD's timeline is also
the best example in this gallery of an overview built from *measured* events rather than from
prediction — directly relevant to seed 4.

**Limitations, and they are decisive for DSpatch.** rr is **Linux only**, on specific CPUs
(Intel Nehalem or later, certain AMD Zen, certain AArch64), needs kernel ≥ 4.7, emulates a
single core so parallel programs run at single-core speed, cannot record processes sharing
memory outside the recording tree, and the project states there are no plans for macOS or BSD
support. So on Niclas's Windows machine, rr is unavailable. TTD is available on Windows, but
Microsoft documents roughly **10×–20× recording overhead**, trace files that reach several
gigabytes within minutes with no maximum size, and indexes of one to two times the trace size.
It is user-mode only, replay is strictly read-only — "you can travel back in time, but you
can't change history" — the trace format is proprietary to WinDbg, and backwards module or
register searches are documented as slow.

**How we know:** documented on both projects' official pages, including their own limitation
sections. **Neither was run.** Whether TTD is affordable enough to sit under a DSpatch
walkthrough for a C++ project on Niclas's machine is an open question requiring a real probe.

---

# Category D — Visualisation and overview

## D1. SeeSoft (1992) and the editor minimap descended from it

**Version/date:** SeeSoft, Eick, Steffen & Sumner, AT&T Bell Laboratories, IEEE Transactions
on Software Engineering 18(11):957–968, November 1992. Present-day descendant: the VS Code
minimap, enabled by default via `editor.minimap`.
**Sources:** https://www.sdml.cs.kent.edu/library/Eick92.pdf ·
https://doi.org/10.1109/32.177365 · https://doi.org/10.1080/10618600.1994.10474635

**User problem.** Where in this body of code is the interesting stuff, and how do I get from
the shape of the whole thing down to a line?

**Interaction sequence.** Each line of code becomes a thin coloured horizontal row, preserving
its real position, length and indentation, so the display reads as a miniature picture of the
source — up to 50,000 lines at once on a 1992 monitor. Colour encodes a statistic: red for the
most recently changed lines, blue for the least. Crucially, the statistic is **measured, and
its source varies**: version control (line age, which programmer, and the *purpose* of the
change, e.g. "fix bug in call forwarding"), static analysis (where functions are called), and
dynamic analysis (profiling, and in the companion work, test results). The user manipulates
this reduced representation directly to find patterns, then opens additional windows showing
the actual code for the region of interest.

**Strengths.** The 1992 design is closer to what VISION 3.1 and seed 4 ask for than its own
descendants are. The miniature is not decorative: it is a **carrier for measured evidence**,
bound to specific lines, with a documented path from the overview into the real code. Colour
means something checkable. Thirty-four years later, DSpatch already stores a revision-bound
test result and already demotes it when the code changes — the same substrate SeeSoft coloured
with.

**Limitations.** What survived into mainstream editors kept the miniature and discarded the
evidence. The modern minimap colours by *syntax*, so it renders where code is dense rather
than where it matters; it is a scrollbar with texture. We found no controlled evidence for or
against minimap usefulness in this pass — appraising that is DSP-13's job. We also did not
verify Sublime Text's role in popularising it, so that lineage claim is **unverified here**.

**How we know:** documented in the peer-reviewed papers; the 1994 companion paper describes
the visual result precisely. The VS Code default is documented. Not observed.

## D2. CodeCity — a measured benefit with no adoption we could find

**Version/date:** CodeCity, Wettel & Lanza, University of Lugano, 2007–2008. Controlled
experiment published at ICSE 2011.
**Sources:** https://wettel.github.io/download/Wettel11a-icse.pdf ·
http://wettel.github.io/codecity-experiment.html · https://doi.org/10.5281/zenodo.268463

**User problem.** Understand the structure and metrics of an unfamiliar system quickly.

**Interaction sequence.** The system is rendered as a 3D city: packages are districts,
classes are buildings, and metrics drive building height and footprint. The user navigates
spatially to find outliers — a disproportionately tall building is a class with an extreme
metric — then drills into the underlying entity.

**Strengths, and this is the interesting part.** The authors did what almost nobody in
software visualisation did: they evaluated it properly. Forty-one participants from academia
and industry, four locations, three countries, against a control of Eclipse plus spreadsheets
of metric data. CodeCity produced a **24.26% increase in task correctness and a 12.01%
reduction in completion time, both statistically significant.** All experimental artifacts
were published for replication.

**Limitations.** We found **no evidence of adoption** in mainstream practice, and the
project's download page reads as a research-artifact page rather than a maintained product.
Note the discipline required here: absence of evidence of adoption is our failure to find it,
not proof of abandonment. We are not claiming CodeCity was abandoned; we are recording that we
could not find it in use.

**Why this belongs in the gallery.** Place it beside D1. The minimap has enormous adoption and
no evidence we found. CodeCity has a statistically significant measured benefit and no
adoption we found. In this field, adoption and evidence are close to uncorrelated — which
means DSP-14 cannot justify a choice by pointing at either popularity or a single paper.

**How we know:** documented in the peer-reviewed experiment, with raw data published.

---

# Category E — AI-first tools

## E1. CodeRabbit — the conceptual difference, already shipping

**Version/date:** CodeRabbit, GitHub and GitLab app; documentation retrieved 15 September 2026.
**Sources:** https://docs.coderabbit.ai/pr-reviews/walkthroughs ·
https://docs.coderabbit.ai/reference/review-commands ·
https://docs.coderabbit.ai/pr-reviews/summaries

**User problem.** Tell me what this pull request is *about* before I start reading files.

**Interaction sequence.** On every review, CodeRabbit posts a **walkthrough** comment at the
top of the PR thread, separate from inline code comments, on by default. It is composed of
independently toggleable sections: a plain-language summary, a changed-files table with
per-file descriptions, and — for pull requests touching component interactions, API calls,
event flows or async workflows — a **generated Mermaid sequence diagram of the updated flow**,
rendered inline in GitHub and GitLab. `sequence_diagrams` defaults to `true`. A reviewer can
also request one on demand by commenting `@coderabbitai generate sequence diagram`, and can
move the summary from the PR description into the walkthrough with
`high_level_summary_in_walkthrough: true`.

**Strengths.** This is seed 3 in production, and seed 1 in a static form. The reviewer-facing
control surface is worth noting independently of the AI: the walkthrough is composable
section by section, on-demand regeneration is a plain comment command, and configuration lives
in a file in the repository rather than in a hidden setting. DSpatch should know that a
generated conceptual overview with a flow diagram is an available baseline, not a novel idea.

**Limitations.** We found **no controlled evaluation** of whether the walkthrough improves
reviewer comprehension or defect discovery. The sequence diagram is derived from the diff by a
model, not from an execution — contrast C2, where every position in the timeline is a fact
about a run that happened. Nothing in the documentation distinguishes a relationship the tool
*observed* in the code from one it *inferred*, which is precisely the distinction VISION 3.1
requires.

**How we know:** documented in the vendor's own documentation, which is where the defaults and
configuration keys come from. Capability is the vendor's description; we have not seen it
review a pull request.

## E2. GitHub Copilot Workspace — reviewing the plan before the code, then retired

**Version/date:** Technical preview announced 29 April 2024. **Preview concluded 30 May
2025**; GitHub confirmed on 23 January 2026 that development had stopped and focus moved to
Copilot coding agent.
**Sources:** https://github.blog/news-insights/product-news/github-copilot-workspace/ ·
https://github.com/githubnext/copilot-workspace-user-manual/blob/main/overview.md ·
https://gist.github.com/idan/15f101b8ff4be8bebe17147c08995363 ·
https://github.com/github/roadmap/issues/1041

**User problem.** By the time I see the diff, the agent has already committed to an approach.
I wanted to argue with the approach.

**Interaction sequence.** Four reviewable artifacts before any code. From a task or issue —
often a long comment thread — Workspace first generates a **topic**: a single question that
can be posed against the codebase, defining before-and-after success criteria. The user manual
is candid that "the topic introduces clarity that is completely missing from the issue title."
Then a **current specification** describing the codebase's present state, and a **proposed
specification** — a bulleted list of the state after the task, deliberately about success
criteria rather than implementation. Then a **plan**: the files to be edited, created,
deleted, moved or renamed, each with the specific steps for it. Every stage is **editable and
regeneratable**, so the user can rewrite the spec or the plan and have downstream artifacts
follow. Only then does implementation begin, per file, with a diff view that automatically
scrolls to the first change — and the diff editors are themselves editable, for tweaks too
small to justify going back to the plan.

**Strengths.** The most complete shipped realisation of VISION 1.1's claim that "review can
happen during formulation, investigation and implementation, allowing a wrong premise to be
discovered and discussed before the next attempt." Note the specific design choice worth
stealing: separating *current state* from *proposed state* as two artifacts makes the delta
the object of review, which is a cheaper and more honest version of seed 3 than asking a model
to summarise a finished diff. Also note the smallest detail — auto-scrolling the diff to the
first change — which is exactly the class of orientation nicety DSP-5's friction list is made
of.

**Limitations and retirement.** The preview ended; Workspaces could no longer be created or
opened after 30 May 2025. The sunset note is unusually informative about *why* the shape was
hard: techniques that made Copilot completions feel good — low latency, the amodality of
ghost text — "don't work when you scale up the size of suggestions from short snippets to
entire diffs", and this was already GitHub's second attempt after Copilot for Pull Requests.
Again, nothing attributes the ending to users rejecting plan review; the stated reason is that
the learnings were absorbed into Copilot coding agent and IDE agent mode.

**How we know:** documented, with published screenshots of the topic, spec, plan and diff
stages in the user manual (**demonstrated** for the four-stage sequence).

## E3. Devin — a polished narrative measured against outcomes

**Version/date:** Devin, Cognition. Independent evaluation published by Answer.AI on
8 January 2025.
**Sources:** https://www.answer.ai/posts/2025-01-08-devin.html ·
https://www.theregister.com/software/2025/01/23/first_ai_software_engineer_is_bad_at_its_job/

**User problem.** An autonomous agent worked for hours. What did it actually do, and can I
trust its account of it?

**Interaction sequence and what was measured.** Three data scientists ran Devin on 20 real
tasks over a month. Result: **3 successes, 14 outright failures, 3 inconclusive.** They
described the user experience as polished and impressive when it worked — "but that's the
problem, it rarely worked." Two specifics matter for review design. First, they could discern
**no pattern predicting which tasks would succeed**; tasks resembling earlier wins failed in
new ways. Second, the failure mode was not stopping: asked to deploy multiple applications to
Railway, which the platform does not support, Devin "marched forward" and spent more than a
day on hallucinated approaches rather than reporting a blocker.

**Why this is in the gallery.** Be precise about what it does and does not show. This is
**not** an evaluation of Devin's review or audit-trail interface, and we are not claiming it
is. It is evidence about the relationship between a confident agent narrative and reality, and
it lands directly on VISION 3.1's requirement that "a persuasive agent narrative must not
replace access to real code" and that users must be able to challenge a convincing but
incorrect explanation. The authors' own conclusion generalises the point: "Social media
excitement and company valuations have minimal relationship to real-world utility."

**Limitations of this evidence.** One team, 20 tasks, one product version in January 2025,
and models have moved since. It measures task outcomes, not comprehension or review quality.

**How we know:** documented in the published independent evaluation with a per-task appendix.

---

# Category F — Outside software development

## F1. Microsoft Word Simple Markup — hiding changes at enormous scale, and the harm

**Version/date:** Introduced in **Word 2013**; carried into Word 2016 and later on Windows.
**Sources:** https://support.microsoft.com/en-us/office/what-s-new-in-word-2013-3a9a927f-73ad-4ac5-910b-dfb12052d063 ·
https://www.pcworld.com/article/459867/microsoft_office_2013_customer_preview_first_impressions.html ·
https://learn.microsoft.com/en-us/answers/questions/4929778/how-to-change-simple-markup-default-to-all-markup

**User problem.** A tracked-changes document is unreadable as a document. I want to read the
prose, and still know that edits exist.

**Interaction sequence.** Simple Markup collapses all revision marks to a single **red
vertical bar in the left margin**, with a comment balloon in the right margin. The document
reads clean. Clicking the change bar expands the full markup in place; clicking the balloon
shows just comments. Microsoft's own description: "Simple markup hides the revisions behind a
single red change bar, and lets you show/hide the details by clicking on it."

**Why it belongs here.** This is seed 2 and seed 5 combined, shipped to an enormous
non-technical audience a decade before the current AI tooling, in a domain — document revision
— whose structure maps almost exactly onto a diff. A one-pixel margin bar is a far cheaper
overview than a minimap and answers the same question: *is there anything here, and where.*

**Limitations, and this is the most important caution in the gallery.** Third-party reviews
and a Microsoft Q&A thread indicate Simple Markup became the **default** display mode in Word
for Windows from 2013 onward, unlike Word for Mac. **We did not confirm the default from
Microsoft documentation, so treat the default claim as unverified.** What the Q&A thread does
document is the consequence as a working editor experienced it: recipients "are inadvertently
missing edits because they are viewing Simple Markup", the display mode is controlled by the
*reader's* installation rather than stored in the document, and the answer given is that there
is no setting to change it. A professional editor described the effect on her work as
"crippling".

**The transferable lesson.** The harm was not caused by highlighting what matters. It was
caused by **hiding by default, with the choice made by the reader's environment rather than by
the reader**. VISION section 3's rule — "grouping must not hide remaining changes" — is
independently corroborated by a decade of Word users, and prior art suggests its strongest
form: show everything by default, let the user fold, keep the folded state visible and local,
and never let one person's view silently determine what another person sees.

**How we know:** the feature and its behaviour are documented by Microsoft and described with
a screenshot in the contemporaneous press review (**demonstrated** for the change bar). The
default-mode claim and the harm reports come from a Microsoft Q&A thread — a user report, not
official documentation.

## F2. Ardour's Summary pane — the overview *is* the navigation control

**Version/date:** Ardour digital audio workstation, open source since 2005; Summary pane
documented in the current Ardour manual, retrieved 15 September 2026.
**Sources:** https://manual.ardour.org/ardours-interface/the-summary/ ·
https://manual.ardour.org/editing/navigating-the-editor/

**User problem.** My session is two hours long across thirty tracks. I am zoomed into a
200-millisecond region. Where am I, and how do I get back to where I was?

**Interaction sequence.** A persistent horizontal strip — toggled with View → Show Summary, or
`s` — gives a bird's-eye view of the whole session. Each horizontal line is a track; coloured
bars are its regions, in the track's own colour. Vertical lines mark the session's start and
end; a red line is the playhead. And a **transparent white rectangle shows exactly what the
editor is currently displaying**. That rectangle is not a status indicator, it is the control:
drag it anywhere to move the view; drag it vertically to scroll tracks; **drag its left or
right border to zoom**. Arrow buttons beside it page one screen left or right, and a zoom
control fits the whole session between the start and end markers. Separately, `z` toggles back
to the previous zoom state — an undo for zoom that survives edits made in between.

**Why it belongs here.** Two reasons. First, it is a better answer to seed 5 than a minimap
is, and structurally different: it shows *where you are* and *where things are* in the same
widget, and the same widget moves you. Position, extent and zoom are one manipulable object
rather than three separate controls, so you never lose the relationship between the detail
view and the whole. Second, it may be unusually cheap to discuss with Niclas, because "like a
DAW summary strip, but the tracks are files and the regions are changes" is a complete design
brief in one sentence *if the reference lands*.

**Correction, 15 September 2026, and what replaced it.** This entry originally asserted that
the interaction was "already in his hands and in his head" because he is building a DAW.
Nobody asked him. Working on a DAW project establishes the domain, not familiarity with Ardour
or with this particular panel, and he queried the claim as soon as he read it. The survey's
own rules forbid exactly this: an inference presented as an observation.

Asked directly, he answered: he does not know Ardour's Summary pane by name, but his own DAW
project has "some kind of summary view for the MIDI tracks in the main window" with scroll and
zoom, which sounded similar. He then invited us to read the code.

**We did, and it is the other family.** Read in `MiniDAWLab` at `1aa7d27` (13 September 2026)
and confirmed present in `MiniDAWLab-spike01` at `b87f042`:

- `paintMidiClipNotePreview` in `src/app/InstrumentTimelineRowCoordinator.cpp` draws, inside
  each MIDI clip rectangle on the arrangement row, **one small bar per note** — x and width
  from the note's timing, y from its pitch. Its own comment calls it a "Cubase-like note
  preview". Pitch is scaled **per clip**, from that clip's own minimum to its own maximum, so
  a clip spanning three semitones fills the same height as one spanning three octaves; a
  single-pitch clip has its range widened so the one row reads as a centred band.
- `TimelineViewportModel` in `src/ui/` holds `visibleStart` and `samplesPerPixel`. Panning
  changes only the first, zooming only the second, and the visible length is *derived* from
  the pixel width rather than stored — so resizing the window shows more time at the same
  zoom instead of rescaling. `zoomAroundSample`, reached by Ctrl and the wheel, **keeps the
  sample under the pointer anchored** while the scale changes.
- There is no separate overview widget. Nothing in the main window renders the whole session
  in miniature, and there is no viewport rectangle to drag or resize.

So his summary view is **D1's family, not F2's**: a miniature of the content, rendered in
place at true position, exactly what SeeSoft did with source lines. What makes F2 interesting
— an overview elsewhere on screen whose rectangle *is* the navigation control — he has not
built, and the analogy would not land.

**Two things he has built that are worth more to DSP-14 than the analogy was.** First,
pointer-anchored zoom: the thing under the cursor stays put while the scale changes, which is
the cheapest known defence against losing your place, and he has it in his hands daily.
Second, **per-clip pitch normalisation** — the miniature is scaled to each clip's own range so
that small content stays legible instead of collapsing into a line. Transposed to a change
overview, that is the question of whether a two-line change in a small file should look like a
two-line change in a large one. His answer in the DAW was no.

**Limitations.** Sessions have a single dominant axis, time, and code changes do not; what
plays the role of the horizontal axis in a change overview is genuinely open. The summary
occupies permanent vertical screen space and is optional for that reason. Region colour
carries only track identity, not any measured property — so unlike SeeSoft, this overview
shows structure, not evidence. And this is an interaction we have read about, not measured:
we found no evaluation of it, and DAW users are a self-selected population accustomed to
timeline interfaces.

**How we know:** documented precisely in the official manual, including the drag-to-zoom
border behaviour, with a screenshot of the Summary on the cited page (**demonstrated**).

---

# Assessment of the five concept seeds

Per the assignment: which the evidence supports, which it complicates, and which nobody
appears to have built. A seed that prior art suggests is a bad idea is a finding.

## Seed 1 — "Take me through the code flow"

**Supported, with one hard condition.** Every example that demonstrably helped people follow
execution was grounded in a **recorded run**: Whyline's trace, rr's deterministic replay,
TTD's indexed trace, Debugger Canvas's bubbles accumulated by stepping. The one example built
without an execution — CodeRabbit's sequence diagram from the diff — has no comparable
evidence.

**Complicated by cost and platform.** Whyline: minutes-long executions only, memory growing
with trace size, and the authors' own note that it "feels heavier" than a breakpoint debugger.
rr: unavailable on Windows. TTD: available on Windows but documented at 10–20× overhead with
multi-gigabyte traces. Debugger Canvas: shipped, then stranded by a platform dependency.

**Apparently not built.** A walkthrough of the *difference between two executions* — "here is
the path before your change, here is the path after, here is where they diverge." We found
diff tools, trace tools and call-graph tools, and no tool that walks a reviewer through the
delta between two runs of the same program. This is the most concrete unclaimed space the
survey found. Two honest caveats: "not found in this search" is not "never done", and we did
not search the differential or relative debugging literature, which is DSP-13's territory and
may well contain prior work.

## Seed 2 — "Highlight the essential diffs"

**Supported, but only in a specific conservative form.** Difftastic, SemanticDiff and Gerrit's
rebase edits all narrow attention by **inspectable classification** rather than by a model's
judgement, and all three degrade toward showing more rather than less. Difftastic's stated
principle is the model to copy: fall back to the line diff so the tool "never claims that two
syntactically different files are the same", and print the reason in the file header.

**Complicated, sharply, by Word.** The same idea shipped to hundreds of millions of people,
became the default on Windows, and generated documented real-world harm — recipients missing
edits without knowing edits existed, with the display mode controlled by the reader's
installation rather than the document. The distinction that matters is not highlighting versus
not highlighting. It is **folding versus hiding**, and **who chooses**.

**Recommendation for DSP-14 to argue with.** Default to the full change set. Let the user fold.
Keep the fold visible and local. Label the classifier's basis. Adopt `intentdiff`'s wording
discipline verbatim — "no syntax-level change detected", "behavioural significance unknown" —
because it costs nothing and prevents the exact overclaim VISION 3.1 warns about.

## Seed 3 — "Give me the conceptual difference"

**Supported in the sense that it exists.** CodeRabbit ships it today, on by default, with a
generated sequence diagram. DSpatch would be entering an occupied space, not inventing one.

**Complicated by the evidence gap, which is the largest in the survey.** This is the seed with
the most implementations and the least evaluation. We found no controlled study of walkthrough
comprehension. Devin is the standing warning about what a polished narrative is worth on its
own. And Copilot Workspace suggests a cheaper, more honest variant that a retired product had
already found: instead of summarising a finished diff, state the **current specification** and
the **proposed specification** as two separate reviewable artifacts and let the delta between
them be the conceptual difference. That is checkable in a way that prose about a diff is not.

## Seed 4 — "Explain benefits/risks" visually and in text

**Nobody appears to have built the part that matters.** Nothing in this gallery visually
distinguishes *predicted* consequence from *measured* result. Tools do one or the other.
SeeSoft (1992) colours lines by measured statistics including test results and profiling, with
a path from the overview into real code — measurement, no prediction. WinDbg timelines show
recorded events — measurement, no prediction. CodeRabbit's walkthrough is inference presented
in prose — prediction, unlabelled as such.

**Complicated by Light Table's retrospective.** Its author, having built the best-known
inline-evidence editor of its era, concluded afterwards that shortening the feedback loop was
not the real problem, and that unobservability and indirectness were. An annotation layer over
a diff is at risk of the same critique: prettier presentation of the same unobservable thing.

**Why this is nonetheless DSpatch's strongest candidate.** VISION 3.1 already demands the
distinction, and **Phase 0 already has the mechanism**: a test result bound to a revision,
which demotes itself when the underlying code changes so it stops claiming to describe current
code. Niclas confirmed that working on 15 September by editing a file externally and watching
the pass get demoted. Prior art supplies the presentation idea — SeeSoft's measured statistic
attached to specific lines, with click-through to the code — and DSpatch already has something
true to attach. That combination is rare in this gallery.

## Seed 5 — "Zoomable minimap" or another change overview

**The seed's own framing is the weakest part of it, and this is the survey's most useful
correction.** The minimap lineage runs from SeeSoft 1992 to today's editors, and what survived
the journey is a *pixel rendering of a file coloured by syntax* — where code is dense, not
where it matters. The 1992 original was better, because colour meant a measured fact.

**Two stronger alternatives, which contradict each other.** Ardour's Summary makes the
overview and the navigation control the same manipulable object: a viewport rectangle you drag
to move and resize to zoom, so position, extent and zoom never drift apart. Mylyn goes the
opposite way and abolishes the miniature entirely: reduce the tree by measured degree of
interest, with an explicit escape hatch — toggle focus off, Alt+click, or the hover `[+]` — to
bring anything back. Render everything smaller, or show less of it. Both address the same
problem and cannot both be right for DSpatch.

**The DSP-5 tie-in that makes this seed matter at all.** The friction Niclas reported was
orientation on return and a project list of dead entries. Ardour's Summary and Mylyn's
per-task context both attack exactly that. A minimap does not. If DSP-14 keeps only one thing
from this section, keep that: the overview should be built for *returning*, not for *scanning*.

---

# Our own reference point — the DAW Niclas is building

**Not a seventeenth gallery entry.** The sixteen above are prior art we are learning from.
This is the interaction vocabulary our only user already has, which is a different thing and
is why it sits in its own section. It is also the only material in this survey **read in
source at a named revision** rather than taken from documentation: `MiniDAWLab` at `1aa7d27`,
13 September 2026, with the same code confirmed in `MiniDAWLab-spike01` at `b87f042`. We read
it; we did not run it, and we did not watch him use it.

It entered the survey by correcting a mistake. F2 originally asserted that he knew Ardour's
Summary pane because he is building a DAW. He does not, he said so, and he then pointed at
what he does have. Asking produced better material than the inference had — which is the
general lesson, not a footnote.

## What he has built

**A miniature of the content, rendered in place.** `paintMidiClipNotePreview`, in
`src/app/InstrumentTimelineRowCoordinator.cpp`, draws one small bar per note inside each MIDI
clip rectangle on the arrangement row: x and width from the note's timing, y from its pitch.
Its own comment calls it a "Cubase-like note preview".

**Pitch normalised per clip.** The bars are scaled from that clip's own lowest note to its own
highest, so a clip spanning three semitones fills the same height as one spanning three
octaves. A single-pitch clip has its range deliberately widened so the one row reads as a
centred band rather than a line at the edge.

**Pan and zoom as two separate, minimal facts.** `TimelineViewportModel` stores only
`visibleStart` and `samplesPerPixel`. Panning changes the first, zooming the second, and the
visible *length* is derived from the pixel width rather than stored — so resizing the window
shows more time at the same zoom instead of rescaling everything.

**Zoom anchored at the pointer.** `zoomAroundSample`, on Ctrl and the wheel, keeps the sample
under the cursor fixed while the scale changes around it.

## What he has not built

No separate overview widget. Nothing in the main window renders the whole session in
miniature, and there is no viewport rectangle to drag or resize. `ScrollBar` appears in the
piano roll for pitch and in popups, not as a session overview.

## How this compares to the gallery

| | His MIDI preview | D1 SeeSoft and minimaps | F2 Ardour Summary | B1 Mylyn |
| --- | --- | --- | --- | --- |
| Where the overview lives | inside the thing itself | a separate rendered miniature | a separate strip | no miniature at all |
| What reduction means | draw it smaller in place | draw it all smaller | draw the whole, mark the part | draw less of it |
| What moves you | pointer-anchored wheel zoom | click the miniature | drag and resize the rectangle | activate a task |
| What the position means | true time and pitch | true file position | true session position | interest rank, not position |
| What colour or scale carries | pitch, normalised per clip | a measured statistic (1992) or syntax (today) | track identity only | nothing |

**He is in D1's family, not F2's.** So "like Ardour's summary, but the tracks are files" is not
the shortcut it looked like — it describes a widget he has never used. The accurate sentence is
narrower and still useful: *he already believes a miniature of the content belongs inside the
row it describes, and that zoom must not move what you are looking at.*

## What DSP-14 should take from this

1. **Pointer-anchored zoom is orientation, and he already relies on it.** DSP-5's friction was
   losing his place on return. He solved a version of that problem in his own product without
   naming it. Any DSpatch view that zooms or collapses should be measured against it: does the
   thing you were looking at stay where it was?
2. **Per-clip normalisation is a real question in disguise.** Should a two-line change in a
   small file look like a two-line change in a large one? His DAW answers no — legibility of
   the individual unit beats comparability across units. That is a defensible position and the
   opposite of what a proportional change overview would do. Worth asking him directly,
   because he has already made the choice once.
3. **His summary carries structure, not evidence** — pitch and timing, nothing measured. Same
   gap as today's minimaps, and the same opening seed 4 describes.

---

# Handoff to DSP-14

## Promising patterns, in the order we would argue for them

1. **Compare against what I last saw.** Gerrit's patch-set selector and `git range-diff` both
   exist because re-review is the real problem, and VISION K3 already requires review to hold
   its revision. DSpatch has an advantage neither tool has: it drives the agent, so it knows
   exactly which revision the user last read, without needing commits or patch sets. Note both
   prior arts' warning — rebase and parent changes pollute the comparison, and Gerrit's
   file-level mitigation is documented as incomplete.
2. **Attach measured evidence to code positions, and mark predictions as predictions.**
   SeeSoft's approach plus Phase 0's existing revision-bound, self-demoting test result. The
   least speculative candidate here, because both halves already exist.
3. **The overview is also the control.** Ardour's viewport rectangle; Gerrit's patch-set strip;
   Mylyn's interest slider. An overview you can only look at is worth less than one you steer
   with. Argue this one from prior art alone: it originally claimed Niclas already knew the
   Ardour interaction, and reading his code disproved that — he built a miniature inside the
   row, with no overview widget at all. See *Our own reference point*.
4. **Classify, then let the user fold — never hide by default, and never let the reader's
   environment decide.** Difftastic, SemanticDiff and Gerrit versus Word.
5. **Say what you don't know, in the product's own words.** `intentdiff`'s "behavioural
   significance unknown"; Difftastic printing its parse-error count and first error position;
   Gerrit naming "rebase edits" as a category you can distrust. DSpatch already does a version
   of this — declining to guess a CMake test command — and Niclas recorded it as honest rather
   than wrong. That is a signal worth building on.
6. **Review the formulation, not only the diff.** Copilot Workspace's current spec / proposed
   spec / plan, all editable and regeneratable, is the most complete shipped version of VISION
   1.1's "review during formulation". Know before investing that it was retired, and know the
   stated reason: repo-scale suggestions do not inherit what made snippet-scale suggestions
   feel good.
7. **Do not move what the user is looking at.** Niclas's own `zoomAroundSample` keeps the
   sample under the pointer fixed while the scale changes. The smallest pattern in this list,
   the only one taken from code he wrote himself, and the one aimed most directly at what
   DSP-5 actually surfaced — orientation on return, not difficulty reading a diff.

## Conflicting examples — the most useful part of this survey

| Conflict | Side A | Side B | What DSP-14 must decide |
| --- | --- | --- | --- |
| Default for a narrowed view | Difftastic, SemanticDiff, Gerrit: classify conservatively, fall back to showing more, announce why | Word Simple Markup: hide by default, reader's environment decides | Whether any DSpatch view may ever default to hiding a change |
| What "code flow" means | Whyline, rr, TTD: grounded in a recorded execution, heavy, evidenced | CodeRabbit: generated from the diff, cheap, unevaluated | Whether a walkthrough must be backed by a real run to be honest |
| Shape of an overview | SeeSoft and minimaps: render everything smaller | Mylyn: render less, by measured interest, with an escape hatch | Whether orientation comes from seeing all of it or from seeing the right part |
| What justifies a design | CodeCity: statistically significant benefit, no adoption found | Minimap: enormous adoption, no evidence found | Neither popularity nor a single paper can settle a choice here |
| Reading abandonment | Debugger Canvas: killed by a platform dependency | Copilot Workspace: learnings absorbed elsewhere | Abandonment is not refutation; do not treat either as proof the interaction failed |

## Unresolved questions we could not settle

1. Does an agent-generated walkthrough improve comprehension or defect discovery? No
   evaluation found for CodeRabbit-class walkthroughs. **DSP-13.**
2. For *changes* specifically, is the best overview a rendered miniature, a curated tree, or a
   viewport rectangle over a change list? All three prior arts overview files or sessions.
   Nobody in this gallery overviews a change set. **A cheap sketch comparison with Niclas would
   settle more than more searching.**
3. Can DSpatch obtain a recorded execution affordably on Windows for a C++ project? TTD is
   documented at 10–20× overhead and multi-gigabyte traces; rr is Linux-only. **Needs an
   Implementer or Verifier probe, not a researcher.**
4. What is the unit of "since I last looked" when the agent commits nothing? Gerrit and
   `range-diff` assume patch sets or commits. Phase 0 stores baselines as base64 copies, at
   5.7 MB of a 16 MB budget for a seven-message conversation — the mechanism exists and its
   cost is already visible.
5. Whether an overview built for returning actually resolves the friction Niclas hit. Only he
   can answer that, and only against a sketch.

## Evidence status of this survey, stated plainly

Sixteen examples: **14 documented, 2 demonstrated, 0 personally observed.** No tool was run.
No purchase or installation was made. No screenshots were captured or stored. Three claims are
marked unverified in this pass and must not be repeated as established: Word's Simple Markup
being the default on Windows, Sublime Text's minimap origin, and Difftastic's current release
number. Two claims were deliberately not made for want of evidence: Mylyn's current
maintenance status, and CodeCity's abandonment.

One claim has been **withdrawn** since publication. F2 and handoff item 3 stated that Niclas
already knew Ardour's Summary pane from his own project. That was inferred from his project
being a DAW spike; he had not been asked, and he queried it on first reading. The survey's own
labelling rules apply to claims about our user as much as to claims about tools: an inference
about what somebody knows is not an observation. Both passages are corrected in place rather
than quietly deleted, so the mistake stays visible.

Asking him produced a better fact than the inference had, and reading the code he pointed at
settled it: his MIDI summary is a miniature rendered in place, D1's family, not F2's. The
Ardour analogy does not land, and two properties of his own code — pointer-anchored zoom and
per-clip normalisation — are more useful to DSP-14 than the analogy would have been. Those
findings are the survey's only ones **read in source at a named revision** rather than
documented; that is stronger than a vendor's claim and still not the same as running it.

The zero in that first sentence is the survey's main weakness against AC#3. It is cheaply
fixed: running `git diff --color-moved` and `git range-diff` on two real DSpatch revisions, and
`difft` on one changed TypeScript file, would convert three entries to personally observed and
give DSP-14 a local baseline to compare its sketches against.
