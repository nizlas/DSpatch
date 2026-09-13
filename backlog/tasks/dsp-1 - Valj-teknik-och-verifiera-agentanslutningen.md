---
id: "DSP-1"
title: "Välj teknik och verifiera första agentanslutningen"
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

Första chatten behöver en anslutning som fungerar med det konto och den dator Niclas faktiskt vill använda. Styrdokumentets integrationsuppgifter är underlag för ett teknikprov, inte redan verifierad DSpatch-funktion.

### Avgränsning och föreslagen väg

Utgå från Copilot SDK som dokumentets första exempel och kontrollera aktuell officiell dokumentation. Bedöm Cursor som alternativ om det finns ett konkret skäl. Välj en första målplattform och en minimal GUI-teknik som kan bära både chatten nu och kodförståelse senare. Skriv ett kort beslutsunderlag i uppgiften med motiv, alternativ, vad som faktiskt provats och vad som är öppet. Valen är omprövbara; bygg inte ett generellt adapterramverk.

Gör ett litet körbart anslutningsprov med start, strömning, en följdfråga och avbrott. Använd en avgränsad provmapp och håll inloggningsuppgifter utanför repot. Klargör kontotyp, autentisering, vilka verktyg agenten kan använda samt skillnaden mellan lokal körning och fjärranrop till modellen. Identifiera debiteringsvägen utan att bygga en kostnadsdashboard.

### Verifiering och mänsklig medverkan

Spara kommando, versionsuppgifter, testad revision och observerade resultat. Om kontot eller målmaskinen saknas: redovisa vad som kan göras ändå och vilken specifik kontroll Niclas behöver hjälpa till med. Dokumentationsläsning eller mockade svar uppfyller inte ett kriterium om fungerande kontoanslutning.

### Underlag

[VISION.md, avsnitt 9–10, 12 och 14–15](../../docs/VISION.md#9-arkitektur-och-projektets-data).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 En första plattform, GUI-teknik och anslutningsväg är valda inom Niclas givna mandat, med motiv och kvarvarande begränsningar dokumenterade.
- [ ] #2 Ett körbart prov har fått ett riktigt strömmande svar och en relevant följdfråga genom det avsedda kontot; kommandon och leverantörsversioner finns noterade.
- [ ] #3 Provets faktiska avbrottsbeteende och ett anslutningsfel är dokumenterade, inklusive vad som inte kan stoppas eller återupptas.
- [ ] #4 Autentisering, avgränsning av fil- och verktygsåtkomst samt debiteringsväg är klarlagda med källor och datum; osäkra kostnadsuppgifter är markerade.
- [ ] #5 En annan utvecklare kan följa provets instruktioner utan hemligheter i repot; nästa steg mot chatten är konkret och avgränsat.
<!-- AC:END -->
