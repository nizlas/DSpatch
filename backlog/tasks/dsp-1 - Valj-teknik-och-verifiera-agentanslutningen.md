---
id: "DSP-1"
title: "Verifiera teknikvalet och första Cursor-anslutningen"
status: "In Progress"
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
- [ ] #3 Två scenarier är provade och dokumenterade genom den verkliga anslutningsvägen: en faktisk avbrytning, både under strömning och under pågående testkörning, och ett kontrollerat framkallat anslutningsfel. För båda framgår vad som hände med redan ändrade filer, om något fortsatte köra och om ett pågående fjärranrop kunde stoppas. Felet framkallas av provet självt; en driftstörning hos leverantören ska inte inväntas, och ett simulerat fel utan verklig anslutning uppfyller inte kriteriet.
- [ ] #4 Autentisering, avgränsning av fil- och verktygsåtkomst samt debiteringsväg är klarlagda med källor och datum; osäkra kostnadsuppgifter är markerade.
- [ ] #5 En annan utvecklare kan följa provets instruktioner utan hemligheter i repot; nästa steg mot arbetsytan är konkret och avgränsat.
- [ ] #6 Agenten har gjort en verklig avgränsad kodändring i provrepot, ändringen har kontrollerats mot filerna och ett relevant bygge eller test har körts med dokumenterat kommando, utmatning, exitkod och testad kodversion.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Planen är framtagen av Backlog Planner, granskad av Reviewer i två omgångar och godkänd av Niclas den 13 september 2026 under DSP-7. Underlaget finns i körjournalen `.dspatch-loop/runs/20260913-114021-4slh/reports/` (001 plan v1, 002 granskning, 003 plan v2, 004 avstämning). Ordningsprincipen är billigaste möjliga stoppfynd först. Ett avbrutet pass återupptas på rätt delsteg nedan.

### Avgränsad uppföljning av anslutningsvalet

Komplettera delsteg 1:s underlag innan det gemensamma adaptergränssnittet låses. Utgå från sparade rapporter och prov; upprepa bara kontroller som behövs för att reda ut en konkret osäkerhet. Koordinatorn anger uppföljningen som aktuellt fokus och använder befintligt pass och räknare när detta är en återupptagning.

- **Cursor och Copilot.** Jämför de officiella TypeScript-SDK:erna mot VISION:s sju förmågor: start, strömning, avbrott, återupptagning, modellval, godkännanden och kostnadsrapportering. Ange källor, datum, bedömd version och vad som är dokumenterat, observerat respektive okänt. Beskriv de konkreta konsekvenserna för gemensamma operationer, händelser och lagring, inklusive väntande godkännanden och leverantörsspecifika sessions-ID:n. Skilj Copilot som agentleverantör från integration med en befintlig VS Code-chatt och verktyg från dess tillägg. En andra fungerande integration eller VS Code-prov ingår inte.
- **Slutsatser och bevis.** Skilj lyckad SDK-laddning och kontakt med en autentiseringsendpoint från en provad paketerad helkedja. Begränsa nätverkssondens slutsats till den åtkomst som faktiskt observerats. Kontrollera paketens ursprung mot officiella installationsanvisningar; vid den rapporterade namnförväxlingen, klarlägg ur tillgänglig kommandologg om tredjepartspaketet bara undersöktes eller också installerades. Utred rollen för den rapporterade lokala `blobEncryptionKey` utan att kopiera nyckelvärdet till rapport eller repo.
- **Avstämning.** Reviewer bedömer det kompletterade underlaget och om Cursor-spåret fortfarande är motiverat utan att låsa ute Copilot. Koordinatorn sparar slutsats, kvarstående prov och nästa steg i uppgiften. Praktiska körningar utförs av en roll med terminalåtkomst när de behövs; dokumentationsjämförelsen kräver ingen ny leverantörsinloggning.

Godkänd uppföljning betyder att anslutningsvalets underlag är bedömt. DSP-1 blir inte `Done` förrän dess befintliga acceptanskriterier, inklusive det paketerade provet och Niclas bedömning, är uppfyllda. Fortsätt därefter med återstående delsteg inom mandatet; skapa ingen extra godkännandepunkt för rutinval.

### Förkrav: konto och autentisering

Provet utgår från Niclas befintliga privata Cursor-konto. Kontofrågan är en **öppen teknisk fråga**, inte ett blockerande förkrav: delsteg 1 och 4 ska klarlägga vilken anslutningsväg som gäller, hur autentiseringen faktiskt fungerar för den vägen och om något verkligen saknas. Behövs en nyckel utöver vanlig inloggning föreslås förvaring — Windows kreditförvaring i första hand, miljövariabel eller fil utanför repot som alternativ — och Niclas beslutar då. Hans medverkan begärs vid inloggning som bara han kan göra och vid beslut om extra kostnad. Ett hinder rapporteras när det är belagt, inte när det misstänks.

### Delsteg

1. **Välj anslutningsväg och inventera maskinen.** Två halvor med olika utförare, eftersom läsande roller saknar terminal i denna miljö. Inventeringen körs av koordinator eller Implementer och levererar körda kommandon med utmatning: Windowsversion, `node`, `npm`, Cursors CLI-version om den finns, och hämtbara paket. Den läsande dokumentationshalvan görs av Researcher, som bedömer TypeScript-SDK, ACP över JSON-RPC och headless CLI mot faktiska versioner. Fem krav **måste** vara uppfyllda för att en väg ska kunna väljas: start, strömning, avbrott, filändring och verktygskörning, samt anropbarhet från Node i en paketerad Electron-app. Fyra ska **bedömas och redovisas** med "stöd saknas" som giltigt svar: återupptagning av session (DSP-4 AC#2 beror på det), godkännanden per verktygsanrop, modellval och kostnadsrapportering. Leverans: rekommendation med reservväg plus stödmatris där saknat stöd står som saknat.
2. **Körbart skelett i dev-läge.** TypeScript, React och Electron startar ett fönster på Windows med låsta versioner och committad lockfile. Adaptern finns som gränssnitt men anropar ännu inget. Gränssnittet är **sessionsgranulärt**, inte körningsgranulärt, och bär `dispose()` samt godkännandetillståndet enligt uppföljningens beslut i Implementation Notes; de fältbeslut som listas som uppskjutna där ingår inte.
3. **Paketera det tomma skelettet.** En körbar artefakt utan dev-server, innan agentanslutningen finns, med innehållssumma och källsnapshot noterade så att den inte förväxlas med artefakten i delsteg 7. Syftet är att separera paketeringsfel från anslutningsfel; motivet är ett erfarenhetsbaserat antagande, inte belagt faktum. Buntas huvudprocessen gäller Cursors dokumenterade lazy-load-problem med felsignaturen `Cannot find module './986.js'` vid första `Agent.create()`; se paketeringsavsnittet i Implementation Notes för motåtgärden. **Startinstruktionens första utkast skrivs redan här**, så att bara den paketerade delen tillkommer sent.
4. **Verklig anslutning och strömning.** Adaptern körs utanför renderingstråden, ansluter via Niclas konto och ger ett riktigt strömmande svar plus en följdfråga i samma session. Inloggningsuppgifter hålls utanför repot. Bär två observationer för AC#4: vad autentiseringen faktiskt krävde och varifrån behörigheten hämtades, samt en första läsning av förbrukning eller kostnad. Saknade värden redovisas som okända, aldrig som noll.
5. **Verklig kodändring och bygge eller test.** Agenten får ett uttryckligt ändringsuppdrag mot ett separat litet provrepo med ett känt deterministiskt test. Filerna jämförs före och efter, testkommandot körs och utmatning och exitkod fångas. Vald körväg dokumenteras. Visade delsteg 1 att godkännanden är interaktiva hanteras de uttryckligen här, och en väntande godkännandefråga får inte rapporteras som en hängning. Åtkomstsonderna nedan körs **efter** att kodändringen och testkörningen är dokumenterade, så att en nekad sond inte förorenar AC#6:s evidens. Förbrukningen läses en andra gång en stund efter körningen, eftersom kostnadsvärden kan dröja.
6. **Avbrott och anslutningsfel, som två separata scenarier.** *Scenario A, faktisk avbrytning:* avbryt under strömning och avbryt under pågående testkörning. *Scenario B, kontrollerat framkallat anslutningsfel genom den verkliga anslutningsvägen:* felet framkallas av provet självt, ingen driftstörning hos leverantören inväntas. Båda dokumenterar vad som händer med redan ändrade filer, om något fortsätter köra, och särskilt om ett pågående fjärranrop till modellen inte kan stoppas.
7. **Paketerat Windowsprov med anslutningen.** Bygg om artefakten nu när adaptern startar en extern process och kör **hela minimikedjan** från artefakten utan dev-server: fönstret öppnas och visar anslutningsstatus för Niclas konto; en fråga ger ett strömmande svar; en följdfråga besvaras i samma session; ett uttryckligt ändringsuppdrag ändrar en fil i provrepot så att ändringen syns på disk; provrepots test körs med synlig utmatning och exitkod; och Avbryt under strömning ger en begriplig status. Enbart anslutning och strömning räcker inte. "Begriplig status" knyts till AC#3:s ordalydelse: att strömningen upphört, och om något fortfarande kör. Artefakten identifieras med SHA-256 på den körbara filen eller på kataloginnehållets manifest, källans ögonblicksbild inklusive lockfile, byggkommandot och tidsstämpeln — inte med sökväg. Före leverans görs en namngiven hemlighetskontroll: mönstersökning i provkod och committade filer efter nyckel- och tokenmönster samt kontonamn, kontroll att `.gitignore` täcker lokala inställnings- och nyckelfiler, kontroll att sparade råloggar är maskade, och genomgång av indexet innan commit. Verifier kontrollerar hemlighetskontrollen oberoende. Niclas äger instruktionsgenomgången när han kör artefakten; en teknisk komplettering är att en ren session utan loopens historik följer instruktionen och rapporterar varje punkt där kunskap saknades. Räkna med varning för osignerad binär.
8. **Teknikunderlag.** Versioner, motiv och målmiljö; vad som provades och inte provades; autentisering och nyckelförvaring; den observerade gränsen för fil- och verktygsåtkomst från delsteg 5; debiteringsvägen med källa, datum och observerade eller okända värden; stödmatrisen från delsteg 1; bedömningen av vägen till Linux och till VS Code/Copilot med kvarstående prov; skillnaden mellan lokal körning och fjärranrop till modellen, inklusive vad som händer om ett pågående fjärranrop inte kan stoppas; konkreta hinder om teknikvalet behöver omprövas, formulerade som faktiskt påträffade hinder och deras storlek; samt ett konkret avgränsat nästa steg för DSP-2.

### Vad åtkomstsonderna i delsteg 5 kontrollerar, och hur

Sonderna svarar på frågan **vad en agent faktiskt kan nå när DSpatch kör den**. Det är inte samma sak som att kontrollera att vi når Cursor; den anslutningen provas i delsteg 4 och är ingen sond. Utfallet avgör vad DSpatch själv behöver bygga i fråga om inneslutning, och hör hemma i teknikunderlaget innan DSP-2 börjar.

- **Filsond 1.** Provet skapar en egen temporär katalog utanför den angivna arbetskopian och lägger en fil där. Agenten ombeds läsa och ändra den. Ett av tre utfall noteras: lyckas, nekas, eller frågar om lov.
- **Filsond 2.** Samma sak för ett kommando som skriver till den temporära katalogen.
- **Nätverkssond, minsta form.** Provet startar en egen lyssnare på `127.0.0.1` på en ledig port och ber agenten hämta den adressen. Syns anropet i vår egen logg visar det att agentens process når den lokala testservern på `127.0.0.1`. Det bevisar inte fri internetåtkomst eller åtkomst till andra adresser. Ingen tredje part berörs, ingen extern tjänst kontaktas, ingen data lämnar maskinen. Detta är godkänt som en vanlig avgränsad anslutningskontroll inom teknikprovet.

Ingen sond får röra DSpatch-repot, Niclas övriga projekt eller externa system. Skulle en sond behöva avse mer än ovanstående — exempelvis en verklig utgående anslutning till en extern adress — lyfts syfte och omfattning till Niclas innan den görs.

### Avgränsning inom uppgiften

Arbetsytan i sig hör till DSP-2, fördjupad felhantering till DSP-3, sparad historik och omstart till DSP-4. Utanför ligger Linuxpaketering och Linuxprov, implementation eller provkörning av VS Code/Copilot, generellt adapterramverk eller en andra integration, kostnadsdashboard, MCP-verktyg och verktygsregister, kodsignering, installerare och automatisk uppdatering, commit, push och PR-hantering, parallella skrivande agenter, Maestro, egen editor och avancerad kodförståelse. Medvetet till senare: allt gränssnittsarbete utöver vad provet kräver.

Provkoden är ett spike. **Beslut av Niclas 13 september 2026:** lämplig adapterkod från teknikprovet får återanvändas i DSP-2; DSP-2 ärver däremot inte provets gränssnittsval.

### Hur kriterierna bärs

AC#1 av delsteg 2, 3, 7 och 8. AC#2 av delsteg 4, med kommandon, modellnamn och leverantörsversion noterade. AC#3 av delsteg 6:s båda scenarier. AC#4 av delsteg 4 och 5 för de empiriska observationerna och av delsteg 8 för sammanställningen med källor och datum — inte av delsteg 8 allena. AC#5 av delsteg 7. AC#6 av delsteg 5.

Teknisk evidens: exakta kommandon med exitkoder; versionsuppgifter för Windows, Node, Electron och leverantörens paket eller CLI; committad lockfile; provrepots filinnehåll före och efter som innehållsidentifierad ögonblicksbild; sparad rålogg med hemligheter borttagna; artefaktens innehållssumma med byggkommando och källsnapshot; och utfallet av åtkomstsonderna. Allt ska kunna upprepas av Verifier på samma kodversion.

Niclas bedömning kan inte ersättas av agentkörningar: att provet använde hans avsedda konto, att artefakten startar och beter sig rimligt på hans dator, att startinstruktionen räcker för någon som inte skrivit koden, och om anslutningsvägen och friktionen är acceptabla. Tills han kört och bedömt står uppgiften i `Review`, inte `Done`.

### Öppna punkter som delstegen ska stänga

Anslutningsvägen avgörs av delsteg 1 och 4 tillsammans; reservvägen gör beslutet reversibelt. Godkännanden och återupptagning är okända i förväg och besvaras av delsteg 1 utan beslutsinsats från Niclas. Debiteringen är delvis okänd och löses med daterad dokumentationskontroll plus de två läsningarna i delsteg 4 och 5. Agent-i-agent-risken bör provas minst en gång från ett vanligt terminalfönster med noterade skillnader. Vem som kör byggkommandot: rekommendationen är att lösa det åt DSpatch-hållet, eftersom en underprocess som DSpatch själv startar ger exitkod, avbrott och ögonblicksbild under egen kontroll; reversibelt, men den andra vägens begränsningar dokumenteras. Provrepot ska vara ett litet ändamålsgjort TypeScript-repo med snabbt deterministiskt test, inte ett verkligt projekt. Paketeringsverktyget är den minsta kvarvarande öppna punkten.

Två förtydliganden som bör göras i beskrivningen när uppgiften startas: definiera vad "paketerat" betyder i AC#1:s mening — en körbar artefakt producerad av byggverktyget som startar utan dev-server, där installerare, signering och automatisk uppdatering inte ingår — och klargör att provets kod och instruktioner hör hemma i DSpatch-repot medan den arbetskopia agenten ändrar i är ett separat repo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Pass 1, 13 september 2026 — delsteg 1 klart, anslutningsvägen vald

Körjournal: `.dspatch-loop/runs/20260913-175023-g8t7/` (lokal, Git-ignorerad). Bascommit `5fd842c`, gren `main`, ren arbetskopia före och efter. Två specialistanrop av tolv, noll omtag. Ingen produktkod är skriven ännu och inget debiterat leverantörsanrop har gjorts.

Miljö: Windows 11 Home 10.0.26200.0 AMD64, Node v24.21.0, npm 11.19.0, Git 2.53.0, Python 3.12.10, Backlog.md 1.52.0, Cursor-appen 3.17.8 (commit `2fdd31c9f33f7fbe501f2d57772dc5bf64b63620`).

### Beslut: anslutningsvägen är A, `@cursor/sdk`

**Vald väg: `@cursor/sdk` 1.0.31, körd som adapter i en Node-process utanför renderingstråden. Reservväg: headless CLI (`agent`) med `--print --output-format stream-json`.**

Skälet är att A bär **sex** av de sju förmågorna i VISION 9.1:s integrationskontrakt med dokumenterat stöd och är den enda av de tre vägarna som exponerar kostnad i ören alls, med strukturerad skalutmatning med exitkod och ett avbrott vars effekt på pågående verktygsanrop är beskriven.

Den sjunde förmågan, **godkännanden per verktygsanrop, saknar A i programmatisk form.** Cursors dokumentation anger under *Known limitations* att "Hooks are file-based only (`.cursor/hooks.json`). No programmatic callbacks.", och under *Sandbox options* att "There's no human-in-the-loop approval flow in headless SDK runs". Det är dokumenterat frånvarande, inte okänt. Väg B, ACP, är den enda av de tre som dokumenterar ett godkännandeprotokoll. Det är inget hinder i Etapp 0, där DSpatch inte behöver grinda verktygsanrop — men det ska stå som saknat stöd och inte som uppfyllt. *(Korrigerat under uppföljningen; motiveringen påstod tidigare att samtliga sju förmågor var dokumenterade för A.)* Den bär dessutom DSP-4 genom `Agent.resume(agentId)` mot ett lokalt lager som överlever processomstart, vilket gör att DSP-4 AC#2 kan uppfyllas med leverantörens egen återupptagning i stället för att DSpatch återför sammanhanget själv.

Beslutet är reversibelt. Byt till reservvägen om SDK:t inte går att ladda i en **paketerad** Electron-app, om den lokala agentloopen visar sig instabil på Windows, eller om nyckelhanteringen visar sig oacceptabel medan `agent login` fungerar. Priset för ett byte är förlorad kostnadsrapportering och strukturerad exitkod, plus att avbrott får byggas på processdödning.

### Stödmatris från delsteg 1

`JA` = dokumenterat stöd, `DELVIS` = med förbehåll, `OKÄNT` = dokumentationen tiger, `NEJ` = dokumenterat frånvarande. Underlag: rapport 001.

| Punkt | A. `@cursor/sdk` | B. ACP | C. Headless CLI |
| --- | --- | --- | --- |
| Starta körning programmatiskt | JA | JA | JA |
| Strömmande svar | JA | JA | JA |
| Avbryta pågående körning | JA | JA | DELVIS |
| Ändra filer i arbetskopia | JA | JA | JA |
| Köra kommando, fånga resultat | JA | DELVIS | DELVIS |
| Anropbar från Node i paketerad Electron | **JA i dev-läge, paketering oprövad** | DELVIS | DELVIS |
| Återupptagning av session | JA | JA | JA |
| Godkännanden: programmatisk callback per verktygsanrop | **NEJ** (dokumenterat frånvarande) | JA | DELVIS |
| Godkännanden: policybaserad grindning (filhooks, sandlåda, auto-review) | JA | DELVIS | DELVIS |
| Godkännanden: svarsväg på strömhändelsen `{type:"request"}` | OKÄNT | — | — |
| Modellval och utläsning | JA | DELVIS | JA |
| Kostnad och förbrukning | JA | OKÄNT | NEJ |

### Electron-lastprovet — det som avgjorde valet

Punkt 6 var det enda måstekravet utan dokumentationsstöd: ingen Cursor-dokumentation nämner Electron. Provet kördes därför först, i en Git-ignorerad skrapkatalog, utan inloggning och utan debiterat anrop. Underlag: rapport 002 och råloggarna `logs/002-*.log`.

Resultatet är att **samtliga elva kontroller gav identiskt utfall i Electron 44.3.0 och i vanlig Node 24** — ingen runtimeskillnad alls. Electron 44 bär `node:sqlite`, `import('@cursor/sdk')` ger 76 toppnivåexporter, och `Agent.create()` går igenom både med och utan uttryckligt lager.

Tre fynd är värda att bära vidare:

- **Den vendorade tree-sitter-addonen laddas i båda runtimeerna** trots olika ABI (137 mot 149). Den är byggd mot Node-API och behöver inte byggas om för Electron. Detta var den största dolda Electron-risken och den är utesluten för dev-läge.
- **Med en medvetet ogiltig nyckel når anropet fram till Cursors autentiseringsendpoint** och får ett strukturerat avslag, `AuthenticationError: "Invalid User API Key"`. Det belägger tre saker: att modulen laddas, att initieringen fungerar, och att ett HTTPS-anrop från Electron-huvudprocessen till Cursors API kommer fram och besvaras i dev-läge på denna maskin. Det belägger **inte** att utgående nätverk fungerar i allmänhet, och inte att kedjan fungerar från en paketerad artefakt. Det som återstår är Niclas riktiga behörighet plus paketeringsprovet. *(Formuleringen preciserad under uppföljningen; den löd tidigare att "utgående nätverk fungerar från Electron-processen", vilket drog en vidare slutsats än provet bär.)*
- **`app.quit()` slukar exitkoden**; `app.exit(code)` gör det inte. Upptäckt genom en negativ kontroll som satte koden till 7 och fick 0 tillbaka. Gäller delsteg 3 och 7 där artefaktens exitkod ska redovisas.

### Fynd som ändrar planeringen framåt

**SDK:t återanvänder inte Cursor-appens inloggning.** Dokumentationen säger uttryckligen att det inte sker någon automatisk upptäckt av lokala inloggningsuppgifter. Delsteg 4 behöver därför antingen `CURSOR_API_KEY` eller ett engångs `Cursor.auth.login()` som öppnar webbläsaren och sparar en användarnyckel med 90 dagars livslängd i `~/.cursor/sdk/auth.json`. Rekommendationen är inloggningsflödet: inget hamnar i repot och Niclas insats blir ett webbläsarklick.

**Åtkomstsonderna i delsteg 5 väntas lyckas snarare än nekas.** Cursors sandlåda körs på Windows som deras Linux-sandlåda inne i WSL2, och både SDK och CLI kör osandlådat som default. Utfallet "lyckas" ska därför förväntas i förväg och inte tolkas som ett fel i provet — det säger i stället något viktigt om vad DSpatch själv måste bygga i fråga om inneslutning. Sondens utfall visar dock bara vad agenten nådde i just det provet: filsonderna en katalog utanför arbetskopian, nätverkssonden en lokal lyssnare på `127.0.0.1`. Det är inte den fulla omfattningen av vad agenten skulle kunna nå, och det belägger inte fri internetåtkomst.

**Två korrigeringar av felaktiga antaganden.** Den fristående CLI:n installeras på Windows i `%LOCALAPPDATA%\cursor-agent`, inte under `Programs\`; den saknas på båda platserna. Och npm-paketet `cursor-agent` 1.0.3 är **tredje part** — utgivare "Jacky", repo `zalab-inc/cursor_agent` — utan koppling till Cursor. Det ska inte installeras. Båda verifierade av koordinatorn med egna kommandon.

**Tredjepartspaketet installerades aldrig.** Klarlagt av koordinatorn under uppföljningen: det undersöktes enbart med `npm view`, som läser registermetadata utan att installera. Belägg — `cursor-agent` saknas i `probe-electron/package.json`, saknas som post i `package-lock.json` (ingen referens till `zalab-inc`), saknas i `node_modules` på disk, och `npm ls -g --depth=0` visar endast `backlog.md@1.52.0`. Det rätta paketet är bekräftat mot Cursors **egen installationsanvisning**, som anger `npm install @cursor/sdk` och uttryckligen varnar för namnförväxling; de fem plattformspaketen följer med som `optionalDependencies` pinnade till samma version och installeras inte separat.

**`cursor.cmd agent` är inte den dokumenterade headless-agenten.** `cursor.cmd agent --version` ger appens egen version, identisk med `cursor.cmd --version`; flaggan konsumeras av den yttre CLI:n. Sonden laddade inte ned någonting. Frågan om exakt vad underkommandot startar är inte helt besvarad men är inte längre beslutsrelevant.

**Hemlighetshygien:** det lokala agentlagret skriver `blobEncryptionKey` i klartext i `agents.ndjson`. Lagerfiler får aldrig committas eller läggas omaskerade i en rålogg. Ska in i delsteg 7:s namngivna hemlighetskontroll.

**Vad `blobEncryptionKey` faktiskt är** — utrett under uppföljningen ur SDK:ts egen typdeklaration (`dist/cjs/executor-types.d.ts`, stickprovskontrollerad av koordinatorn mot filen på disk). Fältet är en **per agent**-nyckel i hexform som skickas som HTTP-headern `x-blob-encryption-key` vid varje varv, så att servern håller sin tvärvarvscache av blobbar vid liv. Den krypterar alltså **inte** det lokala lagret på disk och är **ingen autentiseringsuppgift**. Utelämnas den faller runtimen tillbaka på en stabil process-intern nyckel; effekten blir en missad cache-träff, inte ett fel. Värdet ligger i agentpostens SDK-ägda metadataobjekt (`LocalAgentDocument.sdkMetadata`).

Allvarlighetsgraden ska skrivas ut rätt i delsteg 7: en läckt nyckel innebär att **konversationsinnehåll kan läsas** ur serverns cache för just den agenten — inte att kontot kan kapas, och ingen debiterad körning kan startas med den. Filen är ändå känslig utan nyckeln, eftersom den bär agent-ID, `cwd` och namn. Praktisk följd: lägg lagerkatalogen **utanför repot från början** när DSpatch sätter `JsonlLocalAgentStore` uttryckligen. Okänt: algoritm, nyckellängd, om servern roterar nyckeln och hur länge cachen lever — dokumentationssidan nämner aldrig fältet.

### Vad som inte är bevisat

Paketeringsfallet är oprövat — körningen skedde i dev-läge. Det som syntes pekar ut vad som måste lösas: `@cursor/sdk-win32-x64` innehåller `rg.exe`, `cursorsandbox.exe` och två `.node`-filer som måste ligga uppackade utanför asar-arkivet. Strömning, avbrott av pågående fjärranrop, agentens skalverktyg utan TTY, återupptagning och kostnadsrapportering är alla behörighetsberoende och återstår. Om Niclas privata konto kan prägla en användarnyckel är rimligt men oprövat.

### Pass 2, 13 september 2026 — avgränsad uppföljning av anslutningsvalet, genomförd

Samma körjournal, `.dspatch-loop/runs/20260913-175023-g8t7/`. Bascommit `7953f68`. Två specialistanrop (3 och 4), fyra av tolv förbrukade totalt, noll omtag. Underlag: rapport 003 (Researcher, jämförelse) och 004 (Reviewer, avstämning). Fortfarande ingen produktkod och inget debiterat leverantörsanrop.

### Slutsats: väg A står sig, och Copilot låses inte ute

Reviewer accepterade underlaget. Ingenting i jämförelsen motsäger valet av `@cursor/sdk`. Alla sju förmågor bärs av **Copilots** SDK (`@github/copilot-sdk` 1.0.13) och sex av sju av Cursors; den enda skillnaden till Copilots fördel är programmatiska godkännanden, och den är ett skäl att forma gränssnittet rätt — inte att byta väg.

Uppföljningen var befogad: pass 1:s underlag jämförde bara tre Cursor-vägar med varandra, och tre av de fyra inlåsningsriskerna nedan hade annars byggts in i delsteg 2.

**Detta är dokumentation, inget prov.** Ingen Copilot-integration är byggd, ingen körning gjord, inget konto använt. AC#1 kräver att vägen till VS Code/Copilot beskrivs och att kvarstående kompatibilitetsprov redovisas; det är vad detta är. Kalla det aldrig verifierad kompatibilitet.

### Fyra inlåsningsrisker som delsteg 2 ska undvika

1. **`Run` som förstklassigt objekt.** Copilot har ingen körningsnivå — `send()` returnerar ett meddelande-ID och händelser hör till sessionen. Modellera avbrott som "avbryt aktuellt varv i session X".
2. **Kostnad som ett tal i ören.** Cursor ger ören, Copilot ger nano-AIU, premiummultiplikatorer och kvot. En gemensam siffra vore påhittad. Bär enhet, omfattning och källa i varje post.
3. **Verktygens argument och resultat.** Cursor varnar uttryckligen att `args` och `result` saknar stabilt schema. Normalisera **envelopen** — ID, namn, status, tidsstämpel — aldrig innehållet, och spara råhändelsen bredvid.
4. **Prenumeration bunden till körning i stället för session** — Reviewers fynd, och det enda som är en korrekthetsfråga. `subscribe(runId)` efter `send()` tappar händelser hos båda: Copilots mönster är `session.on(...)` **före** första prompten, och Cursors race-fria väg är `onDelta`/`onStep` som skickas **in i** `send()`. Backlog-garantin för SSE gäller moln, inte den lokala runtime DSpatch använder.

Följden för delsteg 2: gränssnittet är **sessionsgranulärt**. `subscribe(sessionId, onEvent)` etableras vid sessionsstart före första `send`, och `cancel(sessionId)` betyder aktuellt varv. `dspatchRunId` bärs som fält på varje händelse så att gruppering per körning fungerar utan en körningsnivå i adaptern.

**Skriv ut invarianten: högst en aktiv körning per session.** Copilot dokumenterar "No session locking — concurrent access to same session is undefined" och lämnar det till applikationen; Cursor kastar `AgentBusyError` för moln. VISION 14 kräver ändå bara en skrivande körning i taget i Etapp 0.

**En operation som saknades: `dispose()`.** Copilots SDK startar en CLI-barnprocess (`client.start()`/`stop()`), Cursor har `agent.close()` och säger "Always dispose agents when done". En Electron-app som avslutas utan avveckling lämnar en runtimeprocess eller ett oavvecklat lager med WAL-filer kvar.

### Beslut: godkännanden bärs av gränssnittet från början

**Tillståndet `awaiting_approval` och metoden `respondToApproval` ingår i delsteg 2**, trots att Cursor-adaptern svarar "stöds inte" genom hela Etapp 0. Rutinmässigt och reversibelt gränssnittsval inom mandat; beslutat av koordinatorn efter Reviewers tillstyrkan.

Motiveringen vilar på Cursor och på beslutad målbild, inte på Copilot:

- Cursors egen strömtyp `SDKMessage` innehåller redan `{type:"request", request_id}`, dokumenterad som "Awaiting user input or approval". En adapter utan tillstånd för den måste kasta bort händelsen eller märka den fel.
- Delsteg 5 kräver redan att "en väntande godkännandefråga får inte rapporteras som en hängning", och VISION 13 kräver att väntan visas som väntan och att saknade uppgifter aldrig visas som positivt resultat.
- Kostnaden i delsteg 2 är ett medlemsnamn i en union och en metodsignatur, eftersom gränssnittet ännu inte anropar något. Det är att reservera ett namn, inte att bygga ett ramverk.

Tre villkor så att det förblir just ett reserverat namn:

1. Beslutsvokabulären hålls vid `allow-once` och `deny` med skäl. Copilots sju beslutstyper och scope-semantik ingår inte.
2. `capabilities().approvals` är `"unsupported"` för Cursor-SDK-adaptern, inte `"unknown"`. Det okända är svarsvägen på en enskild strömhändelse, inte förmågan.
3. Cursor-adaptern mappar `{type:"request"}` till tillståndet och sparar råhändelsen. Det gör det okända observerbart under delsteg 4–7 utan extra arbete.

`capabilities()` gäller **per adapterinstans, alltså leverantör plus transport** — inte per leverantör. Godkännanden är `unsupported` för Cursors SDK-väg men dokumenterat stödda för Cursors ACP-väg; ett svar per leverantör skulle ljuga så snart reservvägen används.

### Fältbeslut som skjuts upp från delsteg 2

Delsteg 2 skriver ett gränssnitt som ännu inget anropar. Dessa normaliserar mot noll faktiska utfall och låses därför inte nu: `pendingApproval.kind` med sex värden; Copilot-enheterna `nanoAiu` och `premiumRequests` i `unit`; `scope: 'agent'` (Cursors ord för det DSpatch kallar session); `seq` på händelseposten och `workspaceRevision` på körningen, som är DSpatchs egna observationer och hör till DSP-4; samt en egen felkodstaxonomi, som hör till DSP-3. Behåll `{message, providerCode?}`.

Två fältregler som däremot ska in, båda härledda ur beslutad målbild: `capabilities()` med tre värden inklusive `"unknown"`, eftersom VISION 9.1 kräver att saknat stöd framgår; och `value: null` för okänd förbrukning, aldrig `0`, eftersom VISION 12 säger att ett saknat kostnadsvärde inte ska presenteras som noll. `null` skiljer inte "dröjer" från "finns inte" — låt `source` och `observedAt` plus de två läsningarna i delsteg 4 och 5 bära den skillnaden.

### Paketeringsrisken är nu konkret, med dokumenterad motåtgärd

Cursors dokumentation har ett avsnitt, **Single-file bundles and compiled executables**, som pass 1 missade och som talar direkt till delsteg 3 och 7. Kontrollerat av koordinatorn direkt mot sidan:

> "The default build loads parts of itself lazily at runtime. Single-file bundlers can't follow those loads, so a compiled app fails on the first `Agent.create()` with an error like `Cannot find module './986.js'`."

Motåtgärden är dokumenterad: ett flat engångsbygge under ingångarna `@cursor/sdk/bundled` och `@cursor/sdk/bundled/sqlite`. Vidare gäller att nativa binärer inte kan ligga inne i en JavaScript-bunt — `node_modules/@cursor/sdk-<plattform>/` ska ligga bredvid den körbara filen, annars faller sökningen tillbaka på `rg` i `PATH` och `sandboxOptions` kastar `ConfigurationError`.

**Villkoret ska läsas rätt:** asar är ett arkiv, inte en bunt. Paketerar delsteg 3 utan att bunta huvudprocessen gäller lazy-load-problemet sannolikt inte. Buntas huvudprocessen med esbuild eller liknande — vanligt i Electron-uppsättningar — gäller det, och `@cursor/sdk/bundled` är då vägen. Detta ersätter inte paketeringsprovet; det gör felet igenkännbart i förväg.

### Två korrigeringar av rapport 003

Rapporterna är journalposter och skrivs inte om i efterhand. Dessa två punkter i rapport 003 är korrigerade här och ska inte hämtas direkt ur rapporten:

- **Stödmatrisens godkännanderad.** Rapporten föreslog `okänt` för Cursor. Rätt värde är dokumenterat frånvarande för den programmatiska callbacken; se den tredelade raden i matrisen ovan.
- **Påståendet om `agentId`-prefixet.** Rapporten varnade för att ett eget ID "riskerar att styra runtime-detektionen fel". Dokumentationen säger tvärtom: "Runtime is auto-detected from the ID prefix (`bc-` is cloud, **anything else is local**)", och `agentId` beskrivs som "Durable agent ID. Pass to keep a stable ID across invocations." Ett godtyckligt DSpatch-ID detekteras alltså som lokalt, vilket är rätt runtime. Den enda verkliga regeln är: **prägla aldrig ett ID som börjar med `bc-`.** Rekommendationen att DSpatch äger egna ID:n med mappning till leverantörens står kvar — den behövs för Copilot, där ett eget filnamnssäkert ID är en förutsättning för återupptagning.

### Kvarstående efter uppföljningen

Copilots pending-semantik utan handler, dess sju beslutstyper och `request.kind`-värdena är obekräftade av Reviewer och ska inte citeras som kontrollerade. Svarsvägen på Cursors `{type:"request"}` är fortfarande okänd, men blir observerbar genom villkor 3 ovan. Om avbrott stoppar det pågående fjärranropet är odokumenterat hos **båda** — AC#3 frågar uttryckligen, så delsteg 6 måste mäta det. Copilot-SDK:ts Electron-lämplighet är helt oprövad. Allt som pass 1 listade som obevisat står kvar oförändrat.

### Pass 2, forts. — delsteg 2 genomfört, men Implementer-anropet avbröts

**Avvikelse att känna till:** Implementer-anropet (anrop 5) avbröts av plattformen innan agenten hann lämna sin slutrapport. Arbetet hann bli klart och ligger på disk; det som saknas är agentens egen redovisning. Koordinatorn klarlade utfallet genom att köra kontrollerna själv i stället för att upprepa anropet, enligt regeln att ett okänt utfall ska klarläggas före omtag. **Ingen oberoende verifiering av delsteg 2 har gjorts än** — koordinatorns körningar är evidens, men inte oberoende.

Skelettet ligger i `app/`, skilt från `scripts/` och `tests/` som innehåller Python-verktyg för utvecklingsloopen.

**Versioner, exakt låsta utan `^` eller `~`:** Electron 44.3.0 (samma som lastprovet i pass 1, så att en verifierad variabel inte byts), React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, `@vitejs/plugin-react` 6.1.1, `@types/node` 24.13.4. Lockfilen `app/package-lock.json` är spårbar i git; `git check-ignore` ger ingen träff. `node_modules/` och `/app/dist/` är ignorerade.

**Bygguppsättningen buntar inte huvudprocessen.** Renderaren byggs av Vite, huvudprocessen och preload av `tsc` till vanliga moduler som löser `node_modules` normalt. Det är ett medvetet val mot Cursors dokumenterade lazy-load-problem: en buntad huvudprocess skulle falla på första `Agent.create()` med `Cannot find module './986.js'` i delsteg 4. Renderaren rör aldrig SDK:t.

**Inget SDK-beroende.** `@cursor/sdk` finns inte i `package.json` och lockfilen innehåller ingen referens till `cursor`. Det är avsiktligt: delsteg 3 ska paketera ett tomt skelett, så att paketeringsfel och anslutningsfel kan skiljas åt.

**Kontroller körda av koordinatorn på detta innehåll:**

| Kommando | Utfall | Exitkod |
| --- | --- | --- |
| `npm run typecheck` (node, renderer, tools) | rent | 0 |
| `npm run build` (`tsc` + `vite build`, 16 moduler) | rent | 0 |
| `DSPATCH_SMOKE=1 npx electron .` | fönstret visas, renderaren målar | 0 |

Rökprovets utmatning är den egentliga evidensen för att fönstret öppnas, inte att kommandot startade: `did-finish-load`, sedan `renderer-ready heading="DSpatch" capabilities=7`, sedan `fönstret visas bounds={"x":800,"y":266,"width":960,"height":860}`.

**Adaptergränssnittet följer den beslutade formen.** Sessionsgranulärt — `subscribe(sessionId, …)` och `cancel(sessionId)`, ingen körningsnivå; `RunReference` bär bara `dspatchRunId`. `dispose()` finns. `RunStatus` innehåller `awaiting_approval`. `CapabilitySupport` har tre värden. Samtliga uppskjutna fältbeslut är utelämnade: `ApprovalRequest` har tre fält utan `kind`, `UsageUnit` är `tokens | cents`, `UsageScope` saknar `agent`, `AdapterError` är `{message, providerCode?}`. `ApprovalDecision` är `allow-once` eller `deny` med skäl. `NotImplementedAdapter` kastar på allt och rapporterar `unsupported`.

**Ett rapporterat Electron-fynd som inte kunde återskapas.** Implementer dokumenterade i `main.ts` att processen inte avslutas alls om man försöker avsluta i `did-fail-load` innan fönstret visats — att varken `app.exit()` eller `process.exit()` terminerade, att timers slutade köra, och att ett prov hängde i tre minuter. Koden väntar därför på att fönstret visas innan den avslutar.

**Verifier kunde inte återskapa hängningen** (13 september 2026, Electron 44.3.0 på denna maskin). Sex varianter — `ERR_FILE_NOT_FOUND` och `ERR_CONNECTION_REFUSED`, vardera med `app.exit(9)` direkt, `process.exit(9)` direkt och väntan på `show` — avslutade samtliga med kod 9 inom 0,4 till 3,8 sekunder. Timers fortsatte köra. Ingen process behövde dödas utifrån.

Statusen är därmed **okänd, inte falsk**: Implementers ursprungliga provkod och logg finns inte bevarad, eftersom anropet avbröts. Påståendet ska inte bäras vidare som konstaterat faktum. **Mekanismen behålls** — väntan på att fönstret visas fungerar och kostar ingenting, vilket negativprovet nedan visar — men kodkommentarens formulering bör nedgraderas till en observation vid nästa tillfälle någon ändå arbetar i `main.ts`.

**`SessionConfig.workspacePath` är avsedd.** Verifier frågade om fältet hör hemma på adapterns yta. Ja: det är indata till sessionen, inte en observation. Det som skjuts upp är `workspaceRevision` på körningen, som är något DSpatch själv observerar.

### Pass 2, forts. — delsteg 2 oberoende verifierat och godkänt

**Kandidat:** manifest `.dspatch-loop/runs/20260913-175023-g8t7/snapshots/delsteg-2-source-v2.sha256`, 20 källfiler under `app/`, filens egen SHA-256 `ba7e6dbd9334db031b6cad07dc097a48af5a20d5508c30dff1c3dfe6975e1e74`. Den summan går att kontrollera direkt med `Get-FileHash` eller `sha256sum`.

*(Den första ögonblicksbilden hade två fel som Verifier fann: den missade `app/vite.config.mts`, som styr renderarbygget och CSP-injiceringen, och dess angivna summa var beräknad på normaliserat innehåll i stället för filens byte och gick därför inte att reproducera. Båda rättade ovan.)*

**Omdöme: delsteg 2 håller. Inga blockerande fynd.** Verifier bekräftade samtliga sex av koordinatorns påståenden med egna körningar och fann **ingen avvikelse i någon riktning** i adaptergränssnittet — varken något som saknas eller något uppskjutet som smugit sig in. Sexton kontrollpunkter mot besluten, alla PASS.

**Fem kontroller utöver koordinatorns, alla godkända:**

- **Bygget är bit-identiskt reproducerbart.** Efter `clean` och ombygge är alla 16 artefakter oförändrade, inklusive `dist/main/main.js`.
- **Renderaren når bevisligen ingen Node.** Utvärderat i renderarens eget världskontext via DevTools-protokollet: `require`, `process`, `module`, `global`, `__dirname` och `Buffer` är alla `undefined`, och `require("node:fs")` kastar. `window.dspatch` exponerar exakt två funktioner. Att `sandbox: true` slog igenom är belagt separat — renderarprocessens kommandorad bär `--enable-sandbox`, och ingen av de fyra Electron-processerna har `--no-sandbox`.
- **Huvudprocessen buntas verkligen inte.** `dist/main/main.js` är `tsc`-utmatning med tre `require`-anrop och en modulgraf som ligger kvar som separata filer. Vite rör den inte. Det är det som håller Cursors lazy-load-problem borta i delsteg 4.
- **Rökprovet kan misslyckas.** Utan byggd renderare ger det exitkod **2**, utan `renderer-ready` och utan framgångsrad. Ett prov som alltid ger 0 vore värdelöst som evidens.
- **Dev-läget fungerar också**, inte bara byggda filer: Vite på `http://localhost:5273/`, fönstret visas, exit 0, porten släppt efteråt. Delsteg 2 handlar ordagrant om dev-läge, så det var den kontroll som saknades.

**En nyans att bära vidare:** `did-finish-load` loggas **även** för Chromiums egen felsida och skiljer alltså inte framgång från fel. De diskriminerande raderna är `renderer-ready …` och `startprovet lyckades …`.

**Oprövat:** rökprovets exitkoder 3 (tidsgräns) och 4 (`render-process-gone`) är dokumenterade men inte framkallade; de blir relevanta i delsteg 3 och 7. `npm install` från tom `node_modules` är inte körd. Reproducerbarheten gäller denna maskin i dag, inte över tid eller maskiner.

**Väntar på Niclas:** att fönstret ser rimligt ut och att adaptergränssnittets form är den han vill leva med. Belagt är att fönstret visas och målar rätt rubrik, sju förmågerader och rätt versioner — inte att det ser bra ut.

### Pass 2, forts. — delsteg 3 genomfört och oberoende verifierat

**Paketeringsverktyget var planens sista öppna punkt. Valet är `electron-builder` 26.15.3, målet `dir`** — en uppackad körbar katalog, ingen installerare. Det motsvarar AC#1:s definition av "paketerat": en körbar artefakt producerad av byggverktyget som startar utan dev-server. Konfigurationen ligger i `app/electron-builder.yml` i stället för i `package.json`, eftersom den måste bära en kommenterad vägvisare inför delsteg 7 och strikt JSON inte kan det.

Ett val Implementer gjorde på eget initiativ och som är rätt: `directories.output` är `release`, inte electron-builders standard `dist`, som redan ägs av `tsc` och Vite. De hade skrivit över varandra.

**Artefakten:** `app/release/win-unpacked/DSpatch.exe`, 234,7 MB, katalogen 386 403 525 byte i 72 filer. Identifierad med innehåll, inte sökväg:

| | SHA-256 |
| --- | --- |
| Källmanifest (21 filer) | `74b98aa0965dcd9620670e0b2923c9fd5d948dc7aa4dd874740007c0a9a00148` |
| Katalogmanifest (72 filer) | `a480598062fd178ce5578681e7b4517c218f043e27bfcbb789aef40aa935add6` |
| `DSpatch.exe` | `d65d0acc65e166e842fd63fec33f856231ddc5d1b1bbdb721bbd0f0e0ee2add7` |
| `app.asar` | `9b90003085da29a01474e08016c54033e6c8b0c80268e2692d718cda4d24b3ae` |

Artefakten kan inte förväxlas med delsteg 7:s, och det gäller alla tre summorna: `app.asar` ändras av SDK-innehållet, `DSpatch.exe` ändras därför att asar-integritetssumman skrivs in i den, och katalogmanifestet ändras av `app.asar.unpacked`.

**Omdöme: delsteg 3 håller. Inga blockerande fynd.** Verifier prövade åtta påståenden självständigt, alla PASS.

- **Artefakten startar utan dev-server**, exitkod 0, med `renderer-ready` och `startprovet lyckades`. Laddar `file:///…/app.asar/dist/renderer/index.html`; ingen `http://`-URL förekommer.
- **Beviset diskriminerar.** Samma artefakt pekad mot den stängda dev-porten ger exitkod **2**. `did-finish-load` loggas även då, för Chromiums felsida — det är de två andra raderna som skiljer.
- **Noll produktionsberoenden i artefakten.** `asar list` ger 24 poster: bara `dist/**` och `package.json`. Vite har buntat in React, så ingenting ur `node_modules` behövs.
- **Paketeringen är byte-identiskt reproducerbar.** Tre byggen från rent läge gav samma bytes, alla 72 filer. Gäller denna maskin, denna dag, med varm cache — inte över maskiner eller tid.
- **Osignerad**, belagt med `Get-AuthenticodeSignature`. Byggloggens rad om `signtool.exe` avser asar-integritetssumman, inte kodsignering.
- **17 av 20 filer byte-identiska med delsteg 2:s verifierade kandidat.** Ingen applikationskod ändrades av paketeringen.

**Startinstruktionens första utkast ligger i `app/README.md`**, inte i en ny fil — filen var redan startinstruktionen för samma målgrupp. Den täcker klona, installera, dev-läge, bygga, paketera och köra artefakten, plus vad som inte fungerar ännu. Hemlighetssökning över alla 21 källfiler gav inga nycklar, inga kontonamn och inga maskinspecifika sökvägar. Klon-URL:en är skriven som `<repots URL>` eftersom den verkliga innehåller ett kontonamn.

**AC#5 bärs inte av detta.** Verifier korrigerade en felskrivning i överlämningen: planen tilldelar AC#5 till delsteg 7, och delsteg 3 skriver bara ett första utkast. AC#5 har dessutom en andra halva om nästa steg mot arbetsytan som README inte berör. Inget acceptanskriterium har kryssats på delsteg 3.

### Två rättelser som bärs in i delsteg 7

Båda sitter i `app/` och rättas **inte** nu, eftersom en ändring skulle bryta den nyss verifierade kandidaten `74b98aa0…` utan att tillföra något i detta läge.

1. **README:s SmartScreen-stycke saknar förbehåll på sin mittersta punkt.** Första och tredje punkten är märkta som observerad respektive oprovad. Den mellersta — dialogen "Windows har skyddat din dator" vid kopierad eller nedladdad artefakt — står omärkt och läses därför som provad. Den är den inte. En mening räcker.
2. **`asarUnpack`-vägvisaren nämner inte fällan som faktiskt fäller delsteg 7.** Kommentaren är i övrigt bra, men `files`-listan slutar med `!node_modules/**/*`, och den raden utesluter produktionsberoenden **tyst**. Det är belagt, inte teoretiskt: bygget har redan släppt igenom två deklarerade beroenden — `react` och `react-dom` finns i artefaktens `package.json` men inte i arkivet — med exitkod 0 och utan en enda varning. I dag harmlöst, eftersom Vite buntat in dem. I delsteg 7 blir samma tystnad ett fel som visar sig först vid första `Agent.create()`, **med en felsignatur som liknar lazy-load-problemet** — två olika orsaker med snarlik yta. Vägvisaren ska säga att negationen måste hävas eller ordnas efter det nya `files`-mönstret, och att innehållet ska kontrolleras med `asar list` efteråt.

### Kvarstående inför delsteg 4

Rökprovets exitkoder 3 (tidsgräns) och 4 (renderarprocessen försvann) är dokumenterade men aldrig framkallade; 0 och 2 är nu belagda från artefakten. SmartScreen-dialogen är oobserverad, bekräftat av två oberoende parter. Bara Windows x64, ingen ikon, `author` saknas — allt korrekt redovisat och utan betydelse för målet `dir`.

**Väntar på Niclas:** att köra `app\release\win-unpacked\DSpatch.exe` och bedöma intrycket, och att bedöma om adaptergränssnittets form är den han vill leva med. Att fönstret visas och målar rätt innehåll är belagt maskinellt; att det ser bra ut är det inte.

### Nästa steg

**Delsteg 4 kräver Niclas medverkan** och passet pausar därför här. Adaptern ska ansluta genom hans konto och ge ett riktigt strömmande svar plus en följdfråga i samma session. SDK:t återanvänder inte Cursor-appens inloggning, så steget behöver antingen `CURSOR_API_KEY` eller ett engångs `Cursor.auth.login()` som öppnar webbläsaren och sparar en användarnyckel med 90 dagars livslängd i `~/.cursor/sdk/auth.json`. Rekommendationen är inloggningsflödet: inget hamnar i repot och insatsen är ett webbläsarklick. Detta är också det första steget som gör ett debiterat leverantörsanrop.
<!-- SECTION:NOTES:END -->
