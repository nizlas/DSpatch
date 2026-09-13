---
id: "DSP-2"
title: "Öppna ett projekt och ha en första konversation"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["ui", "integration"]
milestone: "m-0"
dependencies: ["DSP-1"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Niclas ska kunna prova en riktig chatt i DSpatch tidigt. Leverera ett sammanhängande förlopp från att öppna programmet och välja projektmapp till strömmande svar och en följdfråga i samma konversation.

### Avgränsning och föreslagen väg

Använd den verifierade anslutningen från DSP-1. Gör projektval, meddelandefält och Skicka synliga. Visa vilket projekt och vilken anslutning som används samt om ett svar pågår. Låt adaptern hantera leverantörens anrop; GUI-logiken ska inte bära leverantörsspecifika detaljer.

Första provet gäller dialog och läsande undersökning. Visa vilken projektkontext som faktiskt är tillgänglig; en vald mapp får inte antyda att varje fil automatiskt lästs. Tillåt bara den fil- och verktygsåtkomst som denna första version stöder och redovisar. Kodändringar och terminalkörning får egna uppgifter när motsvarande insyn och kontroll införs.

Lägg in en grundläggande Avbryt-åtgärd utifrån teknikprovet. DSP-3 fördjupar felhantering och återhämtning. Sparad historik tillkommer i DSP-4. Bygg en körbar instruktion för vald plattform; produktens vanliga handlingar ska gå att utföra i GUI:t.

### Verifiering och tidig provkörning

Öppna en provmapp, ställ en verklig kod- eller projektfråga och följ upp svaret. Kontrollera att meddelanden och sena händelser hör till rätt konversation och att gränssnittet förblir användbart under strömning. Dokumentera testad revision och en enkel startinstruktion för Niclas. DSP-5 kan börja så snart detta resultat finns.

### Underlag

[VISION.md, avsnitt 2.1, 9 och 14](../../docs/VISION.md#21-enkelhet-med-bibehållen-kraft).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 På vald plattform går det att starta arbetsytan och välja projektmapp via synliga kontroller.
- [ ] #2 Skicka ger ett riktigt strömmande agentsvar; en följdfråga använder samma konversationssammanhang.
- [ ] #3 Aktivt projekt, anslutning, tillgänglig projektkontext och pågående svar framgår utan att användaren behöver läsa en rålogg.
- [ ] #4 Grundläggande avbrott fungerar enligt DSP-1 och visar ärligt om något fortfarande kör; sena händelser blandas inte in i fel konversation.
- [ ] #5 Ett verifierat körbart resultat, testad revision och korta start- och provkörningssteg finns att lämna till Niclas.
<!-- AC:END -->
