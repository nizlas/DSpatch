---
id: "DSP-3"
title: "Avbryt och återhämta en chattkörning begripligt"
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

Niclas tidigare agentloop kunde fastna vid misslyckade verktygsanrop. Redan första chatten ska visa ett verkligt körläge och en begriplig väg vidare, så att användaren slipper gissa eller starta om hela gränssnittet.

### Avgränsning och föreslagen väg

Fördjupa Avbryt och hantera tappad anslutning, nekad åtkomst, leverantörsfel samt lång väntan. Skilj mellan väntande, avbrytning begärd, faktiskt stoppad och okänt utfall. Definiera ett begränsat väntande och motiverade tidsgränser för anslutning och återförsök; normal lång modellbearbetning ska inte förväxlas med ett konstaterat fel.

Ge synliga handlingar som Försök igen eller Återanslut där de passar. Bevara text och det svar som redan kommit. Ett nytt försök får ett eget försök-ID; återanslutning ska först klarlägga tidigare läge och får inte automatiskt dubblera ett modelljobb med okänt utfall. Bygg bara det som behövs för den första anslutningen, med redovisade begränsningar för fjärranrop.

### Verifiering

Prova avbrott mitt i ett svar, sent svar efter avbrott, nekad åtkomst och avbruten anslutning. Kontrollerade fel får simuleras för reproducerbarhet, men redovisa även ett verkligt avbrott mot leverantören. Spara vad som observerades och vilken revision som provades.

### Underlag

[VISION.md, avsnitt 2.1, 13 och 14](../../docs/VISION.md#13-tillförlitlighet-och-kontroll).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Avbryt skiljer begäran från bekräftat stopp och visar eventuella kvarvarande processer eller fjärranrop.
- [ ] #2 Anslutningsfel, åtkomstfel och lång väntan ger en begriplig status och en synlig tillämplig åtgärd.
- [ ] #3 Inmatad text och mottagna svar överlever fel och återförsök inom den öppna arbetsytan.
- [ ] #4 Oklara tidigare utfall avstäms innan en åtgärd upprepas; sena händelser kan inte göra en annan körning klar eller skapa dubbletter.
- [ ] #5 Fel- och avbrottsscenarier är verifierade med tydlig skillnad mellan simulerade fel och faktiska leverantörsanrop.
<!-- AC:END -->
