# DSpatch utvecklingsplan

Första förslag, 13 september 2026. Underlag: [VISION.md version 1.6](docs/VISION.md). Uppgifterna är planerade och ännu inte genomförda. Nyttan och lärandet i varje inkrement får ändra denna plan; Cursor är vald för första integrationen och testningen på Niclas hemmadator, medan GUI-teknik och konkret anslutningsväg återstår att välja.

## Nästa konkreta steg

Börja med **DSP-1**: verifiera en första Cursor-anslutning och välj den minsta tekniska grund som kan ge en användbar chatt. När chatten i **DSP-2** går att köra, förbered **DSP-5** så att Niclas kan prova den tidigt. Felåterhämtning och historik kan utvecklas medan provkörningen planeras.

VS Code/Copilot finns kvar i målbilden. Teknikvalen ska ge utrymme för det stödet, men implementation och provkörning med VS Code/Copilot krävs inte i Etapp 0. Kvarstående kompatibilitetsprov dokumenteras i DSP-1.

Målet är en arbetsyta som Niclas vill använda för en verklig utvecklingsfråga. Planeringsverktyget ska ge honom effektivitet och tydlig överblick; externa dashboards, Jira och demovärde är inga krav för detta projekt.

## Etapp 0 – En chatt att använda i verkligt projektarbete

[Milstolpens mål och bedömning](backlog/milestones/m-0%20-%20forsta-anvandbara-chatten.md)

| Uppgift | Steg | Nytta efter steget | Beror på |
| --- | --- | --- | --- |
| [DSP-1](backlog/tasks/dsp-1%20-%20Valj-teknik-och-verifiera-agentanslutningen.md) | Välj teknik och verifiera första Cursor-anslutningen | En provad väg från eget program till ett riktigt agentsvar via Cursor. | Inga |
| [DSP-2](backlog/tasks/dsp-2%20-%20Oppna-projekt-och-ha-en-forsta-konversation.md) | Öppna ett projekt och ha en första konversation | En liten körbar arbetsyta att börja diskutera verkliga projektfrågor i. | DSP-1 |
| [DSP-3](backlog/tasks/dsp-3%20-%20Avbryt-och-aterhamta-en-chattkorning.md) | Avbryt och återhämta en chattkörning begripligt | Tappad anslutning och avbrott lämnar ett begripligt läge att arbeta vidare från. | DSP-2 |
| [DSP-4](backlog/tasks/dsp-4%20-%20Spara-och-fortsatt-en-konversation.md) | Spara och fortsätt projektets konversation efter omstart | Resonemanget och projektkopplingen finns kvar nästa gång programmet öppnas. | DSP-2 |
| [DSP-5](backlog/tasks/dsp-5%20-%20Provkor-forsta-chatten-med-Niclas.md) | Provkör första chatten med Niclas och fånga friktionen | Verklig användning avgör vad som hjälper, stör eller saknas. | DSP-2 |
| [DSP-6](backlog/tasks/dsp-6%20-%20Forbattra-friktionen-och-folj-upp-chattflodet.md) | Förbättra största friktionen och följ upp hela chattflödet | Första milstolpen bedöms mot ett helt arbetsförlopp och faktisk nytta. | DSP-3, DSP-4, DSP-5 |

Tabellen är en läsöversikt över omfattning och ordning. Uppgiftsfilerna är källan för aktuell status, detaljer, kriterier och resultat. Uppdatera översikten när riktning eller omfattning ändras; håll inte en separat statusbokföring här. Beroendena anger vilket underlag som behövs och innebär inte automatiskt parallella skrivande agenter.

## Vad som avgör om vi är klara

En användare ska kunna välja projekt, diskutera en riktig fråga, få strömmande svar, ställa följdfrågor, avbryta och fortsätta efter omstart. Fel ska ge en begriplig väg vidare. Hela milstolpen kräver både teknisk verifiering och Niclas egen bedömning. Hans första provkörning behöver däremot inte vänta på alla funktioner.

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

Etapp 1–4 i [styrdokumentet](docs/VISION.md#14-etapper-för-genomförande) är riktningen: först uppgifter och faktiska ändringar, därefter djupare kodförståelse, Maestro och fler arbetsformer. Detaljera nästa inkrement efter erfarenheterna från Etapp 0. En avancerad editor, komplett agentnätverk eller alla integrationer ska inte behövas för att få nytta av första versionen.

## Format och verifieringsläge

Backlog-filerna följer projektets dokumenterade konfiguration, uppgiftsformat och milstolpsformat. De är kontrollerade mot [Backlog.mds källkod](https://github.com/MrLesk/Backlog.md/tree/c0ec546a3b519c0c7b83070fe936f6bf49e14357), vars paketversion är 1.52.0. Detta förslag omfattar fil- och innehållskontroller; Backlogs CLI och webbgränssnitt har ännu inte provkörts med DSpatch-planen. Första lokala provet ska bekräfta att alla sex uppgifter, milstolpen och de fem statuskolumnerna visas som avsett.
