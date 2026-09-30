---
id: DSP-27
title: Make the chat window a workspace rather than a debug view
status: Review
assignee: []
created_date: '2026-09-17 18:45'
updated_date: '2026-09-18 09:42'
labels: []
dependencies:
  - DSP-26
priority: high
type: enhancement
ordinal: 15200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Niclas’s judgement after the Phase 0 walkthrough was that the window works but reads like one big debug window. The header carries session identifiers, full paths and context statistics that matter to whoever is debugging DSpatch and almost never to the person doing the work. The loop made that worse rather than better: a run now adds its own live log beside turns that already carry their own machinery.

This story is about attention, not decoration. What a person needs continuously is small; what they need occasionally is large; today both are permanently on screen at the same weight.

### The colours stay

The palette and base style are the visual starting point Niclas approved, and this story does not reopen them. Reorganising what is shown is not a licence to restyle what remains.

### Honesty about activity

A running agent should say what it is doing — reading files, running a command — from events the provider actually exposes. Invented thinking text is forbidden. An empty moment is better than a plausible fiction, and a product whose central claim is that work is traceable to real code cannot narrate work it did not observe.

Transient activity may collapse when the result arrives. What belongs to the run’s history must survive it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The top of the window is compressed to the project name, the relevant agent or model, connection status and current activity; session identifiers, full paths, detailed context statistics and technical explanation move into an expandable detail view, while important problems remain directly visible without expanding.
- [ ] #2 Enter sends the message and Shift+Enter inserts a line break, a visible send button remains, and the input is cleared only once the message has been accepted, so a refusal or a failed handoff leaves the text in place; the accepted mandate appears in the conversation.
- [ ] #3 Handoffs between agent roles or nodes are shown clearly, and both they and the agents final replies remain in the history.
- [ ] #4 A subdued running activity line describes what is happening, for example that the agent is reading files or that tests are running, using real events and whatever summaries the provider actually exposes; no thinking text is invented.
- [ ] #5 Transient activity may disappear or collapse when the result arrives, while the run history that matters is preserved, and the approved colour palette and base style are kept.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Call 006 Implementer addressed all five criteria, at 529 tests across 67 suites from a measured baseline of 498/62, 0 baseline test names absent, typecheck and tests exit 0, no provider turn, no commit or build. Five revert proofs, each failing on the user-visible assertion. **Unverified**, and every criterion here is **HUMAN_PENDING** by its nature: this card is Niclas's judgement after using the window, and no agent test substitutes for him using it again.

**No colour changed.** No custom property, no hue, no palette entry. The new CSS is layout only, reusing `var(--muted)`, `var(--line)` and `var(--panel)` — the same variables the cards it replaces were already using. The connection badge is the same rule with the same mapping.

**The header.** One line carrying project name, requested model, connection in a word, current activity; a collapsed `Session details` holding the paths, session ids, revision, context statistics, tool calls and the adapter sentence; and problems **outside** the expander. The distinction that matters in `headerProblems` is that a problem is not the same as an error: an unresolved attempt is not a failure and a lost save may have reported nothing, so both carry `severity: 'unknown'` rather than `'bad'`. A test enforces it, on the grounds that "nobody measured this" and "this went wrong" are different facts to someone deciding whether to run the work again.

**One problem got genuinely better rather than merely moving.** A save that did not finish leaves a temporary file, which is the only evidence the save was lost — and until now that evidence was rendered only inside the project chooser, visible to someone who went looking. It is now a header problem.

**The hazard the Implementer went looking for on its own.** `workflow-script.ts` reads the window by `data-ev` name, so renaming or dropping one of those eleven names would not fail a single test — it would make the scripted walkthrough silently record an empty string as a measurement. All eleven are preserved, and moving a fact behind the expander is safe because `textContent` reaches inside a closed `<details>`. `DETAIL_TEST_ID` now keeps the names attached to the facts with a comment saying why it must not be tidied away. **Reasoned, not run:** the script needs a window.

**The composer.** Enter sends, Shift+Enter and Alt+Enter break the line, Ctrl/Cmd+Enter still sends because someone has already learned it. Two cases live in the helper because a later tidy-up would break them: an IME composition never sends, since Enter there chooses the word and sending would take the message away mid-word from anyone typing a language that needs one; and a *blocked* send swallows Enter rather than turning it into a newline, because someone who pressed Enter meaning "send" did not mean "insert a line break in my mandate". The second is a judgement with a defensible alternative, and the reasoning is written into the code so it can be reversed knowingly.

**The clearing question open since 16 September is answered and now has a test, without a behaviour change:** `send()` already cleared only on the accepted path. `composerTextAfterSend` states that rule where it can be tested — refused, failed and superseded all leave the text exactly as typed. Named honestly by its author as a gap: the helper documents and tests the rule rather than being the code path, because routing `send()` through it would have disturbed the `sendGeneration` guard for no behavioural gain.

**Handoffs are drawn from the record**, from the replies' own node ids and recorded order, not from the graph and not from a renderer's idea of what the loop does — which is why they survive a restart with no extra persistence and no format change. The occurrence count is the part that earns its keep: implementer, verifier, implementer is the ordinary shape of rework, and two entries both labelled "Implementer" leave a reader unable to tell the second pass from the first. **A test fails if the words approved, passed, accepted or rejected ever appear in a handoff sentence** — whether the first node's work was any good is a different question, decided elsewhere and once. That test is the structural guard against this presentation layer quietly becoming a second opinion about a run.

**The activity line invents nothing, and shows less than the criterion imagines.** Its words come from exactly three places: a line already written from a recorded journal entry, `describeActivity`'s sentence built from real turn state, or one of two declared sentences about what DSpatch knows. A test enumerates every combination of flags and asserts the sentence is one it was given or one of the two declared ones, failing with *"the activity line said something no event said and DSpatch never declared"* — the assertion a later edit adding a friendly "Thinking about your request…" will trip over.

**What the adapter actually exposes is a tool name and nothing else** — never the arguments, never a file path. So the honest line is *"Running a tool (read_file). 2 of 3 tool calls have finished."* rather than the criterion's example of *"Reading src/main.ts"*. There is no thinking-text or reasoning-summary stream wired through the adapter, so nothing of that kind is shown. **An empty moment in the gaps is the correct output**, and this is the right answer to the criterion rather than a shortfall against it — but it is worth Niclas seeing before he judges #4.

**Dropped as instructed:** the optional diff-from-record wiring. It turned out not to be wiring at all — see [DSP-35](dsp-35%20-%20Open-a-diff-from-the-run-record.md).

**Two smaller things to know.** The `data-ev` index on replies now counts trail items, so `loop-turn-0-reply-2` is the second reply where it used to be `-reply-1`; nothing reads that selector, but it is a rename. And `Session details` does not remember being open, deliberately, since a detail view that remembers recreates the permanent dashboard — a guess about what Niclas wants, and worth asking him.

`app/dist/` still predates this entire run. Nobody has run any of this in an Electron window.

---

**Call 007 Verifier, on candidate-6 `sha256:b7830367…`, no drift at either end. Every testable half PASSES; every criterion remains HUMAN_PENDING by its nature, since this card is Niclas's judgement after using the window.** Nothing found should hold the package.

**The measurement-integrity check is the strongest evidence in the report, and it went further than call 006's own claim.** Call 006 preserved eleven `data-ev` names and reasoned about them; the Verifier resolved **all 62** the walkthrough reads, through five different paths — literal attributes, forwarded `testId` props, the `DETAIL_TEST_ID` table keyed by label, `HeaderProblem` ids, and a ternary on the active turn. **None is missing.** `workflow-script.ts` itself is byte-identical to before this run began, so the set of names the script asks for never moved.

**The detail worth keeping.** `DETAIL_TEST_ID` is keyed by the *label string*, so a single differing codepoint would return `undefined`, drop the attribute and blind the script with no test failing. All ten keys were compared at codepoint level against all ten produced labels: 10 mapped, 0 unmapped, 0 orphans — including `The agent's own tool calls`, whose apostrophe is U+2019 and is written as the `\u2019` escape on **both** sides. Had one side used a plain ASCII apostrophe, that fact would have gone dark and the walkthrough would have silently recorded an empty string as a measurement.

**`headerProblems` cannot misclassify, structurally.** Severity is fixed per slot rather than derived — connection, refusal and lost save are always `bad`; unresolved attempts and runs are always `unknown` — so there is no branch that could soften a real failure into "nobody measured this". The remaining risk is entirely at the call site, which was **not** verified and is recorded as such.

**No dead key.** `canSend` and `disabled` are exact logical complements, so Enter is swallowed exactly when the Send button is visibly disabled. There is no state where the key does nothing while the button looks ready. The small gap is the *explanation*: pressing Enter on a blocked composer produces no new sentence, only the disabled button and whatever panel caused the block. Right for an empty box, thinner for the others.

**No colour changed, confirmed at byte level.** All nine differences in `styles.css` are increased *counts* of properties that already existed; every palette definition is byte-identical to HEAD.

**A method note from this call that is worth more than any single finding.** Three of the Verifier's four comparisons initially produced confident wrong answers, and one "found" 21 defects that do not exist. `git show` in PowerShell writes UTF-16, so a baseline decoded as zero characters — and a file with no colours in it makes every colour look added. The log's tick mark is mojibake, so searching for the real character matched 0 of 596 lines. Two files encoded the same em dash differently, so twelve identical test names compared unequal. **Every comparison in the report now ships with a negative control that must report a deliberate breakage.** This is the second call in a row where a comparison that matched nothing looked exactly like a comparison that passed, and it should be the standing default for this kind of check.
<!-- SECTION:NOTES:END -->


## Superseded in part by INTERACTION_MODEL v1.3

<!-- SECTION:NOTES:BEGIN -->
This card made the chat window a workspace rather than a debug view, and the direction was right. Trying the packaged build on 19 September showed the answer went too far in one direction: the compact header became a **large project/model/connection summary card** that takes the space the conversation should have and keeps explaining things a person needs once.

v1.3 §9 replaces that answer, not the goal. The card goes; session details, identifiers, full paths and diagnostics move behind a conventional top application menu; model selection moves beside the composer. Project identity and access stay compact and reachable, and a connection problem that actually affects work stays visible in context.

Carried out by **DSP-60**. The parts of this card about Enter/Shift+Enter, the visible Send control, preserving typed text, the transient running line and the handoff trail are unaffected and still hold.
<!-- SECTION:NOTES:END -->
