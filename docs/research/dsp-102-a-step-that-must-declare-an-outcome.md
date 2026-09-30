# DSP-102 — A step that must declare an outcome, and what the contract can already say

Investigation only. No code, graph, role text or backlog was changed by it. The material is the code and the drawings in this working copy as they stood after DSP-99, DSP-100 and DSP-101 landed.

**The headline: the difference is expressible today, it is already expressed, and the fix needs no change to the general routing.** The graph has a field whose whole meaning is *this step must name its result*, and the runner already refuses to let a node carrying it finish on plain success. What went wrong on 22 September is that the runnable loop's drawing does not carry that field on the implementer or the verifier — so for those two nodes "your ordinary reply is your result" is not an oversight in the machinery, it is the contract, and the prompt says so in as many words.

## 1 Which nodes require a declaration and which do not

The field is `outcomes`, and it is load-bearing in three places. The type says it:

```513:518:app/src/shared/loop-graph.ts
 * The named outcomes this node may produce — a router's branches, a gate's verdicts.
 *
 * what lets the editor offer the real choices. A node that declares outcomes routes
 * only on them, never on plain success.
 */
  readonly outcomes?: readonly string[];
```

The runner enforces it:

```909:913:app/src/shared/loop-run.ts
  if (product.kind === 'success' && (node.outcomes ?? []).length > 0) {
    return `"${node.id}" declares outcomes and may not finish on plain success. It declares ${(
      node.outcomes ?? []
    ).join(', ')}.`;
  }
```

That string becomes the runtime fault `undeclared-product`. Validation forbids the ambiguous middle: a node cannot both declare outcomes and keep a plain-success edge (`success-edge-on-a-branching-node`), every declared outcome must have an edge (`unrouted-outcome`), and so must every declared failure (`unrouted-declared-failure`).

`declaredFailures` is a different field and requires nothing. It is an exception channel: these names route if the step uses one, and its absence is not an absence of a result.

| Graph · node | `outcomes` | `declaredFailures` | Must declare? |
| --- | --- | --- | --- |
| runnable · `coordinator` | — | spec-error, blocked | No |
| runnable · `implementer` | — | spec-error, research-needed, blocked | No |
| runnable · `researcher` | — | spec-error, blocked | No |
| runnable · `verifier` | — | blocked | No |
| runnable · `implementation-review` | accept, rework, needs-decision | — | **Yes** |
| runnable · `coordinator-report` | — | — | No |
| chat-loop · `work` | succeeded, unclear | spec-error, blocked | **Yes** |
| chat-loop · `check` | met, not-met, could-not-check | spec-error, blocked | **Yes** |
| live-duration · agent node | — | spec-error, blocked | No |
| live-duration · gate | pass, fail | — | **Yes** |

The loop has both kinds on purpose, and the deliberate cases are identifiable rather than assumed. The verifier's silence on `outcomes` is written down twice: its `produces` note asks for "PASS / FAIL / NOT_RUN per claim" *in its report*, and the reasoning in `carriesRunChange` says "the verifier's PASS/FAIL lives in its report, not in its outcome list", because a FAIL still goes to the reviewer, who reads the account and the evidence together. The verifier having no *branch* is correct. `coordinator-report` is deliberate too, and it is DSP-97's subject.

## 2 Why the two replies routed as success

Not a hole in the reading of the reply. `productFromAssistantText` is thorough and ordered: empty text, then a first-word `SPEC_ERROR` or `BLOCKED`, then a whole-line `RESULT: <declared failure>`, then a whole-line `RESULT: <declared outcome>`, then the cheap fallback, then `success`. For a node with no `outcomes` the last three cannot fire, because the allowed list is empty. **Success is the residual**: anything that is not a recognised failure declaration is a completed step.

The step is told exactly that. The implementer's message carried, verbatim:

> If the premise is wrong, begin your reply with the word SPEC_ERROR, then a sentence.
> If you cannot do the work, begin your reply with the word BLOCKED, then a sentence.
>
> This step has no verdict to name: **doing the work is the answer, and a step that finished writes no such line.** Write one only if you could not complete the step at all, in the same form, using one of these names:
> RESULT: spec-error
> RESULT: research-needed
> RESULT: blocked

The verifier's was the same with only `BLOCKED` and `RESULT: blocked`. Neither role file mentions a `RESULT` line or either opening word; of the role sources only `project-work`, `project-check` and the run coordinator do. The engine text is the whole of what those two steps were taught.

**So the implementer did not break its contract.** It was told a step which finished writes no line, it wrote no line, and the run read a finished step. The verifier did break its contract, since it was offered two forms and used neither, but the run had no way to notice, because the contract defines its compliance negatively. The reviewer could not have got away with the same thing: it declares outcomes, so a reply with no `RESULT` line would have faulted the run. The asymmetry Niclas saw is the asymmetry in the drawing.

## 3 The smallest change, and it is in the drawing

Because `outcomes` already means "must declare", making a step declare is a graph edit. Because `undeclaredReadableOutcome` already gives such a node a route for a reply that declared nothing, the edit need not end the run:

```643:661:app/src/shared/loop-chat.ts
export function undeclaredReadableOutcome(
  declared: readonly string[],
): { readonly outcome: string; readonly why: string } | null {
  if (declared.includes(UNCLEAR_OUTCOME)) {
    return {
      outcome: UNCLEAR_OUTCOME,
      why:
        `The reply did not declare a readable RESULT for this step, so the run treats ` +
        `the work as unclear rather than guessing.`,
    };
  }
  if (declared.includes(COULD_NOT_CHECK_OUTCOME)) {
```

Three graded behaviours are available per node today, with no code change.

1. **No `outcomes`.** The reply is the result. Today's permissive contract, kept where it is wanted.
2. **`outcomes` plus a name for "not established".** A reply that declares nothing routes on that name, down an edge the author drew, to an ending the author chose. Nothing faults. The chat loop already does this: `work` draws `unclear` → `not-established`, `check` draws `could-not-check` → `not-established`.
3. **`outcomes` with no such name.** A reply that declares nothing is the runtime fault `undeclared-product`, and under `stop-and-reconcile` the run stops. This is what the reviewer already gets.

The edit for the runnable loop, in full:

| Node | add `outcomes` | edge change |
| --- | --- | --- |
| `coordinator` | `["briefed", "unclear"]` | `e01` → `on: outcome, outcome: briefed`; new edge `unclear` → `stopped` |
| `implementer` | `["done", "unclear"]` | `e02` → `on: outcome, outcome: done`; new edge `unclear` → `stopped` |
| `verifier` | `["checked", "could-not-check"]` | `e09` → `on: outcome, outcome: checked`; new edge `could-not-check` → `stopped` |

Four mechanics, each checked. **The success name must come first**, because an unscripted dry run takes `declared[0]` and the existing dry-run check that this graph reaches `delivered` would otherwise start ending at `stopped`. **A single-outcome node validates** — the minimum of two applies only to `router` and `gate` kinds — so one outcome and one edge is a legal "required signature" that changes no topology. **The fallback names are the literal strings `unclear` and `could-not-check`**, and nothing else gets the graceful path. **The prompt updates itself**, since `outcomeInstructions` switches to its verdict branch off the same field and both the prompt and the node panel read that one function.

`researcher` and `coordinator-report` are deliberately left out, the first as the cheapest case to leave alone and the second as DSP-97's own subject.

## 4 What it costs and what it refuses

**What it refuses, by construction.** The verifier's bold **BLOCKED** in the middle of its reply stays unread, and that is the point rather than a residual gap. Nothing here scans prose for a token and nothing asks a model what a reply meant. The mechanism fires on the *absence* of a whole-line form the prompt asked for, so it needs no opinion about the text that is there. A question, a bold refusal and a polite essay are the same thing to it: no declaration.

**What stopping costs.** With behaviour 3 a run halts at step two because a model phrased its blocker as a question, and the sentence a person reads is `"implementer" declares outcomes and may not finish on plain success`, which sounds like a wiring error rather than "your agent asked a question". The recorded outcome is `unresolved` with a neutral badge, which is honest. One cost does not apply: the step's report is filed before the check runs, so the question or the prose refusal survives in storage and a person reads the actual words. Nothing is repeated, and the calls already spent were spent either way.

**What not stopping costs, measured.** DSP-98 trail two is the measurement: two non-results filed as results, a reviewer demanding animation infrastructure nobody had been asked for, an implementer reading its own re-prompt as an answer, and a hand cancellation 59 seconds into a document hunt. The real comparison is not stop versus finish. It is **stop at step two with a readable question, versus stop at step five with a false review, three more billed calls and a record that says work was delivered.**

**Hence behaviour 2 as the recommendation.** With a drawn `unclear` route a non-declaring implementer does not halt the machinery: it ends at `stopped`, whose purpose already says "This is not a failure of the project and not a pass", with its own question filed as the reason. That is a routed decision, not a fault. And because the choice is per node, the drawing can be strict where stopping is cheap and permissive where it is expensive, without the general routing changing at all.

## 5 How this meets DSP-97, and the one question for Niclas

DSP-97 already names this collision: *"The same gap exists on implementation-review, which also declares no failures, so a blocked reviewer today ends the run as an undeclared-product runtime fault; whether both get a route, and whether they share one, is the same decision."* The shared question is which ending a step that cannot answer routes to, and DSP-102 must not settle it in passing.

Three things keep it out of the way. It reuses the existing `stopped` terminal, which already has an `ending` of `not-success` and already receives seven edges, so the vocabulary of endings is unchanged. It reads no report body and relabels nothing, which DSP-97's criteria forbid. And it shrinks DSP-97's question rather than pre-empting it.

One wrinkle is honest to state: `stopped`'s purpose names two causes, "the premise was wrong or the work was blocked", and neither is "did not answer in a form the run could route". Two ways to handle it, and this is the decision to put to Niclas rather than answer here. Either DSP-102 adds the clause and says so loudly, or DSP-102 ships the stricter behaviour 3 on `coordinator`, `implementer` and `verifier` — making them behave as the reviewer already does — and DSP-97 then decides once, for all four nodes, whether that hard stop becomes a routed terminal and whether they share it. The second is cleaner coordination. What DSP-102 can deliver either way is the mechanism and the finding; what it must not deliver is a new ending nobody chose.

## 6 DSP-101's changes, checked rather than assumed

They did not alter what any step is offered in the way of declarations. `declarationInstructions` and `outcomeInstructions` are keyed strictly off `node.declaredFailures` and `node.outcomes` and read nothing else; the runnable graph declares `outcomes` only on `implementation-review`; and none of the five DSpatch role sources DSP-101 edited mentions `RESULT`, `SPEC_ERROR` or `BLOCKED`.

**But there is a real interaction, running the other way.** DSP-101 widened what a finished step may look like: the implementer's purpose now says "a step that correctly changes nothing has finished its work, not skipped it", and its `produces` note asks for "the change you made, or the answer, analysis or activity the brief asked for instead". That is right, and it enlarges the set of replies indistinguishable from a question under a contract where success is the residual. DSP-101 did not weaken the mechanism; it made the mechanism's blind spot bigger, which strengthens the case for a positive signature rather than an inferred one.

## 7 Two smaller defects found on the way

Filed separately rather than folded in.

**The graceful fallback is keyed to two hard-coded literal names.** `UNCLEAR_OUTCOME = 'unclear'` and `COULD_NOT_CHECK_OUTCOME = 'could-not-check'` mean a drawing gets the "declared nothing" route only if it happens to spell its outcome one of those two words, and the node panel does not say so. `AGENT_BEHAVIOUR_AND_ORCHESTRATION.md` §2 requires every instruction and control DSpatch introduces to be explicit and inspectable; a name whose spelling silently changes the routing is neither. The honest version is a declared field, which is a change to the general routing contract and needs Niclas's go-ahead.

**One sentence in the prompt is untrue for the nodes that receive it.** `outcomeInstructions` tells a node with no verdicts: "Do not invent a name: any other name on such a line is read as a result nobody can route." For a node with no `outcomes` an invented name is read as **plain success**. DSP-91's walk 1 recorded this happening and called it harmless; it is harmless, but the message promises a stricter machine than exists, which is the same class of defect as promising an attachment the message does not carry.

## 8 Evidence status and the smallest probe

**Established from the working copy:** the tables above, the enforcement sites, the validation rules, the prompt text both steps received, the filing-before-fault ordering, the dry-run `declared[0]` behaviour, and the absence of any `RESULT` instruction in the five DSpatch role sources.

**Inference, marked as such:** that DSP-101 left the declaration offer byte-identical. It follows from the mechanism and from DSP-101's notes, but it is not a diff. No shell was available in that session, so nothing was executed and every claim is from reading files.

**Not established:** whether a stronger model declares reliably when asked for a line. DSP-98's finding that three of five calls deviated with correct instructions in place points at `claude-haiku-4-5` capability, and nothing here measures it.

**The smallest probe, spending no provider call.** A dry run of the edited graph with `createDryRunExecutor`, scripting the implementer to `{kind:'success'}` — precisely what a reply with no declared line produces — and asserting the run routes to the drawn `unclear` edge and `stopped` rather than to `verifier`, with the step's result still filed. One test against existing fixture machinery, no provider and no new infrastructure. The graph edit should wait until §5's question is answered.
