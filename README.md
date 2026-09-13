# DSpatch

An experimental development workspace for human–AI collaboration and autonomous agent workflows, focused on simplicity, code understanding, and evolving how software is built.

## Börja här

| Underlag | Innehåll |
| --- | --- |
| [Styrdokument](docs/VISION.md) | Målbilden i sin helhet, version 1.7. Markdown är det styrande originalet. |
| [Agentinstruktioner](AGENTS.md) | Kort läsordning, principer och arbetsregler. |
| [Utvecklingsplan](BACKLOG.md) | Förberedande loop-prov och sex produktsteg, med ordning och uppgiftslänkar. |
| [Utvecklingsloop](docs/DEVELOPMENT_LOOP.md) | Cursor-agenter, koordinator, överlämning, omtag och återupptagning. |

Det här är projektets första dokument- och planeringsförslag. Produktkod, GUI-teknik, första målplattform och verifierad agentanslutning återstår. Cursor är vald för första integrationen och testningen på Niclas hemmadator. VS Code/Copilot finns kvar i målbilden och beaktas i teknikvalen, med implementation och provkörning senare. Första milstolpen går från interaktiv chatt till en verklig kodändring i ett repo, granskning av vanlig diff och körning av bygge eller test. Avbrott, återhämtning och sparad historik ingår; faktisk användning styr fortsättningen.

Maestro är orkestratorns interna arbetsnamn. Människointeraktivt arbete och autonom iteration är båda delar av målbilden; användaren väljer graden av medverkan.

## Prova utvecklingsloopen i Cursor

Öppna repots rot i Cursor och skriv `/dspatch-loop calibrate` i en Agent-chatt. Koordinatorn kör i huvudchatten och anropar fem specialister direkt. Git och Python 3.10+ behövs för det lokala provet. [Startinstruktion och begränsningar](docs/DEVELOPMENT_LOOP.md) beskriver också hur passet återupptas i en ny chatt.

Definitionerna och det lokala snapshot-verktyget är kontrollerade; det verkliga agentprovet på hemmadatorn återstår i DSP-7. Det är utvecklingshjälp för att bygga DSpatch, inte en färdig Maestro-funktion i produkten.

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
