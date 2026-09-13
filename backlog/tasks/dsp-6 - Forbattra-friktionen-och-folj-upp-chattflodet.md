---
id: "DSP-6"
title: "Förbättra största friktionen och följ upp hela utvecklingsflödet"
status: "To Do"
assignee: []
created_date: "2026-09-13"
labels: ["ux", "ui"]
milestone: "m-0"
dependencies: ["DSP-3", "DSP-4", "DSP-5"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Ta vara på återkopplingen från faktisk användning: gör en liten förbättring som hjälper Niclas, och bedöm sedan hela Etapp 0. Efter DSP-6 ska han kunna använda chatten för verkliga kodändringar, granska diffar och köra bygge eller test, med avbrott, felhantering och sparad historik på plats.

### Avgränsning och föreslagen väg

Konkretisera förbättringen efter DSP-5 utifrån dess viktigaste observation. Skriv den specifika beteendeförändringen och hur den ska bedömas innan implementation. Behåll ändringen liten; fler önskemål får egna uppgifter. Om provkörningen inte visar något att rätta ska vi inte hitta på en funktion för att fylla planen: dokumentera det och gå vidare till helhetsbedömningen.

Prova det sammanförda resultatet av DSP-2–4 och eventuell UX-förbättring. Niclas ska kunna öppna ett repo, diskutera en liten uppgift, låta agenten göra en kodändring, granska hela textdiffen och köra relevant bygge eller test med tydligt resultat för rätt kodversion. En följdfråga eller ett omtag ska fungera, liksom avbrott, begriplig felåterhämtning och fortsatt arbete efter omstart. Tidigare filändringar och körresultat ska finnas kvar utan att arbetet dubbelstartas.

### Verifiering och beslut om fortsättning

Agenten redovisar tekniska resultat för den version som lämnas ut, inklusive lyckat och misslyckat körkommando samt avbrott och omstart efter ändrade filer. Niclas bedömer användbarheten av samma version och gör själv en avgränsad ändring från uppdrag till diff och testresultat. Kvarstående hinder ska hanteras eller uttryckligen accepteras; en agent får inte markera en mänsklig bedömning som genomförd.

Niclas kan fortsätta arbeta människointeraktivt i kommande inkrement. Nästa steg kan vara ytterligare en förbättring av det befintliga flödet eller tydligare uppgifts- och körhistorik från Etapp 1. Avancerad kodförståelse, egen editor och Maestro kommer senare.

### Underlag

[VISION.md, avsnitt 1.1, 14 och 15](../../docs/VISION.md#14-etapper-för-genomförande).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Den valda förbättringen har spårbart stöd i DSP-5 och konkreta kriterier, eller så finns ett motiverat beslut att ingen sådan ändring behövs.
- [ ] #2 Förbättringen är verifierad mot sin avsikt. Det sammanförda flödet gör en verklig kodändring, visar berörda filer och fullständig textdiff och kör relevant bygge eller test med resultat kopplat till rätt kodversion. Avbrott, felhantering och omstart bevarar arbetet utan automatisk upprepning.
- [ ] #3 Niclas har själv genomfört och bedömt hela Etapp 0 på en angiven version, inklusive kodändring, diff, bygge/test och fortsatt arbete efter omstart. Kvarstående hinder är lösta eller uttryckligen accepterade av honom.
- [ ] #4 Resultat och lärdomar är dokumenterade och BACKLOG.md anger ett konkret nästa fokus utan att låsa senare teknik eller agenttopologi.
<!-- AC:END -->
