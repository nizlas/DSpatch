---
id: "DSP-1"
title: "Välj teknik och verifiera första Cursor-anslutningen"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["integration"]
milestone: "m-0"
dependencies: []
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Niclas använder Cursor hemma. Enligt hans beslut den 13 september 2026 ska första integrationen och testningen utgå från Cursor på hemmadatorn. Första milstolpen ska också kunna göra en avgränsad kodändring, visa diffen och köra bygge eller test. Teknikprovet behöver därför verifiera en väg till detta hela flöde. Styrdokumentets integrationsuppgifter är underlag för provet, inte redan verifierad DSpatch-funktion.

### Avgränsning och föreslagen väg

Utgå från Cursor och välj en lämplig anslutningsväg utifrån aktuell officiell dokumentation och Niclas faktiska konto och hemmadator. Välj en minimal GUI-teknik som kan bära chatten, en vanlig läsbar diff och ett körresultat. Skriv ett kort beslutsunderlag med motiv, alternativ, vad som faktiskt provats och vad som är öppet.

VS Code och Copilot ska fortsatt stödjas i målbilden, men behöver inte implementeras eller provköras för DSP-1 eller Etapp 0. Håll Cursor-specifika anrop och sessionsdata bakom en tunn adapter; gemensam gränssnittslogik, projektdata och bygginstruktioner ska inte kräva Cursors interna tillstånd. Bedöm utifrån dokumentation hur VS Code/Copilot ska kunna stödjas senare och notera antaganden, kända hinder och kvarstående prov. Det är en bedömning av teknikvalen, inte verifierad kompatibilitet. Bygg inte ett generellt adapterramverk eller en andra fungerande integration nu.

Gör ett litet körbart prov i ett separat provrepo: start, strömning, följdfråga, en faktisk textkodändring och ett relevant bygge eller test. Jämför de verkliga filerna före och efter ändringen och fånga körkommandots utmatning och exitkod. Prova avbrott. Körkommandot kan gå genom agentens verktyg eller en lokal process som DSpatch styr; dokumentera vald väg och dess begränsningar.

Håll inloggningsuppgifter utanför repot. Klargör kontotyp, autentisering, fil- och verktygsåtkomst samt skillnaden mellan lokal körning och fjärranrop till modellen. Identifiera debiteringsvägen utan att bygga en kostnadsdashboard.

### Verifiering och mänsklig medverkan

Spara kommandon, versionsuppgifter, testad revision eller innehållsidentifierad ögonblicksbild och observerade resultat. Om kontot eller målmaskinen saknas: redovisa vad som kan göras ändå och vilken specifik kontroll Niclas behöver hjälpa till med. Dokumentationsläsning, mockade svar eller kod som endast visas i chatten uppfyller inte kriterierna om fungerande anslutning och filändring.

### Underlag

[VISION.md, avsnitt 9–10, 12–15](../../docs/VISION.md#9-arkitektur-och-projektets-data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 GUI-teknik och anslutningsväg för Cursor på Niclas hemmadator är valda, med målmiljö, motiv och begränsningar dokumenterade. Underlaget beskriver hur VS Code/Copilot kan stödjas senare och vilka kompatibilitetsprov som återstår; sådana prov krävs inte i denna uppgift.
- [ ] #2 Ett körbart prov har fått ett riktigt strömmande svar och en relevant följdfråga genom Niclas avsedda Cursor-konto; kommandon och leverantörsversioner finns noterade.
- [ ] #3 Provets faktiska avbrottsbeteende och ett anslutningsfel är dokumenterade, inklusive vad som händer med redan ändrade filer och eventuella kvarvarande processer.
- [ ] #4 Autentisering, avgränsning av fil- och verktygsåtkomst samt debiteringsväg är klarlagda med källor och datum; osäkra kostnadsuppgifter är markerade.
- [ ] #5 En annan utvecklare kan följa provets instruktioner utan hemligheter i repot; nästa steg mot arbetsytan är konkret och avgränsat.
- [ ] #6 Agenten har gjort en verklig avgränsad kodändring i provrepot, ändringen har kontrollerats mot filerna och ett relevant bygge eller test har körts med dokumenterat kommando, utmatning, exitkod och testad kodversion.
<!-- AC:END -->
