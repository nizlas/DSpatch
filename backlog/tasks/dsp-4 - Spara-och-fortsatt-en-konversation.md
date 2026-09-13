---
id: "DSP-4"
title: "Spara konversation, ändringar och körresultat efter omstart"
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

Niclas ska kunna stänga DSpatch, öppna det igen och fortsätta en utvecklingsuppgift med projekt, resonemang, granskade ändringar och körresultat kvar. Sparad historik ska visa vad som verkligen hänt och vilken kod resultaten gäller.

### Avgränsning och föreslagen väg

Välj enkel lokal lagring för konversations-ID, projektkoppling, meddelanden, körnings- och försök-ID:n samt referenser till ändrings- och testversioner. Bevara den granskade diffen eller underlaget för att återskapa exakt den diffen, tillsammans med filförteckning, körkommando, arbetskatalog, utmatning, exitkod och status. Versionsmärk formatet och dokumentera lagringsplats och export.

Håll sparad historik skild från aktiva processer och arbetskopians nuvarande innehåll. En appomstart får inte starta om uppdrag eller kommandon, återapplicera en patch eller skriva tillbaka en historisk filversion automatiskt. Om repot har ändrats under tiden: visa historiska resultat som historiska och gör tidigare verifiering inaktuell för det nya innehållet.

Använd leverantörens återupptagning om den fungerar i den valda anslutningen. Om en ny session måste skapas: visa det och beskriv vilken sparad kontext som faktiskt återförs. En synlig gammal chatt är inte bevis för att modellen har fått samma sammanhang. Lagra inga autentiseringshemligheter i konversationsfiler eller Git.

### Verifiering

Gör en kodändring och kör ett test, stäng programmet, öppna igen och följ upp resultatet. Prova även appavbrott under en körning, externa filändringar medan programmet är stängt samt skadat eller äldre sparformat. Bevara läsbart underlag och ge en tydlig återhämtningsväg vid fel. Synka med DSP-3:s körstatus; pågående processer med okänt utfall ska avstämmas innan arbetet fortsätter.

### Underlag

[VISION.md, avsnitt 8–9, 13 och 14](../../docs/VISION.md#9-arkitektur-och-projektets-data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Projektkoppling och konversation med meddelandeordning finns kvar efter en normal omstart.
- [ ] #2 En följdfråga efter omstart får relevant sparad kontext; eventuell ny leverantörssession och dess begränsningar framgår.
- [ ] #3 En avbruten eller okänd körning avstäms innan fortsatt arbete. Tidigare jobb, filändringar och kommandon upprepas inte automatiskt vid omstart.
- [ ] #4 Lagringen har formatversion och dokumenterad export; hemligheter följer inte med sparad historik eller Git.
- [ ] #5 Omstart, avbrott, externa filändringar och ett oläsbart eller ej stött sparformat har kontrollerats med resultat knutna till testad version.
- [ ] #6 Den tidigare granskade diffen och körresultatet med kommando, arbetskatalog, utmatning, exitkod och kodreferens kan läsas efter omstart. Ändrad arbetskopia skrivs inte över, och gamla resultat presenteras inte som verifiering av ny kod.
<!-- AC:END -->
