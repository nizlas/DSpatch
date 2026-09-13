# Arbeta med DSpatch

## Läs rätt underlag

1. Läs [VISION.md](docs/VISION.md) när du börjar arbeta i projektet. Den är det styrande originalet; avsnitt 1–3, 8 och 14–15 beskriver produktens riktning och första omfattning.
2. Läs [BACKLOG.md](BACKLOG.md) för aktuell utvecklingsriktning och arbetsflöde.
3. Läs den aktuella uppgiften i `backlog/tasks/`, dess beroenden och relevanta visionsavsnitt. Vid fortsatt arbete räcker ändrat och uppgiftsrelevant underlag; läs inte om all historik rutinmässigt.
4. När du kör eller ändrar utvecklingsloopen: läs [DEVELOPMENT_LOOP.md](docs/DEVELOPMENT_LOOP.md). Koordinatorns ingång är `.cursor/skills/dspatch-loop/SKILL.md`; de fem specialisterna finns i `.cursor/agents/`.

Niclas uttryckliga beslut styr målbilden. Skilj beslutade principer från tekniska förslag och öppna frågor i VISION.md. Ändra inte målbilden för att passa en implementation; dokumentera ett föreslaget avsteg och dess motiv. Rutinmässiga, reversibla val inom överenskommen uppgift kan göras utan nytt godkännande. Varaktiga beslut och ändrad riktning ska framgå i repot.

## Bevara produktens riktning

- Enkelhet med bibehållen kraft: vanliga handlingar ska vara synliga och begripliga; kortkommandon är frivilliga.
- Människointeraktivt arbete är ett fullvärdigt läge för hela projektet, så länge användaren vill. Autonomi ska kunna väljas till och från med sammanhang och historik bevarade.
- Kodförståelse är central. Förklaringar, granskning och verifiering ska gå att följa till verklig kod och rätt revision; en agentberättelse är inte evidens.
- DSpatch är både arbetsverktyg och experimentmiljö. Bygg små användbara inkrement och låt faktisk användning styra nästa steg.
- Börja med en minimal interaktiv chatt och låt Etapp 0 omfatta verkliga avgränsade kodändringar, en vanlig fullständig textdiff och körning av relevant bygge eller test. Håll leverantörsanrop skilda från gränssnitt och sparade data. En avancerad kodvy, egen editor eller Maestro är inte en förutsättning för första nyttan.
- Använd det valda teknikspåret TypeScript, React och Electron enligt [VISION.md, avsnitt 9.1](docs/VISION.md#91-valt-teknikspår-och-plattformar). Windows och Linux är målplattformar; bygg och prova först på Windows. Håll plattformsspecifika delar avskilda och eftersträva samma layout, styling och arbetsflöden. Linuxprov krävs inte i Etapp 0 och får inte anges som genomförda utan evidens.
- Börja utveckling och testning med Cursor på Niclas hemmadator. VS Code/Copilot ska fortsatt stödjas i målbilden: beakta kompatibiliteten i teknikvalen och håll Cursor-specifika delar avskilda. Implementation och provkörning med VS Code/Copilot krävs inte i Etapp 0; dokumentera kvarstående prov utan att kalla kompatibiliteten verifierad.
- Maestro är ett internt arbetsnamn. Referensloopen är ett exempel, och framtida arbetsflöden ska kunna skilja sig från den.

## Genomför en avgränsad uppgift

- Kontrollera befintliga ändringar och respektera andras arbete. Ange uppgifts-ID, avsett resultat och en kort plan innan större kodändringar. Genomförandet följer användarens givna mandat.
- Använd Backlogs CLI eller webbgränssnitt för uppgiftsändringar när verktyget finns. Läs `backlog instructions overview` och relevant `--help` vid behov. Verktygets generella arbetsflödesråd ska anpassas till DSpatchs instruktioner och användarens mandat.
- Om Backlog inte är tillgängligt kan uppgiftsfilerna uppdateras försiktigt som Markdown. Bevara ID, YAML-fält och sektionsmarkörer; kontrollera formatet efteråt. Planering ska kunna fortsätta utan MCP eller externa projektsystem.
- Bevara beslut, försök och relevanta resultat i uppgiften. Vid avbrott: lämna senaste verifierade läge, kvarstående problem och ett konkret nästa steg. Ett okänt utfall ska klarläggas innan åtgärden upprepas.
- Bevara användarens befintliga ändringar. Knyt diffar och körresultat till verkligt filinnehåll och identifierade ögonblicksbilder, även för ännu ej committad kod. Avbrott och omstart får inte tyst återställa filer, återapplicera ändringar eller dubbelstarta kommandon.
- Kontrollera relevanta beteenden med rimlig omfattning. Rapportera vad som ändrades, varför, testad revision eller ögonblicksbild, körda kontroller och vad som återstår. Skilj leverantörsdokumentation från faktiskt provad funktion; saknade mätvärden är okända, inte noll.
- Sätt inte UX-kriterier som kräver Niclas provkörning till godkända på grundval av agenttester. Använd `Review` när ett granskningsbart resultat väntar på bedömning och följ statusreglerna i BACKLOG.md.

## Agentloopen under utvecklingen

En extern agentloop som hjälper oss bygga DSpatch är skild från Maestro-funktionen vi senare bygger in i produkten. Första utkastet har koordinator i huvudchatten och fem specialister: Backlog Planner, Researcher, Implementer, Verifier och Reviewer. Alla specialistanrop går direkt via koordinatorn, sekventiellt och utan vidare delegering. Planner och Researcher används vid behov.

Under ett loop-pass äger koordinatorn ensam backlog, planöversikt och körjournal. Specialister returnerar rapporter och får bara skriva inom sina uttryckliga uppdrag. En ny chatt ska återuppta kända steg och klarlägga oklara utfall före nya anrop. Bevara möjligheten att arbeta interaktivt genom hela utvecklingen. DSP-7 provar samarbete och planeringskvalitet i Cursor innan DSP-1 genomförs med loopen.
