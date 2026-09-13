# DSpatchs utvecklingsloop

Första utkast, 13 september 2026. Detta är arbetsformen som hjälper oss **bygga DSpatch i Cursor**. Produktens målbild och etapper finns i [VISION.md](VISION.md); den inbyggda Maestro-funktionen kommer senare. Körjournal och instruktioner ersätter inte Cursors verkliga process- och verktygshantering.

## Börja i Cursor

Hämta grenen med dessa filer och öppna repots rot i Cursor. Använd en Agent-chatt med tillgång till projektfiler, terminal och subagenter. Använd ditt vanliga modellval; specialisterna har `model: inherit`. Git och Python 3.10+ behövs för det medföljande ögonblicksbildsverktyget och dess lokala prov, utan extra Python-paket. Det väljer inte språk för DSpatch-produkten.

Skriv i Agent-chatten:

```text
/dspatch-loop calibrate
```

Första provet är [DSP-7](../backlog/tasks/dsp-7%20-%20Kalibrera-utvecklingsloopen-i-Cursor.md), med det konkreta förloppet i [CALIBRATION.md](loop/CALIBRATION.md). Det provar riktiga specialistanrop och en enkel avbryt-/återupptagningspunkt. Det provar också planering på verkligt DSpatch-underlag.

Efter ett lyckat prov kan du exempelvis skriva:

```text
/dspatch-loop run DSP-1
```

Andra uppdrag:

| Uppdrag | Resultat |
| --- | --- |
| `/dspatch-loop plan` följt av ett mål | Ett granskat förslag till nästa inkrement och konkreta uppgifter. Ingen implementation startas av planläget. |
| `/dspatch-loop resume` | Läs aktuell körjournal och fortsätt från senast klarlagda läge med samma mandat och räknare. |
| ”Arbeta interaktivt med mig tills vidare” | Koordinatorn stannar i dialog och sparar beslut. Ingen tidsgräns kräver återgång till loopen. |

Detta är uppdrag till skillen i chatten, inte ett separat CLI. Om skillen inte syns: öppna en ny Agent-chatt i rätt reporot och kontrollera att filerna finns. Som reserv kan du bifoga `.cursor/skills/dspatch-loop/SKILL.md` och be huvudagenten följa den som koordinator. Om subagentverktyget saknas måste det problemet redovisas; att spela alla roller i samma kontext räknas inte som ett godkänt loop-prov.

## Sex roller, en platt anropsstruktur

| Roll | Definition | Ansvar |
| --- | --- | --- |
| Koordinator, i huvudchatten | [dspatch-loop](../.cursor/skills/dspatch-loop/SKILL.md) | Mandat, sammanhang, operativ plan, alla delegeringar och all statusbokföring. |
| Backlog Planner | [Agent](../.cursor/agents/dspatch-backlog-planner.md) | Planöversikt och välbeskrivna uppgiftsförslag. |
| Researcher | [Agent](../.cursor/agents/dspatch-researcher.md) | Avgränsad undersökning när en verklig osäkerhet behöver lösas. |
| Implementer | [Agent](../.cursor/agents/dspatch-implementer.md) | Överenskommen kodändring och egna kontroller. |
| Verifier | [Agent](../.cursor/agents/dspatch-verifier.md) | Oberoende körning och bedömning av teknisk evidens. |
| Reviewer | [Agent](../.cursor/agents/dspatch-reviewer.md) | Oberoende granskning av plan eller implementation. |

Koordinatorn anropar specialisterna direkt, sekventiellt i förgrunden. Ingen specialist delegerar, inte heller till generiska underagenter. Det är vår egen policy, inte en plattformsbegränsning: enligt Cursors dokumentation kan subagenter starta barnsubagenter sedan Cursor 2.5. Policyn finns för att hålla anropsstrukturen platt och spårbar, och specialisternas instruktioner upprepar den. Researcher och Backlog Planner används vid behov, inte som obligatoriska ceremonier inför varje mindre ändring. Reviewer används för substantiella nya planförslag och för levererade implementationer. Koordinatorn ger varje specialist en tydlig överlämning; den ska inte behöva gissa vad som sagts i huvudchatten.

## Ett normalt pass

1. **Återställ sammanhanget.** Kontrollera rätt repo, aktuell gren, befintliga ändringar, vald uppgift och dess beroenden. Läs relevant målbild och aktuella beslut. Om en tidigare körning finns: klarlägg den före nytt arbete.
2. **Avgränsa och förklara nyttan.** Visa kort vad nästa inkrement ska ge. Ett standardpass gäller en uppgift. En stor uppgift kan delas i användbara delsteg utan att dess slutkriterier tyst krymps.
3. **Planera när det behövs.** Backlog Planner lämnar översikt och uppgiftsförslag. Reviewer granskar ett substantiellt planförslag i planläge. Koordinatorn verkställer välgrundade förändringar inom mandatet; en ändrad produktinriktning lyfts till Niclas.
4. **Undersök en konkret osäkerhet.** Anropa Researcher om kod eller dokumentation inte räcker. Ett körbart teknikprov tilldelas Implementer och Verifier med rätt mandat.
5. **Implementera.** Ge Implementer avgränsade skrivytor och kriterier. När den återkommer kontrollerar koordinatorn den verkliga diffen och fastställer kandidatens ögonblicksbild.
6. **Verifiera och granska.** Verifier kör relevanta kontroller på kandidaten. Reviewer läser samma kandidat, verklig kod och verifieringsrapport. Om underlaget har ändrats är tidigare resultat historik, inte ett godkännande av den nya kandidaten.
7. **Hantera fynd.** Ett kodfel går till ett avgränsat omtag. En felaktig premiss går till planering eller research. Ett beslut om målbild eller mänsklig UX går till Niclas. Upprepa inte bara samma uppdrag med fler agenter.
8. **Avsluta eller lämna över.** Koordinatorn uppdaterar uppgiften och sammanfattar nytta, ändringar, evidens, öppna frågor och nästa handling. Vid mänsklig bedömning används Review; Done kräver uppfyllda kriterier. Annat arbete kan fortsätta om det redan ryms i användarens mandat och inte beror på den öppna bedömningen.

## Planeringens kvalitetsprov

Planöversikten ska gå att förstå utan att läsa varje ticket: vilket problem löser vi, varför kommer detta nu och vad kan Niclas använda efter steget?

Bedöm både första förslaget och utfallet efter återkoppling: saknade nödvändiga steg, oklara beroenden, kriterier som inte går att bedöma, onödigt arbete och mängden grundläggande korrigeringar. Skilj nya produktinsikter från fel som planeraren borde ha undvikit. En osäker UX-idé kan behöva ett litet experiment före implementation.

Bevara generaliserbara beslut i uppgiften eller gemensamma instruktioner. Gör inte varje enskild kommentar till en permanent regel. Det första verkliga planeringsomtaget granskas med Niclas innan vi ökar mandatet.

## Rapportering och öppna frågor

Niclas ska kunna kopiera rapporten, diskutera den och lämna samlad återkoppling inför nästa iteration. Presentera därför resultat och beslutsunderlag direkt som Markdown i den vanliga chatten. Koordinatorn använder separata frågerutor, exempelvis `AskQuestion`, bara om Niclas uttryckligen ber om dem. Detta gäller loopens egna frågor; Cursors behörighetskontroller gäller fortfarande.

Visa den aktuella planöversikten och konkreta föreslagna justeringar innan du ber om bedömning. Fråga inte först hur underlaget ska presenteras. Rapporten ska räcka för att förstå beslutet; länkar till uppgiftskort och rårapporter ger fördjupning.

När frågor finns, samla dem i en numrerad lista under **Öppna frågor inför nästa iteration**. Ange för varje punkt:

- Vad frågan gäller och vilket underlag eller konstaterat hinder den bygger på.
- Koordinatorns rekommendation och den relevanta konsekvensen av valet.
- När svaret behövs, vilket steg som beror på det och vad som kan fortsätta redan nu.

Bedöm först vem som kan lösa frågan och när den behöver besvaras:

| Situation | Hantering |
| --- | --- |
| Rutinval eller teknisk osäkerhet som agenterna kan utreda inom mandatet | Välj eller undersök och redovisa resultatet. En ännu oprövad förutsättning är inte i sig ett konstaterat hinder. |
| Mänskligt beslut som behövs först senare | Spara frågan till nästa iteration. Fortsätt med oberoende arbete inom befintligt mandat och passets gränser. |
| Mänsklig bedömning eller saknat mandat som nästa steg faktiskt kräver | Lämna det konkreta underlaget och frågan i vanlig chatt. Vänta med det beroende steget tills svaret finns. Om inget annat arbete kan fortsätta: spara nästa steg och använd WAITING_USER. |

Att skjuta upp en fråga utökar inte mandatet. Uteblivet svar räknas aldrig som ett godkännande och mänskliga acceptanskriterier förblir öppna. Ett vanligt pass gäller fortfarande en uppgift; en senare iteration eller nästa uppgift får bara starta inom användarens givna mandat. Tekniska hinder och okända anropsutfall följer de befintliga stopp- och avstämningsreglerna.

Koordinatorn sparar rapporten i körjournalen. Mänskliga beslut och kontroller som återstår förs in i befintliga `pending_human_checks` med hänvisning till rapportens punkt och när svaret behövs. Tekniska utredningar och nästa handling beskrivs i rapporten och `next_step`. Sammanfatta varaktiga frågor, beslut och nästa steg i uppgiftsfilen så att de också kan läsas från Backlog.

Vid nästa iteration eller resume: läs rapporten, väntande punkter och Niclas eventuella svar före ny delegering. Knyt varje svar till rätt fråga, spara beslutet och bevara obesvarade punkter. Genomför redan godkända val utan att fråga igen; återför relevant beslut till berörda specialister. Använd den befintliga journalen och dess räknare enligt återupptagningsreglerna.

## Överlämning och en enda skrivande ägare

Använd [HANDOFF.md](loop/HANDOFF.md) för uppdrag och slutsvar. Koordinatorn sparar specialistens rapport i sin helhet eller som en trogen, märkt sammanställning med referenser till råunderlag.

Koordinatorn ensam skriver `BACKLOG.md`, uppgiftsstatus, milstolpar och körjournal. Backlog Planner föreslår ändringar. Implementer får skriva uppdragets filer. Verifier får skapa testartefakter och loggar men inte rätta produktkod. Planner, Researcher och Reviewer är konfigurerade som läsande.

Backlog CLI används när det fungerar. Annars kan koordinatorn redigera samma Markdown-filer enligt AGENTS.md. En misslyckad MCP- eller CLI-skrivning följs av läsning av det verkliga utfallet före nytt försök. Inget externt projektsystem är en förutsättning.

Om `backlog` inte hittas i terminalen: kontrollera `PATH` innan du drar slutsatsen att verktyget saknas. En agentterminal kan ha ärvt en inaktuell miljö där `C:\Program Files\nodejs` och `%APPDATA%\npm` fattas, trots att de finns i den sparade PATH. Symtomet blir antingen att kommandot inte känns igen eller, med full sökväg, att `node` inte känns igen. Komplettera PATH i sessionen eller starta om Cursor; installera inte om något utan belägg. Detta inträffade under DSP-7 och är dokumenterat där.

## Körjournal och återupptagning

Lokala journaler ligger i `.dspatch-loop/runs/<run-id>/`, med `state.json`, numrerade överlämningar/rapporter, loggar och ögonblicksbilder. Utgå från [STATE.template.json](loop/STATE.template.json). Run-id skapas av koordinatorn, exempelvis UTC-tid plus ett kort slumpvärde. En lokal `.dspatch-loop/current.json` pekar på passet.

Skriv `state.json` via temporär fil och atomisk ersättning. Före ett specialist- eller verktygsanrop sparas nästa steg, anropsnummer och känt utfall. Efter anropet sparas verkligt agent-/process-ID om verktyget lämnar ett, rapportreferens och nytt läge. Ett okänt ID ska vara null, inte påhittat.

| Journalens läge | Betydelse |
| --- | --- |
| READY | Nästa avgränsade steg är känt; inget känt anrop pågår. |
| RUNNING | Ett angivet anrop har startats; faktisk aktivitet bedöms från verktyget. |
| RECONCILING | Tidigare anrop eller fil-/kommandoutfall behöver klarläggas. Ingen automatisk upprepning. |
| PAUSED | Passet har pausats med en konkret återupptagningspunkt. |
| WAITING_USER | Ett faktiskt beslut eller manuellt prov behövs. |
| BLOCKED | Ett konkret hinder stoppar fortsatt meningsfullt arbete. |
| COMPLETED | Detta pass är avslutat; det betyder inte automatiskt att hela uppgiften är Done. |

Vid resume: läs journal, rapporter, faktisk arbetskopia och tillgängligt processtillstånd. Jämför kandidat och nästa steg. Om anropets utfall är oklart: gå till RECONCILING och fastställ vad som redan hänt. Kan det inte fastställas, ge en konkret fråga eller lokal kontroll och stanna. Ingen patch, agentkörning eller testprocess startas om enbart för att chatten eller ett verktyg tappat anslutningen.

Kör en koordinator per arbetskopia. Detta utkast har ingen processövervakare eller automatisk låshanterare; journalen är återupptagningsunderlag, inte bevis för att processer kör eller stoppats. Journalerna är lokala och ignorerade av Git. Varaktiga beslut, resultat och senaste verifierade nästa steg sammanfattas i uppgiftsfilen; återupptagning på en annan dator kräver att även nödvändiga lokala underlag finns där.

## Kandidat och teknisk evidens

Koordinatorn fångar en kandidat efter implementation och före oberoende kontroller:

```sh
python scripts/loop_snapshot.py --output .dspatch-loop/runs/EXEMPEL/candidate.json
python scripts/loop_snapshot.py --expect .dspatch-loop/runs/EXEMPEL/candidate.json
```

Byt EXEMPEL mot passets verkliga ID. Verktyget läser Git och filinnehåll; det committar eller återställer inget. Det inkluderar spårade filer, spårade borttagningar och nya filer som inte ignoreras. Lokala körjournaler undantas alltid. Ignorerade beroenden, miljö och verktygsversioner behöver redovisas separat. Submoduler stöds inte av första verktyget.

Verifier kontrollerar före och efter test. Reviewer kontrollerar mot samma snapshot. Om tester skapar nya icke ignorerade artefakter: dokumentera dem och fastställ en stabil kandidat; dölj aldrig en källkodsändring som en testartefakt. En senare administrativ statusändring i backloggen dokumenteras som sådan; rapportera fortsatt den faktiskt kontrollerade kandidaten, inte ett påhittat ”testat HEAD”.

## Gränser och stopp

Standard är en uppgift, högst två korrigeringsomgångar och tolv specialistanrop per pass. Räknarna bevaras vid resume och räknar även misslyckade anrop. Användaren kan ange andra gränser eller flera uppgifter. Vid gränsen: lämna konkret resultat och föreslaget nästa steg, inte ett nytt pass som nollställer räknaren.

Ett läsande anrop med klarlagt misslyckande kan återförsökas en gång. För skrivande eller okända utfall krävs först avstämning. Använd verkliga tidsgränser för verktyg som stöder det. Gränser i denna instruktion kontrolleras mellan anrop och kan **inte** avbryta ett blockerat Cursor-verktyg. Om ett sådant anrop fastnar behöver användaren avbryta det i Cursor; nästa pass återupptar genom avstämning.

Saknad åtkomst, blockerande teknik eller ändrad produktinriktning rapporteras med vad som provats och exakt vad som behövs. Niclas manuella UX-bedömning hålls separat från tekniskt PASS. Frånvaro av förbrukningsdata rapporteras som okänd, inte noll.

## Verifieringsläge och källor

Detta utkast innehåller riktiga definitioner och ett körbart lokalt hjälpverktyg. En genomförd Cursor-körning på Niclas dator återstår i DSP-7; filkontroll bevisar inte agenternas beteende eller planeringskvalitet.

Cursor-formaten kontrollerades 13 september 2026: [subagenter](https://cursor.com/docs/subagents) och [skills](https://cursor.com/docs/skills). Koordinatorn är en skill i huvudchatten; specialisterna är projektagenter. Gemensamma instruktioner ligger i [AGENTS.md](../AGENTS.md), som också kan läsas utanför Cursor.
