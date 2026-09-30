---
id: DSP-103
title: A routing name that only works when spelled a particular way
status: Done
assignee: []
created_date: '2026-09-22 21:42'
updated_date: '2026-09-30 19:35'
labels:
  - loop graph
dependencies: []
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during DSP-102. A node that declares outcomes and whose reply names none gets a graceful route only if one of its outcomes happens to be spelled unclear or could-not-check, the two literals UNCLEAR_OUTCOME and COULD_NOT_CHECK_OUTCOME in app/src/shared/loop-chat.ts. Any other spelling of the same idea faults the run instead. The node panel does not say this, so a person drawing a loop cannot discover it without reading the prompt builder. AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 2 requires every instruction and control DSpatch introduces to be explicit and inspectable, and a name whose spelling silently changes the routing is neither. The honest version is a declared field, an explicit whenUndeclared naming an outcome id or a marked entry in outcomes, which is a change to the general routing contract and needs Niclas's decision before anyone writes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Which outcome a node routes to when its reply declares none is stated in the drawing rather than inferred from how an outcome is spelled
- [x] #2 The node inspection shows it
- [x] #3 Existing drawings keep their present behaviour, or the change to them is deliberate and reported
- [x] #4 A node's ordinary reply remains its result where the node declares no outcomes, and the intended handling of an empty reply is preserved
- [x] #5 A structured record distinguishes an outcome the agent declared from one the engine selected as the fallback, and a step that consumes the result is told which it was
- [x] #6 The supplied graphs are migrated and the compatibility implication for a drawing that relied on the old spelling is visible rather than silent
- [x] #7 In the supplied development graph the node using the researcher role declares answered and not-established, both returning to the implementer
- [x] #8 An absent provenance on a record written before this change is represented as unknown rather than as an agent declaration
- [x] #9 A newly produced outcome carries explicit provenance, including for non-agent producers, without a gate or router result being described as an agent declaration
- [x] #10 No provenance is inferred from the prose of an earlier reply and no historical record is rewritten to manufacture certainty
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Provenance correction, 30 September, after Niclas caught the first version. OutcomeSource was two values with an absent field meaning step-declared; it is now six with an absent field meaning unknown, and the rule lives in exactly two readers, provenanceOf in loop-run.ts for a product in flight and outcomeProvenance in loop-results.ts for a record read back. ProducedOutcome.source became optional, which is the type admitting an old record has no answer, and outcomeProvenance is its only reader so no caller can pick a friendlier default. The vocabulary, taken from the code rather than forcing non-agent producers into the agent's word: step-declared where the reply carried the whole-line RESULT form, engine-fallback where the reply declared nothing and whenUndeclared says where that goes, gate-verdict for a gate's own result from an exit code or from having no command, router-branch for a router taking the first of its configured outcomes, dry-run for the executor standing in for a step, and unknown where nobody recorded it. Carried through the stored RecordedResult, the journal's node-produced sentence and structured outcomeSource, and describeReceivedResults, which needed the most care: it compared against step-declared with everything else falling into the engine's sentence, so an unrecorded provenance would have been read out to the next step as that step named no result, a definite claim about a record that makes none. Each value now has its own sentence and the unknown one says the record does not say who chose the name. No provenance is inferred from any stored body; describeProducedOutcome is the only reader of a record's outcome in app/src and looks at source alone. No historical record is rewritten, and a test asserts a record handed in without source still has none after being read. Where the behaviour is defined: all of it is Maestro's general execution rules, with node configuration deciding whether there is an outcome at all and whether a declaring-nothing reply has a route, and node configuration plus graph connections deciding whether a step is told another step's provenance. Coordinator re-ran the whole suite after handover, 49 files, exit 0. All evidence is deterministic tests; the unknown clause is unreachable from any producer this build ships and is exercised by a fixture that omits the field on purpose.
<!-- SECTION:NOTES:END -->
