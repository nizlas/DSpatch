# Pilot: does messaging between parallel branches improve the work?

DSP-227, 18 November 2026. A bounded pilot with real agents, not a general measurement. Raw journals, prompts and per-run summaries were kept outside the repository (the session's scratch folder); this page records what they show, with the evidence for each claim.

## Question

The simulated tests showed that messages between fan-out branches are sent, delivered at a check and acknowledged. They did not show that an agent uses what another branch found to do better work. The pilot asks that for one small, concrete case, comparing the same split with and without the mailbox tools.

## Set-up

- **Provider and login.** Claude, through DSpatch's own Claude adapter and run engine, with the login DSpatch already has on this computer (`claude-consent.json` in DSpatch's profile). The pilot ran in a clean environment (`env -i` with only `HOME`, `PATH`, `USER`, `LANG`, `TMPDIR`), so nothing from the developer's session reached the agents. Branches and the joiner ran with the medium class mapped to `sonnet` (reported as `claude-sonnet-5-5`). No account, setting or payment was changed.
- **Repository.** A synthetic Node project, `orders-kit` (`app/scripts/coordination-pilot/scenario/`), copied fresh and committed for each run, so every run starts from the same base. The README states the contract *amounts are in öre*. The detail the pilot is about is in the repository, not in any prompt: orders imported from the old till carry `"source": "till-v1"` and store whole kronor (`docs/data/import-notes.md`), and the bookkeeper's Q1 figures (`docs/accounting/2024-q1.md`) only reconcile if those amounts are multiplied by 100.
- **Graph.** Built with the reusable sections (`app/scripts/coordination-pilot/pilot.ts`): a lead proposes the split, a fan-out of two branches runs them in parallel in their own worktrees, a joiner merges and checks, at most 8 calls. The lead is **scripted**: it writes the same two slices every time, so every run starts from one identical split. The two branches and the joiner are real agents.
  - `monthly` (A): add `revenueByMonth(orders)` to `src/ledger.js`; its acceptance is to agree with the bookkeeper's figures. Doing that is what reveals the till-v1 rule.
  - `export` (B): add `ordersCsv(orders)` in `src/export.js` with a `TOTAL` row; its contract is the README's *amounts are in öre*.
  - The joiner merges the two temporary branches, runs `npm test`, and checks that the CSV's `TOTAL` equals the sum of `revenueByMonth` and the bookkeeper's quarter.
- **Variants.** `mailbox`: the branches are offered `send_message`, `check_messages` and `acknowledge_message` and told how they work. `none`: the same graph, prompts and split, without the tools and without the paragraph about them (an experiment control in the live executor, `branchMessaging: false`; the window never sets it).
- **Checks no agent saw.** After each run the pilot computed the true figures (407 940 öre for the quarter) and checked each temporary branch's own commit and the integrated working copy against them.

## What happened

All times are from the run journal. Branches always overlapped in time (both started within 0.2 s of each other and ran about 12–14 s).

### Round 0: a first version of the scenario (1 run, mailbox)

In the first version the till rule already lived in a shared function, `amountCents`, in `src/ledger.js`. The export branch read that file, used the function and was right without any message (none was sent). A detail that the receiver finds in the first file it opens cannot show what messaging adds, so the scenario was changed to the one above, where the rule has to be established by reconciling with the bookkeeper. That run also showed a fault in the scenario itself (its `npm test` script did not run on Node 24), fixed before the runs below.

### Round 1: the product as it was (1 run, mailbox)

- **A found the rule and told no one.** `monthly` reconciled with the bookkeeper, wrote the ×100 rule into `revenueByMonth`, and wrote in its own result that "a CSV export that reads `amount` directly will be wrong for those three orders". It never called `send_message`.
- **B got it wrong.** `export` used the stored amounts: its commit's `TOTAL` was 352 005 öre, not 407 940.
- **The joiner caught it.** It merged both, found the mismatch and chose `rework`. In the second round `export` fixed its total; the run then reached its call limit (6 in this first run) before the second round was integrated.
- **Cause.** A's prompt described only its own slice ("working in parallel with others"); it did not say which other branches there were or what they did, and it said when to *read* messages but not when to *send*. A had no way to know that its finding mattered to anyone.

**Fix 1 (DSP-227).** A branch's assignment now lists the other branches of the visit with their task and owned paths, and says to send a finding about the existing system or a shared contract to the branch whose task depends on it, as soon as it is established. No message text is suggested.

### Round 2: with the sibling list (2 runs per variant)

| Run | Variant | A sent | B's own commit | Delivered | Integrated result | Rework | Time | Output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mailbox-3 | mailbox | at 5.9 s, to `export` | correct | never | correct | none | 25.0 s | 9 930 |
| none-1 | none | — | correct | — | correct | none | 24.2 s | 8 818 |
| mailbox-4 | mailbox | at 6.2 s, to `export` | correct | never | correct | none | 26.3 s | 10 258 |
| none-2 | none | — | correct | — | correct | none | 23.5 s | 8 854 |

- **Both branches sent; nobody received.** In both mailbox runs each branch found the rule and sent it to the other within about 7 s (for example A: "orders with source "till-v1" … store amount in whole kronor, not öre as README says … Raw amounts would make your amount_ore and TOTAL wrong"). Both then ended without calling `check_messages`, and the journal records each message as `message-undelivered`.
- **B was right without the mail.** In all four runs B's own commit was correct before any message could have reached it. Its result says why: it read A's task in the sibling list, looked at the bookkeeper's figures and the import notes, and converted the till amounts itself. In the control variant it did the same.
- **So the gain came from shared context, not from messaging.** Knowing what the other branch was doing changed B's work (round 1 → round 2: wrong → right, no rework round). The mailbox added two sends and about 1 000–1 400 output tokens per run and changed nothing traceable.

**Fix 2 (DSP-227).** A branch that ends its turn while messages for it are still waiting is asked once, in the same session, to call `check_messages`, act on what concerns its slice and give its result again. Delivery is still at its own check; DSpatch only says something is waiting. This is not push delivery and not a new protocol.

The sibling list was also narrowed to each other branch's task and owned paths (not its contracts or acceptance), so a branch learns who works on what, not everything the others were told.

### Round 3: with the reminder, and the reconciliation only in A's acceptance (2 runs per variant)

| Run | Variant | Messages | B's first decision | Delivered to B | B's own commit | Integrated result | Rework | Time | Provider turns | Output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mailbox-5 | mailbox | B → A at 6.2 s; A → B at 6.8 s | "look like kronor … I am NOT converting" | 18.2 s, on the reminder turn; acknowledged 23.0 s | correct | correct | none | 37.0 s | 6 | 14 038 |
| none-3 | none | — | converts (found `import-notes.md` itself) | — | correct | correct | none | 25.7 s | 4 | 9 322 |
| mailbox-6 | mailbox | B → A at 5.9 s; A → B at 6.1 s | "Unconfirmed; I am not converting in export" | 10.2 s, in its first turn; acknowledged 17.4 s | correct | correct | none | 34.2 s | 6 | 12 584 |
| none-4 | none | — | converts (found `import-notes.md` itself) | — | correct | correct | none | 31.0 s | 4 | 11 858 |

- **The message changed B's work, traceably, in both mailbox runs.** In both, B noticed the odd amounts early, sent its suspicion to A and wrote that it would *not* convert. A, which had reconciled with the bookkeeper, sent the rule with its source. After delivery B converted, and said why: in mailbox-5 "the shipped-data test now expects a total of 407940 (it was 352005 before the conversion) … The monthly branch's message said these are stored in whole kronor. I confirmed that in `docs/data/import-notes.md`"; in mailbox-6 "The monthly branch reported that its figures only match the bookkeeper's Q1 numbers with this conversion. I did not check that against the bookkeeper's figures myself." The journal has each send, delivery and acknowledgement in that order, and the activity log shows B's `check_messages`, then edits and a test run, then `acknowledge_message`.
- **The reminder is what delivered it in mailbox-5.** B's first turn ended with the message unread; DSpatch's reminder turn (DSP-227) made it check, and the change followed. In mailbox-6 B checked during its first turn. Both branches took the reminder turn in both runs (6 provider turns against 4).
- **Without the mailbox, B investigated and was right anyway.** In both control runs B found `docs/data/import-notes.md` by itself and converted. In the mailbox runs B instead sent its suspicion and waited for the other branch to confirm it: the mailbox replaced part of its own investigation.

## Assessment

- **No better end result could be shown.** After the sibling list (fix 1), every run in both variants, eight in all, integrated a correct whole without a rework round. The one wrong result and the one rework round were in the run before fix 1, when the branch that found the rule did not know anyone needed it.
- **What made the clearest difference was shared context, not messaging.** Giving each branch its siblings' tasks and owned paths turned a wrong CSV and a rework round into a right CSV on the first round, in both variants.
- **Messaging did carry a decisive finding, and the receiver used it.** In both round-3 mailbox runs the receiving branch reversed an explicit decision because of the message, with the evidence in its result, its tests and the journal. But it would very probably have been right on its own: it was in all four control runs.
- **It cost something.** Against the control run beside it, a mailbox run took 1–3 s longer and used 13–16 % more output tokens in round 2, and 3–11 s longer with 6–51 % more output tokens in round 3, where the reminder adds a turn per branch. In round 2 the cost bought nothing, because the messages were never delivered.
- **It can stand in for checking.** With the mailbox available, the receiver twice deferred to the other branch ("unconfirmed; I am not converting") where, without it, it read the documentation itself. In mailbox-6 it took the rule on the sender's word ("I did not check that … myself"). The integrator's own check is what makes that safe.
- **Two faults were found and fixed.** A branch did not know who worked beside it, so it told no one (fix 1). Branches sent messages and ended without checking, so nothing was delivered (fix 2, the reminder turn). Both are fixed in this change, and round 3 shows both working: messages were sent to the right branch and delivered every time. Neither fix adds a new protocol or push delivery: the mailbox is unchanged, and delivery is still at `check_messages`.
- **This is a pilot.** It shows, for this scenario, that the mechanism can work end to end with real agents and that its value depends on whether the receiver would have found the detail itself. It is not evidence that messaging generally raises quality or speed. A case where the value could be larger, and is worth trying next, is one the receiver cannot reach from its own task, for example a detail found only by running the sender's part, or a larger repository.

## What is enforced, instructed and observed

- **Enforced by the engine:** branches start from one base in their own worktrees and sessions; the split's ownership and dependency rules; delivery only at `check_messages`; sent, delivered, acknowledged and undelivered recorded apart; one reminder turn when messages are waiting at the end of a turn (DSP-227); the joiner gets every branch's result and the messages with their delivery.
- **Instructed, not enforced:** when to send and when to check; acting on a message; the joiner's merge, checks and choice of outcome.
- **Observed in these runs:** what is in the tables above, for this scenario, with this model, on this computer.

## Limits of this pilot

- Ten real runs of one small scenario with one model: one on the first version of the scenario, one before the fixes, four with the sibling list and four with the reminder as well. Two further attempts stopped before any agent started, from faults in the pilot script. It is a pilot, not evidence that messaging generally improves quality or speed.
- The lead was scripted, so how a real lead splits work was not part of the comparison.
- The repository is small enough that a careful agent can find most details by reading; in a larger system the balance between finding something yourself and being told may differ.
- Time and tokens are as the adapter reported them; no cost in money was read.
