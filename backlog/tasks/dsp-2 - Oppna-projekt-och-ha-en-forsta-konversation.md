---
id: "DSP-2"
title: "Öppna ett repo, ändra kod och granska resultatet"
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

Niclas ska kunna använda DSpatch för en liten verklig utvecklingsuppgift. Leverera ett förlopp från att välja repo och diskutera uppgiften till att agenten ändrar filer, Niclas granskar en vanlig diff och ett relevant bygge eller test körs.

### Avgränsning och föreslagen väg

Använd den verifierade Cursor-anslutningen från DSP-1. Gör projektval, meddelandefält och Skicka synliga. Visa projekt, anslutning, tillgänglig projektkontext och aktuell aktivitet. En vald mapp får inte antyda att varje fil automatiskt lästs. Håll leverantörens anrop i adaptern.

Bygg i små körbara delsteg: först dialogen, sedan filändringen med diff, därefter en synlig köråtgärd för bygge eller test. Niclas kan prova delresultaten under tiden; uppgiften är klar först när hela flödet fungerar. En skrivande agentkörning eller ett bygge/test åt gången i arbetskopian räcker för första versionen.

Låt ett uttryckligt ändringsuppdrag ge agenten mandat att göra den avgränsade ändringen i vald arbetskopia. En vanlig läsfråga ska också kunna förbli läsande. Fånga filernas startläge och visa vilka ändringar som hör till körningen. Tidigare manuella ändringar får inte tillskrivas agenten eller skrivas över tyst. Hantera en ändrad filversion begripligt innan fortsatt skrivning; en enkel isolering eller paus med tydlig förklaring räcker.

Visa berörda filer och en fullständig vanlig textdiff för körningens ändring, inklusive tillagda och borttagna textfiler. Diffen ska komma från verkligt filinnehåll och gälla en identifierad ögonblicksbild. Icke textbaserade eller ej stödda ändringar ska åtminstone synas i fillistan med sin begränsning. Användaren ska kunna be om ett omtag från samma chatt och därefter granska den nya versionen. Avancerad semantisk diff och en egen editor behövs senare.

Ge en synlig åtgärd för att köra ett relevant bygge eller test. Kommandot och arbetskatalogen ska gå att se och ändra i gränssnittet utan handredigerad konfiguration. Visa pågående körning, utmatning och exitkod. Knyt resultatet till den kod som faktiskt kördes: basrevision och en innehållsidentifierad ögonblicksbild som även omfattar relevanta ännu ej committade och nya filer. Ett tidigare testresultat får inte visas som verifiering av senare ändringar.

Lägg in grundläggande Avbryt enligt DSP-1 för agenten och körkommandot; visa om något fortfarande kör. DSP-3 fördjupar felhantering och DSP-4 sparad historik. Commit, push, PR-hantering och en full terminalemulator ingår inte i denna uppgift.

### Verifiering och tidig provkörning

Prova en liten kodändring i ett repo med ett känt bygge eller test. Kontrollera filinnehåll och diff, en följdfråga eller ett omtag samt både ett lyckat och ett misslyckat körkommando. Kontrollera att en befintlig manuell ändring bevaras och att nya kodändringar gör tidigare teststatus inaktuell. Dokumentera testad version och en kort startinstruktion. DSP-5 kan påbörjas med delresultat och slutföras när detta hela flöde går att prova.

### Underlag

[VISION.md, avsnitt 2.1, 3, 9, 13 och 14](../../docs/VISION.md#21-enkelhet-med-bibehållen-kraft).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 På vald plattform går det att starta arbetsytan och välja repo via synliga kontroller.
- [ ] #2 Skicka ger ett riktigt strömmande agentsvar; en följdfråga eller ett omtag använder relevant konversationssammanhang.
- [ ] #3 Aktivt projekt, anslutning, tillgänglig projektkontext och aktuell aktivitet framgår utan att användaren behöver läsa en rålogg.
- [ ] #4 Grundläggande avbrott för agent och körkommando fungerar enligt DSP-1 och visar ärligt om något fortfarande kör; sena händelser blandas inte in i fel konversation.
- [ ] #5 Ett verifierat körbart resultat, testad version och korta start- och provkörningssteg finns att lämna till Niclas.
- [ ] #6 Ett uttryckligt uppdrag ger en verklig kodändring i vald arbetskopia. En läsfråga kan förbli läsande, och tidigare manuella ändringar bevaras och skiljs från körningens ändringar.
- [ ] #7 Berörda filer och hela textdiffen kan granskas mot verkligt filinnehåll för en identifierad ögonblicksbild. Tillagda och borttagna textfiler ingår; övriga ändringar och begränsningar är synliga.
- [ ] #8 Ett relevant bygge eller test kan startas från en synlig åtgärd med synligt och redigerbart kommando och arbetskatalog. Utmatning, exitkod och testad ögonblicksbild visas; resultat gäller inte automatiskt efter en ny kodändring.
<!-- AC:END -->
