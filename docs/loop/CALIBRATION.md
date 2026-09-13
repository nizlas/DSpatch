<a id="första-provet-av-utvecklingsloopen"></a>

# Initial development-loop probe

Run this as DSP-7 on Niclas's computer in Cursor. It tests real specialist calls, flat coordination and recovery, and assesses planning quality using actual DSpatch material. A technical smoke test does not prove future planning quality.

<a id="första-passet"></a>

## First run

Enter `/dspatch-loop calibrate` in the main chat.

The coordinator must:

1. Check that all five specialist names are available. Record the Cursor version and selected model name if readable; do not guess missing values. Check Git and Python. Run `python -m unittest discover -s tests -p "test_loop_snapshot.py"` for the helper tool.
2. Create a new run journal. Specify DSP-7 and a local artifact directory as the only write location for calibration assignments. Specialists must not change product code or DSP-1's criteria.
3. Call **Backlog Planner** with the actual VISION, BACKLOG, DSP-1 and relevant user decisions. Request an understandable plan for DSP-1's first technical probe: value, scope, order, uncertainties and verification. Request changes only for a concrete reason; do not create tickets merely to fill the probe.
4. Call **Reviewer in plan mode** on the proposal. Save both reports and present the short plan to Niclas. Fundamental defects receive bounded rework within the run's counters. Niclas may assess it after the technical probe; no product implementation starts here.
5. Call **Researcher** for a narrow question: check current official Cursor documentation for the meaning of the five agents' `readonly` and `model: inherit`, and report what documentation does not prove about local execution. Read-only assignment, no installation or billed SDK probe.
6. Create a separate local Git repository under `.dspatch-loop/runs/<run-id>/probe/`, with a local test identity for its only base commit. It must have no remote. Add `example.py` with the function below and `test_example.py` with the test below.
7. Call **Implementer** in this probe repository. Assignment: make `sum_numbers` sum integers represented as strings while preserving the caller's input. Only `example.py` may change; the test may be read and run. No delegation or Git commit is included.
8. Save the report, check the change and capture the probe candidate using `scripts/loop_snapshot.py --repo <probe> --output <probe>/.dspatch-loop/candidate.json` from DSpatch's root. Save the absolute probe path and candidate reference in the journal.
9. Pause with status PAUSED and next step “Verifier on saved candidate”. Record Implementer as complete and check that no probe processes remain running. Ask Niclas to continue in a new main chat with resume. This deliberate pause tests context restoration; it is not a simulated successful interruption inside an external service.

Base file `example.py`:

```python
def sum_numbers(values):
    return "".join(values)
```

Test file `test_example.py`:

```python
import unittest
from example import sum_numbers


class SumNumbersTests(unittest.TestCase):
    def test_sum_and_preserved_input(self):
        values = ["2", "3", "-1"]
        self.assertEqual(sum_numbers(values), 4)
        self.assertEqual(values, ["2", "3", "-1"])
        self.assertEqual(sum_numbers([]), 0)
```

<a id="återuppta-i-en-ny-huvudchatt"></a>

## Resume in a new main chat

Enter `/dspatch-loop resume`.

The coordinator must read the existing journal and confirm the actual probe repository and candidate. **Do not call Implementer again for the already completed step.**

Call **Verifier** on the saved candidate. Run `python -m unittest discover -s . -p "test_example.py"` in the probe repository and check the snapshot before and after. Verifier may create normal ignored test artifacts but may not change source code or tests. The probe repository's base commit must therefore include a simple `.gitignore` for `__pycache__/` and `.dspatch-loop/`.

Then call **Reviewer in implementation mode** on the same candidate, actual diff and verification report. Process findings through the normal rework rules. The coordinator reports actual agent calls and references, results, incomplete parts and the limited scope of this small local probe.

<a id="bedömning-och-fortsatt-arbete"></a>

## Assessment and further work

Niclas assesses the DSP-1 plan overview: is the next step understandable, relevant and appropriately bounded? Document the first proposal and its corrections. Distinguish new product direction from logical gaps or forgotten decisions.

DSP-7 is complete when its actual technical criteria and Niclas's plan assessment are satisfied. Missing subagent tools, failed handoffs or necessary rework must be visible. Only then start DSP-1 as a separate bounded assignment. DSP-1 tests the real connection for the DSpatch product; calibration does not replace that probe.
