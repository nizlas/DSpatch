# Första provet av utvecklingsloopen

Detta körs som DSP-7 på Niclas dator i Cursor. Syftet är att prova verkliga specialistanrop, platt samordning och återupptagning samt att bedöma planeringskvalitet på riktigt DSpatch-underlag. Ett tekniskt rökprov är inte bevis för att framtida planering blir bra.

## Första passet

Starta `/dspatch-loop calibrate` i huvudchatten.

Koordinatorn ska:

1. Kontrollera att de fem specialistnamnen finns tillgängliga. Notera Cursor-version och valt modellnamn om dessa kan läsas; gissa inte saknade värden. Kontrollera Git och Python. Kör `python -m unittest discover -s tests -p "test_loop_snapshot.py"` för hjälpverktyget.
2. Skapa en ny körjournal. Ange DSP-7 och en lokal artefaktkatalog som enda skrivområde för kalibreringsuppdragen. Produktkod och DSP-1:s kriterier ska inte ändras av specialisterna.
3. Anropa **Backlog Planner** med faktisk VISION, BACKLOG, DSP-1 och relevanta användarbeslut. Begär en begriplig plan för DSP-1:s första teknikprov: nytta, avgränsning, ordning, osäkerheter och verifiering. Begär förslag till ändringar bara om det finns ett konkret skäl; skapa inte nya tickets för att fylla provet.
4. Anropa **Reviewer i planläge** på förslaget. Spara båda rapporterna och presentera den korta planen för Niclas. Grundläggande brister får ett avgränsat omtag inom passets räknare. Niclas bedömning kan lämnas efter det tekniska provet; ingen produktimplementation startas här.
5. Anropa **Researcher** för en smal fråga: kontrollera i aktuell officiell Cursor-dokumentation vad de fem agenternas `readonly` och `model: inherit` innebär och redovisa vad dokumentationen inte bevisar om den lokala körningen. Läsande uppdrag, ingen installation eller debiterad SDK-probe.
6. Skapa ett separat lokalt Git-repo under `.dspatch-loop/runs/<run-id>/probe/`, med lokal testidentitet för dess enda bascommit. Det får inte ha någon remote. Lägg in `example.py` med funktionen nedan och `test_example.py` med testfallet nedan.
7. Anropa **Implementer** i detta provrepo. Uppdrag: få `sum_numbers` att summera heltal representerade som strängar, och bevara anroparens indata. Bara `example.py` får ändras; testet får läsas och köras. Ingen delegering eller Git-commit ingår.
8. Spara rapporten, kontrollera ändringen och fånga provrepots kandidat med `scripts/loop_snapshot.py --repo <probe> --output <probe>/.dspatch-loop/candidate.json` från DSpatchs rot. Spara absolut provsökväg och kandidatens referens i journalen.
9. Pausa med status PAUSED och nästa steg ”Verifier på sparad kandidat”. Spara att Implementer är klar och kontrollera att inga provprocesser fortfarande kör. Be Niclas fortsätta i en ny huvudchatt med resume. Detta är en avsiktlig paus för att prova kontextåterställning, inte ett simulerat godkänt avbrott mitt i en extern tjänst.

Basfil `example.py`:

```python
def sum_numbers(values):
    return "".join(values)
```

Testfil `test_example.py`:

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

## Återuppta i en ny huvudchatt

Skriv `/dspatch-loop resume`.

Koordinatorn ska läsa den befintliga journalen och bekräfta faktiskt provrepo och kandidat. **Implementer ska inte anropas igen för det redan genomförda steget.**

Anropa **Verifier** på den sparade kandidaten. Kör `python -m unittest discover -s . -p "test_example.py"` i provrepot och kontrollera snapshot före och efter. Verifier får skapa normala ignorerade testartefakter men inte ändra källkod eller tester. Provrepots bascommit ska därför även ha en enkel `.gitignore` för `__pycache__/` och `.dspatch-loop/`.

Anropa sedan **Reviewer i implementationsläge** på samma kandidat, verklig diff och verifieringsrapport. Eventuella fynd går genom de vanliga omtagsreglerna. Koordinatorn redovisar verkliga agentanrop och referenser, resultat, ofullständiga delar samt att detta gäller ett litet lokalt prov.

## Bedömning och fortsatt arbete

Niclas bedömer planöversikten för DSP-1: är nästa steg begripligt, relevant och lagom avgränsat? Dokumentera både första förslaget och korrigeringarna. Skilj ny produktstyrning från logiska luckor eller glömda beslut.

DSP-7 är klar när dess faktiska tekniska kriterier och Niclas planbedömning är uppfyllda. Ett saknat subagentverktyg, misslyckad överlämning eller nödvändigt omtag ska synas. Först därefter startas DSP-1 genom ett eget avgränsat uppdrag. DSP-1 testar den riktiga anslutningen för DSpatch-produkten; kalibreringen ersätter inte det provet.
