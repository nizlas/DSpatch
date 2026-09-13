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
2. **Körbart skelett i dev-läge.** TypeScript, React och Electron startar ett fönster på Windows med låsta versioner och committad lockfile. Adaptern finns som gränssnitt men anropar ännu inget.
3. **Paketera det tomma skelettet.** En körbar artefakt utan dev-server, innan agentanslutningen finns, med innehållssumma och källsnapshot noterade så att den inte förväxlas med artefakten i delsteg 7. Syftet är att separera paketeringsfel från anslutningsfel; motivet är ett erfarenhetsbaserat antagande, inte belagt faktum. **Startinstruktionens första utkast skrivs redan här**, så att bara den paketerade delen tillkommer sent.
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
