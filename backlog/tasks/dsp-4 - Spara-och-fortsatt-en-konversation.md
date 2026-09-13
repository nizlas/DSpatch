---
id: "DSP-4"
title: "Spara och fortsätt projektets konversation efter omstart"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["storage"]
milestone: "m-0"
dependencies: ["DSP-2"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

En användbar projektchatt måste kunna fortsätta över flera sessioner. Niclas ska kunna stänga DSpatch, öppna det igen och hitta rätt projekt och konversation utan att klistra in historiken för hand.

### Avgränsning och föreslagen väg

Välj enkel lokal lagring för konversations-ID, projektkoppling, meddelanden och den körinformation som behövs nu. Versionsmärk formatet och dokumentera var data sparas samt hur en konversation exporteras. Håll sparad historik skild från en aktiv leverantörsprocess; en appomstart får inte starta om ett gammalt uppdrag automatiskt.

Använd leverantörens återupptagning om den fungerar i den valda anslutningen. Om en ny session måste skapas: visa det och beskriv vilken sparad kontext som faktiskt återförs. En synlig gammal chatt är inte bevis för att modellen har fått samma sammanhang. Lagra inga autentiseringshemligheter i konversationsfiler eller Git.

### Verifiering

Stäng efter en vanlig följdfråga, öppna igen och fortsätt resonemanget. Prova även appavbrott mitt i ett svar samt skadat eller äldre sparformat. Bevara läsbart underlag och ge en tydlig återhämtningsväg vid fel. Synka med DSP-3:s körstatus om båda stegen har ändrat den.

### Underlag

[VISION.md, avsnitt 8–9, 13 och 14](../../docs/VISION.md#9-arkitektur-och-projektets-data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Projektkoppling och konversation med meddelandeordning finns kvar efter en normal omstart.
- [ ] #2 En följdfråga efter omstart får relevant sparad kontext; eventuell ny leverantörssession och dess begränsningar framgår.
- [ ] #3 Ett avbrutet pågående svar återställs som avbrutet eller oklart tills det avstämts; tidigare arbete dubbelstartas inte.
- [ ] #4 Lagringen har formatversion och dokumenterad export; hemligheter följer inte med sparad historik eller Git.
- [ ] #5 Omstart, avbrott och ett oläsbart eller ej stött sparformat har kontrollerats med resultat knutna till testad revision.
<!-- AC:END -->
