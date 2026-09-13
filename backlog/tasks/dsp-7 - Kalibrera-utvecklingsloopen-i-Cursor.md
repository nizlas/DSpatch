---
id: "DSP-7"
title: "Kalibrera utvecklingsloopen i Cursor"
status: "To Do"
assignee: ["@nizlas"]
created_date: "2026-09-13"
labels: ["integration", "ux"]
milestone: "m-0"
dependencies: []
documentation: ["docs/DEVELOPMENT_LOOP.md", "docs/loop/CALIBRATION.md", "BACKLOG.md"]
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Innan DSP-1 genomförs med loopen behöver vi veta att de definierade rollerna faktiskt kan anropas i Cursor, att koordinatorn håller ihop arbetet och att planeringen ger Niclas tydlighet. Detta är ett förberedelsesteg för utvecklingsarbetet; det implementerar inte produktens Maestro.

### Avgränsning och föreslagen väg

Definitionerna och det lokala snapshot-verktyget levereras i förslaget till utvecklingsloop. Följ [CALIBRATION.md](../../docs/loop/CALIBRATION.md) i Cursor på hemmadatorn. Koordinatorn är huvudchatten och anropar fem specialister direkt utan rekursiv delegering. Börja med ett faktiskt planförslag för DSP-1, granska det, gör en avgränsad researchkontroll och prova implementation/verifiering/review i ett separat lokalt provrepo.

Pausa efter implementationen och återuppta i en ny huvudchatt från samma journal. Kontrollera att redan genomfört arbete inte körs igen. Niclas bedömer planöversiktens innehåll och tydlighet; fungerande filformat eller ett litet kodprov bevisar inte bra planering.

### Verifiering och fortsättning

Spara riktiga anropsreferenser och resultat, Cursor-version och modell där uppgifterna finns, kandidatens snapshot, testloggar och vad som behövde korrigeras. Markera saknade runtime-uppgifter som okända. Om ett verktyg eller en agent saknas: ange exakt vad som hindrar provet och fortsätt med de oberoende kontroller som går att göra.

Gör inte produktkod eller ändra DSP-1:s acceptanskriterier för att få kalibreringen godkänd. Uppdatera definitionsfilerna genom ett avgränsat korrigeringsuppdrag om provet avslöjar ett faktiskt problem. Efter godkänd kalibrering är DSP-1 nästa produktsteg.

### Underlag

[Utvecklingsloopen](../../docs/DEVELOPMENT_LOOP.md), [överlämningar](../../docs/loop/HANDOFF.md) och [utvecklingsplanen](../../BACKLOG.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Skillen kör koordinatorn i huvudchatten och alla fem namngivna specialister har anropats på riktigt i Cursor. Tillgängliga runtime-ID:n och eventuella begränsningar är dokumenterade; inga specialistanrop är imiterade i huvudkontexten.
- [ ] #2 Backlog Planner har lämnat ett konkret planförslag för DSP-1 och Reviewer har granskat det oberoende. Niclas har bedömt nyttan, tydligheten och behovet av korrigeringar.
- [ ] #3 Provrepots kodändring har implementerats, verifierats och granskats på samma identifierade kandidat; verkliga diffar, kommandon, resultat och rapporter finns.
- [ ] #4 En ny huvudchatt har återupptagit efter den avsiktliga pausen utan att upprepa implementationen; mandat, räknare och nästa steg har bevarats.
- [ ] #5 Fynd och kvarstående begränsningar är dokumenterade. Koordinatorns sammanfattning skiljer tekniskt prov, planeringsbedömning och ännu oprövad DSpatch-integration åt; DSP-1 har ett konkret nästa steg.
<!-- AC:END -->
