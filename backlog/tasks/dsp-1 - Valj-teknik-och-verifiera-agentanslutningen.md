---
id: "DSP-1"
title: "Verifiera teknikvalet och första Cursor-anslutningen"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["integration"]
milestone: "m-0"
dependencies: ["DSP-7"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Niclas använder Cursor hemma. Enligt hans beslut den 13 september 2026 ska första implementationen och testningen utgå från Cursor på Windows med TypeScript, React och Electron. Windows och Linux ingår i målbilden med en enhetlig arbetsyta. Första milstolpen ska också kunna göra en avgränsad kodändring, visa diffen och köra bygge eller test. Teknikprovet behöver därför verifiera en väg till detta hela flöde. Styrdokumentets integrationsuppgifter är underlag för provet, inte redan verifierad DSpatch-funktion.

### Avgränsning och föreslagen väg

Utgå från det beslutade teknikspåret TypeScript, React och Electron i VISION.md avsnitt 9.1. Välj och verifiera en lämplig Cursor-anslutning utifrån aktuell officiell dokumentation och Niclas faktiska konto och Windowsdator. Prova ett minimalt paketerat Windowsprogram där Electron/React-vyn och agentanslutningen fungerar tillsammans; ett prov enbart i utvecklingsservern räcker inte för paketeringen. Skriv ett kort teknikunderlag med versioner, motiv, vad som faktiskt provats, begränsningar och öppna frågor. Dokumentera konkreta hinder om teknikvalet behöver omprövas.

Håll plattformsspecifika delar avskilda så att Linuxstödet kan tillkomma stegvis. Enhetlig layout, typografi, ikoner och arbetsflöden är målet; skärmskalning, textåtergivning och systemdialoger behöver senare provas på Linux. Varken Linuxpaketering eller Linuxprov krävs i DSP-1 eller Etapp 0. Dokumentera kända antaganden och kvarstående prov.

VS Code och Copilot ska fortsatt stödjas i målbilden, men behöver inte implementeras eller provköras för DSP-1 eller Etapp 0. Håll Cursor-specifika anrop och sessionsdata bakom en tunn adapter; gemensam gränssnittslogik, projektdata och bygginstruktioner ska inte kräva Cursors interna tillstånd. Bedöm utifrån dokumentation hur VS Code/Copilot ska kunna stödjas senare och notera antaganden, kända hinder och kvarstående prov. Det är en bedömning av teknikvalen, inte verifierad kompatibilitet. Bygg inte ett generellt adapterramverk eller en andra fungerande integration nu.

Gör ett litet körbart prov i ett separat provrepo: start, strömning, följdfråga, en faktisk textkodändring och ett relevant bygge eller test. Jämför de verkliga filerna före och efter ändringen och fånga körkommandots utmatning och exitkod. Prova avbrott. Körkommandot kan gå genom agentens verktyg eller en lokal process som DSpatch styr; dokumentera vald väg och dess begränsningar.

Håll inloggningsuppgifter utanför repot. Klargör kontotyp, autentisering, fil- och verktygsåtkomst samt skillnaden mellan lokal körning och fjärranrop till modellen. Identifiera debiteringsvägen utan att bygga en kostnadsdashboard.

### Verifiering och mänsklig medverkan

Spara kommandon, versionsuppgifter, testad revision eller innehållsidentifierad ögonblicksbild och observerade resultat. Om kontot eller målmaskinen saknas: redovisa vad som kan göras ändå och vilken specifik kontroll Niclas behöver hjälpa till med. Dokumentationsläsning, mockade svar eller kod som endast visas i chatten uppfyller inte kriterierna om fungerande anslutning och filändring.

### Underlag

[Teknikbeslutet i VISION.md, avsnitt 9.1](../../docs/VISION.md#91-valt-teknikspår-och-plattformar), samt avsnitt 9–10 och 12–15.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Det valda teknikspåret TypeScript, React och Electron samt en vald Cursor-anslutning fungerar tillsammans i ett minimalt paketerat Windowsprov. Versioner, målmiljö, motiv och begränsningar är dokumenterade. Underlaget beskriver vägen till Linux och VS Code/Copilot samt kvarstående kompatibilitetsprov; dessa senare prov krävs inte i uppgiften.
- [ ] #2 Ett körbart prov har fått ett riktigt strömmande svar och en relevant följdfråga genom Niclas avsedda Cursor-konto; kommandon och leverantörsversioner finns noterade.
- [ ] #3 Provets faktiska avbrottsbeteende och ett anslutningsfel är dokumenterade, inklusive vad som händer med redan ändrade filer och eventuella kvarvarande processer.
- [ ] #4 Autentisering, avgränsning av fil- och verktygsåtkomst samt debiteringsväg är klarlagda med källor och datum; osäkra kostnadsuppgifter är markerade.
- [ ] #5 En annan utvecklare kan följa provets instruktioner utan hemligheter i repot; nästa steg mot arbetsytan är konkret och avgränsat.
- [ ] #6 Agenten har gjort en verklig avgränsad kodändring i provrepot, ändringen har kontrollerats mot filerna och ett relevant bygge eller test har körts med dokumenterat kommando, utmatning, exitkod och testad kodversion.
<!-- AC:END -->
