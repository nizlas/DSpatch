---
id: "DSP-7"
title: "Kalibrera utvecklingsloopen i Cursor"
status: "Done"
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
- [x] #1 Skillen kör koordinatorn i huvudchatten och alla fem namngivna specialister har anropats på riktigt i Cursor. Tillgängliga runtime-ID:n och eventuella begränsningar är dokumenterade; inga specialistanrop är imiterade i huvudkontexten.
- [x] #2 Backlog Planner har lämnat ett konkret planförslag för DSP-1 och Reviewer har granskat det oberoende. Niclas har bedömt nyttan, tydligheten och behovet av korrigeringar.
- [x] #3 Provrepots kodändring har implementerats, verifierats och granskats på samma identifierade kandidat; verkliga diffar, kommandon, resultat och rapporter finns.
- [x] #4 En ny huvudchatt har återupptagit efter den avsiktliga pausen utan att upprepa implementationen; mandat, räknare och nästa steg har bevarats.
- [x] #5 Fynd och kvarstående begränsningar är dokumenterade. Koordinatorns sammanfattning skiljer tekniskt prov, planeringsbedömning och ännu oprövad DSpatch-integration åt; DSP-1 har ett konkret nästa steg.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Pass 1, 13 september 2026 — pausat enligt plan

Körjournal: `.dspatch-loop/runs/20260913-114021-4slh/` (lokal, Git-ignorerad). Cursor 3.17.8, Git 2.53.0, Python 3.12.10. Koordinatorns modell enligt systemprompt är Claude Opus 5; det exakta modellslugget går inte att läsa ut och specialisternas faktiska modell är okänd, eftersom `model: inherit` inte exponerar något avläsbart runtime-värde.

Sex verkliga specialistanrop genomförda, ett omtag av två tillåtna förbrukat. Alla fem rollerna är anropade utom Verifier, som ligger först i återupptagningen.

| # | Roll | Utfall | Runtime-ID |
| --- | --- | --- | --- |
| 1 | Backlog Planner | COMPLETE, plan v1 för DSP-1 | `0ed0997a-d03b-456c-b88b-333cdaf6b87e` |
| 2 | Reviewer, planläge | REWORK, fem blockerande fynd | `dfc177ea-a6b3-4a65-8561-21c04ef362f5` |
| 3 | Backlog Planner, omtag | COMPLETE, plan v2 | samma som #1, återupptagen |
| 4 | Reviewer, avstämning | ACCEPT | samma som #2, återupptagen |
| 5 | Researcher | COMPLETE | `fd1aad37-6fa9-4431-a079-4e6649c24d01` |
| 6 | Implementer | COMPLETE | `291bba01-b240-4cc9-8971-f4df9a185d0b` |

### Viktigaste fyndet: readonly-agenter saknar terminal på Windows

Samtliga tre `readonly: true`-agenter — Planner, Reviewer och Researcher — är helt blockerade från terminalen på denna maskin, inte bara från tillståndsändrande kommandon. Även `echo probe` nekas, med felet att maskinen inte kan upprätthålla sandlådepolicyn `workspace_readonly` eftersom ingen sandlådebackend finns; Cursors dokumentation beskriver sandlådan enbart för macOS och Linux. Implementer, som har `readonly: false`, körde samma kommandon med exitkod 0 på samma maskin. Orsakssambandet är därmed belagt genom kontrast, inte bara resonerat.

Konsekvens för loopen: all kommandokörning måste ligga hos koordinatorn, Implementer eller Verifier. Det påverkar inte Verifier, som redan är `readonly: false`. Det är däremot ett beslut för Niclas om de tre läsande rollerna ska behålla `readonly: true` till priset av att de inte kan kontrollera något själva. Alla fem agentfilerna är i övrigt korrekt konfigurerade enligt dokumentationen; inga fältfel finns.

### Övriga loopfynd

Återupptagning av samma subagent bevarade kontexten och runtime-ID. Vid ett sådant resume returnerade verktyget dock en **inaktuell kort sammanfattning** från föregående anrop — den sade REWORK medan det faktiska slutsvaret var ACCEPT. Koordinatorn måste läsa hela slutsvaret.

Enligt Cursors FAQ **kan** subagenter starta barnsubagenter sedan Cursor 2.5. `docs/DEVELOPMENT_LOOP.md` bör därför formulera "ingen specialist delegerar" som vår egen policy, inte som en plattformsgaranti.

Backlog CLI kunde inte anropas under kalibreringen: `backlog` hittades inte i agentterminalen, och uppgiftsfilerna redigerades därför som Markdown enligt reservrutinen i AGENTS.md. Den historiska observationen står kvar. **Orsaken klarlades efteråt och var inte att verktyget saknades** — se avsnittet om PATH nedan.

### Efterkontroll: varför Backlog CLI inte hittades

Undersökt av koordinatorn 13 september 2026, efter att Niclas påpekat att Backlog.md 1.52.0 är installerat och att han använt webbgränssnittet.

**Verktyget fanns hela tiden.** `backlog.cmd`, `backlog` och `backlog.ps1` ligger i `C:\Users\nicla\AppData\Roaming\npm\`, installerade som globalt npm-paket. Ingen ominstallation behövdes eller gjordes.

**Orsaken är ett inaktuellt miljöarv i agentterminalen, inte en saknad installation.** Två katalogers frånvaro i skalets `PATH` gav felet:

| Katalog | I sparad PATH | I agentterminalens PATH |
| --- | --- | --- |
| `C:\Program Files\nodejs\` | Ja, maskin-PATH | **Nej** |
| `C:\Users\nicla\AppData\Roaming\npm` | Ja, användar-PATH | **Nej** |

Agentterminalens `PATH` motsvarar exakt den sparade användar-PATH **minus den sista posten**, och maskin-PATH minus `nodejs`. Båda lades alltså till efter att processen som äger denna terminalmiljö startades. Att köra `backlog.cmd` med full sökväg gav därför ett annat, mer avslöjande fel: `'"node"' is not recognized`, eftersom omslagsskriptet anropar `node` som i sin tur saknades i PATH. `C:\Program Files\nodejs\node.exe` fanns samtidigt på disk.

**Bekräftat fungerande efter att PATH kompletterats i sessionen:** `node --version` → `v24.21.0`, `backlog --version` → `1.52.0`, exitkod 0.

**Åtgärd:** ingen ominstallation. En omstart av Cursor räcker för att terminalen ska ärva den aktuella PATH. Tills dess lägger koordinatorn till `C:\Program Files\nodejs` och `%APPDATA%\npm` i sessionens PATH innan CLI:t används. Hindret är därmed undanröjt och blockerar inte DSP-1.

### Första provet av Backlogs CLI mot DSpatch-planen

Utfört efter PATH-rättningen, som samtidigt är det lokala prov som `BACKLOG.md` efterlyste. CLI:t läser de handredigerade filerna utan anmärkning, vilket också verifierar att reservrutinens Markdown-redigeringar bevarat formatet:

- `backlog task list --plain` visar samtliga sju uppgifter med korrekta titlar och AC-räknare. DSP-7 redovisas som `Done (ac: 5/5)`.
- `backlog milestone list --plain` visar `m-0: Etapp 0 – Gör en verklig kodändring med DSpatch (1/7 done)`.
- `backlog task view DSP-1 --plain` renderar `Description`, `Acceptance Criteria` och den nytillagda `Implementation Plan`, inklusive delsteg 1–8, sondbeskrivningen och den omskrivna AC#3. Markören `<!-- SECTION:PLAN:BEGIN -->` är alltså rätt för uppgiftsformatet. Beroendegrafen ritas korrekt med DSP-7 som uppfyllt beroende.

Kvarstår oprövat av agenten: `backlog board`, som är ett interaktivt TUI och inte lämpar sig för ett agentskal, samt skrivande CLI-kommandon. Webbgränssnittet har Niclas använt. De fem statuskolumnerna är alltså inte kontrollerade av koordinatorn.

### Tekniskt prov i isolerat provrepo

Provrepo: `.dspatch-loop/runs/20260913-114021-4slh/probe`, gren `main`, bascommit `cb7047c262dc371a010680390aaf6614acb9dbec`, ingen remote. Baslinjetestet misslyckades som avsett (`AssertionError: '23-1' != 4`, exitkod 1).

Implementer ändrade endast `example.py`, från `return "".join(values)` till `return sum(int(value) for value in values)`, och fick testet grönt med exitkod 0 utan att röra testet och utan commit. Koordinatorn kontrollerade diffen och HEAD oberoende efter rapporten; de stämde exakt. Kandidatens innehålls-ID är `sha256:f0c3b1bbd79692702420c6f9c572f06ee4f8bbf2fcc6db5c0787c1355d4ccc09`, sparad i `probe/.dspatch-loop/candidate.json`. Inga provprocesser kör vidare.

### Planeringsbedömningen

Planner levererade en plan för DSP-1 i åtta delsteg med billigast möjliga stoppfynd först. Reviewer underkände den först på fem punkter: delsteg 1 valde anslutningsväg utan att bedöma återupptagning, godkännanden och modellval; AC#4 och AC#5 saknade empiriska bärare; det paketerade provet var odefinierat; och delsteg 1 var tilldelat en läsande roll utan terminal. Efter ett omtag accepterade Reviewer planen. Detta är agenternas bedömning av varandra — **Niclas egen bedömning av planens nytta och tydlighet återstår och är det som avgör AC #2.**

### Nästa steg efter pass 1

Återuppta i en **ny huvudchatt** med `/dspatch-loop resume`. Steg 1–6 är klara och får inte upprepas; Implementer ska inte anropas igen. Kör Verifier på den sparade kandidaten, därefter Reviewer i implementationsläge på samma kandidat.

### Pass 2, 13 september 2026 — återupptaget och tekniskt klart

Ny huvudchatt, `/dspatch-loop resume`. Samma körjournal, samma mandat, räknarna bevarade: åtta specialistanrop av tolv, ett omtag av två. Återupptagningen skedde enbart från journalen och rapporterna; inget av steg 1–6 kördes om och Implementer anropades inte igen.

**Avstämningen före nytt arbete.** Koordinatorn kontrollerade provrepots faktiska tillstånd innan något anropades: `git status --porcelain` gav ` M example.py`, `git rev-parse HEAD` gav `cb7047c`, diffen var identisk med rapport 006, och `loop_snapshot.py --expect` gav `matches: true` för `sha256:f0c3b1bb…4ccc09`. Kandidaten var alltså intakt över chattbytet.

| # | Roll | Utfall | Runtime-ID |
| --- | --- | --- | --- |
| 7 | Verifier | COMPLETE, 6/6 kriterier PASS | `c288fb7a-d7ae-4dbd-b5dd-868b0c757eda` |
| 8 | Reviewer, implementationsläge | ACCEPT, inga blockerande fynd | `a293ddde-2b53-4d73-9675-1fd33743b19d` |

**Verifiering (rapport 007).** Testet `python -m unittest discover -s . -p "test_example.py"` gav exitkod 0. Utöver testet kontrollerades explicit att `sum_numbers(["2","3","-1"])` ger heltalet `4` (inte `4.0` eller en sträng), att anroparens lista är oförändrad och samma objekt efteråt, och att tom sekvens ger `0`. Endast `example.py` var ändrad mot `cb7047c`; ingen commit, ingen remote. Kandidatens innehålls-ID var identiskt före och efter körningen. Råloggar: `logs/007-verifier-unittest.log`, `logs/007-verifier-behaviour.log`.

**Granskning (rapport 008).** Reviewer accepterade utan blockerande fynd. Den kontrollerade själv, genom filläsning, att `test_example.py` på disk är tecken för tecken identisk med testtexten i CALIBRATION.md, att `.gitignore` inte breddats, och att provrepots Git-objektkatalog saknar blobben för den ändrade `example.py` — ett oberoende belägg för att ingenting committats eller stagats, oberoende av Verifiers berättelse. Tre icke-blockerande noteringar: ett strängargument som `"123"` summeras tyst tecken för tecken, rapport 006:s påstående att funktionen ”fungerar för vilken itererbar som helst” är för generöst eftersom en iterator konsumeras, och `int()` accepterar blanktecken och `"1_0"` men inte `"2.5"`. Inget av detta ligger inom provuppgiftens kriterier.

Koordinatorn kontrollerade kandidaten på nytt efter både anrop 7 och anrop 8: `matches: true` båda gångerna. Inga provprocesser kör vidare.

### Ytterligare loopfynd från pass 2

**Återupptagning över chattbyte fungerar.** Journalen och rapporterna räckte för att återställa mandat, räknare, kandidat och nästa steg i en helt ny chatt utan att fråga Niclas om något som redan var beslutat. Detta är AC #4 belagt i praktiken, inte bara som dokumenterad rutin.

**Evidenskedjan har en lucka i loggningen.** Verifier sparade råloggar för testet och beteendekontrollerna, men Git- och snapshotkommandonas utmatning finns bara som transkriberad prosa i rapporten. Reviewer kunde täcka luckan genom att läsa `.git`-filer direkt, vilket fungerar i ett litet lokalt provrepo men inte generellt. Inför DSP-1: låt Verifier spara råutmatning även för Git- och snapshotkommandon.

**En läsande Reviewer kan inte bekräfta kandidatens identitet själv.** Den kan läsa `candidate.json` men inte räkna om hasharna. Kopplingen mellan diff, kandidat och disk vilar därför på Verifiers körning och koordinatorns egna kontroller. Det fungerade här, men det är en strukturell begränsning som hör ihop med `readonly`-frågan.

### Vad kalibreringen inte visar

Det tekniska provet gäller ett litet, isolerat Python-repo som finns för kalibreringens skull. Det säger ingenting om DSpatchs produktkod, om TypeScript/React/Electron-spåret eller om den verkliga Cursor-anslutningen — det är DSP-1:s uppgift. Planförslaget för DSP-1 är granskat av Reviewer men **inte** av Niclas; AC #2 är därför fortfarande öppen och avgör om DSP-7 kan sättas till Done.

### Beslut av Niclas, 13 september 2026

**Planner, Researcher och Reviewer behåller `readonly: true`.** De ska granska och planera, inte köra. Att de därmed saknar all terminalåtkomst på Windows är accepterat som en känd kostnad, inte ett fel att åtgärda. Konsekvensen är att all kommandokörning ligger hos koordinatorn, Implementer och Verifier, och att planer inte får tilldela körda kommandon till en läsande roll. Plan v2 för DSP-1 följer redan detta genom att dela delsteg 1 i en inventeringshalva med terminal och en läsande dokumentationshalva.

Följdkravet av loopfynden ovan: eftersom Reviewer inte kan reproducera något själv ska Verifier spara råutmatning även för Git- och snapshotkommandon, så att granskningen vilar på loggar i stället för transkriberad prosa.

**Kontofrågan för DSP-1 är inte ett blockerande förkrav.** Provet utgår från Niclas befintliga privata Cursor-konto. Anslutningsväg, autentisering och eventuellt saknat stöd behandlas som en öppen teknisk fråga tills ett konkret hinder är belagt. Behövs en nyckel föreslås förvaring och Niclas beslutar då. Hans medverkan begärs vid inloggning som bara han kan göra och vid beslut om extra kostnad.

**Adapterkod från teknikprovet får återanvändas i DSP-2**, men DSP-2 ärver inte provets gränssnittsval.

**DSP-1 AC#3 är omskriven till två uttryckliga scenarier:** faktisk avbrytning, och ett kontrollerat framkallat anslutningsfel genom den verkliga anslutningsvägen. En driftstörning hos leverantören ska inte inväntas, och ett simulerat fel utan verklig anslutning räcker inte. Detta är den enda kriterieändring som gjorts i DSP-1; den är beslutad av Niclas, inte av en agent.

**Nätverkssonden i delsteg 5** är godkänd i sin minsta form — en lyssnare på `127.0.0.1` som provet självt startar — och dess syfte och omfattning är nu beskrivna i DSP-1:s plan. En sond som avser något mer ska lyftas innan den görs.

### Niclas planbedömning, AC #2

Planöversikten för DSP-1 presenterades i huvudchatten med Reviewers tre redaktionella justeringar inarbetade och godkändes. Bedömningen omfattade både första förslaget och korrigeringen: v1 underkändes på fem punkter, varav den allvarligaste var att den tilldelade körda kommandon till en läsande roll utan terminal — ett steg som inte hade gått att utföra. Att ett omtag krävdes är en del av bedömningsunderlaget, inte en detalj att bortse från.

Plan v2 med samtliga justeringar och besluten ovan är införd som **Implementation Plan i DSP-1**, så att ett avbrutet pass kan återupptas på rätt delsteg. Inga nya tickets skapades.

### Resultat av kalibreringen

DSP-7 är genomförd. Alla fem specialistrollerna har anropats på riktigt med bevarade runtime-ID, ett planeringsomtag har genomförts och granskats, det tekniska provet har gått igenom implementation, oberoende verifiering och oberoende granskning på samma innehållsidentifierade kandidat, och återupptagning över ett chattbyte har provats skarpt. Loopen är därmed kalibrerad för att användas på DSP-1.

Kvarstår att göra i loopens dokumentation, inte i denna uppgift: `docs/DEVELOPMENT_LOOP.md` bör formulera ”ingen specialist delegerar” som vår egen policy i stället för som en plattformsgaranti, eftersom subagenter enligt Cursors FAQ kan starta barnsubagenter sedan Cursor 2.5.

### Konkret nästa steg

Starta DSP-1 i ett eget pass med `/dspatch-loop run DSP-1`. Delsteg 1–3 kan köras direkt; Niclas medverkan behövs först vid delsteg 4 och framåt.
<!-- SECTION:NOTES:END -->
