---
id: "DSP-3"
title: "Avbryt och återhämta agent- och testkörningar begripligt"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["reliability", "ui"]
milestone: "m-0"
dependencies: ["DSP-2"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Niclas tidigare agentloop kunde fastna vid misslyckade verktygsanrop. Första arbetsytan ska visa ett verkligt körläge och en begriplig väg vidare, även när agenten hunnit ändra filer eller starta ett bygge eller test.

### Avgränsning och föreslagen väg

Fördjupa Avbryt och hantera tappad anslutning, nekad fil- eller verktygsåtkomst, leverantörsfel samt lång väntan. Skilj mellan väntande, avbrytning begärd, faktiskt stoppad och okänt utfall. Definiera motiverade tidsgränser och begränsade återförsök; normal lång bearbetning ska inte förväxlas med ett konstaterat fel.

Ge synliga handlingar som Försök igen eller Återanslut där de passar. Bevara inmatad text, mottagna svar, redan producerade filändringar och körloggar. Efter avbrott ska användaren kunna granska det partiella resultatet. Ett avbrott får inte göra en automatisk återställning som raderar användarens eller agentens arbete.

Agentens stopp och lokala underprocessers stopp ska följas var för sig. Stoppade eller avbrutna tester ska aldrig visas som godkända. Visa eventuella kvarvarande processer eller fjärranrop och en konkret väg vidare.

Ett nytt försök får ett eget försök-ID. Återanslutning ska först klarlägga tidigare läge, verkliga filändringar och kommandots utfall. Den får inte automatiskt dubblera ett modelljobb, återapplicera en ändring eller köra ett kommando på nytt när utfallet är okänt. Bygg bara det som behövs för den första anslutningen och redovisa dess begränsningar.

### Verifiering

Prova avbrott under strömning, efter en filändring och under ett bygge/test, samt sent svar efter avbrott, nekad åtkomst och tappad anslutning efter ett verktygsanrop. Kontrollera att ändringar och loggar finns kvar och att upprepning inte sker på grund av ett oklart utfall. Kontrollerade fel får simuleras för reproducerbarhet, men redovisa även ett verkligt avbrott mot leverantören och en verklig lokal process. Spara observerade resultat och testad version.

### Underlag

[VISION.md, avsnitt 2.1, 13 och 14](../../docs/VISION.md#13-tillförlitlighet-och-kontroll).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Avbryt skiljer begäran från bekräftat stopp för agent och lokala underprocesser; eventuella kvarvarande processer eller fjärranrop framgår.
- [ ] #2 Anslutningsfel, åtkomstfel och lång väntan ger en begriplig status och en synlig tillämplig åtgärd.
- [ ] #3 Inmatad text, mottagna svar, redan gjorda filändringar och körloggar överlever fel och återförsök inom den öppna arbetsytan; det partiella resultatet går att granska.
- [ ] #4 Oklara tidigare utfall avstäms innan en åtgärd upprepas. Ingen ändring återappliceras och inget kommando dubbelstartas automatiskt; sena händelser kan inte göra en annan körning klar.
- [ ] #5 Fel- och avbrottsscenarier omfattar strömning, filändring och bygge/test, med tydlig skillnad mellan simulerade fel och faktiska leverantörs- och processkörningar.
- [ ] #6 Ett avbrutet eller ofullständigt bygge/test visas som avbrutet eller oklart, och får inte ge godkänd teststatus.
<!-- AC:END -->
