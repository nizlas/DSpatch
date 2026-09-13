# DSpatch utvecklingsplan

Utvecklingsplan, uppdaterad 13 september 2026. Underlag: [VISION.md version 1.8](docs/VISION.md). Uppgifterna är planerade och ännu inte genomförda. TypeScript, React och Electron är valt teknikspår, med Windows och Linux i målbilden. Första implementation och provkörning sker med Cursor på Niclas Windowsdator. DSP-1 verifierar teknikspåret och väljer och provar den konkreta Cursor-anslutningen; se [beslut och motiv](docs/VISION.md#91-valt-teknikspår-och-plattformar). Nyttan och lärandet i varje inkrement får ändra planen.

## Nästa konkreta steg

Börja med **DSP-7**, ett förberedelsesteg som provar [utvecklingsloopen](docs/DEVELOPMENT_LOOP.md) i Cursor: verkliga specialistanrop, planeringskvalitet och återupptagning. ID:t är senare tilldelat men uppgiften ligger först i arbetsordningen.

Därefter kommer **DSP-1**: verifiera det valda teknikspåret och vägen via Cursor till agentsvar, faktisk filändring och bygge eller test, inklusive ett minimalt paketerat Windowsprov. **DSP-2** bygger arbetsytan i små körbara delsteg: chatt, kodändring med diff och körkommando. Niclas kan prova delresultaten tidigt; **DSP-5** bedömer sedan hela ändringsflödet utan att behöva vänta på fördjupad felåterhämtning i DSP-3 och sparad historik i DSP-4.

Linuxstödet införs och verifieras stegvis, med enhetlig arbetsyta som mål; Linuxprov är inget krav för Etapp 0. VS Code/Copilot finns kvar i målbilden. Teknikvalen ska ge utrymme för det stödet, men implementation och provkörning med VS Code/Copilot krävs inte i Etapp 0. Kvarstående kompatibilitetsprov dokumenteras i DSP-1.

Målet är en arbetsyta som Niclas vill använda för en verklig utvecklingsfråga. Planeringsverktyget ska ge honom effektivitet och tydlig överblick; externa dashboards, Jira och demovärde är inga krav för detta projekt.

## Etapp 0 – Gör en verklig kodändring med DSpatch

[Milstolpens mål och bedömning](backlog/milestones/m-0%20-%20forsta-anvandbara-chatten.md)

| Uppgift | Steg | Nytta efter steget | Beror på |
| --- | --- | --- | --- |
| [DSP-7](backlog/tasks/dsp-7%20-%20Kalibrera-utvecklingsloopen-i-Cursor.md) | Kalibrera utvecklingsloopen i Cursor | Provad samordning och bedömd planeringskvalitet innan produktarbetet delegeras. | Inga |
| [DSP-1](backlog/tasks/dsp-1%20-%20Valj-teknik-och-verifiera-agentanslutningen.md) | Verifiera teknikvalet och första Cursor-anslutningen | En provad väg till agentsvar, filändring och körresultat via Cursor. | DSP-7 |
| [DSP-2](backlog/tasks/dsp-2%20-%20Oppna-projekt-och-ha-en-forsta-konversation.md) | Öppna ett repo, ändra kod och granska resultatet | En körbar arbetsyta för en liten kodändring, vanlig diff och bygge/test. | DSP-1 |
| [DSP-3](backlog/tasks/dsp-3%20-%20Avbryt-och-aterhamta-en-chattkorning.md) | Avbryt och återhämta agent- och testkörningar begripligt | Tappad anslutning och avbrott lämnar ett begripligt läge med arbetet bevarat. | DSP-2 |
| [DSP-4](backlog/tasks/dsp-4%20-%20Spara-och-fortsatt-en-konversation.md) | Spara konversation, ändringar och körresultat efter omstart | Resonemang, granskad diff och körresultat finns kvar nästa gång programmet öppnas. | DSP-2 |
| [DSP-5](backlog/tasks/dsp-5%20-%20Provkor-forsta-chatten-med-Niclas.md) | Provkör kodändringsflödet med Niclas och fånga friktionen | Verklig användning av hela ändringsflödet avgör vad som hjälper, stör eller saknas. | DSP-2 |
| [DSP-6](backlog/tasks/dsp-6%20-%20Forbattra-friktionen-och-folj-upp-chattflodet.md) | Förbättra största friktionen och följ upp hela utvecklingsflödet | Första milstolpen bedöms från uppdrag till kodändring och test, inklusive återhämtning. | DSP-3, DSP-4, DSP-5 |

Tabellen är en läsöversikt över omfattning och ordning. Uppgiftsfilerna är källan för aktuell status, detaljer, kriterier och resultat. Uppdatera översikten när riktning eller omfattning ändras; håll inte en separat statusbokföring här. Beroendena anger vilket underlag som behövs och innebär inte automatiskt parallella skrivande agenter.

## Förbättringar av utvecklingsloopen

Dessa uppgifter gäller arbetsformen som bygger DSpatch. De ligger utanför produktens Etapp 0-milstolpe och inför inte nya beroenden för DSP-1–6. Prioritera dem utifrån observerad nytta efter kalibreringen; DSP-1 är fortsatt nästa produktsteg efter DSP-7.

| Uppgift | Nytta | Beror på |
| --- | --- | --- |
| [DSP-8](backlog/tasks/dsp-8%20-%20Prova-uppgiftsstyrt-modellval-i-utvecklingsloopen.md) – Prova uppgiftsstyrt modellval i utvecklingsloopen | Koordinatorn väljer modell och resonemangsnivå efter det konkreta uppdraget, med synligt motiv, fast användarval och verifierat faktiskt modellval. | DSP-7 |

DSP-8 börjar med att prova Cursors faktiska styrmöjligheter och jämföra med fast modellval. [Modellvalsförslaget](docs/MODEL_SELECTION.md) är planerat arbete, inte en redan aktiv funktion. Det ändrar inte den pågående kalibreringen.

## Vad som avgör om vi är klara

Efter **DSP-6** ska Niclas kunna öppna ett repo, diskutera en liten uppgift, låta agenten göra en verklig kodändring, granska berörda filer och hela textdiffen samt köra relevant bygge eller test och se resultatet för rätt kodversion. Han ska kunna följa upp, be om ett omtag, avbryta och fortsätta efter omstart. Fel ska ge en begriplig väg vidare; tidigare ändringar och körresultat ska bevaras utan automatisk upprepning.

Hela milstolpen kräver både teknisk verifiering och Niclas egen bedömning av detta utvecklingsflöde. Hans första återkoppling kan börja med den enkla chatten. En avancerad diffvy, egen editor, autonom loop, automatisk commit eller push behövs inte för att uppnå milstolpen.

Knyt återkoppling, tester och granskning till den version som faktiskt kördes. För uppgifter som uttryckligen kräver Niclas provkörning kan agenten förbereda och verifiera tekniken, men mänsklig acceptans förblir öppen tills den har lämnats. Annat avgränsat arbete kan fortsätta inom givet mandat medan vi väntar.

## Status och återupptagning

| Status | Betydelse |
| --- | --- |
| To Do | Planerat arbete; kontrollera beroenden och givna mandat innan start. |
| In Progress | Någon arbetar aktivt med uppgiften. Ange aktuellt fokus i uppgiften. |
| Review | Ett konkret resultat finns att bedöma. Ange vem eller vad som återstår; det är inte samma sak som godkänd UX. |
| Blocked | Ett hinder stoppar meningsfullt fortsatt arbete. Ange orsaken, vad som provats och exakt vad som behövs. |
| Done | Uppgiftens kriterier och relevanta kontroller är uppfyllda, inklusive uttryckligen efterfrågad mänsklig bedömning. |

Flytta tillbaka till In Progress vid omtag. Kryssa bara i verifierade kriterier och bevara tidigare relevanta resultat. Vid paus eller fel ska uppgiften ange senaste verifierade läge, kvarstående problem och nästa handling. Backlog-status beskriver arbetet; den är inte i sig bevis för att en agentprocess kör eller har stoppats.

## Granska och arbeta med planen

På GitHub kan du läsa och kommentera uppgiftsfilerna i pull requesten. I en lokal arbetskopia med Backlog.md installerat:

```sh
backlog browser
backlog task list --json
backlog task view DSP-1 --plain
```

Använd webbgränssnittet eller CLI:t för normal uppgiftshantering. När verktyget saknas kan filerna granskas och redigeras via GitHub; bevara YAML-fälten och Backlogs sektionsmarkörer. Varje uppgift har stabilt ID och egna acceptanskriterier. `AGENTS.md` anger arbetsreglerna; ingen MCP-anslutning eller extern planeringstjänst behövs.

Konfigurationen läser den aktuella arbetskopian utan automatiska fjärranrop eller insamling från andra grenar. Git används uttryckligen för att hämta och dela ändringar. Vi provar detta enkla upplägg först; det är ett verktygsval för utvecklingen och låser inte DSpatchs framtida interna datamodell.

## Efter första milstolpen

Etapp 1–4 i [styrdokumentet](docs/VISION.md#14-etapper-för-genomförande) är riktningen: först tydligare uppgifter och körhistorik ovanpå det fungerande ändringsflödet, därefter djupare kodförståelse, Maestro och fler arbetsformer. Detaljera nästa inkrement efter erfarenheterna från Etapp 0. En avancerad editor, komplett agentnätverk eller alla integrationer ska inte behövas för att få nytta av första versionen.

## Format och verifieringsläge

Backlog-filerna följer projektets dokumenterade konfiguration, uppgiftsformat och milstolpsformat. De är kontrollerade mot [Backlog.mds källkod](https://github.com/MrLesk/Backlog.md/tree/c0ec546a3b519c0c7b83070fe936f6bf49e14357), vars paketversion är 1.52.0. CLI och webb-API har provats med de sju ursprungliga uppgifterna i en isolerad kopia. Niclas har den 13 september 2026 även installerat 1.52.0 och bekräftat att webbgränssnittet fungerar på Windows. DSP-1–7 hör till milstolpen m-0; DSP-8 är en separat förbättring av utvecklingsloopen utan tilldelad milstolpe. Att planeringen visas korrekt bevisar inte att agentloopen eller produktintegrationen fungerar.
