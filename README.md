# DSpatch

An experimental development workspace for human–AI collaboration and autonomous agent workflows, focused on simplicity, code understanding, and evolving how software is built.

## Börja här

| Underlag | Innehåll |
| --- | --- |
| [Styrdokument](docs/VISION.md) | Målbilden i sin helhet, version 1.5. Markdown är det styrande originalet. |
| [Agentinstruktioner](AGENTS.md) | Kort läsordning, principer och arbetsregler. |
| [Utvecklingsplan](BACKLOG.md) | Förslag till första milstolpen, ordning och länkar till sex små uppgifter. |

Det här är projektets första dokument- och planeringsförslag. Produktkod, GUI-teknik, första målplattform och verifierad agentanslutning återstår. DSpatch ska ge nytta redan som en liten interaktiv chatt och sedan utvecklas genom faktisk användning.

Maestro är orkestratorns interna arbetsnamn. Människointeraktivt arbete och autonom iteration är båda delar av målbilden; användaren väljer graden av medverkan.

## Granska direkt på GitHub

Öppna utvecklingsplanen ovan och följ länkarna till uppgifterna. Varje uppgift beskriver nyttan, avgränsningen, beroendena och hur resultatet ska bedömas. GitHubs förhandsvisning räcker för att läsa förslaget och kommentera det i pull requesten.

## Öppna Backlogs webbgränssnitt lokalt

När du har klonat repot och hämtat grenen med dessa filer, installera Backlog.md och starta det från repots rot. Kommandona förutsätter Node.js/npm:

```sh
npm install -g backlog.md
backlog browser
```

Backlog-konfiguration och uppgifter finns redan i `backlog/`, så någon ny `backlog init` behövs inte. Kommandot öppnar den lokala tavlan i webbläsaren. Håll terminalprocessen igång medan du använder den. Det här startar planeringsverktyget; DSpatch-applikationen byggs i de planerade uppgifterna.

Planeringen läser den aktuella arbetskopian. Backlogs automatiska fjärranrop och sökning i andra grenar är avstängda i detta första förslag. Hämta och publicera ändringar med vanligt Git när det behövs. En MCP-anslutning behövs inte för att läsa eller uppdatera planen.

Se även [Backlog.mds officiella dokumentation](https://github.com/MrLesk/Backlog.md).
