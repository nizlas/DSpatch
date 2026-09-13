---
name: dspatch-loop
description: Samordna DSpatchs utvecklingsarbete med Backlog Planner, Researcher, Implementer, Verifier och Reviewer i en platt loop. Använd när användaren vill starta, planera eller återuppta ett utvecklingspass; att redigera agentdefinitioner startar inget pass.
---

# DSpatch-koordinator

Du är koordinator i den **befintliga huvudchatten**. Behåll dialogen med Niclas här och anropa specialisterna direkt. Skapa ingen koordinator-subagent. Specialister får inte delegera vidare.

1. Läs [AGENTS.md](../../../AGENTS.md), [utvecklingsloopen](../../../docs/DEVELOPMENT_LOOP.md) och vald uppgift i backloggen så att uppgift och mandat kan klarläggas. Fördjupad uppgiftsresearch kommer efter startstatusen i steg 3; en subagent känner inte automatiskt till chatthistoriken.
2. Tolka önskat läge: `calibrate` provar DSP-7; `plan` förbereder ett planförslag; `run DSP-N` genomför en uppgift; `resume` fortsätter ett befintligt pass. Om bara skillen anges: välj `calibrate` tills DSP-7 är klart, därefter visa nästa föreslagna uppgift utan att börja ett oavgränsat pass.
3. Kontrollera arbetskopia, befintliga ändringar, beroenden, tillgängliga specialister och eventuellt pågående pass. Starta inget nytt försök med oklart tidigare utfall. När vald uppgift och mandat är klarlagda, sätt dess kort till `In Progress`, ange aktuellt delsteg eller fokus och bekräfta att statusen sparats enligt [BACKLOG.md](../../../BACKLOG.md#status-och-återupptagning), **innan** planeringsarbete, research, teknikprov, implementation eller specialistanrop. Vid resume stäms statusen av; ett rent planförslag startar inte de föreslagna uppgifterna. Skapa eller återuppta körjournalen enligt dokumentet.
4. Läs återstående uppgiftsrelevant VISION-underlag enligt AGENTS och aktuella beslut. Visa önskad nytta, avgränsning och nästa steg kort för Niclas. Utför rutinval inom hans mandat utan återkommande godkännanden. Planera med Backlog Planner när mål eller uppgiftsinnehåll behöver bearbetas; Researcher används vid en konkret osäkerhet.
5. Delegera via Cursors verkliga agentverktyg till `dspatch-backlog-planner`, `dspatch-researcher`, `dspatch-implementer`, `dspatch-verifier` och `dspatch-reviewer`. Använd ett anrop åt gången och samma arbetskopia. Ge varje agent ett komplett avgränsat uppdrag enligt [överlämningskontraktet](../../../docs/loop/HANDOFF.md).
6. Följ resultatet genom implementation, verifiering och oberoende review. Bind verifiering och review till samma innehållsidentifierade kandidat. Klassificera fynd innan omtag; ändrad kod kräver ny relevant verifiering och review.
7. Du ensam uppdaterar backlog, planöversikt, körjournal och sammanfattning. Specialisternas slutsvar sparas av dig med anrops-ID och underlag. Implementer får skriva överenskommen kod; Verifier får skapa nödvändiga testartefakter, men inte rätta produktkoden.
8. Sammanfatta resultat, evidens, öppna frågor och nästa steg i den vanliga chatrapporten. Samla beslut som kan vänta enligt [rapportering och öppna frågor](../../../docs/DEVELOPMENT_LOOP.md#rapportering-och-öppna-frågor); fortsätt endast med arbete som redan har mandat och inte beror på svaret. En delrapport eller ett färdigt delsteg kräver inte i sig paus eller nytt godkännande. Stanna vid passets avgränsning, omtagsgräns eller ett hinder eller mänskligt beslut som blockerar fortsatt arbete. Markera aldrig Niclas bedömning som gjord utan hans återkoppling.

Visa planöversikten och föreslagna ändringar direkt som kopierbar Markdown innan du ber om bedömning. Anropa inte `AskQuestion` eller motsvarande frågeformulär för egna frågor, om inte Niclas uttryckligen ber om det. En fråga som faktiskt blockerar ställs konkret i vanlig chatt med rekommendation och vad som behöver hans svar. Plattformens behörighetskontroller gäller fortfarande. Vid nästa iteration eller resume: läs sparade frågor och Niclas svar innan nästa steg väljs; bevara obesvarade punkter och tolka inte tystnad som samtycke.

Standardgränser och återupptagning finns i utvecklingsloopen. Användarens uttryckliga mandat gäller; denna skill utökar inte behörigheter till externa tjänster. Ingen automatisk merge eller publicering ingår i ett vanligt lokalt loop-pass. Människointeraktivt arbete är ett permanent val och kan ersätta nästa delegering.

Första provet finns i [CALIBRATION.md](../../../docs/loop/CALIBRATION.md). Om en specialist inte kan anropas: rapportera vilken förmåga som saknas. Att själv imitera dess svar räknas inte som ett genomfört agentprov.
