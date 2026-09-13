---
id: "DSP-5"
title: "Provkör kodändringsflödet med Niclas och fånga friktionen"
status: "To Do"
assignee: ["@nizlas"]
created_date: "2026-09-13"
labels: ["ux"]
milestone: "m-0"
dependencies: ["DSP-2"]
documentation: ["docs/VISION.md", "BACKLOG.md"]
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Varför och önskat resultat

Tekniskt fungerande chatt och kodändring betyder inte automatiskt rätt användarupplevelse. Niclas ska prova den första körbara versionen tidigt, innan en större arbetsyta byggs runt oprövade antaganden.

### Avgränsning och föreslagen väg

Agenten förbereder en kort instruktion och ett körbart resultat. Niclas väljer en liten verklig utvecklingsuppgift och provar att öppna repot, diskutera uppgiften, be agenten ändra koden, granska berörda filer och diff, köra relevant bygge eller test och följa upp resultatet. Ta även med en följdfråga eller ett omtag och ett avbrott.

Observera var han måste leta, gissa eller få en förklaring. Bedöm om det är begripligt vad agenten ändrat, vad körkommandot gör och vilken kod testresultatet gäller. Kontroller som går att klicka på räcker inte som bevis på användbarhet.

Niclas kan lämna tidig återkoppling på DSP-2:s delresultat redan när chatten går att köra. DSP-5:s helhetsprov omfattar sedan kodändring, diff och bygge/test. DSP-3 och DSP-4 behöver inte vara färdiga för detta prov. Notera vilka funktioner som fanns i den testade versionen; fördjupad felåterhämtning och omstart följs upp i DSP-6.

### Resultat och nästa steg

Spara korta observationer och Niclas kommentarer med miljö och version. Skilj faktiska observationer från agentens tolkningar. Prioritera högst tre friktioner och formulera ett litet förbättringsförslag för DSP-6. Agenten kan göra egna GUI-kontroller men får inte tillskriva Niclas en bedömning han inte gjort. En viktig ny insikt får också leda till att planen ändras.

### Underlag

[VISION.md, avsnitt 1.1, 2.1, 3.1 och 15](../../docs/VISION.md#21-enkelhet-med-bibehållen-kraft).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Ett konkret körbart resultat och ett kort provförlopp för kodändring, diff och bygge/test är tillgängliga för Niclas.
- [ ] #2 Niclas har själv genomfört en verklig avgränsad kodändring via chatten, granskat diffen, kört relevant bygge eller test och följt upp resultatet. Miljö, testad version och tillgängliga funktioner är noterade.
- [ ] #3 Observationer om begriplighet, kodförståelse, kopplingen mellan kod och testresultat samt onödiga steg är åtskilda från agentens egna antaganden.
- [ ] #4 Högst tre prioriterade friktioner och ett avgränsat nästa förbättringsförslag är dokumenterade, eller ett uttryckligt resultat att ingen blockerande friktion hittades.
<!-- AC:END -->
