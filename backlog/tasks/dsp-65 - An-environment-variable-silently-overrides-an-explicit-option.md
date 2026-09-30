---
id: DSP-65
title: An environment variable silently overrides an explicit option
status: To Do
assignee: []
created_date: '2026-09-19 16:53'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 15622
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on 19 September while diagnosing a test run that appeared to hang. A DSP-61 test failed with the sample project landing in %TEMP%/dspatch-pkg-converse instead of the root the test passed to the ChatService constructor. The cause was DSPATCH_CHAT_WORKSPACE left set in a shell from an earlier packaged trial: the environment won over an explicit constructor option, silently. With the variable cleared the same three tests pass in about three seconds. Nothing was wrong with the product behaviour under test, and that is the problem - a stray variable in a shell made a correct implementation look broken, and the failure pointed at the feature rather than at the environment. An explicit option should win over an ambient one, or the disagreement should be stated out loud when both are present. The same class of accident bit twice in one day: DSPATCH_PROBE left set made a scripted run refuse with a modes-fight-over-the-exit-code message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An explicit option passed by a caller is not silently overridden by an environment variable.
- [ ] #2 Where both are present, the choice is visible rather than silent.
<!-- AC:END -->

## Sharpened by the loop-definition work

<!-- SECTION:NOTES:BEGIN -->
Once a loop definition is chosen explicitly by name and origin (DSP-68 to DSP-70), an ambient environment variable quietly overriding it is a worse fault than it is today: the user will have pointed at something specific and been given something else. Same defect, higher stakes. Worth doing before a definition chooser ships rather than after.
<!-- SECTION:NOTES:END -->
